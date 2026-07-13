// ---- Drag & Drop handler ----------------------------------------------------------------------------------
async function handleDroppedFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (['gcode','gc','nc','cnc','tap','mpf','iso','min','eia','ncc','pnc','plt','hpgl','spf','din','g','ngc','prg','txt'].includes(ext)) {
    // Treat as G-code
    ui.clearState();
    const text = await fileManager.readGcode(file);
    state.originalCmds  = gcodeParser.parse(text);
    if (!state.originalCmds.length && text.length > 100000) {
      ui.setStatus('File too large — showing lightweight preview.', 'error');
    }
    const isLarge = text.length > 5 * 1024 * 1024 || state.originalCmds.length > 50000;
    state.originalText  = isLarge ? '' : text;
    state.originalName  = file.name;
    state.workingCmds   = state.originalCmds.map(c => ({ ...c }));
    // Free original commands for large files to save memory
    if (state.originalCmds.length > 50000) state.originalCmds = [];
    state.dirty         = false;
    state.previewScale  = 1;
    state.previewOffX   = 0;
    state.previewOffY   = 0;
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
    document.getElementById('btnConvertSvg').disabled = true;
    document.getElementById('btnConvertDxf').disabled = true;
  } else if (ext === 'svg') {
    document.getElementById('fileInputSvg').files = new DataTransfer().files; // clear
    // Reuse the SVG load flow by dispatching to the same handler
    const input = document.getElementById('fileInputSvg');
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  } else if (ext === 'dxf') {
    document.getElementById('fileInputSvg').files = new DataTransfer().files; // clear
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

