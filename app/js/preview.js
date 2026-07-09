const preview = {
  canvas: null,
  ctx: null,
  originX: 0,
  originY: 0,
  _segVersion: 0,
  _segBuilding: false,
  _segments: null,
  _points: null,
  _segBounds: null,
  _segCommands: null,
  _segTruncated: false,
  _origSegments: null,
  _origPoints: null,
  _origBounds: null,
  _drawRafId: null,
  _hlCmdIdx: -1,      // backplot: command index to highlight
  _hlTimeout: null,   // auto-clear timeout

  // Returns cached bounds from segments if available, otherwise computes from commands
  _getBounds(commands) {
    if (this._segBounds) return this._segBounds;
    if (!commands || !commands.length) return null;
    const len = commands.length;
    const mid = Math.floor(len / 2);
    const hash = len + '|' +
      (commands[0]?.params?.X ?? '') + '|' + (commands[0]?.params?.Y ?? '') + '|' +
      (commands[mid]?.params?.X ?? '') + '|' + (commands[mid]?.params?.Y ?? '') + '|' +
      (commands[len-1]?.params?.X ?? '') + '|' + (commands[len-1]?.params?.Y ?? '');
    if (state._boundsCache && state._boundsCache._hash === hash) return state._boundsCache;
    const xs = [], ys = [];
    let isRel = false, curX = 0, curY = 0;
    commands.forEach(c => {
      if (c.type === 'G91') { isRel = true; return; }
      if (c.type === 'G90') { isRel = false; return; }
      if (c.params.X !== undefined) { const ax = isRel ? curX + c.params.X : c.params.X; xs.push(ax); curX = ax; }
      if (c.params.Y !== undefined) { const ay = isRel ? curY + c.params.Y : c.params.Y; ys.push(ay); curY = ay; }
    });
    if (!xs.length) return null;
    const mmX = safeMinMax(xs), mmY = safeMinMax(ys);
    const minX = mmX.min, maxX = mmX.max, minY = mmY.min, maxY = mmY.max;
    state._boundsCache = {
      _hash: hash,
      minX, maxX, minY, maxY,
      rangeX: maxX - minX || 1,
      rangeY: maxY - minY || 1,
    };
    return state._boundsCache;
  },

  // â”€â”€ Segment-based G-code preview (2D) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  buildOriginal() {
    if (this._origSegments || !state.originalCmds || !state.originalCmds.length) return;
    const cmds = state.originalCmds;
    this._buildSegmentsAsync(cmds, (result) => {
      this._origSegments = result.segments;
      this._origPoints = result.points;
      this._origBounds = result.bounds;
      this.draw(state.workingCmds);
    }, () => {});
  },

  _buildSegmentsAsync(commands, onDone, onProgress) {
    if (this._segBuilding) return;
    const total = commands.length;
    if (total === 0) { if (onDone) onDone({ points: [], segments: [], bounds: null, truncated: false }); return; }

    this._segBuilding = true;
    this._segVersion++;

    // Helper to finalise after build
    const finish = (result) => {
      this._segBuilding = false;
      const bounds = segmentBuilder.computeBounds(result.points);
      this._segments = result.segments;
      this._points = result.points;
      this._segBounds = bounds;
      this._segTruncated = result.truncated;
      if (onDone) onDone(result);
    };

    // For small files, build synchronously (fast path)
    if (total <= 20000) {
      const result = segmentBuilder.build(commands);
      finish(result);
      return;
    }

    // For large files, defer via setTimeout to keep UI responsive
    const doBuild = () => {
      const result = segmentBuilder.build(commands);
      finish(result);
    };
    // Use setTimeout with progress update before starting
    if (onProgress) onProgress(0);
    setTimeout(doBuild, 50);
  },

  fitView() {
    state.previewScale = 1;
    state.previewOffX = 0;
    state.previewOffY = 0;
    this.draw(state.workingCmds);
  },

  _computeSegBounds(points) {
    if (!points || points.length < 1) return null;
    let minX = points[0].x, maxX = points[0].x, minY = points[0].y, maxY = points[0].y, minZ = points[0].z, maxZ = points[0].z;
    for (let i = 1; i < points.length; i++) {
      const p = points[i];
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
    }
    return { minX, maxX, minY, maxY, minZ, maxZ, rangeX: maxX - minX || 1, rangeY: maxY - minY || 1 };
  },

  init(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.resize();
    // Use ResizeObserver for efficient responsive sizing (instead of window.resize)
    if (window.ResizeObserver) {
      if (!canvas._resizeObserver) {
        canvas._resizeObserver = new ResizeObserver(() => this.resize());
        canvas._resizeObserver.observe(canvas.parentElement);
      }
    } else {
      window.addEventListener('resize', () => this.resize());
    }
    this._setupPanZoom();
  },
  resize() {
    if (!this.canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.offsetWidth;
    const h = this.canvas.offsetHeight;
    if (this.canvas.width !== Math.floor(w * dpr) || this.canvas.height !== Math.floor(h * dpr)) {
      this.canvas.width  = Math.floor(w * dpr);
      this.canvas.height = Math.floor(h * dpr);
      this.ctx.scale(dpr, dpr);
    }
    this.canvas.style.width  = w + 'px';
    this.canvas.style.height = h + 'px';
    this.draw(state.workingCmds);
  },
  _setupPanZoom() {
    const c = this.canvas;
    let dragging = false, lastX = 0, lastY = 0;
    let rafPending = false;
    const scheduleDraw = () => {
      if (!rafPending) {
        rafPending = true;
        requestAnimationFrame(() => {
          rafPending = false;
          this.draw(state.workingCmds);
        });
      }
    };
    c.addEventListener('wheel', e => { e.preventDefault(); state.previewScale *= e.deltaY < 0 ? 1.1 : 0.9; scheduleDraw(); }, { passive: false });
    c.addEventListener('mousedown', e => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
    window.addEventListener('mouseup', () => { dragging = false; });
    // Click: measure | origin mark | point select | set origin
    c.addEventListener('click', e => {
      if (e.clientX !== lastX || e.clientY !== lastY) return;
      if (pickMode) {
        this._handlePickClick(e);
      } else if (measureMode) {
        this._handleMeasureClick(e);
      } else if (originMarkMode) {

        this._setMarkFromClick(e);
      } else if (state.mode === 'gcode') {
        this._selectPointFromClick(e);
      } else {
        this._setOriginFromClick(e);
      }
    });
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      state.previewOffX += e.clientX - lastX;
      state.previewOffY += e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      scheduleDraw();
    });
  },
  // â”€â”€ Playback state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  _pb: { rafId: null, idx: 0, paused: false, active: false },

  draw(commands) {
    this._stopPlayback();
    const cmds = commands;
    if (this._drawRafId) { cancelAnimationFrame(this._drawRafId); this._drawRafId = null; }
    const n = cmds ? cmds.length : 0;
    if (state.mode === 'gcode' && n > 0 && cmds !== this._segCommands) {
      this._segments = null;
      this._points = null;
      this._segCommands = cmds;
      this._segBuilding = false; // abort any stale build
      this._segVersion++;
    }
    if (state.mode === 'gcode' && !this._segments && !this._segBuilding && n > 0) {
      ui.setProgress(0, 'Building preview…');
      this._buildSegmentsAsync(cmds, (result) => {
        ui.setProgress(-1);
        this._drawCore(cmds, n);
        if (ui.updateResizePanel) ui.updateResizePanel();
      }, (pct) => {
        ui.setProgress(pct, 'Building preview…');
      });
      this._drawCore(cmds, 0);
      return;
    }
    this._drawCore(cmds, n);
  },

  _drawInit() {
    if (!this.canvas) return;
    const { width: w, height: h } = this.canvas;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    // grid
    const gStep = Math.max(2, 10 * state.previewScale);
    const ox = (state.previewOffX % gStep + gStep) % gStep;
    const oy = (state.previewOffY % gStep + gStep) % gStep;
    ctx.strokeStyle = '#e8e8e8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = ox; x < w; x += gStep) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = oy; y < h; y += gStep) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
    const gStep5 = gStep * 5;
    const ox5 = (state.previewOffX % gStep5 + gStep5) % gStep5;
    const oy5 = (state.previewOffY % gStep5 + gStep5) % gStep5;
    ctx.strokeStyle = '#cccccc';
    ctx.beginPath();
    for (let x = ox5; x < w; x += gStep5) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = oy5; y < h; y += gStep5) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
  },

  _drawChunked(commands, limit) {
    if (!this.canvas || !commands || !limit) return;
    // SVG/DXF modes don't need chunking
    if (state.mode !== 'gcode') { this._drawCore(commands, limit); return; }
    const b = this._getBounds(commands);
    if (!b) return;
    this._drawInit();
    const { minX, minY, maxX, maxY, rangeX, rangeY } = b;
    const { width: w, height: h } = this.canvas;
    const pad = 40;
    const baseFit = Math.min((w - pad * 2) / rangeX, (h - pad * 2) / rangeY);
    const toCanvasX = x => pad + (x - minX) * baseFit * state.previewScale + state.previewOffX;
    const toCanvasY = y => h - pad - (y - minY) * baseFit * state.previewScale + state.previewOffY;
    const ctx = this.ctx;
    const sMax = 1000;
    const CHUNK = 2000;
    let curX = 0, curY = 0, isRel = false;
    let batchPath = null, batchColor = null, batchDash = null, batchWidth = 1;
    const flushBatch = () => {
      if (!batchPath) return;
      if (batchDash) ctx.setLineDash(batchDash);
      ctx.strokeStyle = batchColor;
      ctx.lineWidth = batchWidth;
      ctx.stroke();
      ctx.setLineDash([]);
      batchPath = null; batchColor = null; batchDash = null;
    };
    let idx = 0;
    const processChunk = () => {
      const end = Math.min(idx + CHUNK, limit);
      for (; idx < end; idx++) {
        const c = commands[idx];
        if (c.type === 'G91') { isRel = true; continue; }
        if (c.type === 'G90') { isRel = false; continue; }
        let x = curX, y = curY;
        if (c.params.X !== undefined) x = isRel ? curX + c.params.X : c.params.X;
        if (c.params.Y !== undefined) y = isRel ? curY + c.params.Y : c.params.Y;
        const type = c.type;
        if (type === 'G0' || type === 'G00') {
          if (batchColor !== '#aaaaaa') flushBatch();
          batchColor = '#aaaaaa'; batchDash = [4, 6]; batchWidth = 1;
          if (!batchPath) { ctx.beginPath(); batchPath = true; ctx.moveTo(toCanvasX(curX), toCanvasY(curY)); }
          ctx.lineTo(toCanvasX(x), toCanvasY(y));
        } else if (type === 'G1' || type === 'G01') {
          const s = c.params.S || sMax;
          const ratio = Math.min(1, s / sMax);
          const color = `rgb(${Math.round(220*ratio)},${Math.round(60*(1-ratio))},${Math.round(200*(1-ratio))})`;
          if (batchColor !== color) flushBatch();
          batchColor = color; batchDash = null; batchWidth = 1.5;
          if (!batchPath) { ctx.beginPath(); batchPath = true; ctx.moveTo(toCanvasX(curX), toCanvasY(curY)); }
          ctx.lineTo(toCanvasX(x), toCanvasY(y));
        } else { flushBatch(); }
        curX = x; curY = y;
      }
      flushBatch();
      const pct = Math.round(idx / limit * 100);
      ui.setProgress(pct, `Rendering ${Math.min(idx, limit)}/${limit}`);
      if (idx < limit) {
        this._drawRafId = requestAnimationFrame(processChunk);
      } else {
        this._drawFinalize(commands, limit, b, toCanvasX, toCanvasY);
        ui.setProgress(100, 'Done');
        setTimeout(() => ui.setProgress(-1), 800);
        this._drawRafId = null;
      }
    };
    ui.setProgress(0, 'Rendering…');
    requestAnimationFrame(processChunk);
  },

  _drawFinalize(commands, limit, b, toCanvasX, toCanvasY) {
    const ctx = this.ctx;
    const { minX, minY, rangeX, rangeY } = b;
    // selected points
    state.selectedPoints.forEach(idx => {
      const c = commands[idx];
      if (!c) return;
      const px = c.params.X ?? 0;
      const py = c.params.Y ?? 0;
      ctx.beginPath(); ctx.arc(toCanvasX(px), toCanvasY(py), 6, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff8800'; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.arc(toCanvasX(px), toCanvasY(py), 4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,136,0,0.3)'; ctx.fill();
    });
    // origin mark
    if (state.originMark) {
      const mx = toCanvasX(state.originMark.x);
      const my = toCanvasY(state.originMark.y);
      const sz = 16;
      ctx.save();
      ctx.shadowColor = 'rgba(255,0,0,0.5)';
      ctx.shadowBlur = 8;
      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(mx - sz, my - sz); ctx.lineTo(mx + sz, my + sz);
      ctx.moveTo(mx + sz, my - sz); ctx.lineTo(mx - sz, my + sz);
      ctx.stroke();
      ctx.shadowBlur = 0;
      const dir = state.originMark.dir;
      ctx.fillStyle = '#ff0000';
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(dir === 'left' ? 'â—€' : '>', mx, my + sz + 18);
      ctx.restore();
    }
    this._setInfo(`W: ${rangeX.toFixed(2)} mm  H: ${rangeY.toFixed(2)} mm`);
  },

  drawUpTo(commands, idx) {
    this._drawCore(commands, idx);
  },

  play() {
    const commands = state.workingCmds;
    if (!commands || !commands.length) return;
    if (this._pb.paused) {
      // resume
      this._pb.paused = false;
      this._tick();
      return;
    }
    // fresh start
    this._pb.active = true;
    this._pb.paused = false;
    this._pb.idx    = 0;
    this._tick();
  },

  pause() {
    if (!this._pb.active) return;
    this._pb.paused = true;
    if (this._pb.rafId) { cancelAnimationFrame(this._pb.rafId); this._pb.rafId = null; }
  },

  stop() {
    this._stopPlayback();
    this._drawCore(state.workingCmds, state.workingCmds ? state.workingCmds.length : 0);
  },

  _stopPlayback() {
    this._pb.active = false;
    this._pb.paused = false;
    this._pb.idx    = 0;
    if (this._pb.rafId) { cancelAnimationFrame(this._pb.rafId); this._pb.rafId = null; }
  },

  _updatePlayProgress() {
    const cmds = state.workingCmds;
    const total = cmds ? cmds.length : 0;
    const idx = this._pb.idx || 0;
    const pct = total > 0 ? Math.round(idx / total * 100) : 0;
    const slider = document.getElementById('playProgress');
    if (slider) slider.value = pct;
  },

  _tick() {
    const commands = state.workingCmds;
    if (!this._pb.active || this._pb.paused || !commands) return;
    const speed = parseInt(document.getElementById('playSpeed').value) || 30;
    this._pb.idx = Math.min(this._pb.idx + speed, commands.length);
    this._drawCore(commands, this._pb.idx);
    // draw cursor dot at head position
    this._drawHead(commands, this._pb.idx);
    this._updatePlayProgress();
    if (this._pb.idx < commands.length) {
      this._pb.rafId = requestAnimationFrame(() => this._tick());
    } else {
      this._pb.active = false;
      document.getElementById('btnPlay').textContent = '▶';
    }
  },

  _drawHead(commands, idx) {
    if (!idx || !commands[idx - 1]) return;
    const c = commands[idx - 1];
    if (c.params.X === undefined && c.params.Y === undefined) return;
    const { width: w, height: h } = this.canvas;
    const b = this._getBounds(commands);
    if (!b) return;
    const { minX, minY, rangeX, rangeY } = b;
    const pad = 40;
    const baseFit = Math.min((w - pad * 2) / rangeX, (h - pad * 2) / rangeY);
    const toCanvasX = x => pad + (x - minX) * baseFit * state.previewScale + state.previewOffX;
    const toCanvasY = y => h - pad - (y - minY) * baseFit * state.previewScale + state.previewOffY;
    // Compute absolute position at idx-1, handling G90/G91
    let hx = 0, hy = 0, curX = 0, curY = 0, isRel = false;
    for (let i = 0; i < idx; i++) {
      const cmd = commands[i];
      if (cmd.type === 'G91') { isRel = true; continue; }
      if (cmd.type === 'G90') { isRel = false; continue; }
      if (cmd.params.X !== undefined) curX = isRel ? curX + cmd.params.X : cmd.params.X;
      if (cmd.params.Y !== undefined) curY = isRel ? curY + cmd.params.Y : cmd.params.Y;
    }
    hx = curX; hy = curY;
    const ctx = this.ctx;
    const cx = toCanvasX(hx), cy = toCanvasY(hy);
    const isLaserOn = ['G1','G01','G2','G02','G3','G03'].includes(c.type);
    ctx.save();
    // Laser indicator dot
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = isLaserOn ? '#ff0000' : '#00cc00';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Cone / head triangle
    if (isLaserOn) {
      const coneSize = 8;
      ctx.beginPath();
      ctx.moveTo(cx, cy - coneSize);
      ctx.lineTo(cx - coneSize * 0.6, cy + coneSize * 0.4);
      ctx.lineTo(cx + coneSize * 0.6, cy + coneSize * 0.4);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,0,0,0.15)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,0,0,0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  },

  _drawCore(commands, limit) {
    if (!this.canvas) return;
    const { width: w, height: h } = this.canvas;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);

    // fundo do canvas
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    // grid (batched for performance)
    const gStep = Math.max(2, 10 * state.previewScale);
    const ox = (state.previewOffX % gStep + gStep) % gStep;
    const oy = (state.previewOffY % gStep + gStep) % gStep;
    ctx.strokeStyle = '#e8e8e8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = ox; x < w; x += gStep) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = oy; y < h; y += gStep) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
    // grid principal (cada 5 cÃ©lulas)
    const gStep5 = gStep * 5;
    const ox5 = (state.previewOffX % gStep5 + gStep5) % gStep5;
    const oy5 = (state.previewOffY % gStep5 + gStep5) % gStep5;
    ctx.strokeStyle = '#cccccc';
    ctx.beginPath();
    for (let x = ox5; x < w; x += gStep5) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = oy5; y < h; y += gStep5) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();

    // â”€â”€ SVG mode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (state.mode === 'svg' && state.svgText) {
      if (state.svgPreviewMode === 'raster' && state.svgImg) {
        // Raster image with fills/engraving
        try {
          const s = state.svgScale;
          const imgW = state.svgImg.naturalWidth || 1;
          const imgH = state.svgImg.naturalHeight || 1;
          const rPad = 40;
          const baseFit = Math.min((w - rPad * 2) / (imgW * s), (h - rPad * 2) / (imgH * s));
          const drawW = imgW * s * baseFit * state.previewScale;
          const drawH = imgH * s * baseFit * state.previewScale;
          const drawX = (w - drawW) / 2 + state.previewOffX;
          const drawY = (h - drawH) / 2 + state.previewOffY;
          ctx.drawImage(state.svgImg, drawX, drawY, drawW, drawH);
          // SVG dimensions (scaled)
          const parser = new DOMParser();
          const doc = parser.parseFromString(state.svgText, 'image/svg+xml');
          const svgEl = doc.querySelector('svg');
          if (svgEl) {
            const vb = svgConverter._getViewBox(svgEl);
            const sw = vb.width * s, sh = vb.height * s;
            this._setInfo(`W: ${sw.toFixed(2)} mm  H: ${sh.toFixed(2)} mm`);
            document.getElementById('resizeW').value = sw.toFixed(3);
            document.getElementById('resizeH').value = sh.toFixed(3);
            state.resizeBaseW = sw;
            state.resizeBaseH = sh;
          }
        } catch (_) {}
      } else {
        // Contours (outline paths) — cached for performance
        try {
          if (!state.svgSegments) {
            const parser2 = new DOMParser();
            const doc2 = parser2.parseFromString(state.svgText, 'image/svg+xml');
            const svgEl2 = doc2.querySelector('svg');
            if (svgEl2) {
              const vb2 = svgConverter._getViewBox(svgEl2);
              const scale2 = svgConverter._getScaleToMm(svgEl2, vb2);
              const segs = [];
              svgConverter._extractElements(svgEl2, segs, scale2, vb2);
              state.svgSegments = segs;
            }
          }
          const segments = state.svgSegments;
          if (segments && segments.length) {
            const s = state.svgScale;
            const all = segments.flat();
            const xs = all.map(p => p.x * s);
            const ys = all.map(p => p.y * s);
            const mmX2 = safeMinMax(xs), mmY2 = safeMinMax(ys);
            const minX = mmX2.min, maxX = mmX2.max, minY = mmY2.min, maxY = mmY2.max;
            const rangeX = maxX - minX || 1, rangeY = maxY - minY || 1;
            const pad = 40;
            const baseFit = Math.min((w - pad * 2) / rangeX, (h - pad * 2) / rangeY);
            const toCx = x => pad + (x - minX) * baseFit * state.previewScale + state.previewOffX;
            const toCy = y => h - pad - (y - minY) * baseFit * state.previewScale + state.previewOffY;
            ctx.strokeStyle = '#2563eb';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([]);
            segments.forEach(seg => {
              if (!seg || seg.length < 2) return;
              ctx.beginPath();
              ctx.moveTo(toCx(seg[0].x * s), toCy(seg[0].y * s));
              for (let i = 1; i < seg.length; i++) {
                ctx.lineTo(toCx(seg[i].x * s), toCy(seg[i].y * s));
              }
              ctx.stroke();
            });
            this._setInfo(`W: ${rangeX.toFixed(2)} mm  H: ${rangeY.toFixed(2)} mm`);
            document.getElementById('resizeW').value = rangeX.toFixed(3);
            document.getElementById('resizeH').value = rangeY.toFixed(3);
            state.resizeBaseW = rangeX;
            state.resizeBaseH = rangeY;
          }
        } catch (_) {}
      }
      return;
    }

    // â”€â”€ DXF mode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (state.mode === 'dxf' && state.dxfSegments && state.dxfSegments.length) {
      try {
        const all = state.dxfSegments.flat();
        const xs = all.map(p => p.x);
        const ys = all.map(p => p.y);
        const mmX3 = safeMinMax(xs), mmY3 = safeMinMax(ys);
        const minX = mmX3.min, maxX = mmX3.max, minY = mmY3.min, maxY = mmY3.max;
        const rangeX = maxX - minX || 1, rangeY = maxY - minY || 1;
        const pad = 40;
        const baseFit = Math.min((w - pad * 2) / rangeX, (h - pad * 2) / rangeY);
        const toCx = x => pad + (x - minX) * baseFit * state.previewScale + state.previewOffX;
        const toCy = y => h - pad - (y - minY) * baseFit * state.previewScale + state.previewOffY;
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
        state.dxfSegments.forEach(seg => {
          if (!seg || seg.length < 2) return;
          ctx.beginPath();
          ctx.moveTo(toCx(seg[0].x), toCy(seg[0].y));
          for (let i = 1; i < seg.length; i++) {
            ctx.lineTo(toCx(seg[i].x), toCy(seg[i].y));
          }
          ctx.stroke();
        });
        this._setInfo(`W: ${rangeX.toFixed(2)} mm  H: ${rangeY.toFixed(2)} mm`);
      } catch (_) {}
      return;
    }

    // â”€â”€ G-code mode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (!commands || !commands.length) return;

    // Segment-based 2D preview
    if (!this._segments || this._segments.length === 0) {
      // Still building segments; draw placeholder
      ctx.fillStyle = '#555';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Building preview…', w / 2, h / 2);
      return;
    }

    const b = this._segBounds || this._computeSegBounds(this._points);
    if (!b) return;
    const { minX, maxX, minY, maxY, rangeX, rangeY } = b;
    const pad = 40;
    const baseFit = Math.min((w - pad * 2) / rangeX, (h - pad * 2) / rangeY);
    const toCanvasX = x => pad + (x - minX) * baseFit * state.previewScale + state.previewOffX;
    const toCanvasY = y => h - pad - (y - minY) * baseFit * state.previewScale + state.previewOffY;

    // Dynamic grid with labels
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.lineWidth = 1;
    const mmPerPx = 1 / (baseFit * state.previewScale);
    const minCellPx = 50 * dpr;
    const cand = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
    let step = 10;
    for (let i = 0; i < cand.length; i++) { if (cand[i] / mmPerPx >= minCellPx) { step = cand[i]; break; } }
    const startX = Math.floor(minX / step) * step;
    const startY = Math.floor(minY / step) * step;
    ctx.strokeStyle = 'rgba(148,163,184,0.22)';
    ctx.beginPath();
    for (let gx = startX; gx <= maxX; gx += step) { const cx = toCanvasX(gx); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); }
    for (let gy = startY; gy <= maxY; gy += step) { const cy = toCanvasY(gy); ctx.moveTo(0, cy); ctx.lineTo(w, cy); }
    ctx.stroke();
    ctx.fillStyle = 'rgba(148,163,184,0.65)';
    ctx.font = `${Math.round(9 * dpr)}px monospace`;
    ctx.textAlign = 'center';
    for (let gx = startX; gx <= maxX; gx += step) ctx.fillText(String(Math.round(gx * 100) / 100), toCanvasX(gx), h - 6);
    ctx.restore();

    // Work area border (bounding box)
    if (previewOpts.showBounds) {
      ctx.strokeStyle = 'rgba(59,130,246,0.6)';
      ctx.lineWidth = Math.max(1.5, dpr);
      ctx.strokeRect(toCanvasX(minX), toCanvasY(maxY), rangeX * baseFit * state.previewScale, rangeY * baseFit * state.previewScale);
    }

    // Original toolpath (compare mode)
    if (previewOpts.compareMode && this._origSegments && this._origSegments.length) {
      const origSegs = this._origSegments;
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      for (let i = 0; i < origSegs.length; i++) {
        const s = origSegs[i];
        ctx.moveTo(toCanvasX(s.a.x), toCanvasY(s.a.y));
        ctx.lineTo(toCanvasX(s.b.x), toCanvasY(s.b.y));
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Lightweight preview for truncated (huge) files
    if (this._segTruncated) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,165,0,0.5)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      const cx = toCanvasX((minX + maxX) / 2), cy = toCanvasY((minY + maxY) / 2);
      const hw = (maxX - minX) * baseFit * state.previewScale * 0.3;
      const hh = (maxY - minY) * baseFit * state.previewScale * 0.3;
      ctx.beginPath(); ctx.moveTo(cx - hw, cy - hh); ctx.lineTo(cx + hw, cy + hh); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + hw, cy - hh); ctx.lineTo(cx - hw, cy + hh); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,165,0,0.7)';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Lightweight preview (file too large)', cx, cy + hh + 16);
      ctx.restore();
      this._setInfo('');
      return;
    }

    // Draw segments batched by style
    const segments = this._segments;
    let batchPath = null, batchColor = null, batchDash = null, batchWidth = 1;
    const flushBatch = () => {
      if (!batchPath) return;
      if (batchDash) ctx.setLineDash(batchDash);
      ctx.strokeStyle = batchColor;
      ctx.lineWidth = batchWidth;
      ctx.stroke();
      ctx.setLineDash([]);
      batchPath = null; batchColor = null; batchDash = null;
    };
    const sMax = 1000;
    const feedMax = 8000;
    const segsToDraw = limit < commands.length ? Math.floor((limit / commands.length) * segments.length) : segments.length;
    for (let i = 0; i < segsToDraw; i++) {
      const s = segments[i];
      if (s.rapid) {
        if (batchColor !== 'rgba(170,170,170,0.65)') flushBatch();
        batchColor = 'rgba(170,170,170,0.65)'; batchDash = [4, 6]; batchWidth = 1;
      } else {
        const c = commands[s.cmdIdx];
        let ratio;
        if (previewOpts.colorByFeed) {
          const feed = c && c.params.F ? c.params.F : feedMax;
          ratio = Math.min(1, feed / feedMax);
        } else {
          const pow = c && c.params.S ? c.params.S : sMax;
          ratio = Math.min(1, pow / sMax);
        }
        const color = `rgb(${Math.round(34 + 200 * ratio)},${Math.round(211 - 160 * ratio)},${Math.round(238 - 80 * ratio)})`;
        if (batchColor !== color) flushBatch();
        batchColor = color; batchDash = null; batchWidth = 1.5;
      }
      if (!batchPath) { ctx.beginPath(); batchPath = true; ctx.moveTo(toCanvasX(s.a.x), toCanvasY(s.a.y)); }
      ctx.lineTo(toCanvasX(s.b.x), toCanvasY(s.b.y));
    }
    flushBatch();

    // Backplot highlight
    if (this._hlCmdIdx >= 0) {
      for (let i = 0; i < segments.length; i++) {
        const s = segments[i];
        if (s.cmdIdx === this._hlCmdIdx) {
          ctx.save();
          ctx.strokeStyle = '#ff0';
          ctx.lineWidth = 4;
          ctx.shadowColor = 'rgba(255,255,0,0.6)';
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.moveTo(toCanvasX(s.a.x), toCanvasY(s.a.y));
          ctx.lineTo(toCanvasX(s.b.x), toCanvasY(s.b.y));
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    // Axis lines at origin
    const ox0 = toCanvasX(0), oy0 = toCanvasY(0);
    if (ox0 >= 0 && ox0 <= w && oy0 >= 0 && oy0 <= h) {
      ctx.lineWidth = Math.max(1.2, dpr);
      ctx.strokeStyle = '#dc2626'; ctx.beginPath(); ctx.moveTo(ox0, oy0); ctx.lineTo(toCanvasX(Math.min(maxX, 20 * mmPerPx)), oy0); ctx.stroke();
      ctx.strokeStyle = '#16a34a'; ctx.beginPath(); ctx.moveTo(ox0, oy0); ctx.lineTo(ox0, toCanvasY(Math.min(maxY, 20 * mmPerPx))); ctx.stroke();
      ctx.fillStyle = '#22c55e'; ctx.beginPath(); ctx.arc(ox0, oy0, 3, 0, Math.PI * 2); ctx.fill();
    }

    // Selected points and origin mark
    state.selectedPoints.forEach(idx => {
      const c = commands[idx];
      if (!c) return;
      const px = c.params.X ?? 0, py = c.params.Y ?? 0;
      ctx.beginPath(); ctx.arc(toCanvasX(px), toCanvasY(py), 6, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff8800'; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.arc(toCanvasX(px), toCanvasY(py), 4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,136,0,0.3)'; ctx.fill();
    });

    if (state.originMark) {
      const mx = toCanvasX(state.originMark.x), my = toCanvasY(state.originMark.y);
      const sz = 16;
      ctx.save();
      ctx.shadowColor = 'rgba(255,0,0,0.5)'; ctx.shadowBlur = 8;
      ctx.strokeStyle = '#ff0000'; ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(mx - sz, my - sz); ctx.lineTo(mx + sz, my + sz);
      ctx.moveTo(mx + sz, my - sz); ctx.lineTo(mx - sz, my + sz);
      ctx.stroke(); ctx.shadowBlur = 0;
      ctx.fillStyle = '#ff0000'; ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(state.originMark.dir === 'left' ? 'â—€' : '>', mx, my + sz + 18);
      ctx.restore();
    }

    this._drawMeasureOverlay(ctx, toCanvasX, toCanvasY);
    this._drawMinimap(ctx, w, h, b, baseFit);
    this._setInfo(`W: ${rangeX.toFixed(2)} mm  H: ${rangeY.toFixed(2)} mm`);
  },
  // Click on canvas → set origin in world coordinates
  _setOriginFromClick(e) {
    if (!state.workingCmds.length) return;
    const rect = this.canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const b = this._getBounds(state.workingCmds);
    if (!b) return;
    const { minX, minY, rangeX, rangeY } = b;
    const w = this.canvas.width, h = this.canvas.height;
    const pad = 40;
    const baseFit = Math.min((w - pad * 2) / rangeX, (h - pad * 2) / rangeY);
    const worldX = (cx - pad - state.previewOffX) / (baseFit * state.previewScale) + minX;
    const worldY = minY + rangeY - (cy - pad - state.previewOffY) / (baseFit * state.previewScale);
    this.originX = parseFloat(worldX.toFixed(3));
    this.originY = parseFloat(worldY.toFixed(3));
    document.getElementById('originX').value = this.originX;
    document.getElementById('originY').value = this.originY;
    ui.setStatus(`Origin set to X=${this.originX}  Y=${this.originY}`);
  },

  // Click to place/remove origin mark (red X) — toggles on each click
  highlightLine(cmdIdx) {
    this._hlCmdIdx = cmdIdx;
    if (this._hlTimeout) clearTimeout(this._hlTimeout);
    this._hlTimeout = setTimeout(() => { this._hlCmdIdx = -1; this.draw(state.workingCmds); }, 2500);
    this.draw(state.workingCmds);
  },

  _getGridStep() {
    const b = this._getBounds(state.workingCmds);
    if (!b) return 10;
    const w = this.canvas.width, h = this.canvas.height;
    const pad = 40;
    const baseFit = Math.min((w - pad * 2) / b.rangeX, (h - pad * 2) / b.rangeY);
    const mmPerPx = 1 / (baseFit * state.previewScale);
    const cand = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
    for (let i = 0; i < cand.length; i++) { if (cand[i] / mmPerPx >= 50) return cand[i]; }
    return 10;
  },

  _setMarkFromClick(e) {
    // If mark already exists, remove it (toggle)
    if (state.originMark) {
      state.originMark = null;
      originMarkMode = null;
      document.getElementById('btnMarkLeft').style.background = '';
      document.getElementById('btnMarkRight').style.background = '';
      this.draw(state.workingCmds);
      ui.setStatus('Mark removed.');
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const b = this._getBounds(state.workingCmds);
    if (!b) {
      state.originMark = { x: cx, y: cy, dir: originMarkMode };
      this.draw(state.workingCmds);
      ui.setStatus(`Mark placed at canvas (${cx.toFixed(0)}, ${cy.toFixed(0)}) direction: ${originMarkMode}`);
      return;
    }
    const { minX, minY, rangeX, rangeY } = b;
    const w = this.canvas.width, h = this.canvas.height;
    const pad = 40;
    const baseFit = Math.min((w - pad * 2) / rangeX, (h - pad * 2) / rangeY);
    let worldX = (cx - pad - state.previewOffX) / (baseFit * state.previewScale) + minX;
    let worldY = minY + rangeY - (cy - pad - state.previewOffY) / (baseFit * state.previewScale);
    const step = this._getGridStep();
    worldX = Math.round(worldX / step) * step;
    worldY = Math.round(worldY / step) * step;
    state.originMark = { x: parseFloat(worldX.toFixed(3)), y: parseFloat(worldY.toFixed(3)), dir: originMarkMode };
    this.draw(state.workingCmds);
    ui.setStatus(`Mark at X=${state.originMark.x} Y=${state.originMark.y}`);
  },

  // Click to select/deselect point
  _selectPointFromClick(e) {
    if (!state.workingCmds.length) return;
    const rect = this.canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const b = this._getBounds(state.workingCmds);
    if (!b) return;
    const { minX, minY, rangeX, rangeY } = b;
    const w = this.canvas.width, h = this.canvas.height;
    const pad = 40;
    const baseFit = Math.min((w - pad * 2) / rangeX, (h - pad * 2) / rangeY);
    const toCanvasX = x => pad + (x - minX) * baseFit * state.previewScale + state.previewOffX;
    const toCanvasY = y => h - pad - (y - minY) * baseFit * state.previewScale + state.previewOffY;
    // Use segments for hit-testing (handles arc subdivisions correctly)
    const segs = this._segments;
    let bestCmdIdx = -1, bestDist = Infinity;
    if (segs && segs.length) {
      const visited = new Set();
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        // Skip if we already have this cmdIdx (multiple segments from same arc)
        if (visited.has(s.cmdIdx)) continue;
        visited.add(s.cmdIdx);
        const px = toCanvasX(s.b.x);
        const py = toCanvasY(s.b.y);
        const d = Math.hypot(cx - px, cy - py);
        if (d < bestDist) { bestDist = d; bestCmdIdx = s.cmdIdx; }
      }
    } else {
      // Fallback: iterate commands
      let _curX = 0, _curY = 0, _isRel = false;
      state.workingCmds.forEach((c, i) => {
        if (c.type === 'G91') { _isRel = true; return; }
        if (c.type === 'G90') { _isRel = false; return; }
        if (c.params.X !== undefined) _curX = _isRel ? _curX + c.params.X : c.params.X;
        if (c.params.Y !== undefined) _curY = _isRel ? _curY + c.params.Y : c.params.Y;
        if (c.params.X === undefined && c.params.Y === undefined) return;
        const px = toCanvasX(_curX);
        const py = toCanvasY(_curY);
        const d = Math.hypot(cx - px, cy - py);
        if (d < bestDist) { bestDist = d; bestCmdIdx = i; }
      });
    }
    if (bestCmdIdx < 0 || bestDist > 15) return;
    if (state.selectedPoints.has(bestCmdIdx)) {
      state.selectedPoints.delete(bestCmdIdx);
    } else {
      state.selectedPoints.add(bestCmdIdx);
    }
    document.getElementById('pointsInfo').textContent = state.selectedPoints.size
      ? `${state.selectedPoints.size} point(s) selected`
      : 'Select points on preview';
    const c = state.workingCmds[bestCmdIdx];
    if (c && c.lineIndex >= 0) {
      const ta = document.getElementById('editorWorking');
      const lines = ta.value.split('\n');
      let charPos = 0;
      for (let i = 0; i < c.lineIndex && i < lines.length; i++) charPos += lines[i].length + 1;
      const lineH = parseFloat(getComputedStyle(ta).lineHeight) || 20;
      ta.focus();
      ta.scrollTop = c.lineIndex * lineH - ta.clientHeight / 3;
      ta.setSelectionRange(charPos, charPos);
    }
    this.draw(state.workingCmds);
  },

  _handlePickClick(e) {
    pickMode = false;
    const mb = document.getElementById('btnPick');
    if (mb) mb.style.background = '';
    const rect = this.canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const b = this._getBounds(state.workingCmds);
    if (!b) { ui.setStatus('No G-code loaded.', 'error'); return; }
    const { minX, minY, rangeX, rangeY } = b;
    const w = this.canvas.width, h = this.canvas.height;
    const pad = 40;
    const baseFit = Math.min((w - pad * 2) / rangeX, (h - pad * 2) / rangeY);
    const worldX = ((cx - pad - state.previewOffX) / (baseFit * state.previewScale) + minX).toFixed(3);
    const worldY = (minY + rangeY - (cy - pad - state.previewOffY) / (baseFit * state.previewScale)).toFixed(3);
    const line = 'G1 X' + worldX + ' Y' + worldY;
    const ta = document.getElementById('editorWorking');
    if (ta && ta.style.display !== 'none') {
      const pos = ta.selectionStart;
      const before = ta.value.substring(0, pos);
      const after = ta.value.substring(pos);
      ta.value = before + '\n' + line + after;
      ta.selectionStart = ta.selectionEnd = pos + line.length + 1;
      ta.dispatchEvent(new Event('input'));
    } else if (ui._ve) {
      const text = ui._ve.getText();
      const pos = text.length;
      ui._ve.setText(text + '\n' + line);
    }
    ui.setStatus('Inserted G1 X' + worldX + ' Y' + worldY);
  },

  _handleMeasureClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const b = this._getBounds(state.workingCmds);
    const w = this.canvas.width, h = this.canvas.height;
    if (!b) { ui.setStatus('No bounds for measurement.', 'error'); return; }
    const { minX, minY, rangeX, rangeY } = b;
    const pad = 40;
    const baseFit = Math.min((w - pad * 2) / rangeX, (h - pad * 2) / rangeY);
    let worldX = (cx - pad - state.previewOffX) / (baseFit * state.previewScale) + minX;
    let worldY = minY + rangeY - (cy - pad - state.previewOffY) / (baseFit * state.previewScale);
    const step = this._getGridStep();
    worldX = Math.round(worldX / step) * step;
    worldY = Math.round(worldY / step) * step;
    if (!measureStart) {
      measureStart = { x: parseFloat(worldX.toFixed(3)), y: parseFloat(worldY.toFixed(3)) };
      measureEnd = null;
      ui.setStatus(`Measure from (${measureStart.x}, ${measureStart.y}) — click again`);
    } else {
      measureEnd = { x: parseFloat(worldX.toFixed(3)), y: parseFloat(worldY.toFixed(3)) };
      const dx = measureEnd.x - measureStart.x;
      const dy = measureEnd.y - measureStart.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      ui.setStatus(`Distance: ${dist.toFixed(2)} mm  ΔX: ${dx.toFixed(2)}  ΔY: ${dy.toFixed(2)}`);
    }
    this.draw(state.workingCmds);
  },

  _drawMinimap(ctx, w, h, b, baseFit) {
    if (!previewOpts.showMinimap || !this._segments || this._segments.length < 10) return;
    const mmSize = 120;
    const mmX = w - mmSize - 10;
    const mmY = h - mmSize - 10;
    const { minX, maxX, minY, maxY } = b;
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const pad = 4;
    const mmScale = Math.min((mmSize - pad * 2) / rangeX, (mmSize - pad * 2) / rangeY);
    const mmOx = x => mmX + pad + (x - minX) * mmScale;
    const mmOy = y => mmY + pad + (maxY - y) * mmScale;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(mmX, mmY, mmSize, mmSize);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mmX, mmY, mmSize, mmSize);
    ctx.strokeStyle = 'rgba(34,211,238,0.5)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let i = 0; i < this._segments.length; i++) {
      const s = this._segments[i];
      ctx.moveTo(mmOx(s.a.x), mmOy(s.a.y));
      ctx.lineTo(mmOx(s.b.x), mmOy(s.b.y));
    }
    ctx.stroke();
    // Viewport rectangle: convert canvas viewport to world, then to minimap
    const pad40 = 40;
    const vpLeft = (-state.previewOffX - pad40) / (baseFit * state.previewScale) + minX;
    const vpTop  = maxY - (-state.previewOffY - pad40) / (baseFit * state.previewScale);
    const vpW    = (w - pad40 * 2) / (baseFit * state.previewScale);
    const vpH    = (h - pad40 * 2) / (baseFit * state.previewScale);
    const vx = mmOx(vpLeft);
    const vy = mmOy(vpTop + vpH);
    const vw = vpW * mmScale;
    const vh = vpH * mmScale;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(Math.max(mmX + pad, vx), Math.max(mmY + pad, vy), Math.min(mmSize - pad * 2, vw), Math.min(mmSize - pad * 2, vh));
    ctx.restore();
  },

  _drawMeasureOverlay(ctx, toCanvasX, toCanvasY) {
    if (measureStart) {
      const sx = toCanvasX(measureStart.x), sy = toCanvasY(measureStart.y);
      const ex = measureEnd ? toCanvasX(measureEnd.x) : sx;
      const ey = measureEnd ? toCanvasY(measureEnd.y) : sy;
      ctx.save();
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(toCanvasX(measureStart.x), toCanvasY(measureStart.y));
      if (measureEnd) ctx.lineTo(toCanvasX(measureEnd.x), toCanvasY(measureEnd.y));
      ctx.stroke();
      ctx.setLineDash([]);
      [measureStart, measureEnd].forEach(p => {
        if (!p) return;
        const px = toCanvasX(p.x), py = toCanvasY(p.y);
        ctx.fillStyle = '#22d3ee';
        ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.stroke();
      });
      if (measureEnd) {
        const dx = measureEnd.x - measureStart.x;
        const dy = measureEnd.y - measureStart.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const mx = (toCanvasX(measureStart.x) + toCanvasX(measureEnd.x)) / 2;
        const my = (toCanvasY(measureStart.y) + toCanvasY(measureEnd.y)) / 2;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        const label = `${dist.toFixed(1)} mm`;
        ctx.font = '12px sans-serif';
        const tw = ctx.measureText(label).width;
        ctx.fillRect(mx - tw / 2 - 4, my - 10, tw + 8, 20);
        ctx.fillStyle = '#22d3ee';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, mx, my + 1);
      }
      ctx.restore();
    }
  },

  _setInfo(text) {
    // Dimensions are shown in Scale widget only
  },
};

