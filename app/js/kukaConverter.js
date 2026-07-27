const kukaConverter = {

  _circAuxPoint(start, end, center) {
    const a1 = Math.atan2(start.y - center.y, start.x - center.x);
    const a2 = Math.atan2(end.y - center.y, end.x - center.x);
    const midAngle = Math.atan2(Math.sin(a1) + Math.sin(a2), Math.cos(a1) + Math.cos(a2));
    const r = Math.hypot(start.x - center.x, start.y - center.y) || 1;
    return { x: center.x + r * Math.cos(midAngle), y: center.y + r * Math.sin(midAngle), z: (start.z + end.z) / 2 };
  },

  _arcDirection(start, aux, end) {
    const cross = (aux.x - start.x) * (end.y - start.y) - (aux.y - start.y) * (end.x - start.x);
    return cross > 0 ? 'G3' : 'G2';
  },

  convert(cmds, opts) {
    const toolNo = parseInt(opts.toolNo) || 5;
    const baseNo = parseInt(opts.baseNo) || 1;
    const weldVel = parseFloat(opts.weldVel) || 0.01;
    const approachVel = parseFloat(opts.approachVel) || 0.1;
    const travelVelPct = parseFloat(opts.travelVel) || 10;
    const homeVelPct = parseFloat(opts.homeVel) || 10;
    const orientA = parseFloat(opts.orientA) || 137;
    const orientB = parseFloat(opts.orientB) || -77;
const orientC = parseFloat(opts.orientC) || 89;
    const homeE1 = parseFloat(opts.homeE1) || 0;
    const accel = parseFloat(opts.accel) || 10;
    const homeX = parseFloat(opts.machineX) || 2.67;
    const homeY = parseFloat(opts.machineY) || -3.62;
    const homeZ = parseFloat(opts.homeZ) || -101.20;
    const programName = opts.programName || 'KUKA_Program';
    const tableMode = opts.tableMode || 'Horizontal';
    const triggerOnDelay = parseFloat(opts.triggerOnDelay) || 0;
    const triggerOffDelay = parseFloat(opts.triggerOffDelay) || 0;

    const homePoint = { x: homeX, y: homeY, z: homeZ, c: 0 };
    const APPROACH_Z_OFFSET = 10;
    const weldBlocks = [];
    let currentBlock = null;
    let curX = 0, curY = 0, curZ = 0;

    const flushBlock = () => {
      if (currentBlock && currentBlock.entries.length) {
        weldBlocks.push(currentBlock);
      }
      currentBlock = null;
    };

    for (const cmd of cmds) {
      const t = (cmd.type || '').toUpperCase();

      if (t === 'M3' || t === 'M4' || t === 'M03' || t === 'M04') {
        flushBlock();
        currentBlock = { entries: [] };
        continue;
      }
      if (t === 'M5' || t === 'M05') {
        flushBlock();
        continue;
      }

      const isG0 = t === 'G0' || t === 'G00';
      const isG1 = t === 'G1' || t === 'G01';
      const isG2 = t === 'G2' || t === 'G02';
      const isG3 = t === 'G3' || t === 'G03';
      const isImplicitMove = (t === '' || t === undefined || t === null) && cmd.params;
      const hasXY = cmd.params && (cmd.params.X !== undefined || cmd.params.Y !== undefined || cmd.params.Z !== undefined);

      if (isG0) {
        if (cmd.params.X !== undefined) curX = cmd.params.X;
        if (cmd.params.Y !== undefined) curY = cmd.params.Y;
        if (cmd.params.Z !== undefined) curZ = cmd.params.Z;
        continue;
      }

      if ((isG1 || isImplicitMove) && hasXY) {
        const nx = cmd.params.X !== undefined ? cmd.params.X : curX;
        const ny = cmd.params.Y !== undefined ? cmd.params.Y : curY;
        const nz = cmd.params.Z !== undefined ? cmd.params.Z : curZ;
        if (currentBlock) {
          currentBlock.entries.push({ type: 'line', x: nx, y: ny, z: nz });
        }
        curX = nx; curY = ny; curZ = nz;
        continue;
      }

      if ((isG2 || isG3) && hasXY) {
        const endX = cmd.params.X !== undefined ? cmd.params.X : curX;
        const endY = cmd.params.Y !== undefined ? cmd.params.Y : curY;
        const endZ = cmd.params.Z !== undefined ? cmd.params.Z : curZ;
        let center = null;
        if (cmd.params.I !== undefined && cmd.params.J !== undefined) {
          center = { x: curX + cmd.params.I, y: curY + cmd.params.J };
        }
        if (currentBlock) {
          if (center) {
            const aux = this._circAuxPoint({ x: curX, y: curY, z: curZ }, { x: endX, y: endY, z: endZ }, center);
            currentBlock.entries.push({ type: 'circ', x: endX, y: endY, z: endZ, auxX: aux.x, auxY: aux.y, auxZ: aux.z, arcType: t });
          } else {
            currentBlock.entries.push({ type: 'line', x: endX, y: endY, z: endZ });
          }
        }
        curX = endX; curY = endY; curZ = endZ;
        continue;
      }
    }
    flushBlock();

    let ptCounter = 0;
    const allPoints = [homePoint];
    const addPt = (x, y, z) => {
      const pt = { x, y, z, c: 0 };
      allPoints.push(pt);
      ptCounter++;
      return ptCounter;
    };

    let srcLines = [];
    srcLines.push('&ACCESS RVP');
    srcLines.push('&REL N');
    srcLines.push('&PARAM EDITMASK = *');
    srcLines.push('&PARAM TEMPLATE = C:\\KRC\\Roboter\\Template\\vorgabe');
    srcLines.push('&PARAM DISKPATH = KRC:\\R1\\Program\\referencias');
    srcLines.push('DEF ' + programName + '( )');
    srcLines.push(';FOLD INI;%{PE}');
    srcLines.push('  ;FOLD BASISTECH INI');
    srcLines.push('    GLOBAL INTERRUPT DECL 3 WHEN $STOPMESS==TRUE DO IR_STOPM ( )');
    srcLines.push('    INTERRUPT ON 3');
    srcLines.push('    BAS (#INITMOV,0 )');
    srcLines.push('  ;ENDFOLD (BASISTECH INI)');
    srcLines.push('  ;FOLD USER INI');
    srcLines.push('    ;Make your modifications here');
    srcLines.push('  ;ENDFOLD (USER INI)');
    srcLines.push(';ENDFOLD (INI)');
    srcLines.push(';FOLD PTP HOME Vel=' + homeVelPct + ' % DEFAULT;%{PE}');
    srcLines.push('$BWDSTART=FALSE');
    srcLines.push('PDAT_ACT=PDEFAULT');
    srcLines.push('FDAT_ACT=FHOME');
    srcLines.push('BAS(#PTP_PARAMS,' + homeVelPct + ')');
    srcLines.push('$H_POS=XHOME');
    srcLines.push('PTP XHOME');
    srcLines.push(';ENDFOLD');
    srcLines.push('');
    srcLines.push(';--- Table select');
    if (tableMode === 'Horizontal') {
      srcLines.push(';FOLD OUT 13 ' + "'Mesa_Vertical' State=FALSE CONT;%{PE}");
      srcLines.push('CONTINUE');
      srcLines.push('$OUT[13]=FALSE');
      srcLines.push(';ENDFOLD');
      srcLines.push(';FOLD OUT 14 ' + "'Mesa_Horizontal' State=TRUE CONT;%{PE}");
      srcLines.push('CONTINUE');
      srcLines.push('$OUT[14]=TRUE');
      srcLines.push(';ENDFOLD');
    } else {
      srcLines.push(';FOLD OUT 14 ' + "'Mesa_Horizontal' State=FALSE CONT;%{PE}");
      srcLines.push('CONTINUE');
      srcLines.push('$OUT[14]=FALSE');
      srcLines.push(';ENDFOLD');
      srcLines.push(';FOLD OUT 13 ' + "'Mesa_Vertical' State=TRUE CONT;%{PE}");
      srcLines.push('CONTINUE');
      srcLines.push('$OUT[13]=TRUE');
      srcLines.push(';ENDFOLD');
    }
    srcLines.push('');
    srcLines.push('jobNumREFL=0');
    srcLines.push('WHILE jobNum<>0');
    srcLines.push('CONTINUE');
    srcLines.push('SWITCH jobNum');
    srcLines.push('CASE 1');
    srcLines.push('CONTINUE');
    srcLines.push('jobNumREFL=1');
    srcLines.push('$ADVANCE=3');
    srcLines.push('');

    if (!weldBlocks.length) {
      weldBlocks.push({ entries: [{ type: 'line', x: 0, y: 0, z: 0 }] });
    }

    for (let bi = 0; bi < weldBlocks.length; bi++) {
      const block = weldBlocks[bi];
      const entries = block.entries;
      if (!entries.length) continue;

      const firstEntry = entries[0];
      const lastEntry = entries[entries.length - 1];

      const approachIdx = bi === 0
        ? addPt(firstEntry.x, firstEntry.y, (firstEntry.z || 0) + APPROACH_Z_OFFSET)
        : 0;
      if (bi > 0) {
        const _ai = addPt(firstEntry.x, firstEntry.y, (firstEntry.z || 0) + APPROACH_Z_OFFSET);
        block._approachIdx = _ai;
      } else {
        block._approachIdx = approachIdx;
      }

      const entryToIdx = {};
      for (const e of entries) {
        if (e.type === 'line') {
          const idx = addPt(e.x, e.y, e.z);
          entryToIdx[e] = idx;
        } else if (e.type === 'circ') {
          const auxIdx = addPt(e.auxX, e.auxY, e.auxZ);
          const endIdx2 = addPt(e.x, e.y, e.z);
          e._auxIdx = auxIdx;
          e._endIdx = endIdx2;
        }
      }

      const startIdx = entryToIdx[firstEntry];
      const endIdx = entries[entries.length - 1].type === 'line'
        ? entryToIdx[lastEntry]
        : lastEntry._endIdx;

      srcLines.push('    ;--- Weld block ' + (bi + 1));
      if (bi === 0) {
        srcLines.push('    ;--- Welding Approach');
        srcLines.push('    ;FOLD PTP P' + block._approachIdx + ' CONT Vel=' + travelVelPct + ' % PDAT1 Tool[' + toolNo + ']:tool Base[' + baseNo + ']:base;%{PE}');
        srcLines.push('    $BWDSTART=FALSE');
        srcLines.push('    PDAT_ACT=PPDAT1');
        srcLines.push('    FDAT_ACT=FP' + block._approachIdx);
        srcLines.push('    BAS(#PTP_PARAMS,' + travelVelPct + ')');
        srcLines.push('    PTP XP' + block._approachIdx + ' C_DIS');
        srcLines.push('    ;ENDFOLD');
      } else {
        srcLines.push('    ;--- Inter-pass PTP');
        srcLines.push('    ;FOLD PTP P' + block._approachIdx + ' CONT Vel=' + travelVelPct + ' % PDAT1 Tool[' + toolNo + ']:tool Base[' + baseNo + ']:base;%{PE}');
        srcLines.push('    $BWDSTART=FALSE');
        srcLines.push('    PDAT_ACT=PPDAT1');
        srcLines.push('    FDAT_ACT=FP' + block._approachIdx);
        srcLines.push('    BAS(#PTP_PARAMS,' + travelVelPct + ')');
        srcLines.push('    PTP XP' + block._approachIdx + ' C_DIS');
        srcLines.push('    ;ENDFOLD');
      }
      srcLines.push('');

      srcLines.push('    ;--- Request Welding ON');
      srcLines.push("    ;FOLD SYN OUT 67 '' State=TRUE at END Delay=" + triggerOnDelay + ' ms;%{PE}');
      srcLines.push('    TRIGGER WHEN DISTANCE=1 DELAY=' + triggerOnDelay + ' DO $OUT[67]=TRUE');
      srcLines.push('    ;ENDFOLD');
      srcLines.push('');
      srcLines.push('    ;--- Confirmation Welding ON');
      srcLines.push("    ;FOLD WAIT FOR ( IN 68 'permiso soldar' ) CONT;%{PE}");
      srcLines.push('    CONTINUE');
      srcLines.push('    WAIT FOR ( $IN[68] )');
      srcLines.push('    ;ENDFOLD');
      srcLines.push("    ;FOLD OUT 67 'start soldadura' State=FALSE CONT;%{PE}");
      srcLines.push('    CONTINUE');
      srcLines.push('    $OUT[67]=FALSE');
      srcLines.push('    ;ENDFOLD');
      srcLines.push('');
      srcLines.push('    ;--- Welding Init');
      srcLines.push('    ;FOLD LIN P' + startIdx + ' Vel=' + approachVel + ' m/s CPDAT' + startIdx + ' Tool[' + toolNo + ']:tool Base[' + baseNo + ']:base;%{PE}');
      srcLines.push('    $BWDSTART=FALSE');
      srcLines.push('    LDAT_ACT=LCPDAT' + startIdx);
      srcLines.push('    FDAT_ACT=FP' + startIdx);
      srcLines.push('    BAS(#CP_PARAMS,' + approachVel + ')');
      srcLines.push('    LIN XP' + startIdx);
      srcLines.push('    ;ENDFOLD');
      srcLines.push('');

      srcLines.push('    ;--- Welding Trajectory');
      for (const e of entries) {
        if (e.type === 'line') {
          const idx = entryToIdx[e];
          srcLines.push('    ;FOLD SLIN XP' + idx + ' CONT Vel=' + weldVel + ' m/s CPDAT1 Tool[' + toolNo + ']:tool Base[' + baseNo + ']:base;%{PE}');
          srcLines.push('    SLIN XP' + idx + ' WITH $VEL=SVEL_CP(' + weldVel + ', ,LCPDAT' + idx + '), $TOOL=STOOL2(FP' + idx + '), $BASE=EK(K_ROOT(FP' + idx + '.BASE_NO),K_TYPE(FP' + idx + '.BASE_NO),K_OFFS(FP' + idx + '.BASE_NO)), $IPO_MODE=SIPO_MODE(FP' + idx + '.IPO_FRAME), $LOAD=SLOAD(FP' + idx + '.TOOL_NO), $ACC=SACC_CP(LCPDAT' + idx + '), $APO=SAPO(LCPDAT' + idx + '), $ORI_TYPE=SORI_TYP(LCPDAT' + idx + '), $JERK=SJERK(LCPDAT' + idx + ') C_SPL');
          srcLines.push('    ;ENDFOLD');
        } else if (e.type === 'circ') {
          srcLines.push('    ;FOLD CIRC XP' + e._auxIdx + ', XP' + e._endIdx + ' CONT Vel=' + weldVel + ' m/s CPDAT1 Tool[' + toolNo + ']:tool Base[' + baseNo + ']:base;%{PE}');
          srcLines.push('    CIRC XP' + e._auxIdx + ', XP' + e._endIdx + ' WITH $VEL=SVEL_CP(' + weldVel + ', ,LCPDAT' + e._endIdx + '), $TOOL=STOOL2(FP' + e._endIdx + '), $BASE=EK(K_ROOT(FP' + e._endIdx + '.BASE_NO),K_TYPE(FP' + e._endIdx + '.BASE_NO),K_OFFS(FP' + e._endIdx + '.BASE_NO)), $IPO_MODE=SIPO_MODE(FP' + e._endIdx + '.IPO_FRAME), $LOAD=SLOAD(FP' + e._endIdx + '.TOOL_NO), $ACC=SACC_CP(LCPDAT' + e._endIdx + '), $APO=SAPO(LCPDAT' + e._endIdx + '), $ORI_TYPE=SORI_TYP(LCPDAT' + e._endIdx + '), $JERK=SJERK(LCPDAT' + e._endIdx + ') C_SPL');
          srcLines.push('    ;ENDFOLD');
        }
      }

      srcLines.push('');
      srcLines.push('    ;--- Request Welding OFF');
      srcLines.push("    ;FOLD SYN OUT 68 '' State=TRUE at END Delay=" + triggerOffDelay + ' ms;%{PE}');
      srcLines.push('    TRIGGER WHEN DISTANCE=1 DELAY=' + triggerOffDelay + ' DO $OUT[68]=TRUE');
      srcLines.push('    ;ENDFOLD');
      srcLines.push('');
      srcLines.push('    ;--- Welding Final');
      srcLines.push('    ;FOLD SLIN XP' + endIdx + ' Vel=' + weldVel + ' m/s CPDAT' + endIdx + ' Tool[' + toolNo + ']:tool Base[' + baseNo + ']:base;%{PE}');
      srcLines.push('    SLIN XP' + endIdx + ' WITH $VEL=SVEL_CP(' + weldVel + ', ,LCPDAT' + endIdx + '), $TOOL=STOOL2(FP' + endIdx + '), $BASE=EK(K_ROOT(FP' + endIdx + '.BASE_NO),K_TYPE(FP' + endIdx + '.BASE_NO),K_OFFS(FP' + endIdx + '.BASE_NO)), $IPO_MODE=SIPO_MODE(FP' + endIdx + '.IPO_FRAME), $LOAD=SLOAD(FP' + endIdx + '.TOOL_NO), $ACC=SACC_CP(LCPDAT' + endIdx + '), $APO=SAPO(LCPDAT' + endIdx + '), $ORI_TYPE=SORI_TYP(LCPDAT' + endIdx + '), $JERK=SJERK(LCPDAT' + endIdx + ')');
      srcLines.push('    ;ENDFOLD');
      srcLines.push('');
      srcLines.push('    ;--- Confirmation Welding OFF');
      srcLines.push("    ;FOLD WAIT FOR ( IN 69 'permiso salir' ) CONT;%{PE}");
      srcLines.push('    CONTINUE');
      srcLines.push('    WAIT FOR ( $IN[69] )');
      srcLines.push('    ;ENDFOLD');
      srcLines.push("    ;FOLD OUT 68 'end soldadura' State=FALSE CONT;%{PE}");
      srcLines.push('    CONTINUE');
      srcLines.push('    $OUT[68]=FALSE');
      srcLines.push('    ;ENDFOLD');
    }

    srcLines.push('    ;--- Welding Out');
    srcLines.push('    ;FOLD PTP HOME Vel=' + homeVelPct + ' % PDAT5;%{PE}');
    srcLines.push('    $BWDSTART=FALSE');
    srcLines.push('    PDAT_ACT=PPDAT5');
    srcLines.push('    FDAT_ACT=FP1');
    srcLines.push('    BAS(#PTP_PARAMS,' + homeVelPct + ')');
    srcLines.push('    $H_POS=XHOME');
    srcLines.push('    PTP XHOME');
    srcLines.push('    ;ENDFOLD');
    srcLines.push('');
    const resetOut = tableMode === 'Horizontal' ? '14' : '13';
    const resetLabel = tableMode === 'Horizontal' ? 'Mesa_Horizontal' : 'Mesa_Vertical';
    srcLines.push(';--- Reset JobNum');
    srcLines.push(';FOLD OUT ' + resetOut + ' ' + "'" + resetLabel + "' State=FALSE CONT;%{PE}");
    srcLines.push('CONTINUE');
    srcLines.push('$OUT[' + resetOut + ']=FALSE');
    srcLines.push(';ENDFOLD');
    srcLines.push('CONTINUE');
    srcLines.push('jobNumREFL=0');
    srcLines.push('CASE 0');
    srcLines.push('jobNumREFL=0');
    srcLines.push('DEFAULT');
    srcLines.push('jobNumREFL=0');
    srcLines.push('ENDSWITCH');
    srcLines.push(';FOLD PTP HOME CONT Vel=' + homeVelPct + ' % DEFAULT;%{PE}');
    srcLines.push('$BWDSTART=FALSE');
    srcLines.push('PDAT_ACT=PDEFAULT');
    srcLines.push('FDAT_ACT=FHOME');
    srcLines.push('BAS(#PTP_PARAMS,' + homeVelPct + ')');
    srcLines.push('$H_POS=XHOME');
    srcLines.push('PTP XHOME C_DIS');
    srcLines.push(';ENDFOLD');
    srcLines.push('ENDWHILE');
    srcLines.push('$ADVANCE=0');
    srcLines.push('END');

    const src = srcLines.join('\r\n');

    let datLines = [];
    datLines.push('DEFDAT ' + programName + ' PUBLIC');
    datLines.push('');
    datLines.push(';--- PDAT');
    datLines.push('DECL PDAT PDEFAULT={VEL 100.0,ACC 80.0,APO_DIST 100.0,APO_FAC 50.0,APO_MODE #CDIS,GEAR_JERK 50.0,EXAX_IGN 0}');
    datLines.push('DECL PDAT PPDAT1={VEL 100.0,ACC 50.0,APO_DIST 50.0,APO_MODE #CDIS,GEAR_JERK 50.0,EXAX_IGN 0}');
    datLines.push('DECL PDAT PPDAT5={VEL 80.0,ACC 80.0,APO_DIST 100.0,APO_MODE #CDIS,GEAR_JERK 50.0,EXAX_IGN 0}');
    datLines.push('DECL PDAT LPDAT1={VEL 50.0,ACC ' + accel + '.0,APO_DIST 50.0,APO_FAC 50.0}');
    datLines.push('');

    // One LDAT per point
    for (let i = 0; i < allPoints.length; i++) {
      const idx = i + 1;
      datLines.push('DECL LDAT LCPDAT' + idx + '={VEL 2.0,ACC ' + accel + '.0,APO_DIST 50.0,APO_FAC 50.0,AXIS_VEL 100.0,AXIS_ACC 100.0,ORI_TYP #VAR,CIRC_TYP #BASE,JERK_FAC 50.0,GEAR_JERK 50.0,EXAX_IGN 0}');
    }
    datLines.push('');

    // Per-point orientation from path contour normal
    for (let i = 0; i < allPoints.length; i++) allPoints[i].c = orientC;
    for (let i = 0; i < allPoints.length; i++) allPoints[i].a = orientA;
    for (let i = 0; i < allPoints.length; i++) allPoints[i].b = orientB;

    const tilt = Math.abs(90 + orientB) || 8;
    for (let i = 0; i < allPoints.length; i++) {
      let dx, dy;
      if (i === 0 && allPoints.length > 1) {
        dx = allPoints[i + 1].x - allPoints[i].x;
        dy = allPoints[i + 1].y - allPoints[i].y;
      } else if (i === allPoints.length - 1 && allPoints.length > 1) {
        dx = allPoints[i].x - allPoints[i - 1].x;
        dy = allPoints[i].y - allPoints[i - 1].y;
      } else if (allPoints.length > 2) {
        dx = allPoints[i + 1].x - allPoints[i - 1].x;
        dy = allPoints[i + 1].y - allPoints[i - 1].y;
      } else {
        dx = 1; dy = 0;
      }
      const len = Math.hypot(dx, dy);
      if (len < 0.001) continue;
      const nx = -dy / len;
      const ny = dx / len;
      const normAngle = Math.atan2(ny, nx) * 180 / Math.PI;
      allPoints[i].c = orientC + normAngle;
    }

    for (let i = 0; i < allPoints.length; i++) {
      const idx = i + 1;
      const p = allPoints[i];
      datLines.push('DECL E6POS XP' + idx + '={X ' + p.x.toFixed(2) + ', Y ' + p.y.toFixed(2) + ', Z ' + p.z.toFixed(2) + ', A ' + p.a + ', B ' + p.b + ', C ' + p.c + ', S 6, T 26, E1 ' + homeE1.toFixed(1) + ', E2 0.0, E3 0.0, E4 0.0, E5 0.0, E6 0.0}');
    }

    for (let i = 0; i < allPoints.length; i++) {
      const idx = i + 1;
      datLines.push('DECL FDAT FP' + idx + '={TOOL_NO ' + toolNo + ', BASE_NO ' + baseNo + ', IPO_FRAME #BASE, POINT2[] " ", TQ_STATE FALSE}');
    }

    datLines.push('');
    datLines.push(';--- LAST_BASIS');
    datLines.push('DECL LAST_BASIS LAST_BASIS={TOOL_NO ' + toolNo + ', BASE_NO ' + baseNo + ', POINT2[] " "}');
    datLines.push('');
    datLines.push('ENDDAT');

    const dat = datLines.join('\r\n');
    return { src, dat, programName };
  },

  parseSrc(srcText) {
    const lines = srcText.split(/\r?\n/);
    let programName = 'KUKA_Program';
    const motions = [];
    let triggerOnLine = -1;
    let triggerOffLine = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const upper = line.toUpperCase();

      if (!line || line.startsWith(';') || line.startsWith('&')) continue;

      const defMatch = upper.match(/^DEF\s+(\w+)/);
      if (defMatch) { programName = defMatch[1]; continue; }

      if (upper.includes('$OUT[67]=TRUE') || upper.includes('DO $OUT[67]=TRUE')) {
        triggerOnLine = i;
        continue;
      }
      if (upper.includes('$OUT[68]=TRUE') || upper.includes('DO $OUT[68]=TRUE')) {
        triggerOffLine = i;
        continue;
      }

      const ptpMatch = upper.match(/^PTP\s+(XP?\d+|XHOME)\b/);
      const linMatch = upper.match(/^(LIN|SLIN)\s+(XP?\d+)\b/);
      const circMatch = upper.match(/^CIRC\s+(XP?\d+)\s*,\s*(XP?\d+)\b/);

      if (ptpMatch) {
        const ref = ptpMatch[1].toUpperCase();
        if (ref === 'XHOME') {
          motions.push({ type: 'PTP', pointIdx: 0, isHome: true, lineIdx: i });
        } else {
          const num = parseInt(ref.replace('XP', ''));
          motions.push({ type: 'PTP', pointIdx: num, isHome: false, lineIdx: i });
        }
      } else if (linMatch) {
        const ref = linMatch[2].toUpperCase();
        const num = parseInt(ref.replace('XP', ''));
        const motionType = linMatch[1].toUpperCase();
        motions.push({ type: motionType, pointIdx: num, isHome: false, lineIdx: i });
      } else if (circMatch) {
        const auxRef = circMatch[1].toUpperCase();
        const endRef = circMatch[2].toUpperCase();
        const auxNum = parseInt(auxRef.replace('XP', ''));
        const endNum = parseInt(endRef.replace('XP', ''));
        motions.push({ type: 'CIRC', pointIdx: endNum, auxIdx: auxNum, isHome: false, lineIdx: i });
      }
    }

    for (const m of motions) {
      if (triggerOnLine >= 0 && triggerOffLine >= 0) {
        m.welding = m.lineIdx > triggerOnLine && m.lineIdx < triggerOffLine;
      } else {
        m.welding = false;
      }
    }

    return { programName, motions, triggerOnLine, triggerOffLine };
  },

  parseDat(datText) {
    const points = {};
    const lines = datText.split(/\r?\n/);
    const e6posRe = /DECL\s+E6POS\s+(XP\d+)\s*=\s*\{([^}]+)\}/i;

    for (const line of lines) {
      const m = line.match(e6posRe);
      if (m) {
        const ref = m[1].toUpperCase();
        const num = parseInt(ref.replace('XP', ''));
        const params = m[2];
        const x = parseFloat((params.match(/\bX\s+([-\d.eE+]+)/) || [])[1]) || 0;
        const y = parseFloat((params.match(/\bY\s+([-\d.eE+]+)/) || [])[1]) || 0;
        const z = parseFloat((params.match(/\bZ\s+([-\d.eE+]+)/) || [])[1]) || 0;
        points[num] = { x, y, z };
      }
    }
    return points;
  },

  toGcode(parsedSrc, parsedDat) {
    const cmds = [];
    let inWeld = false;
    let hasHomed = false;
    let lastX = null, lastY = null, lastZ = null;
    const round = (v) => Math.round(v * 10000) / 10000;

    for (const m of parsedSrc.motions) {
      if (m.isHome) {
        if (!hasHomed) {
          cmds.push({ type: 'G0', params: { X: 0, Y: 0, Z: 0 }, raw: 'G0 X0 Y0 Z0' });
          hasHomed = true;
        }
        lastX = 0; lastY = 0; lastZ = 0;
        continue;
      }

      const pt = parsedDat[m.pointIdx] || { x: 0, y: 0, z: 0 };

      if (m.welding && !inWeld) {
        cmds.push({ type: 'M3', params: {}, raw: 'M3' });
        inWeld = true;
      }
      if (!m.welding && inWeld && m.type === 'PTP') {
        cmds.push({ type: 'M5', params: {}, raw: 'M5' });
        inWeld = false;
      }

      if (m.type === 'CIRC') {
        const auxPt = parsedDat[m.auxIdx] || { x: pt.x + 5, y: pt.y, z: pt.z };
        const x = round(pt.x), y = round(pt.y), z = round(pt.z);
        const sx = lastX !== null ? lastX : 0;
        const sy = lastY !== null ? lastY : 0;
        const dx = auxPt.x - sx;
        const dy = auxPt.y - sy;
        const arcLen = Math.hypot(dx, dy) || 1;
        const i = round(dx), j = round(dy);
        const arcType = this._arcDirection({ x: sx, y: sy }, auxPt, { x, y });
        const params = { X: x, Y: y, Z: z, I: i, J: j };
        let raw = arcType;
        for (const [k, v] of Object.entries(params)) raw += ' ' + k + v;
        cmds.push({ type: arcType, params, raw });
        lastX = x; lastY = y; lastZ = z;
        continue;
      }

      const isRapid = m.type === 'PTP' && !m.welding;
      const gType = isRapid ? 'G0' : 'G1';
      const x = round(pt.x), y = round(pt.y), z = round(pt.z);
      const params = { X: x, Y: y, Z: z, F: isRapid ? 6000 : 3000 };
      let raw = gType;
      for (const [k, v] of Object.entries(params)) raw += ' ' + k + v;
      cmds.push({ type: gType, params, raw });
      lastX = x; lastY = y; lastZ = z;
    }

    if (inWeld) cmds.push({ type: 'M5', params: {}, raw: 'M5' });
    return cmds;
  }

};