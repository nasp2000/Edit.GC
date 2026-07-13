// ── Virtual Editor: renders only visible lines ─────────────
class VirtualEditor {
  constructor(container, opts) {
    this._container = container;
    this._opts = opts || {};
    this._text = '';
    this._lines = [];
    this._lineHeight = 0;
    this._visibleStart = 0;
    this._visibleEnd = 0;
    this._renderCount = 0;
    this._onChange = null;
    this._undoStack = [];
    this._undoMax = 100;
    this._duringUndo = false;

    container.innerHTML = '';
    container.style.position = 'relative';
    container.style.overflow = 'hidden';

    this._scroll = document.createElement('div');
    this._scroll.style.cssText = 'position:absolute;inset:0;overflow-y:auto;overflow-x:hidden';
    container.appendChild(this._scroll);

    this._spacer = document.createElement('div');
    this._spacer.style.cssText = 'pointer-events:none';
    this._scroll.appendChild(this._spacer);

    this._lineNos = document.createElement('div');
    this._lineNos.style.cssText = 'position:absolute;top:0;left:0;width:48px;bottom:0;overflow:hidden;pointer-events:none;z-index:2;background:var(--bg3);border-right:1px solid var(--border2);font-family:var(--font-mono);font-size:12px;line-height:1.6;padding:6px 4px 6px 6px;text-align:right;color:var(--text-dim);user-select:none;white-space:pre';
    container.appendChild(this._lineNos);

    this._viewport = document.createElement('div');
    this._viewport.style.cssText = 'position:absolute;top:0;left:48px;right:0;bottom:0;overflow:hidden;pointer-events:none;z-index:1;font-family:var(--font-mono);font-size:12px;line-height:1.6;padding:6px 0;white-space:pre;background:var(--bg4);color:var(--text)';
    container.appendChild(this._viewport);

    this._input = document.createElement('textarea');
    this._input.style.cssText = 'position:absolute;top:0;left:48px;right:0;height:1.6em;opacity:0;z-index:3;resize:none;border:none;outline:none;font-family:var(--font-mono);font-size:12px;line-height:1.6;padding:6px 10px;caret-color:#000;overflow:hidden';
    this._input.setAttribute('aria-hidden', 'true');
    container.appendChild(this._input);

    this._scroll.addEventListener('scroll', () => this._onScroll());
    this._input.addEventListener('input', () => this._onInput());
    this._input.addEventListener('keydown', (e) => this._onKeydown(e));
    this._container.addEventListener('click', (e) => this._onClick(e));
    this._container.addEventListener('focusin', () => this._input.focus());

    this._measureLineHeight();
  }

  _measureLineHeight() {
    const tmp = document.createElement('div');
    tmp.style.cssText = 'position:absolute;visibility:hidden;font-family:var(--font-mono);font-size:12px;line-height:1.6;padding:0';
    tmp.textContent = 'M';
    document.body.appendChild(tmp);
    this._lineHeight = tmp.offsetHeight;
    document.body.removeChild(tmp);
    if (!this._lineHeight) this._lineHeight = 19.2;
  }

  _onScroll() {
    requestAnimationFrame(() => this._render());
  }

  _onClick(e) {
    if (e.target === this._container || e.target === this._viewport || e.target === this._spacer) {
      this._input.focus();
    }
  }

  _pushUndo() {
    if (this._duringUndo) return;
    this._undoStack.push(this._text);
    if (this._undoStack.length > this._undoMax) this._undoStack.shift();
  }

  _onInput() {
    const val = this._input.value;
    if (val === this._text) return;
    this._pushUndo();
    this._text = val;
    this._lines = val.split('\n');
    this._recalcSpacer();
    this._render();
    if (this._onChange) this._onChange(val);
  }

