# Edit.GC — AI Workflow Instructions

## Before any code change
1. Read `work.md` for full project context
2. Read the specific file(s) to be modified

## After any code change
1. Update `work.md` if the change affects:
   - New/changed widgets, buttons, or UI controls
   - New/changed data flow or conversion logic
   - New/changed state variables
   - New/changed files or modules
2. Run tests:
   ```powershell
   node test/unit.js              # Unit tests (parser, transforms, logic)
   node test/runner.js            # Integration tests (all features)
   node test/markstart.test.js    # Mark Start / Set Side focused tests
   ```
3. Verify all tests pass before reporting completion

## Code style
- No comments in JS files (unless absolutely necessary)
- Use existing patterns (look at neighboring code)
- All UI text in English
