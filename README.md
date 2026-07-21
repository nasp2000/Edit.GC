# Edit.GC

Browser-based G-code editor **focused on editing individual G-code lines**. Select, reorder, delete, offset, and generate path variations — all from the visual toolpath preview.

![Edit.GC screenshot](app/image/home.png)

## Quick start

Open `app/index.html` in any browser. Drag & drop `.gcode`, `.svg`, `.dxf` or use **Open** buttons. Select a **Template**, adjust options, click **Convert**.

## Points Editor

The core of Edit.GC is the **Points Editor** — select points directly on the 2D preview and apply operations:

- **Set Start Coordinates** — reposition the first cut point by entering absolute X/Y/Z
- **Add Points** — insert offset copies at selected positions. **Normal**: X/Y/Z inputs applied exactly. **Along Path**: offsets project onto the path direction (point stays on the original line). Continuous or Start/Stop mode.
- **Delete Points** — remove selected points from the G-code
- **Add Point at Minimum Distance** — subdivide every path segment into steps of a given distance (supports **Arcs-Only** mode for curves without G2/G3)
- **Shift Points** — batch shift X, Y, or Z by a value, targeting all, selected, or a line range
- **Full Path Variation** — generate inside/outside offset passes around the entire path
- **Full Turn Path Variation** — alternate perpendicular offset per segment (zigzag effect)
- **Mark Start / Set Side** — reorder the path to begin from any point and flip the cutting direction
- **Multi-select** — Tab to navigate, Space to toggle multiple points, then Apply/Delete in one operation

All operations preserve undo history (50 levels) and tag modified lines with `;edit.gc`.

## Features

- Dual G-code editors, Find & Replace, Undo/Redo, virtual editor for large files
- SVG/DXF to G-code with Scale, Rotate, Multi-pass Z Step, interior-first cutting, bidirectional passes
- Templates: Grbl, Smoothieware, Marlin, SM300 — per-template options (machine origin, passes, feed rates, gas, laser program) saved to localStorage
- SM Motion Control SM300 Series Support: implicit motion, laser programs, gas options, Z in every move, RA/RLAD commands
- Preview: 2D toolpath, pan/zoom (WASD/arrows/home), playback (space), minimap, compare mode (original as dashed), color by feed rate
- Rotate 90/180/270 degrees with configurable machine origin
- Supports G0-G3 arcs, G91 relative mode, M3/M4/M5 laser switching, SM300 RA/RLAD commands

## License

MIT — free to share and modify
