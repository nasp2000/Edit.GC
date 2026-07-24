# KUKA Robot Template — Implementation Plan

## File format analysis

KUKA KRL programs consist of two files:
- **`.src`** — motion program (PTP, LIN, SLIN commands with point references)
- **`.dat`** — point coordinates and motion parameters (E6POS, FDAT, LDAT, PDAT)

Both are plain text files with KRL syntax.

### .src structure (template)

```
&ACCESS RVP
&REL N
&PARAM EDITMASK = *
DEF ProgramName( )
;--- INI (init, interrupts, BAS) ---
;--- PTP HOME ---
;--- Table select ($OUT[13/14]) ---
;--- WHILE/SWITCH jobNum ---
  ;--- Welding Approach (PTP approach point) ---
  ;--- Request Welding ON (TRIGGER $OUT[67]) ---
  ;--- Welding Init (LIN to start point) ---
  ;--- Confirmation Welding ON (WAIT $IN[68], $OUT[67]=FALSE) ---
  ;--- Trajectory (SLIN P1...PN) *** GENERATED ***
  ;--- Request Welding OFF (TRIGGER $OUT[68] at END) ---
  ;--- Welding Final (SLIN last point) ---
  ;--- Confirmation Welding OFF (WAIT $IN[69], $OUT[68]=FALSE) ---
  ;--- Welding Out (SLIN exit) ---
  ;--- Return to Home (PTP HOME) ---
;--- ENDSWITCH, ENDWHILE ---
END
```

### .dat structure

```
DEFDAT ProgramName
;--- External declarations ---
;--- DECL PDAT/LDAT for motion parameters ---
;--- DECL E6POS XP1, XP2, ... XPN (generated) ---
;--- DECL FDAT FP1, FP2, ... FPN (generated) ---
;--- DECL LAST_BASIS ---
ENDDAT
```

### E6POS format

`DECL E6POS XP1={X 1234.5, Y 678.9, Z 10.0, A 0, B 0, C 0, S 0, T 0, E1 0, E2 0, E3 0, E4 0, E5 0, E6 0}`

- X, Y, Z — position in mm
- A, B, C — orientation (Euler angles, degrees)
- S — status
- T — turn
- E1-E6 — external axes

### SLIN command format (in .src)

```
;FOLD SLIN P1 CONT Vel=0.008 m/s CPDAT1 Tool[1]:tool Base[1]:base;%{PE}...
SLIN XP1 WITH $VEL=SVEL_CP(0.008,,LCPDAT1), $TOOL=STOOL2(FP1),
  $BASE=EK(K_ROOT(FP1.BASE_NO),K_TYPE(FP1.BASE_NO),K_OFFS(FP1.BASE_NO)),
  $IPO_MODE=SIPO_MODE(FP1.IPO_FRAME), $LOAD=SLOAD(FP1.TOOL_NO),
  $ACC=SACC_CP(LCPDAT1), $APO=SAPO(LCPDAT1),
  $ORI_TYPE=SORI_TYP(LCPDAT1), $JERK=SJERK(LCPDAT1) C_SPL
;ENDFOLD
```

## Implementation plan — SIMPLIFIED

**Core idea**: Internally everything stays as G-code. The KUKA template only changes the **output format** on convert/export. Preview, editing, widgets — all work on G-code internally.

```
SVG/DXF → G-code (internal, already works) → Preview + Widgets
                                              ↓
                                         KUKA output (.src + .dat)
```

### Phase 1 — Template

1. **Add KUKA built-in template** to `templateManager.js`:
   - `ext`: `src`
   - `lineEnd`: `\r\n`
   - `laserOnCmd`: `TRIGGER_67_ON` (our internal command name)
   - `laserOffCmd`: `TRIGGER_68_OFF`
   - Machine options: toolNo (1-16), baseNo (1-32), weldVel m/s (0.005-0.05), approachVel m/s, travelVel %, orientation A/B/C

### Phase 2 — G-code to KUKA converter

2. **`kukaConverter.js`** — converts internal G-code command array to .src + .dat text:
   - Scan G-code for motion commands (G0→PTP, G1→SLIN, G2/G3→SLIN with CIRC)
   - Number points P1..PN sequentially
   - Track welding state (M3/M4→welding ON, M5→welding OFF)
   - Generate approach/init/welding ON before first cut
   - Generate final/welding OFF/out after last cut
   - Write .src with SLIN XP1..XPN commands
   - Write .dat with DECL E6POS XP1..XPN (X,Y,Z from G-code, A/B/C from options)
   - Write .dat with DECL FDAT per point, DECL LDAT/PDAT

3. **`fileManager.downloadKuka(gcode, template)`** — triggers download of both files

### Phase 3 — Load KUKA files

4. **Parse .src on load** (in `gcodeParser.js` or new parser):
   - Extract SLIN/LIN/PTP commands
   - Read companion .dat for E6POS coordinates
   - Convert to internal G-code format (PTP→G0, SLIN→G1)
   - Show in editor as G-code (original .src kept as reference)

### Phase 4 — Export

5. **Save**: serialize internal G-code back to .src/.dat via the converter

## Files to create/modify

| File | Action | Purpose |
|------|--------|---------|
| `app/js/kukaConverter.js` | **NEW** | G-code → .src/.dat converter |
| `app/js/templateManager.js` | MODIFY | KUKA template + machine options |
| `app/js/ui.js` | MODIFY | Convert button → KUKA output trigger |
| `app/js/fileManager.js` | MODIFY | `downloadKuka()` method |
| `app/templates/KUKA.json` | **NEW** | Template definition |
| `app/index.html` | MODIFY | Accept .src file input |

## Key differences vs G-code templates

| Feature | G-code (Grbl/SM300) | KUKA |
|---------|---------------------|------|
| Internal format | G-code commands | **G-code commands** (same!) |
| Preview | G-code segments | G-code segments (same!) |
| Widget editing | On G-code commands | On G-code commands (same!) |
| Output format | Serialize to .gcode | **Convert** to .src + .dat pair |
| Motion mapping | G0=rapid, G1=cut | G0→PTP, G1→SLIN |
| Coordinates | Inline params | Point table (.dat) |
| Velocity | F mm/min | Vel m/s (option) |
| Tool | M3/M4/M5 inline | Trigger wrappers in template |

## E6POS point format

```
DECL E6POS XP{n}={X {x},Y {y},Z {z},A {a},B {b},C {c},S 6,T 26,E1 0,E2 0,E3 0,E4 0,E5 0,E6 0}
DECL FDAT FP{n}={TOOL_NO {tool},BASE_NO {base},IPO_FRAME #BASE,POINT2[] " ",TQ_STATE FALSE}
```

## SLIN command format

```
;FOLD SLIN P{n} CONT Vel={vel} m/s CPDAT{cp} Tool[{tool}]:tool Base[{base}]:base;...
SLIN XP{n} WITH $VEL=SVEL_CP({vel},,LCPDAT{cp}), ... C_SPL
;ENDFOLD
```
