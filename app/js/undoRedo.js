const undoRedo = {
  MAX: 50,

  // RAM optimization: store references to the parsed command arrays instead of
  // JSON strings. The arrays are already allocated by the editor/parser, so this
  // avoids duplicating potentially megabytes of text 50× over. Dedupe by identity.
  push(cmds) {
    if (state.undoStack.length > 0 && state.undoStack[state.undoStack.length - 1] === cmds) return;
    state.undoStack.push(cmds);
    if (state.undoStack.length > this.MAX) state.undoStack.shift();
    state.redoStack = [];
  },
  undo() {
    if (!state.undoStack.length) return null;
    state.redoStack.push(state.workingCmds);
    return state.undoStack.pop();
  },
  redo() {
    if (!state.redoStack.length) return null;
    state.undoStack.push(state.workingCmds);
    return state.redoStack.pop();
  },
};

