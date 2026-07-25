function truncateForEditor(text) {
  if (!text) return text;
  const lines = text.split('\n');
  if (lines.length <= CFG.EDITOR_LINE_LIMIT) return text;
  return lines.slice(0, CFG.EDITOR_LINE_LIMIT).join('\n') +
    `\n\n;  !  File truncated: showing first ${CFG.EDITOR_LINE_LIMIT.toLocaleString()} of ${lines.length.toLocaleString()} lines.`;
}
function editorLineCount(text) {
  return text ? text.split('\n').length : 0;
}

// ---- syntaxHighlight ----------------------------------------------------------------------------------------
function applyHighlight(el, text) {
  if (!el) return;
  const skipHL = text && text.split('\n').length > CFG.HL_LIMIT;
  if (skipHL) {
    el.innerHTML = ''; // too large, skip highlight
  } else {
    el.innerHTML = gcodeParser.highlight(text);
  }
  // Toggle visible text on the paired textarea when highlight is off
  const taMap = { highlightOriginal: 'editorOriginal', highlightWorking: 'editorWorking', highlightOriginalModal: 'editorOriginalModal', highlightWorkingModal: 'editorWorkingModal', highlightOriginalModalDual: 'editorOriginalModalDual', highlightWorkingModalDual: 'editorWorkingModalDual' };
  const ta = document.getElementById(taMap[el.id]);
  if (ta) {
    if (skipHL) ta.classList.add('no-highlight');
    else ta.classList.remove('no-highlight');
  }
  const id = el.id;
  if (id === 'highlightOriginal') updateLineNumbers('linesOriginal', 'editorOriginal');
  else if (id === 'highlightWorking') updateLineNumbers('linesWorking', 'editorWorking');
  else if (id === 'highlightOriginalModal') updateLineNumbers('linesOriginalModal', 'editorOriginalModal');
  else if (id === 'highlightWorkingModal') updateLineNumbers('linesWorkingModal', 'editorWorkingModal');
  else if (id === 'highlightOriginalModalDual') updateLineNumbers('linesOriginalModalDual', 'editorOriginalModalDual');
  else if (id === 'highlightWorkingModalDual') updateLineNumbers('linesWorkingModalDual', 'editorWorkingModalDual');
}

function updateLineNumbers(linesId, textareaId) {
  const el = document.getElementById(linesId);
  const ta = document.getElementById(textareaId);
  if (!el || !ta) return;
  const n = (ta.value || '').split('\n').length;
  const nums = [];
  for (let i = 1; i <= n; i++) nums.push(String(i).padStart(4, ' '));
  el.textContent = nums.join('\n');
}

function setupScrollSync(textareaId, overlayId, linesId) {
  const ta = document.getElementById(textareaId);
  const ov = document.getElementById(overlayId);
  const ln = document.getElementById(linesId);
  if (!ta || !ov) return;
  const sync = () => {
    ov.scrollTop  = ta.scrollTop;
    ov.scrollLeft = ta.scrollLeft;
    if (ln) ln.scrollTop = ta.scrollTop;
  };
  ta.addEventListener('scroll', sync);
}

function kukaHighlight(text) {
  if (!text) return '';
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text.replace(/\r/g, '').split('\n').map(line => {
    if (/^\s*;/.test(line)) {
      const isSection = /^;---/.test(line.trim());
      const cls = isSection ? 'hl-kuka-section' : 'hl-comment';
      return `<span class="${cls}">${esc(line)}</span>`;
    }
    const cmtIdx = line.indexOf(';');
    let body = cmtIdx >= 0 ? line.substring(0, cmtIdx) : line;
    let cmt = cmtIdx >= 0 ? line.substring(cmtIdx) : '';
    body = body
      .replace(/\b(DEF|END|ENDDAT|ENDSWITCH|ENDCASE|ENDWHILE|DEFDAT|DECL|INI|GLOBAL|INTERRUPT|CONTINUE|SWITCH|CASE|DEFAULT|WHILE|EXT|SUCCESS|CONST)\b/gi,
        '<span class="hl-kw">$1</span>')
      .replace(/\b(PTP|LIN|SLIN|CIRC|TRIGGER|WAIT|BAS|SVEL_CP|PTP_VEL|SACC_CP|SAPO|SORI_TYP|SJERK|SIPO_MODE|SLOAD)\b/gi,
        '<span class="hl-motion">$1</span>')
      .replace(/\b(\$[A-Z_]+|TRUE|FALSE|XHOME|FHOME|PDEFAULT|CONT|C_DIS|C_SPL|POSITION|DISTANCE|DELAY|WHEN|DO|AT|FOR|WITH|STATE|VEL|ACC|APO_DIST|APO_FAC|ORI_TYP|JERK_FAC|TOOL_NO|BASE_NO|IPO_FRAME|TQ_STATE|POINT2|LAST_BASIS|GEAR_JERK|EXAX_IGN|APO_MODE|AXIS_VEL|AXIS_ACC|CIRC_TYP|CB|AUX_PT|TARGET_PT|ORI|CONSIDER|INTERPOLATE)\b/gi,
        '<span class="hl-param">$1</span>')
      .replace(/\b(XP\d+|FP\d+|LCPDAT\d+|CPDAT\d+|PPDAT\d+|PDAT\d+|LPDAT\d+|LPCPDAT|\d+)\b/gi,
        '<span class="hl-num">$1</span>')
      .replace(/\b(STOOL2|EK|K_ROOT|K_TYPE|K_OFFS|SVEL_CP|PTP_VEL|SACC_CP|SAPO|SORI_TYP|SJERK|SIPO_MODE|SLOAD)\b/gi,
        '<span class="hl-kuka-func">$1</span>');
    return body + (cmt ? `<span class="hl-comment">${esc(cmt)}</span>` : '');
  }).join('\n');
}
