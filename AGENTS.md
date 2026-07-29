# Edit.GC — AI Workflow Instructions

## Before any code change
1. Read `work.md` for full project context
2. Read the specific file(s) to be modified

## Development workflow (per request)
For each feature/bugfix request:
1. **Implement** — make the code change
2. **Multi-template logic** — every feature MUST handle all template differences inline (Grbl, SM300, KUKA, Marlin, Smoothieware). Do NOT add template-specific logic later — build it from the start. Key differences:
   - Grbl/Smoothieware/Marlin: standard G0/G1/M3/M5, `laserOnCmd`/`laserOffCmd` comma-separated
   - SM300: implicit motions (`type: ''`), `feedTravel` for travel detection, SM3/RM3 laser commands
   - KUKA: standard G-code in editor (converted to KRL on export), M3/M5, separate `kukaConverter`
3. **Logic test** — run only the relevant test(s) in `test/comprehensive.test.js` with **2 variations** (e.g., Grbl + SM300, or rect + circle)
4. **Canvas test** — run only the relevant test(s) in `test/canvas.test.js` with **2 variations** (e.g., Grbl + SM300)
5. Do NOT run full test suite unless user explicitly asks

## Full test commands (when requested)
```powershell
node test/comprehensive.test.js    # 493 G-code logic tests
node test/canvas.test.js           # 64 canvas preview tests
```

## Version
- Version format: `v1.000` in `index.html` header
- Do NOT increment version / bump firmware on commit — only when user explicitly says "bump version"

## Code style
- No comments in JS files (unless absolutely necessary)
- Use existing patterns (look at neighboring code)
- All UI text in English
