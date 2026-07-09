# Edit.GC — Development Update & Roadmap

## Current Status
The Edit.GC G-code editor has received a major round of improvements focused on handling large files, correct relative-mode rendering, and a modernized 2D preview. This document captures what is already in place and what remains to make the app robust and top-tier for G-code editing and preview.

---

## ✅ Completed

### Preview Engine (2D)
- **Segment-based rendering**: G-code is parsed once into a `{ points[], segments[] }` structure and rendered from segments instead of re-parsing on every frame.
- **G90/G91 support**: Relative and absolute positioning are tracked correctly during segment build.
- **Arc support**: `G2`/`G3` arcs in the XY plane are subdivided into linear segments (supports both `I,J` and `R` forms).
- **G20/G21 units**: Inch files are converted to mm during parsing.
- **Plane awareness**: `G17`/`G18`/`G19` are tracked; arcs outside XY are drawn as straight lines for now.
- **Async build with progress**: Large files are parsed in chunks via `requestAnimationFrame`, with progress shown in the footer.
- **Lightweight fallback for huge files**: Segment count is capped; the app stays responsive.
- **Dark preview theme**: dynamic grid, work-area border, origin crosshair.
- **DPR-aware canvas sizing**: Uses `window.devicePixelRatio`.
- **Color by motion/power**: Rapids are dashed grey; cuts are colored by `S` power.
- **Origin mark**: Large red X with direction arrow; click to place, click again to remove.

### Editor
- **Large-file handling**: Editor is capped at 200,000 displayed lines with a truncation warning.
- **Syntax highlight limit**: Files above 15,000 lines skip the highlight overlay to avoid DOM churn.
- **Editor layout fix**: `editor-wrap` uses flex so the textarea fills the pane correctly.
- **Footer progress bar**: Shows during open, conversion, and preview build.

### UI
- **Sticky footer**: Always visible at viewport bottom.
- **Generate Updated G-code button**: Centered in the Working tab bar; applies template, feed/power, scale, and offset widgets in one pass.
- **Theme cleanup**: Removed the Dark theme option; kept Default and Midday.
- **Tab-aware toolbar**: Generate button only shows on the Working tab.

---

## ⚠️ Known Limitations

1. **3D preview**: Intentionally kept 2D only per request. No ISO/front/side views.
2. **Arcs outside XY plane (`G18`/`G19`)**: Now supported with proper subdivision using `I`/`J`/`K`.
3. **Full circles (`G2`/`G3` with same start/end)**: Now handled with full 360° sweep.
4. **Editor virtualization**: VirtualEditor for files >15k lines; textarea for smaller files.
5. **Point selection**: Now uses segment endpoints for hit-testing — arc-subdivided paths work correctly.
6. **Playback**: Uses command index; progress slider added for basic scrubbing.
7. **No machine/work-area config**: Preview bounds are derived from the toolpath only.
8. **DXF/SVG previews**: Use the same grid, DPR-aware canvas as G-code mode (but not segment-based).
9. **Save from preview**: Button triggers the same Save handler as the Working tab.

---

## 🎯 Roadmap — Make It Robust & Top-Notch

### 1. Parser Robustness
- [x] Support full-circle arcs (start == end).
- [x] Support `G18`/`G19` arc subdivision (XZ and YZ planes).
- [x] Support helical arcs (Z changing during arc).
- [x] Handle omitted axis on subsequent move lines (modal coordinates).
- [x] Validate `R`-format arcs (guard against impossible radius).
- [x] Fix invisible text in editors for files >15k lines: when highlight is skipped, a `no-highlight` class makes the textarea text visible.
- [x] Support line numbers (`N...`) and block delete (`/`) — parser strips `N` words, detects `/` block delete, highlight shows both.

### 2. Editor Virtualization
- [x] `VirtualEditor` class renders only visible lines (DOM virtualization) for files >15k lines.
- [x] Line numbers synced (rendered alongside visible lines).
- [x] Editing via hidden textarea overlay: keystrokes captured, full text re-parsed on change.
- [x] Syntax highlight per visible line (G‑code tokens coloured: G0/G1/G2/G3, M‑codes, comments, line numbers, block delete).
- [x] Undo stack (up to 100 entries, Ctrl+Z).
- [x] Auto-switch: files >`HL_LIMIT` lines use virtual editor; smaller files use textarea.

### 3. Preview Enhancements
- [x] **Anti-aliasing / crisp rendering**: canvas sized by `devicePixelRatio`, `ctx.scale(dpr, dpr)`.
- [x] **Zoom to fit / reset view button**.
- [x] **Measure tool**: click points on canvas to show distance with label.
- [x] **Layer/colored path by feed rate** in addition to power (toggleable).
- [x] **Show rapid vs cut statistics** and estimated runtime in footer.
- [x] **Playback progress bar** that follows command index.
- [x] **Thumbnail / minimap** of the whole toolpath (bottom-right corner, shows all segments + viewport rectangle, toggle via checkbox).
- [x] **Lightweight preview**: when segment count is capped, shows orange cross + "file too large" message instead of blank canvas.

### 3. Preview Enhancements
- [x] W/H removed from preview toolbar (only in Scale widget).

### 4. Widget & Operations
- [x] Fixed preview build loop (`_segVersion` started as `NaN`).
- [x] **Gcode Info widget**: shows G21/G20, G90/G91, line counts (G1/G0/G2/G3), distances, est. time, warnings — all in a sidebar widget. Footer stays compact.
- [x] Add a "Compare" view showing original toolpath (dashed blue) behind the working toolpath.
- [x] Add bounding-box overlay toggle (checkbox in Gcode Info widget).
- [x] Add grid-snap when placing origin mark and measuring (snaps to dynamic grid step).
- [x] Add keyboard zoom (+/-), pan (arrow keys), and fit (Home).

### 5. File Handling
- [x] Streaming parser not needed (per user).
- [x] Better progress during file open (2%, 25%, 50%, 70%, 90% granular steps).
- [x] "Hide orig" checkbox in Gcode Info to hide the Original editor pane/tab for large files.
- [x] Drag-and-drop visual feedback: dashed outline on body + highlight on drop zone.

### 6. Codebase Health
- [x] Modularize `app.js` into 16 separate files under `app/js/`:
  - `helpers.js`, `state.js`, `globals.js`, `fileManager.js`, `gcodeParser.js`,
    `templateManager.js`, `recentFiles.js`, `highlight.js`, `svgConverter.js`,
    `dxfParser.js`, `undoRedo.js`, `preview.js`, `dragdrop.js`, `ui.js`,
    `modal.js`, `main.js`
- [x] Add unit tests for parser edge cases: `test/index.html` covers arcs, G91, units, comments, N words, block delete, serialise, analysis.
- [x] Segment builder tests: `segmentBuilder.build()` tested for G90, G91, G20/G21, arcs, planes, rapids, bounds, truncation.
- [x] Centralize constants in `config.js` (editor limits, segment chunk, arc params, grid, playback, feed estimates).
- [x] **Find & Replace** with regex support, case toggle, Replace All, Ctrl+F/Ctrl+H/F3.
- [x] **Backplotting**: click line in editor → segment highlighted in yellow on preview (auto‑clears after 2.5s).
- [x] **Interactive Pick** (🎯): click preview canvas → G1 X Y inserted at editor cursor.
- [x] G-code info moved entirely to Gcode Info widget; footer shows only status messages.

---

---

*Roadmap fully implemented. All items either completed or marked not needed.*
