// ---- exportTools: G-code → SVG / DXF export ----------------------------------------------------
const exportTools = {
  _tracePath(commands) {
    const segments = [];
    let x = 0, y = 0, z = 0;
    for (const c of commands) {
      if (c.isBlank || c.isComment) continue;
      const nx = c.params.X !== undefined ? c.params.X : x;
      const ny = c.params.Y !== undefined ? c.params.Y : y;
      const nz = c.params.Z !== undefined ? c.params.Z : z;
      const t = (c.type || '').toUpperCase();
      if (t === 'G0' || t === 'G00') {
        segments.push({ x1: x, y1: y, z1: z, x2: nx, y2: ny, z2: nz, rapid: true });
        x = nx; y = ny; z = nz;
      } else if (t === 'G1' || t === 'G01' || t === '') {
        if (nx !== x || ny !== y) {
          segments.push({ x1: x, y1: y, z1: z, x2: nx, y2: ny, z2: nz, rapid: false });
        }
        x = nx; y = ny; z = nz;
      } else if (t === 'G2' || t === 'G02' || t === 'G3' || t === 'G03') {
        const cx = c.params.I !== undefined ? x + c.params.I : x;
        const cy = c.params.J !== undefined ? y + c.params.J : y;
        const ccw = t === 'G3' || t === 'G03';
        segments.push({ x1: x, y1: y, z1: z, x2: nx, y2: ny, z2: nz, rapid: false, cx, cy, ccw });
        x = nx; y = ny; z = nz;
      } else {
        if (nx !== x || ny !== y) {
          segments.push({ x1: x, y1: y, z1: z, x2: nx, y2: ny, z2: nz, rapid: false });
        }
        x = nx; y = ny; z = nz;
      }
    }
    return segments;
  },

  _tracePoints(commands) {
    const points = [];
    let x = 0, y = 0, z = 0;
    let laserOn = false;
    const tpl = (typeof templateManager !== 'undefined' && templateManager.getActive()) || null;
    const baseCmd = (s) => s.trim().toUpperCase().split(/\s+/)[0];
    const tplOnList  = (tpl && tpl.data ? (tpl.data.laserOnCmd  || 'M3,M4') : 'M3,M4').split(',').map(baseCmd);
    const tplOffList = (tpl && tpl.data ? (tpl.data.laserOffCmd || 'M5') : 'M5').split(',').map(baseCmd);
    const isLaserOn = (c) => {
      const t = (c.type || '').toUpperCase();
      if (tplOnList.includes(t))  return true;
      if (tplOffList.includes(t)) return false;
      return laserOn;
    };
    for (const c of commands) {
      if (c.isBlank || c.isComment) continue;
      laserOn = isLaserOn(c);
      const nx = c.params.X !== undefined ? c.params.X : x;
      const ny = c.params.Y !== undefined ? c.params.Y : y;
      const nz = c.params.Z !== undefined ? c.params.Z : z;
      if (nx !== x || ny !== y || nz !== z) {
        points.push({ x: nx, y: ny, z: nz, laser: laserOn });
        x = nx; y = ny; z = nz;
      }
    }
    return points;
  },

  _getBounds(segments) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of segments) {
      for (const pt of [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }]) {
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
      }
      if (s.cx !== undefined) {
        if (s.cx < minX) minX = s.cx;
        if (s.cx > maxX) maxX = s.cx;
        if (s.cy < minY) minY = s.cy;
        if (s.cy > maxY) maxY = s.cy;
      }
    }
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  },

  _getPointsBounds(points) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  },

  exportSvg(commands) {
    if (!commands || !commands.length) return;
    const points = this._tracePoints(commands);
    if (!points.length) return;
    const b = this._getPointsBounds(points);
    const pad = 5;
    const r = 0.3;
    const vb = `${b.minX - pad} ${-(b.maxY + pad)} ${b.w + pad * 2} ${b.h + pad * 2}`;
    const lines = [];
    lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
    lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${(b.w + pad * 2).toFixed(2)}mm" height="${(b.h + pad * 2).toFixed(2)}mm">`);
    for (const p of points) {
      const color = p.laser ? '#ff0000' : '#00aa00';
      lines.push(`  <circle cx="${p.x.toFixed(4)}" cy="${(-p.y).toFixed(4)}" r="${r}" fill="${color}" stroke="none"/>`);
    }
    lines.push('</svg>');
    const blob = new Blob([lines.join('\n')], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: (state.originalName || 'toolpath').replace(/\.[^.]+$/, '') + '.svg' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  exportDxf(commands) {
    if (!commands || !commands.length) return;
    const points = this._tracePoints(commands);
    if (!points.length) return;
    const lines = [];
    const dxfCircle = (cx, cy, r, layer) => {
      lines.push('0', 'CIRCLE', '8', layer, '10', cx.toFixed(4), '20', cy.toFixed(4), '30', '0.0', '40', r.toFixed(4));
    };
    lines.push('0', 'SECTION', '2', 'ENTITIES');
    for (const p of points) {
      dxfCircle(p.x, p.y, 0.3, p.laser ? 'LASER_ON' : 'LASER_OFF');
    }
    lines.push('0', 'ENDSEC', '0', 'EOF');
    const content = '0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n0\nENDSEC\n0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n3\n0\nLAYER\n2\nLASER_ON\n70\n0\n62\n1\n6\nCONTINUOUS\n0\nLAYER\n2\nLASER_OFF\n70\n0\n62\n3\n6\nCONTINUOUS\n0\nENDTAB\n0\nENDSEC\n' + lines.join('\n') + '\n';
    const blob = new Blob([content], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: (state.originalName || 'toolpath').replace(/\.[^.]+$/, '') + '.dxf' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
};
