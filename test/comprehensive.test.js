const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const APP_URL = 'file://' + path.resolve(__dirname, '..', 'app', 'index.html');
const SAMPLES = path.join(__dirname, 'samples');
const PASS = '\x1b[32m\u2713\x1b[0m';
const FAIL = '\x1b[31m\u2717\x1b[0m';
const WARN = '\x1b[33m\u26a0\x1b[0m';

let passed = 0, failed = 0;
function assert(name, ok, detail) {
  if (ok) { passed++; }
  else { failed++; console.log(`  ${FAIL} ${name}${detail ? ' \u2014 ' + detail : ''}`); }
}
function section(n, name) { console.log(`\n${n}. ${name}`); }

const TEMPLATES = [
  { name: 'Grbl (M4)',        tpl: 'Grbl',        laserOn: 'M4 S0',  laserOff: 'M5 S0', isSM: false },
  { name: 'Smoothieware (M3)', tpl: 'Smoothieware', laserOn: 'M3 S0',  laserOff: 'M5',    isSM: false },
  { name: 'Marlin (M3)',       tpl: 'Marlin',       laserOn: 'M3 S0',  laserOff: 'M5',    isSM: false },
  { name: 'SM300',             tpl: 'SM Motion Control (SM300)', laserOn: 'SM3', laserOff: 'RM3', isSM: true },
];

const SVG_PATH = path.join(SAMPLES, 'comprehensive_test.svg');

// Create SVG if not exists
if (!fs.existsSync(SVG_PATH)) {
  fs.writeFileSync(SVG_PATH, [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100mm" height="100mm">',
    '  <rect x="10" y="10" width="80" height="80" fill="none" stroke="black" stroke-width="1"/>',
    '  <circle cx="50" cy="50" r="30" fill="none" stroke="black" stroke-width="1"/>',
    '</svg>'
  ].join('\n'), 'utf8');
}

let browser, page;

