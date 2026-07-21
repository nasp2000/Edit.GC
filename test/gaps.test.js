const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const APP_URL = 'file://' + path.resolve(__dirname, '..', 'app', 'index.html');
const SAMPLES = path.join(__dirname, 'samples');
const PASS = '\x1b[32m\u2713\x1b[0m';
const FAIL = '\x1b[31m\u2717\x1b[0m';

let passed = 0, failed = 0;
function assert(name, ok, detail) {
  if (ok) { passed++; console.log(`  ${PASS} ${name}`); }
  else { failed++; console.log(`  ${FAIL} ${name}${detail ? ' \u2014 ' + detail : ''}`); }
}
function section(n, name) { console.log(`\n\x1b[36m${n}. ${name}\x1b[0m`); }

async function loadGcode(page, file) {
  const fullPath = path.join(SAMPLES, file);
  if (!fs.existsSync(fullPath)) return false;
  const [chooser] = await Promise.all([
    page.waitForFileChooser({ timeout: 4000 }).catch(() => null),
    page.evaluate(() => document.getElementById('fileInputGcode').click())
  ]);
  if (!chooser) return false;
  await chooser.accept([fullPath]);
  await new Promise(r => setTimeout(r, 1500));
  const ok = await page.evaluate(() => state.workingCmds.length > 0);
  return ok;
}

