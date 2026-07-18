# Edit.GC — Documentação do Funcionamento

## 1. Visão Geral

Edit.GC é um editor CNC G-code com suporte para conversão SVG/DXF → G-code, templates de máquina, pré-visualização 2D, edição interativa e suporte especial para máquina SM300.

### Tecnologias
- **UI:** HTML5 + CSS3 + JavaScript puro (sem frameworks)
- **Persistência:** localStorage (settings, machine options, recent files, layout)
- **Templates:** IndexedDB (user templates) + JSON files (template files)
- **Pré-visualização:** Canvas API com renderização assíncrona em chunks
- **Parsing:** DOMParser (SVG), parser DXF próprio, parser G-code próprio

---

## 2. Estrutura de Ficheiros

```
app/
├── index.html              # Estrutura da página (widgets, painéis, modais)
├── styles.css               # Layout grid, cores, componentes
├── templates/               # Ficheiros de template JSON
│   ├── GRBL 1.1h.json
│   ├── Marlin.json
│   ├── SM300.json
│   └── Smoothieware.json
└── js/
    ├── config.js            # Constantes da aplicação (limites, step sizes)
    ├── helpers.js           # safeMin/safeMax/safeMinMax (iterativo, sem stack overflow)
    ├── state.js             # Estado global (workingCmds, originalCmds, preview, etc.)
    ├── globals.js           # previewOpts (flags de renderização)
    ├── main.js              # Bootstrap: DOMContentLoaded → ui.init()
    ├── fileManager.js       # Leitura/descarregamento de ficheiros
    ├── gcodeParser.js       # Parse/serialize/highlight/transform de G-code
    ├── templateManager.js   # Sistema de templates (built-in + user + IndexedDB)
    ├── settings.js          # Definições UI persistidas em localStorage
    ├── recentFiles.js       # Histórico de ficheiros recentes (localStorage)
    ├── highlight.js         # Syntax highlighting + scroll sync textarea
    ├── svgConverter.js      # Conversor SVG → G-code
    ├── dxfParser.js         # Parser DXF → segmentos
    ├── undoRedo.js          # Undo/Redo stack-based (max 50)
    ├── segmentBuilder.js    # G-code commands → segmentos de linha para preview
    ├── preview.js           # Preview canvas + playback + pan/zoom
    ├── dragdrop.js          # Drag & drop de ficheiros
    ├── ui.js                # Controlador principal (event handlers, widgets)
    ├── modal.js             # Gestão de janelas modais
    ├── virtualEditor.js     # Editor virtual para ficheiros grandes (>15000 linhas)
    ├── findReplace.js       # Find & Replace com regex + case-sensitive
    └── exportTools.js       # Export G-code → SVG / DXF
```

---

## 3. Widgets e Layout (index.html)

### Layout Grid
```
┌─────────────────────────────────────────────────┐
│  #banner (32px) — logo + Save/Undo/Redo/Reset  │
├──────────────┬──────────────────────────────────┤
│  #col-left   │  #col-center                     │
│  (420px)     │  ┌─ #preview-area ─────────────┐ │
│              │  │  toolbar + canvas            │ │
│  • Scale     │  ├─ #editor-area ──────────────┤ │
│  • Template  │  │  tabs (Original/Working)    │ │
│  • Machine   │  │  find/replace bar           │ │
│    Options   │  │  textarea + highlight       │ │
│  • Gcode     │  └─────────────────────────────┘ │
│    Info      │                                   │
│  • Points    └──────────────────────────────────┘
├──────────────┴──────────────────────────────────┤
│  #footer (24px) — status msg + progress bar      │
└─────────────────────────────────────────────────┘
```

### Coluna Esquerda (Widgets)

