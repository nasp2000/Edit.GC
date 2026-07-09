// ── Pure segment builder (no canvas dependency) ──────────────
const segmentBuilder = {
  build(commands, maxSegs, initialState) {
    maxSegs = maxSegs || CFG.MAX_SEGMENTS;
    let x = initialState?.x ?? 0;
    let y = initialState?.y ?? 0;
    let z = initialState?.z ?? 0;
    let isRel = initialState?.isRel ?? false;
    let unitToMm = initialState?.unitToMm ?? 1;
    let planeMode = initialState?.planeMode ?? 17;
    let motionMode = 1;
    const points = [{ x, y, z }];
    const segments = [];
    let truncated = false;

    const pushPt = (prev, next, rapid, cmdIdx) => {
      if (points.length >= maxSegs) { truncated = true; return; }
      points.push(next);
      segments.push({ a: prev, b: next, rapid, arc: false, cmdIdx });
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

    // Resolve arc centre from R value
    const centerFromR = (prev, next, rVal, cw) => {
      const dx = next.x - prev.x, dy = next.y - prev.y;
      const chord = Math.sqrt(dx * dx + dy * dy);
      if (!isFinite(chord) || chord < 0.000001) return null;
      let rAbs = Math.abs(rVal);
      if (chord > 2 * rAbs) rAbs = chord * 0.5;
      const h2 = Math.max(0, rAbs * rAbs - (chord * chord) / 4);
      const h = Math.sqrt(h2);
      const mx = (prev.x + next.x) * 0.5, my = (prev.y + next.y) * 0.5;
      const ux = -dy / chord, uy = dx / chord;
      const cands = [{ cx: mx + ux * h, cy: my + uy * h }, { cx: mx - ux * h, cy: my - uy * h }];
      const sweep = (c) => {
        let a0 = Math.atan2(prev.y - c.cy, prev.x - c.cx);
        let a1 = Math.atan2(next.y - c.cy, next.x - c.cx);
        let d = a1 - a0;
        if (cw) { if (d >= 0) d -= Math.PI * 2; }
        else { if (d <= 0) d += Math.PI * 2; }
        return d;
      };
      const d0 = sweep(cands[0]), d1 = sweep(cands[1]);
      return (rVal < 0 ? Math.abs(d0) >= Math.abs(d1) : Math.abs(d0) <= Math.abs(d1)) ? cands[0] : cands[1];
    };

    // Main loop — process every command once
    for (let i = 0; i < commands.length; i++) {
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
      // Motion command
      if (t === 'G0' || t === 'G00') motionMode = 0;
      else if (t === 'G1' || t === 'G01') motionMode = 1;
      else if (t === 'G2' || t === 'G02') motionMode = 2;
      else if (t === 'G3' || t === 'G03') motionMode = 3;
      else continue; // non-motion, skip
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
          cx = prev.x + (c.params.I || 0) * unitToMm;
          cy = prev.z + (c.params.K || 0) * unitToMm;
          hasCenter = c.params.I !== undefined || c.params.K !== undefined;
        } else if (planeMode === 19) { // YZ
          ax = 'y'; ay = 'z'; az = 'x';
          cx = prev.y + (c.params.J || 0) * unitToMm;
          cy = prev.z + (c.params.K || 0) * unitToMm;
          hasCenter = c.params.J !== undefined || c.params.K !== undefined;
        } else { // G17 XY (default)
          ax = 'x'; ay = 'y'; az = 'z';
          if (c.params.R !== undefined) {
            const cc = centerFromR(prev, next, c.params.R * unitToMm, cw);
            if (cc) { cx = cc.cx; cy = cc.cy; hasCenter = true; }
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
    return { points, segments, truncated, isRel, unitToMm, planeMode };
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
