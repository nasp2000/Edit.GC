# Edit.GC

A browser-based G-code editor for laser and CNC. Edit lines and points, convert SVG/DXF to toolpaths, and visualize G-code — all local, no installation or server required.

## Features

- **G-code editing** — syntax-highlighted working/original editors with undo/redo. Virtual editor for files >15k lines (DOM virtualization, syntax highlight, line numbers, Ctrl+Z).
- **Canvas preview** — segment‑based 2D preview with pan/zoom/fit, playback progress bar, measure tool, minimap, feed‑rate or power coloring, bounding‑box toggle, backplotting. Lightweight preview for huge files.
- **Find & Replace** — regex support, case toggle, Replace All (Ctrl+F / Ctrl+H / F3).
- **Interactive Pick (🎯)** — click the preview canvas to insert `G1 X Y` at the editor cursor.
- **Compare view** — overlay original toolpath (dashed) behind the working path.
- **SVG/DXF import** — convert vector files to G-code with configurable dimensions.
- **Gcode Info widget** — units, mode, line counts, distances, estimated time, warnings.
- **Templates** — save/load G-code header/footer patterns.
- **Scale, Resize, Offset, Feed/Power, Passes** — full editing toolbox.
- **Mark start point** — place/remove a red X mark with direction for origin calculation.
- **Origin & Offsets** — set machine origin, fine offset, and apply coordinate shifts
- **Feed/Power control** — batch-set feed rate, laser power, and multi-pass with Z micro-step
- **Point selection** — select points on preview, generate duplicates, or delete
- **Shift Points** — subtract/add axis values across line ranges
- **Templates** — extract coordinate-stripped patterns, save/load/import to localStorage
- **Batch operations** — all modifications push to undo stack
- **Large file support** — optimized for 20-30 MB files on low-memory machines

## Quick start

Open `app/index.html` in any modern browser (Chrome, Edge, Firefox).  
Drag and drop `.gcode`, `.svg`, or `.dxf` files onto the preview area, or use the **Open** buttons.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+O` | Open G-code file |
| `Ctrl+S` | Save |
| `Ctrl+Shift+S` | Save As |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Redo |
| `Space` | Play / Pause preview |
| `+` / `-` | Zoom in / out |
| `Escape` | Stop preview |

## License

MIT — free to use, modify, and share.
