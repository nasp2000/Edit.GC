const recentFiles = {
  _key: 'editgc_recent',
  _max: 10,

  list() {
    try { return JSON.parse(localStorage.getItem(this._key)) || []; } catch { return []; }
  },

  add(name, type) {
    try {
      const list = this.list().filter(f => f.name !== name);
      list.unshift({ name, type, time: Date.now() });
      if (list.length > this._max) list.length = this._max;
      localStorage.setItem(this._key, JSON.stringify(list));
    } catch (_) {}
  },

  clear() {
    try { localStorage.removeItem(this._key); } catch (_) {}
  },

  populateSelect(sel) {
    if (!sel) return;
    const list = this.list();
    sel.innerHTML = '<option value="">— Recent files —</option>';
    if (!list.length) { sel.innerHTML = '<option value="">— No files —</option>'; return; }
    list.forEach(f => {
      const opt = document.createElement('option');
      opt.value = opt.textContent = `${f.name}  (${f.type})`;
      opt.dataset.name = f.name;
      opt.dataset.type = f.type;
      sel.appendChild(opt);
    });
  },
};

