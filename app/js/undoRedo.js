const undoRedo = {
  MAX: 50,

  push(cmds) {
    const cur = JSON.stringify(cmds);
    // Avoid pushing same state consecutively
    if (state.undoStack.length > 0 && state.undoStack[state.undoStack.length - 1] === cur) return;
    state.undoStack.push(cur);
    if (state.undoStack.length > this.MAX) state.undoStack.shift();
    state.redoStack = [];
  },
  undo() {
    if (!state.undoStack.length) return null;
    state.redoStack.push(JSON.stringify(state.workingCmds));
    return JSON.parse(state.undoStack.pop());
  },
  redo() {
    if (!state.redoStack.length) return null;
    state.undoStack.push(JSON.stringify(state.workingCmds));
    return JSON.parse(state.redoStack.pop());
  },
};

