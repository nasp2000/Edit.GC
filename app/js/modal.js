// ---- Modais --------------------------------------------------------------------------------------------------------
function openModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.add('open');
  if (id === 'modal-preview') {
    const mc = document.getElementById('previewCanvasModal');
    // aguardar frame para o modal estar visivel e ter dimenses correctas
    requestAnimationFrame(() => {
      const dpr = window.devicePixelRatio || 1;
      mc.width  = Math.floor(mc.offsetWidth * dpr);
      mc.height = Math.floor(mc.offsetHeight * dpr);
      mc.style.width  = mc.offsetWidth + 'px';
      mc.style.height = mc.offsetHeight + 'px';
      const ctx = mc.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      preview.canvas = mc;
      preview.ctx    = ctx;
      // pan/zoom no canvas do modal ? setup once
      if (!mc._panZoomReady) {
        mc._panZoomReady = true;
        let dragging = false, lastX = 0, lastY = 0;
        let rafPending = false;
        const scheduleDraw = () => {
          if (!rafPending) {
            rafPending = true;
            requestAnimationFrame(() => {
              rafPending = false;
              preview.draw(state.workingCmds);
            });
          }
        };
        const onWheel = e => {
          e.preventDefault();
          state.previewScale *= e.deltaY < 0 ? 1.1 : 0.9;
          scheduleDraw();
        };
        mc.addEventListener('wheel', onWheel, { passive: false });
        mc.addEventListener('mousedown', e => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
        // Click handler for modal canvas
        mc.addEventListener('click', e => {
          if (e.clientX !== lastX || e.clientY !== lastY) return;
          if (state.mode === 'gcode') {
            preview._selectPointFromClick(e, mc);
          }
        });
        const onMouseUp = () => { dragging = false; };
        const onMouseMove = e => {
          if (!dragging) return;
          state.previewOffX += e.clientX - lastX;
          state.previewOffY += e.clientY - lastY;
          lastX = e.clientX; lastY = e.clientY;
          scheduleDraw();
        };
        window.addEventListener('mouseup', onMouseUp);
        window.addEventListener('mousemove', onMouseMove);
        // Store refs for cleanup
        mc._wheelHandler = onWheel;
        mc._mouseUpHandler = onMouseUp;
        mc._mouseMoveHandler = onMouseMove;
      }
      preview.draw(state.workingCmds);
      // Setup drag-drop on modal canvas once
      const modalWrap = document.getElementById('modalPreviewWrap');
      if (modalWrap && !modalWrap._ddInit) {
        modalWrap._ddInit = true;
        setupDragDrop(modalWrap);
      }
    });
  }
}
function closeModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.remove('open');
  if (id === 'modal-preview') {
    // Remove window-level event listeners added by modal setup
    const mc = document.getElementById('previewCanvasModal');
    if (mc && mc._mouseUpHandler) {
      window.removeEventListener('mouseup', mc._mouseUpHandler);
      window.removeEventListener('mousemove', mc._mouseMoveHandler);
      mc._mouseUpHandler = null;
      mc._mouseMoveHandler = null;
    }
    // restaurar canvas principal
    preview.canvas = document.getElementById('previewCanvas');
    preview.ctx    = preview.canvas.getContext('2d');
    preview.resize();
  }
  if (id === 'modal-gcode') {
    const bar = document.getElementById('mFindReplaceBar');
    if (bar) bar.style.display = 'none';
  }
}
function closeModalOutside(e, id) {
  if (e.target.id === id) closeModal(id);
}

