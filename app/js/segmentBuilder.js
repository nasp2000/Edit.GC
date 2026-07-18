// ── Pure segment builder (no canvas dependency) ──────────────
const segmentBuilder = {
  build(commands, maxSegs, initialState) {
    maxSegs = maxSegs || CFG.MAX_SEGMENTS;
    const startIdx = initialState?.idx ?? 0;
    let x = initialState?.x ?? 0;
    let y = initialState?.y ?? 0;
    let z = initialState?.z ?? 0;
    let isRel = initialState?.isRel ?? false;
    let unitToMm = initialState?.unitToMm ?? 1;
    let planeMode = initialState?.planeMode ?? 17;
    let motionMode = 1;
    let toolOn = false;
    let feed = 0;
    const baseCmd = (s) => s.trim().toUpperCase().split(/\s+/)[0];
    const toolOnType  = (initialState?.toolOnType  || 'M3,M4').split(',').map(baseCmd);
    const toolOffType = (initialState?.toolOffType || 'M5').split(',').map(baseCmd);
    // Always seed the starting point. On resume this equals the last point of the
    // previous chunk, so the caller skips index 0 to avoid duplication.
    const points = [{ x, y, z }];
    const segments = [];
    let truncated = false;

    const pushPt = (prev, next, rapid, cmdIdx) => {
      if (points.length >= maxSegs) { truncated = true; return; }
      points.push(next);
      segments.push({ a: prev, b: next, rapid, arc: false, cmdIdx, toolOn, feed });
    };

    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    // Subdivide an arc — all params passed explicitly (no closure over c)
    const subdivideArc = (prev, next, cw, cx, cy, planeAx, planeAy, perpAz, cmdIdx) => {
      const p0a = prev[planeAx], p0b = prev[planeAy];
      const da0 = p0a - cx, db0 = p0b - cy;
      const r = Math.sqrt(da0 * da0 + db0 * db0);
      if (!isFinite(r) || r < 0.000001) { pushPt(prev, next, false, cmdIdx); return; }
      let a0 = Math.atan2(p0b - cy, p0a - cx);
      let a1 = Math.atan2(next[planeAy] - cy, next[planeAx] - cx);
      const isFullCircle = (Math.abs(next[planeAx] - prev[planeAx]) < 0.000001 && Math.abs(next[planeAy] - prev[planeAy]) < 0.000001);
      if (isFullCircle) a1 = a0;
      let delta = a1 - a0;
      if (cw) { if (delta >= 0) delta -= Math.PI * 2; }
      else { if (delta <= 0) delta += Math.PI * 2; }
      if (isFullCircle) delta = cw ? -Math.PI * 2 : Math.PI * 2;
      if (Math.abs(delta) < 0.0000001) { pushPt(prev, next, false, cmdIdx); return; }
      const arcLen = Math.abs(delta) * r;
      const n = clamp(Math.max(6, Math.ceil(Math.abs(delta) / CFG.ARC_MAX_THETA), Math.ceil(arcLen / CFG.ARC_STEP_MM)), 6, CFG.ARC_MAX_SEGS);
      let last = prev;
      for (let k = 1; k <= n; k++) {
        if (points.length >= maxSegs) { truncated = true; break; }
        const t = k / n;
        const a = a0 + delta * t;
        const np = { ...last };
        np[planeAx] = cx + Math.cos(a) * r;
        np[planeAy] = cy + Math.sin(a) * r;
        if (Math.abs(next[perpAz] - prev[perpAz]) > 0.000001) np[perpAz] = prev[perpAz] + (next[perpAz] - prev[perpAz]) * t;
        pushPt(last, np, false, cmdIdx);
        last = np;
      }
    };

    // Resolve arc centre from R value for any axis pair
    const centerFromR = (prev, next, ax, ay, rVal, clockwise) => {
      const da = next[ax] - prev[ax], db = next[ay] - prev[ay];
      const chord = Math.sqrt(da * da + db * db);
      if (!isFinite(chord) || chord < 0.000001) return null;
      let rabs = Math.abs(rVal);
      if (chord > 2 * rabs) rabs = chord * 0.5;
      const h2 = Math.max(0, rabs * rabs - (chord * chord) / 4);
      const h = Math.sqrt(h2);
      const ma = (prev[ax] + next[ax]) * 0.5, mb = (prev[ay] + next[ay]) * 0.5;
      const ua = -db / chord, ub = da / chord;
      const c1 = { ca: ma + ua * h, cb: mb + ub * h };
      const c2 = { ca: ma - ua * h, cb: mb - ub * h };
      const sweep = (c) => {
        let a0 = Math.atan2(prev[ay] - c.cb, prev[ax] - c.ca);
        let a1 = Math.atan2(next[ay] - c.cb, next[ax] - c.ca);
        let d = a1 - a0;
        if (clockwise) { if (d >= 0) d -= Math.PI * 2; }
        else { if (d <= 0) d += Math.PI * 2; }
        return d;
      };
      const d0 = sweep(c1), d1 = sweep(c2);
      return (rVal < 0 ? Math.abs(d0) >= Math.abs(d1) : Math.abs(d0) <= Math.abs(d1)) ? c1 : c2;
    };

    // Main loop — process every command once
    for (let i = startIdx; i < commands.length; i++) {
      const c = commands[i];
      const t = c.type;
      // Modal state changes
      if (t === 'G91') { isRel = true; continue; }
      if (t === 'G90') { isRel = false; continue; }
      if (t === 'G20') { unitToMm = 25.4; continue; }
      if (t === 'G21') { unitToMm = 1; continue; }
      if (t === 'G17') { planeMode = 17; continue; }
      if (t === 'G18') { planeMode = 18; continue; }
      if (t === 'G19') { planeMode = 19; continue; }
      if (t === 'G92') { continue; } // coordinate offset, not motion
      // Tool/laser state
      if (t) {
        const tUp = t.toUpperCase();
        if (toolOnType.includes(tUp))  toolOn = true;
        if (toolOffType.includes(tUp)) toolOn = false;
      }
      if (c.params.F !== undefined) feed = c.params.F;
      // Motion command
      if (t === 'G0' || t === 'G00') motionMode = 0;
      else if (t === 'G1' || t === 'G01') motionMode = 1;
      else if (t === 'G2' || t === 'G02') motionMode = 2;
      else if (t === 'G3' || t === 'G03') motionMode = 3;
      // Implicit motion — line with coordinates but no G command
        // Use current motionMode (defaults to G1)
        else if (c.params.X !== undefined || c.params.Y !== undefined || c.params.Z !== undefined) {
        }
      // Compute next position
      let nx = x, ny = y, nz = z;
      const getV = (a) => c.params[a] !== undefined ? c.params[a] * unitToMm : null;
      const vx = getV('X'); if (vx !== null) nx = isRel ? x + vx : vx;
      const vy = getV('Y'); if (vy !== null) ny = isRel ? y + vy : vy;
      const vz = getV('Z'); if (vz !== null) nz = isRel ? z + vz : vz;
      const next = { x: nx, y: ny, z: nz };
      const prev = { x, y, z };
      // Arc handling (plane-specific)
      if (motionMode === 2 || motionMode === 3) {
        const cw = motionMode === 2;
        // Determine if we have arc centre info for this plane
        let ax, ay, az, cx, cy, hasCenter;
        if (planeMode === 18) { // XZ
          ax = 'x'; ay = 'z'; az = 'y';
          if (c.params.R !== undefined) {
            const cc = centerFromR(prev, next, ax, ay, c.params.R * unitToMm, cw);
            if (cc) { cx = cc.ca; cy = cc.cb; hasCenter = true; }
            else { hasCenter = false; }
          } else {
            cx = prev.x + (c.params.I || 0) * unitToMm;
            cy = prev.z + (c.params.K || 0) * unitToMm;
            hasCenter = c.params.I !== undefined || c.params.K !== undefined;
          }
        } else if (planeMode === 19) { // YZ
          ax = 'y'; ay = 'z'; az = 'x';
          if (c.params.R !== undefined) {
            const cc = centerFromR(prev, next, ax, ay, c.params.R * unitToMm, cw);
            if (cc) { cx = cc.ca; cy = cc.cb; hasCenter = true; }
            else { hasCenter = false; }
          } else {
            cx = prev.y + (c.params.J || 0) * unitToMm;
            cy = prev.z + (c.params.K || 0) * unitToMm;
            hasCenter = c.params.J !== undefined || c.params.K !== undefined;
          }
        } else { // G17 XY (default)
          ax = 'x'; ay = 'y'; az = 'z';
          if (c.params.R !== undefined) {
            const cc = centerFromR(prev, next, ax, ay, c.params.R * unitToMm, cw);
            if (cc) { cx = cc.ca; cy = cc.cb; hasCenter = true; }
            else { hasCenter = false; }
          } else {
            cx = prev.x + (c.params.I || 0) * unitToMm;
            cy = prev.y + (c.params.J || 0) * unitToMm;
            hasCenter = c.params.I !== undefined || c.params.J !== undefined;
          }
        }
        if (hasCenter) {
          subdivideArc(prev, next, cw, cx, cy, ax, ay, az, i);
        } else {
          pushPt(prev, next, false, i);
        }
      } else {
        pushPt(prev, next, motionMode === 0, i);
      }
      x = nx; y = ny; z = nz;
    }
    return { points, segments, truncated, isRel, unitToMm, planeMode, toolOn, x, y, z, toolOnType: initialState?.toolOnType, toolOffType: initialState?.toolOffType, idx: commands.length };
  },

  computeBounds(points) {
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
};
