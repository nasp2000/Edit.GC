const templateManager = {
  prefix: 'editgc_tpl_',
  _dirHandle: null,

  async save(name, content) {
    try { localStorage.setItem(this.prefix + name, content); } catch (_) { /* quota exceeded or unavailable */ }
    return content;
  },

  load(name) {
    try { return localStorage.getItem(this.prefix + name); } catch (_) { return null; }
  },

  list() {
    try {
      return Object.keys(localStorage)
        .filter(k => k.startsWith(this.prefix))
        .map(k => k.slice(this.prefix.length));
    } catch (_) { return []; }
  },

  delete(name) {
    try { localStorage.removeItem(this.prefix + name); } catch (_) {}
  },

  // Generate template text from G-code commands by stripping axis coordinates
  extractFromCommands(commands) {
    const lines = ['; TEMPLATE: extracted pattern',
      '; This template preserves the G-code structure without axis coordinates.',
      '; To use: fill in X, Y, Z, A, B, C, I, J values for your project.',
      ';',
      '; Legend:',
      ';   X Y Z A B C  → axis positions (add your values after the letter)',
      ';   I J          → arc center offsets (for G2/G3)',
      ';   F            → feed rate (kept from original)',
      ';   S            → laser power / spindle speed (kept from original)',
      ';',
      '; Commands below show original values as reference comments.',
      '; Replace each line with your coordinates following the same pattern.',
      '; â”€â”€ Template body â”€â”€',
    ];
    commands.forEach(c => {
      if (c.isBlank) { lines.push(''); return; }
      if (c.isComment || c.type === 'COMMENT') { lines.push(c.raw); return; }
      if (c.type === 'UNKNOWN') { lines.push(c.raw); return; }
      const axisKeys = ['X','Y','Z','A','B','C','I','J'];
      const hasAxis = axisKeys.some(k => c.params[k] !== undefined);
      if (!hasAxis) { lines.push(c.raw); return; }
      // Show original as comment
      const origComment = '; Original: ' + c.raw;
      lines.push(origComment);
      // Build stripped command
      let stripped = c.type;
      for (const [k, v] of Object.entries(c.params)) {
        if (axisKeys.includes(k)) {
          stripped += ' ' + k;
        } else {
          stripped += ' ' + k + (Number.isInteger(v) ? v : parseFloat(v.toFixed(4)));
        }
      }
      if (c.comment) stripped += ' ; ' + c.comment;
      lines.push(stripped);
    });
    return lines.join('\n');
  },

  // Download template as .gcode file
  downloadTemplate(name, content) {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: name + '.gcode' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};

