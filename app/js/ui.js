// â”€â”€ uiController â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const ui = {
  init() {
    // Abrir G-code
    document.getElementById('fileInputGcode').addEventListener('change', async e => {
      const file = e.target.files[0]; if (!file) return;
      e.target.value = ''; // permite reabrir o mesmo ficheiro
      ui.setProgress(2, 'Reading file…');
      const text = await fileManager.readGcode(file);
      ui.setProgress(30, 'Parsing…');
      state.originalCmds  = gcodeParser.parse(text);
      ui.setProgress(50, 'Preparing editor…');
      const isLarge = text.length > 5 * 1024 * 1024
      const isHuge = text.length > 50 * 1024 * 1024;
      state.originalText  = isLarge ? '' : text;
      state.originalName  = file.name;
      state.workingCmds   = state.originalCmds.map(c => ({ ...c }));
      state.dirty         = false;
      // reset zoom/pan para auto-fit ao novo ficheiro
      state.previewScale  = 1;
      state.previewOffX   = 0;
      state.previewOffY   = 0;
      const origEditorText = isLarge ? '(original text too large for editor)' : truncateForEditor(text);
      document.getElementById('editorOriginal').value = origEditorText;
      ui._updateWorkingEditor(gcodeParser.serialize(state.workingCmds));
      ui.setProgress(70, 'Applying syntax highlight…');
      const origHLText = isLarge ? '' : text;
      const workHLText = gcodeParser.serialize(state.workingCmds);
      applyHighlight(document.getElementById('highlightOriginal'), origHLText);
      applyHighlight(document.getElementById('highlightWorking'), workHLText);
      ui.setProgress(90, 'Rendering…');
      preview.resize(); // garante dimensÃµes do canvas e faz draw
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
      recentFiles.add(file.name, 'G-code');
      document.getElementById('btnConvertSvg').disabled = true;
      document.getElementById('btnConvertDxf').disabled = true;
    });

    // â”€â”€ Preview playback buttons (main + modal) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const _syncSpeed = src => {
      const v = src.value;
      document.getElementById('playSpeed').value  = v;
      document.getElementById('mPlaySpeed').value = v;
    };
    document.getElementById('playSpeed').addEventListener('input',  e => _syncSpeed(e.target));
    document.getElementById('mPlaySpeed').addEventListener('input', e => _syncSpeed(e.target));

    document.getElementById('btnPlay').addEventListener('click',   () => preview.play());
    document.getElementById('btnPause').addEventListener('click',  () => preview.pause());
    document.getElementById('btnStop').addEventListener('click',   () => preview.stop());
    document.getElementById('btnZoomFit').addEventListener('click', () => preview.fitView());
    document.getElementById('btnPick').addEventListener('click', () => {
      pickMode = !pickMode;
      if (!pickMode) { document.getElementById('btnPick').style.background = ''; ui.setStatus('Pick mode off.'); }
      else { document.getElementById('btnPick').style.background = 'var(--accent2)'; ui.setStatus('Pick mode: click on preview to insert G1 X Y at cursor'); }
    });
    document.getElementById('btnMeasure').addEventListener('click', () => {
      measureMode = !measureMode;
      if (!measureMode) { measureStart = null; measureEnd = null; preview.draw(state.workingCmds); }
      document.getElementById('btnMeasure').style.background = measureMode ? 'var(--accent2)' : '';
      ui.setStatus(measureMode ? 'Measure mode: click start point on canvas' : 'Measure mode off.');
    });
    document.getElementById('playProgress').addEventListener('input', function() {
      const cmds = state.workingCmds;
      const total = cmds ? cmds.length : 0;
      const idx = Math.round(parseInt(this.value) / 100 * total);
      if (preview._pb.active) preview.stop();
      preview._drawCore(cmds, idx);
      preview._drawHead(cmds, idx);
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
        recentFiles.add(file.name, 'SVG');
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
        state.originalText = gcode.length > 5 * 1024 * 1024 ? '' : text;
        state.originalName = baseName;
        state.dirty = false;
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
      const ext  = state.originalName ? state.originalName.split('.').pop() : 'gcode';
      const base = state.originalName ? state.originalName.replace(/\.[^.]+$/, '') : 'output';
      fileManager.downloadGcode(gcodeParser.serialize(state.workingCmds), `${base}.${ext}`);
      state.dirty = false;
      ui.setStatus(`Saved: ${base}.${ext}`);
    });

    // Salvar como (nativo)
    document.getElementById('btnSaveAs').addEventListener('click', async () => {
      if (!state.workingCmds.length) { ui.setStatus('Nothing to save.', 'error'); return; }
      const defaultName = state.originalName ? state.originalName.replace(/\.[^.]+$/, '') : 'output';
      const content = gcodeParser.serialize(state.workingCmds);
      // File System Access API (nativo)
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: defaultName + '.gcode',
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
        fileManager.downloadGcode(content, defaultName + '.gcode');
        state.dirty = false;
        ui.setStatus(`Saved: ${defaultName}.gcode`);
      }
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
      if (e.ctrlKey && !e.shiftKey && e.key === 'z') { document.getElementById('btnUndo').click(); }
      if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { document.getElementById('btnRedo').click(); }
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

    // â”€â”€ Scale widget â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    const _scaleFactor = factor => {
      const b = _getBounds();
      if (!b || !b.rangeX || !b.rangeY) { ui.setStatus('No G-code loaded.', 'error'); return; }
      undoRedo.push(state.workingCmds);
      state.workingCmds = gcodeParser.scaleCommands(state.workingCmds, factor);
      ui.refreshWorking();
      const newW = b.rangeX * factor;
      const newH = b.rangeY * factor;
      state.resizeBaseW = newW;
      state.resizeBaseH = newH;
      document.getElementById('resizeW').value = newW.toFixed(3);
      document.getElementById('resizeH').value = newH.toFixed(3);
      ui.setStatus(`Scaled ${factor >= 1 ? 'up' : 'down'} by ${Math.abs((factor - 1) * 100).toFixed(1)}% → ${newW.toFixed(3)} × ${newH.toFixed(3)} mm`);
    };

    document.getElementById('btnScaleUp').addEventListener('click', () => _scaleFactor(1.05));
    document.getElementById('btnScaleDown').addEventListener('click', () => _scaleFactor(0.95));

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
        state.svgScale = tw / curW;
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

    // â”€â”€ Template Widget â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const templateSelector = document.getElementById('templateSelect');
    const btnImportTemplate = document.getElementById('btnImportTemplate');
    const fileInputTemplate = document.getElementById('fileInputTemplate');

    // Extract template (strip coordinates)
    document.getElementById('btnExtractTemplate').addEventListener('click', () => {
      if (!state.workingCmds.length) { ui.setStatus('Open a G-code file first.', 'error'); return; }
      const name = prompt('Template name:', 'pattern');
      if (!name) return;
      const content = templateManager.extractFromCommands(state.workingCmds);
      templateManager.save(name, content);
      templateManager.downloadTemplate(name, content);
      ui.refreshTemplateList();
      ui.setStatus(`Template "${name}" extracted and saved.`);
    });

    // Save current working gcode as template
    document.getElementById('btnSaveTemplate').addEventListener('click', () => {
      if (!state.workingCmds.length) { ui.setStatus('No G-code to save.', 'error'); return; }
      const name = prompt('Template name:', state.originalName ? state.originalName.replace(/\.[^.]+$/, '') : 'template');
      if (!name) return;
      const content = gcodeParser.serialize(state.workingCmds);
      templateManager.save(name, content);
      templateManager.downloadTemplate(name, content);
      ui.refreshTemplateList();
      ui.setStatus(`Template "${name}" saved.`);
    });

    // Apply: load selected template into working editor
    document.getElementById('btnApplyTemplate').addEventListener('click', () => {
      const name = templateSelector.value;
      if (!name) { ui.setStatus('Select a template first.', 'error'); return; }
      const content = templateManager.load(name);
      if (!content) { ui.setStatus('Template not found.', 'error'); return; }
      undoRedo.push(state.workingCmds);
      state.workingCmds = gcodeParser.parse(content);
      state.originalText = content;
      state.previewScale = 1;
      state.previewOffX = 0;
      state.previewOffY = 0;
      ui.refreshWorking();
      ui.setStatus(`Template "${name}" loaded.`);
    });

    // Template select
    templateSelector.addEventListener('change', e => {
      const name = e.target.value;
      ui.setStatus(name ? `Selected template: ${name}` : 'No template selected.');
      ui.updateTemplateIndicator();
    });

    // Import template from file
    if (btnImportTemplate && fileInputTemplate) {
      btnImportTemplate.addEventListener('click', () => fileInputTemplate.click());
      fileInputTemplate.addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) return;
        e.target.value = '';
        try {
          const text = await fileManager.readGcode(file);
          const name = file.name.replace(/\.[^.]+$/, '');
          templateManager.save(name, text);
          ui.refreshTemplateList();
          templateSelector.value = name;
          ui.setStatus(`Template imported: ${name}`);
        } catch (err) {
          ui.setStatus(`Import error: ${err.message}`, 'error');
        }
      });
    }

    // Open templates folder (File System Access API if supported)
    document.getElementById('btnOpenTemplatesFolder').addEventListener('click', async () => {
      try {
        if (!window.showDirectoryPicker) {
          ui.setStatus('File System Access API not supported in this browser.', 'error');
          return;
        }
        const dirHandle = await window.showDirectoryPicker({ id: 'editgc-templates', mode: 'read' });
        const names = [];
        for await (const [name, handle] of dirHandle) {
          if (handle.kind === 'file' && (name.endsWith('.gcode') || name.endsWith('.txt'))) {
            const file = await handle.getFile();
            const text = await file.text();
            const tplName = name.replace(/\.[^.]+$/, '');
            templateManager.save(tplName, text);
            names.push(tplName);
          }
        }
        ui.refreshTemplateList();
        ui.setStatus(`Loaded ${names.length} template(s) from folder.`);
      } catch (err) {
        if (err.name !== 'AbortError' && err.name !== 'SecurityError') {
          ui.setStatus('Error opening folder.', 'error');
        }
      }
    });

    // Working editor → sync state (debounced)
    let _editTimer = null;
    const _onWorkingInput = (text) => {
      if (_editTimer) clearTimeout(_editTimer);
      _editTimer = setTimeout(() => {
        if (!state._duringUndoRedo) {
          undoRedo.push(state.workingCmds);
        }
        state.workingCmds = gcodeParser.parse(text);
        state._boundsCache = null;
        state.dirty = true;
        preview.draw(state.workingCmds);
        ui.syncModals();
        ui.updateFooterInfo();
        ui.updateResizePanel();
      }, 300);
    };
    document.getElementById('editorWorking').addEventListener('input', e => {
      applyHighlight(document.getElementById('highlightWorking'), e.target.value);
      _onWorkingInput(e.target.value);
    });
    document.getElementById('editorWorkingModal').addEventListener('input', e => {
      const text = e.target.value;
      ui._updateWorkingEditor(text);
      applyHighlight(document.getElementById('highlightWorking'), text);
      applyHighlight(document.getElementById('highlightWorkingModal'), text);
      _onWorkingInput(text);
    });

    // â”€â”€ Recent Files â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // (recent files tracking kept for history; UI removed)

    // â”€â”€ Origin â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    document.getElementById('btnApplyOrigin').addEventListener('click', () => {
      if (!state.workingCmds.length) { ui.setStatus('No G-code loaded.', 'error'); return; }
      const ox = parseFloat(document.getElementById('originX').value) || 0;
      const oy = parseFloat(document.getElementById('originY').value) || 0;
      undoRedo.push(state.workingCmds);
      state.workingCmds = gcodeParser.applyOffset(state.workingCmds, -ox, -oy);
      ui.refreshWorking();
      preview.originX = 0;
      preview.originY = 0;
      document.getElementById('originX').value = '0';
      document.getElementById('originY').value = '0';
      ui.setStatus(`Origin offset applied: X${ox} Y${oy} → 0,0`);
    });

    // Origin mark buttons (Left/Right)
    document.getElementById('btnMarkLeft').addEventListener('click', () => {
      originMarkMode = originMarkMode === 'left' ? null : 'left';
      document.getElementById('btnMarkLeft').style.background = originMarkMode === 'left' ? 'var(--accent2)' : '';
      document.getElementById('btnMarkRight').style.background = '';
      ui.setStatus(originMarkMode === 'left' ? 'Click on preview to mark LEFT start point' : 'Mark cancelled.');
    });
    document.getElementById('btnMarkRight').addEventListener('click', () => {
      originMarkMode = originMarkMode === 'right' ? null : 'right';
      document.getElementById('btnMarkRight').style.background = originMarkMode === 'right' ? 'var(--accent2)' : '';
      document.getElementById('btnMarkLeft').style.background = '';
      ui.setStatus(originMarkMode === 'right' ? 'Click on preview to mark RIGHT start point' : 'Mark cancelled.');
    });
    document.getElementById('btnClearMark').addEventListener('click', () => {
      originMarkMode = null;
      document.getElementById('btnMarkLeft').style.background = '';
      document.getElementById('btnMarkRight').style.background = '';
      state.originMark = null;
      preview.draw(state.workingCmds);
      ui.setStatus('Mark cleared.');
    });

    // Fine offset buttons
    document.getElementById('btnApplyOffsets').addEventListener('click', () => {
      if (!state.workingCmds.length) { ui.setStatus('No G-code loaded.', 'error'); return; }
      const dx = parseFloat(document.getElementById('originOffX').value) || 0;
      const dy = parseFloat(document.getElementById('originOffY').value) || 0;
      if (!dx && !dy) { ui.setStatus('No offset to apply.', 'error'); return; }
      undoRedo.push(state.workingCmds);
      state.workingCmds = gcodeParser.applyOffset(state.workingCmds, dx, dy);
      ui.refreshWorking();
      document.getElementById('originOffX').value = '0';
      document.getElementById('originOffY').value = '0';
      ui.setStatus(`Fine offset applied: X${dx >= 0 ? '+' : ''}${dx} Y${dy >= 0 ? '+' : ''}${dy}`);
    });

    // â”€â”€ Feed & Power Apply â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    document.getElementById('btnApplyFeedPower').addEventListener('click', () => {
      if (!state.workingCmds.length) { ui.setStatus('No G-code loaded.', 'error'); return; }
      const feed = parseFloat(document.getElementById('batchFeed').value);
      const power = parseFloat(document.getElementById('batchPower').value);
      const passes = parseInt(document.getElementById('batchPasses').value) || 1;
      if (!feed || !power) { ui.setStatus('Invalid feed or power.', 'error'); return; }
      if (passes < 1) { ui.setStatus('Passes must be >= 1.', 'error'); return; }
      undoRedo.push(state.workingCmds);
      let cmds = state.workingCmds.map(c => ({ ...c }));
      cmds = gcodeParser.applyBatchParam(cmds, 'G1', 'F', feed);
      cmds = gcodeParser.applyBatchParam(cmds, 'G1', 'S', power);
      if (passes > 1) {
        const all = [];
        for (let p = 0; p < passes; p++) {
          cmds.forEach(c => all.push({ ...c, raw: '' }));
        }
        cmds = all;
      }
      state.workingCmds = cmds;
      ui.refreshWorking();
      ui.setStatus(`Applied F=${feed} S=${power}, ${passes} pass(es) to all G1 moves.`);
    });

    // â”€â”€ Generate Updated G-code â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    
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
        const idx = from >= 0 && to >= 0 ? i : -1;
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

    // â”€â”€ Points widget â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    state.selectedPoints.clear();

    document.getElementById('btnPointsGenerate').addEventListener('click', () => {
      if (!state.workingCmds.length || !state.selectedPoints.size) {
        ui.setStatus('Select points on preview first.', 'error'); return;
      }
      const dx = parseFloat(document.getElementById('pointsOffsetX').value) || 0;
      const dy = parseFloat(document.getElementById('pointsOffsetY').value) || 0;
      if (!dx && !dy) { ui.setStatus('Set X or Y offset.', 'error'); return; }
      undoRedo.push(state.workingCmds);
      const newCmds = [];
      const sorted = [...state.selectedPoints].sort((a, b) => a - b);
      const added = new Set();
      sorted.forEach((idx, si) => {
        const c = state.workingCmds[idx];
        newCmds.push(c);
        const copy = JSON.parse(JSON.stringify(c));
        if (copy.params.X !== undefined) copy.params.X = parseFloat((copy.params.X + dx).toFixed(4));
        if (copy.params.Y !== undefined) copy.params.Y = parseFloat((copy.params.Y + dy).toFixed(4));
        copy.raw = '';
        newCmds.push(copy);
        added.add(idx + si + 1);
      });
      // rebuild with all original + new points inserted
      const result = [];
      let addedIdx = 0;
      for (let i = 0; i < state.workingCmds.length; i++) {
        result.push(state.workingCmds[i]);
        if (sorted.includes(i)) {
          result.push(newCmds[sorted.indexOf(i) * 2 + 1]);
          addedIdx++;
        }
      }
      state.workingCmds = result;
      state.selectedPoints.clear();
      ui.refreshWorking();
      ui.setStatus(`Generated ${sorted.length} additional point(s) (X:${dx} Y:${dy}).`);
    });

    document.getElementById('btnPointsDelete').addEventListener('click', () => {
      if (!state.workingCmds.length || !state.selectedPoints.size) {
        ui.setStatus('Select points on preview first.', 'error'); return;
      }
      if (!confirm(`Delete ${state.selectedPoints.size} selected point(s)?`)) return;
      undoRedo.push(state.workingCmds);
      const keep = state.workingCmds.filter((_, i) => !state.selectedPoints.has(i));
      state.workingCmds = keep;
      state.selectedPoints.clear();
      ui.refreshWorking();
      ui.setStatus(`Deleted ${state.workingCmds.length - keep.length} point(s).`);
    });

    // â”€â”€ Keyboard Shortcuts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    document.addEventListener('keydown', e => {
      // Ctrl+O — Open G-code
      if (e.ctrlKey && !e.shiftKey && e.key === 'o') {
        e.preventDefault();
        document.getElementById('fileInputGcode').click();
      }
      // Ctrl+Shift+S — Save As
      if (e.ctrlKey && e.shiftKey && e.key === 's') {
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
        if (pickMode) {
          pickMode = false;
          const mb = document.getElementById('btnPick');
          if (mb) mb.style.background = '';
          preview.draw(state.workingCmds);
          ui.setStatus('Pick cancelled.');
        } else if (measureMode) {
          measureMode = false; measureStart = null; measureEnd = null;
          const mb = document.getElementById('btnMeasure');
          if (mb) mb.style.background = '';
          preview.draw(state.workingCmds);
          ui.setStatus('Measure cancelled.');
        } else {
          preview.stop();
        }
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
      // Arrow keys — pan
      if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        const panStep = 20 / state.previewScale;
        if (e.key === 'ArrowLeft')  { state.previewOffX -= panStep; e.preventDefault(); preview.draw(state.workingCmds); }
        if (e.key === 'ArrowRight') { state.previewOffX += panStep; e.preventDefault(); preview.draw(state.workingCmds); }
        if (e.key === 'ArrowUp')    { state.previewOffY -= panStep; e.preventDefault(); preview.draw(state.workingCmds); }
        if (e.key === 'ArrowDown')  { state.previewOffY += panStep; e.preventDefault(); preview.draw(state.workingCmds); }
      }
      // Home — Fit view
      if (e.key === 'Home' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        preview.fitView();
      }
    });

    // â”€â”€ Drag & Drop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    setupDragDrop(document.getElementById('preview-area'));

    // â”€â”€ Init UI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    ui.refreshTemplateList();
    ui.updateTemplateIndicator();
    preview.init(document.getElementById('previewCanvas'));
    findReplace.init();
    ui._setupBackplot();

    // â”€â”€ Sync editor scrolls â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    setupScrollSync('editorOriginal', 'highlightOriginal', 'linesOriginal');
    setupScrollSync('editorWorking', 'highlightWorking', 'linesWorking');
    setupScrollSync('editorOriginalModal', 'highlightOriginalModal');
    setupScrollSync('editorWorkingModal', 'highlightWorkingModal');

    // â”€â”€ Editor tabs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    // â”€â”€ Widget drag & drop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const cols = ['col-left', 'col-right'];
    cols.forEach(colId => {
      const col = document.getElementById(colId);
      if (!col) return;
      col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('drag-over'); });
      col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
      col.addEventListener('drop', e => {
        e.preventDefault();
        col.classList.remove('drag-over');
        const id = e.dataTransfer.getData('text/widget');
        if (!id) return;
        const w = document.getElementById(id);
        if (!w || w.parentElement === col) return;
        col.appendChild(w);
      });
    });
    document.querySelectorAll('.widget[draggable]').forEach(w => {
      w.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/widget', w.id);
        setTimeout(() => w.classList.add('dragging'), 0);
      });
      w.addEventListener('dragend', () => {
        w.classList.remove('dragging');
        _saveWidgetLayout();
        if (typeof _buildWidgetLists === 'function') _buildWidgetLists();
      });
      if (!w.id) w.id = 'widget-' + (w.dataset.widget || Math.random().toString(36).slice(2, 7));
    });

    // â”€â”€ Restore widget layout from cache â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        document.querySelectorAll('.widget[draggable]').forEach(w => {
          const col = w.closest('.app-col');
          if (col) map[w.dataset.widget] = col.id;
        });
        localStorage.setItem('editgc_widget_cols', JSON.stringify(map));
      } catch (_) {}
    }

    // â”€â”€ Left panel: edge hover toggle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    // â”€â”€ Widget lock â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const lockBtn = document.getElementById('lp-lock-btn');
    let widgetsLocked = true;
    try { widgetsLocked = localStorage.getItem('editgc_widgets_locked') === 'true'; } catch (_) {}
    function _applyWidgetLock() {
      document.querySelectorAll('.widget[draggable]').forEach(w => {
        w.draggable = !widgetsLocked;
        w.style.cursor = widgetsLocked ? 'default' : 'grab';
      });
      document.body.classList.toggle('widgets-locked', widgetsLocked);
      if (lockBtn) lockBtn.textContent = widgetsLocked ? '[Locked] Widgets fixed' : '[Unlocked] Widgets (drag active)';
    }
    if (lockBtn) {
      _applyWidgetLock();
      lockBtn.addEventListener('click', () => {
        widgetsLocked = !widgetsLocked;
        _applyWidgetLock();
        try { localStorage.setItem('editgc_widgets_locked', widgetsLocked); } catch (_) {}
      });
    }

    // â”€â”€ Sidebar widget management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    function _widgetName(wid) {
      const names = { scale:'Scale', template:'Template', origin:'Origin', feedpower:'Feed / Power', batch:'Shift Points', points:'Add points' };
      return names[wid] || wid;
    }
    function _buildWidgetLists() {
      const leftList = document.getElementById('lp-left-list');
      const rightList = document.getElementById('lp-right-list');
      const visList = document.getElementById('lp-visibility-list');
      if (!leftList || !rightList) return;
      leftList.innerHTML = ''; rightList.innerHTML = ''; visList.innerHTML = '';
      const allWidgets = document.querySelectorAll('.widget[draggable]');
      const leftWidgets = [], rightWidgets = [];
      allWidgets.forEach(w => {
        const col = w.closest('.app-col');
        if (col && col.id === 'col-left') leftWidgets.push(w);
        else if (col && col.id === 'col-right') rightWidgets.push(w);
      });
      function _renderRow(w, list, side) {
        const wid = w.dataset.widget;
        const row = document.createElement('div');
        row.className = 'lp-widget-row';
        row.dataset.widget = wid;
        // visibility checkbox
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = w.style.display !== 'none';
        try {
          const saved = localStorage.getItem('editgc_vis_widget-' + wid);
          if (saved !== null) cb.checked = saved === 'true';
        } catch (_) {}
        w.style.display = cb.checked ? '' : 'none';
        cb.addEventListener('change', () => {
          w.style.display = cb.checked ? '' : 'none';
          try { localStorage.setItem('editgc_vis_widget-' + wid, cb.checked); } catch (_) {}
          // sync checkbox in other column's row if any
          document.querySelectorAll(`.lp-widget-row[data-widget="${wid}"] input[type="checkbox"]`).forEach(c => { if (c !== cb) c.checked = cb.checked; });
        });
        row.appendChild(cb);
        // name
        const name = document.createElement('span');
        name.className = 'lp-widget-name' + (cb.checked ? '' : ' muted');
        name.textContent = _widgetName(wid);
        row.appendChild(name);
        cb.addEventListener('change', () => name.classList.toggle('muted', !cb.checked));
        // up button
        const upBtn = document.createElement('button');
        upBtn.className = 'lp-widget-btn';
        upBtn.textContent = '^';
        upBtn.title = 'Move up';
        upBtn.addEventListener('click', () => {
          const prev = row.previousElementSibling;
          if (!prev) return;
          const widgetEl = document.querySelector(`.widget[data-widget="${wid}"]`);
          const col = widgetEl.closest('.app-col');
          const prevWidget = col.querySelector(`.widget[data-widget="${prev.dataset.widget}"]`);
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
          const col = widgetEl.closest('.app-col');
          const nextWidget = col.querySelector(`.widget[data-widget="${next.dataset.widget}"]`);
          if (col && nextWidget) { col.insertBefore(widgetEl, nextWidget.nextSibling); list.insertBefore(row, next.nextSibling); _saveWidgetLayout(); }
        });
        row.appendChild(dnBtn);
        // move button
        const moveBtn = document.createElement('button');
        moveBtn.className = 'lp-widget-btn move-btn';
        const otherSide = side === 'left' ? 'right' : 'left';
        moveBtn.textContent = side === 'left' ? '→' : 'â†';
        moveBtn.title = `Move to ${otherSide} column`;
        moveBtn.addEventListener('click', () => {
          const targetCol = document.getElementById('col-' + otherSide);
          if (!targetCol) return;
          const widgetEl = document.querySelector(`.widget[data-widget="${wid}"]`);
          if (!widgetEl) return;
          targetCol.appendChild(widgetEl);
          _buildWidgetLists();
          _saveWidgetLayout();
        });
        row.appendChild(moveBtn);
        list.appendChild(row);
      }
      leftWidgets.forEach(w => _renderRow(w, leftList, 'left'));
      rightWidgets.forEach(w => _renderRow(w, rightList, 'right'));
      // visibility-only list (second occurrence rows hidden, just show checkboxes)
      leftWidgets.forEach(w => {
        const wid = w.dataset.widget;
        const row = document.createElement('div');
        row.className = 'lp-widget-row';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = w.style.display !== 'none';
        try {
          const saved = localStorage.getItem('editgc_vis_widget-' + wid);
          if (saved !== null) cb.checked = saved === 'true';
        } catch (_) {}
        cb.addEventListener('change', () => {
          w.style.display = cb.checked ? '' : 'none';
          try { localStorage.setItem('editgc_vis_widget-' + wid, cb.checked); } catch (_) {}
          document.querySelectorAll(`.lp-widget-row[data-widget="${wid}"] input[type="checkbox"]`).forEach(c => { if (c !== cb) c.checked = cb.checked; });
        });
        row.appendChild(cb);
        const name = document.createElement('span');
        name.className = 'lp-widget-name' + (cb.checked ? '' : ' muted');
        name.textContent = _widgetName(wid);
        row.appendChild(name);
        const allCb = document.querySelectorAll(`.lp-widget-row[data-widget="${wid}"] input[type="checkbox"]`);
        if (allCb.length > 0) cb.checked = allCb[0].checked;
        cb.addEventListener('change', () => name.classList.toggle('muted', !cb.checked));
        visList.appendChild(row);
      });
      rightWidgets.forEach(w => {
        const wid = w.dataset.widget;
        const row = document.createElement('div');
        row.className = 'lp-widget-row';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = w.style.display !== 'none';
        try {
          const saved = localStorage.getItem('editgc_vis_widget-' + wid);
          if (saved !== null) cb.checked = saved === 'true';
        } catch (_) {}
        cb.addEventListener('change', () => {
          w.style.display = cb.checked ? '' : 'none';
          try { localStorage.setItem('editgc_vis_widget-' + wid, cb.checked); } catch (_) {}
          document.querySelectorAll(`.lp-widget-row[data-widget="${wid}"] input[type="checkbox"]`).forEach(c => { if (c !== cb) c.checked = cb.checked; });
        });
        row.appendChild(cb);
        const name = document.createElement('span');
        name.className = 'lp-widget-name' + (cb.checked ? '' : ' muted');
        name.textContent = _widgetName(wid);
        row.appendChild(name);
        cb.addEventListener('change', () => name.classList.toggle('muted', !cb.checked));
        visList.appendChild(row);
      });
    }
    _buildWidgetLists();

    // â”€â”€ Theme selector â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    // â”€â”€ Unsaved changes warning â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    window.addEventListener('beforeunload', e => {
      if (state.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
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
    const text = gcodeParser.serialize(state.workingCmds);
    this._updateWorkingEditor(text);
    applyHighlight(document.getElementById('highlightWorking'), text);
    const wm = document.getElementById('editorWorkingModal');
    if (wm) wm.value = text;
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
    el.textContent = msg;
    el.style.color = type === 'error' ? '#f66' : '#555';
  },
  setProgress(pct, label) {
    const wrap = document.getElementById('progressWrap');
    const bar  = document.getElementById('progressBar');
    const lbl  = document.getElementById('progressLabel');
    if (!wrap) return;
    if (pct < 0) { wrap.classList.add('hidden'); return; }
    wrap.classList.remove('hidden');
    bar.style.width = Math.min(100, Math.max(0, pct)) + '%';
    if (lbl) lbl.textContent = label || Math.round(pct) + '%';
  },
};