| Widget | data-widget | Função | Controlos Chave |
|--------|-------------|--------|-----------------|
| **Scale** | `scale` | Redimensionar desenho (W × H, aspeto locked) | `#resizeW`, `#resizeHDisplay`, `#btnScaleUp/Down`, `#btnApplyScale`, `#scaleStep` |
| **Template** | `template` | Selecionar/extrarir/aplicar templates | `#templateSelect`, `#btnExtractTemplate`, `#btnApplyTemplate` |
| **Machine Options** | `machineOptions` | Opções específicas da máquina (feeds, passes, laser, gás) | `#btnToggleMachineOptions`, `#machineOptionsBody` (populado dinamicamente) |
| **Gcode Info** | `info` | Info do G-code (nome, unidades, linhas, distância, tempo, warnings) | `#btnToggleGcodeInfo`, `#gcodeInfoBody` + checkboxes (bounds, compare, etc.) |
| **Points Editor** | `points` | Editor de pontos (mark start, side, offset, batch, add) | `#btnTogglePointsPanel` abre overlay `#col-points` |

### Painel de Pontos (#col-points)
Overlay deslizante da esquerda com:
- Mark Start / Set Side buttons
- Tabela de pontos (índice, X, Y, Z, Distância)
- Secções colapsáveis:
  - **Set Start Coordinates** (origem X/Y/Z + G92)
  - **Add Points** (offset X/Y/Z + start/stop toggle + Apply)
  - **Shift Points** (batch axis + valor + target)

### Modais
- `#modal-preview` — Preview full-screen
- `#modal-gcode` — Editor G-code maximizado (tabs: original/working/dual)
- `#modal-widget` — Widget body maximizado
- `#modal-analysis` — Análise completa do G-code

---

## 4. Estado Global (state.js)

```js
state = {
  originalText:  '',       // Raw text do G-code original
  originalCmds:  [],       // Parsed original commands
  originalName:  '',       // Nome do ficheiro original
  workingCmds:   [],       // Command array atual (editável)
  template:      null,     // Template ativo
  templateMeta:  null,     // { ext, lineEnd }
  previewScale:  1,        // Escala de zoom
  previewOffX/Y: 0,        // Pan offset (pixels CSS)
  svgPreviewMode: 'outlines', // outlines | raster | points
  svgImg:        null,     // Image object (raster mode)
  svgDims:       null,     // { width, height } do SVG
  svgText:       '',       // Raw SVG text
  svgSegments:   null,     // SVG segments cacheados
  svgScale:      1,
  dxfSegments:   null,
  dxfText:       '',
  dxfName:       '',
  mode:          'gcode',  // gcode | svg | dxf
  resizeBaseW/H: 0,        // Dimensões atuais para Scale
  originalW/H:   0,        // Dimensões originais (para Reset)
  selectedPoints: new Set(), // Indices de pontos selecionados
  dirty:         false,
  showRapids:    true,
  _duringUndoRedo: false,  // Previne undo recursivo
}
```

---

## 5. Conversão SVG/DXF → G-code (Fluxo Completo)

### 5.1. Load
1. **SVG:** `#fileInputSvg` → read text → `DOMParser` → extrair viewBox/dimensões → criar `Image` para preview raster → `state.svgText`, `state.svgDims`, `state.svgImg`
2. **DXF:** `#fileInputDxf` → read text → `dxfParser.parse()` (LINE, CIRCLE, ARC, LWPOLYLINE, POLYLINE, POINT) → `state.dxfSegments`

### 5.2. Convert (botão Convert)
**Handler:** `#btnSlice` no toolbar do preview

