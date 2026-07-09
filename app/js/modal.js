// â”€â”€ Modais â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function openModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.add('open');
  if (id === 'modal-preview') {
    const mc = document.getElementById('previewCanvasModal');
    // aguardar frame para o modal estar visÃ­vel e ter dimensÃµes correctas
    requestAnimationFrame(() => {
      mc.width  = mc.offsetWidth;
      mc.height = mc.offsetHeight;
      preview.canvas = mc;
      preview.ctx    = mc.getContext('2d');
      // pan/zoom no canvas do modal â€” setup once
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
          if (pickMode) {
            preview._handlePickClick(e);
          } else if (measureMode) {
            preview._handleMeasureClick(e);
          } else if (originMarkMode) {
            preview._setMarkFromClick(e);
          } else if (state.mode === 'gcode') {
            preview._selectPointFromClick(e);
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
}
function closeModalOutside(e, id) {
  if (e.target.id === id) closeModal(id);
}
