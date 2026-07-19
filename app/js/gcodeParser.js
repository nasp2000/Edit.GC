// ---- gcodeParser ----------------------------------------------------------------------------------------------
const gcodeParser = {
  parse(text) {
    if (typeof text !== 'string') return [];
    text = text.replace(/\r/g, '');
    const lines = text.split('\n');
    if (lines.length > CFG.MAX_COMMANDS) {
      // Too large ? return empty to prevent OOM
      return [];
    }
    const results = lines.map((raw, lineIndex) => {
      // Strip comments
      const stripped = raw.replace(/\(.*?\)/g, '').replace(/;.*$/, '').trim();
      const commentMatch = raw.match(/;(.*)$/) || raw.match(/\(([^)]*)\)/);
      const comment = commentMatch ? commentMatch[1].trim() : '';

      if (!stripped) return { lineIndex, raw, type: null, params: {}, comment, isBlank: true, isComment: false };
      const commentOnly = /^\(.*\)$/.test(raw.trim()) || /^;/.test(raw.trim());
      if (commentOnly) return { lineIndex, raw, type: 'COMMENT', params: {}, comment, isBlank: false, isComment: true };

      // Detect block delete (/)
      const blockDelete = stripped.startsWith('/');
      const body = blockDelete ? stripped.slice(1).trim() : stripped;

      // Tokenize
      const parts  = body.toUpperCase().split(/\s+/);
      // Skip N word (line number) if present
      let firstIdx = 0;
      if (parts.length > 0 && /^N\d+$/.test(parts[0])) firstIdx = 1;

      const params = {};
      let type   = parts.length > firstIdx ? parts[firstIdx] : '';
      // If first token is an axis word (X90 Y200), treat it as a param
      const typeParam = type.match(/^([XYZABC])([-\d.]+)$/);
      if (typeParam) {
        const v = parseFloat(typeParam[2]);
        if (!isNaN(v)) { params[typeParam[1]] = v; type = ''; }
      }
      for (let i = firstIdx + 1; i < parts.length; i++) {
        parts[i].replace(/([A-Z])([-\d.]+)/g, (_, l, n) => { const v = parseFloat(n); if (!isNaN(v)) params[l] = v; });
      }
      return { lineIndex, raw, type, params, comment, isBlank: false, isComment: false, blockDelete };
    });
    return results.length === 1 && results[0].isBlank && !results[0].raw.trim() ? [] : results;
  },

  serialize(commands) {
    const tpl = (typeof templateManager !== 'undefined' && templateManager.getActive()) || null;
    const lineEnd = (tpl && tpl.data && tpl.data.lineEnd) || '\n';
    const canonicalOrder = ['X','Y','Z','I','J','R','F','S','T','P','Q','L','A','B','C','U','V','W','D','H','M','K'];
    return commands.map(c => {
      if (c.isBlank || c.isComment || c.type === 'UNKNOWN') return c.raw;
      let line = '';
      if (c.blockDelete) line += '/';
      line += c.type;
      const used = {};
      for (const k of canonicalOrder) {
        if (k === 'N') continue;
        if (c.params[k] !== undefined) {
          line += ` ${k}${Number.isInteger(c.params[k]) ? c.params[k] : parseFloat(c.params[k].toFixed(4))}`;
          used[k] = true;
        }
      }
      for (const [k, v] of Object.entries(c.params)) {
        if (k === 'N' || used[k]) continue;
        line += ` ${k}${Number.isInteger(v) ? v : parseFloat(v.toFixed(4))}`;
      }
      if (c.comment) line += ` ; ${c.comment}`;
      return line;
    }).join(lineEnd);
  },

  highlight(text) {
    if (!text) return '';
    return text.replace(/\r/g, '').split('\n').map(line => {
      const isEdited = line.includes(';edit.gc');
      let inner;
      // Comment-only line
      if (/^\s*\(/.test(line) || /^\s*;/.test(line)) {
        inner = `<span class="hl-comment">${this._escape(line)}</span>`;
        return `<span class="hl-line${isEdited ? ' hl-line-edited' : ''}">${inner}</span>`;
      }
      // Strip comments for command analysis
      const body = line.replace(/\(.*?\)/g, '').replace(/;.*$/, '').trim();
      const commentPart = line.includes(';') ? line.substring(line.indexOf(';')) : (line.includes('(') ? line.substring(line.indexOf('(')) : '');
      if (!body) {
        inner = this._escape(line) ? `<span class="hl-comment">${this._escape(line)}</span>` : '';
        return `<span class="hl-line${isEdited ? ' hl-line-edited' : ''}">${inner}</span>`;
      }

      // Strip block delete marker for token analysis
      let hlPrefix = '';
      let bodyClean = body;
      if (bodyClean.startsWith('/')) {
        hlPrefix = '<span class="hl-blockdel">/</span>';
        bodyClean = bodyClean.slice(1).trim();
      }
      const tokens = bodyClean.toUpperCase().split(/\s+/);
      // Skip N word (line number)
      let ti = 0;
      const isN = tokens.length > 0 && /^N\d+$/.test(tokens[0]);
      if (isN) ti = 1;

      const cmd = ti < tokens.length ? tokens[ti] : '';
      let cmdClass = 'hl-unknown';
      // Check if first token is an axis word (implicit motion)
      const isAxisWord = /^[XYZABC][-\d]/.test(cmd);
      if (isAxisWord) {
        // No explicit command ? treat entire line as params
        cmdClass = '';
      } else if (/^G0(0)?$/.test(cmd)) cmdClass = 'hl-g0';
      else if (/^G1(01)?$/.test(cmd)) cmdClass = 'hl-g1';
      else if (/^G2(02)?$/.test(cmd) || /^G3(03)?$/.test(cmd)) cmdClass = 'hl-arc';
      else if (/^M\d+$/.test(cmd)) cmdClass = 'hl-mcode';
      else if (/^G\d+$/.test(cmd)) cmdClass = 'hl-unknown';
      else if (/^T\d+$/.test(cmd)) cmdClass = 'hl-mcode';

      let result = hlPrefix;
      if (isN) result += `<span class="hl-lineno">${this._escape(tokens[0])}</span> `;
      const startIdx = isAxisWord ? ti : ti + 1;
      if (cmd && !isAxisWord) result += `<span class="${cmdClass}">${this._escape(cmd)}</span>`;
      for (let i = startIdx; i < tokens.length; i++) {
        // If first token is axis word, include it in the param loop
        const p = isAxisWord && i === ti ? cmd : tokens[i];
        let pos = 0;
        p.replace(/([A-Z])([-\d.eE+]+)/g, (_, letter, num, offset) => {
          if (offset > pos) result += `<span class="hl-other">${this._escape(p.slice(pos, offset))}</span>`;
          result += ` <span class="hl-param">${this._escape(letter)}</span><span class="hl-value">${this._escape(num)}</span>`;
          pos = offset + letter.length + num.length;
        });
        if (pos < p.length) result += `<span class="hl-other">${this._escape(p.slice(pos))}</span>`;
      }
      if (commentPart) {
        result += ` <span class="hl-comment">${this._escape(commentPart)}</span>`;
      }
      return `<span class="hl-line${isEdited ? ' hl-line-edited' : ''}">${result}</span>`;
    }).join('\n');
  },

  _escape(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  },

  analyze(commands) {
    const moveTypes = new Set(['G0','G00','G1','G01']);
    const firstMoveIdx = commands.findIndex(c => moveTypes.has(c.type));
    const lastMoveIdx  = commands.reduce((acc, c, i) => moveTypes.has(c.type) ? i : acc, -1);

    const header = firstMoveIdx > 0 ? commands.slice(0, firstMoveIdx).map(c => c.raw).filter(r => r.trim()) : [];
    const footer = lastMoveIdx >= 0 ? commands.slice(lastMoveIdx + 1).map(c => c.raw).filter(r => r.trim()) : [];

    const feedsCut    = commands.filter(c => (c.type === 'G1' || c.type === 'G01') && c.params.F && (c.params.S ?? 0) > 0).map(c => c.params.F);
    const feedsTravel = commands.filter(c => (c.type === 'G0' || c.type === 'G00') && c.params.F).map(c => c.params.F);
    const sValues     = commands.map(c => c.params.S ?? 0).filter(s => s > 0);
    const tpl = (typeof templateManager !== 'undefined' && templateManager.getActive()) || null;
    const baseCmd = (s) => s.trim().toUpperCase().split(/\s+/)[0];
    const onTypes = (tpl && tpl.data ? (tpl.data.laserOnCmd || 'M3,M4') : 'M3,M4').split(',').map(baseCmd);
    const laserOnCmds = commands.filter(c => onTypes.includes((c.type || '').toUpperCase())).map(c => c.type);

    return {
      header,
      footer,
      feedCut:    feedsCut.length    ? Math.round(feedsCut.reduce((a, b) => a + b) / feedsCut.length) : 3000,
      feedTravel: feedsTravel.length ? Math.round(feedsTravel.reduce((a, b) => a + b) / feedsTravel.length) : 8000,
      sMax:       sValues.length     ? safeMax(sValues) : 1000,
      laserCmd:   laserOnCmds[0] || (tpl && tpl.data ? baseCmd(tpl.data.laserOnCmd) : 'M4'),
    };
  },

  analyzeFull(commands) {
    const knownGCodes = ['G0','G00','G1','G01','G2','G02','G3','G03','G4','G04','G10','G17','G18','G19','G20','G21','G28','G30','G40','G43','G49','G54','G55','G56','G57','G58','G59','G80','G81','G82','G83','G84','G85','G86','G87','G88','G89','G90','G91','G92','G93','G94','G98','G99'];
    const knownMCodes = ['M0','M1','M2','M3','M4','M5','M6','M7','M8','M9','M30','M98','M99'];
    const knownOthers = ['T','S','F','X','Y','Z','I','J','K','R','P','Q','L','D','H'];

    const xs = [], ys = [], zs = [], fs = [], ss = [];
    const unknownCmds = [];
    const mCodes = [];
    const totalLines = commands.length;
    let moveLines = 0, commentLines = 0, blankLines = 0;

    commands.forEach(c => {
      if (c.isBlank) blankLines++;
      else if (c.isComment) commentLines++;
      if (c.params.X !== undefined) xs.push(c.params.X);
      if (c.params.Y !== undefined) ys.push(c.params.Y);
      if (c.params.Z !== undefined) zs.push(c.params.Z);
      if (c.params.F !== undefined) fs.push(c.params.F);
      if (c.params.S !== undefined) ss.push(c.params.S);
      if (c.type && /^M\d+$/.test(c.type) && !mCodes.includes(c.type)) mCodes.push(c.type);
      if (c.type && !c.isBlank && !c.isComment && c.type !== 'COMMENT' && c.type !== 'UNKNOWN') {
        const isKnown = knownGCodes.includes(c.type) || knownMCodes.includes(c.type);
        if (!isKnown) unknownCmds.push(c.type);
      }
      if (['G0','G00','G1','G01','G2','G02','G3','G03'].includes(c.type)) moveLines++;
      else if (!c.type && !c.isBlank && !c.isComment && (c.params.X !== undefined || c.params.Y !== undefined || c.params.Z !== undefined)) moveLines++;
    });

    return {
      totalLines, moveLines, commentLines, blankLines,
      xs: xs.length ? safeMinMax(xs) : null,
      ys: ys.length ? safeMinMax(ys) : null,
      zs: zs.length ? safeMinMax(zs) : null,
      feeds: fs.length ? { values: [...new Set(fs)].sort((a,b)=>a-b), avg: Math.round(fs.reduce((a,b)=>a+b)/fs.length) } : null,
      powers: ss.length ? { values: [...new Set(ss)].sort((a,b)=>a-b), max: safeMax(ss) } : null,
      mCodes: [...new Set(mCodes)].sort(),
      unknownCmds: [...new Set(unknownCmds)].sort(),
    };
  },

  applyOffset(commands, offsets, opts) {
    const { laserOnly = false } = opts || {};
    const axes = ['X','Y','Z','A','B','C'];
    const isMotion = (t) => ['G0','G00','G1','G01','G2','G02','G3','G03',''].includes(t) || t === null || t === undefined;
    return commands.map(c => {
      if (!isMotion(c.type)) return c;
      if (laserOnly && !((c.params.S && c.params.S > 0) || c.type === '' || c.type === null || c.type === undefined)) return c;
      const p = { ...c.params };
      for (const k of axes) {
        if (p[k] !== undefined && offsets[k] !== undefined) {
          p[k] = parseFloat((p[k] + offsets[k]).toFixed(4));
        }
      }
      return { ...c, params: p, raw: '' };
    });
  },

  scaleCommands(commands, factor) {
    return commands.map(c => {
      if (!['G0','G00','G1','G01','G2','G02','G3','G03'].includes(c.type)) return c;
      const p = { ...c.params };
      ['X','Y','I','J'].forEach(k => { if (p[k] !== undefined) p[k] = parseFloat((p[k] * factor).toFixed(4)); });
      return { ...c, params: p, raw: '' };
    });
  },

  scaleCommandsXY(commands, fx, fy) {
    return commands.map(c => {
      if (!['G0','G00','G1','G01','G2','G02','G3','G03'].includes(c.type)) return c;
      const p = { ...c.params };
      if (p.X !== undefined) p.X = parseFloat((p.X * fx).toFixed(4));
      if (p.Y !== undefined) p.Y = parseFloat((p.Y * fy).toFixed(4));
      if (p.I !== undefined) p.I = parseFloat((p.I * fx).toFixed(4));
      if (p.J !== undefined) p.J = parseFloat((p.J * fy).toFixed(4));
      return { ...c, params: p, raw: '' };
    });
  },

  applyBatchParam(commands, cmdType, param, value) {
    return commands.map(c => {
      if (c.type !== cmdType && c.type !== cmdType.replace('0','00').replace('1','01')) return c;
      return { ...c, params: { ...c.params, [param]: value }, raw: '' };
    });
  },

  applyBatchParamFactor(commands, cmdType, param, factor) {
    return commands.map(c => {
      if (c.type !== cmdType && c.type !== cmdType.replace('0','00').replace('1','01')) return c;
      const p = { ...c.params };
      if (p[param] !== undefined) p[param] = parseFloat((p[param] * factor).toFixed(1));
      return { ...c, params: p, raw: '' };
    });
  },

  mirrorX(commands) {
    return commands.map(c => {
      if (!['G0','G00','G1','G01','G2','G02','G3','G03'].includes(c.type)) return c;
      const p = { ...c.params };
      if (p.Y !== undefined) p.Y = parseFloat((-p.Y).toFixed(4));
      if (p.J !== undefined) p.J = parseFloat((-p.J).toFixed(4));
      return { ...c, params: p, raw: '' };
    });
  },

  mirrorY(commands) {
    return commands.map(c => {
      if (!['G0','G00','G1','G01','G2','G02','G3','G03'].includes(c.type)) return c;
      const p = { ...c.params };
      if (p.X !== undefined) p.X = parseFloat((-p.X).toFixed(4));
      if (p.I !== undefined) p.I = parseFloat((-p.I).toFixed(4));
      return { ...c, params: p, raw: '' };
    });
  },

  rotate(commands, angleDeg) {
    const steps = ((angleDeg % 360) + 360) % 360;
    // Use exact integer rotations for 90? multiples to avoid floating-point drift
    return commands.map(c => {
      const isMotion = /^G[0-3]$|^G0[0-3]$/i.test(c.type);
      const isImplicit = (c.type === '' || c.type === undefined) && (c.params?.X !== undefined || c.params?.Y !== undefined);
      if (!isMotion && !isImplicit) return c;
      const p = { ...c.params };
      if (p.X !== undefined || p.Y !== undefined) {
        let x = p.X || 0, y = p.Y || 0;
        for (let r = 0; r < steps / 90; r++) {
          const nx = -y, ny = x; // 90? CW: (x, y) ? (-y, x)
          x = nx; y = ny;
        }
        p.X = parseFloat(x.toFixed(4));
        p.Y = parseFloat(y.toFixed(4));
      }
      if (p.I !== undefined || p.J !== undefined) {
        let i = p.I || 0, j = p.J || 0;
        for (let r = 0; r < steps / 90; r++) {
          const ni = -j, nj = i;
          i = ni; j = nj;
        }
        p.I = parseFloat(i.toFixed(4));
        p.J = parseFloat(j.toFixed(4));
      }
      return { ...c, params: p, raw: '' };
    });
  },

};

