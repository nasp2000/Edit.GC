// ---- fileManager ----------------------------------------------------------------------------------------------
const fileManager = {
  readGcode(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = e => resolve(e.target.result);
      reader.onerror = () => reject(new Error('Error reading file'));
      reader.readAsText(file, 'utf-8');
    });
  },
  readSvg(file) {
    return fileManager.readGcode(file);
  },
  downloadGcode(content, filename) {
    const blob = new Blob([content], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
