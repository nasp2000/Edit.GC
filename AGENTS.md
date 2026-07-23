# Edit.GC — AI Workflow Instructions

## Before any code change
1. Read `work.md` for full project context
2. Read the specific file(s) to be modified

## Development workflow (per request)
For each feature/bugfix request:
1. **Implement** — make the code change
2. **Logic test** — run only the relevant test(s) in `test/comprehensive.test.js` with **2 variations** (e.g., Grbl + SM300, or rect + circle)
3. **Canvas test** — run only the relevant test(s) in `test/canvas.test.js` with **2 variations** (e.g., Grbl + SM300)
4. Do NOT run full test suite unless user explicitly asks

## Full test commands (when requested)
```powershell
node test/comprehensive.test.js    # 493 G-code logic tests
node test/canvas.test.js           # 64 canvas preview tests
```

## Version
- Version format: `v1.000` in `index.html` header
- When user says "commit and push", increment version by 1 (e.g., v1.000 → v1.001 → v1.002)
- Only increment when user explicitly says to commit and push

## Code style
- No comments in JS files (unless absolutely necessary)
- Use existing patterns (look at neighboring code)
- All UI text in English
