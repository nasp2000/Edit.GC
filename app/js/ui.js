// ---- uiController --------------------------------------------------------------------------------------------
const ui = {
  init() {
    // Abrir G-code
    document.getElementById('fileInputGcode').addEventListener('change', async e => {
      const file = e.target.files[0]; if (!file) return;
      e.target.value = '';
      ui.clearState(); // permite reabrir o mesmo ficheiro
      ui.setProgress(2, 'Reading file...');
      const text = await fileManager.readGcode(file);
      ui.setProgress(30, 'Parsing...');
      state.originalCmds  = gcodeParser.parse(text);
      ui.setProgress(50, 'Preparing editor...');
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
      ui.setProgress(70, 'Applying syntax highlight...');
      const hlText = isLarge ? '' : text;
      applyHighlight(document.getElementById('highlightOriginal'), hlText);
      applyHighlight(document.getElementById('highlightWorking'), hlText);
      ui.setProgress(90, 'Rendering...');
      preview.resize(); // garante dimenses do canvas e faz draw
      preview.fitView(); // centra e ajusta o toolpath ?  vista (top-down)
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
      document.getElementById('btnSlice').disabled = true;
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
    });
    document.getElementById('pathVarStep').addEventListener('change', function() {
      const v = parseFloat(this.value);
      document.getElementById('pathVarOutside').step = v;
      document.getElementById('pathVarInside').step = v;
    });
    document.getElementById('turnVarStep').addEventListener('change', function() {
      document.getElementById('turnVarValue').step = parseFloat(this.value);
    });
    document.getElementById('minDistStep').addEventListener('change', function() {
      document.getElementById('minDistValue').step = parseFloat(this.value);
    });
    // Apply default step values on init
    const _initStep = (id, targets) => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const v = parseFloat(sel.value);
      targets.forEach(t => { const e = document.getElementById(t); if (e) e.step = v; });
    };
    _initStep('scaleStep', ['resizeW']);
    _initStep('batchStep', ['batchAxisVal']);
    _initStep('pointsStep', ['pointsOffsetX','pointsOffsetY','pointsOffsetZ']);
    _initStep('pathVarStep', ['pathVarOutside','pathVarInside']);
    _initStep('turnVarStep', ['turnVarValue']);
    _initStep('minDistStep', ['minDistValue']);
    _initStep('originStep', ['originX','originY','originZ','originA','originB','originC','originE1']);
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
    const _chkHideOrig = document.getElementById('chkHideOriginal');
    if (_chkHideOrig) _chkHideOrig.addEventListener('change', function() {
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
      await ui._loadSvgFile(file);
    });

    // SVG view mode toggle (outlines / raster)
    const _syncSvgView = el => {
      state.svgPreviewMode = el.value;
      preview.draw(state.workingCmds);
    };
    const _syncSvgViewEnabled = () => {
      // Always enabled ? works for G-code, SVG, DXF
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
      await ui._loadDxfFile(file);
    });

    // Open Vector (SVG or DXF ? unified button)
    document.getElementById('fileInputVector').addEventListener('change', async e => {
      const file = e.target.files[0]; if (!file) return;
      e.target.value = '';
      const ext = file.name.split('.').pop().toLowerCase();
      if (ext === 'svg') {
        await ui._loadSvgFile(file);
      } else if (ext === 'dxf') {
        await ui._loadDxfFile(file);
      } else {
        ui.setStatus('Unsupported file format.', 'error');
      }
    });

    // Convert button ? single entry point for SVG/DXF ? G-code generation
    document.getElementById('btnSlice').addEventListener('click', () => {
      const hasSvg = !!state.svgText;
      const hasDxf = !!(state.dxfSegments?.length);
      if (!hasSvg && !hasDxf) { ui.setStatus('Load an SVG or DXF file first.', 'error'); return; }
      // Warn if widget edits will be lost on re-convert
      const hasWidgetEdits = state.originalCmds && state.originalCmds.length &&
        (state.workingCmds.length !== state.originalCmds.length ||
         gcodeParser.serialize(state.workingCmds) !== gcodeParser.serialize(state.originalCmds));
      if (hasWidgetEdits) {
        if (!confirm('Re-converting will discard all Points Editor changes (Path Variation, Shift, MinDist, Add Points, etc.).\n\nCorrect order: Machine Options ? Convert ? Points Editor widgets.\n\nContinue?')) return;
      }
      try {
        ui.setStatus('Converting...');
        ui.setProgress(5, 'Converting...');
        const processed = ui._buildProcessedTemplate() || state.template;
        let cmds, baseName;
        if (hasSvg) {
          cmds = svgConverter.convert(state.svgText, processed);
          baseName = (state.originalName || 'output').replace(/\.svg$/i, '') + '.gcode';
        } else {
          cmds = svgConverter.segmentsToGcode(state.dxfSegments, processed);
          baseName = (state.dxfName || 'output').replace(/\.dxf$/i, '') + '.gcode';
        }
        ui.setProgress(60, 'Applying scale...');
        const tw = parseFloat(document.getElementById('resizeW').value);
        if (tw > 0) {
          let baseRatio;
          if (hasSvg && state.svgDims?.width && state.svgDims?.height) {
            baseRatio = state.svgDims.height / state.svgDims.width;
          } else if (hasDxf) {
            const all = state.dxfSegments.flat();
            const xs = all.map(p => p.x), ys = all.map(p => p.y);
            const m1 = safeMinMax(xs), m2 = safeMinMax(ys);
            const curW = m1.max - m1.min || 1, curH = m2.max - m2.min || 1;
            baseRatio = curH / curW;
          } else {
            baseRatio = 1;
          }
          const th = tw * baseRatio;
          if (hasSvg && state.svgDims?.width) {
            const fx = tw / state.svgDims.width, fy = th / state.svgDims.height;
            cmds = (Math.abs(fx - fy) < 0.0001)
              ? gcodeParser.scaleCommands(cmds, fx)
              : gcodeParser.scaleCommandsXY(cmds, fx, fy);
          } else if (hasDxf) {
            const all = state.dxfSegments.flat();
            const xs = all.map(p => p.x), ys = all.map(p => p.y);
            const m1 = safeMinMax(xs), m2 = safeMinMax(ys);
            const curW = m1.max - m1.min || 1, curH = m2.max - m2.min || 1;
            const fx = tw / curW, fy = th / curH;
            cmds = (Math.abs(fx - fy) < 0.0001)
              ? gcodeParser.scaleCommands(cmds, fx)
              : gcodeParser.scaleCommandsXY(cmds, fx, fy);
          }
        }
        const gcode = gcodeParser.serialize(cmds);
        undoRedo.push(state.workingCmds);
        state.workingCmds = cmds;
        state.originalCmds = cmds.map(c => ({ ...c }));
        state.originalText = gcode.length > 5 * 1024 * 1024 ? '' : gcode;
        state.originalName = baseName;
        state.dirty = false;
        state.mode = 'gcode';
        state.svgImg = null;
        document.getElementById('editorOriginal').value = gcode;
        ui._updateWorkingEditor(gcode);
        applyHighlight(document.getElementById('highlightOriginal'), gcode);
        applyHighlight(document.getElementById('highlightWorking'), gcode);
        ui.setProgress(90, 'Rendering...');
        preview.resize();
        ui.syncModals();
        ui.updateFooterInfo();
        ui.setProgress(100, 'Done');
        setTimeout(() => ui.setProgress(-1), 1200);
        const passes = processed?.laser?.passes || 1;
        const cutLines = cmds.filter(c => c.type === 'G1' || c.type === 'G01').length;
        ui.setStatus(`Converted: ${cutLines} cut moves ? ${cmds.length} lines ? ${passes} pass(es) ? "${baseName}"`);
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

    // Export G-code ? SVG / DXF
    const btnExportSvg = document.getElementById('btnExportSvg');
    if (btnExportSvg) btnExportSvg.addEventListener('click', () => {
      if (!state.workingCmds.length) { ui.setStatus('No G-code loaded.', 'error'); return; }
      exportTools.exportSvg(state.workingCmds);
      ui.setStatus('Exported SVG.');
    });
    const btnExportDxf = document.getElementById('btnExportDxf');
    if (btnExportDxf) btnExportDxf.addEventListener('click', () => {
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
    document.getElementById('btnRotate90').addEventListener('click', () => {
      if (!state.workingCmds.length) { ui.setStatus('No G-code to rotate.', 'error'); return; }
      const angle = 90;
      // Temporarily remove machine origin offset so rotation is around logical origin
      const mo = ui._loadMachineOpts();
      const mx = parseFloat(mo.machineX) || 0;
      const my = parseFloat(mo.machineY) || 0;
      let cmds = state.workingCmds.map(c => {
        if (c.params.X !== undefined || c.params.Y !== undefined) {
          const p = { ...c.params };
          if (p.X !== undefined) p.X = parseFloat((p.X - mx).toFixed(4));
          if (p.Y !== undefined) p.Y = parseFloat((p.Y - my).toFixed(4));
          return { ...c, params: p, raw: '' };
        }
        return c;
      });
      undoRedo.push(state.workingCmds);
      cmds = gcodeParser.rotate(cmds, angle);
      // Re-apply machine origin
      cmds = cmds.map(c => {
        if (c.params.X !== undefined || c.params.Y !== undefined) {
          const p = { ...c.params };
          if (p.X !== undefined) p.X = parseFloat((p.X + mx).toFixed(4));
          if (p.Y !== undefined) p.Y = parseFloat((p.Y + my).toFixed(4));
          return { ...c, params: p, raw: '' };
        }
        return c;
      });
      // Re-center after rotation so X/Y stay non-negative
      const isMotion = (t) => ['G0','G00','G1','G01','G2','G02','G3','G03',''].includes(t) || t === null || t === undefined;
      let minX = Infinity, minY = Infinity;
      cmds.forEach(c => {
        if (!isMotion(c.type)) return;
        if (c.params.X !== undefined && c.params.X < minX) minX = c.params.X;
        if (c.params.Y !== undefined && c.params.Y < minY) minY = c.params.Y;
      });
      if (isFinite(minX) && isFinite(minY) && (minX < -0.001 || minY < -0.001)) {
        cmds = cmds.map(c => {
          if (!isMotion(c.type)) return c;
          const p = { ...c.params };
          if (p.X !== undefined) p.X = parseFloat((p.X - minX).toFixed(4));
          if (p.Y !== undefined) p.Y = parseFloat((p.Y - minY).toFixed(4));
          return { ...c, params: p, raw: '' };
        });
      }
      state.workingCmds = cmds;
      ui.refreshWorking();
      ui.setStatus(`Rotated ${angle} deg clockwise.`);
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

    // ---- Scale widget ? single W input, aspect ratio locked ----
    const _getBounds = () => preview._getBounds(state.workingCmds);

    const _updateScaleFromW = () => {
      const w = parseFloat(document.getElementById('resizeW').value);
      if (!w || !state.resizeBaseW) return;
      const ratio = state.resizeBaseH / state.resizeBaseW;
      const h = w * ratio;
      const hEl = document.getElementById('resizeHDisplay');
      if (hEl) hEl.textContent = h.toFixed(3);
    };

    const _scaleStepUp = () => {
      const step = parseFloat(document.getElementById('scaleStep').value) || 1;
      const inp = document.getElementById('resizeW');
      const w = parseFloat(inp.value) || 0;
      inp.value = (w + step).toFixed(3);
      inp.dispatchEvent(new Event('input'));
      inp.dispatchEvent(new Event('change'));
    };
    const _scaleStepDown = () => {
      const step = parseFloat(document.getElementById('scaleStep').value) || 1;
      const inp = document.getElementById('resizeW');
      const w = parseFloat(inp.value) || 0;
      inp.value = Math.max(0.001, w - step).toFixed(3);
      inp.dispatchEvent(new Event('input'));
      inp.dispatchEvent(new Event('change'));
    };
    document.getElementById('btnScaleUp').addEventListener('click', _scaleStepUp);
    document.getElementById('btnScaleDown').addEventListener('click', _scaleStepDown);

    document.getElementById('resizeW').addEventListener('input', () => {
      _updateScaleFromW();
      if (state.mode === 'gcode') {
        // Scale G-code in real-time
        const tw = parseFloat(document.getElementById('resizeW').value);
        if (!tw || !state.resizeBaseW || !state.workingCmds.length) return;
        const ratio = tw / state.resizeBaseW;
        if (Math.abs(ratio - 1) < 0.0001) return;
        state.workingCmds = gcodeParser.scaleCommands(state.workingCmds.map(c => ({...c})), ratio);
        state.resizeBaseW = tw;
        state.previewScale *= ratio;
        preview._segments = null;
        preview.draw(state.workingCmds);
        ui.refreshWorking();
        return;
      }
      // Live preview update for SVG/DXF modes only
      const tw = parseFloat(document.getElementById('resizeW').value);
      if (!tw || !state.resizeBaseW) return;
      const ratio = state.resizeBaseH / state.resizeBaseW;
      const th = tw * ratio;
      if (state.mode === 'svg' && state.svgSegments) {
        const all = state.svgSegments.flat();
        const xs = all.map(p => p.x), ys = all.map(p => p.y);
        const m1 = safeMinMax(xs), m2 = safeMinMax(ys);
        const curW = m1.max - m1.min || 1, curH = m2.max - m2.min || 1;
        state.svgScale = Math.min(tw / curW, th / curH);
        state.resizeBaseW = tw;
        state.resizeBaseH = th;
      } else if (state.mode === 'dxf' && state.dxfSegments) {
        const all = state.dxfSegments.flat();
        const xs = all.map(p => p.x), ys = all.map(p => p.y);
        const m1 = safeMinMax(xs), m2 = safeMinMax(ys);
        const curW = m1.max - m1.min || 1, curH = m2.max - m2.min || 1;
        state.dxfScale = Math.min(tw / curW, th / curH);
        state.resizeBaseW = tw;
        state.resizeBaseH = th;
      }
      preview.draw();
    });
    document.getElementById('resizeW').addEventListener('change', () => {
      _updateScaleFromW();
      const tw = parseFloat(document.getElementById('resizeW').value);
      if (!tw || !state.resizeBaseW) return;
      const ratio = state.resizeBaseH / state.resizeBaseW;
      state.resizeBaseW = tw;
      state.resizeBaseH = tw * ratio;
      if (state.mode === 'svg' || state.mode === 'dxf') {
        ui._regenerateFromSource();
      }
    });

    document.getElementById('btnApplyScale').addEventListener('click', () => {
      const hasSource = state.svgText || state.dxfSegments?.length;
      if (!state.originalCmds.length && !hasSource) { ui.setStatus('No original data to reset.', 'error'); return; }
      state.resizeBaseW = state.originalW;
      state.resizeBaseH = state.originalH;
      document.getElementById('resizeW').value = state.originalW.toFixed(3);
      _updateScaleFromW();
      if (hasSource) {
        ui._regenerateFromSource();
      } else {
        state.workingCmds = state.originalCmds.map(c => ({...c}));
        ui.refreshWorking();
      }
      ui.setStatus('Reset to original dimensions.');
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
        ui.setStatus(`Template "${name}" extracted. Custom: ${data.customCommands.join(', ') || 'none'}. Tool: ${data.laserOnCmd || '?'}/${data.laserOffCmd || '?'}.`);
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
      ui.setStatus(`Template "${name}" active. Ext: .${t.ext}, Tool: ${t.laserOnCmd || '?'}/${t.laserOffCmd || '?'}, Tools: ${t.toolCodes.join(', ') || 'none'}.`);
    });

    // Template select change
    templateSelector.addEventListener('change', e => {
      const name = e.target.value;
      if (name) {
        templateManager.setActive(name);
        const tpl = templateManager.getTemplate(name);
        if (tpl) state.templateMeta = { ext: tpl.data.ext, lineEnd: tpl.data.lineEnd };
        // Refresh speed/power widget for SM300 detection
        if (window.ui && window.ui._speedPowerInit) {
          const table = document.getElementById('speedPowerTable');
          if (table) while (table.children.length > 3) table.removeChild(table.lastChild);
          window.ui._speedPowerInit();
        }
      } else {
        templateManager.setActive(null);
        state.templateMeta = null;
      }
      settings.set('templateName', name);
      ui.updateTemplateIndicator();
      ui._populateMachineOptions();
      if (state.mode === 'svg' || state.mode === 'dxf') ui._regenerateFromSource();
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
    const _btnOpenTF = document.getElementById('btnOpenTemplatesFolder');
    if (_btnOpenTF) _btnOpenTF.addEventListener('click', async () => {
      if (templateManager._dirHandle) {
        try {
          const root = await templateManager._dirHandle.getDirectoryHandle('..');
          const iter = root.values();
          const first = await iter.next();
        } catch (_) {}
      }
      await templateManager.openFolder();
    });

    // Working editor ? sync state (debounced)
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
      const axes = ['X','Y','Z'];
      const target = {};
      for (const a of axes) {
        const el = document.getElementById('origin' + a);
        const v = el ? parseFloat(el.value) : 0;
        if (v !== 0 && !v) continue;
        target[a] = v;
      }
      if (!Object.keys(target).length) {
        // If all axes are explicitly 0, move first cut to (0,0,0)
        if (['X','Y','Z'].every(a => {
          const el = document.getElementById('origin' + a);
          const v = el ? parseFloat(el.value) : 0;
          return v === 0;
        })) {
          ['X','Y','Z'].forEach(a => { target[a] = 0; });
        } else {
          ui.setStatus('Enter at least one coordinate.', 'error'); return;
        }
      }

      // Find first tool-on command (G1/G2/G3 with S>0, or first non-G0 motion for SM300)
      const firstToolOn = state.workingCmds.find(c =>
        ['G1','G01','G2','G02','G3','G03'].includes(c.type) && c.params.S && c.params.S > 0
      ) || state.workingCmds.find(c =>
        (['G1','G01','G2','G02','G3','G03',''].includes(c.type)) && !c.isComment && !c.isBlank &&
        c.params.X !== undefined && c.params.Y !== undefined &&
        !['G0','G00'].includes(c.type) && c.type !== 'G0' && c.type !== 'G00'
      );
      if (!firstToolOn) { ui.setStatus('No tool-on motion commands found.', 'error'); return; }

      // Calculate delta = target - current for each axis
      const offsets = {};
      for (const a of Object.keys(target)) {
        if (firstToolOn.params[a] !== undefined) {
          offsets[a] = target[a] - firstToolOn.params[a];
        }
      }
      if (!Object.keys(offsets).length) { ui.setStatus('No matching axes on first tool-on point.', 'error'); return; }

      undoRedo.push(state.workingCmds);
      state.workingCmds = gcodeParser.applyOffset(state.workingCmds, offsets);
      ui.refreshWorking();
      preview.originX = 0;
      preview.originY = 0;
      for (const a of axes) { const el = document.getElementById('origin' + a); if (el) el.value = '0'; }
      const parts = Object.keys(offsets).map(k => `${k}${offsets[k] >= 0 ? '+' : ''}${offsets[k].toFixed(3)}`).join(' ');
      const targetStr = Object.entries(target).map(([k,v]) => `${k}${v}`).join(' ');
      ui.setStatus(`Start set: first cut ? ${targetStr} (delta ${parts})`);
    });

    const _getSaveCommands = () => {
      return state.workingCmds;
    };

    // ---- Generate Updated G-code ----------------------------------------------------------------------
    
    document.getElementById('batchTarget').addEventListener('change', function() {
      const el = document.getElementById('batchRangeInputs');
      if (el) el.style.display = this.value === 'range' ? 'flex' : 'none';
    });

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
        ui.setStatus('From line must be = To line.', 'error'); return;
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
      ui.setStatus(`Batch: ${axis} ${val >= 0 ? '-' : '+'}${Math.abs(val)} applied${from >= 0 ? ` to lines ${from}?${to}` : ''}.`);
    });

    // ---- Full Path Variation ------------------------------------------------------------------
    document.getElementById('btnPathVarApply').addEventListener('click', () => {
      if (!state.workingCmds.length) { ui.setStatus('No G-code loaded.', 'error'); return; }
      const doOutside = document.getElementById('chkPathVarOutside').checked;
      const doInside = document.getElementById('chkPathVarInside').checked;
      if (!doOutside && !doInside) { ui.setStatus('Select at least Outside or Inside.', 'error'); return; }
      const outsideVal = parseFloat(document.getElementById('pathVarOutside').value) || 0;
      const insideVal = parseFloat(document.getElementById('pathVarInside').value) || 0;

      // Collect all motion commands with X,Y coords
      const moves = state.workingCmds.filter(c => c.params.X !== undefined && c.params.Y !== undefined);
      if (moves.length < 2) { ui.setStatus('Need at least 2 motion commands with X,Y.', 'error'); return; }

      // Compute bounding box
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      moves.forEach(c => {
        const x = c.params.X, y = c.params.Y;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      });
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      const hw = (maxX - minX) / 2 || 1, hh = (maxY - minY) / 2 || 1;

      const offsetCmd = (cmd, dx, dy) => {
        const p = { ...cmd.params };
        if (p.X !== undefined) p.X = parseFloat((p.X + dx).toFixed(4));
        if (p.Y !== undefined) p.Y = parseFloat((p.Y + dy).toFixed(4));
        let raw = cmd.type;
        for (const [k, v] of Object.entries(p)) {
          raw += ` ${k}${Number.isInteger(v) ? v : parseFloat(v.toFixed(4))}`;
        }
        return { ...cmd, params: p, raw };
      };

      // Get laser pattern for wrapper (laser off, travel, laser on)
      const _getLaserPat = () => {
        const tpl = templateManager.getActive();
        const td = tpl?.data || tpl;
        if (td?.laserOnCmd && td?.laserOffCmd) return { on: td.laserOnCmd, off: td.laserOffCmd };
        return ui._detectLaserPatterns();
      };
      const laserPat = _getLaserPat();
      const isSM300 = laserPat && /SM3/i.test(laserPat.on);
      const tplFeed = templateManager.getActive();
      const tdFeed = tplFeed?.data || tplFeed;
      const feedTravel = tdFeed?.feedTravel || 8000;
      const smZ = isSM300 ? (tdFeed?.focusZ || -220) : 0;
      const _makeWrapper = (firstX, firstY) => {
        const cmds = [];
        cmds.push({ lineIndex: -1, raw: '', type: laserPat.off, params: {}, comment: '', isBlank: false, isComment: false, blockDelete: false, _newInsert: true });
        const tParams = { X: parseFloat(firstX.toFixed(4)), Y: parseFloat(firstY.toFixed(4)), F: feedTravel };
        if (isSM300) tParams.Z = smZ;
        cmds.push({ lineIndex: -1, raw: '', type: isSM300 ? '' : 'G0', params: tParams, comment: '', isBlank: false, isComment: false, blockDelete: false, _newInsert: true });
        cmds.push({ lineIndex: -1, raw: '', type: laserPat.on, params: {}, comment: '', isBlank: false, isComment: false, blockDelete: false, _newInsert: true });
        return cmds;
      };

      // Find last motion command index ? insert offset lines BEFORE footer (laser off, M2, etc.)
      let lastMoveIdx = -1;
      for (let i = 0; i < state.workingCmds.length; i++) {
        if (state.workingCmds[i].params.X !== undefined && state.workingCmds[i].params.Y !== undefined) {
          lastMoveIdx = i;
        }
      }
      let insertIdx = lastMoveIdx + 1;

      undoRedo.push(state.workingCmds);
      const newCmds = [...state.workingCmds];

      const _buildSection = (label, val, sign) => {
        if (val <= 0) return null;
        const section = [];
        section.push({ lineIndex: -1, raw: `; ${label}`, type: '', params: {}, comment: ` ${label}`, isBlank: false, isComment: true, blockDelete: false, _newInsert: true });
        moves.forEach(c => {
          const dx = c.params.X !== undefined ? ((c.params.X - cx) / hw) * val * sign : 0;
          const dy = c.params.Y !== undefined ? ((c.params.Y - cy) / hh) * val * sign : 0;
          section.push(Object.assign(offsetCmd(c, dx, dy), { _newInsert: true }));
        });
        // Add wrapper (laser off, travel to first point, laser on) before the offset moves
        const firstDx = (moves[0].params.X - cx) / hw * val * sign;
        const firstDy = (moves[0].params.Y - cy) / hh * val * sign;
        const firstX = (moves[0].params.X || 0) + firstDx;
        const firstY = (moves[0].params.Y || 0) + firstDy;
        const wrapper = _makeWrapper(firstX, firstY);
        section.splice(1, 0, ...wrapper);
        return section;
      };

      const outsideSection = doOutside && outsideVal > 0 ? _buildSection(`Full Path Variation ? Outside +${outsideVal}mm`, outsideVal, 1) : null;
      if (outsideSection) {
        newCmds.splice(insertIdx, 0, ...outsideSection);
        insertIdx += outsideSection.length;
      }
      const insideSection = doInside && insideVal > 0 ? _buildSection(`Full Path Variation ? Inside -${insideVal}mm`, insideVal, -1) : null;
      if (insideSection) {
        newCmds.splice(insertIdx, 0, ...insideSection);
      }

      state.workingCmds = newCmds;
      ui.refreshWorking();
      ui.setStatus(`Full Path Variation applied: ${doOutside ? 'outside ' + outsideVal + 'mm ' : ''}${doInside ? 'inside ' + insideVal + 'mm' : ''}`);
    });

    // ---- Full Turn Path Variation ---------------------------------------------------------------
    document.getElementById('btnTurnVarApply').addEventListener('click', () => {
      if (!state.workingCmds.length) { ui.setStatus('No G-code loaded.', 'error'); return; }
      const val = parseFloat(document.getElementById('turnVarValue').value);
      if (!val) { ui.setStatus('Enter a non-zero variation value.', 'error'); return; }

      // Find all motion commands with X,Y coords
      const moves = state.workingCmds.filter(c => c.params.X !== undefined);
      if (moves.length < 2) { ui.setStatus('Need at least 2 motion commands with X coordinate.', 'error'); return; }

      undoRedo.push(state.workingCmds);
      let toggle = true;
      let moveIdx = 0;
      let prevX, prevY;
      state.workingCmds = state.workingCmds.map(c => {
        if (c.params.X === undefined) return c;
        moveIdx++;
        if (moveIdx === 1) { prevX = c.params.X; prevY = c.params.Y; return c; }
        const dx = Math.abs(c.params.X - prevX);
        const dy = Math.abs(c.params.Y - prevY);
        const p = { ...c.params };
        const offset = toggle ? val : -val;
        // Apply offset perpendicular to segment direction
        if (dx >= dy) {
          // Horizontal segment ? vary Y
          p.Y = parseFloat((p.Y + offset).toFixed(4));
        } else {
          // Vertical segment ? vary X
          p.X = parseFloat((p.X + offset).toFixed(4));
        }
        toggle = !toggle;
        prevX = p.X; prevY = p.Y;
        return { ...c, params: p, raw: '' };
      });

      ui.refreshWorking();
      ui.setStatus(`Full Turn Path Variation: ?${val}mm alternating perpendicular to segments applied.`);
    });

    // ---- Speed/Power Control (3 colors × 3 rows) ------------------------------------------------
    const SPEED_PRESETS = [1000,2000,3000,4000,5000,6000,7000,8000,9000,10000];
    const POWER_PRESETS = [10,20,30,40,50,60,70,80,90,100];
    const SPEED_POWER_COLORS = ['#F97316','#EC4899','#84CC16'];
    ui._speedPowerRows = SPEED_POWER_COLORS.map((c, ri) => ({
      color: c, speed: SPEED_PRESETS[ri] || 3000, power: POWER_PRESETS[ri] || 50,
      speedCustom: false, powerCustom: false, assignedPoints: []
    }));
    ui._speedPowerInit = () => {
      const table = document.getElementById('speedPowerTable');
      if (!table) return;
      const tpl = templateManager.getActive(); const td = tpl?.data || tpl;
      const isSM = /SM3/i.test(td?.laserOnCmd || '');
      const label = document.getElementById('speedPowerPowerLabel');
      if (label) label.textContent = isSM ? 'Power (Machine Options)' : 'Power (S)';
      for (let ri = 0; ri < 3; ri++) {
        const row = ui._speedPowerRows[ri];
        if (isSM) {
          // SM300: speed per-point, power is global (Machine Options)
          // Show speed dropdown + color indicator, hide power
          const colorCell = document.createElement('span');
          colorCell.style.cssText = `display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:2px;background:${row.color};color:#fff;font-size:9px;font-weight:700;width:18px;height:24px;flex-shrink:0`;
          colorCell.textContent = ri + 1;
          colorCell.title = 'Click or press ' + (ri + 1) + ' to assign to focused point';
          colorCell.dataset.speedRow = ri;
          colorCell.addEventListener('click', () => ui._speedPowerAssignRow(ri));
          const speedSel = document.createElement('select');
          speedSel.className = 'bselect';
          speedSel.style.cssText = 'width:100%;height:24px;font-size:11px';
          row.speed = SPEED_PRESETS[ri] || 3000;
          SPEED_PRESETS.forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; speedSel.appendChild(o); });
          const custOpt = document.createElement('option'); custOpt.value = 'custom'; custOpt.textContent = 'Custom'; speedSel.appendChild(custOpt);
          speedSel.value = row.speed;
          speedSel.addEventListener('change', () => {
            if (speedSel.value === 'custom') { row.speedCustom = true; row.speed = ''; speedSel.style.display = 'none'; speedInput.style.display = ''; speedInput.focus(); }
            else { row.speedCustom = false; row.speed = parseFloat(speedSel.value); speedSel.style.display = ''; speedInput.style.display = 'none'; }
          });
          const speedInput = document.createElement('input');
          speedInput.type = 'number'; speedInput.className = 'cinput';
          speedInput.style.cssText = 'width:100%;height:24px;font-size:11px;display:none';
          speedInput.placeholder = 'F';
          speedInput.addEventListener('change', () => { row.speed = parseFloat(speedInput.value) || 0; });
          speedInput.addEventListener('blur', () => { if (!speedInput.value) { speedInput.style.display = 'none'; speedSel.style.display = ''; speedSel.value = row.speed || SPEED_PRESETS[ri]; row.speedCustom = false; } });
          const infoSpan = document.createElement('span');
          infoSpan.style.cssText = 'font-size:9px;color:var(--text-dim);display:flex;align-items:center;padding:0 2px';
          infoSpan.textContent = 'Machine Options';
          row.power = 0;
          table.appendChild(colorCell);
          const spWrap = document.createElement('span'); spWrap.style.cssText = 'display:flex;gap:1px;width:100%'; spWrap.appendChild(speedSel); spWrap.appendChild(speedInput); table.appendChild(spWrap);
          table.appendChild(infoSpan);
          continue;
        }
        const colorCell = document.createElement('span');
        colorCell.style.cssText = `display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:2px;background:${row.color};color:#fff;font-size:9px;font-weight:700;width:18px;height:18px;flex-shrink:0`;
        colorCell.textContent = ri + 1;
        colorCell.title = 'Click or press ' + (ri + 1) + ' to assign to focused point';
        colorCell.dataset.speedRow = ri;
        colorCell.addEventListener('click', () => ui._speedPowerAssignRow(ri));
        const speedSel = document.createElement('select');
        speedSel.className = 'bselect';
        speedSel.style.cssText = 'width:100%;height:24px;font-size:11px';
        SPEED_PRESETS.forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; speedSel.appendChild(o); });
        const custOpt = document.createElement('option'); custOpt.value = 'custom'; custOpt.textContent = 'Custom'; speedSel.appendChild(custOpt);
        speedSel.value = row.speed;
        speedSel.addEventListener('change', () => {
          if (speedSel.value === 'custom') { row.speedCustom = true; row.speed = ''; speedSel.style.display = 'none'; speedInput.style.display = ''; speedInput.focus(); }
          else { row.speedCustom = false; row.speed = parseFloat(speedSel.value); speedSel.style.display = ''; speedInput.style.display = 'none'; }
        });
        const speedInput = document.createElement('input');
        speedInput.type = 'number'; speedInput.className = 'cinput';
        speedInput.style.cssText = 'width:100%;height:24px;font-size:11px;display:none';
        speedInput.placeholder = 'F';
        speedInput.addEventListener('change', () => { row.speed = parseFloat(speedInput.value) || 0; });
        speedInput.addEventListener('blur', () => { if (!speedInput.value) { speedInput.style.display = 'none'; speedSel.style.display = ''; speedSel.value = row.speed || SPEED_PRESETS[ri]; row.speedCustom = false; } });
        table.appendChild(colorCell);
        const spWrap = document.createElement('span'); spWrap.style.cssText = 'display:flex;gap:1px;width:100%'; spWrap.appendChild(speedSel); spWrap.appendChild(speedInput); table.appendChild(spWrap);
        if (isSM) {
          const infoSpan = document.createElement('span');
          infoSpan.style.cssText = 'font-size:7px;color:var(--text-dim);display:flex;align-items:center;padding:0 2px';
          infoSpan.textContent = 'Machine Options';
          table.appendChild(infoSpan);
          row.power = 0;
        } else {
          const powerSel = document.createElement('select');
          powerSel.className = 'bselect';
          powerSel.style.cssText = 'width:100%;height:24px;font-size:11px';
          POWER_PRESETS.forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v + '%'; powerSel.appendChild(o); });
          const custOpt2 = document.createElement('option'); custOpt2.value = 'custom'; custOpt2.textContent = 'Custom'; powerSel.appendChild(custOpt2);
          powerSel.value = row.power;
          powerSel.addEventListener('change', () => {
            if (powerSel.value === 'custom') { row.powerCustom = true; row.power = ''; powerSel.style.display = 'none'; powerInput.style.display = ''; powerInput.focus(); }
            else { row.powerCustom = false; row.power = parseFloat(powerSel.value); powerSel.style.display = ''; powerInput.style.display = 'none'; }
          });
          const powerInput = document.createElement('input');
          powerInput.type = 'number'; powerInput.className = 'cinput';
          powerInput.style.cssText = 'width:100%;height:24px;font-size:11px;display:none';
          powerInput.placeholder = 'S';
          powerInput.addEventListener('change', () => { row.power = parseFloat(powerInput.value) || 0; });
          powerInput.addEventListener('blur', () => { if (!powerInput.value) { powerInput.style.display = 'none'; powerSel.style.display = ''; powerSel.value = row.power || POWER_PRESETS[ri]; row.powerCustom = false; } });
          const pwWrap = document.createElement('span'); pwWrap.style.cssText = 'display:flex;gap:1px;width:100%'; pwWrap.appendChild(powerSel); pwWrap.appendChild(powerInput); table.appendChild(pwWrap);
        }
      }
    };
    ui._speedPowerAssignRow = (ri) => {
      if (!ui._pointsList || ui._focusedPointPos < 0 || ui._focusedPointPos >= ui._pointsList.length) {
        ui.setStatus('Focus a point first (Tab to navigate).', 'error'); return;
      }
      const idx = ui._pointsList[ui._focusedPointPos].idx;
      const row = ui._speedPowerRows[ri];
      ui._speedPowerRows.forEach(r => { r.assignedPoints = r.assignedPoints.filter(p => p !== idx); });
      row.assignedPoints.push(idx);
      state.selectedPoints.add(idx);
      preview._updatePointsInfo();
      preview.draw(state.workingCmds);
      ui._updatePointsPanel();
      ui.setStatus(`Point ${idx + 1} assigned to color ${ri + 1} (F:${row.speed} S:${row.power})`);
    };
    document.getElementById('btnSpeedPowerApply').addEventListener('click', () => {
      if (!state.workingCmds.length) { ui.setStatus('No G-code loaded.', 'error'); return; }
      const tpl = templateManager.getActive(); const td = tpl?.data || tpl;
      const isSM = /SM3/i.test(td?.laserOnCmd || '');
      let changed = false;
      ui._speedPowerRows.forEach(row => {
        row.assignedPoints.forEach(idx => {
          const c = state.workingCmds[idx];
          if (!c || !c.params) return;
          if (row.speed) { c.params.F = row.speed; changed = true; }
          if (!isSM && row.power) { c.params.S = row.power; changed = true; }
        });
      });
      if (changed) {
        preview._segments = null;
        preview.draw(state.workingCmds);
        ui.refreshWorking();
        ui.setStatus('Speed/power applied to assigned points.');
      } else {
        ui.setStatus('No points assigned. Select points first with Tab + color click.', 'error');
      }
    });
    // In keydown, add keys 1,2,3 to assign speed/power colors
    const origKeydown = document.onkeydown;
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      if (e.key === '1' || e.key === '2' || e.key === '3') {
        if (document.getElementById('speedPowerContent')?.style.display !== 'none') {
          ui._speedPowerAssignRow(parseInt(e.key) - 1);
        }
      }
    });

    // ---- Add Point at Minimum Distance ----------------------------------------------------------
    document.getElementById('btnMinDistApply').addEventListener('click', () => {
      if (!state.workingCmds.length) { ui.setStatus('No G-code loaded.', 'error'); return; }
      const minDist = parseFloat(document.getElementById('minDistValue').value);
      if (!minDist || minDist <= 0) { ui.setStatus('Enter a positive distance value.', 'error'); return; }
      const isStartStop = document.getElementById('chkMinDistStartStop').checked;
      const isArcsOnly = document.getElementById('chkMinDistArcsOnly').checked;

      const isArcCmd = (c) => {
        const t = (c.type || '').toUpperCase();
        if (t === 'G2' || t === 'G02' || t === 'G3' || t === 'G03') return true;
        if (c.raw && /ARC/i.test(c.raw)) return true;
        return false;
      };

      const subdivideArcPoints = (prevParams, cmd, dist) => {
        const t = (cmd.type || '').toUpperCase();
        const isSM300Arc = /ARC/i.test(cmd.raw || '');
        const px = prevParams.X, py = prevParams.Y;
        const nx = cmd.params.X, ny = cmd.params.Y;
        let cx, cy, cw;

        if (isSM300Arc) {
          const arcMatch = (cmd.raw || '').toUpperCase().match(/ARC\s*(-?\d+\.?\d*)/);
          if (!arcMatch) return [];
          const angleDeg = parseFloat(arcMatch[1]);
          const angleRad = Math.abs(angleDeg) * Math.PI / 180;
          cw = angleDeg > 0;
          const dx = nx - px, dy = ny - py;
          const chordLen = Math.sqrt(dx*dx + dy*dy);
          if (chordLen < 0.001 || angleRad < 0.001) return [];
          const halfAngle = angleRad / 2;
          const r = chordLen / (2 * Math.sin(halfAngle));
          const d = r * Math.cos(halfAngle);
          const perpX = -dy / chordLen, perpY = dx / chordLen;
          const midX = (px + nx) / 2, midY = (py + ny) / 2;
          if (cw) { cx = midX - d * perpX; cy = midY - d * perpY; }
          else { cx = midX + d * perpX; cy = midY + d * perpY; }
          const rSq = (px - cx)*(px - cx) + (py - cy)*(py - cy);
          const radius = Math.sqrt(rSq);
          if (!isFinite(radius) || radius < 0.000001) return [];
          let a0 = Math.atan2(py - cy, px - cx);
          let a1 = Math.atan2(ny - cy, nx - cx);
          let delta = a1 - a0;
          if (cw) { if (delta >= 0) delta -= Math.PI * 2; }
          else { if (delta <= 0) delta += Math.PI * 2; }
          if (Math.abs(delta) < 0.0000001) return [];
          const arcLen = Math.abs(delta) * radius;
          if (arcLen <= dist) return [];
          const numDiv = Math.ceil(arcLen / dist);
          const points = [];
          for (let s = 1; s <= numDiv - 1; s++) {
            const a = a0 + delta * (s / numDiv);
            points.push({ X: parseFloat((cx + Math.cos(a) * radius).toFixed(4)), Y: parseFloat((cy + Math.sin(a) * radius).toFixed(4)) });
          }
          return points;
        }

        if (t === 'G2' || t === 'G02' || t === 'G3' || t === 'G03') {
          const iVal = cmd.params.I !== undefined ? cmd.params.I : cmd.params.C;
          const jVal = cmd.params.J !== undefined ? cmd.params.J : cmd.params.D;
          if (iVal === undefined && jVal === undefined) return [];
          cx = px + (iVal || 0); cy = py + (jVal || 0);
          cw = (t === 'G2' || t === 'G02');
        } else {
          return [];
        }

        const rSq = (px - cx)*(px - cx) + (py - cy)*(py - cy);
        const radius = Math.sqrt(rSq);
        if (!isFinite(radius) || radius < 0.000001) return [];
        let a0 = Math.atan2(py - cy, px - cx);
        let a1 = Math.atan2(ny - cy, nx - cx);
        let delta = a1 - a0;
        if (cw) { if (delta >= 0) delta -= Math.PI * 2; }
        else { if (delta <= 0) delta += Math.PI * 2; }
        if (Math.abs(delta) < 0.0000001) return [];
        const arcLen = Math.abs(delta) * radius;
        if (arcLen <= dist) return [];
        const numDiv = Math.ceil(arcLen / dist);
        const points = [];
        for (let s = 1; s <= numDiv - 1; s++) {
          const a = a0 + delta * (s / numDiv);
          points.push({ X: parseFloat((cx + Math.cos(a) * radius).toFixed(4)), Y: parseFloat((cy + Math.sin(a) * radius).toFixed(4)) });
        }
        return points;
      };

      // Collect indices of all motion commands (skip G0/G00 rapid moves)
      const moveIndices = [];
      state.workingCmds.forEach((c, i) => {
        if (c.params.X !== undefined && c.params.Y !== undefined) {
          moveIndices.push(i);
        }
      });
      if (moveIndices.length < 2) { ui.setStatus('Need at least 2 motion commands with X,Y.', 'error'); return; }

      // For arcs-only mode: compute curve detection threshold
      let curveThresh = 0;
      if (isArcsOnly) {
        let maxMovDist = 0;
        for (let pi = 1; pi < moveIndices.length; pi++) {
          const prev = state.workingCmds[moveIndices[pi-1]];
          const cmd = state.workingCmds[moveIndices[pi]];
          const dx = cmd.params.X - prev.params.X;
          const dy = cmd.params.Y - prev.params.Y;
          maxMovDist = Math.max(maxMovDist, Math.sqrt(dx*dx + dy*dy));
        }
        curveThresh = maxMovDist * 0.15;
      }

      // Helper: check if a command is a rapid/travel move (not a cut)
      const hasSM3 = state.workingCmds.some(c => c.type === 'SM3');
      // Pre-build tool state map for SM300
      const toolState = new Array(state.workingCmds.length).fill(!hasSM3);
      if (hasSM3) {
        let on = false;
        for (let i = 0; i < state.workingCmds.length; i++) {
          const t = state.workingCmds[i].type || '';
          if (t === 'SM3') on = true;
          else if (t === 'RM3') on = false;
          toolState[i] = on;
        }
      }
      // Find SM300 feedCut threshold for distinguishing travel from cuts
      let smFeedCut = 0;
      if (hasSM3) {
        for (const c of state.workingCmds) {
          if (c.params.F && c.params.F > 0 && c.params.F < 2000) { smFeedCut = c.params.F; break; }
        }
        if (!smFeedCut) smFeedCut = 400;
      }
      const isRapid = (c, idx) => {
        const t = c.type || '';
        if (t === 'G0' || t === 'G00') return true;
        if (hasSM3) {
          if (t === 'SM3' || t === 'RM3') return true;
          // Check tool state and feed rate
          if (!toolState[idx]) return true;
          return c.params.F && c.params.F >= smFeedCut * 2;
        }
        return false;
      };

      if (isStartStop) {
        // Start/Stop mode: collect interpolated points, wrap each with travel+laser-on/off
        const interpPoints = [];
        for (let i = 0; i < state.workingCmds.length; i++) {
          const cmd = state.workingCmds[i];
          const curMove = moveIndices.includes(i);
          if (!curMove) continue;
          const prevIdx = moveIndices.indexOf(i);
          if (prevIdx === 0 || prevIdx < 0) continue;
          const prevMoveIdx = moveIndices[prevIdx - 1];
          const prev = state.workingCmds[prevMoveIdx];
          if (prev.params.X === undefined || prev.params.Y === undefined) continue;
          // Skip rapid commands (travel moves)
          if (isRapid(cmd, i)) continue;
          if (isArcsOnly) {
            const dx = cmd.params.X - prev.params.X;
            const dy = cmd.params.Y - prev.params.Y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < curveThresh && dist > 0) {
              const numDiv = Math.ceil(dist / minDist);
              if (numDiv > 1) {
                const stepX = dx / numDiv;
                const stepY = dy / numDiv;
                for (let s = 1; s <= numDiv - 1; s++) {
                  interpPoints.push({ params: { X: parseFloat((prev.params.X + stepX * s).toFixed(4)), Y: parseFloat((prev.params.Y + stepY * s).toFixed(4)) }, type: 'G1' });
                }
              }
            }
            continue;
          }
          const dx = cmd.params.X - prev.params.X;
          const dy = cmd.params.Y - prev.params.Y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist <= minDist) continue;
          const numDiv = Math.ceil(dist / minDist);
          const stepX = dx / numDiv;
          const stepY = dy / numDiv;
          for (let s = 1; s <= numDiv - 1; s++) {
            const p = { ...cmd.params };
            p.X = parseFloat((prev.params.X + stepX * s).toFixed(4));
            p.Y = parseFloat((prev.params.Y + stepY * s).toFixed(4));
            interpPoints.push({ params: p, type: cmd.type });
          }
        }

        if (!interpPoints.length) {
          ui.setStatus('No intermediate points to add.', 'error');
          return;
        }

        // Get laser pattern
        const tpl = templateManager.getActive();
        const td = tpl?.data || tpl;
        const pat = (td?.laserOnCmd && td?.laserOffCmd)
          ? { on: td.laserOnCmd, off: td.laserOffCmd }
          : ui._detectLaserPatterns();
        const isSM300 = /SM3/i.test(pat.on) || /RM3/i.test(pat.off);
        const smZ = isSM300 ? (td?.focusZ || -220) : 0;

        undoRedo.push(state.workingCmds);
        let result = [...state.workingCmds];

        // Find insert index: after last motion command (before footer)
        let insertIdx = state.workingCmds.length;
        for (let j = state.workingCmds.length - 1; j >= 0; j--) {
          if (state.workingCmds[j].params.X !== undefined && state.workingCmds[j].params.Y !== undefined) {
            insertIdx = j + 1;
            break;
          }
        }

        // Find modal feed rate from the first cut move for Start/Stop points
        let modalCutF = 0;
        for (let k = 0; k < state.workingCmds.length; k++) {
          const ck = state.workingCmds[k];
          if (ck.params.F && ck.params.F > 0 && ck.params.F < 5000) { modalCutF = ck.params.F; break; }
        }
        if (!modalCutF) modalCutF = 400;

        const blankCmd = () => ({ lineIndex: -1, raw: '', type: null, params: {}, comment: '', isBlank: true, isComment: false, blockDelete: false });

        const insertBlock = [];
        for (const pt of interpPoints) {
          // Travel
          const travel = { lineIndex: -1, raw: '', type: isSM300 ? '' : 'G0', params: { X: pt.params.X, Y: pt.params.Y }, comment: 'edit.gc', isBlank: false, isComment: false, blockDelete: false };
          travel.params.F = td?.feedTravel || (isSM300 ? 5000 : 8000);
          if (isSM300 && pt.params.Z !== undefined) travel.params.Z = pt.params.Z;
          else if (isSM300) travel.params.Z = smZ;
          travel._newInsert = true;
          // Laser on
          const onCmd = { lineIndex: -1, raw: '', type: pat.on, params: {}, comment: 'edit.gc', isBlank: false, isComment: false, blockDelete: false, _newInsert: true };
          // Point (cut) — ensure it has the original slow feed rate, not fast travel speed
          const point = { lineIndex: -1, raw: '', type: pt.type, params: { ...pt.params }, comment: 'edit.gc', isBlank: false, isComment: false, blockDelete: false, _newInsert: true };
          if (point.params.F === undefined || point.params.F === 0 || (td?.feedTravel && point.params.F >= td.feedTravel)) {
            point.params.F = modalCutF;
          }
          // Laser off
          const offCmd = { lineIndex: -1, raw: '', type: pat.off, params: {}, comment: 'edit.gc', isBlank: false, isComment: false, blockDelete: false, _newInsert: true };
          insertBlock.push(travel, blankCmd(), onCmd, blankCmd(), point, blankCmd(), offCmd);
        }

        result.splice(insertIdx, 0, ...insertBlock);
        state.workingCmds = result;
        ui.refreshWorking();
        ui.setStatus(`Add Point at Minimum Distance (Start/Stop): ${interpPoints.length} points added.`);
        return;
      }

        // Continuous mode
        undoRedo.push(state.workingCmds);
        const result = [];

        for (let i = 0; i < state.workingCmds.length; i++) {
          const cmd = state.workingCmds[i];
          const curMove = moveIndices.includes(i);

          if (!curMove) {
            result.push(cmd);
            continue;
          }

          // Find previous move index
          const prevIdx = moveIndices.indexOf(i);
          if (prevIdx === 0 || prevIdx < 0) {
            result.push(cmd);
            continue;
          }

          const prevMoveIdx = moveIndices[prevIdx - 1];
          const prev = state.workingCmds[prevMoveIdx];
          if (prev.params.X === undefined || prev.params.Y === undefined) {
            result.push(cmd);
            continue;
          }
          // Always subdivide cut moves (even after rapids)
          if (isRapid(cmd, i)) {
            result.push(cmd);
            continue;
          }

          if (isArcsOnly) {
            const dx = cmd.params.X - prev.params.X;
            const dy = cmd.params.Y - prev.params.Y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < curveThresh && dist > 0) {
              const numDiv = Math.ceil(dist / minDist);
              if (numDiv > 1) {
                const stepX = dx / numDiv;
                const stepY = dy / numDiv;
                for (let s = 1; s <= numDiv - 1; s++) {
                  const p = { ...cmd.params };
                  p.X = parseFloat((prev.params.X + stepX * s).toFixed(4));
                  p.Y = parseFloat((prev.params.Y + stepY * s).toFixed(4));
                  let raw = cmd.type;
                  for (const [k, v] of Object.entries(p)) {
                    raw += ` ${k}${Number.isInteger(v) ? v : parseFloat(v.toFixed(4))}`;
                  }
                  result.push({ ...cmd, params: p, raw });
                }
              }
            }
            result.push(cmd);
            continue;
          }

          const dx = cmd.params.X - prev.params.X;
        const dy = cmd.params.Y - prev.params.Y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= minDist) {
          result.push(cmd);
          continue;
        }

        const numDiv = Math.ceil(dist / minDist);
        const stepX = dx / numDiv;
        const stepY = dy / numDiv;

        for (let s = 1; s <= numDiv - 1; s++) {
          const p = { ...cmd.params };
          p.X = parseFloat((prev.params.X + stepX * s).toFixed(4));
          p.Y = parseFloat((prev.params.Y + stepY * s).toFixed(4));
          let raw = cmd.type;
          for (const [k, v] of Object.entries(p)) {
            raw += ` ${k}${Number.isInteger(v) ? v : parseFloat(v.toFixed(4))}`;
          }
          result.push({ ...cmd, params: p, raw });
        }
        // Add the original endpoint
        result.push(cmd);
      }

      state.workingCmds = result;
      ui.refreshWorking();
      ui.setStatus(`Add Point at Minimum Distance: ${minDist}mm interval applied.`);
    });

    // ---- Points Panel (second sidebar) -----------------------------------------------------------
    ui._pointsPanelOpen = false;
    ui._markStartIdx = 0;
    ui._pointsSide = null;
    ui._pointsAxis = 'X';
    ui._pointsList = [];
    ui._focusedPointPos = -1; // index in _pointsList

    ui._focusPoint = (pos, keepSelection) => {
      const list = ui._pointsList;
      if (!list.length) return;
      if (pos < 0) pos = 0;
      if (pos >= list.length) pos = list.length - 1;
      ui._focusedPointPos = pos;
      const p = list[pos];
      if (!keepSelection) {
        state.selectedPoints.clear();
        state.selectedPoints.add(p.idx);
      }
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
      count.textContent = `${state.selectedPoints.size} of ${points.length} selected`;
      const frag = document.createDocumentFragment();
      points.forEach((p, pi) => {
        const tr = document.createElement('tr');
        const isFocused = pi === ui._focusedPointPos;
        const isMarkStart = p.idx === ui._markStartIdx;
        const isSelected = state.selectedPoints.has(p.idx);
        tr.className = isFocused ? 'focused' : isSelected ? 'multi-sel' : '';
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
        if (row) { row.className = 'focused'; row.scrollIntoView({ block: 'nearest' }); }
      }
    };

    ui._reorderFromMark = (skipMarkStart) => {
      const cmds = state.workingCmds;
      if (!cmds || !cmds.length) return false;
      // Motion: standard G0-G3 OR implicit (SM300: type='' with X/Y params)
      const isMotion = t => /^G[0-3]$|^G0[0-3]$/i.test(t) || (t === '' || t === undefined);
      const motionIdxs = [];
      cmds.forEach((c, i) => { if (isMotion(c.type) && c.params && (c.params.X !== undefined || c.params.Y !== undefined)) motionIdxs.push(i); });
      if (motionIdxs.length < 2) return false;

      let newCmds = cmds.map(c => ({ ...c, params: c.params ? { ...c.params } : {} }));
      let changed = false;

      // Mark Start: rotate motion commands so marked point is first
      if (!skipMarkStart && ui._markStartIdx != null && ui._markStartIdx >= 0) {
        const markPos = motionIdxs.findIndex(i => i >= ui._markStartIdx);
        if (markPos > 0) {
          const motionCmds = motionIdxs.map(i => newCmds[i]);
          const rotated = motionCmds.slice(markPos).concat(motionCmds.slice(0, markPos));
          motionIdxs.forEach((i, idx) => { newCmds[i] = rotated[idx]; });
          changed = true;
        }
        // After rotation, ensure first motion is a G0 travel (never cut from X0Y0
        // with tool on). Insert G0 travel before the first cut command.
        if (changed && motionIdxs.length > 0 && !cmds.some(c => (c.type === '' || c.type === undefined) && c.params && (c.params.X !== undefined || c.params.Y !== undefined))) {
          const firstIdx = motionIdxs[0];
          const firstCmd = newCmds[firstIdx];
          if (firstCmd && !/^G0/i.test(firstCmd.type)) {
            const travel = { type: 'G0', params: { X: firstCmd.params.X, Y: firstCmd.params.Y }, raw: '', isComment: false, isBlank: false };
            if (firstCmd.params.Z !== undefined) travel.params.Z = firstCmd.params.Z;
            newCmds.splice(firstIdx, 0, travel);
            // Update motionIdxs: shift existing indices + prepend travel index
            for (let k = 0; k < motionIdxs.length; k++) {
              if (motionIdxs[k] >= firstIdx) motionIdxs[k]++;
            }
            motionIdxs.unshift(firstIdx);
          }
        }
        // For closed paths after Mark Start: ensure Start = End (both at mark point)
        if (changed && motionIdxs.length > 1 && !ui._pointsSide) {
          const hasImplicit = cmds.some(c => (c.type === '' || c.type === undefined) && c.params && (c.params.X !== undefined));
          const allMotions = motionIdxs.map(i => newCmds[i]);
          // Find first cut destination (the mark point)
          let firstCutDest = null;
          if (hasImplicit) {
            // SM300: first motion = first cut (no G0/G1 distinction)
            const firstMc = allMotions[0];
            if (firstMc && firstMc.params.X !== undefined) firstCutDest = { x: firstMc.params.X, y: firstMc.params.Y };
          } else {
            const firstNonG0 = allMotions.find(c => c && !/^G0/i.test(c.type));
            if (firstNonG0 && firstNonG0.params.X !== undefined) firstCutDest = { x: firstNonG0.params.X, y: firstNonG0.params.Y };
          }
          if (firstCutDest) {
            // Fix last non-G0 (cut) to close at firstCutDest
            const lastNonG0Idx = hasImplicit
              ? motionIdxs[motionIdxs.length - 1]
              : [...motionIdxs].reverse().find(i => newCmds[i] && !/^G0/i.test(newCmds[i].type) && newCmds[i].params && newCmds[i].params.X !== undefined);
            if (lastNonG0Idx !== undefined) {
              const c = newCmds[lastNonG0Idx];
              if (Math.abs(c.params.X - firstCutDest.x) > 0.001 || Math.abs(c.params.Y - firstCutDest.y) > 0.001) {
                newCmds[lastNonG0Idx] = { ...c, params: { ...c.params, X: firstCutDest.x, Y: firstCutDest.y } };
              }
            }
            // Fix last G0 travel to go back to firstCutDest (non-SM300 only)
            if (!hasImplicit) {
              const lastG0Idx = [...motionIdxs].reverse().find(i => /^G0/i.test(newCmds[i]?.type || '') && newCmds[i].params && newCmds[i].params.X !== undefined);
              if (lastG0Idx !== undefined) {
                const g0 = newCmds[lastG0Idx];
                if (Math.abs(g0.params.X - firstCutDest.x) > 0.001 || Math.abs(g0.params.Y - firstCutDest.y) > 0.001) {
                  newCmds[lastG0Idx] = { ...g0, params: { ...g0.params, X: firstCutDest.x, Y: firstCutDest.y } };
                }
              }
            }
          }
        }
      }

      // Set Side: reverse direction, preserving 100% of original path
      if (ui._pointsSide) {
        const motionCmds = motionIdxs.map(i => newCmds[i]);
        const hasImplicit = cmds.some(c => (c.type === '' || c.type === undefined) && c.params && (c.params.X !== undefined || c.params.Y !== undefined));

        // Detect closed path: last cut returns to travel start position
        let isClosed = false;
        if (hasImplicit) {
          // SM300: compare travel start (first motion) with last cut between SM3/RM3
          const sm3Idx = cmds.findIndex(c => /SM3/i.test(c.type));
          const rm3Idx = cmds.findIndex(c => /RM3/i.test(c.type));
          if (sm3Idx >= 0 && rm3Idx > sm3Idx && motionCmds.length > 2) {
            const cutIdxs = motionIdxs.filter(i => i > sm3Idx && i < rm3Idx);
            if (cutIdxs.length > 0) {
              const travelStart = motionCmds[0]; // first motion = travel to start
              const lastCut = newCmds[cutIdxs[cutIdxs.length - 1]];
              isClosed = travelStart && lastCut &&
                         Math.abs(travelStart.params.X - lastCut.params.X) < 0.001 &&
                         Math.abs(travelStart.params.Y - lastCut.params.Y) < 0.001;
            }
          }
        } else {
          // Non-SM300: compare first non-G0 (first cut) vs last non-G0 (last cut)
          // Works for circles (G2/G3 full arc), not for rectangles
          const firstNonG0 = motionCmds.find(c => !/^G0/i.test(c.type));
          const lastNonG0  = [...motionCmds].reverse().find(c => !/^G0/i.test(c.type));
          if (firstNonG0 && lastNonG0 && firstNonG0.params.X !== undefined && lastNonG0.params.X !== undefined) {
            isClosed = Math.abs(firstNonG0.params.X - lastNonG0.params.X) < 0.001 &&
                       Math.abs(firstNonG0.params.Y - lastNonG0.params.Y) < 0.001;
          }
        }

        const reversed = motionCmds.reverse().map(c => {
          if (/^G2/i.test(c.type)) return { ...c, type: 'G3', raw: c.raw.replace(/^G2/i, 'G3') };
          if (/^G3/i.test(c.type)) return { ...c, type: 'G2', raw: c.raw.replace(/^G3/i, 'G2') };
          return c;
        });

        // Replace original motions with reversed
        motionIdxs.forEach((i, idx) => { newCmds[i] = reversed[idx]; });

        // For closed paths: append closing move so path stays 100% closed
        if (isClosed && reversed.length > 1) {
          const firstM = motionIdxs[0];
          const lastM = motionIdxs[motionIdxs.length - 1];
          const closeCmd = { ...reversed[0] };
          closeCmd._newInsert = true;
          newCmds.splice(lastM + 1, 0, closeCmd);
        }
        changed = true;
      }

      if (!changed) return false;
      // Update _markStartIdx to point to first motion (new starting point after reorder)
      if (ui._markStartIdx != null && motionIdxs.length > 0) {
        ui._markStartIdx = motionIdxs[0];
      }
      undoRedo.push(state.workingCmds);
      state.workingCmds = newCmds;
      // Force immediate preview rebuild (skip debounce)
      if (preview._rebuildTimer) { clearTimeout(preview._rebuildTimer); preview._rebuildTimer = null; }
      preview._segments = null;
      preview._segBuilding = false;
      ui._updatePointsPanel();
      ui.refreshWorking();
      return true;
    };

    // Step buttons for Points Editor inputs (data-step-for + data-step-sel + data-down)
    document.querySelectorAll('[data-step-for]').forEach(btn => {
      btn.addEventListener('click', () => {
        const inp = document.getElementById(btn.dataset.stepFor);
        const sel = document.getElementById(btn.dataset.stepSel);
        const step = parseFloat(sel?.value) || 1;
        const cur = parseFloat(inp?.value) || 0;
        if (inp) inp.value = btn.dataset.down ? Math.max(-999999, cur - step).toFixed(3) : (cur + step).toFixed(3);
      });
    });

    document.getElementById('btnMarkStart').addEventListener('click', () => {
      if (!state.selectedPoints.size) { ui.setStatus('Select a point first.', 'error'); return; }
      const idx = [...state.selectedPoints][0];
      ui._markStartIdx = idx;
      const ok = ui._reorderFromMark();
      if (ok) {
        ui.setStatus(`Mark Start: point ${idx + 1} is now the cutting start`);
      } else {
        ui.setStatus(`Mark Start set to point ${idx + 1} (already at start)`, 'error');
      }
    });

    document.getElementById('btnSetSide').addEventListener('click', () => {
      const cur = ui._pointsSide;
      ui._pointsSide = cur === 'left' ? 'right' : cur === 'right' ? null : 'left';
      const btn = document.getElementById('btnSetSide');
      // Detect primary axis from G-code bounds
      ui._pointsAxis = 'X';
      if (state.workingCmds && state.workingCmds.length) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const c of state.workingCmds) {
          if (c.params.X !== undefined) { minX = Math.min(minX, c.params.X); maxX = Math.max(maxX, c.params.X); }
          if (c.params.Y !== undefined) { minY = Math.min(minY, c.params.Y); maxY = Math.max(maxY, c.params.Y); }
        }
        if (isFinite(minX) && isFinite(minY)) {
          const rangeX = maxX - minX;
          const rangeY = maxY - minY;
          ui._pointsAxis = rangeY > rangeX ? 'Y' : 'X';
        }
      }
      if (ui._pointsSide === 'left') {
        btn.textContent = ui._pointsAxis === 'Y' ? '\u2191 Set Side' : '\u2190 Set Side';
        btn.style.background = 'var(--accent2)';
      } else if (ui._pointsSide === 'right') {
        btn.textContent = ui._pointsAxis === 'Y' ? 'Set Side \u2193' : 'Set Side \u2192';
        btn.style.background = 'var(--accent2)';
      } else {
        btn.textContent = 'Set Side \u2192';
        btn.style.background = '';
      }
      const ok = ui._reorderFromMark(true);
      ui.setStatus(ui._pointsSide ? `Side: ${ui._pointsSide}${ok ? ' ⟲ G-code reordered' : ' ⟲ already reversed'}` : 'Side cleared');
    });

    document.getElementById('pointsStep').addEventListener('change', function() {
      const v = parseFloat(this.value);
      ['pointsOffsetX', 'pointsOffsetY', 'pointsOffsetZ'].forEach(id => {
        document.getElementById(id).step = v;
      });
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
    document.getElementById('chkMinDistStartStop').addEventListener('change', e => {
      document.getElementById('toggleMinDistLabel').textContent = e.target.checked ? 'Start/Stop' : 'Continuous';
    });

    document.getElementById('btnPointsGenerate').addEventListener('click', () => {
      if (!state.workingCmds.length || !state.selectedPoints.size) {
        ui.setStatus('Select points on preview first.', 'error'); return;
      }
      const dx = parseFloat(document.getElementById('pointsOffsetX').value) || 0;
      const dy = parseFloat(document.getElementById('pointsOffsetY').value) || 0;
      const dz = parseFloat(document.getElementById('pointsOffsetZ').value) || 0;
      const isStartStop = document.getElementById('chkStartStop').checked;
      // For Along Path (Continuous): move dx along the segment direction
      const getDirAt = (idx) => {
        const segs = preview._segments;
        if (!segs) return null;
        const seg = segs.find(s => s.cmdIdx === idx);
        if (seg) {
          const dx2 = seg.b.x - seg.a.x, dy2 = seg.b.y - seg.a.y;
          const len = Math.hypot(dx2, dy2);
          if (len > 0) return { x: dx2 / len, y: dy2 / len };
        }
        const pos = preview._getPosAt(idx);
        let best = null, bestDist = Infinity;
        for (const s of segs) {
          const d = Math.hypot(s.b.x - pos.x, s.b.y - pos.y);
          if (d < bestDist) { bestDist = d; best = s; }
        }
        if (best) {
          const dx2 = best.b.x - best.a.x, dy2 = best.b.y - best.a.y;
          const len = Math.hypot(dx2, dy2);
          if (len > 0) return { x: dx2 / len, y: dy2 / len };
        }
        return null;
      };
      const applyAlongPath = (copy, idx) => {
        const dir = getDirAt(idx);
        if (dir && (dx !== 0 || dy !== 0)) {
          const pos = preview._getPosAt(idx);
          // Only use dx (along-path distance); dy is forced to 0 so
          // the new point always stays on the original line.
          if (copy.params.X !== undefined) copy.params.X = parseFloat((pos.x + dx * dir.x).toFixed(4));
          if (copy.params.Y !== undefined) copy.params.Y = parseFloat((pos.y + dx * dir.y).toFixed(4));
        } else {
          if (copy.params.X !== undefined) copy.params.X = parseFloat((copy.params.X + dx).toFixed(4));
          if (copy.params.Y !== undefined) copy.params.Y = parseFloat((copy.params.Y + dy).toFixed(4));
        }
        if (copy.params.Z !== undefined) copy.params.Z = parseFloat((copy.params.Z + dz).toFixed(4));
      };
      undoRedo.push(state.workingCmds);
      const sorted = [...state.selectedPoints].sort((a, b) => a - b);
      const pat = isStartStop ? (() => {
        const tpl = templateManager.getActive();
        const td = tpl?.data || tpl;
        if (td?.laserOnCmd && td?.laserOffCmd) return { on: td.laserOnCmd, off: td.laserOffCmd };
        return ui._detectLaserPatterns();
      })() : null;

      if (!isStartStop || !pat) {
        // Continuous mode: always keeps point on path (Along Path)
        const result = [];
        for (let i = 0; i < state.workingCmds.length; i++) {
          result.push(state.workingCmds[i]);
          if (sorted.includes(i)) {
            const c = state.workingCmds[i];
            const copy = JSON.parse(JSON.stringify(c));
            applyAlongPath(copy, i);
            copy.raw = '';
            copy._newInsert = true;
            result.push(copy);
          }
        }
        state.workingCmds = result;
        state.selectedPoints.clear();
        preview._updatePointsInfo();
        // Force-tag only newly inserted lines
        let textCont = gcodeParser.serialize(state.workingCmds);
        const linesCont = textCont.split('\n');
        state.workingCmds.forEach((cmd, i) => {
          if (cmd._newInsert && i < linesCont.length) {
            linesCont[i] = linesCont[i].trimEnd() + '  ;edit.gc';
          }
          delete cmd._newInsert;
        });
        textCont = linesCont.join('\n');
        state._boundsCache = null;
        ui._updateWorkingEditor(textCont);
        applyHighlight(document.getElementById('highlightWorking'), textCont);
        const wm2 = document.getElementById('editorWorkingModal');
        if (wm2) {
          wm2.value = textCont;
          applyHighlight(document.getElementById('highlightWorkingModal'), textCont);
        }
        const dwm = document.getElementById('editorWorkingModalDual');
        if (dwm) {
          dwm.value = textCont;
          applyHighlight(document.getElementById('highlightWorkingModalDual'), textCont);
        }
        preview._segments = null;
        preview.draw(state.workingCmds);
        // Update original modal text (no tags needed)
        const origText = state.originalText || (state.originalCmds.length ? gcodeParser.serialize(state.originalCmds) : '');
        const om = document.getElementById('editorOriginalModal');
        if (om) { om.value = truncateForEditor(origText); applyHighlight(document.getElementById('highlightOriginalModal'), truncateForEditor(origText)); }
        const dom = document.getElementById('editorOriginalModalDual');
        if (dom) { dom.value = truncateForEditor(origText); applyHighlight(document.getElementById('highlightOriginalModalDual'), truncateForEditor(origText)); }
        if (ui.updateResizePanel) ui.updateResizePanel();
        ui.updateFooterInfo();
        ui._updatePointsPanel();
        ui.setStatus(`Added ${sorted.length} point(s) offset X:${dx} Y:${dy} Z:${dz}.`);
        return;
      }

      // Start/Stop mode: each selected point gets its own travel + laser-on + point + laser-off wrapper
      // Insert AFTER the next laser-off command, not at the point's index
      const isLaserOff = (cmd) => {
        const raw = (cmd.raw || '').trim().toUpperCase().split(/\s+/)[0];
        return raw === (pat.off || '').toUpperCase().split(/\s+/)[0];
      };
      const tpl = templateManager.getActive();
      const td = tpl?.data || tpl;
      const isSM300 = /SM3/i.test(pat.on) || /RM3/i.test(pat.off);
      const tag = '  ;edit.gc';

      const blankCmd = () => ({ lineIndex: -1, raw: '', type: null, params: {}, comment: '', isBlank: true, isComment: false, blockDelete: false });

      // Find modal feed rate from the first cut move
      let modalSelF = 0;
      for (let k = 0; k < state.workingCmds.length; k++) {
        const ck = state.workingCmds[k];
        if (ck.params.F && ck.params.F > 0 && ck.params.F < 5000) { modalSelF = ck.params.F; break; }
      }
      if (!modalSelF) modalSelF = 400;

      let result = [...state.workingCmds];
      // Process in reverse order so splicing doesn't shift remaining indices
      const addPoints = [...sorted].reverse();
      for (const idx of addPoints) {
        const c = state.workingCmds[idx];
        const copy = JSON.parse(JSON.stringify(c));
        if (copy.params.X !== undefined) copy.params.X = parseFloat((copy.params.X + dx).toFixed(4));
        if (copy.params.Y !== undefined) copy.params.Y = parseFloat((copy.params.Y + dy).toFixed(4));
        if (copy.params.Z !== undefined) copy.params.Z = parseFloat((copy.params.Z + dz).toFixed(4));
        copy.raw = '';

        // Find next laser-off after this point
        let insertAfter = idx;
        for (let j = idx; j < state.workingCmds.length; j++) {
          if (isLaserOff(state.workingCmds[j])) {
            insertAfter = j;
            break;
          }
        }

        // Build travel command
        const travel = JSON.parse(JSON.stringify(copy));
        if (isSM300) {
          travel.type = '';
          travel.params.F = td?.feedTravel || 5000;
        } else {
          travel.type = 'G0';
          travel.params.F = td?.feedTravel || 8000;
        }
        travel.raw = '';
        if (travel.params.S !== undefined) delete travel.params.S;

        // Point (cut) — ensure it has the original slow feed rate, not fast travel speed
        if (copy.params.F === undefined || copy.params.F === 0 || (td?.feedTravel && copy.params.F >= td.feedTravel)) {
          copy.params.F = modalSelF;
        }

        // Tag all inserted commands via comment field
        travel.comment = 'edit.gc';
        copy.comment = 'edit.gc';
        const onCmd = { lineIndex: -1, raw: '', type: pat.on, params: {}, comment: 'edit.gc', isBlank: false, isComment: false, blockDelete: false };
        const offCmd = { lineIndex: -1, raw: '', type: pat.off, params: {}, comment: 'edit.gc', isBlank: false, isComment: false, blockDelete: false };
        // Mark for ;edit.gc tagging
        const tagCmds = [travel, onCmd, copy, offCmd];
        tagCmds.forEach(cmd => cmd._newInsert = true);

        const insertBlock = [travel, blankCmd(), onCmd, blankCmd(), copy, blankCmd(), offCmd];
        result.splice(insertAfter + 1, 0, ...insertBlock);
      }

      state.workingCmds = result;
      state.selectedPoints.clear();
      preview._updatePointsInfo();

      // Serialize and force-tag only the newly inserted lines
      let text = gcodeParser.serialize(state.workingCmds);
      const lines = text.split('\n');
      state.workingCmds.forEach((cmd, i) => {
        if (cmd._newInsert && i < lines.length) {
          lines[i] = lines[i].replace(/\s*;\s*edit\.gc/g, '').trimEnd() + '  ;edit.gc';
        }
        delete cmd._newInsert;
      });
      text = lines.join('\n');
      state._boundsCache = null;
      ui._updateWorkingEditor(text);
      applyHighlight(document.getElementById('highlightWorking'), text);
      const wm = document.getElementById('editorWorkingModal');
      if (wm) {
        wm.value = text;
        applyHighlight(document.getElementById('highlightWorkingModal'), text);
      }
      const dwm = document.getElementById('editorWorkingModalDual');
      if (dwm) {
        dwm.value = text;
        applyHighlight(document.getElementById('highlightWorkingModalDual'), text);
      }
      preview._segments = null;
      preview.draw(state.workingCmds);
      // Update original modal text
      const origText = state.originalText || (state.originalCmds.length ? gcodeParser.serialize(state.originalCmds) : '');
      const om = document.getElementById('editorOriginalModal');
      if (om) { om.value = truncateForEditor(origText); applyHighlight(document.getElementById('highlightOriginalModal'), truncateForEditor(origText)); }
      const dom = document.getElementById('editorOriginalModalDual');
      if (dom) { dom.value = truncateForEditor(origText); applyHighlight(document.getElementById('highlightOriginalModalDual'), truncateForEditor(origText)); }
      if (ui.updateResizePanel) ui.updateResizePanel();
      ui.updateFooterInfo();
      ui._updatePointsPanel();
      ui.setStatus(`Added ${sorted.length} point(s) offset X:${dx} Y:${dy} Z:${dz} (Start/Stop).`);
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

    // Machine Options toggle
    document.getElementById('btnToggleMachineOptions').addEventListener('click', () => {
      const body = document.getElementById('machineOptionsBody');
      const btn = document.getElementById('btnToggleMachineOptions');
      const open = body.classList.toggle('collapsed');
      btn.textContent = open ? '\u25B6' : '\u25BE';
      if (!open) ui._populateMachineOptions();
    });

    // ---- Keyboard Shortcuts --------------------------------------------------------------------------
    document.addEventListener('keydown', e => {
      // Ctrl+O ? Open G-code
      if (e.ctrlKey && !e.shiftKey && e.key === 'o') {
        e.preventDefault();
        document.getElementById('fileInputGcode').click();
      }
      // Ctrl+Shift+S ? Save As
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        document.getElementById('btnSaveAs').click();
      }
      // Space ? Play/Pause (unless in input/textarea or points panel open)
      if (e.key === ' ' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA' && !ui._pointsPanelOpen) {
        e.preventDefault();
        if (preview._pb.active && !preview._pb.paused) preview.pause();
        else preview.play();
      }
      // Esc ? Stop
      if (e.key === 'Escape' && e.target.tagName !== 'TEXTAREA') {
        preview.stop();
      }
      // + / - ? Zoom (only when not in input/textarea)
      if ((e.key === '+' || e.key === '=') && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        state.previewScale *= 1.15;
        preview.draw(state.workingCmds);
      }
      if (e.key === '-' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        state.previewScale *= 0.85;
        preview.draw(state.workingCmds);
      }
      // Arrow keys / WASD ? pan (skip arrows when points panel is open)
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
      // Home ? Fit view
      if (e.key === 'Home' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        preview.fitView();
      }
      // Tab / Shift+Tab ? navigate points in table (keep selection)
      if (e.key === 'Tab' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        const list = ui._pointsList;
        if (!list.length) return;
        if (ui._focusedPointPos < 0) {
          ui._focusPoint(e.shiftKey ? list.length - 1 : 0, true);
        } else {
          ui._focusPoint(e.shiftKey ? ui._focusedPointPos - 1 : ui._focusedPointPos + 1, true);
        }
      }
      // Arrow Up/Down ? navigate points in table (keep selection)
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && ui._pointsPanelOpen && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        const list = ui._pointsList;
        if (!list.length) return;
        if (e.key === 'ArrowUp') {
          ui._focusPoint(ui._focusedPointPos <= 0 ? 0 : ui._focusedPointPos - 1, true);
        } else {
          ui._focusPoint(ui._focusedPointPos >= list.length - 1 ? list.length - 1 : ui._focusedPointPos + 1, true);
        }
      }
      // Space ? toggle multi-select of focused point (only when points panel open)
      if (e.key === ' ' && ui._pointsPanelOpen && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        const list = ui._pointsList;
        if (!list.length || ui._focusedPointPos < 0 || ui._focusedPointPos >= list.length) return;
        const idx = list[ui._focusedPointPos].idx;
        if (state.selectedPoints.has(idx) && state.selectedPoints.size > 1) {
          state.selectedPoints.delete(idx);
        } else {
          state.selectedPoints.add(idx);
        }
        preview._updatePointsInfo();
        preview.draw(state.workingCmds);
        ui._updatePointsPanel();
      }
    });

    // ---- Drag & Drop ----------------------------------------------------------------------------------------
    setupDragDrop(document.getElementById('preview-area'));

    // ---- Init UI --------------------------------------------------------------------------------------------------
    templateManager.loadBuiltin();
    preview.init(document.getElementById('previewCanvas'));
    ui.refreshTemplateList();
    ui._speedPowerInit();
    settings.applyAll();
    // Clean corrupted machineOpts (empty strings from old _getSelectedMachineOpts bug)
    try {
      Object.keys(localStorage).filter(k => k.startsWith('machineOpts_')).forEach(k => {
        const val = JSON.parse(localStorage.getItem(k));
        if (val && typeof val === 'object') {
          const cleaned = {};
          Object.keys(val).forEach(id => { if (val[id] !== '') cleaned[id] = val[id]; });
          localStorage.setItem(k, JSON.stringify(cleaned));
        }
      });
    } catch (_) {}
    ui._populateMachineOptions();
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

    // ---- Sidebar widget management ------------------------------------------??------------
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
    if (state.originalCmds && state.originalCmds.length) {
      const lines = text.split('\n');
      state.workingCmds.forEach((cmd, i) => {
        if (i >= lines.length) return;
        let edited = false;
        if (cmd._newInsert) {
          edited = true;
          delete cmd._newInsert;
        } else if (i < state.originalCmds.length) {
          const orig = state.originalCmds[i];
          const cmdP = { ...cmd.params }; delete cmdP.N;
          const origP = { ...orig.params }; delete origP.N;
          // Round all numeric values to 4 decimal places for comparison
          const round = (o) => { const r = {}; for (const [k, v] of Object.entries(o)) { r[k] = typeof v === 'number' ? parseFloat(v.toFixed(4)) : v; } return r; };
          edited = JSON.stringify(round(cmdP)) !== JSON.stringify(round(origP)) || cmd.type !== orig.type;
        }
        // Commands past originalCmds.length are shifted from insertion, not edited.
        // Only tag them if explicitly marked with _newInsert.
        if (edited) {
          lines[i] = lines[i].replace(/\s*;\s*edit\.gc/g, '').trimEnd() + '  ;edit.gc';
        }
      });
      text = lines.join('\n');
    }
    this._isRefreshing = true;
    this._updateWorkingEditor(text);
    applyHighlight(document.getElementById('highlightWorking'), text);
    const wm = document.getElementById('editorWorkingModal');
    if (wm) {
      const tWork = truncateForEditor(text);
      wm.value = tWork;
      applyHighlight(document.getElementById('highlightWorkingModal'), tWork);
    }
    this._isRefreshing = false;
    preview.draw(state.workingCmds);
    // Sync original modal (working already done above)
    const origText = state.originalText || (state.originalCmds.length ? gcodeParser.serialize(state.originalCmds) : '');
    const om = document.getElementById('editorOriginalModal');
    if (om) {
      const tOrig = truncateForEditor(origText);
      om.value = tOrig;
      applyHighlight(document.getElementById('highlightOriginalModal'), tOrig);
    }
    // Update dual view editors
    const dwm = document.getElementById('editorWorkingModalDual');
    if (dwm) {
      const tWork = truncateForEditor(text);
      dwm.value = tWork;
      applyHighlight(document.getElementById('highlightWorkingModalDual'), tWork);
    }
    const dom = document.getElementById('editorOriginalModalDual');
    if (dom) {
      const tOrig = truncateForEditor(origText);
      dom.value = tOrig;
      applyHighlight(document.getElementById('highlightOriginalModalDual'), tOrig);
    }
    if (ui.updateResizePanel) ui.updateResizePanel();
    ui.updateFooterInfo();
    state.dirty = true;
  },

  updateResizePanel() {
    const b = preview._getBounds(state.workingCmds);
    if (!b) return;
    const w = b.rangeX, h = b.rangeY;
    state.resizeBaseW = w;
    state.resizeBaseH = h;
    document.getElementById('resizeW').value = w.toFixed(3);
    const hEl = document.getElementById('resizeHDisplay'); if (hEl) hEl.textContent = h.toFixed(3);
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
    sel.innerHTML = '<option value="">-- Templates --</option>';
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
      if (iName) iName.textContent = '?';
    }
    if (hasGcode) {
      const unitsCmd = state.workingCmds.find(c => c.type === 'G20' || c.type === 'G21');
      const modeCmd  = state.workingCmds.find(c => c.type === 'G90' || c.type === 'G91');
      let units = unitsCmd ? (unitsCmd.type === 'G21' ? 'mm' : 'in') : 'mm';
      let mode = modeCmd ? (modeCmd.type === 'G90' ? 'ABS' : 'REL') : 'ABS';
      const unitsLabel = unitsCmd ? `${unitsCmd.type} (${units})` : `default (${units})`;
      const modeLabel = modeCmd ? `${modeCmd.type} (${mode})` : `default (${mode})`;
      if (iUnits) iUnits.textContent = `Units: ${unitsLabel} | Mode: ${modeLabel}`;
      const total = state.workingCmds.length;
      const cuts = state.workingCmds.filter(c => c.type === 'G1' || c.type === 'G01').length;
      let rapids = state.workingCmds.filter(c => c.type === 'G0' || c.type === 'G00').length;
      const arcs2 = state.workingCmds.filter(c => c.type === 'G2' || c.type === 'G02').length;
      const arcs3 = state.workingCmds.filter(c => c.type === 'G3' || c.type === 'G03').length;
      let implicit = 0;
      if (!cuts && !rapids && !arcs2 && !arcs3) {
        implicit = state.workingCmds.filter(c => c.type === '' && (c.x != null || c.y != null || c.z != null)).length;
      }
      if (iLines) iLines.textContent = `Lines: ${total.toLocaleString()}  G1: ${cuts}  G0: ${rapids}  G2: ${arcs2}  G3: ${arcs3}${implicit ? `  Implicit: ${implicit}` : ''}`;
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
        } else if (iTime) iTime.textContent = 'Est. time: ?';
      } else {
        if (iDist) iDist.textContent = 'Build preview for distances...';
        if (iTime) iTime.textContent = '';
      }
      if (iWarn) {
        const analysis = gcodeParser.analyzeFull(state.workingCmds);
        const warns = [];
        if (analysis.unknownCmds.length) warns.push(`Unknown: ${analysis.unknownCmds.join(', ')}`);
        if (!unitsCmd) warns.push('No G20/G21 (assuming mm)');
        if (!modeCmd)  warns.push('No G90/G91 (assuming ABS)');
        if (cuts === 0 && !implicit) warns.push('No G1 moves (nothing to cut)');
        iWarn.textContent = warns.length ? warns.join('  |  ') : '';
        iWarn.style.color = warns.length ? '#d97706' : 'var(--text-dim)';
      }
    } else {
      if (iUnits) iUnits.textContent = '?';
      if (iLines) iLines.textContent = '?';
      if (iDist)  iDist.textContent = '?';
      if (iTime)  iTime.textContent = '?';
      if (iWarn)  iWarn.textContent = '?';
    }
    // Footer stays clean ? all info is in Gcode Info widget
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
    // Textarea click ? backplot
    document.getElementById('editorWorking').addEventListener('click', function() {
      const idx = this.selectionStart;
      const lineNo = this.value.substring(0, idx).split('\n').length - 1;
      if (lineNo >= 0 && lineNo < state.workingCmds.length) {
        preview.highlightLine(lineNo);
      }
    });
    // VirtualEditor click ? backplot
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
    el.style.color = type === 'error' ? '#c00' : '#000';
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

  // ---- Machine Options -----------------------------------------------------------------------
  _getMachineOptsKey() {
    const name = document.getElementById('templateSelect')?.value || 'default';
    return 'machineOpts_' + name;
  },

  _loadMachineOpts() {
    const saved = (() => { try { return JSON.parse(localStorage.getItem(this._getMachineOptsKey())); } catch (_) { return null; } })() || {};
    const name = document.getElementById('templateSelect')?.value;
    const optDefs = templateManager.getTemplateOptions(name);
    const result = { ...saved };
    optDefs.forEach(group => {
      group.options.forEach(opt => {
        if (result[opt.id] == null || result[opt.id] === '') {
          result[opt.id] = opt.default;
        }
      });
    });
    return result;
  },

  _saveMachineOpts(opts) {
    try { localStorage.setItem(this._getMachineOptsKey(), JSON.stringify(opts)); } catch (_) {}
  },

  _getSelectedMachineOpts() {
    const body = document.getElementById('machineOptionsBody');
    if (!body) return {};
    const opts = {};
    body.querySelectorAll('select[data-opt-id]').forEach(sel => {
      if (sel.value === '__custom__') {
        const container = sel.closest('.mo-container');
        const inp = container?.querySelector('.mo-custom-input');
        opts[sel.dataset.optId] = inp ? inp.value : sel.value;
      } else {
        opts[sel.dataset.optId] = sel.value;
      }
    });
    body.querySelectorAll('.mo-custom-input:not(.mo-hidden)').forEach(inp => {
      const id = inp.dataset.optId;
      if (id && !opts[id]) opts[id] = inp.value;
    });
    try {
      body.querySelectorAll('input[type="number"][data-opt-id]:not(.mo-custom-input)').forEach(inp => {
        opts[inp.dataset.optId] = inp.value;
      });
    } catch (_) {}
    return opts;
  },

  _populateMachineOptions() {
    const body = document.getElementById('machineOptionsBody');
    if (!body) return;
    const name = document.getElementById('templateSelect')?.value;
    const optDefs = templateManager.getTemplateOptions(name);
    const saved = this._loadMachineOpts();
    if (!optDefs.length) {
      body.innerHTML = '<span class="clabel">No options for this template</span>';
      return;
    }
    let html = '';
    optDefs.forEach(group => {
      html += `<span class="clabel" style="width:100%;font-weight:600;margin-top:4px">${group.section}</span>`;
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;width:100%">';
      group.options.forEach(opt => {
        const val = saved[opt.id] != null ? saved[opt.id] : opt.default;
          if (opt.type === 'number') {
            html += `<label class="clabel mo-container" style="display:flex;align-items:center;gap:3px">${opt.label}`;
          html += `<input type="number" class="cinput" data-opt-id="${opt.id}" value="${val}" style="width:70px;height:18px;font-size:10px;padding:0 4px;border:1px solid var(--border2);border-radius:3px;background:#fff" />`;
          html += `<span style="font-size:9px;color:var(--text-dim)">${opt.unit || ''}</span>`;
          html += '</label>';
          return;
        }
        const isCustom = !opt.values.some(v => String(v) === String(val));
        html += `<label class="clabel mo-container" style="display:flex;align-items:center;gap:3px">${opt.label}`;
        html += `<select class="bselect" data-opt-id="${opt.id}" style="width:auto;min-width:0;max-width:100px;height:18px;font-size:10px">`;
        opt.values.forEach(v => {
          const sel = String(v) === String(val) ? ' selected' : '';
          html += `<option value="${v}"${sel}>${v}${opt.unit ? ' ' + opt.unit : ''}</option>`;
        });
        html += `<option value="__custom__"${isCustom ? ' selected' : ''}>Custom...</option>`;
        html += '</select>';
        const hiddenClass = isCustom ? '' : ' mo-hidden';
        html += `<input type="number" class="mo-custom-input${hiddenClass}" data-opt-id="${opt.id}" value="${isCustom ? val : ''}" style="width:70px;height:18px;font-size:10px;padding:0 4px;border:1px solid var(--border2);border-radius:3px;background:#fff" />`;
        html += '</label>';
      });
      html += '</div>';
    });
    body.innerHTML = html;
    // Add Defaults button
    const btnDiv = document.createElement('div');
    btnDiv.style.cssText = 'display:flex;width:100%;margin-top:4px';
    const btn = document.createElement('button');
    btn.className = 'btn-action';
    btn.textContent = 'Defaults';
    btn.title = 'Reset all machine options to defaults for this template';
    btn.addEventListener('click', () => {
      const key = ui._getMachineOptsKey();
      localStorage.removeItem(key);
      ui._populateMachineOptions();
      ui.setStatus('Machine options reset to defaults.');
    });
    btnDiv.appendChild(btn);
    body.appendChild(btnDiv);
    body.querySelectorAll('select[data-opt-id]').forEach(sel => {
      sel.addEventListener('change', () => {
        const container = sel.closest('.mo-container');
        const inp = container?.querySelector('.mo-custom-input');
        if (!inp) return;
        if (sel.value === '__custom__') {
          inp.classList.remove('mo-hidden');
          inp.focus();
        } else {
          inp.classList.add('mo-hidden');
        }
        this._saveMachineOpts(this._getSelectedMachineOpts());
      });
    });
    body.querySelectorAll('.mo-custom-input').forEach(inp => {
      inp.addEventListener('input', () => {
        this._saveMachineOpts(this._getSelectedMachineOpts());
      });
    });
    body.querySelectorAll('input[type="number"][data-opt-id]').forEach(inp => {
      inp.addEventListener('change', () => {
        this._saveMachineOpts(this._getSelectedMachineOpts());
      });
      inp.addEventListener('change', () => {
        this._saveMachineOpts(this._getSelectedMachineOpts());
      });
    });
  },

  _buildProcessedTemplate() {
    const tpl = templateManager.getActive();
    if (!tpl) return null;
    const opts = this._loadMachineOpts();
    return templateManager.applyToSvgConverter(tpl, opts);
  },

  _regenerateFromSource() {
    const processed = this._buildProcessedTemplate();
    if (!processed) return;
    const feedCut = processed.laser?.feedCut || 3000;
    const feedTravel = processed.laser?.feedTravel || 8000;
    let cmds;
    if (state.mode === 'svg' && state.svgSegments && state.svgSegments.length) {
      const hMm = state.svgDims?.height || 0;
      cmds = svgConverter.segmentsToGcode(state.svgSegments, processed, hMm || undefined);
    } else if (state.mode === 'dxf' && state.dxfSegments && state.dxfSegments.length) {
      cmds = svgConverter.segmentsToGcode(state.dxfSegments, processed);
    } else {
      return;
    }
    if (!cmds || !cmds.length) return;
    const tw = parseFloat(document.getElementById('resizeW').value);
    if (tw && state.resizeBaseW) {
      const ratio = state.resizeBaseH / state.resizeBaseW;
      const th = tw * ratio;
      if (state.mode === 'svg' && state.svgDims?.width) {
        const fx = tw / state.svgDims.width, fy = th / state.svgDims.height;
        cmds = (Math.abs(fx - fy) < 0.0001)
          ? gcodeParser.scaleCommands(cmds, fx)
          : gcodeParser.scaleCommandsXY(cmds, fx, fy);
      } else if (state.mode === 'dxf' && state.dxfSegments) {
        const all = state.dxfSegments.flat();
        const xs = all.map(p => p.x), ys = all.map(p => p.y);
        const m1 = safeMinMax(xs), m2 = safeMinMax(ys);
        const curW = m1.max - m1.min || 1, curH = m2.max - m2.min || 1;
        const fx = tw / curW, fy = th / curH;
        cmds = (Math.abs(fx - fy) < 0.0001)
          ? gcodeParser.scaleCommands(cmds, fx)
          : gcodeParser.scaleCommandsXY(cmds, fx, fy);
      }
    }
    const gcode = gcodeParser.serialize(cmds);
    state.workingCmds = cmds;
    state.originalCmds = cmds.map(c => ({ ...c }));
    state.originalText = gcode;
    document.getElementById('editorOriginal').value = gcode;
    ui._updateWorkingEditor(gcode);
    applyHighlight(document.getElementById('highlightOriginal'), gcode);
    applyHighlight(document.getElementById('highlightWorking'), gcode);
    ui.syncModals();
    preview.resize();
  },

  async _loadSvgFile(file) {
    const text = await fileManager.readGcode(file);
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
    } catch (_) {}

    state.svgDims = { width: dimW, height: dimH };
    state.svgText = text;
    state.svgSegments = null;
    state.mode    = 'svg';

    const blob = new Blob([text], { type: 'image/svg+xml' });
    const url  = URL.createObjectURL(blob);
    const img  = new Image();
    img.onload = () => {
      state.svgImg = img;
      URL.revokeObjectURL(url);
      state.previewScale = 1;
      state.previewOffX  = 0;
      state.previewOffY  = 0;
      document.getElementById('btnSlice').disabled = false;
      state.resizeBaseW = dimW;
      state.resizeBaseH = dimH;
      document.getElementById('resizeW').value = dimW.toFixed(3);
      const hEl1 = document.getElementById('resizeHDisplay'); if (hEl1) hEl1.textContent = dimH.toFixed(3);
      preview.resize();
      ui.setStatus(`SVG: ${file.name}  W: ${dimW.toFixed(1)} ? H: ${dimH.toFixed(1)} ? click "Convert" to generate G-code`);
      recentFiles.add(file.name, 'SVG', text);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      ui.setStatus(`Error loading SVG: ${file.name}`, 'error');
    };
    img.src = url;
  },

  async _loadDxfFile(file) {
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
    const hEl2 = document.getElementById('resizeHDisplay'); if (hEl2) hEl2.textContent = h.toFixed(3);
    document.getElementById('btnSlice').disabled = false;
    preview.draw();
    ui.setStatus(`DXF: ${file.name} ? ${segments.length} segments, ${all.length} points`);
  },
};

window.ui = ui;