```
state.svgText/dxfSegments
        │
        ▼
templateManager.applyToSvgConverter(template, userOptions)
  → lê Machine Options da localStorage (machineOpts_<templateName>)
  → constrói { laser: { feedCut, feedTravel, sMax, laserOnCmd, laserOffCmd, passes },
               header[], footer[], commandComments{} }
        │
        ▼
svgConverter.convert(svgText, processed)      # para SVG
svgConverter.segmentsToGcode(dxfSegments, processed)  # para DXF
        │
        ├── Extrai header do template (G21, G90, laser on, etc.)
        ├── Para cada segmento:
        │   ├── G0 rapido para start point
        │   └── Para cada pass (1..passes):
        │       ├── G1 cut points (com F e S)
        │       └── G0 rapido de volta ao start (entre passes)
        ├── Se SM300: implicit motion (X Y F sem G0/G1, sem S)
        ├── Footer (laser off, return home, M30)
        └── Y flip (SVG Y-down → CNC Y-up)
        │
        ▼
Aplicar Scale:
  fx = tw / svgDims.width    # para SVG
  fy = th / svgDims.height
  cmds = scaleCommands(cmds, fx)  # uniforme se fx≈fy
  ou scaleCommandsXY(cmds, fx, fy)
        │
        ▼
state.workingCmds = cmds
state.originalCmds = cmds.map(c => ({...c}))
state.originalText = gcode
state.mode = 'gcode'
        │
        ▼
Editors atualizados + preview.render()
```

### 5.3. SM300 Mode
Detetado automaticamente quando `laserOnCmd` contém 'SM3':
- Comandos implícitos: `X90 Y200 Z-50 F400` (sem G0/G1)
- Sem parâmetro S (power via registos RLAD/RRBM na máquina)
- Header especial: `G98$SPROG$`, `SM3`, `SA3`, `RLAD`, `RRBM`, `SM12`

---

## 6. Sistema de Templates

### 6.1. Templates Built-in (4)
| Nome | Laser On | Laser Off | Ext | Notas |
|------|----------|-----------|-----|-------|
| **GRBL 1.1h** | M4 S0 | M5 S0 | .gcode | G21, G90, G92 X0 Y0 Z0 |
| **Smoothieware** | M3 S0 | M5 | .gcode | G21, G90 |
| **Marlin (Laser)** | M3 S0 | M5 | .gcode | G21, G90, G92, M84 |
| **SM300** | SM3 | RM3 | .cnc | G98$, SA3, RLAD, RRBM, SM12, gas, safety |

### 6.2. User Templates
- Importados de ficheiros JSON (via `#fileInputTemplate`)
- Extraídos de G-code existente (via `#btnExtractTemplate`)
- Armazenados em IndexedDB (`editgc-templates`)

### 6.3. Template Data Structure
```js
{ name, ext, lineEnd, customCommands[], toolCodes[],
  laserOnCmd, laserOffCmd, header[], footer[],
  feedCut, feedTravel, sMax, commandComments{}, originalName }
```

### 6.4. Extrair Template de G-code
`templateManager.extractFromText(text, originalName)`:
1. Analisa header (linhas antes do primeiro comando de movimento)
2. Analisa footer (linhas depois do último comando de movimento)
3. Deteta laserOnCmd (primeiro M3/M4/SM3) e laserOffCmd (primeiro M5/RM3)
4. Recolhe customCommands (comandos não-standard, não G0-G3, não M30)
5. Recolhe toolCodes (T00-T99)

---

## 7. Machine Options

### 7.1. Definições por Template
`templateManager.getTemplateOptions(name)` retorna grupos de opções:

| Template | Secções |
|----------|---------|
| **SM300** | Passes, Laser Program, Feed Rates, Focus, Gas, Safety |
| **GRBL 1.1h** | Passes, Laser, Feed Rates, Homing, Safety |
| **Smoothieware** | Passes, Laser, Feed Rates, Laser Config, Safety |
| **Marlin (Laser)** | Passes, Laser, Feed Rates, Motion, Safety |

### 7.2. Cada Opção
```js
{ id, label, type: 'select', values[], default, unit }
```

### 7.3. Ciclo de Vida
1. **Populate:** `ui._populateMachineOptions()` carrega `getTemplateOptions(name)`, lê localStorage (`machineOpts_<templateName>`), renderiza `<select>` em `#machineOptionsBody`
2. **Change:** Guarda em localStorage via `_saveMachineOpts()`
3. **Apply:** `ui._buildProcessedTemplate()` → `templateManager.applyToSvgConverter(tpl, opts)` → funde defaults com user selections, constrói header/footer dinamicamente

