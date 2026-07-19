const recentFiles = {
  _key: 'editgc_recent',
  _max: 10,

  list() {
    try {
      const raw = JSON.parse(localStorage.getItem(this._key));
      if (!Array.isArray(raw)) return [];
      // Filter out corrupted entries
      return raw.filter(f => f && typeof f.name === 'string' && f.name.trim());
    } catch { return []; }
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
    // Clean corrupted entries on access
    const all = this.list();
    const valid = all.filter(f => f.type === 'G-code' && f.name && typeof f.name === 'string');
    if (valid.length < all.length) {
      // Automatically purge corrupted entries
      try { localStorage.setItem(this._key, JSON.stringify(all.filter(f => f && f.name))); } catch (_) {}
    }
    sel.innerHTML = '<option value="">--- Recent ---</option>';
    if (!valid.length) { sel.innerHTML = '<option value="">--- No recent ---</option>'; return; }
    valid.forEach(f => {
      const opt = document.createElement('option');
      opt.textContent = f.name;
      opt.value = f.name;
      if (f.content) opt.dataset.cached = '1';
      sel.appendChild(opt);
    });
  },
};
