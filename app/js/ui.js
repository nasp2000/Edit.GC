// ---- uiController --------------------------------------------------------------------------------------------
const ui = {
  init() {
    // Abrir G-code
    document.getElementById('fileInputGcode').addEventListener('change', async e => {
      const file = e.target.files[0]; if (!file) return;
      e.target.value = '';
      ui.clearState(); // permite reabrir o mesmo ficheiro
      ui.setProgress(2, 'Reading file…');
      const text = await fileManager.readGcode(file);
      ui.setProgress(30, 'Parsing…');
      state.originalCmds  = gcodeParser.parse(text);
      ui.setProgress(50, 'Preparing editor…');
      const isLarge = text.length > 5 * 1024 * 1024 || state.originalCmds.length > 50000;
      const isHuge = text.length > 50 * 1024 * 1024;
      state.originalText  = isLarge ? '' : text;
      state.originalName  = file.name;
      state.workingCmds   = state.originalCmds.map(c => ({ ...c }));
      if (state.originalCmds.length > 50000) state.originalCmds = [];
      state.dirty         = false;
      // reset zoom/pan para auto-fit ao novo ficheiro
      state.previewScale  = 1;
      state.previewOffX   = 0;
      state.previewOffY   = 0;
      const editorText = isLarge ? '(original text too large for editor)' : truncateForEditor(text);
      document.getElementById('editorOriginal').value = editorText;
      document.getElementById('editorWorking').value = editorText;
      ui.setProgress(70, 'Applying syntax highlight…');
      const hlText = isLarge ? '' : text;
      applyHighlight(document.getElementById('highlightOriginal'), hlText);
      applyHighlight(document.getElementById('highlightWorking'), hlText);
      ui.setProgress(90, 'Rendering…');
      preview.resize(); // garante dimensÃµes do canvas e faz draw
      preview.fitView(); // centra e ajusta o toolpath Ã  vista (top-down)
      // Check for unknown commands
      const analysis = gcodeParser.analyzeFull(state.workingCmds);
      let statusMsg = `Opened: ${file.name} (${state.workingCmds.length} lines)`;
      if (analysis.unknownCmds.length) {
        statusMsg += `   !  Unknown: ${analysis.unknownCmds.join(', ')}`;
      }
      ui.setProgress(100, 'Done');
      setTimeout(() => ui.setProgress(-1), 1000);
      ui.setStatus(statusMsg);
      ui.syncModals();
      ui.updateFooterInfo();
      recentFiles.add(file.name, 'G-code', text);
      const _rs = document.getElementById('recentFilesSelect');
      if (_rs) recentFiles.populateSelect(_rs);
      document.getElementById('btnConvertSvg').disabled = true;
      document.getElementById('btnConvertDxf').disabled = true;
    });

    // ---- Preview playback buttons (main + modal) ----
    const _speedSteps = [1, 2, 5, 10, 20, 50, 100];
    let _speedIdx = 0;
    const _updateSpeedUI = () => {
      const v = _speedSteps[_speedIdx];
      document.getElementById('playSpeed').value       = v;
      document.getElementById('mPlaySpeed').value       = v;
      document.getElementById('playSpeedLabel').textContent  = v + 'x';
      document.getElementById('mPlaySpeedLabel').textContent = v + 'x';
    };
    document.getElementById('btnSpeedDown').addEventListener('click', () => {
      if (_speedIdx > 0) { _speedIdx--; _updateSpeedUI(); }
    });
    document.getElementById('btnSpeedUp').addEventListener('click', () => {
      if (_speedIdx < _speedSteps.length - 1) { _speedIdx++; _updateSpeedUI(); }
    });
    document.getElementById('mBtnSpeedDown').addEventListener('click', () => {
      if (_speedIdx > 0) { _speedIdx--; _updateSpeedUI(); }
    });
    document.getElementById('mBtnSpeedUp').addEventListener('click', () => {
      if (_speedIdx < _speedSteps.length - 1) { _speedIdx++; _updateSpeedUI(); }
    });
    _updateSpeedUI();

    document.getElementById('btnPlay').addEventListener('click',   () => preview.play());
    document.getElementById('btnPause').addEventListener('click',  () => preview.pause());
    document.getElementById('btnStop').addEventListener('click',   () => preview.stop());
    document.getElementById('btnZoomFit').addEventListener('click', () => preview.fitView());
    document.getElementById('playProgress').addEventListener('input', function() {
      const cmds = state.workingCmds;
      const total = cmds ? cmds.length : 0;
      const idx = Math.round(parseInt(this.value) / 100 * total);
      if (preview._pb.active) preview.stop();
      preview._drawCore(cmds, idx);
      preview._drawHead(cmds, idx);
      document.getElementById('scrubInfo').textContent = `${idx}/${total}`;
    });
    document.getElementById('chkBounds').addEventListener('change', function() {
      previewOpts.showBounds = this.checked;
      preview.draw(state.workingCmds);
    });
    document.getElementById('chkColorByFeed').addEventListener('change', function() {
      previewOpts.colorByFeed = this.checked;
      preview.draw(state.workingCmds);
    });
    document.getElementById('chkCompare').addEventListener('change', function() {
      previewOpts.compareMode = this.checked;
      if (this.checked) preview.buildOriginal();
      else preview.draw(state.workingCmds);
    });
    document.getElementById('chkMinimap').addEventListener('change', function() {
      previewOpts.showMinimap = this.checked;
      preview.draw(state.workingCmds);
    });
    document.getElementById('chkRapids').addEventListener('change', function() {
      state.showRapids = this.checked;
      preview.draw(state.workingCmds);
    });
    document.getElementById('scaleStep').addEventListener('change', function() {
      const v = parseFloat(this.value);
      document.getElementById('resizeW').step = v;
      document.getElementById('resizeH').step = v;
    });
    document.getElementById('batchStep').addEventListener('change', function() {
      const v = parseFloat(this.value);
      document.getElementById('batchAxisVal').step = v;
    });
    document.getElementById('originStep').addEventListener('change', function() {
      const v = parseFloat(this.value);
      ['X','Y','Z','A','B','C','E1'].forEach(a => {
        document.getElementById('origin' + a).step = v;
      });
      document.getElementById('originOffX').step = v;
      document.getElementById('originOffY').step = v;
      document.getElementById('originOffZ').step = v;
    });
    // Apply default step values on init
    const _initStep = (id, targets) => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const v = parseFloat(sel.value);
      targets.forEach(t => { const e = document.getElementById(t); if (e) e.step = v; });
    };
    _initStep('scaleStep', ['resizeW','resizeH']);
    _initStep('batchStep', ['batchAxisVal']);
    _initStep('pointsStep', ['pointsOffsetX','pointsOffsetY']);
    _initStep('originStep', ['originX','originY','originZ','originA','originB','originC','originE1','originOffX','originOffY','originOffZ']);
    // Recent files select
    const _recentSel = document.getElementById('recentFilesSelect');
    if (_recentSel) {
      recentFiles.populateSelect(_recentSel);
      _recentSel.addEventListener('change', function() {
        const name = this.value;
        if (!name) return;
        const list = recentFiles.list();
        const entry = list.find(f => f.name === name);
        if (entry && entry.content) {
          const file = new File([entry.content], entry.name, { type: 'text/plain' });
          const dt = new DataTransfer();
          dt.items.add(file);
          const input = document.getElementById('fileInputGcode');
          if (input) { input.files = dt.files; input.dispatchEvent(new Event('change')); }
        } else {
          document.getElementById('fileInputGcode').click();
        }
        this.selectedIndex = 0;
      });
    }
    document.getElementById('chkHideOriginal').addEventListener('change', function() {
      const pane = document.getElementById('pane-original');
      const tab = document.querySelector('.editor-tab[data-tab="original"]');
      if (this.checked) {
        pane.style.display = 'none';
        if (tab) tab.style.display = 'none';
      } else {
        pane.style.display = '';
        if (tab) tab.style.display = '';
      }
    });
    document.getElementById('mBtnPlay').addEventListener('click',  () => preview.play());
    document.getElementById('mBtnPause').addEventListener('click', () => preview.pause());
    document.getElementById('mBtnStop').addEventListener('click',  () => preview.stop());

    // Modal find/replace
    const modalFind = window.modalFind = {
      _matches: [], _idx: -1,
      get el() { return document.getElementById('editorWorkingModal'); },
      get bar() { return document.getElementById('mFindReplaceBar'); },
      open() {
        const bar = this.bar; if (!bar) return;
        bar.style.display = 'flex';
        const inp = document.getElementById('mFindInput');
        if (inp) { inp.focus(); inp.select(); }
        const ta = this.el;
        if (ta && ta.selectionStart !== ta.selectionEnd) {
          inp.value = ta.value.substring(ta.selectionStart, ta.selectionEnd);
          this.search(inp.value);
        }
      },
      close() { const b = this.bar; if (b) b.style.display = 'none'; this._matches = []; this._idx = -1; },
      search(q) {
        this._matches = []; this._idx = -1;
        const cnt = document.getElementById('mFindCount');
        if (!q) { cnt.textContent = '0/0'; return; }
        const ta = this.el; if (!ta) return;
        const text = ta.value; if (!text) { cnt.textContent = '0/0'; return; }
        const isRegex = document.getElementById('mFindRegex').checked;
        const isCase = document.getElementById('mFindCase').checked;
        let pattern;
        try {
          const flags = 'g' + (isCase ? '' : 'i');
          const src = isRegex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          pattern = new RegExp(src, flags);
        } catch (_) { cnt.textContent = '0/0'; return; }
        let m;
        while ((m = pattern.exec(text)) !== null) { this._matches.push({ index: m.index, length: m[0].length }); if (this._matches.length > 10000) break; }
        if (this._matches.length) this._idx = 0;
        cnt.textContent = this._matches.length + '/' + this._matches.length;
        this._scroll();
      },
      _scroll() {
        if (this._idx < 0 || !this._matches.length) return;
        const m = this._matches[this._idx];
        const ta = this.el; if (!ta) return;
        ta.focus();
        ta.selectionStart = m.index; ta.selectionEnd = m.index + m.length;
        const lines = ta.value.substring(0, m.index).split('\n');
        const line = lines.length;
        const lineH = 19.2;
        ta.scrollTop = Math.max(0, (line - 5) * lineH);
      },
      findNext() {
        if (!this._matches.length) return;
        this._idx = (this._idx + 1) % this._matches.length;
        document.getElementById('mFindCount').textContent = (this._idx + 1) + '/' + this._matches.length;
        this._scroll();
      },
      findPrev() {
        if (!this._matches.length) return;
        this._idx = (this._idx - 1 + this._matches.length) % this._matches.length;
        document.getElementById('mFindCount').textContent = (this._idx + 1) + '/' + this._matches.length;
        this._scroll();
      },
      replace() {
        if (this._idx < 0 || !this._matches.length) return;
        const ta = this.el; if (!ta) return;
        const m = this._matches[this._idx];
        const rep = document.getElementById('mReplaceInput').value;
        const before = ta.value.substring(0, m.index);
        const after = ta.value.substring(m.index + m.length);
        ta.value = before + rep + after;
        this._matches.splice(this._idx, 1);
        if (this._idx >= this._matches.length) this._idx = this._matches.length - 1;
        document.getElementById('mFindCount').textContent = (this._idx + 1) + '/' + this._matches.length;
      },
      replaceAll() {
        const ta = this.el; if (!ta) return;
        const rep = document.getElementById('mReplaceInput').value;
        for (let i = this._matches.length - 1; i >= 0; i--) {
          const m = this._matches[i];
          const before = ta.value.substring(0, m.index);
          const after = ta.value.substring(m.index + m.length);
          ta.value = before + rep + after;
        }
        this._matches = []; this._idx = -1;
        document.getElementById('mFindCount').textContent = '0/0';
      }
    };
    // Wire modal find buttons
    const _m = (id, fn) => { const e = document.getElementById(id); if (e) e.addEventListener('click', () => fn()); };
    _m('mBtnFindNext', () => modalFind.findNext());
    _m('mBtnFindPrev', () => modalFind.findPrev());
    _m('mBtnReplace', () => { modalFind.replace(); modalFind.search(document.getElementById('mFindInput').value); });
    _m('mBtnReplaceAll', () => modalFind.replaceAll());
    _m('mBtnFindClose', () => modalFind.close());
    const mFindInp = document.getElementById('mFindInput');
    if (mFindInp) {
      mFindInp.addEventListener('input', function() { modalFind.search(this.value); });
      mFindInp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); modalFind.findNext(); } });
    }
    const mRepInp = document.getElementById('mReplaceInput');
    if (mRepInp) mRepInp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); modalFind.replace(); modalFind.search(document.getElementById('mFindInput').value); } });

    // Widget maximize
    document.querySelectorAll('.widget-maximize').forEach(btn => {
      btn.addEventListener('click', () => {
        const widget = btn.closest('.widget');
        if (!widget) return;
        const title = widget.querySelector('.widget-title span')?.textContent || 'Widget';
        const body = widget.querySelector('.widget-body');
        if (!body) return;
        document.getElementById('modalWidgetTitle').textContent = title;
        const target = document.getElementById('modalWidgetBody');
        target.innerHTML = '';
        const clone = body.cloneNode(true);
        // Remove the original step-corner (absolute positioned, not needed in modal)
        const sc = clone.querySelector('.step-corner');
        if (sc) sc.remove();
        target.appendChild(clone);
        openModal('modal-widget');
      });
    });
    // Keyboard shortcut for modal find
    document.addEventListener('keydown', e => {
      const modal = document.getElementById('modal-working');
      if (modal && modal.classList.contains('open') && (e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault(); modalFind.open();
      }
      if (modal && modal.classList.contains('open') && modalFind.bar && modalFind.bar.style.display !== 'none') {
        if (e.key === 'F3') { e.preventDefault(); e.shiftKey ? modalFind.findPrev() : modalFind.findNext(); }
        if (e.key === 'Enter') {
          const active = document.activeElement;
          if (active === document.getElementById('mFindInput')) { e.preventDefault(); modalFind.findNext(); }
          if (active === document.getElementById('mReplaceInput')) { e.preventDefault(); modalFind.replace(); modalFind.search(document.getElementById('mFindInput').value); }
        }
      }
    });

    // Abrir SVG
    document.getElementById('fileInputSvg').addEventListener('change', async e => {
      const file = e.target.files[0]; if (!file) return;
      e.target.value = '';
      const text = await fileManager.readGcode(file);

      // extrair dimensÃµes do viewBox / width+height
      let dimW = 100, dimH = 100;
      try {
        const parser = new DOMParser();
        const doc    = parser.parseFromString(text, 'image/svg+xml');
        const svg    = doc.querySelector('svg');
        if (svg) {
          const vb = svg.getAttribute('viewBox');
          if (vb) {
            const parts = vb.trim().split(/[\s,]+/).map(Number);
            dimW = parts[2] || 100;
            dimH = parts[3] || 100;
          } else {
            dimW = parseFloat(svg.getAttribute('width'))  || 100;
            dimH = parseFloat(svg.getAttribute('height')) || 100;
          }
        }
      } catch (_) { /* dimensÃµes por defeito */ }

      state.svgDims = { width: dimW, height: dimH };
      state.svgText = text;
      state.svgSegments = null; // will be cached on first draw
      state.mode    = 'svg';

      // criar imagem a partir do blob SVG
      const blob = new Blob([text], { type: 'image/svg+xml' });
      const url  = URL.createObjectURL(blob);
      const img  = new Image();
      img.onload = () => {
        state.svgImg = img;
        URL.revokeObjectURL(url);
        state.previewScale = 1;
        state.previewOffX  = 0;
        state.previewOffY  = 0;
        document.getElementById('btnConvertSvg').disabled = false;
        document.getElementById('btnConvertDxf').disabled = true;
        // populate resize panel with SVG dimensions
        state.resizeBaseW = dimW;
        state.resizeBaseH = dimH;
        document.getElementById('resizeW').value = dimW.toFixed(3);
        document.getElementById('resizeH').value = dimH.toFixed(3);
        preview.resize();
        ui.setStatus(`SVG: ${file.name}  W: ${dimW.toFixed(1)} × H: ${dimH.toFixed(1)} — click "SVG → G-code" to convert`);
        recentFiles.add(file.name, 'SVG', text);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        ui.setStatus(`Error loading SVG: ${file.name}`, 'error');
      };
      img.src = url;
    });

    // SVG view mode toggle (outlines / raster)
    const _syncSvgView = el => {
      state.svgPreviewMode = el.value;
      preview.draw(state.workingCmds);
    };
    const _syncSvgViewEnabled = () => {
      // Always enabled — works for G-code, SVG, DXF
    };
    _syncSvgViewEnabled();
    document.getElementById('svgViewMode').addEventListener('change', e => {
      document.getElementById('svgViewModeModal').value = e.target.value;
      _syncSvgView(e.target);
    });
    document.getElementById('svgViewModeModal').addEventListener('change', e => {
      document.getElementById('svgViewMode').value = e.target.value;
      _syncSvgView(e.target);
    });

    // Open DXF
    document.getElementById('fileInputDxf').addEventListener('change', async e => {
      const file = e.target.files[0]; if (!file) return;
      e.target.value = '';
      const text = await fileManager.readGcode(file);
      const segments = dxfParser.parse(text, 1);
      if (!segments.length) { ui.setStatus('No entities found in DXF.', 'error'); return; }
      const all = segments.flat();
      const xs = all.map(p => p.x);
      const ys = all.map(p => p.y);
      const mmX4 = safeMinMax(xs), mmY4 = safeMinMax(ys);
      const minX = mmX4.min, maxX = mmX4.max, minY = mmY4.min, maxY = mmY4.max;
      const w = maxX - minX || 1, h = maxY - minY || 1;
      state.dxfSegments = segments;
      state.dxfText = text;
      state.dxfName = file.name;
      state.mode = 'dxf';
      state.previewScale = 1;
      state.previewOffX = 0;
      state.previewOffY = 0;
      state.resizeBaseW = w;
      state.resizeBaseH = h;
      document.getElementById('resizeW').value = w.toFixed(3);
      document.getElementById('resizeH').value = h.toFixed(3);
      document.getElementById('btnConvertDxf').disabled = false;
      document.getElementById('btnConvertSvg').disabled = true;
      preview.draw();
      ui.setStatus(`DXF: ${file.name} — ${segments.length} segments, ${all.length} points`);
    });

    // Convert DXF → G-code
    document.getElementById('btnConvertDxf').addEventListener('click', () => {
      if (!state.dxfSegments || !state.dxfSegments.length) { ui.setStatus('No DXF loaded.', 'error'); return; }
      try {
        ui.setStatus('Converting DXF…');
        ui.setProgress(5, 'Converting DXF…');
        const cmds = svgConverter.segmentsToGcode(state.dxfSegments, state.template);
        const tw = parseFloat(document.getElementById('resizeW').value);
        const th = parseFloat(document.getElementById('resizeH').value);
        const all = state.dxfSegments.flat();
        const xs = all.map(p => p.x);
        const ys = all.map(p => p.y);
        const mmX5 = safeMinMax(xs), mmY5 = safeMinMax(ys);
        const curW = mmX5.max - mmX5.min || 1;
        const curH = mmY5.max - mmY5.min || 1;
        let finalCmds = cmds;
        if (tw && th && (Math.abs(tw - curW) > 0.001 || Math.abs(th - curH) > 0.001)) {
          const fx = tw / curW, fy = th / curH;
          finalCmds = Math.abs(fx - fy) < 0.0001
            ? gcodeParser.scaleCommands(cmds, fx)
            : gcodeParser.scaleCommandsXY(cmds, fx, fy);
        }
        const gcode = gcodeParser.serialize(finalCmds);
        const baseName = (state.dxfName || 'output').replace(/\.dxf$/i, '') + '.gcode';
        undoRedo.push(state.workingCmds);
        state.workingCmds = finalCmds;
        state.originalCmds = finalCmds.map(c => ({ ...c }));
        state.originalText = gcode.length > 5 * 1024 * 1024 ? '' : gcode;
        state.originalName = baseName;
        state.dirty = false;
        state.mode = 'gcode';
        state.previewScale = 1;
        state.previewOffX = 0;
        state.previewOffY = 0;
        document.getElementById('editorOriginal').value = gcode;
        ui._updateWorkingEditor(gcode);
        applyHighlight(document.getElementById('highlightOriginal'), gcode);
        applyHighlight(document.getElementById('highlightWorking'), gcode);
        ui.setProgress(90, 'Rendering…');
        preview.draw(state.workingCmds);
        ui.syncModals();
        ui.updateFooterInfo();
        const cutLines = finalCmds.filter(c => c.type === 'G1' || c.type === 'G01').length;
        ui.setProgress(100, 'Done');
        setTimeout(() => ui.setProgress(-1), 1200);
        ui.setStatus(`DXF converted: ${cutLines} cut moves Â· ${finalCmds.length} lines Â· "${baseName}"`);
      } catch (err) {
        ui.setProgress(-1);
        ui.setStatus(`DXF conversion error: ${err.message}`, 'error');
      }
    });

    // Convert SVG → G-code
    document.getElementById('btnConvertSvg').addEventListener('click', () => {
      if (!state.svgText) { ui.setStatus('No SVG loaded.', 'error'); return; }
      try {
        ui.setStatus('Converting SVG…');
        ui.setProgress(5, 'Parsing SVG…');
        const cmds    = svgConverter.convert(state.svgText, state.template);
        ui.setProgress(70, 'Applying resize…');
        // apply resize if different from original SVG dims
        const tw = parseFloat(document.getElementById('resizeW').value);
        const th = parseFloat(document.getElementById('resizeH').value);
        const svgW = state.svgDims?.width  || 0;
        const svgH = state.svgDims?.height || 0;
        let finalCmds = cmds;
        if (svgW && svgH && tw && th) {
          const fx = tw / svgW, fy = th / svgH;
          if (Math.abs(fx - 1) > 0.0001 || Math.abs(fy - 1) > 0.0001) {
            finalCmds = (Math.abs(fx - fy) < 0.0001)
              ? gcodeParser.scaleCommands(cmds, fx)
              : gcodeParser.scaleCommandsXY(cmds, fx, fy);
          }
        }
        const gcode = gcodeParser.serialize(finalCmds);
        const baseName = (state.originalName || 'output').replace(/\.svg$/i, '') + '.gcode';

        undoRedo.push(state.workingCmds);
        state.workingCmds  = finalCmds;
        state.originalCmds = finalCmds.map(c => ({ ...c }));
        state.originalText = gcode.length > 5 * 1024 * 1024 ? '' : gcode;
        state.originalName = baseName;
        state.dirty        = false;
        state.mode         = 'gcode';
        state.svgImg       = null;
        state.previewScale = 1;
        state.previewOffX  = 0;
        state.previewOffY  = 0;

        document.getElementById('editorOriginal').value = gcode;
        ui._updateWorkingEditor(gcode);
        applyHighlight(document.getElementById('highlightOriginal'), gcode);
        applyHighlight(document.getElementById('highlightWorking'), gcode);
    document.getElementById('btnConvertSvg').disabled = true;
    document.getElementById('btnConvertDxf').disabled = true;

        const cutLines = cmds.filter(c => c.type === 'G1' || c.type === 'G01').length;
        const analysis = gcodeParser.analyzeFull(finalCmds);
        let statusMsg = `Converted: ${cutLines} cut moves Â· ${cmds.length} lines Â· "${baseName}"`;
        if (analysis.unknownCmds.length) {
          statusMsg += `   !  Unknown: ${analysis.unknownCmds.join(', ')}`;
        }
        ui.setProgress(90, 'Rendering…');
        preview.resize();
        ui.syncModals();
        ui.setProgress(100, 'Done');
        setTimeout(() => ui.setProgress(-1), 1200);
        ui.setStatus(statusMsg);
      } catch (err) {
        ui.setProgress(-1);
        ui.setStatus(`Conversion error: ${err.message}`, 'error');
      }
    });

    // Salvar
    document.getElementById('btnSave').addEventListener('click', () => {
      if (!state.workingCmds.length) { ui.setStatus('Nothing to save.', 'error'); return; }
      const ext  = (state.templateMeta && state.templateMeta.ext)
        ? state.templateMeta.ext
        : (state.originalName ? state.originalName.split('.').pop() : 'gcode');
      const base = state.originalName ? state.originalName.replace(/\.[^.]+$/, '') : 'output';
      const cmds = _getSaveCommands();
      fileManager.downloadGcode(gcodeParser.serialize(cmds), `${base}.${ext}`);
      state.dirty = false;
      ui.setStatus(`Saved: ${base}.${ext}${cmds !== state.workingCmds ? ' (mark applied)' : ''}`);
    });

    // Salvar como (nativo)
    document.getElementById('btnSaveAs').addEventListener('click', async () => {
      if (!state.workingCmds.length) { ui.setStatus('Nothing to save.', 'error'); return; }
      const ext  = (state.templateMeta && state.templateMeta.ext)
        ? state.templateMeta.ext
        : 'gcode';
      const defaultName = state.originalName ? state.originalName.replace(/\.[^.]+$/, '') : 'output';
      const content = gcodeParser.serialize(state.workingCmds);
      // File System Access API (nativo)
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: defaultName + '.' + ext,
          types: [{
            description: 'G-code files',
            accept: { 'text/plain': ['.gcode','.nc','.gc','.cnc','.tap','.txt'] }
          }]
        });
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        state.dirty = false;
        ui.setStatus(`Saved: ${handle.name}`);
      } catch (err) {
        if (err.name === 'AbortError') return; // user cancelled
        // fallback: download simple
        fileManager.downloadGcode(content, defaultName + '.' + ext);
        state.dirty = false;
        ui.setStatus(`Saved: ${defaultName}.${ext}`);
      }
    });

    // Export G-code → SVG / DXF
    document.getElementById('btnExportSvg').addEventListener('click', () => {
      if (!state.workingCmds.length) { ui.setStatus('No G-code loaded.', 'error'); return; }
      exportTools.exportSvg(state.workingCmds);
      ui.setStatus('Exported SVG.');
    });
    document.getElementById('btnExportDxf').addEventListener('click', () => {
      if (!state.workingCmds.length) { ui.setStatus('No G-code loaded.', 'error'); return; }
      exportTools.exportDxf(state.workingCmds);
      ui.setStatus('Exported DXF.');
    });

    // Undo / Redo
    document.getElementById('btnUndo').addEventListener('click', () => {
      state._duringUndoRedo = true;
      const prev = undoRedo.undo();
      if (prev) { state.workingCmds = prev; ui.refreshWorking(); }
      state._duringUndoRedo = false;
    });
    document.getElementById('btnRedo').addEventListener('click', () => {
      state._duringUndoRedo = true;
      const next = undoRedo.redo();
      if (next) { state.workingCmds = next; ui.refreshWorking(); }
      state._duringUndoRedo = false;
    });
    document.addEventListener('keydown', e => {
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z') { document.getElementById('btnUndo').click(); }
      if (e.ctrlKey && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { document.getElementById('btnRedo').click(); }
      if (e.ctrlKey && e.key === 's') { e.preventDefault(); document.getElementById('btnSave').click(); }
    });

    // Reset
    document.getElementById('btnReset').addEventListener('click', () => {
      if (!state.originalCmds.length) {
        ui.setStatus('No original to reset to.', 'error');
        return;
      }
      if (state.dirty && !confirm('Reset to original? This will discard all changes.')) return;
      undoRedo.push(state.workingCmds);
      state.workingCmds = state.originalCmds.map(c => ({ ...c }));
      state.dirty = false;
      ui.refreshWorking();
      ui.setStatus('Reset to original.');
    });

    // ---- Scale widget ------------------------------------------------------------------------------------
    const _getBounds = () => preview._getBounds(state.workingCmds);

    const _syncHfromW = () => {
      const w = parseFloat(document.getElementById('resizeW').value);
      if (!w || !state.resizeBaseW) return;
      const ratio = state.resizeBaseH / state.resizeBaseW;
      document.getElementById('resizeH').value = (w * ratio).toFixed(3);
    };
    const _syncWfromH = () => {
      const h = parseFloat(document.getElementById('resizeH').value);
      if (!h || !state.resizeBaseH) return;
      const ratio = state.resizeBaseW / state.resizeBaseH;
      document.getElementById('resizeW').value = (h * ratio).toFixed(3);
    };

    document.getElementById('resizeW').addEventListener('change', _syncHfromW);
    document.getElementById('resizeH').addEventListener('change', _syncWfromH);

    const _btnScaleUp = document.getElementById('btnScaleUp');
    if (_btnScaleUp) _btnScaleUp.addEventListener('click', () => {
      const step = parseFloat(document.getElementById('scaleStep').value) || 1;
      const w = parseFloat(document.getElementById('resizeW').value);
      const h = parseFloat(document.getElementById('resizeH').value);
      if (!w || !h) { ui.setStatus('No dimensions to adjust.', 'error'); return; }
      document.getElementById('resizeW').value = (w + step).toFixed(3);
      document.getElementById('resizeH').value = (h + step).toFixed(3);
    });
    const _btnScaleDown = document.getElementById('btnScaleDown');
    if (_btnScaleDown) _btnScaleDown.addEventListener('click', () => {
      const step = parseFloat(document.getElementById('scaleStep').value) || 1;
      const w = parseFloat(document.getElementById('resizeW').value);
      const h = parseFloat(document.getElementById('resizeH').value);
      if (!w || !h) { ui.setStatus('No dimensions to adjust.', 'error'); return; }
      document.getElementById('resizeW').value = Math.max(0.001, w - step).toFixed(3);
      document.getElementById('resizeH').value = Math.max(0.001, h - step).toFixed(3);
    });

    document.getElementById('btnApplyScale').addEventListener('click', () => {
      const tw = parseFloat(document.getElementById('resizeW').value);
      const th = parseFloat(document.getElementById('resizeH').value);
      if (!tw || !th) { ui.setStatus('Invalid dimensions.', 'error'); return; }
      // SVG mode: apply scale to preview
      if (state.mode === 'svg' && state.svgSegments) {
        const all = state.svgSegments.flat();
        const xs = all.map(p => p.x);
        const ys = all.map(p => p.y);
        const m1 = safeMinMax(xs), m2 = safeMinMax(ys);
        const curW = m1.max - m1.min || 1, curH = m2.max - m2.min || 1;
        state.svgScale = Math.min(tw / curW, th / curH);
        preview.draw(state.workingCmds);
        ui.setStatus(`SVG scaled: ${curW.toFixed(3)}×${curH.toFixed(3)} → ${tw.toFixed(3)}×${th.toFixed(3)} mm`);
        state.resizeBaseW = tw;
        state.resizeBaseH = th;
        return;
      }
      const b = _getBounds();
      if (!b || !b.rangeX || !b.rangeY) { ui.setStatus('No G-code loaded.', 'error'); return; }
      const fx = tw / b.rangeX, fy = th / b.rangeY;
      undoRedo.push(state.workingCmds);
      if (Math.abs(fx - fy) < 0.0001) {
        state.workingCmds = gcodeParser.scaleCommands(state.workingCmds, fx);
        ui.setStatus(`Resized: ${b.rangeX.toFixed(3)}×${b.rangeY.toFixed(3)} → ${tw.toFixed(3)}×${th.toFixed(3)} mm`);
      } else {
        state.workingCmds = gcodeParser.scaleCommandsXY(state.workingCmds, fx, fy);
        ui.setStatus(`Resized (non-uniform): W×${fx.toFixed(3)} H×${fy.toFixed(3)}`);
      }
      state.resizeBaseW = tw;
      state.resizeBaseH = th;
      ui.refreshWorking();
    });

    // ---- Template Widget ----------------------------------------------------------------------------------
    const templateSelector = document.getElementById('templateSelect');
    const btnImportTemplate = document.getElementById('btnImportTemplate');
    const fileInputTemplate = document.getElementById('fileInputTemplate');

    // Extract template from loaded G-code
    document.getElementById('btnExtractTemplate').addEventListener('click', async () => {
      if (!state.workingCmds.length) { ui.setStatus('Open a G-code file first.', 'error'); return; }
      const name = prompt('Template name:', state.originalName ? state.originalName.replace(/\.[^.]+$/, '') : 'template');
      if (!name) return;
      const data = templateManager.extractFromCommands(state.workingCmds, state.originalText, state.originalName);
      data.name = name;
      const ok = await templateManager.saveTemplate(name, data);
      if (ok) {
        ui.refreshTemplateList();
        templateSelector.value = name;
        templateManager.setActive(name);
        ui.updateTemplateIndicator();
        ui.setStatus(`Template "${name}" extracted. Custom: ${data.customCommands.join(', ') || 'none'}. Laser: ${data.laserOnCmd || '?'}/${data.laserOffCmd || '?'}.`);
      } else {
        ui.setStatus('Error saving template. Open a templates folder first.', 'error');
      }
    });

    // Apply: set active template (affects save/refresh/export)
    document.getElementById('btnApplyTemplate').addEventListener('click', () => {
      const name = templateSelector.value;
      if (!name) { ui.setStatus('Select a template first.', 'error'); return; }
      const tpl = templateManager.getTemplate(name);
      if (!tpl) { ui.setStatus('Template not found.', 'error'); return; }
      templateManager.setActive(name);
      state.templateMeta = { ext: tpl.data.ext, lineEnd: tpl.data.lineEnd };
      ui.updateTemplateIndicator();
      const t = tpl.data;
      ui.setStatus(`Template "${name}" active. Ext: .${t.ext}, Laser: ${t.laserOnCmd || '?'}/${t.laserOffCmd || '?'}, Tools: ${t.toolCodes.join(', ') || 'none'}.`);
    });

    // Template select change
    templateSelector.addEventListener('change', e => {
      const name = e.target.value;
      if (name) {
        templateManager.setActive(name);
        const tpl = templateManager.getTemplate(name);
        if (tpl) state.templateMeta = { ext: tpl.data.ext, lineEnd: tpl.data.lineEnd };
      } else {
        templateManager.setActive(null);
        state.templateMeta = null;
      }
      ui.updateTemplateIndicator();
    });

    // Import template from file(s) outside the templates folder
    if (btnImportTemplate && fileInputTemplate) {
      btnImportTemplate.addEventListener('click', async () => {
        if (!templateManager._dirHandle) {
          await templateManager._ensureDir();
        }
        fileInputTemplate.click();
      });
      fileInputTemplate.addEventListener('change', async e => {
        const files = [...e.target.files];
        e.target.value = '';
        if (!files.length) return;
        if (!templateManager._dirHandle) {
          const ok = await templateManager._ensureDir();
          if (!ok) { ui.setStatus('Open a templates folder first to save imported templates.', 'error'); return; }
        }
        let count = 0;
        for (const file of files) {
          try {
            await templateManager.importFromFile(file);
            count++;
          } catch (_) {}
        }
        await templateManager.scan();
        ui.refreshTemplateList();
        ui.setStatus(`Imported ${count} template(s) into templates folder.`);
      });
    }

    // Open templates folder in system explorer
    document.getElementById('btnOpenTemplatesFolder').addEventListener('click', async () => {
      if (templateManager._dirHandle) {
        try {
          const root = await templateManager._dirHandle.getDirectoryHandle('..');
          const iter = root.values();
          const first = await iter.next();
        } catch (_) {}
      }
      await templateManager.openFolder();
    });

    // Working editor → sync state (debounced)
    let _editTimer = null;
    ui._isRefreshing = false;
    const _onWorkingInput = (rawText) => {
      if (ui._isRefreshing) return;
      if (_editTimer) clearTimeout(_editTimer);
      _editTimer = setTimeout(() => {
        if (!state._duringUndoRedo) {
          undoRedo.push(state.workingCmds);
        }
        state.workingCmds = gcodeParser.parse(rawText);
        state._boundsCache = null;
        state.dirty = true;
        preview.draw(state.workingCmds);
        ui.syncModals();
        ui.updateFooterInfo();
        ui.updateResizePanel();
        if (document.getElementById('chkTagEdits').checked && state.originalCmds && state.originalCmds.length) {
          const ta = document.getElementById('editorWorking');
          if (ta && ta.style.display !== 'none') {
            const curLines = rawText.split('\n');
            const origLines = state.originalText ? state.originalText.split('\n') : [];
            let changed = false;
            const tagged = curLines.map((line, i) => {
              const clean = line.replace(/\s*;edit\.gc\s*$/, '');
              const orig = i < origLines.length ? origLines[i] : undefined;
              if (orig === undefined || clean.trim() !== orig.trim()) {
                if (!line.includes(';edit.gc')) { changed = true; return clean.trimEnd() + '  ;edit.gc'; }
              }
              return line;
            });
            if (changed) {
              const pos = ta.selectionStart;
              const oldLen = rawText.length;
              ui._isRefreshing = true;
              ta.value = tagged.join('\n');
              ta.selectionStart = ta.selectionEnd = pos + (ta.value.length - oldLen);
              ui._isRefreshing = false;
              applyHighlight(document.getElementById('highlightWorking'), ta.value);
            }
          }
        }
      }, 300);
    };
    document.getElementById('editorWorking').addEventListener('input', e => {
      applyHighlight(document.getElementById('highlightWorking'), e.target.value);
      _onWorkingInput(e.target.value);
    });
    document.getElementById('editorWorkingModal').addEventListener('input', e => {
      const text = e.target.value;
      // Sync state + preview directly. Do NOT call _updateWorkingEditor here:
      // for large files it would swap the main editor to the (truncated) modal text.
      state.workingCmds = gcodeParser.parse(text);
      state._boundsCache = null;
      state.dirty = true;
      preview.draw(state.workingCmds);
      applyHighlight(document.getElementById('highlightWorkingModal'), text);
      ui.updateFooterInfo();
      ui.updateResizePanel();
    });

    // ---- Recent Files ----------------------------------------------------------------------------------------
    // (recent files tracking kept for history; UI removed)

    // ---- Origin ----------------------------------------------------------------------------------------------------
    document.getElementById('btnApplyOrigin').addEventListener('click', () => {
      if (!state.workingCmds.length) { ui.setStatus('No G-code loaded.', 'error'); return; }
      const axes = ['X','Y','Z','A','B','C'];
      const offsets = {};
      for (const a of axes) {
        const v = parseFloat(document.getElementById('origin' + a).value);
        if (v) offsets[a] = -v;
      }
      const e1 = parseFloat(document.getElementById('originE1').value);
      if (e1) offsets.E1 = -e1;
      undoRedo.push(state.workingCmds);
      state.workingCmds = gcodeParser.applyOffset(state.workingCmds, offsets);
      ui.refreshWorking();
      preview.originX = 0;
      preview.originY = 0;
      for (const a of axes) document.getElementById('origin' + a).value = '0';
      document.getElementById('originE1').value = '0';
      const parts = Object.keys(offsets).map(k => `${k}${-offsets[k]}`).join(' ');
      ui.setStatus(`Origin offset applied: ${parts} → 0`);
    });

    // Fine offset buttons
    document.getElementById('btnApplyOffsets').addEventListener('click', () => {
      if (!state.workingCmds.length) { ui.setStatus('No G-code loaded.', 'error'); return; }
      const dx = parseFloat(document.getElementById('originOffX').value) || 0;
      const dy = parseFloat(document.getElementById('originOffY').value) || 0;
      const dz = parseFloat(document.getElementById('originOffZ').value) || 0;
      if (!dx && !dy && !dz) { ui.setStatus('No offset to apply.', 'error'); return; }
      undoRedo.push(state.workingCmds);
      state.workingCmds = gcodeParser.applyOffset(state.workingCmds, { X: dx, Y: dy, Z: dz });
      ui.refreshWorking();
      document.getElementById('originOffX').value = '0';
      document.getElementById('originOffY').value = '0';
      document.getElementById('originOffZ').value = '0';
      let msg = 'Fine offset applied:';
      if (dx) msg += ` X${dx >= 0 ? '+' : ''}${dx}`;
      if (dy) msg += ` Y${dy >= 0 ? '+' : ''}${dy}`;
      if (dz) msg += ` Z${dz >= 0 ? '+' : ''}${dz}`;
      ui.setStatus(msg);
    });

    const _getSaveCommands = () => {
      return state.workingCmds;
    };

    // ---- Generate Updated G-code ----------------------------------------------------------------------
    
    document.getElementById('btnBatchApply').addEventListener('click', () => {
      if (!state.workingCmds.length) { ui.setStatus('No G-code loaded.', 'error'); return; }
      const axis = document.getElementById('batchAxis').value;
      const val = parseFloat(document.getElementById('batchAxisVal').value);
      if (!val) { ui.setStatus('Enter a non-zero value.', 'error'); return; }
      const fromStr = document.getElementById('batchFrom').value.trim();
      const toStr = document.getElementById('batchTo').value.trim();
      const from = fromStr !== '' ? parseInt(fromStr) : -1;
      const to = toStr !== '' ? parseInt(toStr) : -1;
      if (from >= 0 && to >= 0 && from > to) {
        ui.setStatus('From line must be â‰¤ To line.', 'error'); return;
      }
      undoRedo.push(state.workingCmds);
      state.workingCmds = state.workingCmds.map((c, i) => {
        const inRange = from < 0 || to < 0 || (i >= from && i <= to);
        if (!inRange) return c;
        if (c.params[axis] === undefined) return c;
        const p = { ...c.params };
        p[axis] = parseFloat((p[axis] - val).toFixed(4));
        return { ...c, params: p, raw: '' };
      });
      ui.refreshWorking();
      ui.setStatus(`Batch: ${axis} ${val >= 0 ? '-' : '+'}${Math.abs(val)} applied${from >= 0 ? ` to lines ${from}–${to}` : ''}.`);
    });

    // ---- Points Panel (second sidebar) -----------------------------------------------------------
    ui._pointsPanelOpen = false;
    ui._markStartIdx = 0;
    ui._pointsSide = null;
    ui._pointsList = [];
    ui._focusedPointPos = -1; // index in _pointsList

    ui._focusPoint = (pos) => {
      const list = ui._pointsList;
      if (!list.length) return;
      if (pos < 0) pos = 0;
      if (pos >= list.length) pos = list.length - 1;
      ui._focusedPointPos = pos;
      const p = list[pos];
      state.selectedPoints.clear();
      state.selectedPoints.add(p.idx);
      document.getElementById('pointsOffsetX').value = '0';
      document.getElementById('pointsOffsetY').value = '0';
      document.getElementById('pointsOffsetZ').value = '0';
      preview.draw(state.workingCmds);
      ui._updatePointsPanel();
      preview.highlightLine(p.idx);
    };

    ui._buildPointsList = () => {
      const cmds = state.workingCmds;
      const segs = preview._segments;
      let points = [];
      if (segs && segs.length) {
        const visited = new Set();
        for (let i = 0; i < segs.length; i++) {
          const s = segs[i];
          if (visited.has(s.cmdIdx)) continue;
          visited.add(s.cmdIdx);
          points.push({ idx: s.cmdIdx, x: s.b.x, y: s.b.y, z: s.b.z || 0 });
        }
      } else {
        let cx = 0, cy = 0, cz = 0, isRel = false;
        cmds.forEach((c, i) => {
          if (c.type === 'G91') { isRel = true; return; }
          if (c.type === 'G90') { isRel = false; return; }
          if (c.params.X !== undefined) cx = isRel ? cx + c.params.X : c.params.X;
          if (c.params.Y !== undefined) cy = isRel ? cy + c.params.Y : c.params.Y;
          if (c.params.Z !== undefined) cz = isRel ? cz + c.params.Z : c.params.Z;
          if (c.params.X === undefined && c.params.Y === undefined && c.params.Z === undefined) return;
          points.push({ idx: i, x: cx, y: cy, z: cz });
        });
      }
      // Filter: keep first point always, then only points that moved from previous
      const filtered = [];
      let prevX = null, prevY = null, prevZ = null;
      points.forEach((p) => {
        if (prevX === null) {
          filtered.push(p);
          prevX = p.x; prevY = p.y; prevZ = p.z;
          return;
        }
        if (p.x !== prevX || p.y !== prevY || p.z !== prevZ) {
          filtered.push(p);
          prevX = p.x; prevY = p.y; prevZ = p.z;
        }
      });
      return filtered;
    };

    ui._updatePointsPanel = () => {
      if (!ui._pointsPanelOpen) return;
      const tbody = document.getElementById('pointsTableBody');
      const count = document.getElementById('pointsPanelCount');
      const points = ui._buildPointsList();
      ui._pointsList = points;
      if (!points.length) {
        tbody.innerHTML = '';
        count.textContent = '0 points';
        return;
      }
      count.textContent = `${points.length} points`;
      const frag = document.createDocumentFragment();
      points.forEach((p, pi) => {
        const tr = document.createElement('tr');
        const isFocused = pi === ui._focusedPointPos;
        const isMarkStart = p.idx === ui._markStartIdx;
        if (isFocused) tr.className = 'selected';
        tr.style.cursor = 'pointer';
        tr.dataset.pos = pi;
        let dist = '';
        if (pi > 0) {
          const prev = points[pi - 1];
          dist = Math.hypot(p.x - prev.x, p.y - prev.y).toFixed(3);
        }
        tr.innerHTML = `<td style="text-align:center${isMarkStart ? ';color:var(--accent2);font-weight:700' : ''}">${p.idx + 1}</td><td style="text-align:right">${p.x.toFixed(3)}</td><td style="text-align:right">${p.y.toFixed(3)}</td><td style="text-align:right">${p.z.toFixed(3)}</td><td style="text-align:right;color:var(--text-dim)">${dist}</td>`;
        tr.addEventListener('click', () => {
          ui._focusPoint(pi);
        });
        frag.appendChild(tr);
      });
      tbody.innerHTML = '';
      tbody.appendChild(frag);
      // re-highlight focused row
      if (ui._focusedPointPos >= 0 && ui._focusedPointPos < points.length) {
        const row = tbody.children[ui._focusedPointPos];
        if (row) { row.className = 'selected'; row.scrollIntoView({ block: 'nearest' }); }
      }
    };

    document.getElementById('btnMarkStart').addEventListener('click', () => {
      if (!state.selectedPoints.size) { ui.setStatus('Select a point first.', 'error'); return; }
      const idx = [...state.selectedPoints][0];
      ui._markStartIdx = idx;
      ui._updatePointsPanel();
      ui.setStatus(`Mark Start set to point ${idx + 1}`);
    });

    document.getElementById('btnLeftSide').addEventListener('click', () => {
      ui._pointsSide = ui._pointsSide === 'left' ? null : 'left';
      document.getElementById('btnLeftSide').style.background = ui._pointsSide === 'left' ? 'var(--accent2)' : '';
      document.getElementById('btnRightSide').style.background = '';
      ui.setStatus(ui._pointsSide === 'left' ? 'Left Side selected' : 'Side cleared');
    });
    document.getElementById('btnRightSide').addEventListener('click', () => {
      ui._pointsSide = ui._pointsSide === 'right' ? null : 'right';
      document.getElementById('btnRightSide').style.background = ui._pointsSide === 'right' ? 'var(--accent2)' : '';
      document.getElementById('btnLeftSide').style.background = '';
      ui.setStatus(ui._pointsSide === 'right' ? 'Right Side selected' : 'Side cleared');
    });

    document.getElementById('pointsStep').addEventListener('change', function() {
      const v = parseFloat(this.value);
      ['pointsOffsetX', 'pointsOffsetY', 'pointsOffsetZ'].forEach(id => {
        document.getElementById(id).step = v;
      });
    });

    document.getElementById('btnPointsRefresh').addEventListener('click', () => {
      preview.draw(state.workingCmds);
      ui._updatePointsPanel();
      ui.setStatus('Preview refreshed.');
    });

    document.getElementById('btnPointsDelete').addEventListener('click', () => {
      if (!state.workingCmds.length || !state.selectedPoints.size) {
        ui.setStatus('Select points on preview first.', 'error'); return;
      }
      if (!confirm(`Delete ${state.selectedPoints.size} selected point(s)?`)) return;
      undoRedo.push(state.workingCmds);
      const keep = state.workingCmds.filter((_, i) => !state.selectedPoints.has(i));
      const deleted = state.workingCmds.length - keep.length;
      state.workingCmds = keep;
      state.selectedPoints.clear();
      preview._updatePointsInfo();
      ui.refreshWorking();
      ui._updatePointsPanel();
      ui.setStatus(`Deleted ${deleted} point(s).`);
    });

    document.getElementById('chkStartStop').addEventListener('change', e => {
      document.getElementById('toggleStartStopLabel').textContent = e.target.checked ? 'Start/Stop' : 'Continuous';
    });

    document.getElementById('btnPointsGenerate').addEventListener('click', () => {
      if (!state.workingCmds.length || !state.selectedPoints.size) {
        ui.setStatus('Select points on preview first.', 'error'); return;
      }
      const dx = parseFloat(document.getElementById('pointsOffsetX').value) || 0;
      const dy = parseFloat(document.getElementById('pointsOffsetY').value) || 0;
      const dz = parseFloat(document.getElementById('pointsOffsetZ').value) || 0;
      const isStartStop = document.getElementById('chkStartStop').checked;
      undoRedo.push(state.workingCmds);
      const sorted = [...state.selectedPoints].sort((a, b) => a - b);
      const result = [];
      for (let i = 0; i < state.workingCmds.length; i++) {
        result.push(state.workingCmds[i]);
        if (sorted.includes(i)) {
          const c = state.workingCmds[i];
          const copy = JSON.parse(JSON.stringify(c));
          if (copy.params.X !== undefined) copy.params.X = parseFloat((copy.params.X + dx).toFixed(4));
          if (copy.params.Y !== undefined) copy.params.Y = parseFloat((copy.params.Y + dy).toFixed(4));
          if (copy.params.Z !== undefined) copy.params.Z = parseFloat((copy.params.Z + dz).toFixed(4));
          copy.raw = '';
          if (isStartStop) {
            const pat = ui._detectLaserPatterns();
            result.push({ lineIndex: -1, raw: pat.on, type: pat.on, params: {}, comment: '', isBlank: false, isComment: false });
            result.push(copy);
            result.push({ lineIndex: -1, raw: pat.off, type: pat.off, params: {}, comment: '', isBlank: false, isComment: false });
          } else {
            result.push(copy);
          }
        }
      }
      state.workingCmds = result;
      state.selectedPoints.clear();
      preview._updatePointsInfo();
      ui.refreshWorking();
      ui._updatePointsPanel();
      ui.setStatus(`Added ${sorted.length} point(s) offset X:${dx} Y:${dy} Z:${dz}${isStartStop ? ' (Start/Stop)' : ''}.`);
    });

    document.getElementById('btnTogglePointsPanel').addEventListener('click', () => {
      ui._pointsPanelOpen = !ui._pointsPanelOpen;
      const panel = document.getElementById('col-points');
      const btn = document.getElementById('btnTogglePointsPanel');
      if (ui._pointsPanelOpen) {
        panel.classList.add('open');
        btn.textContent = '\u25C0';
        ui._updatePointsPanel();
      } else {
        panel.classList.remove('open');
        btn.textContent = '\u25B6';
      }
    });

    document.getElementById('btnClosePointsPanel').addEventListener('click', () => {
      ui._pointsPanelOpen = false;
      document.getElementById('col-points').classList.remove('open');
      document.getElementById('btnTogglePointsPanel').textContent = '\u25B6';
    });

    // ---- Keyboard Shortcuts --------------------------------------------------------------------------
    document.addEventListener('keydown', e => {
      // Ctrl+O — Open G-code
      if (e.ctrlKey && !e.shiftKey && e.key === 'o') {
        e.preventDefault();
        document.getElementById('fileInputGcode').click();
      }
      // Ctrl+Shift+S — Save As
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        document.getElementById('btnSaveAs').click();
      }
      // Space — Play/Pause (unless in input/textarea)
      if (e.key === ' ' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        if (preview._pb.active && !preview._pb.paused) preview.pause();
        else preview.play();
      }
      // Esc — Stop
      if (e.key === 'Escape' && e.target.tagName !== 'TEXTAREA') {
        preview.stop();
      }
      // + / - — Zoom (only when not in input/textarea)
      if ((e.key === '+' || e.key === '=') && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        state.previewScale *= 1.15;
        preview.draw(state.workingCmds);
      }
      if (e.key === '-' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        state.previewScale *= 0.85;
        preview.draw(state.workingCmds);
      }
      // Arrow keys / WASD — pan (skip arrows when points panel is open)
      if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        const panStep = 20 / state.previewScale;
        const key = e.key;
        const skipPan = (key === 'ArrowUp' || key === 'ArrowDown') && ui._pointsPanelOpen;
        if (!skipPan) {
          if (key === 'ArrowLeft'  || key === 'a' || key === 'A') { state.previewOffX -= panStep; e.preventDefault(); preview.draw(state.workingCmds); }
          if (key === 'ArrowRight' || key === 'd' || key === 'D') { state.previewOffX += panStep; e.preventDefault(); preview.draw(state.workingCmds); }
        }
        if (!skipPan) {
          if (key === 'ArrowUp'    || key === 'w' || key === 'W') { state.previewOffY -= panStep; e.preventDefault(); preview.draw(state.workingCmds); }
          if (key === 'ArrowDown'  || key === 's' || key === 'S') { state.previewOffY += panStep; e.preventDefault(); preview.draw(state.workingCmds); }
        }
      }
      // Home — Fit view
      if (e.key === 'Home' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        preview.fitView();
      }
      // Tab / Shift+Tab — navigate points in table
      if (e.key === 'Tab' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        const list = ui._pointsList;
        if (!list.length) return;
        if (ui._focusedPointPos < 0) {
          ui._focusPoint(e.shiftKey ? list.length - 1 : 0);
        } else {
          ui._focusPoint(e.shiftKey ? ui._focusedPointPos - 1 : ui._focusedPointPos + 1);
        }
      }
      // Arrow Up/Down — navigate points in table
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && ui._pointsPanelOpen && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        const list = ui._pointsList;
        if (!list.length) return;
        if (e.key === 'ArrowUp') {
          ui._focusPoint(ui._focusedPointPos <= 0 ? 0 : ui._focusedPointPos - 1);
        } else {
          ui._focusPoint(ui._focusedPointPos >= list.length - 1 ? list.length - 1 : ui._focusedPointPos + 1);
        }
      }
    });

    // ---- Drag & Drop ----------------------------------------------------------------------------------------
    setupDragDrop(document.getElementById('preview-area'));

    // ---- Init UI --------------------------------------------------------------------------------------------------
    ui.refreshTemplateList();
    ui.updateTemplateIndicator();
    preview.init(document.getElementById('previewCanvas'));
    findReplace.init();
    const btnFind = document.getElementById('btnFind');
    if (btnFind) btnFind.addEventListener('click', () => findReplace.open());
    ui._setupBackplot();

    // ---- Sync editor scrolls ----------------------------------------------------------------------
    setupScrollSync('editorOriginal', 'highlightOriginal', 'linesOriginal');
    setupScrollSync('editorWorking', 'highlightWorking', 'linesWorking');
    setupScrollSync('editorOriginalModal', 'highlightOriginalModal', 'linesOriginalModal');
    setupScrollSync('editorWorkingModal', 'highlightWorkingModal', 'linesWorkingModal');

    // ---- Editor tabs ------------------------------------------------------------------------------------
    function updateTabVisibility(tabName) {
      document.querySelectorAll('#editor-tabs [data-tab-vis]').forEach(el => {
        const vis = el.dataset.tabVis;
        el.style.display = (vis === 'both' || vis === tabName) ? '' : 'none';
      });
    }
    document.querySelectorAll('.editor-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.editor-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.editor-pane').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        const pane = document.getElementById('pane-' + tab.dataset.tab);
        if (pane) pane.classList.add('active');
        updateTabVisibility(tab.dataset.tab);
        try { localStorage.setItem('editgc_active_tab', tab.dataset.tab); } catch (_) {}
      });
    });
    // restore active tab
    let savedTab;
    try { savedTab = localStorage.getItem('editgc_active_tab'); } catch (_) {}
    if (savedTab === 'working') {
      const tab = document.querySelector('.editor-tab[data-tab="working"]');
      if (tab) tab.click();
    } else {
      updateTabVisibility('original');
    }

    // ---- Widget drag & drop ----------------------------------------------------------------------
    // Widget drag & drop (single column)
    const colLeft = document.getElementById('col-left');
    // ---- Restore widget layout from cache ----------------------------------------
    const savedCols = localStorage.getItem('editgc_widget_cols');
    if (savedCols) {
      try {
        const map = JSON.parse(savedCols);
        Object.entries(map).forEach(([wid, colId]) => {
          const w = document.querySelector(`[data-widget="${wid}"]`);
          const col = document.getElementById(colId);
          if (w && col && w.parentElement !== col) col.appendChild(w);
        });
      } catch (_) {}
    }

    function _saveWidgetLayout() {
      try {
        const map = {};
        document.querySelectorAll('.widget').forEach(w => {
          const col = w.closest('.app-col');
          if (col) map[w.dataset.widget] = col.id;
        });
        localStorage.setItem('editgc_widget_cols', JSON.stringify(map));
      } catch (_) {}
    }

    // ---- Left panel: edge hover toggle ----------------------------------------------------
    const panel = document.getElementById('left-panel');
    const panelClose = document.getElementById('lp-close');
    const edgeHint = document.getElementById('edge-hint');
    if (panel) {
      let edgeTimer = null;
      let leaveTimer = null;
      const EDGE_THRESHOLD = 12;
      const SHOW_DELAY = 500;
      const HIDE_DELAY = 300;

      function openPanel() {
        if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
        panel.classList.add('open');
        if (edgeHint) edgeHint.classList.add('hidden');
        try { localStorage.setItem('editgc_panel_open', 'true'); } catch (_) {}
      }

      function closePanel() {
        panel.classList.remove('open');
        if (edgeHint) edgeHint.classList.remove('hidden');
        try { localStorage.setItem('editgc_panel_open', 'false'); } catch (_) {}
      }

      document.addEventListener('mousemove', e => {
        if (panel.classList.contains('open')) return;
        if (e.clientX <= EDGE_THRESHOLD && e.clientY > 80) {
          if (!edgeTimer) edgeTimer = setTimeout(() => { edgeTimer = null; openPanel(); }, SHOW_DELAY);
        } else {
          if (edgeTimer) { clearTimeout(edgeTimer); edgeTimer = null; }
        }
      });

      panel.addEventListener('mouseleave', () => {
        if (leaveTimer) clearTimeout(leaveTimer);
        leaveTimer = setTimeout(() => { leaveTimer = null; closePanel(); }, HIDE_DELAY);
      });

      panel.addEventListener('mouseenter', () => {
        if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
      });

      if (panelClose) panelClose.addEventListener('click', closePanel);

      // restore saved state on init
      try { if (localStorage.getItem('editgc_panel_open') === 'true') { openPanel(); } else { if (edgeHint) edgeHint.classList.remove('hidden'); } } catch (_) { if (edgeHint) edgeHint.classList.remove('hidden'); }
    }

    // ---- Sidebar widget management ------------------------------------------”€------------
    function _widgetName(wid) {
      const names = { scale:'Scale', template:'Template', origin:'Origin', batch:'Shift Points', points:'Add points' };
      return names[wid] || wid;
    }
    function _buildWidgetLists() {
      const list = document.getElementById('lp-widget-list');
      if (!list) return;
      list.innerHTML = '';
      const allWidgets = document.querySelectorAll('.widget');
      allWidgets.forEach(w => {
        const wid = w.dataset.widget;
        const row = document.createElement('div');
        row.className = 'lp-widget-row';
        row.dataset.widget = wid;
        const name = document.createElement('span');
        name.className = 'lp-widget-name';
        name.textContent = _widgetName(wid);
        row.appendChild(name);
        // up button
        const upBtn = document.createElement('button');
        upBtn.className = 'lp-widget-btn';
        upBtn.textContent = '^';
        upBtn.title = 'Move up';
        upBtn.addEventListener('click', () => {
          const prev = row.previousElementSibling;
          if (!prev) return;
          const widgetEl = document.querySelector(`.widget[data-widget="${wid}"]`);
          const prevWidget = document.querySelector(`.widget[data-widget="${prev.dataset.widget}"]`);
          const col = document.getElementById('col-left');
          if (col && prevWidget) { col.insertBefore(widgetEl, prevWidget); list.insertBefore(row, prev); _saveWidgetLayout(); }
        });
        row.appendChild(upBtn);
        // down button
        const dnBtn = document.createElement('button');
        dnBtn.className = 'lp-widget-btn';
        dnBtn.textContent = 'v';
        dnBtn.title = 'Move down';
        dnBtn.addEventListener('click', () => {
          const next = row.nextElementSibling;
          if (!next) return;
          const widgetEl = document.querySelector(`.widget[data-widget="${wid}"]`);
          const nextWidget = document.querySelector(`.widget[data-widget="${next.dataset.widget}"]`);
          const col = document.getElementById('col-left');
          if (col && nextWidget) { col.insertBefore(widgetEl, nextWidget.nextSibling); list.insertBefore(row, next.nextSibling); _saveWidgetLayout(); }
        });
        row.appendChild(dnBtn);
        list.appendChild(row);
      });
    }
    _buildWidgetLists();

    // ---- Theme selector --------------------------------------------------------------------------------
    const themeSelect = document.getElementById('themeSelect');
    if (themeSelect) {
      let savedTheme = 'default';
      try { savedTheme = localStorage.getItem('editgc_theme') || 'default'; } catch (_) {}
      document.body.dataset.theme = savedTheme;
      themeSelect.value = savedTheme;
      themeSelect.addEventListener('change', () => {
        document.body.dataset.theme = themeSelect.value;
        try { localStorage.setItem('editgc_theme', themeSelect.value); } catch (_) {}
      });
    }

    // ---- Unsaved changes warning --------------------------------------------------------------
    window.addEventListener('beforeunload', e => {
      if (state.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    ui.setStatus('Ready');
  },

  clearState() {
    if (preview._rebuildTimer) { clearTimeout(preview._rebuildTimer); preview._rebuildTimer = null; }
    preview._segVersion++;
    preview._segBuilding = false;
    preview._segments = null;
    preview._points = null;
    preview._segBounds = null;
    preview._segCommands = null;
    preview._segTruncated = false;
    preview._origSegments = null;
    preview._origPoints = null;
    preview._origBounds = null;
    preview._hlCmdIdx = -1;
    state.mode = 'gcode';
    state.svgText = '';
    state.svgImg = null;
    state.svgDims = null;
    state.svgSegments = null;
    state.dxfSegments = null;
    state._boundsCache = null;
    state.originMarkMode = null;
    state.originMark = null;
    state.showRapids = true;
    state.templateMeta = null;
    state.workingCmds = [];
    state.originalCmds = [];
    state.originalText = '';
  },

  _detectLaserPatterns() {
    const cmds = state.originalCmds.length ? state.originalCmds : state.workingCmds;
    const text = state.originalText || gcodeParser.serialize(cmds);
    if (!text) return { on: 'SM3', off: 'RM3' };
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    const isMove = (t) => /^(G0|G00|G1|G01|G2|G02|G3|G03)$/i.test(t);
    const isCoord = (l) => !l.startsWith(';') && !l.startsWith('(') && /[XYZ]/.test(l);
    const beforeMove = {};
    const afterMove = {};
    for (let i = 0; i < lines.length; i++) {
      const first = lines[i].split(/\s+/)[0].toUpperCase();
      const isLineMove = isMove(first) || (isCoord(lines[i]) && !first.match(/^[A-Z]/));
      if (!isLineMove) continue;
      if (i > 0) {
        const pLine = lines[i - 1];
        const pFirst = pLine.split(/\s+/)[0].toUpperCase();
        if (pFirst && !pLine.startsWith(';') && !pLine.startsWith('(')) {
          beforeMove[pFirst] = { count: (beforeMove[pFirst]?.count || 0) + 1, full: pLine.split(';')[0].trim() };
        }
      }
      if (i + 1 < lines.length) {
        const nLine = lines[i + 1];
        const nFirst = nLine.split(/\s+/)[0].toUpperCase();
        if (nFirst && !nLine.startsWith(';') && !nLine.startsWith('(')) {
          afterMove[nFirst] = { count: (afterMove[nFirst]?.count || 0) + 1, full: nLine.split(';')[0].trim() };
        }
      }
    }
    const bestOn  = Object.values(beforeMove).sort((a, b) => b.count - a.count)[0];
    const bestOff = Object.values(afterMove).sort((a, b) => b.count - a.count)[0];
    return {
      on:  bestOn  ? bestOn.full  : 'M3 S1000',
      off: bestOff ? bestOff.full : 'M5'
    };
  },

  _useVirtualEditor(text) {
    const n = text ? text.split('\n').length : 0;
    return n > CFG.HL_LIMIT;
  },

  _updateWorkingEditor(text) {
    const isVirtual = this._ve && this._ve.getLineCount() > 0;
    const shouldVirtual = this._useVirtualEditor(text);
    const taWrap = document.getElementById('editorWorking');
    const veWrap = document.getElementById('virtualEditorWrap');
    if (!taWrap || !veWrap) return;
    if (shouldVirtual) {
      taWrap.style.display = 'none';
      veWrap.style.display = 'flex';
      if (!this._ve) {
        veWrap.innerHTML = '';
        this._ve = new VirtualEditor(veWrap);
        this._ve.onChange((val) => {
          state.workingCmds = gcodeParser.parse(val);
          state.dirty = true;
          preview.draw(state.workingCmds);
          ui.updateFooterInfo();
        });
      }
      this._ve.setText(text);
    } else {
      taWrap.style.display = '';
      veWrap.style.display = 'none';
      taWrap.value = truncateForEditor(text);
    }
  },

  refreshWorking() {
    state._boundsCache = null;
    let text = gcodeParser.serialize(state.workingCmds);
    if (document.getElementById('chkTagEdits').checked && state.originalCmds && state.originalCmds.length) {
      const lines = text.split('\n');
      state.workingCmds.forEach((cmd, i) => {
        if (i >= lines.length) return;
        let edited = false;
        if (i >= state.originalCmds.length) {
          edited = true;
        } else {
          const orig = state.originalCmds[i];
          const cmdP = { ...cmd.params }; delete cmdP.N;
          const origP = { ...orig.params }; delete origP.N;
          edited = JSON.stringify(cmdP) !== JSON.stringify(origP) || cmd.type !== orig.type;
        }
        if (edited) {
          lines[i] = lines[i].replace(/\s*;edit\.gc/g, '').trimEnd() + '  ;edit.gc';
        }
      });
      text = lines.join('\n');
    }
    this._isRefreshing = true;
    this._updateWorkingEditor(text);
    applyHighlight(document.getElementById('highlightWorking'), text);
    const wm = document.getElementById('editorWorkingModal');
    if (wm) wm.value = text;
    this._isRefreshing = false;
    preview.draw(state.workingCmds);
    ui.syncModals();
    if (ui.updateResizePanel) ui.updateResizePanel();
    ui.updateFooterInfo();
    state.dirty = true;
  },

  updateResizePanel() {
    const b = preview._getBounds(state.workingCmds);
    if (!b) { state.resizeBaseW = 0; state.resizeBaseH = 0; return; }
    const w = b.rangeX, h = b.rangeY;
    state.resizeBaseW = w;
    state.resizeBaseH = h;
    document.getElementById('resizeW').value = w.toFixed(3);
    document.getElementById('resizeH').value = h.toFixed(3);
  },

  syncModals() {
    const origText = state.originalText || (state.originalCmds.length ? gcodeParser.serialize(state.originalCmds) : '');
    const workText = gcodeParser.serialize(state.workingCmds);
    const tOrig = truncateForEditor(origText);
    const tWork = truncateForEditor(workText);
    document.getElementById('editorOriginalModal').value = tOrig;
    document.getElementById('editorWorkingModal').value  = tWork;
    applyHighlight(document.getElementById('highlightOriginalModal'), tOrig);
    applyHighlight(document.getElementById('highlightWorkingModal'), tWork);
  },

  refreshTemplateList() {
    const sel = document.getElementById('templateSelect');
    const cur = sel.value;
    sel.innerHTML = '<option value="">— Templates —</option>';
    templateManager.list().sort().forEach(name => {
      const opt = document.createElement('option');
      opt.value = opt.textContent = name;
      sel.appendChild(opt);
    });
    if (cur) sel.value = cur;
  },

  updateTemplateIndicator() {
    const el = document.getElementById('tplIndicator');
    if (!el) return;
    const name = document.getElementById('templateSelect').value;
    el.textContent = name ? `Template: ${name}` : '';
  },

  updateFooterInfo() {
    // Populate Gcode Info widget
    const iName  = document.getElementById('infoFileName');
    const iUnits = document.getElementById('infoUnits');
    const iLines = document.getElementById('infoLines');
    const iDist  = document.getElementById('infoDist');
    const iTime  = document.getElementById('infoTime');
    const iWarn  = document.getElementById('infoWarn');
    const hasGcode = state.workingCmds.length > 0;
    if (hasGcode) {
      if (iName) iName.textContent = state.originalName || 'Untitled';
    } else {
      if (iName) iName.textContent = '—';
    }
    if (hasGcode) {
      const unitsCmd = state.workingCmds.find(c => c.type === 'G20' || c.type === 'G21');
      const modeCmd  = state.workingCmds.find(c => c.type === 'G90' || c.type === 'G91');
      let units = unitsCmd ? (unitsCmd.type === 'G21' ? 'mm' : 'in') : '—';
      let mode = modeCmd ? (modeCmd.type === 'G90' ? 'ABS' : 'REL') : '—';
      const unitsLabel = unitsCmd ? `${unitsCmd.type} (${units})` : '—';
      const modeLabel = modeCmd ? `${modeCmd.type} (${mode})` : '—';
      if (iUnits) iUnits.textContent = `Units: ${unitsLabel} · Mode: ${modeLabel}`;
      const total = state.workingCmds.length;
      const cuts = state.workingCmds.filter(c => c.type === 'G1' || c.type === 'G01').length;
      const rapids = state.workingCmds.filter(c => c.type === 'G0' || c.type === 'G00').length;
      const arcs2 = state.workingCmds.filter(c => c.type === 'G2' || c.type === 'G02').length;
      const arcs3 = state.workingCmds.filter(c => c.type === 'G3' || c.type === 'G03').length;
      if (iLines) iLines.textContent = `Lines: ${total.toLocaleString()}  G1: ${cuts}  G0: ${rapids}  G2: ${arcs2}  G3: ${arcs3}`;
      const segs = preview._segments;
      if (segs && segs.length) {
        let cutDist = 0, rapidDist = 0;
        for (let i = 0; i < segs.length; i++) {
          const s = segs[i];
          const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y, dz = s.b.z - s.a.z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (s.rapid) rapidDist += d; else cutDist += d;
        }
        if (iDist) iDist.textContent = `Cut: ${cutDist.toFixed(0)} mm  Rapid: ${rapidDist.toFixed(0)} mm`;
        if (cutDist > 0) {
          const cutMin = cutDist / 500;
          const rapidMin = rapidDist / 3000;
          const totalSec = Math.round((cutMin + rapidMin) * 60);
          let timeStr;
          if (totalSec >= 3600) timeStr = `${Math.floor(totalSec / 3600)}h ${Math.floor((totalSec % 3600) / 60)}m ${totalSec % 60}s`;
          else if (totalSec >= 60) timeStr = `${Math.floor(totalSec / 60)}m ${totalSec % 60}s`;
          else timeStr = `${totalSec}s`;
          if (iTime) iTime.textContent = `Est. time: ~${timeStr}`;
        } else if (iTime) iTime.textContent = 'Est. time: —';
      } else {
        if (iDist) iDist.textContent = 'Build preview for distances…';
        if (iTime) iTime.textContent = '';
      }
      if (iWarn) {
        const analysis = gcodeParser.analyzeFull(state.workingCmds);
        const warns = [];
        if (analysis.unknownCmds.length) warns.push(`Unknown: ${analysis.unknownCmds.join(', ')}`);
        if (!unitsCmd) warns.push('No G20/G21 (units not set)');
        if (!modeCmd)  warns.push('No G90/G91 (mode not set)');
        if (cuts === 0) warns.push('No G1 moves (nothing to cut)');
        iWarn.textContent = warns.length ? warns.join('  |  ') : '';
        iWarn.style.color = warns.length ? '#d97706' : 'var(--text-dim)';
      }
    } else {
      if (iUnits) iUnits.textContent = '—';
      if (iLines) iLines.textContent = '—';
      if (iDist)  iDist.textContent = '—';
      if (iTime)  iTime.textContent = '—';
      if (iWarn)  iWarn.textContent = '—';
    }
    // Footer stays clean — all info is in Gcode Info widget
    const el = document.getElementById('footerInfo');
    if (el) el.textContent = '';
  },

  _setupBackplot() {
    document.getElementById('editorOriginal').addEventListener('click', function() {
      const idx = this.selectionStart;
      const lineNo = this.value.substring(0, idx).split('\n').length - 1;
      if (lineNo >= 0 && lineNo < state.originalCmds.length) {
        preview.highlightLine(lineNo);
      }
    });
    // Textarea click → backplot
    document.getElementById('editorWorking').addEventListener('click', function() {
      const idx = this.selectionStart;
      const lineNo = this.value.substring(0, idx).split('\n').length - 1;
      if (lineNo >= 0 && lineNo < state.workingCmds.length) {
        preview.highlightLine(lineNo);
      }
    });
    // VirtualEditor click → backplot
    const veWrap = document.getElementById('virtualEditorWrap');
    if (veWrap) {
      veWrap.addEventListener('click', function(e) {
        if (!ui._ve) return;
        const ve = ui._ve;
        const rect = veWrap.getBoundingClientRect();
        const y = e.clientY - rect.top + veWrap.scrollTop;
        const lineNo = Math.floor(y / 19.2);
        if (lineNo >= 0 && lineNo < state.workingCmds.length) {
          preview.highlightLine(lineNo);
        }
      });
    }
  },

  setStatus(msg, type) {
    const el = document.getElementById('statusMsg');
    if (!el) return;
    el.textContent = msg;
    el.style.color = type === 'error' ? '#f66' : '#555';
  },
  setProgress(pct, label) {
    const wrap = document.getElementById('colStatus');
    const track = document.getElementById('colStatusTrack');
    const bar  = document.getElementById('colStatusBar');
    const lbl  = document.getElementById('colStatusLabel');
    if (!wrap) return;
    if (pct < 0) { if (track) track.classList.add('hidden'); if (lbl) lbl.textContent = ''; return; }
    if (track) track.classList.remove('hidden');
    if (bar) bar.style.width = Math.min(100, Math.max(0, pct)) + '%';
    if (lbl) lbl.textContent = label || Math.round(pct) + '%';
  },
};

