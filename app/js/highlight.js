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