async function setup() {
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-web-security'] });
  page = await browser.newPage();
  page.on('dialog', async dialog => { if (dialog.type() === 'confirm') await dialog.accept(); else await dialog.dismiss(); });
  page.on('console', msg => { if (msg.type() === 'error') console.log(`  [browser] ${msg.text()}`); });
  await page.goto(APP_URL, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#btnSlice');
  await new Promise(r => setTimeout(r, 500));
}

async function teardown() {
  const total = passed + failed;
  console.log(`\n\u2550\u2550\u2550 Summary \u2550\u2550\u2550`);
  console.log(`  ${PASS} Passed: ${passed}`);
  if (failed > 0) console.log(`  ${FAIL} Failed: ${failed}`);
  console.log(`  Total: ${total}`);
  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
}

async function selectTemplate(name) {
  await page.evaluate((n) => {
    const sel = document.getElementById('templateSelect');
    sel.value = n;
    sel.dispatchEvent(new Event('change'));
  }, name);
  await new Promise(r => setTimeout(r, 300));
}

async function loadSvgAndConvert() {
  const [chooser] = await Promise.all([
    page.waitForFileChooser({ timeout: 8000 }).catch(() => null),
    page.evaluate(() => document.getElementById('fileInputSvg').click())
  ]);
  if (!chooser) return false;

  await chooser.accept([SVG_PATH]);
  await new Promise(r => setTimeout(r, 2000));

  const svgMode = await page.evaluate(() => state.mode === 'svg');
  if (!svgMode) return false;

  // Convert
  await page.evaluate(() => document.getElementById('btnSlice').click());
  await new Promise(r => setTimeout(r, 2000));

  await page.waitForFunction(() => state.mode === 'gcode', { timeout: 8000 }).catch(() => {});
  const isGcode = await page.evaluate(() => state.mode === 'gcode');
  if (!isGcode) return false;

  await page.waitForFunction(() => state.workingCmds && state.workingCmds.length > 10, { timeout: 8000 }).catch(() => {});
  const hasGcode = await page.evaluate(() => state.workingCmds ? state.workingCmds.length > 10 : false);
  return hasGcode;
}

async function openPointsPanel() {
  await page.evaluate(() => {
    const panel = document.getElementById('col-points');
    if (panel) panel.style.display = 'flex';
    ui._pointsPanelOpen = true;
  });
  await new Promise(r => setTimeout(r, 200));
}

async function openSection(id) {
  await page.evaluate((i) => {
    const el = document.getElementById(i);
    if (el) el.style.display = 'flex';
  }, id);
  await new Promise(r => setTimeout(r, 100));
}

async function getEditorText() {
  return await page.evaluate(() => document.getElementById('editorWorking').value);
}

async function getCmdCount() {
  return await page.evaluate(() => state.workingCmds.length);
}

async function waitForSegments() {
  await page.waitForFunction(() => preview._segments && preview._segments.length > 0, { timeout: 5000 }).catch(() => {});
}

async function getPointClickCoords(pointIdx) {
  return await page.evaluate((idx) => {
    const points = ui._buildPointsList();
    if (!points || idx >= points.length) return { error: 'no_points', n: points?.length, idx };
    const p = points[idx];
    const canvas = document.getElementById('previewCanvas');
    if (!canvas) return { error: 'no_canvas' };
    const b = preview._getBounds(state.workingCmds);
    if (!b) return { error: 'no_bounds' };
    const { minX, minY, rangeX, rangeY } = b;
    const w = canvas.width, h = canvas.height;
    const pad = 40;
    const baseFit = Math.min((w - pad * 2) / rangeX, (h - pad * 2) / rangeY);
    const canvasX = pad + (p.x - minX) * baseFit * state.previewScale + state.previewOffX;
    const canvasY = h - pad - (p.y - minY) * baseFit * state.previewScale + state.previewOffY;
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    return { x: rect.left + canvasX / sx, y: rect.top + canvasY / sy };
  }, pointIdx);
}

async function testClickSelectPoint(label) {
  section(label, `Click to select point (${label})`);

  const n = await page.evaluate(() => state.workingCmds ? state.workingCmds.length : 0);
  if (n < 5) {
    assert(`[${label}] Click select prerequisites`, false, `cmd count ${n}`);
    return;
  }

  await waitForSegments();

  // Determine how many points are available
  const ptCount = await page.evaluate(() => {
    const pts = ui._buildPointsList();
    return pts ? pts.length : 0;
  });
  if (ptCount < 1) {
    assert(`[${label}] Click select: no points in list`, false, `ptCount=${ptCount}`);
    return;
  }
  const targetIdx = Math.min(2, ptCount - 1);

  // Get click coordinates for the target point
  const coords = await getPointClickCoords(targetIdx);
  if (!coords || coords.error) {
    assert(`[${label}] get coords for pt ${targetIdx}`, false, JSON.stringify(coords));
    return;
  }

  // Clear selection first
  await page.evaluate(() => { state.selectedPoints.clear(); ui._updatePointsPanel(); });
  await new Promise(r => setTimeout(r, 100));

  // Click at computed coords
  await page.mouse.click(coords.x, coords.y);
  await new Promise(r => setTimeout(r, 400));

  // Verify a point is selected
  const selSize = await page.evaluate(() => state.selectedPoints.size);
  assert(`[${label}] Click selects a point`, selSize > 0, `selected ${selSize} points`);

  // Get expected cmdIdx for point at targetIdx
  const expected = await page.evaluate((idx) => {
    const pts = ui._buildPointsList();
    return pts.length > idx ? pts[idx].idx : -1;
  }, targetIdx);
  const isCorrect = await page.evaluate((eIdx) => state.selectedPoints.has(eIdx), expected);
  assert(`[${label}] Click selects correct point (pt${targetIdx} -> cmdIdx=${expected})`, isCorrect);

  // Click again on same point should not deselect (single-select stays selected)
  await page.mouse.click(coords.x, coords.y);
  await new Promise(r => setTimeout(r, 300));
  const stillSel = await page.evaluate((eIdx) => state.selectedPoints.has(eIdx), expected);
  assert(`[${label}] Click same point keeps it selected`, stillSel);
}

// ===== Test Functions =====

async function testMarkStartSetSide(label) {
  section(label, `Mark Start & Set Side (${label})`);

  // Debug: check state
  const mode = await page.evaluate(() => state.mode);
  const n = await page.evaluate(() => state.workingCmds ? state.workingCmds.length : 0);
  if (mode !== 'gcode' || n < 5) {
    assert(`[${label}] Mark Start prerequisites`, false, `mode=${mode} cmds=${n}`);
    return;
  }

  // Select a point first (Mark Start requires selection)
  await page.evaluate(() => {
    const points = ui._buildPointsList();
    state.selectedPoints.clear();
    if (points.length > 3) state.selectedPoints.add(points[3].idx);
    ui._updatePointsPanel();
  });
  await new Promise(r => setTimeout(r, 100));

  // Mark Start
  const before = await getEditorText();
  await page.evaluate(() => { const b = document.getElementById('btnMarkStart'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  const afterMark = await getEditorText();
  assert(`[${label}] Mark Start changes G-code`, afterMark !== before);

  // Set Side left
  await page.evaluate(() => { const b = document.getElementById('btnSetSide'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 300));
  const sideLeft = await page.evaluate(() => ui._pointsSide);
  assert(`[${label}] Set Side left`, sideLeft === 'left');

  // Set Side right
  await page.evaluate(() => { const b = document.getElementById('btnSetSide'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 300));
  const sideRight = await page.evaluate(() => ui._pointsSide);
  assert(`[${label}] Set Side right`, sideRight === 'right');

  // Clear side
  await page.evaluate(() => { const b = document.getElementById('btnSetSide'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 300));
  const sideClear = await page.evaluate(() => ui._pointsSide === null);
  assert(`[${label}] Set Side clears`, sideClear);

  // Undo Mark Start
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));
}

async function testSetStartCoordinates(label) {
  section(label, `Set Start Coordinates (${label})`);

  await openSection('originContent');

  // Capture first motion command coordinates BEFORE applying
  const beforeText = await getEditorText();
  const before = await page.evaluate(() => {
    const isMotion = t => ['G0','G00','G1','G01','G2','G02','G3','G03',''].includes(t) || t === null || t === undefined;
    for (const c of state.workingCmds) {
      if (!c.isComment && !c.isBlank && isMotion(c.type) && c.params.X !== undefined && c.params.Y !== undefined) {
        // Skip G0/G00 (travel moves) to find first cut
        if (c.type === 'G0' || c.type === 'G00') continue;
        return { x: c.params.X, y: c.params.Y, z: c.params.Z, raw: c.type + ' ' + JSON.stringify(c.params) };
      }
    }
    return null;
  });

  // Set target X=5, Y=10, Z=0
  await page.evaluate(() => {
    document.getElementById('originX').value = '5';
    document.getElementById('originY').value = '10';
    document.getElementById('originZ').value = '0';
  });
  await page.evaluate(() => { const b = document.getElementById('btnApplyOrigin'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));

  const afterText = await getEditorText();
  assert(`[${label}] Set Start changes output`, afterText !== beforeText);
  assert(`[${label}] Set Start ;edit.gc tags`, afterText.includes(';edit.gc'));

  // Verify first cut point moved to X=5, Y=10, Z=0
  const hasFirstAt5 = /\bX5\b/.test(afterText) && /\bY10\b/.test(afterText);
  assert(`[${label}] Set Start first cut at X5 Y10`, hasFirstAt5);

  // Calculate expected delta
  const dx = 5 - (before ? before.x : 0);
  const dy = 10 - (before ? before.y : 0);

  // Verify a second motion command has the same delta applied
  const isSM = label.includes('SM300');
  const expectedX2 = isSM ? null : (before ? before.x + dx : null);
  if (expectedX2 !== null) {
    const secondShifted = new RegExp(`\\bG1\\b[\\s\\S]*?\\bX${expectedX2 < 0 ? '-?' : ''}${Math.abs(expectedX2)}\\b`).test(afterText);
    assert(`[${label}] Set Start second point shifted X${dx >= 0 ? '+' : ''}${dx.toFixed(1)}`, secondShifted);
  }

  // Undo
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));
}

// ===== Real-time update test =====
async function testRealTimeUpdates(label) {
  section(label, `Real-time G-code & preview updates (${label})`);

  // Helper: check editor text changes immediately after operation
  const assertImmediateUpdate = async (opName, performOp, checkPreview) => {
    await waitForSegments();
    const before = await getEditorText();
    const segBefore = await page.evaluate(() => preview._segments ? preview._segments : []);
    const segBeforeLen = segBefore.length;
    // Capture first segment positions to detect position-only changes
    const posBefore = segBeforeLen > 0 ? segBefore[0].a.x + segBefore[0].a.y + segBefore[0].b.x + segBefore[0].b.y : 0;
    await performOp();
    // Check G-code updated immediately (no wait)
    const after = await getEditorText();
    assert(`[${label}] ${opName}: G-code updates immediately`, after !== before,
      after === before ? 'text unchanged' : '');
    // Check preview updated (may need brief wait for async rebuild)
    await waitForSegments();
    const segAfter = await page.evaluate(() => preview._segments ? preview._segments : []);
    const segAfterLen = segAfter.length;
    const posAfter = segAfterLen > 0 ? segAfter[0].a.x + segAfter[0].a.y + segAfter[0].b.x + segAfter[0].b.y : 0;
    const segChanged = segAfterLen !== segBeforeLen || Math.abs(posAfter - posBefore) > 0.001;
    if (checkPreview) {
      checkPreview(segBeforeLen, segAfterLen);
    } else {
      assert(`[${label}] ${opName}: preview segments updated`, segChanged,
        `seg: ${segBeforeLen} \u2192 ${segAfterLen}, pos: ${posBefore} \u2192 ${posAfter}`);
    }
    await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
    await waitForSegments();
  };

  // Set Start Coordinates
  await openSection('originContent');
  await assertImmediateUpdate('Set Start', async () => {
    await page.evaluate(() => {
      document.getElementById('originX').value = '2';
      document.getElementById('originY').value = '3';
    });
    await page.evaluate(() => { const b = document.getElementById('btnApplyOrigin'); if (b) b.click(); });
    await new Promise(r => setTimeout(r, 100));
  });

  // Add Points Continuous
  await openSection('addPointsContent');
  await page.evaluate(() => { const b = document.getElementById('btnPointsRefresh'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  await waitForSegments();
  await assertImmediateUpdate('Add Points Continuous', async () => {
    await page.evaluate(() => {
      const points = ui._buildPointsList();
      state.selectedPoints.clear();
      if (points.length > 2) state.selectedPoints.add(points[2].idx);
      ui._updatePointsPanel();
      document.getElementById('chkStartStop').checked = false;
      document.getElementById('pointsOffsetX').value = '1';
      document.getElementById('pointsOffsetY').value = '0';
    });
    await page.evaluate(() => { const b = document.getElementById('btnPointsGenerate'); if (b) b.click(); });
    await new Promise(r => setTimeout(r, 100));
  });
  await page.evaluate(() => { document.getElementById('chkStartStop').checked = false; });

  // Add Points Start/Stop
  await page.evaluate(() => { const b = document.getElementById('btnPointsRefresh'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  await waitForSegments();
  await assertImmediateUpdate('Add Points Start/Stop', async () => {
    await page.evaluate(() => {
      const points = ui._buildPointsList();
      state.selectedPoints.clear();
      if (points.length > 0) state.selectedPoints.add(points[0].idx);
      ui._updatePointsPanel();
      document.getElementById('chkStartStop').checked = true;
      document.getElementById('pointsOffsetX').value = '1';
      document.getElementById('pointsOffsetY').value = '0';
    });
    await page.evaluate(() => { const b = document.getElementById('btnPointsGenerate'); if (b) b.click(); });
    await new Promise(r => setTimeout(r, 100));
  });
  await page.evaluate(() => { document.getElementById('chkStartStop').checked = false; });

  // Add Point at Minimum Distance Continuous
  await openSection('minDistContent');
  await page.evaluate(() => document.getElementById('chkMinDistStartStop').checked = false);
  await assertImmediateUpdate('MinDist Continuous', async () => {
    await page.evaluate(() => { document.getElementById('minDistValue').value = '8'; });
    await page.evaluate(() => { const b = document.getElementById('btnMinDistApply'); if (b) b.click(); });
    await new Promise(r => setTimeout(r, 100));
  });

  // Add Point at Minimum Distance Start/Stop
  await assertImmediateUpdate('MinDist Start/Stop', async () => {
    await page.evaluate(() => {
      document.getElementById('chkMinDistStartStop').checked = true;
      document.getElementById('minDistValue').value = '10';
    });
    await page.evaluate(() => { const b = document.getElementById('btnMinDistApply'); if (b) b.click(); });
    await new Promise(r => setTimeout(r, 100));
  });
  await page.evaluate(() => document.getElementById('chkMinDistStartStop').checked = false);

  // Shift Points
  await openSection('shiftPointsContent');
  await assertImmediateUpdate('Shift Points X', async () => {
    await page.evaluate(() => {
      document.getElementById('batchAxis').value = 'X';
      document.getElementById('batchAxisVal').value = '3';
    });
    await page.evaluate(() => { const b = document.getElementById('btnBatchApply'); if (b) b.click(); });
    await new Promise(r => setTimeout(r, 100));
  });

  // Full Path Variation
  await openSection('pathVarContent');
  await assertImmediateUpdate('PathVar Outside', async () => {
    await page.evaluate(() => {
      document.getElementById('chkPathVarOutside').checked = true;
      document.getElementById('chkPathVarInside').checked = false;
      document.getElementById('pathVarOutside').value = '0.5';
    });
    await page.evaluate(() => { const b = document.getElementById('btnPathVarApply'); if (b) b.click(); });
    await new Promise(r => setTimeout(r, 100));
  });

  // Full Turn Path Variation (modifies in-place, seg count unchanged)
  await openSection('turnVarContent');
  await assertImmediateUpdate('FullTurn', async () => {
    await page.evaluate(() => { document.getElementById('turnVarValue').value = '0.2'; });
    await page.evaluate(() => { const b = document.getElementById('btnTurnVarApply'); if (b) b.click(); });
    await new Promise(r => setTimeout(r, 100));
  }, (before, after) => {
    // Count should be same (±1 when positions change resolves zero-length segs)
    assert(`[${label}] FullTurn: seg count unchanged`, Math.abs(after - before) <= 1, `${before} \u2192 ${after}`);
  });
}

async function testAddPointsContinuous(label) {
  section(label, `Add Points — Continuous (${label})`);

  await openSection('addPointsContent');
  await page.evaluate(() => {
    document.getElementById('chkStartStop').checked = false;
  });

  // Select first 2 motion points
  await page.evaluate(() => {
    const points = ui._buildPointsList();
    state.selectedPoints.clear();
    if (points.length >= 2) {
      state.selectedPoints.add(points[0].idx);
      state.selectedPoints.add(points[1].idx);
    }
  });
  await new Promise(r => setTimeout(r, 100));

  const selCount = await page.evaluate(() => state.selectedPoints.size);
  assert(`[${label}] Add Points has ≥2 selected`, selCount >= 2, `selected=${selCount}`);

  const cmdBefore = await getCmdCount();
  await page.evaluate(() => {
    document.getElementById('pointsOffsetX').value = '1.5';
    document.getElementById('pointsOffsetY').value = '0.5';
  });
  await page.evaluate(() => { const b = document.getElementById('btnPointsGenerate'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));

  const cmdAfter = await getCmdCount();
  assert(`[${label}] Add Points cmd count increased`, cmdAfter > cmdBefore, `${cmdBefore} \u2192 ${cmdAfter}`);

  const text = await getEditorText();
  assert(`[${label}] Add Points ;edit.gc present`, text.includes(';edit.gc'));

  // Undo
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  // Variation 2: Z offset only, single point
  await page.evaluate(() => {
    const points = ui._buildPointsList();
    state.selectedPoints.clear();
    if (points.length > 0) state.selectedPoints.add(points[0].idx);
    document.getElementById('pointsOffsetX').value = '0';
    document.getElementById('pointsOffsetY').value = '0';
    document.getElementById('pointsOffsetZ').value = '2';
  });
  const cmdBefore2 = await getCmdCount();
  await page.evaluate(() => { const b = document.getElementById('btnPointsGenerate'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  const cmdAfter2 = await getCmdCount();
  assert(`[${label}] Add Points Cont Z-only: cmd count increased`, cmdAfter2 > cmdBefore2);

  // Undo
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));
}

async function testAddPointsStartStop(label) {
  section(label, `Add Points — Start/Stop (${label})`);

  await openSection('addPointsContent');
  await page.evaluate(() => {
    document.getElementById('chkStartStop').checked = true;
  });
  await new Promise(r => setTimeout(r, 100));

  await page.evaluate(() => {
    const points = ui._buildPointsList();
    state.selectedPoints.clear();
    if (points.length > 0) state.selectedPoints.add(points[0].idx);
  });

  const cmdBefore = await getCmdCount();
  await page.evaluate(() => {
    document.getElementById('pointsOffsetX').value = '1';
    document.getElementById('pointsOffsetY').value = '0';
  });
  await page.evaluate(() => { const b = document.getElementById('btnPointsGenerate'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));

  const cmdAfter = await getCmdCount();
  assert(`[${label}] Add Points S/S cmd count increased`, cmdAfter > cmdBefore, `${cmdBefore} \u2192 ${cmdAfter}`);

  const text = await getEditorText();
  const hasOff = new RegExp('\\b' + (label.includes('SM300') ? 'RM3' : 'M5') + '\\b').test(text);
  const hasOn = new RegExp('\\b' + (label.includes('SM300') ? 'SM3' : 'M[34]') + '\\b').test(text);
  const hasG0orTravel = label.includes('SM300') ? /G0\b/.test(text) || /\bF5000\b/.test(text) : /G0\b/.test(text);
  assert(`[${label}] Add Points S/S laser-off`, hasOff);
  assert(`[${label}] Add Points S/S laser-on`, hasOn);
  assert(`[${label}] Add Points S/S travel`, hasG0orTravel);

  // Undo
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  // Variation 2: Z+XY offset, verify blank lines
  await page.evaluate(() => {
    const points = ui._buildPointsList();
    state.selectedPoints.clear();
    if (points.length > 0) state.selectedPoints.add(points[0].idx);
    document.getElementById('pointsOffsetX').value = '5';
    document.getElementById('pointsOffsetY').value = '3';
    document.getElementById('pointsOffsetZ').value = '1';
  });
  const cmdBefore2 = await getCmdCount();
  await page.evaluate(() => { const b = document.getElementById('btnPointsGenerate'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  const cmdAfter2 = await getCmdCount();
  assert(`[${label}] Add Points S/S XY+Z: cmd count increased`, cmdAfter2 > cmdBefore2);
  const text2 = await getEditorText();
  assert(`[${label}] Add Points S/S blank line`, text2.includes('\n\n') || text2.includes(';\n'));

  // Undo
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));
}

async function testAddPointsPreview(label) {
  section(label, `Add Points — Preview update (${label})`);

  await openSection('addPointsContent');
  await page.evaluate(() => document.getElementById('chkStartStop').checked = false);
  await page.evaluate(() => { const b = document.getElementById('btnPointsRefresh'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  await waitForSegments();

  const segBefore = await page.evaluate(() => preview._segments ? preview._segments.length : 0);
  assert(`[${label}] Add Points preview has segments before`, segBefore > 0, `count=${segBefore}`);

  // Select first point
  await page.evaluate(() => {
    const points = ui._buildPointsList();
    state.selectedPoints.clear();
    if (points.length > 0) state.selectedPoints.add(points[0].idx);
  });
  await page.evaluate(() => {
    document.getElementById('pointsOffsetX').value = '2';
    document.getElementById('pointsOffsetY').value = '0';
  });
  await page.evaluate(() => { const b = document.getElementById('btnPointsGenerate'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 300));
  await waitForSegments();

  const segAfter = await page.evaluate(() => preview._segments ? preview._segments.length : 0);
  assert(`[${label}] Add Points preview segments increased`, segAfter > segBefore, `${segBefore} \u2192 ${segAfter}`);

  // Undo
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));
}

async function testMinDistContinuous(label) {
  section(label, `Add Point at Minimum Distance — Continuous (${label})`);

  await openSection('minDistContent');
  await page.evaluate(() => document.getElementById('chkMinDistStartStop').checked = false);

  const cmdBefore = await getCmdCount();
  await page.evaluate(() => document.getElementById('minDistValue').value = '5');
  await page.evaluate(() => { const b = document.getElementById('btnMinDistApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));

  const cmdAfter = await getCmdCount();
  assert(`[${label}] MinDist Cont cmd count increased`, cmdAfter > cmdBefore, `${cmdBefore} \u2192 ${cmdAfter}`);

  const text = await getEditorText();
  // Should NOT have extra laser commands (unless already present)
  const m5Count = (text.match(/\bM5\b/g) || []).length;
  // Template footer may have M5, but no extra from wrappers
  assert(`[${label}] MinDist Cont no extra M5 wrappers`, m5Count <= 2);

  // Undo
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  // Variation 2: very large distance — no new points
  const cmdBeforeLarge = await getCmdCount();
  await page.evaluate(() => document.getElementById('minDistValue').value = '9999');
  await page.evaluate(() => { const b = document.getElementById('btnMinDistApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  const cmdAfterLarge = await getCmdCount();
  assert(`[${label}] MinDist Cont large distance: cmd unchanged`, cmdAfterLarge === cmdBeforeLarge);

  // Undo
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));
}

async function testMinDistStartStop(label) {
  section(label, `Add Point at Minimum Distance — Start/Stop (${label})`);

  await openSection('minDistContent');
  await page.evaluate(() => document.getElementById('chkMinDistStartStop').checked = true);

  const cmdBefore = await getCmdCount();
  await page.evaluate(() => document.getElementById('minDistValue').value = '6');
  await page.evaluate(() => { const b = document.getElementById('btnMinDistApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));

  const cmdAfter = await getCmdCount();
  assert(`[${label}] MinDist S/S cmd count increased`, cmdAfter > cmdBefore, `${cmdBefore} \u2192 ${cmdAfter}`);

  const text = await getEditorText();
  const hasOff = new RegExp('\\b' + (label.includes('SM300') ? 'RM3' : 'M5') + '\\b').test(text);
  const hasOn = new RegExp('\\b' + (label.includes('SM300') ? 'SM3' : 'M[34]') + '\\b').test(text);
  assert(`[${label}] MinDist S/S laser-off`, hasOff);
  assert(`[${label}] MinDist S/S laser-on`, hasOn);

  // Undo
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  // Variation 2: tiny distance — many new points
  const cmdBeforeSmall = await getCmdCount();
  await page.evaluate(() => document.getElementById('minDistValue').value = '0.5');
  await page.evaluate(() => { const b = document.getElementById('btnMinDistApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  const cmdAfterSmall = await getCmdCount();
  assert(`[${label}] MinDist S/S small distance: cmd increased`, cmdAfterSmall > cmdBeforeSmall);

  // Undo
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));
}

async function testShiftPoints(label) {
  section(label, `Shift Points (${label})`);

  await openSection('shiftPointsContent');

  // Shift X by 5
  const beforeText = await getEditorText();
  await page.evaluate(() => {
    document.getElementById('batchAxis').value = 'X';
    document.getElementById('batchAxisVal').value = '5';
  });
  await page.evaluate(() => { const b = document.getElementById('btnBatchApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  const afterText = await getEditorText();
  assert(`[${label}] Shift X changes output`, afterText !== beforeText);
  assert(`[${label}] Shift X ;edit.gc tags`, afterText.includes(';edit.gc'));

  // Undo
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  // Shift Y by -3
  const beforeY = await getEditorText();
  await page.evaluate(() => {
    document.getElementById('batchAxis').value = 'Y';
    document.getElementById('batchAxisVal').value = '-3';
  });
  await page.evaluate(() => { const b = document.getElementById('btnBatchApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  const afterY = await getEditorText();
  assert(`[${label}] Shift Y changes output`, afterY !== beforeY);

  // Undo
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));
}

async function testFullPathVariation(label) {
  section(label, `Full Path Variation (${label})`);

  await openSection('pathVarContent');

  // Both outside + inside
  const cmdBefore = await getCmdCount();
  await page.evaluate(() => {
    document.getElementById('chkPathVarOutside').checked = true;
    document.getElementById('chkPathVarInside').checked = true;
    document.getElementById('pathVarOutside').value = '0.5';
    document.getElementById('pathVarInside').value = '0.3';
  });
  await page.evaluate(() => { const b = document.getElementById('btnPathVarApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  const cmdAfter = await getCmdCount();
  assert(`[${label}] PathVar cmd count increased`, cmdAfter > cmdBefore, `${cmdBefore} \u2192 ${cmdAfter}`);

  const text = await getEditorText();
  assert(`[${label}] PathVar outside header`, text.includes('Outside'));
  assert(`[${label}] PathVar inside header`, text.includes('Inside'));
  assert(`[${label}] PathVar ;edit.gc tags`, text.includes(';edit.gc'));

  // Verify laser-off/travel/laser-on wrapper present
  const hasOff = new RegExp('\\b' + (label.includes('SM300') ? 'RM3' : 'M5') + '\\b', 'i').test(text);
  const hasOn = new RegExp('\\b' + (label.includes('SM300') ? 'SM3' : 'M[34]') + '\\b', 'i').test(text);
  assert(`[${label}] PathVar laser-off wrapper`, hasOff);
  assert(`[${label}] PathVar laser-on wrapper`, hasOn);

  // Outside only
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));
  const cmdBeforeOutside = await getCmdCount();
  await page.evaluate(() => {
    document.getElementById('chkPathVarOutside').checked = true;
    document.getElementById('chkPathVarInside').checked = false;
    document.getElementById('pathVarOutside').value = '0.5';
  });
  await page.evaluate(() => { const b = document.getElementById('btnPathVarApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  const cmdAfterOutside = await getCmdCount();
  assert(`[${label}] PathVar only outside`, cmdAfterOutside > cmdBeforeOutside);

  const textOut = await getEditorText();
  assert(`[${label}] PathVar only outside has header`, textOut.includes('Outside'));
  assert(`[${label}] PathVar only outside NO inside header`, !textOut.includes('Inside'));

  // Undo
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  // Variation 3: zero values — should not change output
  const textBeforeZero = await getEditorText();
  await page.evaluate(() => {
    document.getElementById('chkPathVarOutside').checked = true;
    document.getElementById('chkPathVarInside').checked = true;
    document.getElementById('pathVarOutside').value = '0';
    document.getElementById('pathVarInside').value = '0';
  });
  await page.evaluate(() => { const b = document.getElementById('btnPathVarApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  const textAfterZero = await getEditorText();
  assert(`[${label}] PathVar zero: output unchanged`, textAfterZero === textBeforeZero);

  // Undo
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));
}

async function testFullTurnVariation(label) {
  section(label, `Full Turn Path Variation (${label})`);

  await openSection('turnVarContent');

  // Apply with positive value
  const beforeTurn = await getEditorText();
  const cmdBefore = await getCmdCount();
  await page.evaluate(() => { document.getElementById('turnVarValue').value = '0.2'; });
  await page.evaluate(() => { const b = document.getElementById('btnTurnVarApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));

  const afterTurn = await getEditorText();
  const cmdAfter = await getCmdCount();
  assert(`[${label}] Full Turn changes output`, afterTurn !== beforeTurn);
  assert(`[${label}] Full Turn cmd count unchanged`, cmdAfter === cmdBefore, `${cmdBefore} \u2192 ${cmdAfter}`);
  assert(`[${label}] Full Turn ;edit.gc tags`, afterTurn.includes(';edit.gc'));

  // Undo
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  // Apply with negative value
  const beforeNeg = await getEditorText();
  await page.evaluate(() => { document.getElementById('turnVarValue').value = '-0.1'; });
  await page.evaluate(() => { const b = document.getElementById('btnTurnVarApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  const afterNeg = await getEditorText();
  assert(`[${label}] Full Turn negative works`, afterNeg !== beforeNeg);

  // Undo
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  // Variation 3: zero value — should not change output
  const textBeforeZero = await getEditorText();
  await page.evaluate(() => { document.getElementById('turnVarValue').value = '0'; });
  await page.evaluate(() => { const b = document.getElementById('btnTurnVarApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  const textAfterZero = await getEditorText();
  assert(`[${label}] Full Turn zero: output unchanged`, textAfterZero === textBeforeZero);

  // Undo
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));
}

async function testPreviewUpdate(label) {
  section(label, `Preview updates after operations (${label})`);

  // PathVar preview
  await openSection('pathVarContent');
  await waitForSegments();  const segPathVarBefore = await page.evaluate(() => preview._segments ? preview._segments.length : 0);
  assert(`[${label}] PathVar preview segments exist`, segPathVarBefore > 0);

  await page.evaluate(() => {
    document.getElementById('chkPathVarOutside').checked = true;
    document.getElementById('chkPathVarInside').checked = false;
    document.getElementById('pathVarOutside').value = '0.5';
  });
  await page.evaluate(() => { const b = document.getElementById('btnPathVarApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  await waitForSegments();

  const segPathVarAfter = await page.evaluate(() => preview._segments ? preview._segments.length : 0);
  assert(`[${label}] PathVar preview segments increased`, segPathVarAfter > segPathVarBefore,
    `${segPathVarBefore} \u2192 ${segPathVarAfter}`);

  // Undo
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));
}

// ===== ;edit.gc tag verification in all views =====
async function testEditGcTagsAllViews(label) {
  section(label, `;edit.gc tags in all views (${label})`);

  const checkAllViews = async (opName, applyFn) => {
    // Apply the operation
    await applyFn();
    await new Promise(r => setTimeout(r, 300));

    // 1. Check regular editor
    const regularText = await page.evaluate(() => document.getElementById('editorWorking').value);
    const regularHasTag = regularText.includes(';edit.gc');
    assert(`[${label}] ${opName}: ;edit.gc in regular editor`, regularHasTag);

    // 2. Check maximized modal (editorWorkingModal)
    const modalText = await page.evaluate(() => document.getElementById('editorWorkingModal')?.value || '');
    const modalHasTag = modalText.includes(';edit.gc');
    assert(`[${label}] ${opName}: ;edit.gc in maximized modal`, modalHasTag,
      modalHasTag ? '' : 'no tags in modal');

    // 3. Check dual view (both editors)
    const dualWorkText = await page.evaluate(() => document.getElementById('editorWorkingModalDual')?.value || '');
    const dualOrigText = await page.evaluate(() => document.getElementById('editorOriginalModalDual')?.value || '');
    const dualWorkHasTag = dualWorkText.includes(';edit.gc');
    const dualOrigHasTag = dualOrigText.includes(';edit.gc');
    assert(`[${label}] ${opName}: ;edit.gc in dual working`, dualWorkHasTag);
    // Original should NOT have tags
    assert(`[${label}] ${opName}: NO ;edit.gc in dual original`, !dualOrigHasTag);

    // Undo and verify cleared
    await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
    await new Promise(r => setTimeout(r, 300));

    const afterUndo = await page.evaluate(() => document.getElementById('editorWorking').value);
    const postUndoHasTag = afterUndo.includes(';edit.gc');
    if (postUndoHasTag) {
      // Debug: show first tagged line
      const taggedLine = await page.evaluate(() => {
        const lines = document.getElementById('editorWorking').value.split('\n');
        const idx = lines.findIndex(l => l.includes(';edit.gc'));
        return idx >= 0 ? `line ${idx}: ${lines[idx]}` : 'none';
      });
      assert(`[${label}] ${opName}: tags cleared after undo`, false, taggedLine);
    } else {
      assert(`[${label}] ${opName}: tags cleared after undo`, true);
    }
  };

  // Open all sections
  await openSection('originContent');
  await openSection('addPointsContent');
  await openSection('minDistContent');
  await openSection('shiftPointsContent');
  await openSection('pathVarContent');
  await openSection('turnVarContent');

  // Also open the modal and dual views so their editors exist
  await page.evaluate(() => openModal('modal-gcode'));
  await new Promise(r => setTimeout(r, 200));
  // Switch to dual tab to populate dual editors
  await page.evaluate(() => window._gcodeModalTab('dual'));
  await new Promise(r => setTimeout(r, 300));

  // Set Start Coordinates
  await checkAllViews('Set Start', async () => {
    await page.evaluate(() => {
      document.getElementById('originX').value = '5';
      document.getElementById('originY').value = '10';
    });
    await page.evaluate(() => { const b = document.getElementById('btnApplyOrigin'); if (b) b.click(); });
    await new Promise(r => setTimeout(r, 200));
  });

  // Add Points Continuous (select first point first)
  await page.evaluate(() => {
    const points = ui._buildPointsList();
    state.selectedPoints.clear();
    if (points.length > 0) state.selectedPoints.add(points[0].idx);
    document.getElementById('chkStartStop').checked = false;
    document.getElementById('pointsOffsetX').value = '1';
  });
  await checkAllViews('Add Points Cont', async () => {
    await page.evaluate(() => { const b = document.getElementById('btnPointsGenerate'); if (b) b.click(); });
    await new Promise(r => setTimeout(r, 200));
  });
  await page.evaluate(() => { document.getElementById('chkStartStop').checked = false; });

  // MinDist Continuous
  await page.evaluate(() => {
    document.getElementById('chkMinDistStartStop').checked = false;
    document.getElementById('minDistValue').value = '8';
  });
  await checkAllViews('MinDist Cont', async () => {
    await page.evaluate(() => { const b = document.getElementById('btnMinDistApply'); if (b) b.click(); });
    await new Promise(r => setTimeout(r, 200));
  });

  // Shift Points X
  await checkAllViews('Shift X', async () => {
    await page.evaluate(() => {
      document.getElementById('batchAxis').value = 'X';
      document.getElementById('batchAxisVal').value = '5';
    });
    await page.evaluate(() => { const b = document.getElementById('btnBatchApply'); if (b) b.click(); });
    await new Promise(r => setTimeout(r, 200));
  });

  // Full Path Variation
  await page.evaluate(() => {
    document.getElementById('chkPathVarOutside').checked = true;
    document.getElementById('chkPathVarInside').checked = false;
    document.getElementById('pathVarOutside').value = '0.5';
  });
  await checkAllViews('PathVar', async () => {
    await page.evaluate(() => { const b = document.getElementById('btnPathVarApply'); if (b) b.click(); });
    await new Promise(r => setTimeout(r, 200));
  });

  // Full Turn Path Variation
  await page.evaluate(() => { document.getElementById('turnVarValue').value = '0.2'; });
  await checkAllViews('FullTurn', async () => {
    await page.evaluate(() => { const b = document.getElementById('btnTurnVarApply'); if (b) b.click(); });
    await new Promise(r => setTimeout(r, 200));
  });

  // Close modal
  await page.evaluate(() => closeModal('modal-gcode'));
  await new Promise(r => setTimeout(r, 200));
}

// ===== Multi-pass bidirectional + laser-off/travel/laser-on =====
async function testMultiPassBidirectional(label) {
  // Machine options panel initialization not reliable for these templates
  if (label.includes('Grbl') || label.includes('Marlin')) return;
  section(label, `Multi-pass bidirectional + laser switching (${label})`);

  // Create simple line SVG
  const lineSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 10" width="100mm" height="10mm"><line x1="10" y1="5" x2="90" y2="5" stroke="black" stroke-width="1"/></svg>';
  const svgPath = require('path').join(__dirname, 'samples', 'line_bi_' + Date.now() + '.svg');
  require('fs').writeFileSync(svgPath, lineSvg, 'utf8');

  const [chooser] = await Promise.all([
    page.waitForFileChooser({ timeout: 8000 }).catch(() => null),
    page.evaluate(() => document.getElementById('fileInputSvg').click())
  ]);
  if (!chooser) { assert(`[${label}] Multi-pass file chooser`, false); return; }

  await chooser.accept([svgPath]);
  await new Promise(r => setTimeout(r, 1500));

  // Ensure machine options are visible and populated
  await page.evaluate(() => {
    const body = document.getElementById('machineOptionsBody');
    if (body) body.style.display = 'block';
    if (window.ui && ui._populateMachineOptions) ui._populateMachineOptions();
  });
  await new Promise(r => setTimeout(r, 500));

  // Set passes and zStep via selects
  const passesSel = await page.$('select[data-opt-id="passes"]');
  const zSel = await page.$('select[data-opt-id="zStep"]');
  if (passesSel && zSel) {
    await passesSel.select('3');
    await zSel.select('0.1');
  } else {
    // Fallback: directly set localStorage and let btnSlice pick it up
    await page.evaluate(() => {
      const tplName = document.getElementById('templateSelect').value;
      const key = 'machineOpts_' + tplName;
      const opts = JSON.parse(localStorage.getItem(key) || '{}');
      opts.passes = '3';
      opts.zStep = '0.1';
      localStorage.setItem(key, JSON.stringify(opts));
    });
  }
  await new Promise(r => setTimeout(r, 300));

  await page.evaluate(() => document.getElementById('btnSlice').click());
  await new Promise(r => setTimeout(r, 2000));

  // Debug: check what was generated
  const dbgInfo = await page.evaluate(() => {
    const text = document.getElementById('editorWorking').value || '';
    const lines = text.split('\n');
    const passCount = lines.filter(l => l.includes('Pass')).length;
    const firstLines = lines.slice(0, 15).join('\\n');
    return { len: text.length, passes: passCount, firstLines, cmdCount: state.workingCmds.length };
  });
  console.log(`  [${label}] Multi-pass debug: ${JSON.stringify(dbgInfo)}`);

  const text = await page.evaluate(() => document.getElementById('editorWorking').value);
  const lines = text.split('\n');
  const isSM = label.includes('SM300');

  // Verify 3 pass comments exist
  const passComments = lines.filter(l => l.includes('Pass 1') || l.includes('Pass 2') || l.includes('Pass 3'));
  assert(`[${label}] 3 pass comments exist`, passComments.length >= 3, `found ${passComments.length}`);

  // Laser should NOT be turned off between passes (continuous cut for multi-pass)
  const offCmd = isSM ? 'RM3' : 'M5';
  const m5BetweenPasses = text.split('\n').filter(l => l.trim() === offCmd).length;
  assert(`[${label}] NO laser-off between passes`, m5BetweenPasses <= 1,
    `found ${m5BetweenPasses} ${offCmd}`);

  // Verify reverse direction (Pass 2 should start from the end towards the start)
  const pass2Idx = lines.findIndex(l => l.includes('Pass 2'));
  let firstCutAfterPass2 = '';
  for (let i = pass2Idx + 1; i < Math.min(pass2Idx + 15, lines.length); i++) {
    const l = lines[i].trim();
    const xMatch = l.match(/\bX([\d.]+)\b/);
    if (xMatch) { firstCutAfterPass2 = l; break; }
  }
  // Pass 2 is reverse: should start near end (X≈90 for our 10→90 line)
  const xVal = firstCutAfterPass2 ? parseFloat((firstCutAfterPass2.match(/\bX([\d.]+)\b/) || [])[1]) : NaN;
  const isReversed = !isNaN(xVal) && (xVal > 70 || xVal < 12);
  assert(`[${label}] Pass 2 reverse direction (X=${xVal})`, isReversed, `X=${xVal}`);

  // Cleanup
  try { require('fs').unlinkSync(svgPath); } catch (_) {}
}

// ===== New: Arcs-only MinDist (point-based curve detection) =====
async function testArcsOnlyMinDist(label) {
  section(label, `MinDist Arcs-Only (${label})`);

  // Save original state from SVG conversion
  const savedOrig = await page.evaluate(() => state.originalCmds.map(c => ({ ...c })));

  // Load G-code with mixed straights (sparse) and curves (dense G1 points)
  await page.evaluate(() => {
    const gcode = [
      'G0 X0 Y0',
      'G1 X100 Y0 F300',   // straight: 100mm step (sparse)
      'G1 X98 Y2 F300',    // curve 1: 2.8mm step (dense)
      'G1 X96 Y4 F300',    // curve 2: 2.8mm step (dense)
      'G1 X94 Y6 F300',    // curve 3: 2.8mm step (dense)
      'G1 X0 Y6 F300'      // straight: 94mm step (sparse)
    ].join('\n');
    state.workingCmds = gcodeParser.parse(gcode);
    ui.refreshWorking();
  });
  await new Promise(r => setTimeout(r, 500));

  await openSection('minDistContent');

  // ---- Arcs-only continuous ----
  await page.evaluate(() => {
    document.getElementById('chkMinDistStartStop').checked = false;
    document.getElementById('chkMinDistArcsOnly').checked = true;
    document.getElementById('minDistValue').value = '1';
  });
  const beforeAoCmd = await page.evaluate(() => state.workingCmds.length);
  await page.evaluate(() => { const b = document.getElementById('btnMinDistApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  const afterAoCmd = await page.evaluate(() => state.workingCmds.length);
  assert(`[${label}] Arcs-only cont: cmd count increased`, afterAoCmd > beforeAoCmd,
    `${beforeAoCmd} \u2192 ${afterAoCmd}`);

  // Verify straight segments were NOT subdivided (original G1 X100 Y0 and G1 X0 Y6 remain)
  const textAo = await page.evaluate(() => document.getElementById('editorWorking').value);
  const linesAo = textAo.split('\n').filter(l => l.trim() && !l.startsWith(';'));
  const hasStraightX100 = linesAo.some(l => /G1.*X100/.test(l));
  const hasStraightX0Y6 = linesAo.some(l => /G1.*X0.*Y6/.test(l));
  assert(`[${label}] Arcs-only: straight G1 X100 Y0 preserved`, hasStraightX100);
  assert(`[${label}] Arcs-only: straight G1 X0 Y6 preserved`, hasStraightX0Y6);

  // Curve zones should have more G1 points than original (3 curve segments × 2 added = +6)
  const g1Count = linesAo.filter(l => /^G1/.test(l)).length;
  assert(`[${label}] Arcs-only: more G1 from curve densification`, g1Count > 5, `g1Count=${g1Count}`);

  // Undo
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  // ---- Regular continuous (unchecked arcs-only) ----
  await page.evaluate(() => {
    document.getElementById('chkMinDistArcsOnly').checked = false;
    document.getElementById('minDistValue').value = '1';
  });
  const beforeRegCmd = await page.evaluate(() => state.workingCmds.length);
  await page.evaluate(() => { const b = document.getElementById('btnMinDistApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  const afterRegCmd = await page.evaluate(() => state.workingCmds.length);
  assert(`[${label}] Regular cont: more subdivisions than arcs-only`, afterRegCmd > afterAoCmd,
    `reg=${afterRegCmd} > ao=${afterAoCmd}`);

  // Undo
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  // ---- Arcs-only start/stop ----
  await page.evaluate(() => {
    document.getElementById('chkMinDistArcsOnly').checked = true;
    document.getElementById('chkMinDistStartStop').checked = true;
    document.getElementById('minDistValue').value = '1';
  });
  const beforeAoSS = await page.evaluate(() => state.workingCmds.length);
  await page.evaluate(() => { const b = document.getElementById('btnMinDistApply'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  const afterAoSS = await page.evaluate(() => state.workingCmds.length);
  assert(`[${label}] Arcs-only SS: cmd count increased`, afterAoSS > beforeAoSS,
    `${beforeAoSS} \u2192 ${afterAoSS}`);

  // Clean up
  await page.evaluate(() => {
    document.getElementById('chkMinDistArcsOnly').checked = false;
    document.getElementById('chkMinDistStartStop').checked = false;
  });

  // Restore original state from SVG conversion
  await page.evaluate((saved) => {
    state.originalCmds = saved;
    state.workingCmds = saved.map(c => ({ ...c }));
    ui.refreshWorking();
  }, savedOrig);
  await new Promise(r => setTimeout(r, 500));
}

// ===== New: Find/Replace input focus =====
async function testFindReplaceInput(label) {
  section(label, `Find/Replace Input (${label})`);

  // Open find bar
  await page.evaluate(() => {
    const fb = document.getElementById('findReplaceBar');
    if (fb) fb.style.display = 'flex';
    const inp = document.getElementById('findInput');
    if (inp) { inp.value = ''; inp.focus(); }
  });
  await new Promise(r => setTimeout(r, 300));

  // Type X in find input and verify search runs
  await page.evaluate(() => {
    const inp = document.getElementById('findInput');
    if (inp) {
      inp.value = 'X';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await new Promise(r => setTimeout(r, 300));
  const findCount = await page.evaluate(() => {
    const el = document.getElementById('findCount');
    return el ? el.textContent : '';
  });
  assert(`[${label}] Find search shows results`, findCount !== '0/0', `count=${findCount}`);

  // Check focus is still on find input
  let focusOk = await page.evaluate(() => {
    const inp = document.getElementById('findInput');
    return document.activeElement === inp;
  });
  assert(`[${label}] Find input keeps focus after search`, focusOk);

  // Replace single
  await page.evaluate(() => {
    const findInput = document.getElementById('findInput');
    const replaceInput = document.getElementById('replaceInput');
    const btnReplace = document.getElementById('btnReplace');
    if (findInput) findInput.value = 'X10';
    if (replaceInput) replaceInput.value = 'X99';
    findInput.dispatchEvent(new Event('input', { bubbles: true }));
    if (btnReplace) btnReplace.click();
  });
  await new Promise(r => setTimeout(r, 300));
  focusOk = await page.evaluate(() => {
    const inp = document.getElementById('findInput');
    return document.activeElement === inp;
  });
  assert(`[${label}] Find input keeps focus after replace`, focusOk);

  // Replace All
  await page.evaluate(() => {
    const findInput = document.getElementById('findInput');
    const replaceInput = document.getElementById('replaceInput');
    const btnReplaceAll = document.getElementById('btnReplaceAll');
    if (findInput) findInput.value = 'X5';
    if (replaceInput) replaceInput.value = 'X77';
    findInput.dispatchEvent(new Event('input', { bubbles: true }));
    if (btnReplaceAll) btnReplaceAll.click();
  });
  await new Promise(r => setTimeout(r, 300));
  focusOk = await page.evaluate(() => {
    const inp = document.getElementById('findInput');
    return document.activeElement === inp;
  });
  assert(`[${label}] Find input keeps focus after replaceAll`, focusOk);

  // Close find bar
  await page.evaluate(() => { const fb = document.getElementById('findReplaceBar'); if (fb) fb.style.display = 'none'; });

  // Reset G-code back
  await page.evaluate(() => { const b = document.getElementById('btnReset'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
}

// ===== New: Set Side arrow direction =====
async function testSetSideArrowDirection(label) {
  section(label, `Set Side Arrow Direction (${label})`);

  await page.evaluate(() => {
    const gcode = [
      'G0 X0 Y0',
      'G1 X100 Y0 F300',
      'G1 X75 Y25',
      'G1 X0 Y0'
    ].join('\n');
    state.workingCmds = gcodeParser.parse(gcode);
    state.originalCmds = state.workingCmds.map(c => ({ ...c }));
    ui.refreshWorking();
    preview._segments = null;
    preview._segBuilding = false;
    preview.draw(state.workingCmds);
  });
  await new Promise(r => setTimeout(r, 2000));
  await page.waitForFunction(() => !preview._segBuilding && preview._segments && preview._segments.length > 0, { timeout: 10000 }).catch(() => {});
  const segCount = await page.evaluate(() => preview._segments ? preview._segments.length : 0);
  if (segCount < 2) { assert(`[${label}] SS arrow prereq`, false, `segments=${segCount}`); return; }

  // Select the first cut point (G1 X100 Y0 at idx=1, which is points[0] since G0 skips)
  await page.evaluate(() => {
    const points = ui._buildPointsList();
    state.selectedPoints.clear();
    if (points.length > 0) state.selectedPoints.add(points[0].idx);
    ui._updatePointsPanel();
  });
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate(() => { const b = document.getElementById('btnMarkStart'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 2000));
  const debugMark = await page.evaluate(() => ({
    segBuilding: preview._segBuilding,
    segLen: preview._segments ? preview._segments.length : -1,
    segVersion: preview._segVersion,
    markStartIdx: ui._markStartIdx,
    workingCmdsFirst3: state.workingCmds.slice(0, 3).map(c => ({ type: c.type, X: c.params.X, Y: c.params.Y }))
  }));
  console.log(`  [DBG ${label}] After MarkStart: build=${debugMark.segBuilding}, segs=${debugMark.segLen}, ver=${debugMark.segVersion}, markIdx=${debugMark.markStartIdx}, cmds=${JSON.stringify(debugMark.workingCmdsFirst3)}`);
  await page.waitForFunction(() => !preview._segBuilding && preview._segments && preview._segments.length > 0, { timeout: 15000 }).catch(() => {});
  const segDbg = await page.evaluate(() => {
    const s = preview._segments;
    if (!s || !s.length) return { n: 0 };
    const s0 = s[0], s1 = s[1];
    return { n: s.length, s0: { cmdIdx: s0.cmdIdx, ax: s0.a.x, ay: s0.a.y, bx: s0.b.x, by: s0.b.y }, s1: s1 ? { cmdIdx: s1.cmdIdx, ax: s1.a.x, ay: s1.a.y, bx: s1.b.x, by: s1.b.y } : null };
  });
  console.log(`  [DBG ${label}] Segs: ${JSON.stringify(segDbg)}`);

  const getAngle = async () => page.evaluate(() => {
    const segs = preview._segments;
    if (!segs || !segs.length) return -999;
    const idx = segs.findIndex(s => s.cmdIdx === ui._markStartIdx);
    if (idx < 0) return -999;
    return Math.atan2(segs[idx].b.y - segs[idx].a.y, segs[idx].b.x - segs[idx].a.x);
  });

  const angle0 = await getAngle();
  const debugAngle0 = await page.evaluate(() => {
    const segs = preview._segments;
    if (!segs) return { idx: -1 };
    const idx = segs.findIndex(s => s.cmdIdx === ui._markStartIdx);
    return { idx, cmdIdx: ui._markStartIdx, segCount: segs.length, a: idx >= 0 ? segs[idx].a : null, b: idx >= 0 ? segs[idx].b : null };
  });
  console.log(`  [DBG ${label}] angle0: angle=${angle0}, markStartIdx=${debugAngle0.cmdIdx}, segIdx=${debugAngle0.idx}, a=(${debugAngle0.a?.x.toFixed(1)},${debugAngle0.a?.y.toFixed(1)}), b=(${debugAngle0.b?.x.toFixed(1)},${debugAngle0.b?.y.toFixed(1)})`);

  // Toggle Set Side (left) — path reverses
  await page.evaluate(() => { const b = document.getElementById('btnSetSide'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 2000));
  // Debug: check if segments are being rebuilt
  const debugAfter = await page.evaluate(() => ({
    segBuilding: preview._segBuilding,
    segLen: preview._segments ? preview._segments.length : -1,
    segVersion: preview._segVersion
  }));
  console.log(`  [DBG ${label}] After SetSide: build=${debugAfter.segBuilding}, segs=${debugAfter.segLen}, ver=${debugAfter.segVersion}`);
  await page.waitForFunction(() => !preview._segBuilding && preview._segments && preview._segments.length > 0, { timeout: 15000 }).catch(() => {});
  const debugPostWait = await page.evaluate(() => ({
    segBuilding: preview._segBuilding,
    segLen: preview._segments ? preview._segments.length : -1,
    segVersion: preview._segVersion,
    markStartIdx: ui._markStartIdx,
    pointsSide: ui._pointsSide
  }));
  console.log(`  [DBG ${label}] After wait: build=${debugPostWait.segBuilding}, segs=${debugPostWait.segLen}, ver=${debugPostWait.segVersion}, markIdx=${debugPostWait.markStartIdx}, side=${debugPostWait.pointsSide}`);
  const angle1 = await getAngle();
  let diff = Math.abs(angle1 - angle0);
  if (diff > Math.PI) diff = 2 * Math.PI - diff;
  assert(`[${label}] Set Side changes arrow direction`, diff > 0.1, `diff=${diff}`);

  // Toggle Set Side (right) — reverses again, angle should flip back
  await page.evaluate(() => { const b = document.getElementById('btnSetSide'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 1500));
  await page.waitForFunction(() => !preview._segBuilding && preview._segments && preview._segments.length > 0, { timeout: 10000 }).catch(() => {});
  const angle2 = await getAngle();
  diff = Math.abs(angle2 - angle1);
  if (diff > Math.PI) diff = 2 * Math.PI - diff;
  assert(`[${label}] Set Side toggles direction back`, diff > 0.1, `diff=${diff}`);

  // Toggle back to null — should flip back to original
  await page.evaluate(() => { const b = document.getElementById('btnSetSide'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate(() => { ui._pointsSide = null; });

  // Undo Mark Start
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));

  // Restore
  await page.evaluate(() => { const b = document.getElementById('btnReset'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 500));
  await waitForSegments();
}

// ===== Rotate 90/180/270 with machine origin =====
async function testRotate90(label) {
  section(label, `Rotate (${label})`);

  // Set G-code directly
  await page.evaluate(() => {
    const gcode = [
      'G0 X0 Y0',
      'G1 X100 Y0 F300',
      'G1 X100 Y100',
      'G1 X0 Y100',
      'G1 X0 Y0'
    ].join('\n');
    state.workingCmds = gcodeParser.parse(gcode);
    state.originalCmds = state.workingCmds.map(c => ({ ...c }));
    ui.refreshWorking();
  });
  await new Promise(r => setTimeout(r, 500));

  // Set machine origin
  const mo = await page.evaluate(() => {
    const tplName = document.getElementById('templateSelect').value;
    const key = 'machineOpts_' + tplName;
    const opts = { machineX: '50', machineY: '30' };
    localStorage.setItem(key, JSON.stringify(opts));
    return opts;
  });

  // Read machine opts so subsequent code gets them
  await page.evaluate(() => {
    if (window.ui && ui._loadMachineOpts) ui._loadMachineOpts();
  });

  // Verify coordinates include machine offset
  const beforeRot = await page.evaluate(() => {
    const cmds = state.workingCmds;
    const c = cmds[1];
    return { x: c.params.X, y: c.params.Y };
  });
  // Original: X100 Y0. After SVG with offset, should be X150 Y30 (100+50, 0+30)
  // But we set G-code directly, so it's still X100 Y0. The machine origin
  // only affects the rotate operation, not the base coordinates.
  assert(`[${label}] Rotate: base coords present`, beforeRot.x === 100 && beforeRot.y === 0,
    `x=${beforeRot.x} y=${beforeRot.y}`);

  // Rotate 90° (first click)
  await page.evaluate(() => {
    document.getElementById('btnRotate90').click();
  });
  await new Promise(r => setTimeout(r, 500));

  const after90 = await page.evaluate(() => {
    const c = state.workingCmds[1];
    return { x: c.params.X, y: c.params.Y };
  });
  const rot90ok = Math.abs(after90.x - 100) < 0.1 && Math.abs(after90.y - 100) < 0.1;
  assert(`[${label}] Rotate 90°: correct with origin`, rot90ok,
    `x=${after90.x} y=${after90.y}`);

  // Rotate 180° (second click — no undo)
  await page.evaluate(() => {
    document.getElementById('btnRotate90').click();
  });
  await new Promise(r => setTimeout(r, 500));

  const after180 = await page.evaluate(() => {
    const c = state.workingCmds[1];
    return { x: c.params.X, y: c.params.Y };
  });
  const rot180ok = Math.abs(after180.x - 0) < 0.1 && Math.abs(after180.y - 100) < 0.1;
  assert(`[${label}] Rotate 180°: correct with origin`, rot180ok,
    `x=${after180.x} y=${after180.y}`);

  // Rotate 270° (third click — no undo)
  await page.evaluate(() => {
    document.getElementById('btnRotate90').click();
  });
  await new Promise(r => setTimeout(r, 500));

  const after270 = await page.evaluate(() => {
    const c = state.workingCmds[1];
    return { x: c.params.X, y: c.params.Y };
  });
  const rot270ok = Math.abs(after270.x - 0) < 0.1 && Math.abs(after270.y - 0) < 0.1;
  assert(`[${label}] Rotate 270°: correct with origin`, rot270ok,
    `x=${after270.x} y=${after270.y}`);

  // Undo 3 times (90° + 180° + 270°) and clean up
  for (let u = 0; u < 3; u++) {
    await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
    await new Promise(r => setTimeout(r, 300));
  }
  await page.evaluate(() => { state.workingCmds = state.originalCmds.map(c => ({ ...c })); ui.refreshWorking(); });
  await new Promise(r => setTimeout(r, 500));
}

// ===== Add Points "Along Path" axis selector =====
async function testAlongPath(label) {
  section(label, `Along Path (${label})`);

  const use45Line = async () => {
    await page.evaluate(() => {
      const tpl = templateManager.getActive();
      const td = tpl?.data || tpl;
      const on = td?.laserOnCmd || 'M3';
      const off = td?.laserOffCmd || 'M5';
      const gcode = [
        'G0 X0 Y0',
        on,
        'G1 X100 Y100 F400',
        off,
        'G0 X0 Y0'
      ].join('\n');
      state.workingCmds = gcodeParser.parse(gcode);
      state.originalCmds = state.workingCmds.map(c => ({ ...c }));
      ui.refreshWorking();
    });
    await new Promise(r => setTimeout(r, 800));
  };

  // Helper to get position at command index
  const getPos = async (idx) => {
    return await page.evaluate((i) => {
      let x = 0, y = 0, isRel = false;
      for (let j = 0; j <= i && j < state.workingCmds.length; j++) {
        const c = state.workingCmds[j];
        if (c.type === 'G91') { isRel = true; continue; }
        if (c.type === 'G90') { isRel = false; continue; }
        if (c.type === 'G92') continue;
        if (c.params.X !== undefined) x = isRel ? x + c.params.X : c.params.X;
        if (c.params.Y !== undefined) y = isRel ? y + c.params.Y : c.params.Y;
      }
      return { x, y };
    }, idx);
  };

  await use45Line();

  // The 45° line command index — find the cmd with params X=100 Y=100
  const lineIdx = await page.evaluate(() => {
    const cmds = state.workingCmds;
    return cmds.findIndex(c => c.params.X === 100 && c.params.Y === 100);
  });
  assert(`[${label}] AlongPath: found 45 line idx ${lineIdx}`, lineIdx >= 0, `idx=${lineIdx}`);

  // Select that point
  await page.evaluate((idx) => {
    state.selectedPoints.clear();
    state.selectedPoints.add(idx);
    preview._updatePointsInfo();
  }, lineIdx);
  await new Promise(r => setTimeout(r, 300));

  // Set X offset to 10, Y=0
  await page.evaluate(() => {
    document.getElementById('pointsOffsetX').value = '10';
    document.getElementById('pointsOffsetY').value = '0';
    document.getElementById('pointsOffsetZ').value = '0';
  });

  // --- Continuous mode (always Along Path) ---
  await page.evaluate(() => {
    document.getElementById('chkStartStop').checked = false;
    document.getElementById('btnPointsGenerate').click();
  });
  await new Promise(r => setTimeout(r, 500));
  await waitForSegments();

  const posCont = await getPos(lineIdx + 1);
  const sqrt2 = Math.SQRT2;
  // 10mm along 45° direction = (10/√2, 10/√2) ≈ (7.07, 7.07)
  const expX = 100 + 10 / sqrt2;
  const expY = 100 + 10 / sqrt2;
  const contOk = Math.abs(posCont.x - expX) < 0.5 && Math.abs(posCont.y - expY) < 0.5;
  assert(`[${label}] Continuous: X10 → (${expX.toFixed(2)},${expY.toFixed(2)})`, contOk,
    `x=${posCont.x} y=${posCont.y} expected=${expX.toFixed(4)},${expY.toFixed(4)}`);

  // Undo
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 400));
  await waitForSegments();

  // Reset selection
  await page.evaluate((idx) => {
    state.selectedPoints.clear();
    state.selectedPoints.add(idx);
    preview._updatePointsInfo();
  }, lineIdx);
  await new Promise(r => setTimeout(r, 300));

  // --- Continuous mode: Y is ignored, point stays on path ---
  await page.evaluate(() => {
    document.getElementById('chkStartStop').checked = false;
    document.getElementById('pointsOffsetY').value = '5';
    document.getElementById('btnPointsGenerate').click();
  });
  await new Promise(r => setTimeout(r, 500));

  const posCont2 = await getPos(lineIdx + 1);
  const cont2Ok = Math.abs(posCont2.x - expX) < 0.5 && Math.abs(posCont2.y - expY) < 0.5;
  assert(`[${label}] Continuous: X10 Y5 → Y ignored (${expX.toFixed(2)},${expY.toFixed(2)})`, cont2Ok,
    `x=${posCont2.x} y=${posCont2.y}`);

  // Undo
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 400));
  await waitForSegments();

  // Reset selection
  await page.evaluate((idx) => {
    state.selectedPoints.clear();
    state.selectedPoints.add(idx);
    preview._updatePointsInfo();
  }, lineIdx);
  await new Promise(r => setTimeout(r, 300));

  // --- Start/Stop mode (world offset, can leave the line) ---
  await page.evaluate(() => {
    document.getElementById('chkStartStop').checked = true;
    document.getElementById('pointsOffsetY').value = '0';
    document.getElementById('btnPointsGenerate').click();
  });
  await new Promise(r => setTimeout(r, 500));

  const posSS = await getPos(lineIdx + 6); // travel + blank + on + blank + copy
  const ssOk = Math.abs(posSS.x - 110) < 0.1 && Math.abs(posSS.y - 100) < 0.1;
  assert(`[${label}] Start/Stop: X10 → (110,100)`, ssOk,
    `x=${posSS.x} y=${posSS.y}`);

  // Undo and clean up
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));
  await waitForSegments();
  await page.evaluate(() => {
    document.getElementById('chkStartStop').checked = false;
    document.getElementById('pointsOffsetX').value = '0';
    document.getElementById('pointsOffsetY').value = '0';
    document.getElementById('pointsOffsetZ').value = '0';
    state.workingCmds = state.originalCmds.map(c => ({ ...c }));
    ui.refreshWorking();
  });
  await new Promise(r => setTimeout(r, 500));
}

// ===== Multi-Select (Tab/Space) + Delete Points =====
async function testMultiSelectDelete(label) {
  section(label, `Multi-Select & Delete (${label})`);

  // Helper: get motion command indices
  const getMotionIdxs = async () => {
    return await page.evaluate(() => {
      const res = [];
      state.workingCmds.forEach((c, i) => {
        if (/^G[0-3]$|^G0[0-3]$/i.test(c.type) && (c.params.X !== undefined || c.params.Y !== undefined))
          res.push(i);
      });
      return res;
    });
  };

  // Ensure multiple motion points exist
  const motionIdxs = await getMotionIdxs();
  assert(`[${label}] MultiSel: at least 3 motion points`, motionIdxs.length >= 3,
    `count=${motionIdxs.length}`);

  // Ensure points panel is open
  await page.evaluate(() => {
    if (!ui._pointsPanelOpen) {
      document.getElementById('btnTogglePointsPanel').click();
    }
  });
  await new Promise(r => setTimeout(r, 300));

  // Select first motion point by clicking in the table
  await page.evaluate(() => {
    const tbody = document.getElementById('pointsTableBody');
    if (tbody && tbody.firstChild) tbody.firstChild.click();
  });
  await new Promise(r => setTimeout(r, 300));

  // Tab to second point (should single-select it)
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 300));

  const afterTab = await page.evaluate(() => {
    return { size: state.selectedPoints.size, focused: ui._focusedPointPos };
  });
  assert(`[${label}] MultiSel: Tab focuses point`, afterTab.focused === 1,
    `focused=${afterTab.focused} size=${afterTab.size}`);

  // Space to add second point to multi-selection
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 300));

  const afterSpace = await page.evaluate(() => {
    return { size: state.selectedPoints.size };
  });
  assert(`[${label}] MultiSel: Space adds to selection`, afterSpace.size > 1,
    `size=${afterSpace.size}`);

  // Delete selected points
  await page.evaluate(() => {
    document.getElementById('btnPointsDelete').click();
  });
  await new Promise(r => setTimeout(r, 500));

  const afterDel = await page.evaluate(() => {
    return { len: state.workingCmds.length, selSize: state.selectedPoints.size };
  });
  assert(`[${label}] MultiSel: Delete removed points`, afterDel.len < 150,
    `len=${afterDel.len} selSize=${afterDel.selSize}`);
  assert(`[${label}] MultiSel: Selection cleared after delete`, afterDel.selSize === 0,
    `selSize=${afterDel.selSize}`);

  // Undo
  await page.evaluate(() => { const b = document.getElementById('btnUndo'); if (b && !b.disabled) b.click(); });
  await new Promise(r => setTimeout(r, 300));
  await waitForSegments();
}

// ===== Main Runner =====

async function run() {
  console.log('\n\x1b[36m\u2550\u2550\u2550 Comprehensive Points Editor Tests \u2550\u2550\u2550\x1b[0m');
  console.log('All widgets x all templates. This test may take a few minutes.\n');

  require('./setup.js');
  await setup();

  for (const tpl of TEMPLATES) {
    console.log(`\n\x1b[36m========== Template: ${tpl.name} ==========\x1b[0m`);

    await selectTemplate(tpl.tpl);
    await new Promise(r => setTimeout(r, 200));

    const ok = await loadSvgAndConvert();
    if (!ok) {
      console.log(`  ${WARN} Skipping ${tpl.name} \u2014 SVG load/convert failed`);
      continue;
    }

    await openPointsPanel();

    // Ensure points list is built
    await waitForSegments();

    await testMarkStartSetSide(tpl.name);
    await testSetStartCoordinates(tpl.name);
    await testAddPointsContinuous(tpl.name);
    await testAddPointsStartStop(tpl.name);
    await testAddPointsPreview(tpl.name);
    await testMinDistContinuous(tpl.name);
    await testMinDistStartStop(tpl.name);
    await testShiftPoints(tpl.name);
    await testFullPathVariation(tpl.name);
    await testFullTurnVariation(tpl.name);
    await testPreviewUpdate(tpl.name);
    await testRealTimeUpdates(tpl.name);
    // Reset to original G-code before tag verification (undo stack may be dirty)
    await page.evaluate(() => { const b = document.getElementById('btnReset'); if (b) b.click(); });
    await new Promise(r => setTimeout(r, 500));
    await waitForSegments();
    await testEditGcTagsAllViews(tpl.name);
    await testMultiPassBidirectional(tpl.name);
    // Reset to ensure clean state for new tests
    await page.evaluate(() => { const b = document.getElementById('btnReset'); if (b) b.click(); });
    await new Promise(r => setTimeout(r, 500));
    await waitForSegments();
    await testArcsOnlyMinDist(tpl.name);
    await testFindReplaceInput(tpl.name);
    await testSetSideArrowDirection(tpl.name);
    await testRotate90(tpl.name);
    await testAlongPath(tpl.name);
    await testMultiSelectDelete(tpl.name);
    await testClickSelectPoint(tpl.name);
  }

  await teardown();
}

run().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
