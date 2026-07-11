// â”€â”€ gcodeParser â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const gcodeParser = {
  parse(text) {
    if (typeof text !== 'string') return [];
    text = text.replace(/\r/g, '');
    return text.split('\n').map((raw, lineIndex) => {
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

      const type   = parts.length > firstIdx ? parts[firstIdx] : '';
      const params = {};
      for (let i = firstIdx + 1; i < parts.length; i++) {
        parts[i].replace(/([A-Z])([-\d.]+)/g, (_, l, n) => { params[l] = parseFloat(n); });
      }
      return { lineIndex, raw, type, params, comment, isBlank: false, isComment: false, blockDelete };
    });
  },

  serialize(commands) {
    return commands.map(c => {
      if (c.isBlank || c.isComment || c.type === 'UNKNOWN') return c.raw;
      let line = '';
      if (c.blockDelete) line += '/';
      line += c.type;
      for (const [k, v] of Object.entries(c.params)) {
        if (k === 'N') continue; // skip line number on output
        line += ` ${k}${Number.isInteger(v) ? v : parseFloat(v.toFixed(4))}`;
      }
      if (c.comment) line += ` ; ${c.comment}`;
      return line;
    }).join('\n');
  },

  highlight(text) {
    if (!text) return '';
    return text.replace(/\r/g, '').split('\n').map(line => {
      // Comment-only line
      if (/^\s*\(/.test(line) || /^\s*;/.test(line)) {
        return `<span class="hl-comment">${this._escape(line)}</span>`;
      }
      // Strip comments for command analysis
      const body = line.replace(/\(.*?\)/g, '').replace(/;.*$/, '').trim();
      const commentPart = line.includes(';') ? line.substring(line.indexOf(';')) : (line.includes('(') ? line.substring(line.indexOf('(')) : '');
      if (!body) return this._escape(line) ? `<span class="hl-comment">${this._escape(line)}</span>` : '';

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
      if (/^G0(0)?$/.test(cmd)) cmdClass = 'hl-g0';
      else if (/^G1(01)?$/.test(cmd)) cmdClass = 'hl-g1';
      else if (/^G2(02)?$/.test(cmd) || /^G3(03)?$/.test(cmd)) cmdClass = 'hl-arc';
      else if (/^M\d+$/.test(cmd)) cmdClass = 'hl-mcode';
      else if (/^G\d+$/.test(cmd)) cmdClass = 'hl-unknown';
      else if (/^T\d+$/.test(cmd)) cmdClass = 'hl-mcode';

      let result = hlPrefix;
      if (isN) result += `<span class="hl-lineno">${this._escape(tokens[0])}</span> `;
      if (cmd) result += `<span class="${cmdClass}">${this._escape(cmd)}</span>`;
      for (let i = ti + 1; i < tokens.length; i++) {
        const p = tokens[i];
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
      return result;
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
    const laserOnCmds = commands.filter(c => c.type === 'M3' || c.type === 'M4').map(c => c.type);

    return {
      header,
      footer,
      feedCut:    feedsCut.length    ? Math.round(feedsCut.reduce((a, b) => a + b) / feedsCut.length) : 3000,
      feedTravel: feedsTravel.length ? Math.round(feedsTravel.reduce((a, b) => a + b) / feedsTravel.length) : 8000,
      sMax:       sValues.length     ? safeMax(sValues) : 1000,
              laserCmd:   laserOnCmds[0] || 'M4',
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

  applyOffset(commands, offsets) {
    const axes = ['X','Y','Z','A','B','C'];
    return commands.map(c => {
      if (!['G0','G00','G1','G01','G2','G02','G3','G03'].includes(c.type)) return c;
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
    const rad = angleDeg * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    return commands.map(c => {
      if (!['G0','G00','G1','G01','G2','G02','G3','G03'].includes(c.type)) return c;
      const p = { ...c.params };
      if (p.X !== undefined || p.Y !== undefined) {
        const x = p.X || 0, y = p.Y || 0;
        p.X = parseFloat((x * cos - y * sin).toFixed(4));
        p.Y = parseFloat((x * sin + y * cos).toFixed(4));
      }
      if (p.I !== undefined || p.J !== undefined) {
        const i = p.I || 0, j = p.J || 0;
        p.I = parseFloat((i * cos - j * sin).toFixed(4));
        p.J = parseFloat((i * sin + j * cos).toFixed(4));
      }
      return { ...c, params: p, raw: '' };
    });
  },

};

