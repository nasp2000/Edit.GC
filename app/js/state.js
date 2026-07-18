// ---- Estado global ------------------------------------------------------------------------------------------
const state = {
  originalText:  '',
  originalCmds:  [],       // parsed original commands (for Reset)
  originalName:  '',      // nome do ficheiro aberto
  workingCmds:   [],
  template:      null,    // template activo
  templateMeta:  null,    // { ext, lineEnd, originalName } from template
  undoStack:     [],
  redoStack:     [],
    previewScale: 1,
    previewOffX: 0,
    previewOffY: 0,
    svgPreviewMode: 'outlines', // 'outlines' | 'raster'
  svgImg:        null,    // Image quando SVG carregado
  svgDims:       null,    // { width, height }
  svgText:       '',      // raw SVG text for conversion
  svgSegments:   null,    // cached parsed SVG segments (for preview)
  svgScale:      1,       // scale factor for SVG preview (outline/raster)
  svgRotation:   0,       // cumulative rotation in degrees (0/90/180/270) for SVG mode
  dxfSegments:   null,    // parsed DXF segments
  dxfText:       '',      // raw DXF text
  dxfName:       '',      // DXF file name
  mode:          'gcode', // 'gcode' | 'svg' | 'dxf'
  resizeBaseW:   0,       // W when resize panel was last refreshed
  resizeBaseH:   0,       // H when resize panel was last refreshed
  originalW:     0,       // original W at file load (for Reset)
  originalH:     0,       // original H at file load (for Reset)
  _boundsCache:  null,    // { minX, maxX, minY, maxY, rangeX, rangeY } cache
  selectedPoints: new Set(), // indices of selected points

  dirty:         false,   // unsaved changes flag
  _duringUndoRedo: false,// prevents recursive undo push during undo/redo
  showRapids:     true,   // show G0 rapid moves in preview
};