### 7.4. Header/Footer Dinâmico
`_buildHeader(t, opts)` e `_buildFooter(t, opts)`:
- Se `gas === 'none'` → remove `SM12` do header
- Se `homing === 'none'` → remove `$H`
- Se `safetyOff === 'none'` → remove `RA3`/`RA4` do footer
- Se `laserCheck === 'none'` → remove `G22$L_TEST$01`
- Se `returnHome === 'none'` → remove return home do footer

---

## 8. Scale Widget

### Funcionamento
- **Input único:** `#resizeW` (width)
- **Display:** `#resizeHDisplay` (height, read-only, calculado automaticamente)
- **Aspect ratio locked:** `h = w * (resizeBaseH / resizeBaseW)`
- **Step:** `#scaleStep` (0.01 / 0.1 / 1 / 10 / 100)
- **Setas:** `#btnScaleUp` (+step), `#btnScaleDown` (-step)
- **Reset:** `#btnApplyScale` → restaura `resizeBaseW/H = originalW/H`

### Quando é Aplicado
- **Apenas durante Convert** (botão Convert na toolbar)
- Scale não modifica G-code diretamente — o valor de `#resizeW` é lido durante a conversão para escalar as coordenadas
- Live preview atualiza `state.svgScale`/`state.dxfScale` para preview visual

---

## 9. Preview Canvas

### Renderização Assíncrona
- `segmentBuilder.build(commands, maxSegs, initialState)` → `{ points, segments[], truncated, x, y, z }`
- Cada segmento: `{ a: {x,y,z}, b: {x,y,z}, rapid, arc, cmdIdx, toolOn, feed }`
- Construído em chunks de 5000 comandos via `requestAnimationFrame` (evita UI freeze)
- Barra de progresso durante construção

### Pipeline de Desenho
1. Grid adaptativo (step size baseado no zoom)
2. Bounding box (opcional, checkbox)
3. Toolpath:
   - Tool ON → roxo glow + roxo line
   - Tool OFF → vermelho glow + vermelho line
   - Rapid → cinzento tracejado
   - Color by feed (opcional): azul (lento) / amber (médio) / vermelho (rápido)
4. Original overlay (Compare mode, opcional)
5. Marcas start/end, Mark Start arrow, playback head
6. Selected points (laranja)
7. Minimap (canto superior direito)
8. Legenda (painel escuro com cores)
9. Seta de direção

### Pan/Zoom
- **Roda do rato:** zoom centrado no cursor
- **Arrastar (esquerda/meio):** pan
- **Teclado:** +/- zoom, setas/WASD pan, Home fit
- **Botão Fit:** `preview.fitView()` — reset zoom/pan

### Playback
- `Play/Pause/Stop` buttons
- Speed control (1x-100x)
- Scrub slider (`#playProgress`)
- Cabeça de playback: segmento cyan + cone de direção
- Dimming progressivo de segmentos passados (alpha 0.35)

### View Modes (SVG/DXF)
- **Outlines:** paths azuis
- **Raster:** imagem SVG renderizada + checkerboard (SVG only)
- **Points:** vertex dots azuis

---

## 10. Points Editor / Mark Start / Set Side

### Points Panel (#col-points)
Overlay fixo que desliza da esquerda:

#### Points Table
- Recolhe todas as coordenadas únicas do G-code
- Colunas: #, X, Y, Z, Distância
- Clique na linha → foco no ponto (círculo laranja + backplot highlight)
- Clique no canvas → hit-test segments → seleciona ponto mais próximo

#### Mark Start
1. Utilizador seleciona ponto (clique canvas ou tabela)
2. Clica **Mark Start** → `ui._markStartIdx = idx`
3. Preview mostra seta vermelha na posição com label "MARK"

