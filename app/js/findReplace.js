// -- Find & Replace -----------------------------------------
const findReplace = {
  _matches: [],
  _currentIdx: -1,
  _active: false,

  init() {
    const bar = document.getElementById('findReplaceBar');
    if (!bar) return;

    const findInp = document.getElementById('findInput');
    const repInp = document.getElementById('replaceInput');

    document.getElementById('btnFindClose').addEventListener('click', () => this.close());
    document.getElementById('btnFindNext').addEventListener('click', () => this.findNext());
    document.getElementById('btnFindPrev').addEventListener('click', () => this.findPrev());
    document.getElementById('btnReplace').addEventListener('click', () => this.replace());
    document.getElementById('btnReplaceAll').addEventListener('click', () => this.replaceAll());

    findInp.addEventListener('input', () => {
      this.search(findInp.value);
      if (document.activeElement !== findInp) setTimeout(() => findInp.focus(), 0);
    });
    findInp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this.findNext(); } });
    repInp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this.replace(); } });

    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        this.open();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
        e.preventDefault();
        this.open(true);
      }
      if (e.key === 'F3' && this._active) {
        e.preventDefault();
        e.shiftKey ? this.findPrev() : this.findNext();
      }
    });
  },

  open(focusReplace) {
    const bar = document.getElementById('findReplaceBar');
    if (!bar) return;
    bar.style.display = 'flex';
    this._active = true;
    if (focusReplace) {
      document.getElementById('replaceInput').focus();
    } else {
      document.getElementById('findInput').focus();
      document.getElementById('findInput').select();
    }
    // Search current selection
    const ta = document.getElementById('editorWorking');
    if (ta && ta.style.display !== 'none' && ta.selectionStart !== ta.selectionEnd) {
      const sel = ta.value.substring(ta.selectionStart, ta.selectionEnd);
      document.getElementById('findInput').value = sel;
      this.search(sel);
    }
  },

  close() {
    const bar = document.getElementById('findReplaceBar');
    if (!bar) return;
    bar.style.display = 'none';
    this._active = false;
    this._matches = [];
    this._currentIdx = -1;
    this._clearHighlights();
  },

  _getText() {
    const ta = document.getElementById('editorWorking');
    if (ta) {
      if (ta.style.display !== 'none') return ta.value;
      // Virtual editor active — get text from VE, or fall back to textarea
      if (window.ui && ui._ve) return ui._ve.getText();
      return ta.value;
    }
    if (window.ui && ui._ve) return ui._ve.getText();
    return '';
  },

  _setText(text) {
    const ta = document.getElementById('editorWorking');
    if (ta && ta.style.display !== 'none') { ta.value = text; return; }
    if (window.ui && ui._ve) ui._ve.setText(text);
  },

  _getEditor() {
    const ta = document.getElementById('editorWorking');
    if (ta && ta.style.display !== 'none') return ta;
    if (window.ui && ui._ve) return null;
    return ta || null;
  },

  search(query) {
    this._matches = [];
    this._currentIdx = -1;
    const countEl = document.getElementById('findCount');
    if (!query) { countEl.textContent = '0/0'; return; }

    const text = this._getText();
    if (!text) { countEl.textContent = '0/0'; return; }

    const isRegex = document.getElementById('findRegex').checked;
    const isCase = document.getElementById('findCase').checked;
    let flags = 'g' + (isCase ? '' : 'i');
    let pattern;
    try {
      pattern = isRegex ? new RegExp(query, flags) : new RegExp(this._escapeRegex(query), flags);
    } catch (_) { countEl.textContent = '0/0'; return; }

    let m;
    while ((m = pattern.exec(text)) !== null) {
      this._matches.push({ index: m.index, length: m[0].length });
      if (this._matches.length > 10000) break; // cap for huge files
    }
    if (this._matches.length > 0) this._currentIdx = 0;
    this._updateCount();
    this._scrollToCurrent();
    this._highlightMatches();
  },

  _escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  },

  _updateCount() {
    const el = document.getElementById('findCount');
    if (!el) return;
    el.textContent = this._matches.length > 0
      ? `${this._currentIdx + 1}/${this._matches.length}`
      : '0/0';
  },

  findNext() {
    if (!this._matches.length) return;
    this._currentIdx = (this._currentIdx + 1) % this._matches.length;
    this._updateCount();
    this._scrollToCurrent();
    this._focusInput();
  },

  findPrev() {
    if (!this._matches.length) return;
    this._currentIdx = (this._currentIdx - 1 + this._matches.length) % this._matches.length;
    this._updateCount();
    this._scrollToCurrent();
    this._focusInput();
  },

  _scrollToCurrent() {
    const m = this._matches[this._currentIdx];
    if (!m) return;
    const text = this._getText();
    const lineNo = text.substring(0, m.index).split('\n').length;
    const ta = this._getEditor();
    if (ta) {
      ta.setSelectionRange(m.index, m.index + m.length);
      ta.scrollTop = (lineNo - 3) * (parseFloat(getComputedStyle(ta).lineHeight) || 19.2);
    } else if (window.ui && ui._ve) {
      ui._ve.scrollToLine(lineNo - 1);
    }
  },

  _focusInput() {
    const inp = document.getElementById('findInput');
    if (inp) inp.focus();
  },

  _highlightMatches() {
    // For textarea: selection handles it. For virtual editor: could add highlight spans
    // Simple: just scroll to current match
  },

  replace() {
    if (this._currentIdx < 0 || !this._matches.length) return;
    const m = this._matches[this._currentIdx];
    const rep = document.getElementById('replaceInput').value;
    let text = this._getText();
    text = text.substring(0, m.index) + rep + text.substring(m.index + m.length);
    state.workingCmds = gcodeParser.parse(text);
    ui.refreshWorking();
    const query = document.getElementById('findInput').value;
    this.search(query);
    this.findNext();
    this._focusInput();
  },

  replaceAll() {
    const query = document.getElementById('findInput').value;
    if (!query) return;
    const rep = document.getElementById('replaceInput').value;
    let text = this._getText();
    if (!text) return;
    const isRegex = document.getElementById('findRegex').checked;
    const isCase = document.getElementById('findCase').checked;
    let flags = 'g' + (isCase ? '' : 'i');
    let pattern;
    try {
      pattern = isRegex ? new RegExp(query, flags) : new RegExp(this._escapeRegex(query), flags);
    } catch (_) { return; }
    const newText = text.replace(pattern, rep);
    if (newText !== text) {
      state.workingCmds = gcodeParser.parse(newText);
      ui.refreshWorking();
      this.search(query);
    }
    this._focusInput();
  },

  _clearHighlights() {
    // No persistent highlights to clear
  },
};
