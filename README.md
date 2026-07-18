# Edit.GC

A browser-based G-code editor for laser and CNC. Edit lines and points, convert SVG/DXF to toolpaths, and visualize G-code — all local, no installation or server required.

![Edit.GC](app/image/home.png)

## Quick start

Open `app/index.html` in any modern browser.  
Drag & drop `.gcode`, `.svg`, or `.dxf` files onto the preview area, or use the **Open** buttons.  
Select a **Template** for your machine, adjust options, and click **Convert** to generate G-code.

## Features

### Working G-code Editor
- **Dual editors** — Original (read-only) + Working (editable), side by side, syntax‑highlighted
- **Find & Replace** — regex, case toggle, Replace All (Ctrl+F / Ctrl+H / F3)
- **Undo / Redo** — 50‑level stack (Ctrl+Z / Ctrl+Y)
- **Virtual editor** — handles files >15k lines without slowdown
- **Tag edits** — marks modified lines with `;edit.gc` comments

### Points Editor (full control panel)
- **Mark Start** — select any point on the toolpath; click **Mark Start** to rotate all motion commands so that point becomes the cutting start. Preview instantly shows a red arrow at the new start
- **Set Side** — reverse the cutting direction (left/right/clear). Swaps G2↔G3 arcs automatically. The G-code and preview update immediately
- **Offset Origin** — set machine zero (G92) or fine‑shift all coordinates by X/Y/Z
- **Add Points** — duplicate selected points with offset, optional laser on/off wrapping
- **Shift Points** — batch‑subtract X/Y/Z values from all, selected, or a line‑range
- **Delete Points** — remove selected coordinates from the G-code

### SVG / DXF → G-code
- Drag & drop SVG or DXF files, preview as outlines or points
- **Convert** button generates G-code with all current options
- **Scale** — single W input (aspect ratio locked), step up/down, reset to original
- **Multi-pass** — repeat cutting paths N times with `; Pass 1/2/3…` comments
- **Rotate 90°** — clockwise

### Templates & Machine Options
- Built‑in templates: **GRBL 1.1h**, **Smoothieware**, **Marlin (Laser)**, **SM300**
- Per‑template options: Passes, feed rates, laser power/mode, gas, safety, homing, focus
- **Custom value** input — type any value beyond the dropdown presets
- Settings saved per template in localStorage

### SM Motion Control (SM300) Support
- Implicit motion (`X90 Y200` without G0/G1)
- Laser programs (RLAD/RRBM), gas commands (SM12/RM12), safety (SA3/RA3/RA4)
- No S‑parameter (power set on machine control panel)

### Canvas Preview
- 2D toolpath with pan/zoom/fit, playback, minimap, feed‑rate coloring
- Compare mode — overlay original path as dashed line
- Mark Start arrow updates direction in real‑time

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
