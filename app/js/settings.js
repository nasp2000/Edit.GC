// ---- LocalStorage persistence for all UI settings ----
const settings = {
  _key: 'editgc_settings',

  _defaults: {
    templateName:      '',

    scaleStep: 1,
    chkBounds: true,
    chkCompare: false,
    chkColorByFeed: false,
    chkRapids: true,

    chkMinimap: true,
    chkTagEdits: true,
    playSpeed: 1,
    svgOutlineMode: 'outlines',
    batchAxis: 'X', batchValue: 0, batchStep: 1, batchTarget: 'all',
  },

  load() {
    try {
      const raw = localStorage.getItem(this._key);
      return raw ? { ...this._defaults, ...JSON.parse(raw) } : { ...this._defaults };
    } catch (_) {
      return { ...this._defaults };
    }
  },

  save(obj) {
    try {
      const prev = this.load();
      localStorage.setItem(this._key, JSON.stringify({ ...prev, ...obj }));
    } catch (_) {}
  },

  get(key) {
    const s = this.load();
    return s[key];
  },

  set(key, value) {
    this.save({ [key]: value });
  },

  applyAll() {
    const s = this.load();
    const _set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    const _chk = (id, val) => { const el = document.getElementById(id); if (el) { el.checked = !!val; el.dispatchEvent(new Event('change')); } };

    _set('scaleStep', s.scaleStep);
    document.getElementById('scaleStep')?.dispatchEvent(new Event('change'));

    _chk('chkBounds', s.chkBounds);
    _chk('chkCompare', s.chkCompare);
    _chk('chkColorByFeed', s.chkColorByFeed);
    _chk('chkRapids', s.chkRapids);
    _chk('chkMinimap', s.chkMinimap);
    _chk('chkTagEdits', s.chkTagEdits);

    _set('playSpeed', s.playSpeed);
    const spdLabel = document.getElementById('playSpeedLabel');
    if (spdLabel) spdLabel.textContent = s.playSpeed + 'x';

    _set('outlineMode', s.svgOutlineMode);

    if (s.batchAxis) _set('batchAxis', s.batchAxis);
    if (s.batchValue !== undefined) _set('batchAxisVal', s.batchValue);
    if (s.batchStep) _set('batchStep', s.batchStep);
    if (s.batchTarget) _set('batchTarget', s.batchTarget);

    if (s.templateName) {
      const tplSel = document.getElementById('templateSelect');
      if (tplSel) {
        tplSel.value = s.templateName;
        tplSel.dispatchEvent(new Event('change'));
      }
    }
  },

  captureUI() {
    const _val = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
    const _num = (id) => { const el = document.getElementById(id); return el ? parseFloat(el.value) || 0 : 0; };
    const _chk = (id) => { const el = document.getElementById(id); return el ? el.checked : false; };
    this.save({

      scaleStep: _val('scaleStep'),
      chkBounds: _chk('chkBounds'), chkCompare: _chk('chkCompare'),
      chkColorByFeed: _chk('chkColorByFeed'), chkRapids: _chk('chkRapids'),
      chkMinimap: _chk('chkMinimap'),
      chkTagEdits: _chk('chkTagEdits'),
      playSpeed: _num('playSpeed'),
      svgOutlineMode: _val('outlineMode'),
      batchAxis: _val('batchAxis'), batchValue: _num('batchAxisVal'),
      batchStep: _val('batchStep'), batchTarget: _val('batchTarget'),
      templateName: _val('templateSelect'),
    });
  }
};
