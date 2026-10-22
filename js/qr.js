// QR code as inline SVG, using the qrcode-generator library (loaded globally from cdnjs).
// Returns null if the library failed to load (e.g. offline).
export function qrSvg(text, label = 'QR code') {
  if (typeof window.qrcode !== 'function') return null;
  try {
    const qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const m = 2; // quiet zone in modules
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
      }
    }
    const size = n + m * 2;
    const safeLabel = String(label).replace(/[&<>"]/g, '');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="${safeLabel}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#1b120c"/></svg>`;
  } catch (e) {
    console.error(e);
    return null;
  }
}