#### Set Side
1. Utilizador seleciona ponto
2. Clica **Set Side →** → cycling: null → left → right → null
3. Preview mostra seta direcional (← ou →) na posição do Mark Start

#### Set Start Coordinates
- Inputs X/Y/Z + **Apply** → aplica G92 offset a todos os comandos

#### Add Points
- Step selector + offset X/Y/Z
- **Start/Stop toggle:** se ativo, insere laserOn antes e laserOff depois dos pontos adicionados
- **Apply:** insere pontos duplicados com offset no workingCmds

#### Shift Points
- Batch axis (X/Y/Z/A/B/C) + valor + target (all/selected/range)
- **Apply:** subtrai valor do eixo escolhido nas linhas selecionadas

---

## 11. Undo/Redo

### undoRedo module
- Stack-based, max 50 entries
- `push(cmds)` — deep-clone (map + spread params) + push para undoStack, clear redoStack
- `undo()` — push current → redoStack, pop de undoStack
- `redo()` — push current → undoStack, pop de redoStack

### Quando é feito push
- Antes de qualquer edição manual (editor working, debounced)
- Antes de Reset
- Antes de Convert
- Antes de operações batch/offset

### Quando NÃO é feito push
- Durante undo/redo (flag `state._duringUndoRedo`)
- Durante refreshWorking (operações internas)

### Shortcuts
- Ctrl+Z → Undo
- Ctrl+Y / Shift+Ctrl+Z → Redo

---

## 12. Find & Replace

### Main Editor (`findReplace.js`)
- **Open:** Ctrl+F (find), Ctrl+H (replace)
- **Real-time search** enquanto digita
- **Regex support:** `#findRegex` checkbox
- **Case-sensitive:** `#findCase` checkbox
- **Navegação:** Enter (next), F3 (next), Shift+F3 (prev)
- **Replace:** substitui match atual + re-search
- **Replace All:** substitui todos (com undo push)

### Modal Editor (`modalFind` em ui.js)
- Cópia separada para editor modal (`#editorWorkingModal`)
- Mesma funcionalidade

### Após Replace All
1. Parse do texto modificado
2. Undo push
3. `state.workingCmds = newCmds`
4. `ui.refreshWorking()` → re-serialize, re-highlight, re-draw preview

---

## 13. Save & Export

### Save (#btnSave)
- `gcodeParser.serialize(workingCmds)` (respeita lineEnd do template)
- `fileManager.downloadGcode(blob, filename)`
- Nome: `originalName` + `.` + template ext

### Save As (#btnSaveAs)
- File System Access API (`showSaveFilePicker`)
- Fallback: Blob download

### Export SVG (G-code → SVG)
- `exportTools.exportSvg(commands)` — circles vermelhos (laser on) / verdes (laser off)

### Export DXF (G-code → DXF)
- `exportTools.exportDxf(commands)` — AC1009, layers LASER_ON/LASER_OFF

---

## 14. G-code Parser/Serializer

