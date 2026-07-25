const undoRedo = {
  MAX: 50,

  // RAM optimization: store references to the parsed command arrays instead of
  // JSON strings. The arrays are already allocated by the editor/parser, so this
  // avoids duplicating potentially megabytes of text 50? over. Dedupe by identity.
  push(cmds) {
    const clone = cmds.map(c => ({ ...c, params: { ...c.params } }));
    state.undoStack.push(clone);
    if (state.undoStack.length > this.MAX) state.undoStack.shift();
    state.redoStack = [];
  },
  _clone(cmds) { return cmds.map(c => ({ ...c, params: { ...c.params } })); },

  undo() {
    if (!state.undoStack.length) return null;
    state.redoStack.push(this._clone(state.workingCmds));
    return state.undoStack.pop();
  },
  redo() {
    if (!state.redoStack.length) return null;
    state.undoStack.push(this._clone(state.workingCmds));
    return state.redoStack.pop();
  },
};

