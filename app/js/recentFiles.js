const recentFiles = {
  _key: 'editgc_recent',
  _max: 10,

  list() {
    try { return JSON.parse(localStorage.getItem(this._key)) || []; } catch { return []; }
  },

  add(name, type, content) {
    try {
      let list = this.list().filter(f => f.name !== name);
      const entry = { name, type, time: Date.now() };
      if (content) entry.content = content;
      list.unshift(entry);
      if (list.length > this._max) list.length = this._max;
      localStorage.setItem(this._key, JSON.stringify(list));
    } catch (_) {
      // If storage fails (quota exceeded), store metadata only
      try {
        let list = this.list().filter(f => f.name !== name);
        list.unshift({ name, type, time: Date.now() });
        if (list.length > this._max) list.length = this._max;
        localStorage.setItem(this._key, JSON.stringify(list));
      } catch (_) {}
    }
  },

  clear() {
    try { localStorage.removeItem(this._key); } catch (_) {}
  },

  populateSelect(sel) {
    if (!sel) return;
    const list = this.list().filter(f => f.type === 'G-code');
    sel.innerHTML = '<option value="">— Recent —</option>';
    if (!list.length) { sel.innerHTML = '<option value="">— No recent —</option>'; return; }
    list.forEach(f => {
      const opt = document.createElement('option');
      opt.textContent = f.name;
      opt.value = f.name;
      if (f.content) opt.dataset.cached = '1';
      sel.appendChild(opt);
    });
  },
};