### Parser (`gcodeParser.parse(text)`)
```js
{ lineIndex, raw, type, params, comment, isBlank, isComment, blockDelete }
```
- Suporta: G0-G3, G4, G17-G19, G20-G21, G28, G90-G91, G92, G98-G99, M-codes, T-codes
- Parâmetros: A-Z e `=`
- Comentários: `;` e `( ... )`
- Block delete: `/` no início
- Multi-line: `\` continuação
- SM300 commands: `RLAD`, `RRBM`, `SM3`, `RM3`, `SA3`, `RA3`, `RA4`, `SM12`, `RM12`, `G22$`, `G26H`, `M14`, `G04T`, `G04TR`, `G60`, `G62`, `G48%`, `RAIN`/`ROUT`/`RTST`/`RAOT`, `RMUL`/`RSUB`/`RADD`

### Serializer (`gcodeParser.serialize(commands)`)
- Reconstrói texto a partir do array de comandos
- Respeita `lineEnd` do template

### Transform Methods
- `applyOffset(cmds, dx, dy, dz)` — deslocamento global
- `scaleCommands(cmds, factor)` — escala uniforme
- `scaleCommandsXY(cmds, fx, fy)` — escala não-uniforme
- `applyBatchParam(cmds, axis, delta, indices)` — shift de eixo
- `applyBatchParamFactor(cmds, param, factor, indices)` — escala de parâmetro
- `mirrorX(cmds)`, `mirrorY(cmds)` — espelho
- `rotate(cmds, angle)` — rotação 90° múltiplos

---

## 15. Virtual Editor

- Usado automaticamente quando o ficheiro tem >15000 linhas (`CFG.HL_LIMIT`)
- Renderiza apenas ~20-30 linhas visíveis no scroll container
- Scrollbar nativa + spacer div para altura total
- Syntax highlighting inline (G0/G1/G2/G3/M-codes/number/comentário cores)
- Undo stack próprio (100 níveis, Ctrl+Z)
- Find & Replace adaptado

---

## 16. Drag & Drop

`dragdrop.js` → `setupDragDrop(zone)`:
- Files .gcode/.nc/.cnc → handler G-code
- Files .svg → handler SVG
- Files .dxf → handler DXF
- Visual feedback: drop zone highlight

---

## 17. Modais

### Sistema Central (`modal.js`)
```js
openModal(id)      // Abre modal por ID
closeModal(id)     // Fecha modal
closeModalOutside(e, id)  // Fecha ao clicar fora
```

### Modais Disponíveis
| ID | Conteúdo |
|----|----------|
| `#modal-preview` | Preview canvas maximizado (clona pan/zoom) |
| `#modal-gcode` | Editor maximizado com tabs (original/working/dual view) |
| `#modal-widget` | Widget body maximizado |
| `#modal-analysis` | Análise completa do G-code |

### Sync de Modais
- `syncGcodeEditors()` — sincroniza texto dos editors modal com state
- `syncGcodeDualEditors()` — sincroniza dual view
- Ao fechar modal preview: restaura pan/zoom do canvas principal

---

## 18. Settings (localStorage)

`settings.js` → `editgc_settings` key:
- scaleStep, batchStep, originStep, pointsStep
- speedFactor, playbackSpeed
- lastTab, findReplace bar state
- theme (light/dark) — não implementado via CSS variables
- Widget layout order (drag-and-drop reordering)
- Active template name
- Panel open/close state

---

## 19. Widget System

### Maximize Widget
- Botão `▢` no `.widget-title` clona o `.widget-body` para `#modal-widget`
- Widgets sem maximize: Scale, Points Editor (têm botões dedicados)

### Widget Drag-and-Drop Ordering
- `#lp-widget-list` + `lp-widget-row` elements
- Arrow up/down reordering
- Salva ordem em localStorage (`editgc_layout_order`)
- Aplica na inicialização (reordena DOM)

---

## 20. Cache Browser

- **Todos os ficheiros JS (excepto preview.js):** cache normal (sem query params)
- **preview.js:** `?nocache=1` — sempre fresh
- **CSS:** cache normal (sem query params)
- **Templates:** IndexedDB (não HTTP) — sem cache browser

---

## 21. Sistema de Testes

### Unit Tests (`test/unit.js`)
Testes de lógica pura sem browser. Executar:
```powershell
node test/unit.js
```
Cobre: parser G-code, scale, offset, mirror, rotate, batch, undo/redo, multi-pass simulation, SM300 commands.

### Integration Tests (`test/runner.js`)
Testes com browser headless (Puppeteer). Executar:
```powershell
node test/runner.js
```
Cobre: load da página, templates, Machine Options, load SVG/DXF, Convert button, passes, SM300 mode, undo/redo.

### Test all
```powershell
node test/unit.js && node test/runner.js
```