  _onKeydown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      this._undo();
    }
  }

  _undo() {
    if (!this._undoStack.length) return;
    this._duringUndo = true;
    const prev = this._undoStack.pop();
    this._text = prev;
    this._lines = prev.split('\n');
    this._input.value = prev;
    this._recalcSpacer();
    this._render();
    if (this._onChange) this._onChange(prev);
    this._duringUndo = false;
  }

  setText(text) {
    this._undoStack = [];
    this._text = text || '';
    this._lines = this._text.split('\n');
    this._input.value = this._text;
    this._recalcSpacer();
    this._render();
  }

  getText() { return this._text; }

  getLineCount() { return this._lines.length; }

  onChange(fn) { this._onChange = fn; }

  focus() { this._input.focus(); }

  scrollToLine(line) {
    const target = Math.max(0, Math.min(line - 3, this._lines.length - 1)) * this._lineHeight;
    this._scroll.scrollTop = target;
  }

  _recalcSpacer() {
    const h = this._lines.length * this._lineHeight + 12;
    this._spacer.style.height = h + 'px';
  }

  // ── Syntax highlight for a single line ──────────────────
  _highlightLine(line) {
    if (!line) return '\u00A0';
    // Comment-only line
    if (/^\s*\(/.test(line) || /^\s*;/.test(line)) {
      return `<span style="color:#16a34a;font-style:italic">${this._escape(line)}</span>`;
    }
    const body = line.replace(/\(.*?\)/g, '').replace(/;.*$/, '').trim();
    const commentPart = line.includes(';') ? line.substring(line.indexOf(';')) : (line.includes('(') ? line.substring(line.indexOf('(')) : '');
    if (!body) {
      return this._escape(line) ? `<span style="color:#16a34a;font-style:italic">${this._escape(line)}</span>` : '\u00A0';
    }
    let prefix = '';
    let clean = body;
    if (clean.startsWith('/')) {
      prefix = '<span style="color:#dc2626;font-weight:700">/</span>';
      clean = clean.slice(1).trim();
    }
    const tokens = clean.toUpperCase().split(/\s+/);
    let ti = 0;
    if (tokens.length > 0 && /^N\d+$/.test(tokens[0])) ti = 1;
    const cmd = ti < tokens.length ? tokens[ti] : '';
    let cmdColor = '#d97706';
    const isAxisWord = /^[XYZABC][-\d]/.test(cmd);
    if (isAxisWord) {
      cmdColor = '';
    } else if (/^G0(0)?$/.test(cmd)) cmdColor = '#888';
    else if (/^G1(01)?$/.test(cmd)) cmdColor = '#2563eb';
    else if (/^G2(02)?$/.test(cmd) || /^G3(03)?$/.test(cmd)) cmdColor = '#7c3aed';
    else if (/^M\d+$/.test(cmd)) cmdColor = '#dc2626';
    else if (/^G\d+$/.test(cmd)) cmdColor = '#d97706';
    else if (/^T\d+$/.test(cmd)) cmdColor = '#dc2626';
    let result = prefix;
    if (ti > 0 && /^N\d+$/.test(tokens[0])) {
      result += `<span style="color:#999">${this._escape(tokens[0])}</span> `;
    }
    const startIdx = isAxisWord ? ti : ti + 1;
    if (cmd && !isAxisWord) result += `<span style="color:${cmdColor}">${this._escape(cmd)}</span>`;
    for (let i = startIdx; i < tokens.length; i++) {
      const p = isAxisWord && i === ti ? cmd : tokens[i];
      let pos = 0;
      p.replace(/([A-Z])([-\d.]+)/g, (_, letter, num, offset) => {
        if (offset > pos) result += `<span style="color:#d97706">${this._escape(p.slice(pos, offset))}</span>`;
        result += ` <span style="color:#000">${this._escape(letter)}</span><span style="color:#000">${this._escape(num)}</span>`;
        pos = offset + letter.length + num.length;
      });
      if (pos < p.length) result += `<span style="color:#d97706">${this._escape(p.slice(pos))}</span>`;
    }
    if (commentPart) {
      result += ` <span style="color:#16a34a;font-style:italic">${this._escape(commentPart)}</span>`;
    }
    return result || '\u00A0';
  }

  _render() {
    const st = this._scroll.scrollTop;
    const ch = this._scroll.clientHeight;
    const lh = this._lineHeight;
    if (!lh) return;

    const buf = 5;
    let start = Math.max(0, Math.floor(st / lh) - buf);
    let end = Math.min(this._lines.length, Math.ceil((st + ch) / lh) + buf);

    if (start === this._visibleStart && end === this._visibleEnd) {
      this._updateLineNumbers();
      return;
    }
    this._visibleStart = start;
    this._visibleEnd = end;
    this._renderCount++;

    const offset = start * lh;
    let html = '';
    for (let i = start; i < end; i++) {
      const hl = this._highlightLine(this._lines[i]);
      html += `<div style="padding:0 10px;height:${lh}px;line-height:${lh}px;white-space:pre;overflow:hidden">${hl}</div>`;
    }
    this._viewport.innerHTML = html;
    this._viewport.style.paddingTop = offset + 'px';
    this._updateLineNumbers();
  }

  _updateLineNumbers() {
    const start = this._visibleStart;
    const end = this._visibleEnd;
    const nums = [];
    for (let i = start; i < end; i++) nums.push(String(i + 1).padStart(4, ' '));
    this._lineNos.textContent = nums.join('\n');
    this._lineNos.style.paddingTop = (start * this._lineHeight + 6) + 'px';
  }

  _escape(s) {
    if (!s) return '';
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
