const templateManager = {
  _dirHandle: null,
  _templates: [],
  _activeTemplate: null,
  _db: null,

  async _openDB() {
    if (this._db) return this._db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('editgc-templates', 1);
      req.onupgradeneeded = e => { e.target.result.createObjectStore('handles'); };
      req.onsuccess = e => { this._db = e.target.result; resolve(this._db); };
      req.onerror = () => reject(req.error);
    });
  },

  async _loadSavedHandle() {
    try {
      const db = await this._openDB();
      return new Promise(resolve => {
        const tx = db.transaction('handles', 'readonly');
        const req = tx.objectStore('handles').get('dirHandle');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch (_) { return null; }
  },

  async _saveHandle(handle) {
    try {
      const db = await this._openDB();
      return new Promise(resolve => {
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').put(handle, 'dirHandle');
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch (_) { return false; }
  },

  async _ensureDir() {
    if (this._dirHandle) {
      try { await this._dirHandle.getPermission({ mode: 'readwrite' }); return true; } catch (_) { this._dirHandle = null; }
    }
    const saved = await this._loadSavedHandle();
    if (saved) {
      try {
        const perm = await saved.queryPermission({ mode: 'readwrite' });
        if (perm === 'granted') { this._dirHandle = saved; return true; }
        const req = await saved.requestPermission({ mode: 'readwrite' });
        if (req === 'granted') { this._dirHandle = saved; return true; }
      } catch (_) {}
    }
    if (!window.showDirectoryPicker) return false;
    try {
      const dirHandle = await window.showDirectoryPicker({ id: 'editgc-templates', mode: 'readwrite' });
      try {
        const tplHandle = await dirHandle.getDirectoryHandle('templates', { create: true });
        this._dirHandle = tplHandle;
      } catch (_) {
        this._dirHandle = dirHandle;
      }
      await this._saveHandle(this._dirHandle);
      return true;
    } catch (_) { return false; }
  },

  async openFolder() {
    if (!window.showDirectoryPicker) { ui.setStatus('File System Access API not supported.', 'error'); return; }
    try {
      const dirHandle = await window.showDirectoryPicker({ id: 'editgc-templates', mode: 'readwrite' });
      try {
        const tplHandle = await dirHandle.getDirectoryHandle('templates', { create: true });
        this._dirHandle = tplHandle;
      } catch (_) {
        this._dirHandle = dirHandle;
      }
      await this._saveHandle(this._dirHandle);
      await this.scan();
      ui.refreshTemplateList();
      ui.setStatus(`Templates folder opened. ${this._templates.length} template(s) found.`);
    } catch (err) {
      if (err.name !== 'AbortError') ui.setStatus('Error opening folder.', 'error');
    }
  },

  async scan() {
    this._templates = [];
    if (!this._dirHandle) return;
    try {
      for await (const [name, handle] of this._dirHandle) {
        if (handle.kind === 'file' && name.toLowerCase().endsWith('.json')) {
          try {
            const file = await handle.getFile();
            const text = await file.text();
            const tpl = JSON.parse(text);
            if (tpl && tpl.name) this._templates.push({ name: tpl.name, fileName: name, data: tpl });
          } catch (_) {}
        }
      }
    } catch (_) {}
  },

  list() { return this._templates.map(t => t.name); },

  getTemplate(name) { return this._templates.find(t => t.name === name); },

  getActive() { return this._activeTemplate; },

  setActive(name) {
    this._activeTemplate = name ? this.getTemplate(name) : null;
  },

  async saveTemplate(name, data) {
    if (!this._dirHandle) { if (!(await this._ensureDir())) return false; }
    try {
      const fileHandle = await this._dirHandle.getFileHandle(name + '.json', { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(data, null, 2));
      await writable.close();
      await this.scan();
      return true;
    } catch (_) { return false; }
  },

  async deleteTemplate(name) {
    if (!this._dirHandle) return;
    try {
      await this._dirHandle.removeEntry(name + '.json');
      await this.scan();
    } catch (_) {}
  },

  async importFromFile(file) {
    const text = await fileManager.readGcode(file);
    const name = file.name.replace(/\.[^.]+$/, '');
    const data = this.extractFromText(text, file.name);
    data.name = name;
    await this.saveTemplate(name, data);
    return name;
  },

  async importFromFolder() {
    if (!window.showDirectoryPicker) return [];
    try {
      const srcDir = await window.showDirectoryPicker({ id: 'editgc-import', mode: 'read' });
      const imported = [];
      const exts = ['.gcode', '.txt', '.nc', '.gc', '.cnc', '.tap'];
      for await (const [name, handle] of srcDir) {
        if (handle.kind === 'file' && exts.some(e => name.toLowerCase().endsWith(e))) {
          try {
            const file = await handle.getFile();
            const text = await file.text();
            const tplName = name.replace(/\.[^.]+$/, '');
            const data = this.extractFromText(text, name);
            data.name = tplName;
            await this.saveTemplate(tplName, data);
            imported.push(tplName);
          } catch (_) {}
        }
      }
      return imported;
    } catch (err) {
      if (err.name !== 'AbortError') ui.setStatus('Error importing templates.', 'error');
      return [];
    }
  },

  extractFromText(originalText, originalName) {
    const lines = originalText.split('\n');
    const ext = originalName ? (originalName.match(/\.([^.]+)$/) || [])[1] || 'gcode' : 'gcode';
    const lineEnd = originalText.includes('\r\n') ? 'crlf' : originalText.includes('\r') ? 'cr' : 'lf';

    const knownG = /^(G0|G00|G1|G01|G2|G02|G3|G03|G4|G04|G10|G17|G18|G19|G20|G21|G28|G30|G40|G43|G49|G54|G55|G56|G57|G58|G59|G80|G81|G82|G83|G84|G85|G86|G87|G88|G89|G90|G91|G92|G93|G94|G98|G99)$/i;
    const knownM = /^(M0|M1|M2|M3|M4|M5|M6|M7|M8|M9|M30|M98|M99)$/i;

    const customTypes = new Set();
    const toolCodes = new Set();
    let headerLines = [];
    let footerLines = [];
    let firstMoveIdx = -1;
    let lastMoveIdx = -1;
    let laserOnCmd = '';
    let laserOffCmd = '';
    const sValues = [];
    const feedValues = [];

    const parsed = lines.map((raw, i) => {
      const stripped = raw.replace(/\(.*?\)/g, '').replace(/;.*$/, '').trim();
      if (!stripped) return { idx: i, type: '', blank: true };
      const parts = stripped.toUpperCase().split(/\s+/);
      let first = parts[0];
      if (/^N\d+$/.test(first)) first = parts[1] || '';
      const typeParam = first.match(/^([XYZABC])([-\d.]+)$/);
      const type = typeParam ? '' : first;
      return { idx: i, type, blank: false, raw: stripped };
    });

    for (let i = 0; i < parsed.length; i++) {
      const p = parsed[i];
      if (p.blank) continue;
      const t = p.type;
      if (!t) {
        if (firstMoveIdx === -1) firstMoveIdx = i;
        lastMoveIdx = i;
        continue;
      }
      if (knownG.test(t)) {
        if (firstMoveIdx === -1) firstMoveIdx = i;
        lastMoveIdx = i;
      } else if (knownM.test(t)) {
        if (t === 'M3' || t === 'M4') { if (!laserOnCmd) laserOnCmd = t; }
        if (t === 'M5') { if (!laserOffCmd) laserOffCmd = t; }
      } else if (t.startsWith('T')) {
        toolCodes.add(t);
      } else {
        customTypes.add(t);
        if (firstMoveIdx === -1) firstMoveIdx = i;
        lastMoveIdx = i;
      }
    }

    if (firstMoveIdx > 0) headerLines = lines.slice(0, firstMoveIdx).map(l => l.trimEnd());
    if (lastMoveIdx >= 0 && lastMoveIdx < lines.length - 1) footerLines = lines.slice(lastMoveIdx + 1).map(l => l.trimEnd());

    for (const c of parsed) {
      if (c.blank || c.type) continue;
      const m = c.raw.match(/\bF([\d.]+)/);
      if (m) feedValues.push(parseFloat(m[1]));
      const sm = c.raw.match(/\bS([\d.]+)/);
      if (sm) sValues.push(parseFloat(sm[1]));
    }

    const beforeMove = {};
    const afterMove = {};
    for (let i = 0; i < parsed.length; i++) {
      const p = parsed[i];
      const isMove = !p.blank && (p.type === 'G1' || p.type === 'G01' || (!p.type && p.raw && /[XYZ]/.test(p.raw)));
      if (!isMove) continue;
      if (i > 0 && !parsed[i - 1].blank) {
        const pf = parsed[i - 1].type || parsed[i - 1].raw?.split(/\s+/)[0] || '';
        const key = pf.toUpperCase();
        if (key) beforeMove[key] = { count: (beforeMove[key]?.count || 0) + 1, full: lines[parsed[i - 1].idx].split(';')[0].trim() };
      }
      if (i + 1 < parsed.length && !parsed[i + 1].blank) {
        const nf = parsed[i + 1].type || parsed[i + 1].raw?.split(/\s+/)[0] || '';
        const key = nf.toUpperCase();
        if (key) afterMove[key] = { count: (afterMove[key]?.count || 0) + 1, full: lines[parsed[i + 1].idx].split(';')[0].trim() };
      }
    }

    if (!laserOnCmd) {
      const best = Object.values(beforeMove).sort((a, b) => b.count - a.count)[0];
      if (best) laserOnCmd = best.full;
    }
    if (!laserOffCmd) {
      const best = Object.values(afterMove).sort((a, b) => b.count - a.count)[0];
      if (best) laserOffCmd = best.full;
    }

    const feedCut = feedValues.length ? Math.round(feedValues.reduce((a, b) => a + b) / feedValues.length) : 3000;
    const feedTravel = 8000;
    const sMax = sValues.length ? Math.max(...sValues) : 1000;

    return {
      name: '',
      ext,
      lineEnd,
      customCommands: [...customTypes].sort(),
      toolCodes: [...toolCodes].sort(),
      laserOnCmd,
      laserOffCmd,
      header: headerLines,
      footer: footerLines,
      feedCut,
      feedTravel,
      sMax,
      originalName,
      extractedAt: new Date().toISOString()
    };
  },

  extractFromCommands(commands, originalText, originalName) {
    return this.extractFromText(originalText || '', originalName || '');
  },

  applyToSvgConverter(template) {
    if (!template) return null;
    const t = template.data || template;
    return {
      laser: {
        feedCut: t.feedCut || 3000,
        feedTravel: t.feedTravel || 8000,
        sMax: t.sMax || 1000,
        laserOnCmd: t.laserOnCmd || 'M4',
      },
      header: t.header || [],
      footer: t.footer || ['M5', 'G0 X0 Y0', 'M30'],
    };
  }
};
