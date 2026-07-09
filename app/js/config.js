// ── Application Configuration ──────────────────────────────
const CFG = {
  // Editor limits
  EDITOR_LINE_LIMIT: 200000,
  HL_LIMIT: 15000,

  // Preview / segment builder
  SEGMENT_CHUNK: 5000,
  MAX_SEGMENTS: 4000000,
  ARC_STEP_MM: 0.8,
  ARC_MAX_THETA: Math.PI / 18,
  ARC_MAX_SEGS: 800,

  // Chunked drawing
  DRAW_CHUNK: 2000,
  DRAW_CHUNK_THRESHOLD: 3000,

  // Playback
  PLAY_SPEED_DEFAULT: 30,
  PLAY_SPEED_MAX: 500,

  // Estimate times
  CUT_FEED_ESTIMATE: 500,
  RAPID_FEED_ESTIMATE: 3000,

  // Grid
  GRID_STEP_CANDIDATES: [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000],
  GRID_MIN_CELL_PX: 50,

  // Canvas
  PREVIEW_PAD: 40,
  SMAX: 1000,
};
