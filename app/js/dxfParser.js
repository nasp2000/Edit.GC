const dxfParser = {
  // Parse DXF text â†’ array of segments (each segment = array of {x,y,cut})
  parse(text, scaleFactor) {
    const scale = scaleFactor || 1;
    const lines = text.split(/\r?\n/).map(l => l.trim());
    const segments = [];
    let i = 0;
    const nextPair = () => {
      if (i + 1 >= lines.length) return null;
      const code = parseInt(lines[i]);
      const val = lines[i + 1];
      i += 2;
      return { code, val };
    };
    // Read till ENTITIES section
    while (i < lines.length - 1) {
      const p = nextPair();
      if (!p) break;
      if (p.code === 0 && p.val === 'ENTITIES') break;
      if (p.code === 0 && p.val === 'SECTION') {
        const p2 = nextPair();
        if (p2 && p2.code === 2 && p2.val === 'ENTITIES') break;
      }
    }
    // Parse entities
    while (i < lines.length - 1) {
      // Save current position and peek next group code 0
      const saved = i;
      // Read until next 0 or end
      const pairs = [];
      while (i < lines.length - 1) {
        const code = parseInt(lines[i]);
        if (code === 0 && pairs.length > 0) break;
        const val = lines[i + 1];
        pairs.push({ code, val });
        i += 2;
      }
      if (pairs.length < 1) break;
      const entity = pairs[0]?.val || '';
      if (entity === 'ENDSEC') break;
      const seg = this._parseEntity(entity, pairs, scale);
      if (seg && seg.length > 1) segments.push(seg);
    }
    return segments;
  },

  _parseEntity(type, pairs, scale) {
    const g = code => { const p = pairs.find(x => x.code === code); return p ? parseFloat(p.val) : undefined; };
    const gs = code => { const p = pairs.find(x => x.code === code); return p ? p.val : ''; };
    const layer = gs(8);
    switch (type) {
      case 'LINE': {
        const x1 = g(10), y1 = g(20), x2 = g(11), y2 = g(21);
        if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return null;
        return [
          { x: x1 * scale, y: y1 * scale, cut: false, layer },
          { x: x2 * scale, y: y2 * scale, cut: true, layer },
        ];
      }
      case 'CIRCLE': {
        const cx = g(10), cy = g(20), r = g(40);
        if (cx === undefined || cy === undefined || r === undefined || r === 0) return null;
        const steps = Math.max(32, Math.ceil(2 * Math.PI * r * scale * 2));
        const pts = [];
        for (let i = 0; i <= steps; i++) {
          const a = (i / steps) * 2 * Math.PI;
          pts.push({ x: (cx + r * Math.cos(a)) * scale, y: (cy + r * Math.sin(a)) * scale, cut: i > 0, layer });
        }
        return pts;
      }
      case 'ARC': {
        const cx = g(10), cy = g(20), r = g(40);
        const startAng = g(50), endAng = g(51);
        if (cx === undefined || cy === undefined || r === undefined || r === 0 || startAng === undefined || endAng === undefined) return null;
        const sa = startAng * Math.PI / 180, ea = endAng * Math.PI / 180;
        const dAng = ((ea - sa) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        if (dAng < 0.001) return null;
        const steps = Math.max(16, Math.ceil(dAng * r * scale * 2));
        const pts = [];
        for (let i = 0; i <= steps; i++) {
          const a = sa + dAng * i / steps;
          pts.push({ x: (cx + r * Math.cos(a)) * scale, y: (cy + r * Math.sin(a)) * scale, cut: i > 0, layer });
        }
        return pts;
      }
      case 'LWPOLYLINE': {
        const closed = g(70) === 1;
        const count = g(90);
        if (!count || count < 2) return null;
        // Sequential scan for vertices and bulges
        const rawVerts = []; // { x, y, bulge }
        let vCount = 0;
        let curX = 0, curY = 0, curBulge = 0;
        for (let j = 0; j < pairs.length && vCount < count; j++) {
          const code = pairs[j].code;
          if (code === 10) { curX = parseFloat(pairs[j].val); }
          else if (code === 20) { curY = parseFloat(pairs[j].val); }
          else if (code === 42) { curBulge = parseFloat(pairs[j].val); }
          // When we hit the next 10 or end, push the current vertex
          if (code === 10 && vCount > 0) {
            rawVerts.push({ x: curX, y: curY, bulge: curBulge });
            curBulge = 0;
          }
          if (code === 20 && vCount === 0) {
            // first vertex: push on 20
          }
          if (code === 20 && (j + 1 >= pairs.length || pairs[j + 1].code !== 42)) {
            if (vCount === count - 1) {
              rawVerts.push({ x: curX, y: curY, bulge: curBulge });
              vCount++;
            } else {
              vCount++;
            }
          }
        }
        if (rawVerts.length < 2) return null;
        // Convert vertices with bulges to point segments
        const pts = [];
        const addArc = (x0, y0, x1, y1, bulge, cut) => {
          if (Math.abs(bulge) < 1e-10) {
            pts.push({ x: x1 * scale, y: y1 * scale, cut });
            return;
          }
          const ang = 4 * Math.atan(Math.abs(bulge));
          const dir = bulge < 0 ? 1 : -1; // DXF: positive bulge = CW in WCS
          const dx = x1 - x0, dy = y1 - y0;
          const chord = Math.sqrt(dx * dx + dy * dy);
          if (chord < 1e-10) { pts.push({ x: x1 * scale, y: y1 * scale, cut }); return; }
          const r = chord / (2 * Math.sin(ang / 2));
          const h = r * Math.cos(ang / 2);
          const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
          const perpX = -dy / chord * h * dir, perpY = dx / chord * h * dir;
          const cx = mx + perpX, cy = my + perpY;
          const startA = Math.atan2(y0 - cy, x0 - cx);
          const endA = Math.atan2(y1 - cy, x1 - cx);
          let dAng = endA - startA;
          if (dir < 0 && dAng < 0) dAng += 2 * Math.PI;
          if (dir > 0 && dAng > 0) dAng -= 2 * Math.PI;
          const steps = Math.max(8, Math.ceil(Math.abs(dAng) * r * scale * 2));
          for (let i = 1; i <= steps; i++) {
            const a = startA + dAng * i / steps;
            pts.push({ x: (cx + r * Math.cos(a)) * scale, y: (cy + r * Math.sin(a)) * scale, cut });
          }
        };
        for (let i = 0; i < rawVerts.length; i++) {
          const v = rawVerts[i];
          if (i === 0) {
            pts.push({ x: v.x * scale, y: v.y * scale, cut: false });
          } else {
            const prev = rawVerts[i - 1];
            addArc(prev.x, prev.y, v.x, v.y, prev.bulge, true);
          }
        }
        if (closed && rawVerts.length > 1) {
          const first = rawVerts[0], last = rawVerts[rawVerts.length - 1];
          addArc(last.x, last.y, first.x, first.y, last.bulge, true);
        }
        return pts;
      }
      case 'POLYLINE': {
        // Polyline: has VERTEX sub-entities
        const closed = (g(70) & 1) === 1;
        const vertPairs = [];
        let j = 0;
        while (j < pairs.length) {
          if (pairs[j].code === 0 && pairs[j].val === 'VERTEX') {
            const vp = [];
            j++;
            while (j < pairs.length && !(pairs[j].code === 0)) {
              vp.push(pairs[j]);
              j++;
            }
            vertPairs.push(vp);
          } else {
            j++;
          }
        }
        const pts = vertPairs.map((vp, vi) => {
          const x = vp.find(p => p.code === 10);
          const y = vp.find(p => p.code === 20);
          return {
            x: (x ? parseFloat(x.val) : 0) * scale,
            y: (y ? parseFloat(y.val) : 0) * scale,
            cut: vi > 0,
            layer,
          };
        });
        if (pts.length < 2) return null;
        if (closed && pts.length > 1) pts.push({ ...pts[0], cut: true, layer });
        return pts;
      }
      case 'POINT': {
        const x = g(10), y = g(20);
        if (x === undefined || y === undefined) return null;
        return [
          { x: x * scale, y: y * scale, cut: false, layer },
          { x: x * scale, y: y * scale, cut: false, layer },
        ];
      }
      default:
        return null;
    }
  },
};

