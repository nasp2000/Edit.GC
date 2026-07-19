// ---- svgConverter ----------------------------------------------------------------------------------------------
const svgConverter = {
  PX_TO_MM: 25.4 / 96,

  // Main entry point: returns array of G-code command objects
  convert(svgText, template) {
    const parser = new DOMParser();
    const doc    = parser.parseFromString(svgText, 'image/svg+xml');
    const svgEl  = doc.querySelector('svg');
    if (!svgEl) throw new Error('No SVG element found');

    const vb    = this._getViewBox(svgEl);
    const scale = this._getScaleToMm(svgEl, vb);
    const hMm   = vb.height * scale;

    const segments = [];
    this._extractElements(svgEl, segments, scale, vb);

    return this.segmentsToGcode(segments, template, hMm);
  },

  // Convert pre-parsed segments (from SVG or DXF) to G-code
  // Each segment is [{x,y,cut}, ...]; Y is SVG-down (0 at top)
  // We flip Y to CNC convention: Y+ up (0 at bottom).
  segmentsToGcode(segments, template, dimH) {
    const feedCut    = template?.laser?.feedCut    || 3000;
    const feedTravel = template?.laser?.feedTravel || 8000;
    const sMax       = template?.laser?.sMax       || 1000;
    const passes     = template?.laser?.passes     || 1;
    const zStep      = parseFloat(template?.laser?.zStep) || 0;
    const focusZ     = parseFloat(template?.laser?.focusZ) || 0;
    const useZ       = template?.laser?.useZ !== false;
    const machineX   = parseFloat(template?.laser?.machineX) || 0;
    const machineY   = parseFloat(template?.laser?.machineY) || 0;
    const laserOn    = template?.laser?.laserOnCmd || 'M4';
    const laserOff   = template?.laser?.laserOffCmd || 'M5';
    const baseCmd    = (s) => s.trim().toUpperCase().split(/\s+/)[0];
    const isStdLaserOn = /^M[34]$/i.test(baseCmd(laserOn));
    const laserOnHasS = /\bS\b/.test(laserOn);
    const cmtMap     = template?.commandComments  || {};
    const flipY = dimH != null;
    const _y = (y) => flipY ? Number((dimH - y).toFixed(4)) : Number(y.toFixed(4));
    const _x = (x) => Number(x.toFixed(4));
    const cmds = [];
    // SM300 mode: implicit motion (no G0/G1), no S param, feed on move line
    const isSM300 = /SM3/i.test(laserOn) || /SM3/i.test(laserOff) ||
                    (template?.options && /^SM3/i.test(String(template.options.laserOnCmd || '')));
    const zBase = isSM300 ? focusZ : 0;
    const _annotate = (raw) => {
      const trimmed = raw.trim();
      for (const key in cmtMap) {
        if (trimmed === key || trimmed.startsWith(key + ' ')) {
          const existingComment = trimmed.includes(';') ? '' : ` ; ${cmtMap[key]}`;
          return raw + existingComment;
        }
      }
      return raw;
    };
    // Header
    if (template?.header?.length) {
      template.header.forEach(raw => cmds.push(...gcodeParser.parse(_annotate(raw) + '\n')));
      const headerStr = template.header.join(' ').toUpperCase();
      if (!headerStr.includes(baseCmd(laserOn).toUpperCase())) {
        cmds.push(this._cmd(baseCmd(laserOn), isStdLaserOn && !laserOnHasS ? { S: 0 } : {}));
      }
    } else {
      cmds.push(this._cmd('G21'));
      cmds.push(this._cmd('G90'));
      cmds.push(this._cmd(baseCmd(laserOn), isStdLaserOn && !laserOnHasS ? { S: 0 } : {}));
    }
    // Sort segments by interior-first (contained shapes before containers) and add inter-segment laser-off/travel/laser-on
    const segBounds = segments.map(seg => {
      if (!seg || seg.length < 2) return null;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      seg.forEach(pt => {
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
      });
      return { minX, maxX, minY, maxY, area: (maxX - minX) * (maxY - minY) || 0 };
    });
    const sortedIndices = segments.map((_, i) => i).sort((a, b) => {
      const ba = segBounds[a], bb = segBounds[b];
      if (!ba || !bb) return 0;
      const aContainsB = ba.minX <= bb.minX && ba.maxX >= bb.maxX && ba.minY <= bb.minY && ba.maxY >= bb.maxY;
      const bContainsA = bb.minX <= ba.minX && bb.maxX >= ba.maxX && bb.minY <= ba.minY && bb.maxY >= ba.maxY;
      if (aContainsB && !bContainsA) return 1;
      if (bContainsA && !aContainsB) return -1;
      return (ba.area || 0) - (bb.area || 0);
    });

    const baseOff = baseCmd(laserOff);
    const baseOn = baseCmd(laserOn);

    for (let si = 0; si < sortedIndices.length; si++) {
      const seg = segments[sortedIndices[si]];
      if (!seg || seg.length < 2) continue;
      const start = seg[0];

      if (si > 0) {
        // Inter-segment: laser off, travel to next start, laser on
        cmds.push(this._cmd(baseOff));
        if (isSM300) {
          cmds.push(this._cmdImplicit(_x(start.x), _y(start.y), feedTravel, zBase));
          cmds.push(this._cmd(baseOn, {}));
        } else {
          cmds.push(this._cmd('G0', { X: this._r(_x(start.x)), Y: this._r(_y(start.y)), F: feedTravel }));
          cmds.push(this._cmd(baseOn, isStdLaserOn && !laserOnHasS ? { S: 0 } : {}));
        }
      } else {
        // First segment: rapid to start only
        if (isSM300) {
          cmds.push(this._cmdImplicit(_x(start.x), _y(start.y), feedTravel, zBase));
        } else {
          cmds.push(this._cmd('G0', { X: this._r(_x(start.x)), Y: this._r(_y(start.y)), F: feedTravel }));
        }
      }
      // Determine if segment is closed (last point ? travel-to-start point)
      const lastPt = seg[seg.length - 1];
      const isClosed = start && lastPt &&
        Math.abs(start.x - lastPt.x) < 0.001 && Math.abs(start.y - lastPt.y) < 0.001;
      // Cut portion repeated `passes` times
      for (let pass = 0; pass < passes; pass++) {
        const passZ = zBase + pass * zStep;
        if (passes > 1) {
          cmds.push({ lineIndex: -1, raw: `; Pass ${pass + 1}`, type: '', params: {}, comment: ` Pass ${pass + 1}`, isBlank: false, isComment: true, blockDelete: false });
        }
        if (isClosed) {
          // Closed shape: all passes go forward, no travel between passes
          if (pass > 0 && zStep && useZ && !isSM300) {
            cmds.push(...gcodeParser.parse('G91\nG0 Z' + zStep + '\nG90\n'));
          }
          for (let i = 1; i < seg.length; i++) {
            const pt = seg[i];
            if (pt.cut) {
              if (isSM300) {
                cmds.push(this._cmdImplicit(_x(pt.x), _y(pt.y), feedCut, useZ ? passZ : 0));
              } else {
                cmds.push(this._cmd('G1', { X: this._r(_x(pt.x)), Y: this._r(_y(pt.y)), F: feedCut, S: sMax }));
              }
            }
          }
        } else {
          // Open shape: alternating direction, no travel between passes
          if (pass > 0 && zStep && useZ && !isSM300) {
            cmds.push(...gcodeParser.parse('G91\nG0 Z' + zStep + '\nG90\n'));
          }
          if (pass % 2 === 0) {
            // Even pass: forward direction (start ? end)
            for (let i = 1; i < seg.length; i++) {
              const pt = seg[i];
              if (pt.cut) {
                if (isSM300) {
                  cmds.push(this._cmdImplicit(_x(pt.x), _y(pt.y), feedCut, useZ ? passZ : 0));
                } else {
                  cmds.push(this._cmd('G1', { X: this._r(_x(pt.x)), Y: this._r(_y(pt.y)), F: feedCut, S: sMax }));
                }
              } else {
                if (isSM300) {
                  cmds.push(this._cmdImplicit(_x(pt.x), _y(pt.y), feedTravel, useZ ? passZ : 0));
                } else {
                  cmds.push(this._cmd('G0', { X: this._r(_x(pt.x)), Y: this._r(_y(pt.y)), F: feedTravel }));
                }
              }
            }
          } else {
            // Odd pass: reverse direction (no travel, cut back from end to start)
            for (let i = seg.length - 1; i >= 1; i--) {
              const pt = seg[i];
              if (pt.cut) {
                if (isSM300) {
                  cmds.push(this._cmdImplicit(_x(pt.x), _y(pt.y), feedCut, useZ ? passZ : 0));
                } else {
                  cmds.push(this._cmd('G1', { X: this._r(_x(pt.x)), Y: this._r(_y(pt.y)), F: feedCut, S: sMax }));
                }
              }
            }
          }
        }
      }
    }
    // Footer
    if (template?.footer?.length) {
      template.footer.forEach(raw => cmds.push(...gcodeParser.parse(_annotate(raw) + '\n')));
    } else {
      cmds.push(this._cmd(baseCmd(laserOff)));
      if (isSM300) {
        cmds.push(this._cmdImplicit(_x(0), _y(0), feedTravel, useZ ? zBase : 0));
      } else {
        cmds.push(this._cmd('G0', { X: this._r(_x(0)), Y: this._r(_y(0)), F: feedTravel }));
      }
      cmds.push(this._cmd('M30'));
    }
    // Auto-center: shift all motion commands so path starts near X0 Y0
    const isMotion = (t) => ['G0','G00','G1','G01','G2','G02','G3','G03',''].includes(t) || t === null || t === undefined;
    const isRealCmd = (c) => !c.isComment && !c.isBlank && isMotion(c.type);
    let minX = Infinity, minY = Infinity;
    cmds.forEach(c => {
      if (!isRealCmd(c)) return;
      if (c.params.X !== undefined && c.params.X < minX) minX = c.params.X;
      if (c.params.Y !== undefined && c.params.Y < minY) minY = c.params.Y;
    });
    if (isFinite(minX) && isFinite(minY) && (Math.abs(minX) > 0.01 || Math.abs(minY) > 0.01)) {
      cmds.forEach(c => {
        if (!isRealCmd(c)) return;
        if (c.params.X !== undefined) c.params.X = parseFloat((c.params.X - minX).toFixed(3));
        if (c.params.Y !== undefined) c.params.Y = parseFloat((c.params.Y - minY).toFixed(3));
        c.raw = '';
      });
      // Restore footer return-to-home to X0 Y0
      for (let i = cmds.length - 1; i >= 0; i--) {
        const c = cmds[i];
        if (c.params.X !== undefined || c.params.Y !== undefined) {
          c.params.X = 0; c.params.Y = 0; c.raw = '';
          break;
        }
      }
    }
    // Apply machine origin offset (Start X / Start Y)
    if (machineX || machineY) {
      cmds.forEach(c => {
        if (!isRealCmd(c)) return;
        if (c.params.X !== undefined) c.params.X = parseFloat((c.params.X + machineX).toFixed(3));
        if (c.params.Y !== undefined) c.params.Y = parseFloat((c.params.Y + machineY).toFixed(3));
        c.raw = '';
      });
    }
    return cmds;
  },

  _cmd(type, params = {}) {
    const paramStr = Object.entries(params)
      .map(([k, v]) => ` ${k}${Number.isInteger(v) ? v : parseFloat(v.toFixed(3))}`)
      .join('');
    const raw = type + paramStr;
    return { lineIndex: -1, raw, type, params: { ...params }, comment: '', isBlank: false, isComment: false };
  },

  _cmdImplicit(x, y, feed, z) {
    let raw = `X${this._r(x)} Y${this._r(y)} Z${this._r(z)} F${feed}`;
    return { lineIndex: -1, raw, type: '', params: { X: this._r(x), Y: this._r(y), Z: this._r(z), F: feed }, comment: '', isBlank: false, isComment: false };
  },

  _r(n) { return parseFloat(n.toFixed(3)); },

  _getViewBox(svgEl) {
    const vb = svgEl.getAttribute('viewBox');
    if (vb) {
      const [minX, minY, w, h] = vb.trim().split(/[\s,]+/).map(Number);
      return { minX: minX || 0, minY: minY || 0, width: w || 100, height: h || 100 };
    }
    return { minX: 0, minY: 0, width: parseFloat(svgEl.getAttribute('width')) || 100, height: parseFloat(svgEl.getAttribute('height')) || 100 };
  },

  _getScaleToMm(svgEl, vb) {
    const wAttr = svgEl.getAttribute('width') || '';
    if (wAttr.includes('mm'))  return parseFloat(wAttr) / vb.width;
    if (wAttr.includes('cm'))  return parseFloat(wAttr) * 10 / vb.width;
    if (wAttr.includes('in'))  return parseFloat(wAttr) * 25.4 / vb.width;
    const wPx = parseFloat(wAttr);
    if (wPx && !wAttr.includes('mm')) return (wPx * this.PX_TO_MM) / vb.width;
    return 1; // treat viewBox units as mm (common in laser CAD exports)
  },

  // Parse SVG transform string into a function: (x,y) => [nx, ny]
  _makeTransform(transformStr) {
    if (!transformStr) return null;
    // Parse individual transforms
    const re = /(translate|scale|rotate|matrix|skewX|skewY)\s*\(([^)]+)\)/g;
    let m;
    let a = 1, b = 0, c = 0, d = 1, e = 0, f = 0;
    while ((m = re.exec(transformStr)) !== null) {
      const args = m[2].trim().split(/[\s,]+/).map(Number);
      switch (m[1]) {
        case 'translate':
          e += args[0] || 0;
          f += args[1] || 0;
          break;
        case 'scale':
          { const sx = args[0] || 1, sy = args[1] || args[0] || 1;
            a *= sx; b *= sx; c *= sy; d *= sy; break; }
        case 'rotate':
          { const ang = (args[0] || 0) * Math.PI / 180, cos = Math.cos(ang), sin = Math.sin(ang);
            const cx = args[1] || 0, cy = args[2] || 0;
            // translate(-cx,-cy) * rotate * translate(cx,cy)
            const tx = cx - cx*cos + cy*sin, ty = cy - cx*sin - cy*cos;
            const na = a*cos + c*sin, nb = b*cos + d*sin;
            const nc = -a*sin + c*cos, nd = -b*sin + d*cos;
            const ne = a*tx + c*ty + e, nf = b*tx + d*ty + f;
            a = na; b = nb; c = nc; d = nd; e = ne; f = nf; break; }
        case 'matrix':
          if (args.length >= 6) {
            const na = a*args[0] + c*args[1], nb = b*args[0] + d*args[1];
            const nc = a*args[2] + c*args[3], nd = b*args[2] + d*args[3];
            const ne = a*args[4] + c*args[5] + e, nf = b*args[4] + d*args[5] + f;
            a = na; b = nb; c = nc; d = nd; e = ne; f = nf; break; }
          break;
        case 'skewX':
          { const t = Math.tan((args[0] || 0) * Math.PI / 180);
            const nc = a*t + c, nd = b*t + d;
            c = nc; d = nd; break; }
        case 'skewY':
          { const t = Math.tan((args[0] || 0) * Math.PI / 180);
            const na = a + c*t, nb = b + d*t;
            a = na; b = nb; break; }
      }
    }
    const eps = 1e-10;
    if (Math.abs(a-1) < eps && Math.abs(b) < eps && Math.abs(c) < eps && Math.abs(d-1) < eps && Math.abs(e) < eps && Math.abs(f) < eps) return null;
    return (x, y) => [a * x + c * y + e, b * x + d * y + f];
  },

  _extractElements(el, segments, scale, vb, parentTfm) {
    for (const child of (el.children || [])) {
      const tag = child.tagName.toLowerCase().replace(/^svg:/, '');
      const localTfm = this._makeTransform(child.getAttribute('transform'));
      // Compose viewBox offset into the transform (SVG spec: transform, then viewBox)
      const vbOffset = (x, y) => [x - vb.minX, y - vb.minY];
      const tfm = localTfm
        ? parentTfm
          ? (x, y) => { const [lx, ly] = localTfm(x, y); const [px, py] = parentTfm(lx, ly); return vbOffset(px, py); }
          : (x, y) => { const [lx, ly] = localTfm(x, y); return vbOffset(lx, ly); }
        : parentTfm
          ? (x, y) => { const [px, py] = parentTfm(x, y); return vbOffset(px, py); }
          : vbOffset;
      if      (tag === 'path')                       segments.push(this._applyTfmToSeg(this._parsePath(child.getAttribute('d') || '', scale, vb), tfm));
      else if (tag === 'rect')                       segments.push(this._applyTfmToSeg(this._parseRect(child, scale, vb), tfm));
      else if (tag === 'circle')                     segments.push(this._applyTfmToSeg(this._parseCircle(child, scale, vb), tfm));
      else if (tag === 'ellipse')                    segments.push(this._applyTfmToSeg(this._parseEllipse(child, scale, vb), tfm));
      else if (tag === 'line')                       segments.push(this._applyTfmToSeg(this._parseLine(child, scale, vb), tfm));
      else if (tag === 'polyline' || tag === 'polygon') segments.push(this._applyTfmToSeg(this._parsePolyline(child, tag, scale, vb), tfm));
      else if (['g','svg','symbol','a','use'].includes(tag)) this._extractElements(child, segments, scale, vb, tfm);
    }
  },

  _applyTfmToSeg(seg, tfm) {
    if (!seg || !tfm) return seg;
    return seg.map(pt => { const [x, y] = tfm(pt.x, pt.y); return { ...pt, x, y }; });
  },

  // ---- SVG <path> d-attribute parser --------------------------------------------------
  _parsePath(d, scale, vb) {
    const pts    = [];
    const tokens = this._tokenizePath(d);
    let x = 0, y = 0, startX = 0, startY = 0;
    let lcpx = 0, lcpy = 0, lqpx = 0, lqpy = 0;
    let lastCmd = '';

    const push = (nx, ny, cut) => { if (!isNaN(nx) && !isNaN(ny)) pts.push({ x: nx * scale, y: ny * scale, cut }); };

    for (const { cmd, args } of tokens) {
      const rel = cmd !== cmd.toUpperCase() && cmd !== 'z' && cmd !== 'Z';
      const c   = cmd.toUpperCase();
      const ax  = v => rel ? x + v : v;
      const ay  = v => rel ? y + v : v;

      if (c === 'M') {
        for (let i = 0; i < args.length; i += 2) {
          x = ax(args[i]); y = ay(args[i + 1]);
          push(x, y, i > 0);                          // first = travel, rest = implicit L
          if (i === 0) { startX = x; startY = y; }
        }
      } else if (c === 'L') {
        for (let i = 0; i < args.length; i += 2) { x = ax(args[i]); y = ay(args[i + 1]); push(x, y, true); }
      } else if (c === 'H') {
        for (const v of args) { x = rel ? x + v : v; push(x, y, true); }
      } else if (c === 'V') {
        for (const v of args) { y = rel ? y + v : v; push(x, y, true); }
      } else if (c === 'C') {
        for (let i = 0; i < args.length; i += 6) {
          const x1 = ax(args[i]),   y1 = ay(args[i+1]);
          const x2 = ax(args[i+2]), y2 = ay(args[i+3]);
          const ex = ax(args[i+4]), ey = ay(args[i+5]);
          this._flattenCubic(x, y, x1, y1, x2, y2, ex, ey, pts, scale);
          lcpx = x2; lcpy = y2; x = ex; y = ey;
        }
      } else if (c === 'S') {
        for (let i = 0; i < args.length; i += 4) {
          const x1 = (lastCmd === 'C' || lastCmd === 'S') ? 2*x - lcpx : x;
          const y1 = (lastCmd === 'C' || lastCmd === 'S') ? 2*y - lcpy : y;
          const x2 = ax(args[i]),   y2 = ay(args[i+1]);
          const ex = ax(args[i+2]), ey = ay(args[i+3]);
          this._flattenCubic(x, y, x1, y1, x2, y2, ex, ey, pts, scale);
          lcpx = x2; lcpy = y2; x = ex; y = ey;
        }
      } else if (c === 'Q') {
        for (let i = 0; i < args.length; i += 4) {
          const qx = ax(args[i]),   qy = ay(args[i+1]);
          const ex = ax(args[i+2]), ey = ay(args[i+3]);
          this._flattenQuad(x, y, qx, qy, ex, ey, pts, scale);
          lqpx = qx; lqpy = qy; x = ex; y = ey;
        }
      } else if (c === 'T') {
        for (let i = 0; i < args.length; i += 2) {
          const qx = (lastCmd === 'Q' || lastCmd === 'T') ? 2*x - lqpx : x;
          const qy = (lastCmd === 'Q' || lastCmd === 'T') ? 2*y - lqpy : y;
          const ex = ax(args[i]), ey = ay(args[i+1]);
          this._flattenQuad(x, y, qx, qy, ex, ey, pts, scale);
          lqpx = qx; lqpy = qy; x = ex; y = ey;
        }
      } else if (c === 'A') {
        for (let i = 0; i < args.length; i += 7) {
          const ex = ax(args[i+5]), ey = ay(args[i+6]);
          this._flattenArc(x, y, Math.abs(args[i]), Math.abs(args[i+1]), args[i+2], args[i+3] ? 1 : 0, args[i+4] ? 1 : 0, ex, ey, pts, scale);
          x = ex; y = ey;
        }
      } else if (c === 'Z') {
        push(startX, startY, true);
        x = startX; y = startY;
      }
      lastCmd = c;
    }
    return pts;
  },

  _tokenizePath(d) {
    const result = [];
    const re = /([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
    let cmd = null, args = [];
    let m;
    while ((m = re.exec(d)) !== null) {
      if (m[1]) { if (cmd) result.push({ cmd, args }); cmd = m[1]; args = []; }
      else args.push(parseFloat(m[2]));
    }
    if (cmd) result.push({ cmd, args });
    return result;
  },

  _bezierTolerance: 0.1, // mm ? configurable

  _flattenCubic(x0, y0, x1, y1, x2, y2, x3, y3, pts, scale) {
    const tol = this._bezierTolerance / scale;
    this._recursiveCubic(x0, y0, x1, y1, x2, y2, x3, y3, pts, scale, tol);
  },

  _recursiveCubic(x0, y0, x1, y1, x2, y2, x3, y3, pts, scale, tol) {
    // Flatness test: distance of control points from the chord
    const ux = x3 - x0, uy = y3 - y0;
    const len = Math.sqrt(ux * ux + uy * uy);
    if (len < 0.001) {
      pts.push({ x: x3 * scale, y: y3 * scale, cut: true });
      return;
    }
    const cx = (x1 - x0) * uy - (y1 - y0) * ux;
    const cy = (x2 - x3) * uy - (y2 - y3) * ux;
    const maxDev = Math.max(Math.abs(cx), Math.abs(cy));
    if (maxDev / len <= tol) {
      pts.push({ x: x3 * scale, y: y3 * scale, cut: true });
      return;
    }
    // De Casteljau subdivision at t=0.5
    const mx01 = (x0 + x1) / 2, my01 = (y0 + y1) / 2;
    const mx12 = (x1 + x2) / 2, my12 = (y1 + y2) / 2;
    const mx23 = (x2 + x3) / 2, my23 = (y2 + y3) / 2;
    const mx012 = (mx01 + mx12) / 2, my012 = (my01 + my12) / 2;
    const mx123 = (mx12 + mx23) / 2, my123 = (my12 + my23) / 2;
    const mx0123 = (mx012 + mx123) / 2, my0123 = (my012 + my123) / 2;

    this._recursiveCubic(x0, y0, mx01, my01, mx012, my012, mx0123, my0123, pts, scale, tol);
    this._recursiveCubic(mx0123, my0123, mx123, my123, mx23, my23, x3, y3, pts, scale, tol);
  },

  _flattenQuad(x0, y0, x1, y1, x2, y2, pts, scale) {
    const tol = this._bezierTolerance / scale;
    this._recursiveQuad(x0, y0, x1, y1, x2, y2, pts, scale, tol);
  },

  _recursiveQuad(x0, y0, x1, y1, x2, y2, pts, scale, tol) {
    const ux = x2 - x0, uy = y2 - y0;
    const len = Math.sqrt(ux * ux + uy * uy);
    if (len < 0.001) {
      pts.push({ x: x2 * scale, y: y2 * scale, cut: true });
      return;
    }
    const d = Math.abs((x1 - x0) * uy - (y1 - y0) * ux);
    if (d / len <= tol) {
      pts.push({ x: x2 * scale, y: y2 * scale, cut: true });
      return;
    }
    const mx01 = (x0 + x1) / 2, my01 = (y0 + y1) / 2;
    const mx12 = (x1 + x2) / 2, my12 = (y1 + y2) / 2;
    const mx012 = (mx01 + mx12) / 2, my012 = (my01 + my12) / 2;

    this._recursiveQuad(x0, y0, mx01, my01, mx012, my012, pts, scale, tol);
    this._recursiveQuad(mx012, my012, mx12, my12, x2, y2, pts, scale, tol);
  },

  _flattenArc(x0, y0, rx, ry, xRot, largeArc, sweep, x1, y1, pts, scale) {
    if (rx === 0 || ry === 0) { pts.push({ x: x1 * scale, y: y1 * scale, cut: true }); return; }
    const phi = xRot * Math.PI / 180;
    const cp = Math.cos(phi), sp = Math.sin(phi);
    const dx = (x0 - x1) / 2, dy = (y0 - y1) / 2;
    const x1p =  cp * dx + sp * dy;
    const y1p = -sp * dx + cp * dy;
    let rx2 = rx*rx, ry2 = ry*ry;
    const x1p2 = x1p*x1p, y1p2 = y1p*y1p;
    let lam = x1p2/rx2 + y1p2/ry2;
    if (lam > 1) { const sl = Math.sqrt(lam); rx *= sl; ry *= sl; rx2 = rx*rx; ry2 = ry*ry; }
    const sign = largeArc === sweep ? -1 : 1;
    const sq = sign * Math.sqrt(Math.max(0, (rx2*ry2 - rx2*y1p2 - ry2*x1p2) / (rx2*y1p2 + ry2*x1p2)));
    const cxp =  sq * rx * y1p / ry;
    const cyp = -sq * ry * x1p / rx;
    const cx = cp*cxp - sp*cyp + (x0+x1)/2;
    const cy = sp*cxp + cp*cyp + (y0+y1)/2;
    const angle = (ux, uy, vx, vy) => {
      let a = Math.acos(Math.min(1, Math.max(-1, (ux*vx + uy*vy) / (Math.sqrt(ux*ux+uy*uy) * Math.sqrt(vx*vx+vy*vy)))));
      if (ux*vy - uy*vx < 0) a = -a;
      return a;
    };
    let theta1 = angle(1, 0, (x1p-cxp)/rx, (y1p-cyp)/ry);
    let dTheta  = angle((x1p-cxp)/rx, (y1p-cyp)/ry, (-x1p-cxp)/rx, (-y1p-cyp)/ry);
    if (!sweep && dTheta > 0) dTheta -= 2*Math.PI;
    if ( sweep && dTheta < 0) dTheta += 2*Math.PI;
    const steps = Math.min(Math.max(8, Math.ceil(Math.abs(dTheta) * Math.max(rx, ry) * scale * 2)), 2000);
    for (let i = 1; i <= steps; i++) {
      const t = theta1 + dTheta * i / steps;
      const px = cp*rx*Math.cos(t) - sp*ry*Math.sin(t) + cx;
      const py = sp*rx*Math.cos(t) + cp*ry*Math.sin(t) + cy;
      pts.push({ x: px * scale, y: py * scale, cut: true });
    }
  },

  // ---- Primitive shapes ----------------------------------------------------------------------------
  _parseRect(el, scale, vb) {
    const x = parseFloat(el.getAttribute('x') || 0);
    const y = parseFloat(el.getAttribute('y') || 0);
    const w = parseFloat(el.getAttribute('width')  || 0);
    const h = parseFloat(el.getAttribute('height') || 0);
    return [
      { x: x*scale,     y: y*scale,     cut: false },
      { x: (x+w)*scale, y: y*scale,     cut: true  },
      { x: (x+w)*scale, y: (y+h)*scale, cut: true  },
      { x: x*scale,     y: (y+h)*scale, cut: true  },
      { x: x*scale,     y: y*scale,     cut: true  },
    ];
  },

  _parseCircle(el, scale, vb) {
    const cx = parseFloat(el.getAttribute('cx') || 0);
    const cy = parseFloat(el.getAttribute('cy') || 0);
    const r  =  parseFloat(el.getAttribute('r')  || 0);
    const steps = Math.min(Math.max(32, Math.ceil(2 * Math.PI * r * scale * 2)), 2000);
    return Array.from({ length: steps + 1 }, (_, i) => {
      const a = (i / steps) * 2 * Math.PI;
      return { x: (cx + r*Math.cos(a))*scale, y: (cy + r*Math.sin(a))*scale, cut: i > 0 };
    });
  },

  _parseEllipse(el, scale, vb) {
    const cx = parseFloat(el.getAttribute('cx') || 0);
    const cy = parseFloat(el.getAttribute('cy') || 0);
    const rx =  parseFloat(el.getAttribute('rx') || 0);
    const ry =  parseFloat(el.getAttribute('ry') || 0);
    const steps = Math.min(Math.max(32, Math.ceil(2 * Math.PI * Math.max(rx, ry) * scale * 2)), 2000);
    return Array.from({ length: steps + 1 }, (_, i) => {
      const a = (i / steps) * 2 * Math.PI;
      return { x: (cx + rx*Math.cos(a))*scale, y: (cy + ry*Math.sin(a))*scale, cut: i > 0 };
    });
  },

  _parseLine(el, scale, vb) {
    return [
      { x: (parseFloat(el.getAttribute('x1')||0)) * scale, y: (parseFloat(el.getAttribute('y1')||0)) * scale, cut: false },
      { x: (parseFloat(el.getAttribute('x2')||0)) * scale, y: (parseFloat(el.getAttribute('y2')||0)) * scale, cut: true  },
    ];
  },

  _parsePolyline(el, tag, scale, vb) {
    const nums = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
    const pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      pts.push({ x: nums[i] * scale, y: nums[i+1] * scale, cut: i > 0 });
    }
    if (tag === 'polygon' && pts.length > 0) pts.push({ ...pts[0], cut: true });
    return pts;
  },
};

