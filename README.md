# Edit.GC

A browser-based G-code editor for laser and CNC. Edit lines and points, convert SVG/DXF to toolpaths, and visualize G-code — all local, no installation or server required.

## Features

- **G-code editing** — syntax-highlighted working/original editors with undo/redo. Virtual editor for files >15k lines.
- **Canvas preview** — segment‑based 2D preview with pan/zoom/fit, playback, minimap, feed‑rate coloring, bounding‑box, backplot. Lightweight for huge files.
- **Find & Replace** — regex support, case toggle, Replace All (Ctrl+F / Ctrl+H / F3).
- **Compare view** — overlay original toolpath (dashed) behind the working path.
- **SVG/DXF import** — convert vector files to G-code with configurable dimensions and multi-pass.
- **Templates** — built-in (GRBL 1.1h, Smoothieware, Marlin, SM300) + user templates with Machine Options per template.
- **Machine Options** — Passes, feed rates, laser power/mode, gas, safety, homing, focus — per template with localStorage persistence and Custom value input.
- **SM300 support** — implicit motion (no G0/G1), RLAD/RRBM laser programs, gas commands, safety relays.
- **Scale** — single W input with aspect ratio locked, step up/down arrows, reset to original.
- **Mark Start + Set Side** — reorder/reverse G-code motion commands so the selected point becomes the cutting start. Visual arrow on preview.
- **Origin & Offsets** — set machine origin (G92), fine offset, apply coordinate shifts.
- **Add Points** — duplicate selected points with X/Y/Z offset and optional laser on/off wrapping.
- **Shift Points** — batch subtract axis values (X/Y/Z) from all/selected/range of lines.
- **Batch operations** — all modifications push to undo stack (50 levels).
- **Rotate 90°** — clockwise rotation of all coordinates.
- **Export** — G-code → SVG/DXF for toolpath visualization.
- **Large file support** — optimized for 20-30 MB files on low-memory machines.

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
