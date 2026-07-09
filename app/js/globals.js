// ── Globals used across modules ───────────────────────────────
let originMarkMode = null; // 'left' | 'right' | null for mark placement
let measureMode = false;
let measureStart = null; // { x, y } in world coords
let measureEnd = null;   // { x, y } in world coords
let pickMode = false;

const previewOpts = {
  showBounds: true,
  colorByFeed: false,
  compareMode: false,
  showMinimap: true,
};