// ---- G-code modal tab switching ------------------------------------------------------------------------------------
function openGcodeModal(tab) {
  openModal('modal-gcode');
  window._gcodeModalTab(tab || 'original');
}
window._gcodeModalTab = function(tab) {
  const m = document.getElementById('modal-gcode');
  if (!m) return;
  m.dataset.gtab = tab;
  document.querySelectorAll('#gcodeModalTabs .editor-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.gtab === tab);
  });
  const isOriginal = tab === 'original';
  const isDual = tab === 'dual';
  const origWrap = document.getElementById('gcodeModalOrigWrap');
  const singleWrap = document.getElementById('gcodeModalSingle');
  const dualWrap = document.getElementById('gcodeModalDual');
  const workingTools = document.querySelector('.gcode-working-tools');
  if (isOriginal) {
    singleWrap.style.display = 'flex';
    origWrap.style.display = 'flex';
    origWrap.previousElementSibling.style.display = 'none';
    dualWrap.style.display = 'none';
    if (workingTools) workingTools.style.display = 'none';
  } else if (isDual) {
    singleWrap.style.display = 'none';
    dualWrap.style.display = 'flex';
    if (workingTools) workingTools.style.display = 'none';
    setupGcodeDualScrollSync();
    syncGcodeDualEditors();
  } else {
    singleWrap.style.display = 'flex';
    origWrap.style.display = 'none';
    origWrap.previousElementSibling.style.display = '';
    dualWrap.style.display = 'none';
    if (workingTools) workingTools.style.display = '';
  }
  syncGcodeEditors();
};
function syncGcodeEditors() {
  const m = document.getElementById('modal-gcode');
  if (!m || !m.classList.contains('open')) return;
  const tab = m.dataset.gtab || 'working';
  if (tab === 'dual') { syncGcodeDualEditors(); return; }
  const wm = document.getElementById('editorWorkingModal');
  const om = document.getElementById('editorOriginalModal');
  if (wm && tab === 'working') {
    const tWork = truncateForEditor(gcodeParser.serialize(state.workingCmds));
    wm.value = tWork;
    applyHighlight(document.getElementById('highlightWorkingModal'), tWork);
  }
  if (om && tab === 'original') {
    const tOrig = truncateForEditor(state.originalText || (state.originalCmds.length ? gcodeParser.serialize(state.originalCmds) : ''));
    om.value = tOrig;
    applyHighlight(document.getElementById('highlightOriginalModal'), tOrig);
  }
}
function syncGcodeDualEditors() {
  const om = document.getElementById('editorOriginalModalDual');
  const wm = document.getElementById('editorWorkingModalDual');
  if (om) {
    const tOrig = truncateForEditor(state.originalText || (state.originalCmds.length ? gcodeParser.serialize(state.originalCmds) : ''));
    om.value = tOrig;
    applyHighlight(document.getElementById('highlightOriginalModalDual'), tOrig);
  }
  if (wm) {
    const tWork = truncateForEditor(gcodeParser.serialize(state.workingCmds));
    wm.value = tWork;
    applyHighlight(document.getElementById('highlightWorkingModalDual'), tWork);
  }
}
window._gcodeDualScrollSync = false;
function setupGcodeDualScrollSync() {
  if (window._gcodeDualScrollSync) return;
  window._gcodeDualScrollSync = true;
  setupScrollSync('editorOriginalModalDual', 'highlightOriginalModalDual', 'linesOriginalModalDual');
  setupScrollSync('editorWorkingModalDual', 'highlightWorkingModalDual', 'linesWorkingModalDual');
  const orig = document.getElementById('editorOriginalModalDual');
  const work = document.getElementById('editorWorkingModalDual');
  const origHl = document.getElementById('highlightOriginalModalDual');
  const workHl = document.getElementById('highlightWorkingModalDual');
  const origLines = document.getElementById('linesOriginalModalDual');
  const workLines = document.getElementById('linesWorkingModalDual');
  let syncing = false;
  const syncScroll = (source, target, hlSource, hlTarget, linesSource, linesTarget) => {
    if (syncing) return;
    syncing = true;
    target.scrollTop = source.scrollTop;
    target.scrollLeft = source.scrollLeft;
    if (hlTarget) { hlTarget.scrollTop = source.scrollTop; hlTarget.scrollLeft = source.scrollLeft; }
    if (linesTarget) linesTarget.scrollTop = source.scrollTop;
    if (linesSource) linesSource.scrollTop = source.scrollTop;
    syncing = false;
  };
  if (orig && work) {
    orig.addEventListener('scroll', () => syncScroll(orig, work, origHl, workHl, origLines, workLines));
    work.addEventListener('scroll', () => syncScroll(work, orig, workHl, origHl, workLines, origLines));
  }
}