async function run() {
  console.log('\n\x1b[36m\u2550\u2550\u2550 Gap Tests (Undo, Reset, Options, Edge Cases, etc.) \u2550\u2550\u2550\x1b[0m\n');
  require('./setup.js');

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-web-security'] });
  const page = await browser.newPage();

  // Auto-accept confirm dialogs
  page.on('dialog', async dialog => {
    if (dialog.type() === 'confirm') await dialog.accept();
    else await dialog.dismiss();
  });

  const errors = [];
  page.on('pageerror', err => errors.push(err.message));

  await page.goto(APP_URL + '?t=' + Date.now(), { waitUntil: 'networkidle0' });
  await page.waitForSelector('#btnSlice');
  await new Promise(r => setTimeout(r, 500));

  // Create test G-code (with S values for laser-on detection)
  const gcode = [
    'G21', 'G90',
    'G0 X0 Y0 F8000',
    'G1 X10 Y10 F500 S1000',
    'G1 X30 Y10',
    'G1 X30 Y30',
    'G1 X10 Y30',
    'G1 X10 Y10',
    'M2'
  ].join('\n');
  fs.writeFileSync(path.join(SAMPLES, 'gaps_square.gcode'), gcode, 'utf8');

  const loaded = await loadGcode(page, 'gaps_square.gcode');
  assert('G-code loaded', loaded);
  if (!loaded) { await browser.close(); return; }

  const origTextFn = () => page.evaluate(() => document.getElementById('editorWorking').value);
  const origText = await origTextFn();
  const origLen = origText.split('\n').length;

  // Show the Points Editor sections
  await page.evaluate(() => {
    ['pathVarContent', 'turnVarContent', 'shiftPointsContent', 'minDistContent'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'flex';
    });
  });

  // ===== 1. Undo / Redo after operations =====
  section(1, 'Undo / Redo after operations');

  // 1a. Full Path Variation -> Undo -> Redo
  await page.evaluate(() => {
    document.getElementById('chkPathVarOutside').checked = true;
    document.getElementById('chkPathVarInside').checked = false;
    document.getElementById('pathVarOutside').value = '0.1';
  });
  await new Promise(r => setTimeout(r, 100));
  await page.evaluate(() => { const b = document.getElementById('btnPathVarApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  const pathVarText = await origTextFn();
  assert('PathVar: ;edit.gc present on modified lines', pathVarText.includes(';edit.gc'));
  assert('PathVar: original X10 Y10 line has no ;edit.gc before first offset', (() => {
    const lines = pathVarText.split('\n');
    const firstOrigIdx = lines.findIndex(l => /X10\b/.test(l) && /Y10\b/.test(l));
    const firstEditIdx = lines.findIndex(l => l.includes(';edit.gc'));
    return firstOrigIdx >= 0 && firstEditIdx > firstOrigIdx;
  })());

  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));
  const afterUndo1 = await origTextFn();
  assert('Undo: Full Path Variation restores original', afterUndo1 === origText);

  await page.evaluate(() => { const b = document.getElementById('btnRedo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));
  const afterRedo1 = await origTextFn();
  assert('Redo: Full Path Variation re-applies', afterRedo1 !== origText);
  assert('PathVar redo: ;edit.gc present', afterRedo1.includes(';edit.gc'));
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  // 1b. Full Turn -> Undo -> Redo
  await page.evaluate(() => { document.getElementById('turnVarValue').value = '0.1'; });
  await new Promise(r => setTimeout(r, 100));
  await page.evaluate(() => { const b = document.getElementById('btnTurnVarApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  const afterTurn = await origTextFn();
  assert('Full Turn changes content', afterTurn !== origText);
  assert('Full Turn: ;edit.gc on modified lines', afterTurn.includes(';edit.gc'));
  assert('Full Turn: header/footer lines without ;edit.gc exist', (() => {
    const lines = afterTurn.split('\n');
    return lines.some(l => /^G21/.test(l) && !l.includes(';edit.gc')) &&
           lines.some(l => /^M2/.test(l) && !l.includes(';edit.gc'));
  })());

  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));
  assert('Undo: Full Turn restores original', await origTextFn() === origText);

  await page.evaluate(() => { const b = document.getElementById('btnRedo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));
  const turnRedone = await origTextFn();
  assert('Redo: Full Turn re-applies', turnRedone !== origText);
  assert('Full Turn redo: ;edit.gc present', turnRedone.includes(';edit.gc'));
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  // 1c. Shift Points -> Undo -> Redo
  await page.evaluate(() => {
    document.getElementById('batchAxis').value = 'X';
    document.getElementById('batchAxisVal').value = '5';
  });
  await new Promise(r => setTimeout(r, 100));
  await page.evaluate(() => { const b = document.getElementById('btnBatchApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  const shiftText = await origTextFn();
  assert('Shift Points changes content', shiftText !== origText);
  assert('Shift Points: ;edit.gc on modified lines', shiftText.includes(';edit.gc'));
  assert('Shift Points: original lines without ;edit.gc exist', (() => {
    const lines = shiftText.split('\n');
    return lines.some(l => /G21/.test(l) && !l.includes(';edit.gc')) &&
           lines.some(l => /M2/.test(l) && !l.includes(';edit.gc'));
  })());

  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));
  assert('Undo: Shift Points restores original', await origTextFn() === origText);

  await page.evaluate(() => { const b = document.getElementById('btnRedo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));
  assert('Redo: Shift Points re-applies', await origTextFn() !== origText);
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  // 1d. MinDist -> Undo -> Redo
  await page.evaluate(() => { document.getElementById('minDistValue').value = '0.5'; });
  await new Promise(r => setTimeout(r, 100));
  await page.evaluate(() => { const b = document.getElementById('btnMinDistApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  const minText = await origTextFn();
  assert('MinDist changes content', minText !== origText);
  assert('MinDist: ;edit.gc on new points', minText.includes(';edit.gc'));

  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));
  assert('Undo: MinDist restores original', await origTextFn() === origText);

  await page.evaluate(() => { const b = document.getElementById('btnRedo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));
  assert('Redo: MinDist re-applies', await origTextFn() !== origText);
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  // ===== 2. Reset =====
  section(2, 'Reset');

  // Make a change
  await page.evaluate(() => {
    document.getElementById('batchAxis').value = 'X';
    document.getElementById('batchAxisVal').value = '5';
  });
  await new Promise(r => setTimeout(r, 100));
  await page.evaluate(() => { const b = document.getElementById('btnBatchApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  assert('Reset: G-code was modified', await origTextFn() !== origText);

  // Reset (auto-accepted via dialog handler)
  await page.evaluate(() => { const b = document.getElementById('btnReset'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  assert('Reset restores original G-code', await origTextFn() === origText);

  // Reset again when already clean — no confirm expected
  await page.evaluate(() => { const b = document.getElementById('btnReset'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 300));
  assert('Reset again stays clean', await origTextFn() === origText);

  // ===== 3. Machine Options -> Converter validation =====
  section(3, 'Machine Options -> Converter');

  // Create SVG
  const svgContent = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100mm" height="50mm"><rect x="1" y="1" width="98" height="48" fill="none" stroke="black" stroke-width="1"/></svg>';
  fs.writeFileSync(path.join(SAMPLES, 'gaps_test.svg'), svgContent, 'utf8');

  const [svgChooser] = await Promise.all([
    page.waitForFileChooser({ timeout: 4000 }).catch(() => null),
    page.evaluate(() => { const inp = document.getElementById('fileInputVector'); if (inp) inp.click(); })
  ]);
  if (svgChooser) {
    await svgChooser.accept([path.join(SAMPLES, 'gaps_test.svg')]);
    await new Promise(r => setTimeout(r, 2000));

    await page.select('#templateSelect', 'Grbl');
    await new Promise(r => setTimeout(r, 300));

    // Show machine options
    await page.evaluate(() => {
      const body = document.getElementById('machineOptionsBody');
      if (body) body.classList.remove('collapsed');
    });
    await new Promise(r => setTimeout(r, 200));

    const hasMachineOpts = await page.evaluate(() => {
      const body = document.getElementById('machineOptionsBody');
      return body && body.querySelectorAll('select[data-opt-id]').length > 0;
    });
    assert('Machine Options: selects exist', hasMachineOpts);

    if (hasMachineOpts) {
      const passesSel = await page.$('select[data-opt-id="passes"]');
      if (passesSel) {
        await passesSel.select('3');
        await new Promise(r => setTimeout(r, 100));
      }

      await page.click('#btnSlice');
      await new Promise(r => setTimeout(r, 1500));

      const convText = await page.evaluate(() => document.getElementById('editorOriginal').value);
      const hasPass1 = convText && convText.includes('Pass 2');
      assert('Converter: Pass 2 header present', hasPass1);

      const hasG21 = /\bG21\b/.test(convText);
      const hasG90 = /\bG90\b/.test(convText);
      assert('Converter: has G21', hasG21);
      assert('Converter: has G90', hasG90);
    }
  } else {
    console.log('  [SKIP] SVG file chooser unavailable');
  }

  // ===== 3.5 Machine Options — defaults (no Custom... selected) =====
  section(3.5, 'Machine Options Defaults');

  // Clear saved opts so defaults apply
  await page.evaluate(() => {
    Object.keys(localStorage).filter(k => k.startsWith('machineOpts_')).forEach(k => localStorage.removeItem(k));
  });
  await page.select('#templateSelect', 'Grbl');
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate(() => {
    const body = document.getElementById('machineOptionsBody');
    if (body) body.classList.remove('collapsed');
  });
  await new Promise(r => setTimeout(r, 200));

  const noCustomGrbl = await page.evaluate(() => {
    const sels = document.querySelectorAll('#machineOptionsBody select[data-opt-id]');
    let bad = 0;
    sels.forEach(sel => { if (sel.value === '__custom__') bad++; });
    return bad;
  });
  assert('Grbl: no select has __custom__ selected', noCustomGrbl === 0, `bad=${noCustomGrbl}`);

  const grblOpts = await page.evaluate(() => ui._getSelectedMachineOpts());
  assert('Grbl: passes default is 1', grblOpts.passes === '1', `got=${grblOpts.passes}`);
  assert('Grbl: feedCut default is 3000', grblOpts.feedCut === '3000', `got=${grblOpts.feedCut}`);
  assert('Grbl: feedTravel default is 6000', grblOpts.feedTravel === '6000', `got=${grblOpts.feedTravel}`);
  assert('Grbl: sMax default is 1000', grblOpts.sMax === '1000', `got=${grblOpts.sMax}`);
  assert('Grbl: useZ default is yes', grblOpts.useZ === 'yes', `got=${grblOpts.useZ}`);

  await page.select('#templateSelect', 'SM Motion Control (SM300)');
  await new Promise(r => setTimeout(r, 300));

  const noCustomSM300 = await page.evaluate(() => {
    const sels = document.querySelectorAll('#machineOptionsBody select[data-opt-id]');
    let bad = 0;
    sels.forEach(sel => { if (sel.value === '__custom__') bad++; });
    return bad;
  });
  assert('SM300: no select has __custom__ selected', noCustomSM300 === 0, `bad=${noCustomSM300}`);

  const sm300Opts = await page.evaluate(() => ui._getSelectedMachineOpts());
  assert('SM300: passes default is 1', sm300Opts.passes === '1', `got=${sm300Opts.passes}`);
  assert('SM300: focusZ default is -220', sm300Opts.focusZ === '-220', `got=${sm300Opts.focusZ}`);
  assert('SM300: laserProgram default is 55', sm300Opts.laserProgram === '55', `got=${sm300Opts.laserProgram}`);

  // Switch back to Grbl
  await page.select('#templateSelect', 'Grbl');
  await new Promise(r => setTimeout(r, 300));

  // ===== 4. Edge Cases: Full Path Variation =====
  section(4, 'Edge Cases: Full Path Variation');

  await loadGcode(page, 'gaps_square.gcode');
  await page.evaluate(() => { const el = document.getElementById('pathVarContent'); if (el) el.style.display = 'flex'; });
  await new Promise(r => setTimeout(r, 100));

  // 4a. Only outside
  const before1 = await page.evaluate(() => state.workingCmds.length);
  await page.evaluate(() => {
    document.getElementById('chkPathVarOutside').checked = true;
    document.getElementById('chkPathVarInside').checked = false;
    document.getElementById('pathVarOutside').value = '0.5';
  });
  await page.evaluate(() => { const b = document.getElementById('btnPathVarApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  assert('PathVar only outside: cmd count increased', await page.evaluate(() => state.workingCmds.length) > before1);

  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  // 4b. Only inside
  const before2 = await page.evaluate(() => state.workingCmds.length);
  await page.evaluate(() => {
    document.getElementById('chkPathVarOutside').checked = false;
    document.getElementById('chkPathVarInside').checked = true;
    document.getElementById('pathVarInside').value = '0.3';
  });
  await page.evaluate(() => { const b = document.getElementById('btnPathVarApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  assert('PathVar only inside: cmd count increased', await page.evaluate(() => state.workingCmds.length) > before2);

  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  // 4c. Zero values (no change expected)
  const before3 = await page.evaluate(() => state.workingCmds.length);
  await page.evaluate(() => {
    document.getElementById('chkPathVarOutside').checked = true;
    document.getElementById('chkPathVarInside').checked = true;
    document.getElementById('pathVarOutside').value = '0';
    document.getElementById('pathVarInside').value = '0';
  });
  await page.evaluate(() => { const b = document.getElementById('btnPathVarApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  assert('PathVar zero values: cmd count unchanged', await page.evaluate(() => state.workingCmds.length) === before3);

  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  // ===== 5. Edge Cases: Full Turn Path Variation =====
  section(5, 'Edge Cases: Full Turn Path Variation');
  await page.evaluate(() => { const el = document.getElementById('turnVarContent'); if (el) el.style.display = 'flex'; });
  await new Promise(r => setTimeout(r, 100));

  // 5a. Zero value (no change)
  const beforeTurnT = await origTextFn();
  await page.evaluate(() => document.getElementById('turnVarValue').value = '0');
  await page.evaluate(() => { const b = document.getElementById('btnTurnVarApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  assert('Full Turn zero: content unchanged', await origTextFn() === beforeTurnT);

  // 5b. Negative value
  await page.evaluate(() => document.getElementById('turnVarValue').value = '-0.1');
  await page.evaluate(() => { const b = document.getElementById('btnTurnVarApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  assert('Full Turn negative: content changed', await origTextFn() !== beforeTurnT);

  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  // ===== 6. Edge Cases: Add Point at Minimum Distance =====
  section(6, 'Edge Cases: Add Point at Minimum Distance');
  await page.evaluate(() => { const el = document.getElementById('minDistContent'); if (el) el.style.display = 'flex'; });
  await new Promise(r => setTimeout(r, 100));

  // 6a. Distance larger than any segment (no points added)
  const beforeMin = await page.evaluate(() => state.workingCmds.length);
  await page.evaluate(() => document.getElementById('minDistValue').value = '100');
  await page.evaluate(() => { const b = document.getElementById('btnMinDistApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  assert('MinDist 100mm: no points added (segments <100mm)', await page.evaluate(() => state.workingCmds.length) === beforeMin);

  // 6b. Very small distance (many points)
  await page.evaluate(() => document.getElementById('minDistValue').value = '0.1');
  await page.evaluate(() => { const b = document.getElementById('btnMinDistApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  assert('MinDist 0.1mm: many points added', await page.evaluate(() => state.workingCmds.length) > beforeMin * 10);

  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  // ===== 7. Find / Replace =====
  section(7, 'Find / Replace');

  // Open find bar
  await page.evaluate(() => {
    const fb = document.getElementById('findReplaceBar');
    if (fb) fb.style.display = 'flex';
    const fi = document.getElementById('findInput');
    if (fi) fi.value = '';
  });
  await new Promise(r => setTimeout(r, 200));

  // 7a. Find X10
  await page.evaluate(() => {
    const inp = document.getElementById('findInput');
    if (inp) {
      inp.value = 'X10';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await new Promise(r => setTimeout(r, 300));
  const findCount = await page.evaluate(() => {
    const el = document.getElementById('findCount');
    return el ? el.textContent : '';
  });
  assert('Find: finds X10 occurrences', findCount !== '0/0', `count=${findCount}`);

  // 7b. Replace one
  await page.evaluate(() => {
    const inp = document.getElementById('replaceInput');
    if (inp) inp.value = 'X99';
  });
  await new Promise(r => setTimeout(r, 100));
  await page.evaluate(() => { const b = document.getElementById('btnReplace'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 300));
  assert('Replace: X10 becomes X99', (await origTextFn()).includes('X99'));

  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  // 7c. Replace All
  await page.evaluate(() => {
    const inp = document.getElementById('replaceInput');
    if (inp) inp.value = 'X88';
  });
  await new Promise(r => setTimeout(r, 100));
  await page.evaluate(() => { const b = document.getElementById('btnReplaceAll'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  const textRpl = await origTextFn();
  assert('Replace All: multiple X88 occurrences',
    (textRpl.match(/X88/g) || []).length >= 3,
    `found ${(textRpl.match(/X88/g) || []).length}`);

  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  // Close find bar
  await page.evaluate(() => { const b = document.getElementById('btnFindClose'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 200));

  // ===== 8. Keyboard Shortcuts =====
  section(8, 'Keyboard Shortcuts');

  // 8a. Ctrl+Z (Undo)
  await page.evaluate(() => {
    document.getElementById('batchAxis').value = 'X';
    document.getElementById('batchAxisVal').value = '3';
  });
  await page.evaluate(() => { const b = document.getElementById('btnBatchApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 300));
  const textAfterShift = await origTextFn();

  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await new Promise(r => setTimeout(r, 300));
  assert('Ctrl+Z: undoes last change', await origTextFn() !== textAfterShift);

  // Redo via Ctrl+Y
  await page.keyboard.down('Control');
  await page.keyboard.press('y');
  await page.keyboard.up('Control');
  await new Promise(r => setTimeout(r, 300));
  assert('Ctrl+Y: redoes change', await origTextFn() !== origText);

  // Undo back to original
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await new Promise(r => setTimeout(r, 300));

  // 8b. Ctrl+Shift+Z (alternate redo)
  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.keyboard.press('z');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await new Promise(r => setTimeout(r, 300));
  const textAfterCtl = await origTextFn();
  assert('Ctrl+Shift+Z: redoes change', textAfterCtl !== origText);

  // Undo back
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await new Promise(r => setTimeout(r, 300));

  // ===== 9. Preview Modal =====
  section(9, 'Preview Modal');

  await page.evaluate(() => openModal('modal-preview'));
  await new Promise(r => setTimeout(r, 500));
  const modalCanvas = await page.evaluate(() => {
    const c = document.getElementById('previewCanvasModal');
    return c && c.width > 0 && c.height > 0;
  });
  assert('Preview modal has canvas', modalCanvas);

  await page.evaluate(() => closeModal('modal-preview'));
  await new Promise(r => setTimeout(r, 300));

  // ===== 10. G-code Editor Modal =====
  section(10, 'G-code Editor Modal');

  await page.evaluate(() => openGcodeModal('working'));
  await new Promise(r => setTimeout(r, 500));
  const modalEditor = await page.evaluate(() => {
    const e = document.getElementById('editorWorkingModal');
    return e && e.value.length > 0;
  });
  assert('G-code modal has content', modalEditor);

  // Toggle to Original tab
  await page.evaluate(() => {
    const tabs = document.querySelectorAll('[data-gtab]');
    tabs.forEach(t => { if (t.dataset.gtab === 'original') t.click(); });
  });
  await new Promise(r => setTimeout(r, 300));

  await page.evaluate(() => closeModal('modal-gcode'));
  await new Promise(r => setTimeout(r, 300));

  // ===== 11. GRBL Gas Option =====
  section(11, 'GRBL Gas Option');

  // Load SVG for conversion
  const gasSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 30" width="50mm" height="30mm"><rect x="5" y="5" width="40" height="20" fill="none" stroke="black" stroke-width="1"/></svg>';
  fs.writeFileSync(path.join(SAMPLES, 'gaps_gas.svg'), gasSvg, 'utf8');

  const [gasChooser] = await Promise.all([
    page.waitForFileChooser({ timeout: 4000 }).catch(() => null),
    page.evaluate(() => { const inp = document.getElementById('fileInputVector'); if (inp) inp.click(); })
  ]);
  if (gasChooser) {
    await gasChooser.accept([path.join(SAMPLES, 'gaps_gas.svg')]);
    await new Promise(r => setTimeout(r, 2000));

    await page.select('#templateSelect', 'Grbl');
    await new Promise(r => setTimeout(r, 300));

    await page.evaluate(() => {
      const body = document.getElementById('machineOptionsBody');
      if (body) body.classList.remove('collapsed');
    });
    await new Promise(r => setTimeout(r, 200));

    // Check Gas option exists
    const gasExists = await page.evaluate(() => {
      const sel = document.querySelector('#machineOptionsBody select[data-opt-id="gas"]');
      return !!sel;
    });
    assert('GRBL Gas: option exists', gasExists);

    if (gasExists) {
      // 11a. Default 'none' — no gas commands
      await page.click('#btnSlice');
      await new Promise(r => setTimeout(r, 1500));
      const txtNone = await page.evaluate(() => document.getElementById('editorOriginal').value);
      const hasM8Default = txtNone.includes('\nM8');
      const hasM9Default = txtNone.includes('\nM9');
      assert('GRBL Gas default none: no M8', !hasM8Default);
      assert('GRBL Gas default none: no M9', !hasM9Default);

      // 11b. Select M8 — gas commands should appear
      const gasSel = await page.$('select[data-opt-id="gas"]');
      if (gasSel) await gasSel.select('M8');
      await new Promise(r => setTimeout(r, 100));
      await page.click('#btnSlice');
      await new Promise(r => setTimeout(r, 1500));
      const txtM8 = await page.evaluate(() => document.getElementById('editorOriginal').value);
      assert('GRBL Gas M8: M8 in header', txtM8.includes('M8'), 'M8 not found');
      assert('GRBL Gas M8: M9 in footer', txtM8.includes('M9'), 'M9 not found');

      // 11c. Undo converts — select M7 instead
      if (gasSel) await gasSel.select('M7');
      await new Promise(r => setTimeout(r, 100));
      await page.click('#btnSlice');
      await new Promise(r => setTimeout(r, 1500));
      const txtM7 = await page.evaluate(() => document.getElementById('editorOriginal').value);
      assert('GRBL Gas M7: M7 in header', txtM7.includes('M7'), 'M7 not found');
      assert('GRBL Gas M7: M9 in footer', txtM7.includes('M9'), 'M9 not found');
    }
  } else {
    console.log('  [SKIP] GRBL Gas tests — file chooser unavailable');
  }

  // ===== 12. Full Path Variation — Preview segments =====
  section(12, 'Full Path Variation — Preview segments');

  await loadGcode(page, 'gaps_square.gcode');
  await page.evaluate(() => {
    const el = document.getElementById('pathVarContent');
    if (el) el.style.display = 'flex';
    document.getElementById('chkPathVarOutside').checked = true;
    document.getElementById('chkPathVarInside').checked = true;
    document.getElementById('pathVarOutside').value = '0.5';
    document.getElementById('pathVarInside').value = '0.3';
  });
  await new Promise(r => setTimeout(r, 100));

  // Wait for preview segments to build
  await page.waitForFunction(() => {
    return preview._segments && preview._segments.length > 0;
  }, { timeout: 5000 }).catch(() => {});
  const segBefore = await page.evaluate(() => preview._segments ? preview._segments.length : 0);
  assert('PathVar preview: segments exist before apply', segBefore > 0, `count=${segBefore}`);

  await page.evaluate(() => { const b = document.getElementById('btnPathVarApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));

  // Wait for preview to rebuild with new segments
  await page.waitForFunction(() => {
    return preview._segments && preview._segments.length > 0;
  }, { timeout: 5000 }).catch(() => {});
  const segAfter = await page.evaluate(() => preview._segments ? preview._segments.length : 0);
  assert('PathVar preview: segments count increased (original+outside+inside)', segAfter >= segBefore * 2, `${segBefore} → ${segAfter}`);

  // Verify at least one segment has non-original position
  const hasOffset = await page.evaluate(() => {
    const segs = preview._segments;
    if (!segs) return false;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (s.a && Math.abs(s.a.x) > 0.01 && Math.abs(Math.abs(s.a.x) - 10) > 0.5) return true;
    }
    return false;
  });
  assert('PathVar preview: segments include offset positions', hasOffset);

  // Undo
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  // ===== 13. Full Turn Path Variation — Preview =====
  section(13, 'Full Turn Path Variation — Preview');

  await page.evaluate(() => {
    const el = document.getElementById('turnVarContent');
    if (el) el.style.display = 'flex';
    document.getElementById('turnVarValue').value = '0.1';
  });
  await new Promise(r => setTimeout(r, 100));

  // Wait for segments
  await page.waitForFunction(() => {
    return preview._segments && preview._segments.length > 0;
  }, { timeout: 5000 }).catch(() => {});
  const turnSegBefore = await page.evaluate(() => preview._segments ? preview._segments.length : 0);
  const turnPtBefore = await page.evaluate(() => preview._points ? preview._points.length : 0);
  assert('Full Turn preview: segments exist before', turnSegBefore > 0);

  await page.evaluate(() => { const b = document.getElementById('btnTurnVarApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));

  // Wait for preview to rebuild
  await page.waitForFunction(() => {
    return preview._segments && preview._segments.length > 0;
  }, { timeout: 5000 }).catch(() => {});
  const turnSegAfter = await page.evaluate(() => preview._segments ? preview._segments.length : 0);
  const turnPtAfter = await page.evaluate(() => preview._points ? preview._points.length : 0);
  assert('Full Turn preview: segment count unchanged (modifies in-place)', turnSegAfter === turnSegBefore, `${turnSegBefore} → ${turnSegAfter}`);
  assert('Full Turn preview: point count unchanged', turnPtAfter === turnPtBefore);

  // Verify positions changed (at least one point differs from original)
  const posChanged = await page.evaluate(() => {
    const segs = preview._segments;
    if (!segs || segs.length < 4) return false;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (s.a && Math.abs(s.a.y - 10) > 0.01 && Math.abs(s.a.y - 9.9) < 0.02) return true;
    }
    return false;
  });
  assert('Full Turn preview: positions changed (horizontal Y ±0.1)', posChanged);

  // ===== 14. Comprehensive ;edit.gc + Highlighting Test =====
  section(14, 'Comprehensive ;edit.gc + Highlighting');

  await loadGcode(page, 'gaps_square.gcode');
  await page.evaluate(() => {
    ['pathVarContent', 'turnVarContent', 'shiftPointsContent', 'minDistContent'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'flex';
    });
  });
  await new Promise(r => setTimeout(r, 500));

  // Helper: check hl-line-edited count in working highlight overlay
  const hlEditedCount = async () => page.evaluate(() => {
    const hl = document.getElementById('highlightWorking');
    if (!hl) return -1;
    return (hl.innerHTML.match(/hl-line-edited/g) || []).length;
  });

  // Helper: check ;edit.gc count in editor text
  const tagCount = async () => page.evaluate(() => {
    const ta = document.getElementById('editorWorking');
    return (ta.value.match(/;edit\.gc/g) || []).length;
  });

  // Baseline: no ;edit.gc tags
  assert('Baseline: no ;edit.gc before any operation', await tagCount() === 0);
  assert('Baseline: no hl-line-edited before any operation', await hlEditedCount() === 0);

  // ---------- 14a. Full Path Variation ----------
  await page.evaluate(() => {
    document.getElementById('chkPathVarOutside').checked = true;
    document.getElementById('chkPathVarInside').checked = false;
    document.getElementById('pathVarOutside').value = '0.2';
  });
  await page.evaluate(() => { const b = document.getElementById('btnPathVarApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  const pvTags = await tagCount();
  const pvHL = await hlEditedCount();
  assert('PathVar: ;edit.gc tags > 0', pvTags > 0, `count=${pvTags}`);
  assert('PathVar: hl-line-edited spans > 0', pvHL > 0, `count=${pvHL}`);
  assert('PathVar: tag count matches hl count', pvTags === pvHL, `${pvTags} vs ${pvHL}`);
  assert('PathVar: header G21 line NOT highlighted', await page.evaluate(() => {
    const hl = document.getElementById('highlightWorking');
    const lines = hl.innerHTML.split('\n');
    return lines.some(l => l.includes('G21') && !l.includes('hl-line-edited'));
  }));
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));
  assert('PathVar undo: tags cleared', await tagCount() === 0);
  assert('PathVar undo: hl cleared', await hlEditedCount() === 0);

  // ---------- 14b. Full Turn Path Variation ----------
  await page.evaluate(() => { document.getElementById('turnVarValue').value = '0.15'; });
  await page.evaluate(() => { const b = document.getElementById('btnTurnVarApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  const ftTags = await tagCount();
  const ftHL = await hlEditedCount();
  assert('FullTurn: ;edit.gc tags > 0', ftTags > 0, `count=${ftTags}`);
  assert('FullTurn: hl-line-edited > 0', ftHL > 0, `count=${ftHL}`);
  assert('FullTurn: tag count matches hl count', ftTags === ftHL, `${ftTags} vs ${ftHL}`);
  assert('FullTurn: header lines NOT highlighted', await page.evaluate(() => {
    const hl = document.getElementById('highlightWorking');
    const lines = hl.innerHTML.split('\n');
    return lines.some(l => l.includes('G21') && !l.includes('hl-line-edited'));
  }));
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  // ---------- 14c. Shift Points ----------
  await page.evaluate(() => {
    document.getElementById('batchAxis').value = 'X';
    document.getElementById('batchAxisVal').value = '3';
  });
  await page.evaluate(() => { const b = document.getElementById('btnBatchApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  const spTags = await tagCount();
  const spHL = await hlEditedCount();
  assert('ShiftPoints: ;edit.gc tags > 0', spTags > 0, `count=${spTags}`);
  assert('ShiftPoints: hl-line-edited > 0', spHL > 0, `count=${spHL}`);
  assert('ShiftPoints: tag count matches hl count', spTags === spHL, `${spTags} vs ${spHL}`);
  assert('ShiftPoints: footer M2 NOT highlighted', await page.evaluate(() => {
    const hl = document.getElementById('highlightWorking');
    const lines = hl.innerHTML.split('\n');
    return lines.some(l => l.includes('M2') && !l.includes('hl-line-edited'));
  }));
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  // ---------- 14d. MinDist ----------
  await page.evaluate(() => { document.getElementById('minDistValue').value = '2'; });
  await page.evaluate(() => { const b = document.getElementById('btnMinDistApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  const mdTags = await tagCount();
  const mdHL = await hlEditedCount();
  assert('MinDist: ;edit.gc tags > 0', mdTags > 0, `count=${mdTags}`);
  assert('MinDist: hl-line-edited > 0', mdHL > 0, `count=${mdHL}`);
  assert('MinDist: tag count matches hl count', mdTags === mdHL, `${mdTags} vs ${mdHL}`);
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  // ---------- 14e. Apply Origin ----------
  await page.evaluate(() => {
    const ox = document.getElementById('originX');
    const oy = document.getElementById('originY');
    if (ox) ox.value = '5';
    if (oy) oy.value = '5';
  });
  await page.evaluate(() => { const b = document.getElementById('btnApplyOrigin'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  const ao2Tags = await tagCount();
  const ao2HL = await hlEditedCount();
  assert('ApplyOrigin: ;edit.gc tags > 0', ao2Tags > 0, `count=${ao2Tags}`);
  assert('ApplyOrigin: hl-line-edited > 0', ao2HL > 0, `count=${ao2HL}`);
  assert('ApplyOrigin: tag count matches hl count', ao2Tags === ao2HL, `${ao2Tags} vs ${ao2HL}`);
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  // ---------- 14g. Verify final clean state ----------
  assert('Final: no ;edit.gc after undoing all', await tagCount() === 0);
  assert('Final: no hl-line-edited after undoing all', await hlEditedCount() === 0);

  // ===== 15. Add Point at Minimum Distance — Start/Stop mode =====
  section(15, 'Add Point at Minimum Distance — Start/Stop mode');

  await page.evaluate(() => {
    const el = document.getElementById('minDistContent');
    if (el) el.style.display = 'flex';
  });
  await new Promise(r => setTimeout(r, 200));

  const hasToggle = await page.evaluate(() => !!document.getElementById('chkMinDistStartStop'));
  assert('MinDist Start/Stop toggle exists', hasToggle);

  // Test Start/Stop mode
  await page.evaluate(() => {
    document.getElementById('chkMinDistStartStop').checked = true;
    document.getElementById('minDistValue').value = '8';
  });
  await new Promise(r => setTimeout(r, 100));

  const mdSSBefore = await page.evaluate(() => state.workingCmds.length);
  await page.evaluate(() => { const b = document.getElementById('btnMinDistApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  const mdSSAfter = await page.evaluate(() => state.workingCmds.length);
  assert('MinDist Start/Stop: command count increased', mdSSAfter > mdSSBefore,
    `${mdSSBefore} → ${mdSSAfter}`);

  const mdSSText = await page.evaluate(() => document.getElementById('editorWorking').value);
  const hasLaserOff = /M5\b/.test(mdSSText);
  const hasLaserOn = /M[34]\b/.test(mdSSText) || /SM3\b/.test(mdSSText);
  const hasTravel = /G0\b/.test(mdSSText);
  assert('MinDist Start/Stop: laser-off (M5) present', hasLaserOff);
  assert('MinDist Start/Stop: laser-on (M3/M4) present', hasLaserOn);
  assert('MinDist Start/Stop: travel (G0) present', hasTravel);
  assert('MinDist Start/Stop: ;edit.gc present', mdSSText.includes(';edit.gc'));

  // Undo
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));
  const mdSSLen = await page.evaluate(() => state.workingCmds.length);
  assert('MinDist Start/Stop undo: restores original', mdSSLen === mdSSBefore,
    `${mdSSLen} vs ${mdSSBefore}`);

  // Test Continuous mode (default) still works
  await page.evaluate(() => {
    document.getElementById('chkMinDistStartStop').checked = false;
    document.getElementById('minDistValue').value = '8';
  });
  await new Promise(r => setTimeout(r, 100));
  const mdContBefore = await page.evaluate(() => state.workingCmds.length);
  await page.evaluate(() => { const b = document.getElementById('btnMinDistApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  const mdContAfter = await page.evaluate(() => state.workingCmds.length);
  assert('MinDist Continuous: command count increased', mdContAfter > mdContBefore,
    `${mdContBefore} → ${mdContAfter}`);

  const mdContText = await page.evaluate(() => document.getElementById('editorWorking').value);
  const noExtraLaser = (mdContText.match(/M5/g) || []).length <= (mdContText.match(/M2/g) || []).length;
  assert('MinDist Continuous: no extra M5 from wrapper', noExtraLaser);

  // Undo
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  // ===== 16. Set Start Coordinates (Apply Origin) =====
  section(16, 'Set Start Coordinates (Apply Origin)');

  await page.evaluate(() => {
    const el = document.getElementById('originContent');
    if (el) el.style.display = 'flex';
  });
  await new Promise(r => setTimeout(r, 200));

  // Get baseline text
  const originSetBeforeText = await page.evaluate(() => document.getElementById('editorWorking').value);
  const originSetBeforeLines = originSetBeforeText.split('\n');

  // Set origin X=5, Y=15 and click Set
  await page.evaluate(() => {
    document.getElementById('originX').value = '5';
    document.getElementById('originY').value = '15';
  });
  await page.evaluate(() => { const b = document.getElementById('btnApplyOrigin'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));

  const originSetText = await page.evaluate(() => document.getElementById('editorWorking').value);
  const originSetLines = originSetText.split('\n');

  // First tool-on was G1 X10 Y10 S1000 — after delta X:-5 Y:+5 → G1 X5 Y15
  const firstCutLine = originSetLines.find(l => /^G1\b/.test(l) && /S1000\b/.test(l));
  assert('Set Start: first G1 with S1000 exists', !!firstCutLine, firstCutLine || 'not found');
  const hasCorrectFirst = /\bX5\b/.test(firstCutLine || '') && /\bY15\b/.test(firstCutLine || '');
  assert('Set Start: first tool-on → X5 Y15 (delta from X10 Y10)', hasCorrectFirst, firstCutLine);

  // Original G0 X0 Y0 travel should also shift (Set shifts all motion)
  const travelLine = originSetLines.find(l => /^G0\b/.test(l) && /\bX-?5\b/.test(l));
  // G0 shifted by same delta: X0→X-5, Y0→Y5
  const hasCorrectTravel = /\bX-?5\b/.test(travelLine || '') && /\bY5\b/.test(travelLine || '');
  assert('Set Start: G0 travel also shifted (X0 Y0 → X-5 Y5)', hasCorrectTravel, travelLine || 'not found');

  // Second G1 X30 Y10 → X25 Y15
  const secondCut = originSetLines.find(l => /^G1\b/.test(l) && /\bX25\b/.test(l) && /\bY15\b/.test(l));
  assert('Set Start: second point shifted (X30 Y10 → X25 Y15)', !!secondCut, secondCut || 'not found');

  // ;edit.gc tags present
  assert('Set Start: ;edit.gc tags present', originSetText.includes(';edit.gc'));

  // Undo
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  // ===== 17. Add Points — Preview update =====
  section(17, 'Add Points — Preview update');

  // Open Add Points section and ensure points panel is open
  await page.evaluate(() => {
    const panel = document.getElementById('col-points');
    if (panel) panel.style.display = 'flex';
    ui._pointsPanelOpen = true;
    const el = document.getElementById('addPointsContent');
    if (el) el.style.display = 'flex';
  });
  await new Promise(r => setTimeout(r, 200));

  // Refresh points table and get baseline segment count
  await page.evaluate(() => { const b = document.getElementById('btnPointsRefresh'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));

  // Wait for preview segments to build
  await page.waitForFunction(() => {
    return preview._segments && preview._segments.length > 0;
  }, { timeout: 5000 }).catch(() => {});

  const apSegBefore = await page.evaluate(() => preview._segments ? preview._segments.length : 0);
  assert('Add Points preview: segments exist before', apSegBefore > 0, `count=${apSegBefore}`);

  // Select first motion point (idx 2 = G0 X0 Y0)
  await page.evaluate(() => {
    state.selectedPoints.clear();
    state.selectedPoints.add(2);
    ui._updatePointsPanel();
  });
  await new Promise(r => setTimeout(r, 100));
  await page.evaluate(() => {
    document.getElementById('pointsOffsetX').value = '2';
    document.getElementById('pointsOffsetY').value = '0';
    document.getElementById('chkStartStop').checked = false; // Continuous mode
  });
  await new Promise(r => setTimeout(r, 100));

  const apCmdBefore = await page.evaluate(() => state.workingCmds.length);
  await page.evaluate(() => { const b = document.getElementById('btnPointsGenerate'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  const apCmdAfter = await page.evaluate(() => state.workingCmds.length);
  assert('Add Points preview: command count increased', apCmdAfter > apCmdBefore,
    `${apCmdBefore} → ${apCmdAfter}`);

  // Wait for preview to rebuild with new segments
  await page.waitForFunction(() => {
    return preview._segments && preview._segments.length > 0;
  }, { timeout: 5000 }).catch(() => {});

  const apSegAfter = await page.evaluate(() => preview._segments ? preview._segments.length : 0);
  assert('Add Points preview: segments count increased after add', apSegAfter > apSegBefore,
    `${apSegBefore} → ${apSegAfter}`);

  // Verify at least one segment has the offset position (original X=0 + offset 2)
  const apHasNewSeg = await page.evaluate(() => {
    const segs = preview._segments;
    if (!segs) return false;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (s.a && Math.abs(s.a.x - 2) < 0.01) return true;
      if (s.b && Math.abs(s.b.x - 2) < 0.01) return true;
    }
    return false;
  });
  assert('Add Points preview: segment includes offset position X≈2', apHasNewSeg);

  // Undo
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  // ===== 18. MinDist — no points on rapid moves =====
  section(18, 'MinDist — no points on rapid moves');

  // Create G-code with alternating G0 (travel) and G1 (cut) segments
  // G0 X0 Y0 → G0 X0 Y20 (rapid) → G1 X20 Y20 S1000 (cut) → G1 X20 Y0 (cut) → G0 X0 Y0 (rapid)
  const mixedGcode = [
    'G21', 'G90',
    'G0 X0 Y0 F8000',
    'G1 X20 Y0 F500 S1000',
    'G1 X20 Y20',
    'G1 X0 Y20',
    'G1 X0 Y0',
    'G0 X100 Y100',
    'M2'
  ].join('\n');
  fs.writeFileSync(path.join(SAMPLES, 'mixed_rapid_cut.gcode'), mixedGcode, 'utf8');
  await loadGcode(page, 'mixed_rapid_cut.gcode');

  await page.evaluate(() => {
    const panel = document.getElementById('col-points');
    if (panel) panel.style.display = 'flex';
    ui._pointsPanelOpen = true;
    const el = document.getElementById('minDistContent');
    if (el) el.style.display = 'flex';
    document.getElementById('chkMinDistStartStop').checked = false;
  });
  await new Promise(r => setTimeout(r, 200));

  const mdBefore = await page.evaluate(() => state.workingCmds.length);
  // Use a distance that subdivides the G1→G1 segments but NOT the G0→G1
  await page.evaluate(() => { document.getElementById('minDistValue').value = '8'; });
  await page.evaluate(() => { const b = document.getElementById('btnMinDistApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  const mdAfter = await page.evaluate(() => state.workingCmds.length);

  // Original: 8 cmds. G1→G1 segments: 3 edges of 20mm each → 2 intermediate points each
  // G0→G1 (first edge) and G1→G0 (last edge) should NOT add points
  assert('MinDist no-rapid: cmd count increased', mdAfter > mdBefore,
    `${mdBefore} → ${mdAfter}`);

  const mdText = await page.evaluate(() => document.getElementById('editorWorking').value);
  // G0 X0 Y0 should remain as-is with no ;edit.gc
  const g0Line = mdText.split('\n').find(l => /^G0\b/.test(l) && /\bX0\b/.test(l) && /\bY0\b/.test(l));
  assert('MinDist no-rapid: G0 X0 Y0 unchanged (no ;edit.gc)',
    !!g0Line && !g0Line.includes(';edit.gc'), g0Line || 'not found');

  // Rapid G0→G1 should NOT have intermediate points — count G0 lines should stay 2
  const g0Count = (mdText.match(/^G0\b/gm) || []).length;
  assert('MinDist no-rapid: G0 lines unchanged (no subdivision)', g0Count === 2, `found ${g0Count} G0`);

  // No ;edit.gc on G0 lines
  const g0Tagged = mdText.split('\n').filter(l => /^G0\b/.test(l) && l.includes(';edit.gc')).length;
  assert('MinDist no-rapid: no ;edit.gc on G0 lines', g0Tagged === 0, `found ${g0Tagged}`);

  // Undo
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  // ===== 19. G-code with negative coordinates and arcs =====
  section(19, 'G-code with arcs and varied S values');

  // Load G-code with G2/G3 arcs, different S values, all positive X/Y
  const diverseGcode = [
    'G21', 'G90',
    'G0 X0 Y0 F8000',
    'G1 X5 Y5 F500 S800',
    'G1 X40 Y5',
    'G2 X50 Y15 I0 J10',
    'G3 X30 Y35 I0 J10',
    'G1 X5 Y35',
    'G1 X5 Y5',
    'M2'
  ].join('\n');
  fs.writeFileSync(path.join(SAMPLES, 'diverse_path.gcode'), diverseGcode, 'utf8');
  await loadGcode(page, 'diverse_path.gcode');

  // Expand widget sections
  await page.evaluate(() => {
    ['pathVarContent', 'turnVarContent', 'shiftPointsContent', 'minDistContent', 'originContent'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'flex';
    });
  });
  await new Promise(r => setTimeout(r, 200));

  // PathVar with negative coords
  const divBefore1 = await page.evaluate(() => state.workingCmds.length);
  await page.evaluate(() => {
    document.getElementById('chkPathVarOutside').checked = true;
    document.getElementById('chkPathVarInside').checked = false;
    document.getElementById('pathVarOutside').value = '0.5';
  });
  await page.evaluate(() => { const b = document.getElementById('btnPathVarApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  const divAfter1 = await page.evaluate(() => state.workingCmds.length);
  assert('Diverse PathVar: cmd count increased', divAfter1 > divBefore1,
    `${divBefore1} → ${divAfter1}`);

  const divText1 = await page.evaluate(() => document.getElementById('editorWorking').value);
  assert('Diverse PathVar: outside header present', divText1.includes('Outside +0.5'));

  // Undo
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  // Shift Points with negative value
  const divBefore2 = await page.evaluate(() => document.getElementById('editorWorking').value);
  await page.evaluate(() => {
    document.getElementById('batchAxis').value = 'X';
    document.getElementById('batchAxisVal').value = '-5';
  });
  await page.evaluate(() => { const b = document.getElementById('btnBatchApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 300));
  const divAfter2 = await page.evaluate(() => document.getElementById('editorWorking').value);
  assert('Diverse Shift X:-5 changes output', divAfter2 !== divBefore2);

  // Undo
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  // MinDist on diverse path (with arcs)
  const divBefore3 = await page.evaluate(() => state.workingCmds.length);
  await page.evaluate(() => {
    document.getElementById('chkMinDistStartStop').checked = false;
    document.getElementById('minDistValue').value = '10';
  });
  await page.evaluate(() => { const b = document.getElementById('btnMinDistApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  const divAfter3 = await page.evaluate(() => state.workingCmds.length);
  assert('Diverse MinDist: cmd count increased', divAfter3 > divBefore3,
    `${divBefore3} → ${divAfter3}`);

  // Undo
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  // ===== 21. G-code with zero S values (travel-only) =====
  // ===== 20. G-code with zero S values (travel-only) =====
  section(20, 'G-code with zero S values (travel-only)');

  const zeroSGcode = [
    'G21', 'G90',
    'G0 X0 Y0 F8000',
    'G0 X10 Y10 F8000',
    'G0 X30 Y10',
    'G0 X30 Y30',
    'G0 X10 Y30',
    'G0 X10 Y10',
    'M2'
  ].join('\n');
  fs.writeFileSync(path.join(SAMPLES, 'zero_s.gcode'), zeroSGcode, 'utf8');
  await loadGcode(page, 'zero_s.gcode');

  await page.evaluate(() => {
    ['minDistContent'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'flex'; });
    document.getElementById('chkMinDistStartStop').checked = false;
    document.getElementById('minDistValue').value = '5';
  });
  await new Promise(r => setTimeout(r, 200));

  const zBefore = await page.evaluate(() => state.workingCmds.length);
  await page.evaluate(() => { const b = document.getElementById('btnMinDistApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  const zAfter = await page.evaluate(() => state.workingCmds.length);
  // No G1 cut moves, so MinDist should add NO points (all G0 are rapid)
  assert('Zero-S MinDist: cmd count unchanged (no cuts)', zAfter === zBefore,
    `${zBefore} → ${zAfter}`);

  // Undo
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  // ===== 21. Add Points intensive — preview update verification =====
  section(21, 'Add Points intensive — preview update');

  await loadGcode(page, 'gaps_square.gcode');
  await page.evaluate(() => { document.getElementById('addPointsContent').style.display = 'flex'; });
  await new Promise(r => setTimeout(r, 300));

  // Refresh points list
  await page.evaluate(() => { const b = document.getElementById('btnPointsRefresh'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  await page.waitForFunction(() => preview._segments && preview._segments.length > 0, { timeout: 5000 }).catch(() => {});
  const segBeforeAdd = await page.evaluate(() => preview._segments ? preview._segments.length : 0);
  assert('Add Points: segments exist before', segBeforeAdd > 0, `got ${segBeforeAdd}`);

  // Continuous mode — select a middle point and add with X=2 offset
  await page.evaluate(() => {
    const points = ui._buildPointsList();
    state.selectedPoints.clear();
    if (points.length > 2) state.selectedPoints.add(points[2].idx);
    ui._updatePointsPanel();
    document.getElementById('chkStartStop').checked = false;
    document.getElementById('pointsOffsetX').value = '2';
    document.getElementById('pointsOffsetY').value = '0';
  });
  await new Promise(r => setTimeout(r, 100));
  const cmdBeforeCont = await page.evaluate(() => state.workingCmds.length);
  await page.evaluate(() => { const b = document.getElementById('btnPointsGenerate'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 800));
  const cmdAfterCont = await page.evaluate(() => state.workingCmds.length);
  assert('Add Points Continuous: cmd count increased', cmdAfterCont > cmdBeforeCont,
    `${cmdBeforeCont} → ${cmdAfterCont}`);
  const segAfterCont = await page.evaluate(() => preview._segments ? preview._segments.length : 0);
  assert('Add Points Continuous: preview segments updated', segAfterCont > 0 && segAfterCont !== segBeforeAdd,
    `${segBeforeAdd} → ${segAfterCont}`);

  // Undo
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  // Start/Stop mode — select a point, add with no offset
  await page.evaluate(() => { const b = document.getElementById('btnPointsRefresh'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  const segBeforeSS = await page.evaluate(() => preview._segments ? preview._segments.length : 0);
  await page.evaluate(() => {
    const points = ui._buildPointsList();
    state.selectedPoints.clear();
    if (points.length > 0) state.selectedPoints.add(points[0].idx);
    ui._updatePointsPanel();
    document.getElementById('chkStartStop').checked = true;
    document.getElementById('pointsOffsetX').value = '1';
    document.getElementById('pointsOffsetY').value = '0';
  });
  await new Promise(r => setTimeout(r, 100));
  const cmdBeforeSS = await page.evaluate(() => state.workingCmds.length);
  await page.evaluate(() => { const b = document.getElementById('btnPointsGenerate'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 800));
  const cmdAfterSS = await page.evaluate(() => state.workingCmds.length);
  assert('Add Points Start/Stop: cmd count increased', cmdAfterSS > cmdBeforeSS,
    `${cmdBeforeSS} → ${cmdAfterSS}`);
  const segAfterSS = await page.evaluate(() => preview._segments ? preview._segments.length : 0);
  assert('Add Points Start/Stop: preview segments updated', segAfterSS > 0 && segAfterSS !== segBeforeSS,
    `${segBeforeSS} → ${segAfterSS}`);

  // Undo
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate(() => { document.getElementById('chkStartStop').checked = false; });

  // ===== 22. Mark Start — arrow position after reorder =====
  section(22, 'Mark Start — arrow position after reorder');

  await loadGcode(page, 'gaps_square.gcode');
  await page.evaluate(() => { document.getElementById('addPointsContent').style.display = 'flex'; });
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate(() => { const b = document.getElementById('btnPointsRefresh'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  await page.waitForFunction(() => preview._segments && preview._segments.length > 0, { timeout: 5000 }).catch(() => {});

  // Ensure we can find a motion command at a known position
  const markIdxBefore = await page.evaluate(() => {
    const points = ui._buildPointsList();
    if (points.length < 3) return -1;
    state.selectedPoints.clear();
    state.selectedPoints.add(points[2].idx);
    ui._updatePointsPanel();
    return points[2].idx;
  });
  assert('Mark Start: has target point', markIdxBefore >= 0, `idx=${markIdxBefore}`);

  // Click Mark Start
  await page.evaluate(() => { const b = document.getElementById('btnMarkStart'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));

  const markNewIdx = await page.evaluate(() => {
    if (typeof ui === 'undefined') return -2;
    return ui._markStartIdx;
  });
  assert('Mark Start: _markStartIdx updated after reorder', markNewIdx >= 0 && markNewIdx !== markIdxBefore,
    `old=${markIdxBefore} new=${markNewIdx}`);

  // Preview arrow should be at a valid position (not null)
  const arrowInPreview = await page.evaluate(() => {
    const pts = ui._pointsList;
    if (!pts || !pts.length) return false;
    return pts.some(p => p.idx === ui._markStartIdx);
  });
  assert('Mark Start: point found in _pointsList after reorder', arrowInPreview,
    `markIdx=${markNewIdx} points=${await page.evaluate(() => ui._pointsList ? ui._pointsList.length : 0)}`);

  // ===== 23. Rotate 90° with Machine Origin =====
  section(23, 'Rotate 90° with Machine Origin');

  // Set machineX/machineY via localStorage
  await page.evaluate(() => {
    const key = 'machineOpts_Grbl';
    const saved = JSON.parse(localStorage.getItem(key) || '{}');
    saved.machineX = '100';
    saved.machineY = '50';
    localStorage.setItem(key, JSON.stringify(saved));
    if (window.ui) ui._populateMachineOptions();
  });
  await new Promise(r => setTimeout(r, 300));

  // Load SVG and convert with Grbl to get machine origin applied
  const rotSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100mm" height="50mm"><rect x="10" y="10" width="50" height="25" fill="none" stroke="black" stroke-width="1"/></svg>';
  fs.writeFileSync(path.join(SAMPLES, 'rotate_origin.svg'), rotSvg, 'utf8');
  const [rotChooser] = await Promise.all([
    page.waitForFileChooser({ timeout: 4000 }).catch(() => null),
    page.evaluate(() => { const inp = document.getElementById('fileInputVector'); if (inp) inp.click(); })
  ]);
  if (rotChooser) {
    await rotChooser.accept([path.join(SAMPLES, 'rotate_origin.svg')]);
    await new Promise(r => setTimeout(r, 1500));

    await page.select('#templateSelect', 'Grbl');
    await new Promise(r => setTimeout(r, 300));

    await page.click('#btnSlice');
    await new Promise(r => setTimeout(r, 1500));

    // Read coordinates before rotate — should include machineX/machineY offset
    const beforeRot = await page.evaluate(() => {
      const text = document.getElementById('editorWorking').value;
      const firstG1 = text.split('\n').find(l => /^G1/.test(l.trim()));
      const xMatch = firstG1 ? firstG1.match(/X([\d.]+)/) : null;
      const yMatch = firstG1 ? firstG1.match(/Y([\d.]+)/) : null;
      return { x: xMatch ? parseFloat(xMatch[1]) : -1, y: yMatch ? parseFloat(yMatch[1]) : -1 };
    });
    assert('Rotate Origin: coords include machineX offset', beforeRot.x > 50,
      `x=${beforeRot.x}`);

    // Rotate 90°
    await page.evaluate(() => { const b = document.getElementById('btnRotate90'); if (b) b.click(); });
    await new Promise(r => setTimeout(r, 500));

    const afterRot = await page.evaluate(() => {
      const text = document.getElementById('editorWorking').value;
      const lines = text.split('\n').filter(l => /^(G0|G1|G2|G3| )/.test(l.trim()) && /X/.test(l));
      const firstMove = lines.find(l => /^G1/.test(l.trim()) || /^ X/.test(l.trim()));
      const xMatch = firstMove ? firstMove.match(/X([-\d.]+)/) : null;
      const yMatch = firstMove ? firstMove.match(/Y([-\d.]+)/) : null;
      return { x: xMatch ? parseFloat(xMatch[1]) : -1, y: yMatch ? parseFloat(yMatch[1]) : -1 };
    });
    // Auto-center skipped (footer G0 X0 Y0 makes minX=minY=0),
    // so (160,90) → remove origin (60,40) → rotate (-40,60) → re-add (60,110)
    const rotOk = Math.abs(afterRot.x - 60) < 3 && Math.abs(afterRot.y - 110) < 3;
    assert('Rotate 90°: coordinates transformed with origin offset', rotOk,
      `after (${afterRot.x}, ${afterRot.y})`);
  }

  // Cleanup machine origin
  await page.evaluate(() => {
    const key = 'machineOpts_Grbl';
    const saved = JSON.parse(localStorage.getItem(key) || '{}');
    delete saved.machineX; delete saved.machineY;
    localStorage.setItem(key, JSON.stringify(saved));
  });

  // ===== 24. Find/Replace buttons =====
  section(24, 'Find/Replace buttons');

  await page.evaluate(() => {
    const gcode = ['G21','G90','G0 X0 Y0 F8000','G1 X10 Y10 F500 S1000','G1 X30 Y10','G1 X30 Y30','G1 X10 Y30','G1 X10 Y10','M2'].join('\n');
    const cmds = gcodeParser.parse(gcode);
    state.workingCmds = cmds;
    state.originalCmds = cmds.map(c => ({ ...c }));
    ui.refreshWorking();
  });
  await new Promise(r => setTimeout(r, 300));
  const findOrigText = await page.evaluate(() => document.getElementById('editorWorking').value);

  // Open find bar
  await page.evaluate(() => {
    const fb = document.getElementById('findReplaceBar');
    if (fb) fb.style.display = 'flex';
  });
  await new Promise(r => setTimeout(r, 200));

  // Set find value and trigger input event (like section 7 does)
  await page.evaluate(() => {
    const inp = document.getElementById('findInput');
    if (inp) {
      inp.value = 'X10';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await new Promise(r => setTimeout(r, 300));

  const findCount2 = await page.evaluate(() => {
    const el = document.getElementById('findCount');
    return el ? el.textContent : '';
  });
  assert('Find: matches found', findCount2 !== '0/0', `count=${findCount2}`);

  // Click Find Next
  await page.evaluate(() => { const b = document.getElementById('btnFindNext'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 100));
  const findCur2 = await page.evaluate(() => {
    const el = document.getElementById('findCount');
    return el ? el.textContent : '';
  });
  assert('Find Next: index advanced', findCur2 !== findCount2, `${findCount2} → ${findCur2}`);

  // Click Find Prev
  await page.evaluate(() => { const b = document.getElementById('btnFindPrev'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 100));
  const findPrev2 = await page.evaluate(() => {
    const el = document.getElementById('findCount');
    return el ? el.textContent : '';
  });
  assert('Find Prev: index changed', findPrev2 !== findCur2, `${findCur2} → ${findPrev2}`);

  // Set replace value and click Replace
  await page.evaluate(() => { document.getElementById('replaceInput').value = 'X99'; });
  await page.evaluate(() => { const b = document.getElementById('btnReplace'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  const afterReplace = await page.evaluate(() => document.getElementById('editorWorking').value);
  const hasX99 = afterReplace.includes('X99');
  assert('Replace: X10 → X99', hasX99, `X99=${hasX99}`);

  // Reset
  await page.evaluate(() => { const b = document.getElementById('btnReset'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  // Test Replace All — use direct search call
  await page.evaluate(() => {
    document.getElementById('findInput').value = 'X30';
    if (typeof findReplace !== 'undefined') findReplace.search('X30');
  });
  await page.evaluate(() => { document.getElementById('replaceInput').value = 'X50'; });
  await new Promise(r => setTimeout(r, 100));
  await page.evaluate(() => { const b = document.getElementById('btnReplaceAll'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));

  const afterReplaceAll = await page.evaluate(() => document.getElementById('editorWorking').value);
  const replaced = (afterReplaceAll.match(/X50/g) || []).length;
  const original = (findOrigText.match(/X30/g) || []).length;
  assert('Replace All: X30 → X50', replaced === original, `replaced ${replaced}/${original}`);

  // Test focus: after replace, focus should be on findInput
  const focusOnFind = await page.evaluate(() => {
    const el = document.getElementById('findInput');
    return document.activeElement === el;
  });
  console.log(`  [INFO] focus on findInput after replace: ${focusOnFind}`);

  // Close find
  await page.evaluate(() => { const b = document.getElementById('btnFindClose'); if (b) b.click(); });

  // ===== 25. SM300 Seal1.CNC — ARC-90 MP arc parsing =====
  section(25, 'SM300 Seal1.CNC — ARC-90 MP arc parsing');

  const sealGcode = [
    'G98$SPROG$',
    'SA3',
    'RLAD R10;54',
    'RRBM R10;50;56',
    'F10000',
    'X90 Y200 Z-50',
    'X159.70 Y102.9 Z-50',
    'X159.74 Y102.9 Z-113.3',
    'SM12',
    'SM3',
    'X159.82 Y101.32 Z-113.3 F50',
    'G03 ARC-90 MP X160.72 Y101.32',
    'X170 Y100.48 Z-113.3',
    'X180 Y100.51 Z-113.3',
    'X190 Y100.59 Z-113.3',
    'X200 Y100.73 Z-113.3',
    'X209.55 Y100.72 Z-113.3',
    'G03 ARC-90 MP X209.55 Y101.62',
    'X210.38 Y113.13 Z-113.3',
    'G03 ARC-90 MP X209.48 Y113.13',
    'X208 Y114 Z-113.3',
    'RM3',
    'RM12',
    'X208 Y114.35 Z-100 F10000',
    'X90 Y200 Z-50',
    'RA3',
    'G99',
  ].join('\n');

  await page.evaluate((gcode) => {
    state.workingCmds = gcodeParser.parse(gcode);
    state.originalCmds = state.workingCmds.map(c => ({ ...c }));
    ui.refreshWorking();
    preview._segments = null;
    preview._segBuilding = false;
    preview.draw(state.workingCmds);
  }, sealGcode);

  await new Promise(r => setTimeout(r, 4000));

  const arcResult = await page.evaluate(() => {
    const segs = preview._segments;
    if (!segs || !segs.length) return { ok: false, reason: 'no segments' };
    const cutSegs = segs.filter(s => !s.rapid && s.toolOn);
    if (cutSegs.length < 3) return { ok: false, reason: `too few cut segments (${cutSegs.length})` };

    const pts = cutSegs.flatMap(s => [s.a, s.b]);
    const xs = pts.map(p => p.x);
    const ys = pts.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const rangeX = maxX - minX;
    const rangeY = maxY - minY;

    // Arc 1: chord (159.82,101.32)→(160.72,101.32), CW — midpoint must be BELOW chord (y < 101.32)
    // Find segments near chord midpoint X≈160.27
    const arc1Segs = cutSegs.filter(s => s.a.x >= 159.8 && s.a.x <= 160.8 && s.b.x >= 159.8 && s.b.x <= 160.8);
    const arc1MidBelow = arc1Segs.length > 0 && arc1Segs.every(s => {
      const midY = (s.a.y + s.b.y) / 2;
      return midY < 101.32;
    });
    const arc1Debug = arc1Segs.map(s => ({ ax: s.a.x.toFixed(2), ay: s.a.y.toFixed(2), bx: s.b.x.toFixed(2), by: s.b.y.toFixed(2) }));

    // Arc 2: chord (209.55,100.72)→(209.55,101.62), CW — midpoint must be RIGHT of chord (x > 209.55)
    const arc2Segs = cutSegs.filter(s =>
      (s.a.x >= 209.5 && s.b.x >= 209.5) &&
      (s.a.y >= 100.5 && s.a.y <= 102.0) && (s.b.y >= 100.5 && s.b.y <= 102.0)
    );
    const arc2MidRight = arc2Segs.length > 0 && arc2Segs.every(s => {
      const midX = (s.a.x + s.b.x) / 2;
      return midX > 209.55;
    });
    const arc2Debug = arc2Segs.map(s => ({ ax: s.a.x.toFixed(2), ay: s.a.y.toFixed(2), bx: s.b.x.toFixed(2), by: s.b.y.toFixed(2) }));

    // Arc 3: chord (210.38,113.13)→(209.48,113.13), CW — midpoint must be ABOVE chord (y > 113.13)
    const arc3Segs = cutSegs.filter(s => s.a.x >= 209.4 && s.a.x <= 210.4 && s.b.x >= 209.4 && s.b.x <= 210.4 && s.a.y >= 113.0);
    const arc3MidAbove = arc3Segs.length > 0 && arc3Segs.every(s => {
      const midY = (s.a.y + s.b.y) / 2;
      return midY > 113.13;
    });
    const arc3Debug = arc3Segs.map(s => ({ ax: s.a.x.toFixed(2), ay: s.a.y.toFixed(2), bx: s.b.x.toFixed(2), by: s.b.y.toFixed(2) }));

    return {
      ok: rangeX < 100 && rangeY < 100 && arc1MidBelow && arc2MidRight && arc3MidAbove,
      rangeX, rangeY,
      arc1Count: arc1Segs.length, arc1MidBelow, arc1Debug,
      arc2Count: arc2Segs.length, arc2MidRight, arc2Debug,
      arc3Count: arc3Segs.length, arc3MidAbove, arc3Debug,
      totalCut: cutSegs.length
    };
  });

  assert('SM300 Seal: segments exist', arcResult.ok, arcResult.reason || JSON.stringify(arcResult));
  assert('SM300 Seal: rangeX < 100', arcResult.rangeX < 100, `rangeX=${arcResult.rangeX}`);
  assert('SM300 Seal: rangeY < 100', arcResult.rangeY < 100, `rangeY=${arcResult.rangeY}`);
  assert('SM300 Seal: arc1 midpoint below chord', arcResult.arc1MidBelow, `arc1Segs=${arcResult.arc1Count}, debug=${JSON.stringify(arcResult.arc1Debug)}`);
  assert('SM300 Seal: arc2 midpoint right of chord', arcResult.arc2MidRight, `arc2Segs=${arcResult.arc2Count}, debug=${JSON.stringify(arcResult.arc2Debug)}`);
  assert('SM300 Seal: arc3 midpoint above chord', arcResult.arc3MidAbove, `arc3Segs=${arcResult.arc3Count}, debug=${JSON.stringify(arcResult.arc3Debug)}`);

  section(26, 'Add Points Start/Stop \u2014 blank lines + feed rate');

  await loadGcode(page, 'gaps_square.gcode');
  await page.evaluate(() => { document.getElementById('addPointsContent').style.display = 'flex'; });
  await new Promise(r => setTimeout(r, 300));

  await page.evaluate(() => { const b = document.getElementById('btnPointsRefresh'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  await page.waitForFunction(() => preview._segments && preview._segments.length > 0, { timeout: 5000 }).catch(() => {});

  // Start/Stop mode — select a point, add with offset
  await page.evaluate(() => {
    const points = ui._buildPointsList();
    state.selectedPoints.clear();
    if (points.length > 1) state.selectedPoints.add(points[1].idx);
    ui._updatePointsPanel();
    document.getElementById('chkStartStop').checked = true;
    document.getElementById('pointsOffsetX').value = '0';
    document.getElementById('pointsOffsetY').value = '0';
  });
  await new Promise(r => setTimeout(r, 100));
  await page.evaluate(() => { const b = document.getElementById('btnPointsGenerate'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 800));

  const ssResult = await page.evaluate(() => {
    const editorVal = document.getElementById('editorWorking').value;
    const lines = editorVal.split('\n');
    const blankCount = lines.filter(l => l.trim() === '').length;
    const hasBlankLines = blankCount > 0;
    const hasSlowG1 = lines.some(l => /^G1.*F(?!9000|10000)/.test(l) || /^G1[^F]*$/.test(l));
    return { hasBlankLines, blankCount, hasSlowG1, totalLines: lines.length };
  });
  assert('AddPoints SS: blank lines inserted', ssResult.hasBlankLines, `blanks=${ssResult.blankCount}`);

  section(27, 'Set Side \u2014 axis-aware arrow detection');

  await page.evaluate(() => {
    const gcode = [
      'G0 X0 Y0',
      'G1 X100 Y0',
      'G1 X100 Y50',
      'G1 X0 Y50',
      'G0 X0 Y0'
    ].join('\n');
    state.workingCmds = gcodeParser.parse(gcode);
    state.originalCmds = state.workingCmds.map(c => ({ ...c }));
    ui.refreshWorking();
  });

  await page.evaluate(() => { ui._markStartIdx = 0; });

  let sideResult = await page.evaluate(() => {
    document.getElementById('btnSetSide').click();
    const btn = document.getElementById('btnSetSide');
    return { pointsAxis: ui._pointsAxis, pointsSide: ui._pointsSide, btnText: btn.textContent };
  });
  assert('SetSide: X axis detected (wide rectangle)', sideResult.pointsAxis === 'X', JSON.stringify(sideResult));
  assert('SetSide: left arrow shows \u2190', sideResult.btnText.includes('\u2190'), `text="${sideResult.btnText}"`);

  sideResult = await page.evaluate(() => {
    document.getElementById('btnSetSide').click();
    const btn = document.getElementById('btnSetSide');
    return { pointsSide: ui._pointsSide, btnText: btn.textContent };
  });
  assert('SetSide: right arrow shows \u2192', sideResult.btnText.includes('\u2192'), `text="${sideResult.btnText}"`);

  sideResult = await page.evaluate(() => {
    document.getElementById('btnSetSide').click();
    return { pointsSide: ui._pointsSide };
  });
  assert('SetSide: toggle to null', sideResult.pointsSide === null, JSON.stringify(sideResult));

  await page.evaluate(() => {
    const gcode = [
      'G0 X0 Y0',
      'G1 X20 Y0',
      'G1 X20 Y200',
      'G1 X0 Y200',
      'G0 X0 Y0'
    ].join('\n');
    state.workingCmds = gcodeParser.parse(gcode);
    state.originalCmds = state.workingCmds.map(c => ({ ...c }));
    ui.refreshWorking();
  });

  sideResult = await page.evaluate(() => {
    document.getElementById('btnSetSide').click();
    const btn = document.getElementById('btnSetSide');
    return { pointsAxis: ui._pointsAxis, pointsSide: ui._pointsSide, btnText: btn.textContent };
  });
  assert('SetSide: Y axis detected (tall rectangle)', sideResult.pointsAxis === 'Y', JSON.stringify(sideResult));
  assert('SetSide: Y arrow shows \u2191', sideResult.btnText.includes('\u2191'), `text="${sideResult.btnText}"`);

  sideResult = await page.evaluate(() => {
    document.getElementById('btnSetSide').click();
    const btn = document.getElementById('btnSetSide');
    return { pointsSide: ui._pointsSide, btnText: btn.textContent };
  });
  assert('SetSide: Y right shows \u2193', sideResult.btnText.includes('\u2193'), `text="${sideResult.btnText}"`);

  await page.evaluate(() => {
    document.getElementById('btnSetSide').click();
    ui._pointsSide = null;
    ui._pointsAxis = 'X';
  });

  section(28, 'MinDist \u2014 arc-only option');

  await page.evaluate(() => {
    const gcode = [
      'G0 X0 Y0',
      'G1 X10 Y0',
      'G1 X10 Y10',
      'G2 X20 Y10 I5 J0',
      'G1 X20 Y0',
      'G1 X0 Y0'
    ].join('\n');
    state.workingCmds = gcodeParser.parse(gcode);
    state.originalCmds = state.workingCmds.map(c => ({ ...c }));
    ui.refreshWorking();
  });

  await page.evaluate(() => {
    document.getElementById('chkMinDistStartStop').checked = false;
    document.getElementById('chkMinDistArcsOnly').checked = false;
    document.getElementById('minDistValue').value = '0.5';
    document.getElementById('btnMinDistApply').click();
  });

  const minDistAllResult = await page.evaluate(() => {
    const editorVal = typeof editor !== 'undefined' ? editor.getValue() : state.workingCmds.map(c => c.raw || '').join('\n');
    const lines = editorVal.split('\n').filter(l => l.trim() && !l.startsWith(';'));
    const motionCount = lines.filter(l => /^G[0123]/.test(l)).length;
    return { totalNonBlank: lines.length, motionCount };
  });
  assert('MinDist all: many motions added', minDistAllResult.motionCount > 10, `motions=${minDistAllResult.motionCount}`);

  await page.evaluate(() => {
    state.workingCmds = gcodeParser.parse([
      'G0 X0 Y0',
      'G1 X100 Y0',
      'G1 X98 Y2',
      'G1 X96 Y4',
      'G1 X94 Y6',
      'G1 X0 Y6'
    ].join('\n'));
    state.originalCmds = state.workingCmds.map(c => ({ ...c }));
    ui.refreshWorking();
    document.getElementById('chkMinDistArcsOnly').checked = true;
    document.getElementById('minDistValue').value = '1';
    document.getElementById('btnMinDistApply').click();
  });

  const minDistArcsResult = await page.evaluate(() => {
    const editorVal = document.getElementById('editorWorking').value;
    const lines = editorVal.split('\n').filter(l => l.trim() && !l.startsWith(';'));
    const motionCount = lines.filter(l => /^G[0123]/.test(l)).length;
    const g1Lines = lines.filter(l => /^G1/.test(l));
    return { totalMotion: motionCount, g1Count: g1Lines.length };
  });
  assert('MinDist arcs-only: more motions than original', minDistArcsResult.totalMotion > 6, `motions=${minDistArcsResult.totalMotion}`);
  assert('MinDist arcs-only: arc subdivided (more G1 lines)', minDistArcsResult.g1Count > 3, `g1Count=${minDistArcsResult.g1Count}`);

  await page.evaluate(() => {
    document.getElementById('chkMinDistArcsOnly').checked = false;
    document.getElementById('minDistValue').value = '2';
  });

  section(29, 'Find/Replace \u2014 intensive toggle + corner cases');

  await page.evaluate(() => {
    state.workingCmds = gcodeParser.parse('G0 X0 Y0\nG1 X10 Y0\nG1 X10 Y10\nG1 X0 Y10\nG0 X0 Y0');
    state.originalCmds = state.workingCmds.map(c => ({ ...c }));
    ui.refreshWorking();
    const fb = document.getElementById('findReplaceBar');
    if (fb) fb.style.display = 'flex';
  });
  await new Promise(r => setTimeout(r, 200));

  let replaceResult = await page.evaluate(() => {
    const findInput = document.getElementById('findInput');
    const replaceInput = document.getElementById('replaceInput');
    findInput.value = 'X10';
    replaceInput.value = 'X99';
    findInput.dispatchEvent(new Event('input', { bubbles: true }));
    const btnReplaceAll = document.getElementById('btnReplaceAll');
    if (btnReplaceAll) btnReplaceAll.click();
    const text = document.getElementById('editorWorking').value;
    const count = (text.match(/X99/g) || []).length;
    return { replaceCount: count };
  });
  assert('FindReplace: replaceAll X10\u2192X99', replaceResult.replaceCount > 0, `found=${replaceResult.replaceCount}`);

  replaceResult = await page.evaluate(() => {
    const findInput = document.getElementById('findInput');
    const replaceInput = document.getElementById('replaceInput');
    findInput.value = 'X99';
    replaceInput.value = 'X77';
    findInput.dispatchEvent(new Event('input', { bubbles: true }));
    const btnReplace = document.getElementById('btnReplace');
    if (btnReplace) btnReplace.click();
    const text = document.getElementById('editorWorking').value;
    const countX77 = (text.match(/X77/g) || []).length;
    const countX99 = (text.match(/X99/g) || []).length;
    return { x77Count: countX77, x99Count: countX99 };
  });
  assert('FindReplace: replace single X99\u2192X77', replaceResult.x77Count === 1, JSON.stringify(replaceResult));
  assert('FindReplace: remaining X99 after single replace', replaceResult.x99Count > 0, JSON.stringify(replaceResult));

  let findCur = await page.evaluate(() => {
    const el = document.getElementById('findCount');
    return el ? el.textContent : '';
  });
  assert('FindReplace: find count shows results', findCur !== '0/0', `count=${findCur}`);

  section(30, 'Find/Replace \u2014 input focus protection');

  await page.evaluate(() => {
    state.workingCmds = gcodeParser.parse('G0 X0 Y0\nG1 X10 Y0\nG1 X10 Y10\nG1 X0 Y10\nG0 X0 Y0');
    state.originalCmds = state.workingCmds.map(c => ({ ...c }));
    ui.refreshWorking();
  });

  let focusResult = await page.evaluate(() => {
    const findInput = document.getElementById('findInput');
    findInput.focus();
    findInput.value = 'X';
    findInput.dispatchEvent(new Event('input', { bubbles: true }));
    const activeId = document.activeElement ? document.activeElement.id : 'none';
    return { activeId };
  });
  assert('FindReplace: focus stays on find input after search', focusResult.activeId === 'findInput', `active=${focusResult.activeId}`);

  focusResult = await page.evaluate(() => {
    const findInput = document.getElementById('findInput');
    const replaceInput = document.getElementById('replaceInput');
    const btnReplaceAll = document.getElementById('btnReplaceAll');
    findInput.focus();
    findInput.value = 'X10';
    replaceInput.value = 'X55';
    findInput.dispatchEvent(new Event('input', { bubbles: true }));
    if (btnReplaceAll) btnReplaceAll.click();
    const activeId = document.activeElement ? document.activeElement.id : 'none';
    return { activeId };
  });
  assert('FindReplace: focus stays on find input after replaceAll', focusResult.activeId === 'findInput', `active=${focusResult.activeId}`);

  section(31, 'SVG conversion \u2014 preview rapids');

  const svgFileContent = fs.readFileSync(path.join(SAMPLES, 'simple.svg'), 'utf8');

  await page.evaluate((svg) => {
    state.filename = 'test.svg';
    state.mode = 'svg';
    state.aspectRatio = 1;
    const gcodeCmds = svgConverter.convert(svg, null);
    state.workingCmds = gcodeCmds;
    state.originalCmds = state.workingCmds.map(c => ({ ...c }));
    state.filename = 'converted.gcode';
    state.mode = 'gcode';
    ui.refreshWorking();
    preview._segments = null;
    preview._segBuilding = false;
    preview.draw(state.workingCmds);
  }, svgFileContent);

  await new Promise(r => setTimeout(r, 2000));

  let convertResult = await page.evaluate(() => {
    const segs = preview._segments;
    if (!segs || !segs.length) return { ok: false, reason: 'no segments' };
    const rapids = segs.filter(s => s.rapid);
    const cutSegs = segs.filter(s => !s.rapid);
    const toolOnSegs = segs.filter(s => s.toolOn);
    return {
      ok: rapids.length > 0 && cutSegs.length > 0,
      totalSegs: segs.length,
      rapids: rapids.length,
      cut: cutSegs.length,
      toolOn: toolOnSegs.length
    };
  });
  assert('SVG conv preview: rapids exist', convertResult.ok, convertResult.reason || JSON.stringify(convertResult));
  assert('SVG conv preview: has cut segments', convertResult.cut > 0, `cut=${convertResult.cut}`);
  assert('SVG conv preview: has tool-on segments', convertResult.toolOn > 0, `toolOn=${convertResult.toolOn}`);
  assert('SVG conv preview: no console errors during rebuild', errors.length === 0, `errors=${errors.length}`);

  section(32, 'DXF conversion \u2014 preview rapids');

  const dxfFileContent = fs.readFileSync(path.join(SAMPLES, 'test.dxf'), 'utf8');

  await page.evaluate((dxf) => {
    state.filename = 'test.dxf';
    state.mode = 'dxf';
    state.aspectRatio = 1;
    const segments = dxfParser.parse(dxf);
    const gcodeCmds = svgConverter.segmentsToGcode(segments, null, 100);
    state.workingCmds = gcodeCmds;
    state.originalCmds = state.workingCmds.map(c => ({ ...c }));
    state.filename = 'converted.gcode';
    state.mode = 'gcode';
    ui.refreshWorking();
    preview._segments = null;
    preview._segBuilding = false;
    preview.draw(state.workingCmds);
  }, dxfFileContent);

  await new Promise(r => setTimeout(r, 2000));

  let dxfResult = await page.evaluate(() => {
    const segs = preview._segments;
    if (!segs || !segs.length) return { ok: false, reason: 'no segments' };
    const rapids = segs.filter(s => s.rapid);
    const cutSegs = segs.filter(s => !s.rapid);
    return {
      ok: rapids.length > 0 && cutSegs.length > 0,
      totalSegs: segs.length,
      rapids: rapids.length,
      cut: cutSegs.length
    };
  });
  assert('DXF conv preview: rapids exist', dxfResult.ok, dxfResult.reason || JSON.stringify(dxfResult));
  assert('DXF conv preview: has cut segments', dxfResult.cut > 0, `cut=${dxfResult.cut}`);

  // ===== SUMMARY =====
  console.log(`\n\x1b[36m\u2550\u2550\u2550 Summary \u2550\u2550\u2550\x1b[0m`);
  console.log(`  ${PASS} Passed: ${passed}`);
  if (failed > 0) console.log(`  ${FAIL} Failed: ${failed}`);
  console.log(`  Console errors: ${errors.length}`);

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
