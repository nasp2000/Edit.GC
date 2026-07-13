const preview = {
  canvas: null,
  ctx: null,
  originX: 0,
  originY: 0,
  _segVersion: 0,
  _segBuilding: false,
  _segments: null,
  _points: null,     // full point array (kept only when needed for hit-testing)
  _segBounds: null,
  _segCommands: null,
  _segTruncated: false,
  _origSegments: null,
  _origPoints: null,
  _origBounds: null,
  _hlCmdIdx: -1,      // backplot: command index to highlight
  _hlTimeout: null,   // auto-clear timeout
  _rebuildTimer: null,// debounce timer for segment rebuild
  _lastProgDraw: 0,   // throttle timestamp for progressive draws
  _keepPoints: false, // set true only while a point-pick session is active

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

  // ── Shared grid + axes for SVG/DXF modes ──────────────────────────
  _drawGridAxesSVG(ctx, w, h, b, baseFit) {
    const { minX, maxX, minY, maxY, rangeX, rangeY } = b;
    const dpr = window.devicePixelRatio || 1;
    const pad = 40;
    // Center the toolpath in the canvas (top-down view) — must match the
    // segment transforms above so grid/axes align with the toolpath.
    const cx = (w - pad * 2 - rangeX * baseFit) / 2;
    const cy = (h - pad * 2 - rangeY * baseFit) / 2;
    const toCx = x => pad + cx + (x - minX) * baseFit * state.previewScale + state.previewOffX;
    const toCy = y => h - pad - cy - (y - minY) * baseFit * state.previewScale + state.previewOffY;
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
    for (let gx = startX; gx <= maxX; gx += step) { const cx = toCx(gx); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); }
    for (let gy = startY; gy <= maxY; gy += step) { const cy = toCy(gy); ctx.moveTo(0, cy); ctx.lineTo(w, cy); }
    ctx.stroke();
    ctx.fillStyle = 'rgba(148,163,184,0.65)';
    ctx.font = `${Math.round(9 * dpr)}px monospace`;
    ctx.textAlign = 'center';
    for (let gx = startX; gx <= maxX; gx += step) ctx.fillText(String(Math.round(gx * 100) / 100), toCx(gx), h - 6);
    // Axis lines at origin
    const ox0 = toCx(0), oy0 = toCy(0);
    if (ox0 >= 0 && ox0 <= w && oy0 >= 0 && oy0 <= h) {
      ctx.lineWidth = Math.max(1.2, dpr);
      ctx.strokeStyle = '#dc2626'; ctx.beginPath(); ctx.moveTo(ox0, oy0); ctx.lineTo(toCx(Math.min(maxX, 20 * mmPerPx)), oy0); ctx.stroke();
      ctx.strokeStyle = '#16a34a'; ctx.beginPath(); ctx.moveTo(ox0, oy0); ctx.lineTo(ox0, toCy(Math.min(maxY, 20 * mmPerPx))); ctx.stroke();
      ctx.fillStyle = '#22c55e'; ctx.beginPath(); ctx.arc(ox0, oy0, 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    return { toCx, toCy };
  },

  // ---- Segment-based G-code preview (2D) --------------------------------------------------
  buildOriginal() {
    if (this._origSegments || !state.originalCmds || !state.originalCmds.length) return;
    // Skip compare mode for large files to save memory
    if (state.originalCmds.length > 50000) return;
    const cmds = state.originalCmds;
    this._buildSegmentsAsync(cmds, (result) => {
      this._origSegments = result.segments;
      this._origPoints = null; // not needed for compare overlay; saves RAM
      this._origBounds = result.bounds;
      this.draw(state.workingCmds);
    }, () => {});
  },

  _buildSegmentsAsync(commands, onDone, onProgress) {
    if (this._segBuilding) return;
    const total = commands.length;
    if (total === 0) { if (onDone) onDone({ points: [], segments: [], bounds: null, truncated: false }); return; }

    this._segBuilding = true;
    const myVersion = ++this._segVersion;

    // RAM optimization: only accumulate the full point array when needed for
    // hit-testing (point selection). Otherwise we keep only the bounds, which is
    // all the renderer needs — this avoids holding millions of {x,y,z} objects.
    const keepPoints = this._keepPoints;
    const allPoints = keepPoints ? [{ x: 0, y: 0, z: 0 }] : null;
    const allSegments = [];
    let truncated = false;
    let state2 = null; // resume state for segmentBuilder

    const CHUNK = CFG.SEGMENT_CHUNK || 5000;

    const finish = (result) => {
      this._segBuilding = false;
      const bounds = this._computeSegBoundsFromSegs(allSegments);
      this._segments = allSegments;
      this._points = keepPoints ? allPoints : null;
      this._segBounds = bounds;
      this._segTruncated = truncated;
      if (onDone) onDone(result);
    };

    const processChunk = () => {
      // Abort if a newer build was requested (e.g. new edit arrived)
      if (myVersion !== this._segVersion) return;
      const start = state2 ? state2.idx : 0;
      const end = Math.min(start + CHUNK, total);
      const res = segmentBuilder.build(commands, CFG.MAX_SEGMENTS, state2 ? {
        x: state2.x, y: state2.y, z: state2.z, isRel: state2.isRel,
        unitToMm: state2.unitToMm, planeMode: state2.planeMode, idx: start
      } : undefined);
      // Each chunk seeds its own starting point (== last point of previous chunk),
      // so skip index 0 to avoid duplicating it.
      if (keepPoints) for (let i = 1; i < res.points.length; i++) allPoints.push(res.points[i]);
      for (const s of res.segments) allSegments.push(s);
      if (res.truncated) truncated = true;
      state2 = res; // carries x,y,z,isRel,unitToMm,planeMode,idx
      if (onProgress) {
        const pct = Math.round(end / total * 100);
        onProgress(pct);
        const pb = document.getElementById('previewProgressBar');
        const pl = document.getElementById('previewProgressLabel');
        if (pb) pb.style.width = pct + '%';
        if (pl) pl.textContent = 'Building preview... ' + pct + '%';
      }
      // Progressive draw so the user sees the toolpath grow
      const now = performance.now();
      if (now - this._lastProgDraw > 120) {
        this._lastProgDraw = now;
        this._segments = allSegments;
        this._points = keepPoints ? allPoints : null;
        this._drawCore(commands, end);
      }
      if (end < total && !truncated) {
        requestAnimationFrame(processChunk);
      } else {
        finish({ points: keepPoints ? allPoints : null, segments: allSegments, bounds: this._segBounds, truncated, _lastPoint: res.points[res.points.length - 1] });
      }
    };

    if (onProgress) onProgress(0);
    requestAnimationFrame(processChunk);
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
  _computeSegBoundsFromSegs(segs) {
    if (!segs || segs.length < 1) return null;
    const s0 = segs[0];
    let minX = Math.min(s0.a.x, s0.b.x), maxX = Math.max(s0.a.x, s0.b.x);
    let minY = Math.min(s0.a.y, s0.b.y), maxY = Math.max(s0.a.y, s0.b.y);
    let minZ = Math.min(s0.a.z, s0.b.z), maxZ = Math.max(s0.a.z, s0.b.z);
    for (let i = 1; i < segs.length; i++) {
      const s = segs[i];
      if (s.a.x < minX) minX = s.a.x; if (s.a.x > maxX) maxX = s.a.x;
      if (s.b.x < minX) minX = s.b.x; if (s.b.x > maxX) maxX = s.b.x;
      if (s.a.y < minY) minY = s.a.y; if (s.a.y > maxY) maxY = s.a.y;
      if (s.b.y < minY) minY = s.b.y; if (s.b.y > maxY) maxY = s.b.y;
      if (s.a.z < minZ) minZ = s.a.z; if (s.a.z > maxZ) maxZ = s.a.z;
      if (s.b.z < minZ) minZ = s.b.z; if (s.b.z > maxZ) maxZ = s.b.z;
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
      if (originMarkMode) {

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
  // ---- Playback state ------------------------------------------------------------------------------------
  _pb: { rafId: null, idx: 0, paused: false, active: false },

  draw(commands) {
    this._stopPlayback();
    const cmds = commands;
    const n = cmds ? cmds.length : 0;
    if (state.mode === 'gcode' && n > 0 && cmds !== this._segCommands) {
      this._segments = null;
      this._points = null;
      this._segCommands = cmds;
      this._segBuilding = false; // abort any stale build
      this._segVersion++;
    }
    // Reset scrub bar to 100% (show all)
    const slider = document.getElementById('playProgress');
    if (slider) slider.value = 100;
    const info = document.getElementById('scrubInfo');
    if (info) info.textContent = `${n}/${n}`;
    if (state.mode === 'gcode' && !this._segments && !this._segBuilding && n > 0) {
      // Analyse bounds first so view is centered from the start
      const preBounds = this._getBounds(cmds);
      if (preBounds) {
        this._segBounds = preBounds;
        state.previewScale = 1;
        state.previewOffX = 0;
        state.previewOffY = 0;
      }
      // Debounce: coalesce rapid edits (e.g. typing) into a single rebuild
      if (this._rebuildTimer) clearTimeout(this._rebuildTimer);
      this._rebuildTimer = setTimeout(() => {
        this._rebuildTimer = null;
        ui.setProgress(0, 'Building preview…');
        this._showPreviewProgress(true);
        this._buildSegmentsAsync(cmds, (result) => {
          ui.setProgress(-1);
          this._showPreviewProgress(false);
          this.fitView();
          if (ui.updateResizePanel) ui.updateResizePanel();
          if (ui.updateFooterInfo) ui.updateFooterInfo();
          if (ui._pointsPanelOpen && ui._updatePointsPanel) ui._updatePointsPanel();
        }, (pct) => {
          ui.setProgress(pct, 'Building preview…');
        });
      }, 120);
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
      const sz = 28;
      ctx.save();
      ctx.beginPath();
      ctx.arc(mx, my, sz + 8, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,0,0,0.15)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,0,0,0.3)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.shadowColor = 'rgba(255,0,0,0.7)'; ctx.shadowBlur = 14;
      ctx.strokeStyle = '#ff2222'; ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(mx - sz, my - sz); ctx.lineTo(mx + sz, my + sz);
      ctx.moveTo(mx + sz, my - sz); ctx.lineTo(mx - sz, my + sz);
      ctx.stroke(); ctx.shadowBlur = 0;
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(mx - sz, my - sz); ctx.lineTo(mx + sz, my + sz);
      ctx.moveTo(mx + sz, my - sz); ctx.lineTo(mx - sz, my + sz);
      ctx.stroke();
      const dir = state.originMark.dir;
      ctx.fillStyle = '#ff2222'; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center';
      const arrowY = dir === 'left' ? -sz - 18 : sz + 10;
      ctx.fillText(dir === 'left' ? '◀' : '▶', mx, my + arrowY);
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
      this._pb.paused = false;
      this._pb.lastTick = performance.now();
      this._pb.accum = 0;
      this._tick();
      return;
    }
    this._pb.active = true;
    this._pb.paused = false;
    this._pb.idx = 0;
    this._pb.lastTick = performance.now();
    this._pb.accum = 0;
    this._tick();
  },

  pause() {
    if (!this._pb.active) return;
    this._pb.paused = true;
    if (this._pb.rafId) { cancelAnimationFrame(this._pb.rafId); this._pb.rafId = null; }
  },

  stop() {
    this._stopPlayback();
    document.getElementById('btnPlay').textContent = 'Play';
    this._drawCore(state.workingCmds, state.workingCmds ? state.workingCmds.length : 0);
  },

  _stopPlayback() {
    this._pb.active = false;
    this._pb.paused = false;
    this._pb.idx    = 0;
    if (this._pb.rafId) { cancelAnimationFrame(this._pb.rafId); this._pb.rafId = null; }
    document.getElementById('btnPlay').textContent = 'Play';
  },

  _updatePlayProgress() {
    const cmds = state.workingCmds;
    const total = cmds ? cmds.length : 0;
    const idx = this._pb.idx || 0;
    const pct = total > 0 ? Math.round(idx / total * 100) : 0;
    const slider = document.getElementById('playProgress');
    if (slider) slider.value = pct;
    const info = document.getElementById('scrubInfo');
    if (info) info.textContent = `${idx}/${total}`;
  },

  _tick() {
    const commands = state.workingCmds;
    if (!this._pb.active || this._pb.paused || !commands) return;
    const speed = parseInt(document.getElementById('playSpeed').value) || 1;
    const now = performance.now();
    if (!this._pb.lastTick) this._pb.lastTick = now;
    const dt = (now - this._pb.lastTick) / 1000;
    this._pb.lastTick = now;
    this._pb.accum = (this._pb.accum || 0) + speed * 20 * dt;
    const step = Math.floor(this._pb.accum);
    this._pb.accum -= step;
    if (step < 1) { this._pb.rafId = requestAnimationFrame(() => this._tick()); return; }
    this._pb.idx = Math.min(this._pb.idx + step, commands.length);
    this._drawCore(commands, this._pb.idx);
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

    // ---- SVG mode --------------------------------------------------------------------------------------------
    if (state.mode === 'svg' && state.svgText) {
      if (state.svgPreviewMode === 'raster' && state.svgImg) {
        // Raster image with fills/engraving
        try {
          const s = state.svgScale;
          const dim = state.svgDims || { width: 100, height: 100 };
          const imgW = dim.width * s;
          const imgH = dim.height * s;
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
            // Center the toolpath in the canvas (top-down view)
            const cx = (w - pad * 2 - rangeX * baseFit) / 2;
            const cy = (h - pad * 2 - rangeY * baseFit) / 2;
            const toCx = x => pad + cx + (x - minX) * baseFit * state.previewScale + state.previewOffX;
            const toCy = y => h - pad - cy - (y - minY) * baseFit * state.previewScale + state.previewOffY;
            // Grid + axes for spatial reference
            this._drawGridAxesSVG(ctx, w, h, { minX, maxX, minY, maxY, rangeX, rangeY }, baseFit);
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

    // ---- DXF mode --------------------------------------------------------------------------------------------
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
        // Center the toolpath in the canvas (top-down view)
        const cx = (w - pad * 2 - rangeX * baseFit) / 2;
        const cy = (h - pad * 2 - rangeY * baseFit) / 2;
        const toCx = x => pad + cx + (x - minX) * baseFit * state.previewScale + state.previewOffX;
        const toCy = y => h - pad - cy - (y - minY) * baseFit * state.previewScale + state.previewOffY;
        // Grid + axes for spatial reference
        this._drawGridAxesSVG(ctx, w, h, { minX, maxX, minY, maxY, rangeX, rangeY }, baseFit);
        if (state.svgPreviewMode === 'raster') {
          ctx.strokeStyle = '#333';
          ctx.lineWidth = 3;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
        } else {
          ctx.strokeStyle = '#2563eb';
          ctx.lineWidth = 1.5;
        }
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

    // ---- G-code mode --------------------------------------------------------------------------------------
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

    const b = this._segBounds || (this._points ? this._computeSegBounds(this._points) : null);
    if (!b) return;
    const { minX, maxX, minY, maxY, rangeX, rangeY } = b;
    const pad = 40;
    const baseFit = Math.min((w - pad * 2) / rangeX, (h - pad * 2) / rangeY);
    // Center the toolpath in the canvas (top-down view)
    const cx = (w - pad * 2 - rangeX * baseFit) / 2;
    const cy = (h - pad * 2 - rangeY * baseFit) / 2;
    const toCanvasX = x => pad + cx + (x - minX) * baseFit * state.previewScale + state.previewOffX;
    const toCanvasY = y => h - pad - cy - (y - minY) * baseFit * state.previewScale + state.previewOffY;

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

    // Work area background + border (like GRBL style)
    ctx.save();
    const waX = toCanvasX(minX), waY = toCanvasY(maxY);
    const waW = rangeX * baseFit * state.previewScale;
    const waH = rangeY * baseFit * state.previewScale;
    // Background fill
    ctx.fillStyle = 'rgba(15,23,42,0.35)';
    ctx.fillRect(waX, waY, waW, waH);
    // Border with glow
    ctx.shadowColor = 'rgba(59,130,246,0.2)';
    ctx.shadowBlur = 8 * dpr;
    ctx.strokeStyle = 'rgba(59,130,246,0.7)';
    ctx.lineWidth = Math.max(1.5, dpr);
    ctx.strokeRect(waX, waY, waW, waH);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    // Corner brackets
    const brk = Math.max(8, Math.min(waW * 0.06, waH * 0.06));
    if (brk > 4) {
      ctx.strokeStyle = 'rgba(59,130,246,0.35)';
      ctx.lineWidth = Math.max(1.2, dpr);
      ctx.beginPath();
      ctx.moveTo(waX + brk, waY); ctx.lineTo(waX, waY); ctx.lineTo(waX, waY + brk);
      ctx.moveTo(waX + waW - brk, waY + waH); ctx.lineTo(waX + waW, waY + waH); ctx.lineTo(waX + waW, waY + waH - brk);
      ctx.stroke();
    }
    ctx.restore();

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

    // Draw segments batched by color (contoured: outer glow + inner line)
    const isRaster = state.svgPreviewMode === 'raster';
    const segments = this._segments;
    const sMax = 1000;
    const feedMax = 8000;
    const segsToDraw = limit < commands.length ? Math.floor((limit / commands.length) * segments.length) : segments.length;
    // Progressive erase: during playback, dim past segments
    const pbActive = this._pb && this._pb.active;
    const pbCmdIdx = pbActive ? (this._pb.idx || 0) : -1;
    // Find the last cmdIdx drawn to highlight as "current"
    let lastCmdIdx = -1;
    // Collect coordinates per color for batch stroke
    const colorBatches = {};
    const rapidBatch = { ax: [], ay: [], bx: [], by: [] };
    for (let i = 0; i < segsToDraw; i++) {
      const s = segments[i];
      if (!state.showRapids && s.rapid) continue;
      const ax = toCanvasX(s.a.x), ay = toCanvasY(s.a.y);
      const bx = toCanvasX(s.b.x), by = toCanvasY(s.b.y);
      lastCmdIdx = s.cmdIdx;
      if (s.rapid) {
        if (isRaster) continue;
        rapidBatch.ax.push(ax); rapidBatch.ay.push(ay);
        rapidBatch.bx.push(bx); rapidBatch.by.push(by);
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
        const color = isRaster
          ? `rgb(${Math.round(20 + 100 * ratio)},${Math.round(20 + 100 * ratio)},${Math.round(20 + 100 * ratio)})`
          : `rgb(${Math.round(34 + 200 * ratio)},${Math.round(211 - 160 * ratio)},${Math.round(238 - 80 * ratio)})`;
        if (!colorBatches[color]) colorBatches[color] = { ax: [], ay: [], bx: [], by: [] };
        const b = colorBatches[color];
        b.ax.push(ax); b.ay.push(ay); b.bx.push(bx); b.by.push(by);
      }
    }
    // Draw all segments with progressive erase alpha
    const eraseAlpha = pbActive ? 0.35 : 1;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const glowWidth = isRaster ? 5 : 3.5;
    // Outer glow (always at full alpha for glow effect)
    for (const color in colorBatches) {
      const b = colorBatches[color];
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(8,30,60,0.85)';
      ctx.lineWidth = glowWidth;
      ctx.beginPath();
      for (let j = 0; j < b.ax.length; j++) { ctx.moveTo(b.ax[j], b.ay[j]); ctx.lineTo(b.bx[j], b.by[j]); }
      ctx.stroke();
    }
    // Inner colored pass with progressive erase alpha
    for (const color in colorBatches) {
      const b = colorBatches[color];
      ctx.globalAlpha = eraseAlpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = isRaster ? 3 : 1.5;
      ctx.beginPath();
      for (let j = 0; j < b.ax.length; j++) { ctx.moveTo(b.ax[j], b.ay[j]); ctx.lineTo(b.bx[j], b.by[j]); }
      ctx.stroke();
    }
    ctx.restore();
    // Highlight current playback segment
    if (pbActive && pbCmdIdx > 0 && lastCmdIdx >= 0) {
      ctx.save();
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 3;
      ctx.shadowColor = 'rgba(34,211,238,0.6)';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      for (let i = 0; i < segments.length; i++) {
        const s = segments[i];
        if (s.rapid) continue;
        if (s.cmdIdx === lastCmdIdx) {
          ctx.moveTo(toCanvasX(s.a.x), toCanvasY(s.a.y));
          ctx.lineTo(toCanvasX(s.b.x), toCanvasY(s.b.y));
        }
      }
      ctx.stroke();
      ctx.restore();
    }
    // Draw rapids with dashed lines
    if (rapidBatch.ax.length) {
      ctx.save();
      ctx.strokeStyle = 'rgba(170,170,170,0.65)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      for (let j = 0; j < rapidBatch.ax.length; j++) { ctx.moveTo(rapidBatch.ax[j], rapidBatch.ay[j]); ctx.lineTo(rapidBatch.bx[j], rapidBatch.by[j]); }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Auto-detect point-to-point vs continuous (dots only for point-to-point)
    const p2p = (() => {
      if (state.mode !== 'gcode') return false;
      // Heuristic 1: frequent laser on/off toggles (M5/M9) within the toolpath
      let m5Count = 0, moveCount = 0;
      for (let i = 0; i < commands.length; i++) {
        const c = commands[i];
        if (c.type === 'M5' || c.type === 'M9') m5Count++;
        if (c.params.X !== undefined || c.params.Y !== undefined) moveCount++;
      }
      if (m5Count > 2 && moveCount > 0 && (m5Count / moveCount) > 0.05) return true;
      // Heuristic 2: frequent S=0 between S>0
      let sOnCount = 0, sOffCount = 0;
      let lastMode = null, transitions = 0;
      for (let i = 0; i < commands.length; i++) {
        const s = commands[i].params.S;
        if (s === 0) { sOffCount++; if (lastMode !== 'off') { transitions++; lastMode = 'off'; } }
        else if (s > 0) { sOnCount++; if (lastMode !== 'on') { transitions++; lastMode = 'on'; } }
      }
      if (sOnCount > 0 && sOffCount > 0 && transitions > 2) return true;
      // Heuristic 3: mostly short segments (<1mm) = dense point grid
      let short = 0, total = 0;
      for (let i = 0; i < segments.length && i < 5000; i++) {
        const s = segments[i];
        if (s.rapid) continue;
        const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
        if (Math.hypot(dx, dy) < 1) short++;
        total++;
      }
      return total > 10 && (short / total) > 0.5;
    })();

    // Draw dots at each vertex (visible for point-to-point programs)
    if (p2p) {
      ctx.fillStyle = 'rgba(37,99,235,0.7)';
      const dotStep = Math.max(1, Math.floor(segsToDraw / 5000));
      for (let i = 0; i < segsToDraw; i += dotStep) {
        const s = segments[i];
        if (!state.showRapids && s.rapid) continue;
        const cx = toCanvasX(s.b.x), cy = toCanvasY(s.b.y);
        if (cx < 0 || cx > w || cy < 0 || cy > h) continue;
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Start marker (first cut point)
    if (state.mode === 'gcode') {
      let startSeg = null;
      for (let i = 0; i < segments.length; i++) {
        if (!segments[i].rapid) { startSeg = segments[i]; break; }
      }
      if (startSeg) {
        const sx = toCanvasX(startSeg.a.x), sy = toCanvasY(startSeg.a.y);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.beginPath();
        ctx.arc(0, 0, 8, 0, Math.PI * 2);
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#fbbf24';
        ctx.fill();
        ctx.font = 'bold 9px sans-serif';
        ctx.fillStyle = '#f59e0b';
        ctx.textAlign = 'center';
        ctx.fillText('START', 0, -14);
        ctx.restore();
      }
    }

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
      const sz = 28;
      ctx.save();
      // Background circle
      ctx.beginPath();
      ctx.arc(mx, my, sz + 8, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,0,0,0.15)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,0,0,0.3)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Cross glow
      ctx.shadowColor = 'rgba(255,0,0,0.7)'; ctx.shadowBlur = 14;
      ctx.strokeStyle = '#ff2222'; ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(mx - sz, my - sz); ctx.lineTo(mx + sz, my + sz);
      ctx.moveTo(mx + sz, my - sz); ctx.lineTo(mx - sz, my + sz);
      ctx.stroke(); ctx.shadowBlur = 0;
      // Inner cross (white)
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(mx - sz, my - sz); ctx.lineTo(mx + sz, my + sz);
      ctx.moveTo(mx + sz, my - sz); ctx.lineTo(mx - sz, my + sz);
      ctx.stroke();
      // Direction arrow
      ctx.fillStyle = '#ff2222'; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center';
      const arrowY = state.originMark.dir === 'left' ? -sz - 18 : sz + 10;
      ctx.fillText(state.originMark.dir === 'left' ? '◀' : '▶', mx, my + arrowY);
      ctx.restore();
    }

    this._drawMinimap(ctx, w, h, b, baseFit);
    this._setInfo(`W: ${rangeX.toFixed(2)} mm  H: ${rangeY.toFixed(2)} mm`);
  },
  // Click on canvas → set origin in world coordinates
  _setOriginFromClick(e, canvas) {
    if (!state.workingCmds.length) return;
    canvas = canvas || this.canvas;
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    const cx = (e.clientX - rect.left) * sx;
    const cy = (e.clientY - rect.top) * sy;
    const b = this._getBounds(state.workingCmds);
    if (!b) return;
    const { minX, minY, rangeX, rangeY } = b;
    const w = canvas.width, h = canvas.height;
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

  _setMarkFromClick(e, canvas) {
    // If mark already exists, remove it (toggle)
    if (state.originMark) {
      state.originMark = null;
      originMarkMode = null;
      this.draw(state.workingCmds);
      ui.setStatus('Mark removed.');
      return;
    }
    canvas = canvas || this.canvas;
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    const cx = (e.clientX - rect.left) * sx;
    const cy = (e.clientY - rect.top) * sy;
    const b = this._getBounds(state.workingCmds);
    if (!b) {
      state.originMark = { x: cx, y: cy, dir: originMarkMode };
      this.draw(state.workingCmds);
      ui.setStatus(`Mark placed at canvas (${cx.toFixed(0)}, ${cy.toFixed(0)}) direction: ${originMarkMode}`);
      return;
    }
    const { minX, minY, rangeX, rangeY } = b;
    const w = canvas.width, h = canvas.height;
    const pad = 40;
    const baseFit = Math.min((w - pad * 2) / rangeX, (h - pad * 2) / rangeY);
    let worldX = (cx - pad - state.previewOffX) / (baseFit * state.previewScale) + minX;
    let worldY = minY + rangeY - (cy - pad - state.previewOffY) / (baseFit * state.previewScale);
    const step = this._getGridStep();
    worldX = Math.round(worldX / step) * step;
    worldY = Math.round(worldY / step) * step;
    state.originMark = { x: parseFloat(worldX.toFixed(3)), y: parseFloat(worldY.toFixed(3)), dir: originMarkMode };
    this.draw(state.workingCmds);
    originMarkMode = null;
    ui.setStatus(`Mark at X=${state.originMark.x} Y=${state.originMark.y}`);
  },

  // Get absolute X,Y position at a given cmdIdx (handles G90/G91)
  _getPosAt(cmdIdx) {
    let x = 0, y = 0, isRel = false;
    const cmds = state.workingCmds;
    for (let i = 0; i <= cmdIdx && i < cmds.length; i++) {
      const c = cmds[i];
      if (c.type === 'G91') { isRel = true; continue; }
      if (c.type === 'G90') { isRel = false; continue; }
      if (c.params.X !== undefined) x = isRel ? x + c.params.X : c.params.X;
      if (c.params.Y !== undefined) y = isRel ? y + c.params.Y : c.params.Y;
    }
    return { x, y };
  },

  _updatePointsInfo() {
    const info = document.getElementById('pointsInfo');
    const dist = document.getElementById('pointsDistance');
    if (!state.selectedPoints.size) {
      info.textContent = 'Select points on preview';
      dist.style.display = 'none';
      if (window.ui && ui._updatePointsPanel) ui._updatePointsPanel();
      return;
    }
    const sorted = [...state.selectedPoints].sort((a, b) => a - b);
    if (sorted.length >= 2) {
      const p1 = this._getPosAt(sorted[0]);
      const p2 = this._getPosAt(sorted[1]);
      const dx = Math.abs(p2.x - p1.x);
      const dy = Math.abs(p2.y - p1.y);
      const d = Math.hypot(dx, dy);
      info.textContent = `${sorted.length} point(s) selected`;
      dist.style.display = 'block';
      dist.textContent = `ΔX=${dx.toFixed(3)} ΔY=${dy.toFixed(3)}  D=${d.toFixed(3)}`;
    } else {
      info.textContent = '1 point selected';
      dist.style.display = 'none';
    }
    if (window.ui && ui._updatePointsPanel) ui._updatePointsPanel();
  },

  // Click to select/deselect point
  _selectPointFromClick(e, canvas) {
    if (!state.workingCmds.length) return;
    canvas = canvas || this.canvas;
    const rect = canvas.getBoundingClientRect();
    // Scale click coords from CSS pixels to canvas physical pixels (HiDPI)
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    const cx = (e.clientX - rect.left) * sx;
    const cy = (e.clientY - rect.top) * sy;
    const b = this._getBounds(state.workingCmds);
    if (!b) return;
    const { minX, minY, rangeX, rangeY } = b;
    const w = canvas.width, h = canvas.height;
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
      // Fallback: iterate commands (no retained point array needed)
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
    // If we needed the full point array for hit-testing but it wasn't retained,
    // rebuild it lazily and drop it again afterwards to keep RAM low.
    if (!segs && !this._points && bestCmdIdx < 0) {
      this._keepPoints = true;
      this._buildSegmentsAsync(state.workingCmds, () => {
        this._keepPoints = false;
        this._points = null;
        this.draw(state.workingCmds);
      });
      return;
    }
    if (bestCmdIdx < 0 || bestDist > 15) return;
    state.selectedPoints.clear();
    state.selectedPoints.add(bestCmdIdx);
    this._updatePointsInfo();
    document.getElementById('pointsOffsetX').value = '0';
    document.getElementById('pointsOffsetY').value = '0';
    document.getElementById('pointsOffsetZ').value = '0';
    // Sync points panel focus
    if (window.ui && ui._pointsList) {
      const fpi = ui._pointsList.findIndex(p => p.idx === bestCmdIdx);
      if (fpi >= 0) ui._focusedPointPos = fpi;
    }
    if (window.ui && ui._updatePointsPanel) ui._updatePointsPanel();
    // Jump to line in working editor + backplot highlight
    const veWrap = document.getElementById('virtualEditorWrap');
    const isVirtual = veWrap && veWrap.style.display !== 'none' && window.ui && window.ui._ve;
    if (isVirtual) {
      window.ui._ve.scrollToLine(bestCmdIdx);
    } else {
      const ta = document.getElementById('editorWorking');
      const lines = ta.value.split('\n');
      let charPos = 0;
      for (let i = 0; i < bestCmdIdx && i < lines.length; i++) charPos += lines[i].length + 1;
      const lineH = parseFloat(getComputedStyle(ta).lineHeight) || 20;
      ta.scrollTop = bestCmdIdx * lineH - ta.clientHeight / 3;
      ta.setSelectionRange(charPos, charPos);
    }
    this.highlightLine(bestCmdIdx);
    // Reset Points widget offsets to zero (relative to selected point)
    document.getElementById('pointsOffsetX').value = '0';
    document.getElementById('pointsOffsetY').value = '0';
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

  _setInfo(text) {
    // Dimensions are shown in Scale widget only
  },

  _showPreviewProgress(show) {
    const el = document.getElementById('previewProgress');
    if (!el) return;
    if (show) {
      el.classList.remove('hidden');
      document.getElementById('previewProgressBar').style.width = '0%';
    } else {
      el.classList.add('hidden');
    }
  },
};

