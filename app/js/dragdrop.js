// ---- Drag & Drop handler ----------------------------------------------------------------------------------
async function handleDroppedFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (['gcode','gc','nc','cnc','tap','mpf','iso','min','eia','ncc','pnc','plt','hpgl','spf','din','g','ngc','prg','txt','src'].includes(ext)) {
    ui.clearState();
    const text = await fileManager.readGcode(file);

    const isSrc = /\.src$/i.test(file.name);
    if (isSrc) {
      const parsedSrc = kukaConverter.parseSrc(text);
      state._kukaParsedSrc = parsedSrc;
      state._kukaDatPoints = {};
      const dummyDat = {};
      for (const m of parsedSrc.motions) {
        if (m.pointIdx && !dummyDat[m.pointIdx]) {
          dummyDat[m.pointIdx] = { x: m.pointIdx * 5, y: m.pointIdx * 3, z: 0 };
        }
      }
      state.originalCmds = kukaConverter.toGcode(parsedSrc, dummyDat);
      state.workingCmds = state.originalCmds.map(c => ({...c}));
      state.originalText = text;
      state.originalName = file.name;
      state.dirty = false;
      state.previewScale = 1;
      state.previewOffX = 0;
      state.previewOffY = 0;
      document.getElementById('editorOriginal').value = truncateForEditor(text);
      document.getElementById('editorWorking').value = gcodeParser.serialize(state.workingCmds);
      applyHighlight(document.getElementById('highlightOriginal'), text);
      applyHighlight(document.getElementById('highlightWorking'), gcodeParser.serialize(state.workingCmds));
      preview.resize();
      preview.fitView();
      document.getElementById('btnLoadKukaDat').style.display = '';
      ui.setStatus('KUKA .src loaded: ' + file.name + ' (' + parsedSrc.motions.length + ' motions). Load .dat for real coords.');
      ui.syncModals();
      ui.updateFooterInfo();
      ui.updateResizePanel();
      recentFiles.add(file.name, 'KUKA .src', text);
      const _rs = document.getElementById('recentFilesSelect');
      if (_rs) recentFiles.populateSelect(_rs);
      document.getElementById('btnSlice').disabled = true;
      return;
    }

    state.originalCmds  = gcodeParser.parse(text);
    if (!state.originalCmds.length && text.length > 100000) {
      ui.setStatus('File too large ? showing lightweight preview.', 'error');
    }
    const isLarge = text.length > 5 * 1024 * 1024 || state.originalCmds.length > 50000;
    state.originalText  = isLarge ? '' : text;
    state.originalName  = file.name;
    state.workingCmds   = state.originalCmds.map(c => ({ ...c }));
    if (state.originalCmds.length > 50000) state.originalCmds = [];
    state.dirty         = false;
    preview._zoomToFit();
    const editorText = isLarge ? '(original text too large for editor)' : truncateForEditor(text);
    document.getElementById('editorOriginal').value = editorText;
    document.getElementById('editorWorking').value = editorText;
    preview.resize();
    ui.setStatus(`Opened: ${file.name} (${state.workingCmds.length} lines)`);
    ui.syncModals();
    if (recentFiles) recentFiles.add(file.name, 'G-code');
    const _rs = document.getElementById('recentFilesSelect');
    if (_rs) recentFiles.populateSelect(_rs);
    ui.updateFooterInfo();
    applyHighlight(document.getElementById('highlightOriginal'), isLarge ? '' : text);
    applyHighlight(document.getElementById('highlightWorking'), isLarge ? '' : text);
    document.getElementById('btnSlice').disabled = true;
    document.getElementById('btnLoadKukaDat').style.display = 'none';
  } else if (ext === 'dat') {
    const text = await fileManager.readGcode(file);
    const points = kukaConverter.parseDat(text);
    state._kukaDatPoints = points;
    const parsedSrc = state._kukaParsedSrc;
    if (!parsedSrc) {
      const keys = Object.keys(points).sort((a, b) => a - b);
      if (!keys.length) { ui.setStatus('.dat has no E6POS points.', 'error'); return; }
      const cmds = [{ type: 'M3', params: {}, raw: 'M3' }];
      for (const k of keys) {
        const p = points[k];
        cmds.push({ type: 'G1', params: { X: p.x, Y: p.y, Z: p.z, F: 3000 }, raw: 'G1 X' + p.x + ' Y' + p.y + ' Z' + p.z + ' F3000' });
      }
      cmds.push({ type: 'M5', params: {}, raw: 'M5' });
      state.originalCmds = cmds.map(c => ({...c}));
      state.workingCmds = cmds.map(c => ({...c}));
      state.originalText = gcodeParser.serialize(cmds);
      state.originalName = file.name.replace('.dat', '.gcode');
      state.dirty = false;
      const gcodeText = gcodeParser.serialize(cmds);
      document.getElementById('editorOriginal').value = gcodeText;
      document.getElementById('editorWorking').value = gcodeText;
      applyHighlight(document.getElementById('highlightOriginal'), gcodeText);
      applyHighlight(document.getElementById('highlightWorking'), gcodeText);
      preview.resize();
      preview.fitView();
      ui.syncModals();
      ui.updateFooterInfo();
      ui.updateResizePanel();
      recentFiles.add(file.name, 'KUKA .dat', text);
      const _rs2 = document.getElementById('recentFilesSelect');
      if (_rs2) recentFiles.populateSelect(_rs2);
      ui.setStatus('.dat loaded: ' + keys.length + ' E6POS points -> G-code (M3/M5 wrapped).');
      return;
    }
    const cmds = kukaConverter.toGcode(parsedSrc, points);
    state.originalCmds = cmds.map(c => ({...c}));
    state.workingCmds = cmds.map(c => ({...c}));
    state.dirty = false;
    const gcodeText = gcodeParser.serialize(cmds);
    document.getElementById('editorWorking').value = gcodeText;
    applyHighlight(document.getElementById('highlightWorking'), gcodeText);
    preview.resize();
    preview.fitView();
    ui.syncModals();
    ui.updateFooterInfo();
    ui.updateResizePanel();
    recentFiles.add(file.name, 'KUKA .dat', text);
    const _rs3 = document.getElementById('recentFilesSelect');
    if (_rs3) recentFiles.populateSelect(_rs3);
    ui.setStatus('KUKA .dat loaded: ' + file.name + ' (' + Object.keys(points).length + ' points). G-code updated.');
  } else if (ext === 'svg') {
    // Reuse the SVG load flow by dispatching to the same handler
    const input = document.getElementById('fileInputSvg');
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  } else if (ext === 'dxf') {
    const input = document.getElementById('fileInputDxf');
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  } else {
    ui.setStatus(`Unsupported file type: .${ext}`, 'error');
  }
}

function setupDragDrop(zone) {
  const addBodyClass = () => document.body.classList.add('drag-over-file');
  const rmBodyClass = () => document.body.classList.remove('drag-over-file');
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); addBodyClass(); });
  zone.addEventListener('dragleave', () => { zone.classList.remove('drag-over'); rmBodyClass(); });
  document.addEventListener('drop', async e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    rmBodyClass();
    const files = e.dataTransfer.files;
    if (!files.length) return;
    for (const f of files) await handleDroppedFile(f);
  });
}

