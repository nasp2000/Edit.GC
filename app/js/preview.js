const preview = {
  canvas: null,
  ctx: null,
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
    let hasRel = false;
    for (let i = 0; i < len; i++) {
      if (commands[i].type === 'G90' || commands[i].type === 'G91') { hasRel = true; break; }
    }
    const hash = len + '|' + (hasRel ? '1' : '0') + '|' +
      (commands[0]?.params?.X ?? '') + '|' + (commands[0]?.params?.Y ?? '') + '|' +
      (commands[mid]?.params?.X ?? '') + '|' + (commands[mid]?.params?.Y ?? '') + '|' +
      (commands[len-1]?.params?.X ?? '') + '|' + (commands[len-1]?.params?.Y ?? '');
    if (state._boundsCache && state._boundsCache._hash === hash) return state._boundsCache;
    const xs = [], ys = [];
    let isRel = false, curX = 0, curY = 0;
    commands.forEach(c => {
      if (c.type === 'G91') { isRel = true; return; }
      if (c.type === 'G90') { isRel = false; return; }
      if (c.type === 'G92') { return; } // coordinate offset, not motion
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

  // -- Shared grid + axes for SVG/DXF modes --------------------------
  _drawGridAxesSVG(ctx, w, h, b, baseFit, invertY) {
    const { minX, maxX, minY, maxY, rangeX, rangeY } = b;
    const dpr = window.devicePixelRatio || 1;
    const pad = 40;
    // Center the toolpath in the canvas (top-down view) ? must match the
    // segment transforms above so grid/axes align with the toolpath.
    const cx = (w - pad * 2 - rangeX * baseFit) / 2;
    const cy = (h - pad * 2 - rangeY * baseFit) / 2;
    const toCx = x => pad + cx + (x - minX) * baseFit * state.previewScale + state.previewOffX;
    const toCy = invertY
      ? y => h - pad - cy - (y - minY) * baseFit * state.previewScale + state.previewOffY
      : y => pad + cy + (y - minY) * baseFit * state.previewScale + state.previewOffY;
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
    // all the renderer needs ? this avoids holding millions of {x,y,z} objects.
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
      const tpl = templateManager.getActive();
      const tplData = tpl?.data || tpl;
      let tplToolOn  = tplData?.laserOnCmd  || 'M3,M4';
      let tplToolOff = tplData?.laserOffCmd || 'M5';
      // Auto-detect tool-on/off commands from G-code (SM300, M3/M4, etc.)
      if (!state2) {
        const knownOn  = ['M3','M4','SM3'];
        const knownOff = ['M5','RM3'];
        const detectedOn  = [];
        const detectedOff = [];
        for (let i = 0; i < Math.min(100, commands.length); i++) {
          const t = (commands[i].type || '').toUpperCase();
          if (knownOn.includes(t) && !detectedOn.includes(t)) detectedOn.push(t);
          if (knownOff.includes(t) && !detectedOff.includes(t)) detectedOff.push(t);
        }
        // Always include base M3/M4 (both standard laser-on commands)
        if (detectedOn.length) tplToolOn = [...new Set(['M3','M4',...detectedOn])].join(',');
        if (detectedOff.length) tplToolOff = [...new Set(['M5',...detectedOff])].join(',');
      }
      const res = segmentBuilder.build(commands, CFG.MAX_SEGMENTS, state2 ? {
        x: state2.x, y: state2.y, z: state2.z, isRel: state2.isRel,
        unitToMm: state2.unitToMm, planeMode: state2.planeMode,
        toolOnType: state2.toolOnType, toolOffType: state2.toolOffType, idx: start
      } : { toolOnType: tplToolOn, toolOffType: tplToolOff });
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
        this._segBounds = this._computeSegBoundsFromSegs(allSegments);
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

  _zoomToFit() {
    state.previewScale = 1;
    state.previewOffX  = 0;
    state.previewOffY  = 0;
  },

  fitView() {
    this._zoomToFit();
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

  // Bounds of the actual cut (tool ON, non-rapid). Used for Scale dimensions so
  // travel moves before the tool reaches the work don't inflate W/H.
  _getCutBounds() {
    const buildBounds = (segs, requireToolOn) => {
      let first = true, minX, maxX, minY, maxY;
      for (const s of segs) {
        if (s.rapid) continue;
        if (requireToolOn && !s.toolOn) continue;
        const xs = [s.a.x, s.b.x], ys = [s.a.y, s.b.y];
        for (const x of xs) {
          if (first || x < minX) minX = x;
          if (first || x > maxX) maxX = x;
        }
        for (const y of ys) {
          if (first || y < minY) minY = y;
          if (first || y > maxY) maxY = y;
        }
        first = false;
      }
      if (first) return null;
      const rangeX = maxX - minX || 1, rangeY = maxY - minY || 1;
      return { minX, maxX, minY, maxY, rangeX, rangeY };
    };

    const segs = this._segments;
    if (segs && segs.length) {
      const fileHasToolOn = segs.some(s => s.toolOn);
      let b = buildBounds(segs, true);
      // Fall back to all non-rapid segments only when the file has NO laser
      // toggles at all ? otherwise a footer travel move (e.g. SM300's
      // X0 Y0 Z-50, which is non-rapid + tool-off) would inflate the bounds.
      if (!b && !fileHasToolOn) b = buildBounds(segs, false);
      if (b) return b;
    }

    // Segments not built yet ? compute from commands.
    const cmds = state.workingCmds;
    if (!cmds || !cmds.length) return this._getBounds(cmds);
    const tpl = templateManager.getActive();
    const tplData = tpl?.data || tpl;
    const baseCmd = (s) => s.trim().toUpperCase().split(/\s+/)[0];
    const onTypes  = (tplData?.laserOnCmd  || 'M3,M4').split(',').map(baseCmd);
    const offTypes = (tplData?.laserOffCmd || 'M5').split(',').map(baseCmd);
    let first = true, minX, maxX, minY, maxY;
    let toolOn = false, anyOn = false, isRel = false, curX = 0, curY = 0;
    for (const c of cmds) {
      const t = (c.type || '').toUpperCase();
      if (t === 'G90') { isRel = false; continue; }
      if (t === 'G91') { isRel = true; continue; }
      if (onTypes.includes(t))  { toolOn = true; anyOn = true; continue; }
      if (offTypes.includes(t)) { toolOn = false; continue; }
      // If no ON command was ever seen, treat all non-rapid moves as cut.
      if (!anyOn ? false : !toolOn) continue;
      const isMotion = /^G0?([0-3])?$/.test(t) || (t === '' && (c.params.X !== undefined || c.params.Y !== undefined));
      if (!isMotion) continue;
      if (t === 'G0' || t === 'G00') continue;
      if (c.params.X !== undefined) {
        const x = isRel ? curX + c.params.X : c.params.X;
        curX = x;
        if (first || x < minX) minX = x;
        if (first || x > maxX) maxX = x;
      }
      if (c.params.Y !== undefined) {
        const y = isRel ? curY + c.params.Y : c.params.Y;
        curY = y;
        if (first || y < minY) minY = y;
        if (first || y > maxY) maxY = y;
      }
      first = false;
    }
    // If no laser-ON moves were found (e.g. file has no toggles), fall back
    // to every non-rapid coordinate (but only when the file has no laser ON/OFF
    // at all ? otherwise footer travel would inflate bounds).
    if (first && !anyOn) {
      first = true; curX = 0; curY = 0; isRel = false;
      for (const c of cmds) {
        const t = (c.type || '').toUpperCase();
        if (t === 'G90') { isRel = false; continue; }
        if (t === 'G91') { isRel = true; continue; }
        if (t === 'G92') { continue; }
        if (t === 'G0' || t === 'G00') continue;
        if (!/^G0?([0-3])?$/.test(t) && !(t === '' && (c.params.X !== undefined || c.params.Y !== undefined))) continue;
        if (c.params.X !== undefined) {
          const x = isRel ? curX + c.params.X : c.params.X;
          curX = x;
          if (first || x < minX) minX = x;
          if (first || x > maxX) maxX = x;
        }
        if (c.params.Y !== undefined) {
          const y = isRel ? curY + c.params.Y : c.params.Y;
          curY = y;
          if (first || y < minY) minY = y;
          if (first || y > maxY) maxY = y;
        }
        first = false;
      }
    }
    if (first) return this._getBounds(cmds);
    const rangeX = maxX - minX || 1, rangeY = maxY - minY || 1;
    return { minX, maxX, minY, maxY, rangeX, rangeY };
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

    // Zoom toward cursor position
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const zoom = e.deltaY < 0 ? 1.1 : 0.9;
      // Adjust offset so the point under cursor stays in place
      state.previewOffX = mx - zoom * (mx - state.previewOffX);
      state.previewOffY = my - zoom * (my - state.previewOffY);
      state.previewScale *= zoom;
      state.previewScale = Math.max(0.2, Math.min(20, state.previewScale));
      scheduleDraw();
    }, { passive: false });

    // Left button: drag to pan
    c.addEventListener('mousedown', e => {
      if (e.button === 0) {
        dragging = true; lastX = e.clientX; lastY = e.clientY;
      }
    });
    // Middle button: also drag to pan
    c.addEventListener('mousedown', e => {
      if (e.button === 1) { e.preventDefault(); dragging = true; lastX = e.clientX; lastY = e.clientY; }
    });
    window.addEventListener('mouseup', () => { dragging = false; });

    // Click: point select (only if no drag occurred)
    c.addEventListener('click', e => {
      if (e.button !== 0) return;
      if (Math.abs(e.clientX - lastX) > 3 || Math.abs(e.clientY - lastY) > 3) return;
      if (state.mode === 'gcode') {
        this._selectPointFromClick(e);
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
  _lastTransform: null,

  draw(commands) {
    const cmds = commands;
    const n = cmds ? cmds.length : 0;
    // Clear canvas immediately, no cache between draws
    const canvas = document.getElementById('previewCanvas');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    if (this._pb.active && !this._pb.paused) {
      this._drawCore(cmds, this._pb.idx || 0);
      this._drawHead(cmds, this._pb.idx || 0);
      return;
    }
    if (this._pb.active) this._stopPlayback();
    if (state.mode === 'gcode' && n > 0 && cmds !== this._segCommands) {
      this._segments = null;
      this._points = null;
      this._segBounds = null;
      state._boundsCache = null;
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
      }
      // Debounce: coalesce rapid edits (e.g. typing) into a single rebuild
      if (this._rebuildTimer) clearTimeout(this._rebuildTimer);
      this._rebuildTimer = setTimeout(() => {
        this._rebuildTimer = null;
        ui.setProgress(0, 'Building preview?');
        this._showPreviewProgress(true);
        this._buildSegmentsAsync(cmds, (result) => {
          ui.setProgress(-1);
          this._showPreviewProgress(false);
          // Do NOT reset previewScale / fitView here: rebuilding after an edit
          // must preserve the user's current zoom & pan (otherwise the view
          // "jumps" every time the G-code is recalculated).
          this.draw(state.workingCmds);
          if (ui.updateFooterInfo) ui.updateFooterInfo();
          if (ui._updatePointsPanel) ui._updatePointsPanel();
        }, (pct) => {
          ui.setProgress(pct, 'Building preview?');
        });
      }, 120);
      this._drawCore(cmds, n);
      return;
    }
    this._drawCore(cmds, n);
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
      ctx.beginPath(); ctx.arc(toCanvasX(px), toCanvasY(py), 7, 0, Math.PI * 2);
      ctx.strokeStyle = '#00ff88'; ctx.lineWidth = 3; ctx.stroke();
      ctx.beginPath(); ctx.arc(toCanvasX(px), toCanvasY(py), 5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,255,136,0.4)'; ctx.fill();
    });
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
    document.getElementById('btnPlay').textContent = 'Play';
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
    this._pb.accum = (this._pb.accum || 0) + speed * 3 * dt;
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
      document.getElementById('btnPlay').textContent = 'Play';
    }
  },

  _drawHead(commands, idx) {
    if (!idx || !commands[idx - 1]) return;
    const c = commands[idx - 1];
    if (c.params.X === undefined && c.params.Y === undefined) return;
    const t = this._lastTransform;
    if (!t) return;
    const { toCanvasX, toCanvasY } = t;
    let curX = 0, curY = 0, prevX = 0, prevY = 0, isRel = false;
    for (let i = 0; i < idx; i++) {
      const cmd = commands[i];
      if (cmd.type === 'G91') { isRel = true; continue; }
      if (cmd.type === 'G90') { isRel = false; continue; }
      if (cmd.type === 'G92') { continue; }
      prevX = curX; prevY = curY;
      if (cmd.params.X !== undefined) curX = isRel ? curX + cmd.params.X : cmd.params.X;
      if (cmd.params.Y !== undefined) curY = isRel ? curY + cmd.params.Y : cmd.params.Y;
    }
    const ctx = this.ctx;
    const cx = toCanvasX(curX), cy = toCanvasY(curY);
    const tpl = templateManager.getActive();
    const tplData = tpl?.data || tpl;
    const baseCmd = (s) => s.trim().toUpperCase().split(/\s+/)[0];
    const onTypes  = (tplData?.laserOnCmd  || 'M3,M4').split(',').map(baseCmd);
    const offTypes = (tplData?.laserOffCmd || 'M5').split(',').map(baseCmd);
    let toolOn = false;
    for (let i = 0; i < idx; i++) {
      const t = (commands[i].type || '').toUpperCase();
      if (onTypes.includes(t)) toolOn = true;
      if (offTypes.includes(t)) toolOn = false;
    }
    const isLaserOn = toolOn && ['G1','G01','G2','G02','G3','G03',''].includes((c.type || '').toUpperCase());
    const isRapid = c.type === 'G0' || c.type === 'G00';
    const dpr = window.devicePixelRatio || 1;
    const pcx = toCanvasX(prevX), pcy = toCanvasY(prevY);
    const dx = cx - pcx, dy = cy - pcy;
    const angle = (dx === 0 && dy === 0) ? (this._headAngle || -Math.PI / 2) : Math.atan2(dy, dx);
    const dirChanged = this._headAngle != null && Math.abs(angle - this._headAngle) > 0.15;
    this._headAngle = angle;
    const coneLen = 8 * dpr;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    const coneColor = isLaserOn ? '#ef4444' : isRapid ? '#94a3b8' : '#3b82f6';
    if (dirChanged) {
      ctx.shadowColor = coneColor;
      ctx.shadowBlur = 8 * dpr;
    }
    ctx.beginPath();
    ctx.moveTo(coneLen, 0);
    ctx.lineTo(-coneLen * 0.45, -coneLen * 0.4);
    ctx.lineTo(-coneLen * 0.45, coneLen * 0.4);
    ctx.closePath();
    ctx.fillStyle = coneColor;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1 * dpr;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 1.8 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.restore();
  },

  _drawCore(commands, limit) {
    if (!this.canvas) return;
    const { width: w, height: h } = this.canvas;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);

    // fundo do canvas
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);

    // grid (batched for performance)
    const gStep = Math.max(2, 10 * state.previewScale);
    const ox = (state.previewOffX % gStep + gStep) % gStep;
    const oy = (state.previewOffY % gStep + gStep) % gStep;
    ctx.strokeStyle = '#D0D8E0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = ox; x < w; x += gStep) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = oy; y < h; y += gStep) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
    // grid principal (cada 5 celulas)
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
        // Raster image ? rendered bitmap with checkerboard background so the
        // difference from Outlines mode is obvious.
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
          // Checkerboard background behind the image
          const cs = 12; // checker cell size
          ctx.save();
          ctx.beginPath(); ctx.rect(drawX, drawY, drawW, drawH); ctx.clip();
          for (let gy = drawY; gy < drawY + drawH; gy += cs) {
            for (let gx = drawX; gx < drawX + drawW; gx += cs) {
              const even = (Math.floor((gx - drawX) / cs) + Math.floor((gy - drawY) / cs)) % 2 === 0;
              ctx.fillStyle = even ? '#e8e8e8' : '#f5f5f5';
              ctx.fillRect(gx, gy, cs, cs);
            }
          }
          ctx.drawImage(state.svgImg, drawX, drawY, drawW, drawH);
          ctx.restore();
          // Subtle border
          ctx.strokeStyle = 'rgba(0,0,0,0.25)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 3]);
          ctx.strokeRect(drawX, drawY, drawW, drawH);
          ctx.setLineDash([]);
          // SVG dimensions (scaled)
          const parser = new DOMParser();
          const doc = parser.parseFromString(state.svgText, 'image/svg+xml');
          const svgEl = doc.querySelector('svg');
          if (svgEl) {
            const vb = svgConverter._getViewBox(svgEl);
            const sw = vb.width * s, sh = vb.height * s;
            this._setInfo(`W: ${sw.toFixed(2)} mm  H: ${sh.toFixed(2)} mm`);
            if (!state.originalW) { state.originalW = sw; state.originalH = sh; }
          }
        } catch (_) {}
      } else {
        // Contours (outline paths) or Points (vertices only) ? cached for performance
        try {
          const isPoints = state.svgPreviewMode === 'points';
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
            const cx = (w - pad * 2 - rangeX * baseFit) / 2;
            const cy = (h - pad * 2 - rangeY * baseFit) / 2;
            const toCx = x => pad + cx + (x - minX) * baseFit * state.previewScale + state.previewOffX;
            const toCy = y => pad + cy + (y - minY) * baseFit * state.previewScale + state.previewOffY;
            this._drawGridAxesSVG(ctx, w, h, { minX, maxX, minY, maxY, rangeX, rangeY }, baseFit, false);
            if (isPoints) {
              // Draw only vertex dots ? good for assessing point density
              const visited = new Set();
              for (const seg of segments) {
                for (const pt of seg) {
                  const k = `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
                  if (visited.has(k)) continue;
                  visited.add(k);
                  ctx.fillStyle = '#2563eb';
                  ctx.beginPath();
                  ctx.arc(toCx(pt.x * s), toCy(pt.y * s), 3.5, 0, Math.PI * 2);
                  ctx.fill();
                }
              }
            } else {
              ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 2.5;
              ctx.setLineDash([]);
              for (const seg of segments) {
                if (!seg || seg.length < 2) return;
                ctx.beginPath();
                ctx.moveTo(toCx(seg[0].x * s), toCy(seg[0].y * s));
                for (let i = 1; i < seg.length; i++) {
                  ctx.lineTo(toCx(seg[i].x * s), toCy(seg[i].y * s));
                }
                ctx.stroke();
              }
            }
            this._setInfo(`W: ${rangeX.toFixed(2)} mm  H: ${rangeY.toFixed(2)} mm`);
            if (!state.originalW) { state.originalW = rangeX; state.originalH = rangeY; }
          }
        } catch (_) {}
      }
      return;
    }

    // ---- DXF mode --------------------------------------------------------------------------------------------
    if (state.mode === 'dxf' && state.dxfSegments && state.dxfSegments.length) {
      try {
        const s = state.dxfScale || 1;
        const all = state.dxfSegments.flat();
        const xs = all.map(p => p.x * s);
        const ys = all.map(p => p.y * s);
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
        this._drawGridAxesSVG(ctx, w, h, { minX, maxX, minY, maxY, rangeX, rangeY }, baseFit, true);
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
          ctx.moveTo(toCx(seg[0].x * s), toCy(seg[0].y * s));
          for (let i = 1; i < seg.length; i++) {
            ctx.lineTo(toCx(seg[i].x * s), toCy(seg[i].y * s));
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
      ctx.fillText('Building preview?', w / 2, h / 2);
      return;
    }

    const b = this._getCutBounds() || this._segBounds || (this._points ? this._computeSegBounds(this._points) : null);
    if (!b) return;
    const { minX, maxX, minY, maxY, rangeX, rangeY } = b;
    const pad = 40;
    const baseFit = Math.min((w - pad * 2) / rangeX, (h - pad * 2) / rangeY);
    // Center the toolpath in the canvas (top-down view)
    const cx = (w - pad * 2 - rangeX * baseFit) / 2;
    const cy = (h - pad * 2 - rangeY * baseFit) / 2;
    const toCanvasX = x => pad + cx + (x - minX) * baseFit * state.previewScale + state.previewOffX;
    const toCanvasY = y => h - pad - cy - (y - minY) * baseFit * state.previewScale + state.previewOffY;
    this._lastTransform = { toCanvasX, toCanvasY, minX, minY, maxX, maxY, rangeX, rangeY };

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

    // X and Y axis lines at origin (0,0)
    ctx.save();
    const originX = toCanvasX(0);
    const originY = toCanvasY(0);
    const isOnScreen = originX > 0 && originX < w && originY > 0 && originY < h;
    if (isFinite(originX) && isFinite(originY) && isOnScreen) {
      ctx.strokeStyle = 'rgba(220,50,50,0.8)';
      ctx.lineWidth = 3;
      ctx.setLineDash([5, 4]);
      // X axis (horizontal through origin)
      ctx.beginPath();
      ctx.moveTo(10, originY);
      ctx.lineTo(w - 10, originY);
      ctx.stroke();
      // Y axis (vertical through origin)
      ctx.beginPath();
      ctx.moveTo(originX, 10);
      ctx.lineTo(originX, h - 10);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 3;
      // Arrow at positive X end
      const axEnd = w - 10;
      ctx.beginPath();
      ctx.moveTo(axEnd, originY);
      ctx.lineTo(axEnd - 8, originY - 5);
      ctx.moveTo(axEnd, originY);
      ctx.lineTo(axEnd - 8, originY + 5);
      ctx.stroke();
      // Arrow at positive Y end
      const ayEnd = 10;
      ctx.beginPath();
      ctx.moveTo(originX, ayEnd);
      ctx.lineTo(originX - 5, ayEnd + 8);
      ctx.moveTo(originX, ayEnd);
      ctx.lineTo(originX + 5, ayEnd + 8);
      ctx.stroke();
      // Labels
      ctx.fillStyle = 'rgba(220,50,50,0.7)';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('X', axEnd - 2, originY - 12);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('Y', originX, ayEnd + 2);
      // Origin circle
      ctx.fillStyle = 'rgba(220,50,50,0.4)';
      ctx.beginPath(); ctx.arc(originX, originY, 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // Work area background + border (like GRBL style) ? controlled by BBox checkbox
    if (previewOpts.showBounds) {
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

    // Draw segments batched by color (contoured: outer glow + inner line)
    const isRaster = state.svgPreviewMode === 'raster';
    const isPoints = state.svgPreviewMode === 'points';
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
    const toolOnBatch  = { ax: [], ay: [], bx: [], by: [] };
    const toolOffBatch = { ax: [], ay: [], bx: [], by: [] };
    const rapidBatch  = { ax: [], ay: [], bx: [], by: [] };
    const feedBatches = {};
    let hasToolOn = false, hasToolOff = false;
    const fileHasToolOn = segments.slice(0, segsToDraw).some(s => s.toolOn);
    // Pre-scan: find average cut feed for SM300-style travel detection
    let cutFeed = 0; let feedCount = 0;
    for (let i = 0; i < segsToDraw; i++) {
      const s = segments[i];
      if (!s.rapid && s.toolOn && s.feed > 0) { cutFeed += s.feed; feedCount++; }
    }
    if (feedCount > 0) cutFeed /= feedCount;
    const isTravel = (s) => s.rapid || (s.toolOn && s.feed > cutFeed * 3 && cutFeed > 0);

    for (let i = 0; i < segsToDraw; i++) {
      const s = segments[i];
      if (!state.showRapids && (s.rapid || (!s.toolOn && fileHasToolOn))) continue;
      const ax = toCanvasX(s.a.x), ay = toCanvasY(s.a.y);
      const bx = toCanvasX(s.b.x), by = toCanvasY(s.b.y);
      lastCmdIdx = s.cmdIdx;
      if (isTravel(s)) {
        if (isRaster) continue;
        rapidBatch.ax.push(ax); rapidBatch.ay.push(ay);
        rapidBatch.bx.push(bx); rapidBatch.by.push(by);
      } else if (previewOpts.colorByFeed) {
        const f = s.feed || 500;
        const bucket = f <= 200 ? 'slow' : f <= 800 ? 'med' : 'fast';
        if (!feedBatches[bucket]) feedBatches[bucket] = { ax: [], ay: [], bx: [], by: [] };
        feedBatches[bucket].ax.push(ax); feedBatches[bucket].ay.push(ay);
        feedBatches[bucket].bx.push(bx); feedBatches[bucket].by.push(by);
        hasToolOn = true;
      } else if (s.toolOn) {
        hasToolOn = true;
        toolOnBatch.ax.push(ax); toolOnBatch.ay.push(ay);
        toolOnBatch.bx.push(bx); toolOnBatch.by.push(by);
      } else {
        hasToolOff = true;
        toolOffBatch.ax.push(ax); toolOffBatch.ay.push(ay);
        toolOffBatch.bx.push(bx); toolOffBatch.by.push(by);
      }
    }
    // Draw all segments with progressive erase alpha
    const eraseAlpha = pbActive ? 0.35 : 1;
    if (!isPoints) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const glowWidth = isRaster ? 5 : 3.5;
    // Feed rate coloring (tool-on segments)
    if (previewOpts.colorByFeed && Object.keys(feedBatches).length) {
      const feedColors = { slow: '#3B82F6', med: '#F59E0B', fast: '#EF4444' };
      const feedLabels = { slow: 'Slow', med: 'Medium', fast: 'Fast' };
      for (const [bucket, batch] of Object.entries(feedBatches)) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = feedColors[bucket] + '99';
        ctx.lineWidth = glowWidth;
        ctx.beginPath();
        for (let j = 0; j < batch.ax.length; j++) { ctx.moveTo(batch.ax[j], batch.ay[j]); ctx.lineTo(batch.bx[j], batch.by[j]); }
        ctx.stroke();
        ctx.globalAlpha = eraseAlpha;
        ctx.strokeStyle = feedColors[bucket];
        ctx.lineWidth = isRaster ? 3 : 1.8;
        ctx.beginPath();
        for (let j = 0; j < batch.ax.length; j++) { ctx.moveTo(batch.ax[j], batch.ay[j]); ctx.lineTo(batch.bx[j], batch.by[j]); }
        ctx.stroke();
      }
    }
    // Tool ON (when not using feed coloring) ? purple
    if (!previewOpts.colorByFeed && toolOnBatch.ax.length) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(120,30,120,0.85)';
        ctx.lineWidth = glowWidth;
        ctx.beginPath();
        for (let j = 0; j < toolOnBatch.ax.length; j++) { ctx.moveTo(toolOnBatch.ax[j], toolOnBatch.ay[j]); ctx.lineTo(toolOnBatch.bx[j], toolOnBatch.by[j]); }
        ctx.stroke();
        ctx.globalAlpha = eraseAlpha;
        ctx.strokeStyle = isRaster ? '#7e22ce' : '#a855f7';
        ctx.lineWidth = isRaster ? 3 : 1.8;
        ctx.beginPath();
        for (let j = 0; j < toolOnBatch.ax.length; j++) { ctx.moveTo(toolOnBatch.ax[j], toolOnBatch.ay[j]); ctx.lineTo(toolOnBatch.bx[j], toolOnBatch.by[j]); }
        ctx.stroke();
      }
      // Tool OFF (non-rapid travel) ? red glow + line
      if (toolOffBatch.ax.length) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(180,30,30,0.85)';
        ctx.lineWidth = glowWidth;
        ctx.beginPath();
        for (let j = 0; j < toolOffBatch.ax.length; j++) { ctx.moveTo(toolOffBatch.ax[j], toolOffBatch.ay[j]); ctx.lineTo(toolOffBatch.bx[j], toolOffBatch.by[j]); }
        ctx.stroke();
        ctx.globalAlpha = eraseAlpha;
        ctx.strokeStyle = isRaster ? '#991b1b' : '#ef4444';
        ctx.lineWidth = isRaster ? 3 : 1.2;
        ctx.beginPath();
        for (let j = 0; j < toolOffBatch.ax.length; j++) { ctx.moveTo(toolOffBatch.ax[j], toolOffBatch.ay[j]); ctx.lineTo(toolOffBatch.bx[j], toolOffBatch.by[j]); }
        ctx.stroke();
      }
    ctx.restore();
    } // end if (!isPoints) ? skip line batches in points mode
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

    // Draw dots at each vertex (every G-code coordinate)
    // In Points mode show ALL vertices large ? in Outlines show smaller sampled dots.
    if (!isRaster) {
      const dotDotStep = isPoints ? 1 : Math.max(1, Math.floor(segsToDraw / 5000));
      const dotRadius = isPoints ? 4 : 2.5;
      ctx.fillStyle = isPoints ? 'rgba(37,99,235,0.95)' : 'rgba(37,99,235,0.7)';
      for (let i = 0; i < segsToDraw; i += dotDotStep) {
        const s = segments[i];
        if (!state.showRapids && (s.rapid || (!s.toolOn && fileHasToolOn))) continue;
        const cx = toCanvasX(s.b.x), cy = toCanvasY(s.b.y);
        if (cx < 0 || cx > w || cy < 0 || cy > h) continue;
        ctx.beginPath();
        ctx.arc(cx, cy, dotRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Start/End markers
    if (state.mode === 'gcode') {
      // Pre-scan: find typical cut feed (skip outlier high feeds like SM300 travel F5000 vs cut F400)
      let cutFeed = 0;
      let feedCount = 0;
      for (const s of segments) {
        if (!s.rapid && s.toolOn && s.feed > 0) { cutFeed += s.feed; feedCount++; }
      }
      if (feedCount > 0) cutFeed /= feedCount; // average feed for tool-on non-rapid segments
      const isTravel = (s) => s.rapid || (s.toolOn && s.feed > cutFeed * 3 && cutFeed > 0);

      let startSeg = null;
      for (let i = 0; i < segments.length; i++) {
        const s = segments[i];
        if (fileHasToolOn ? s.toolOn : !s.rapid) {
          if (isTravel(s)) continue;
          startSeg = s; break;
        }
      }
      // Fallback: if no non-rapid tool-on found, use first segment
      if (!startSeg) { startSeg = segments[0] || null; }
      let endSeg = null;
      for (let i = segments.length - 1; i >= 0; i--) {
        const s = segments[i];
        if (fileHasToolOn ? s.toolOn : !s.rapid) {
          if (isTravel(s)) continue;
          endSeg = s; break;
        }
      }
      if (!endSeg) { endSeg = segments[segments.length - 1] || null; }
      if (startSeg || endSeg) {
        const sx = startSeg ? toCanvasX(startSeg.a.x) : 0, sy = startSeg ? toCanvasY(startSeg.a.y) : 0;
        const ex = endSeg ? toCanvasX(endSeg.b.x) : 0, ey = endSeg ? toCanvasY(endSeg.b.y) : 0;
        const samePoint = startSeg && endSeg && Math.abs(sx - ex) < 2 && Math.abs(sy - ey) < 2;
        const offX = samePoint ? 22 : 0;
        if (startSeg) {
          ctx.save(); ctx.translate(sx, sy);
          ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2);
          ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2; ctx.stroke();
          ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2);
          ctx.fillStyle = '#fbbf24'; ctx.fill();
          ctx.font = 'bold 9px sans-serif'; ctx.fillStyle = '#f59e0b';
          ctx.textAlign = 'center';
          ctx.fillText('START', samePoint ? -offX : 0, -14);
          ctx.restore();
        }
        if (endSeg) {
          ctx.save(); ctx.translate(ex, ey);
          ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2);
          ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 2; ctx.stroke();
          ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2);
          ctx.fillStyle = '#4ade80'; ctx.fill();
          ctx.font = 'bold 9px sans-serif'; ctx.fillStyle = '#22c55e';
          ctx.textAlign = 'center';
          ctx.fillText('END', samePoint ? offX : 0, -14);
          ctx.restore();
        }
      }
      // Mark Start ? draw a directional arrow on the mark point showing the cut direction
      if (typeof ui !== 'undefined' && ui._markStartIdx != null && ui._markStartIdx >= 0 && ui._pointsList && ui._pointsList.length) {
        const mp = ui._pointsList.find(p => p.idx === ui._markStartIdx);
        if (mp) {
          const mx = toCanvasX(mp.x), my = toCanvasY(mp.y);
          // Determine arrow direction from the actual segment direction at mark point
          // Segments already reflect the current (possibly reversed) path order
          let segAngle = 0;
          if (segments && segments.length) {
            const markSegIdx = segments.findIndex(s => s.cmdIdx === ui._markStartIdx);
            if (markSegIdx >= 0) {
              const s = segments[markSegIdx];
              const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
              if (Math.abs(dx) > 0.0001 || Math.abs(dy) > 0.0001) {
                segAngle = Math.atan2(dy, dx);
              }
            }
          }
          const dpr = window.devicePixelRatio || 1;
          ctx.save();
          ctx.translate(mx, my);
          ctx.rotate(segAngle);
          const arrLen = 18 * dpr;
          ctx.beginPath();
          ctx.moveTo(arrLen, 0);
          ctx.lineTo(-arrLen * 0.4, -arrLen * 0.5);
          ctx.lineTo(-arrLen * 0.4, arrLen * 0.5);
          ctx.closePath();
          ctx.fillStyle = '#ef4444';
          ctx.shadowColor = 'rgba(239,68,68,0.5)';
          ctx.shadowBlur = 6 * dpr;
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1.2 * dpr;
          ctx.stroke();
          ctx.restore();
          ctx.save(); ctx.translate(mx, my);
          ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2);
          ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2.5; ctx.stroke();
          ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2);
          ctx.fillStyle = '#ef4444'; ctx.fill();
          ctx.font = 'bold 10px sans-serif'; ctx.fillStyle = '#ef4444';
          ctx.textAlign = 'center';
          ctx.fillText('MARK', 0, -16);
          ctx.restore();
        }
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

    // Selected points and origin mark
    state.selectedPoints.forEach(idx => {
      const c = commands[idx];
      if (!c) return;
      const px = c.params.X ?? 0, py = c.params.Y ?? 0;
      ctx.beginPath(); ctx.arc(toCanvasX(px), toCanvasY(py), 7, 0, Math.PI * 2);
      ctx.strokeStyle = '#00ff88'; ctx.lineWidth = 3; ctx.stroke();
      ctx.beginPath(); ctx.arc(toCanvasX(px), toCanvasY(py), 5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,255,136,0.4)'; ctx.fill();
    });

    this._drawMinimap(ctx, w, h, b, baseFit);

    // Legend (right side) ? dark panel with color key
    if (segments.length && segsToDraw > 0) {
      const dpr2 = window.devicePixelRatio || 1;
      const cssW = w / dpr2, cssH = h / dpr2;
      const fs = Math.round(10 * dpr2);
      const padX = 8 * dpr2, padY = 6 * dpr2;
      const items = previewOpts.colorByFeed
        ? [
            { color: '#3B82F6', label: 'Slow feed',  active: true },
            { color: '#F59E0B', label: 'Med feed',   active: true },
            { color: '#EF4444', label: 'Fast feed',  active: true },
            { color: '#aaaaaa', label: 'Rapid (G0)', active: rapidBatch.ax.length > 0 },
            { color: '#2563eb', label: 'Vertices',   active: segsToDraw > 0 },
          ].filter(it => it.active)
        : [
            { color: '#f59e0b', label: 'Start',      active: true },
            { color: '#22c55e', label: 'End',         active: true },
            { color: '#a855f7', label: 'Tool ON',   active: hasToolOn },
            { color: '#ef4444', label: 'Tool OFF',  active: hasToolOff },
            { color: '#aaaaaa', label: 'Rapid (G0)', active: rapidBatch.ax.length > 0 },
            { color: '#2563eb', label: 'Vertices',   active: segsToDraw > 0 },
          ].filter(it => it.active);
      ctx.font = `bold ${fs}px sans-serif`;
      let maxLabelW = 0;
      for (const it of items) { const m = ctx.measureText(it.label).width; if (m > maxLabelW) maxLabelW = m; }
      const boxW = padX * 2 + fs * 1.2 + fs * 1.5 + maxLabelW + 4 * dpr2;
      const lineH = fs * 1.5;
      const boxH = items.length * lineH + padY * 2;
      const bx = cssW - boxW - 6 * dpr2;
      const by = 6 * dpr2; // top-right corner
      ctx.save();
      // Dark background
      ctx.fillStyle = 'rgba(15,23,42,0.82)';
      ctx.beginPath();
      const r = 4 * dpr2;
      ctx.moveTo(bx + r, by);
      ctx.lineTo(bx + boxW - r, by); ctx.quadraticCurveTo(bx + boxW, by, bx + boxW, by + r);
      ctx.lineTo(bx + boxW, by + boxH - r); ctx.quadraticCurveTo(bx + boxW, by + boxH, bx + boxW - r, by + boxH);
      ctx.lineTo(bx + r, by + boxH); ctx.quadraticCurveTo(bx, by + boxH, bx, by + boxH - r);
      ctx.lineTo(bx, by + r); ctx.quadraticCurveTo(bx, by, bx + r, by);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // Items
      ctx.font = `bold ${fs}px sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      let iy = by + padY + lineH * 0.5;
      for (const it of items) {
        // Color swatch
        ctx.fillStyle = it.color;
        ctx.fillRect(bx + padX, iy - fs * 0.35, fs * 1.2, fs * 0.7);
        // Label
        ctx.fillStyle = '#e2e8f0';
        ctx.fillText(it.label, bx + padX + fs * 1.5, iy);
        iy += lineH;
      }
      ctx.restore();
    }

    // Direction arrow below work area ? shows program flow direction
    if (segments.length && segsToDraw > 0) {
      const dpr3 = window.devicePixelRatio || 1;
      const waX = toCanvasX(minX), waY = toCanvasY(maxY);
      const waW = rangeX * baseFit * state.previewScale;
      const waH = rangeY * baseFit * state.previewScale;
      // Compute net direction from non-rapid segments
      let dx = 0, dy = 0;
      for (let i = 0; i < segsToDraw && i < segments.length; i++) {
        const s = segments[i];
        if (s.rapid) continue;
        dx += s.b.x - s.a.x;
        dy += s.b.y - s.a.y;
      }
      const absDx = Math.abs(dx), absDy = Math.abs(dy);
      if (absDx > 0.001 || absDy > 0.001) {
        ctx.save();
        const arrowCY = waY + waH + 18 * dpr3;
        const arrowCX = waX + waW / 2;
        const arrowLen = Math.min(waW * 0.6, 120 * dpr3);
        const arrowHalf = arrowLen / 2;
        ctx.strokeStyle = 'rgba(226,232,240,0.5)';
        ctx.fillStyle = 'rgba(226,232,240,0.5)';
        ctx.lineWidth = Math.max(1.5, dpr3);
        ctx.lineCap = 'round';
        // Determine dominant direction
        if (absDx >= absDy) {
          const dir = dx > 0 ? 1 : -1;
          const x1 = arrowCX - arrowHalf * dir;
          const x2 = arrowCX + arrowHalf * dir;
          ctx.beginPath(); ctx.moveTo(x1, arrowCY); ctx.lineTo(x2, arrowCY); ctx.stroke();
          // Arrowhead
          const hs = 6 * dpr3 * dir;
          ctx.beginPath();
          ctx.moveTo(x2, arrowCY);
          ctx.lineTo(x2 - hs, arrowCY - hs * 0.6);
          ctx.lineTo(x2 - hs, arrowCY + hs * 0.6);
          ctx.closePath(); ctx.fill();
        } else {
          const dir = dy > 0 ? -1 : 1;
          const y1 = arrowCY - arrowHalf * dir;
          const y2 = arrowCY + arrowHalf * dir;
          ctx.beginPath(); ctx.moveTo(arrowCX, y1); ctx.lineTo(arrowCX, y2); ctx.stroke();
          // Arrowhead
          const hs = 6 * dpr3 * dir;
          ctx.beginPath();
          ctx.moveTo(arrowCX, y2);
          ctx.lineTo(arrowCX - hs * 0.6, y2 - hs);
          ctx.lineTo(arrowCX + hs * 0.6, y2 - hs);
          ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      }
    }

    this._setInfo(`W: ${rangeX.toFixed(2)} mm  H: ${rangeY.toFixed(2)} mm`);
  },

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

  // Get absolute X,Y position at a given cmdIdx (handles G90/G91)
  _getPosAt(cmdIdx) {
    let x = 0, y = 0, isRel = false;
    const cmds = state.workingCmds;
    for (let i = 0; i <= cmdIdx && i < cmds.length; i++) {
      const c = cmds[i];
      if (c.type === 'G91') { isRel = true; continue; }
      if (c.type === 'G90') { isRel = false; continue; }
      if (c.type === 'G92') { continue; }
      if (c.params.X !== undefined) x = isRel ? x + c.params.X : c.params.X;
      if (c.params.Y !== undefined) y = isRel ? y + c.params.Y : c.params.Y;
    }
    return { x, y };
  },

  _updatePointsInfo() {
    const info = document.getElementById('pointsInfo');
    const dist = document.getElementById('pointsDistance');
    if (!info || !dist) return;
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
      dist.textContent = `?X=${dx.toFixed(3)} ?Y=${dy.toFixed(3)}  D=${d.toFixed(3)}`;
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
    if (bestCmdIdx < 0 || bestDist > 25) return;
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
    const dpr = window.devicePixelRatio || 1;
    const cssW = w / dpr, cssH = h / dpr;
    const mmSize = 120;
    const mmX = cssW - mmSize - 10;
    const mmY = cssH - mmSize - 10;
    if (!previewOpts.showMinimap || !this._segments || !this._segments.length) return;
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
    // Origin crosshair on minimap
    const mmOx0 = mmOx(0);
    const mmOy0 = mmOy(0);
    if (isFinite(mmOx0) && isFinite(mmOy0) && mmOx0 >= mmX && mmOx0 <= mmX + mmSize && mmOy0 >= mmY && mmOy0 <= mmY + mmSize) {
      ctx.strokeStyle = 'rgba(220,50,50,0.6)';
      ctx.lineWidth = 0.5;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(mmX + pad, mmOy0); ctx.lineTo(mmX + mmSize - pad, mmOy0);
      ctx.moveTo(mmOx0, mmY + pad); ctx.lineTo(mmOx0, mmY + mmSize - pad);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(220,50,50,0.6)';
      ctx.beginPath(); ctx.arc(mmOx0, mmOy0, 1.5, 0, Math.PI * 2); ctx.fill();
    }
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

