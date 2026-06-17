/**
 * Prints a receipt on Android POS devices (CS30 and similar).
 *
 * Strategy: inject content as a hidden <div> in the main page, then call
 * window.print() with @media print CSS that hides the app and shows only
 * the receipt. This avoids two Android WebView issues:
 *   - window.open() is blocked (popup blocker)
 *   - iframe.contentWindow.print() prints the PARENT page, not the iframe
 */

const RECEIPT_STYLES = `
  @page { size: 58mm auto; margin: 2mm; }
  body * { visibility: hidden !important; }
  #__rpo {
    display: block !important;
    visibility: visible !important;
    position: fixed; left: 0; top: 0;
    width: 54mm;
    font-family: 'Courier New', monospace;
    font-size: 11px;
    color: #000;
  }
  #__rpo * { visibility: visible !important; }
  #__rpo .flex { display: flex; }
  #__rpo .justify-between { justify-content: space-between; }
  #__rpo .font-bold { font-weight: bold; }
  #__rpo .font-semibold { font-weight: 600; }
  #__rpo .text-center { text-align: center; }
  #__rpo .text-gray-500 { color: #555; }
  #__rpo .text-gray-600 { color: #444; }
  #__rpo .text-gray-400 { color: #888; }
  #__rpo .text-sm { font-size: 12px; }
  #__rpo .text-xs { font-size: 10px; }
  #__rpo .uppercase { text-transform: uppercase; }
  #__rpo .tracking-wide { letter-spacing: 0.03em; }
  #__rpo .capitalize { text-transform: capitalize; }
  #__rpo .border-t { border-top: 1px dashed #888; }
  #__rpo .border-dashed { border-style: dashed; }
  #__rpo .border-gray-400 { border-color: #888; }
  #__rpo .my-2 { margin: 5px 0; }
  #__rpo .mb-2 { margin-bottom: 5px; }
  #__rpo .mb-3 { margin-bottom: 8px; }
  #__rpo .mt-1 { margin-top: 3px; }
  #__rpo .mt-2 { margin-top: 5px; }
  #__rpo .pt-1 { padding-top: 3px; }
  #__rpo .space-y-0\\.5 > * + * { margin-top: 2px; }
  #__rpo .space-y-1 > * + * { margin-top: 3px; }
  #__rpo .pl-2 { padding-left: 6px; }
  #__rpo .pr-2 { padding-right: 6px; }
  #__rpo .flex-1 { flex: 1; min-width: 0; }
  #__rpo .truncate { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  #__rpo .max-w-xs { max-width: 100%; }
  #__rpo .mx-auto { margin-left: auto; margin-right: auto; }
  #__rpo img { max-height: 40px; display: block; margin: 0 auto 4px; }
`;

export function printReceiptHtml(_title, contentHtml) {
  // Remove stale elements from any previous call
  document.getElementById('__rpo')?.remove();
  document.getElementById('__rps')?.remove();

  // 1. Hidden receipt overlay — only visible via @media print
  const overlay = document.createElement('div');
  overlay.id = '__rpo';
  overlay.style.display = 'none';
  overlay.innerHTML = contentHtml;
  document.body.appendChild(overlay);

  // 2. Print stylesheet
  const style = document.createElement('style');
  style.id = '__rps';
  style.media = 'print';
  style.textContent = RECEIPT_STYLES;
  document.head.appendChild(style);

  // 3. Cleanup — runs after print dialog is dismissed
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    document.getElementById('__rpo')?.remove();
    document.getElementById('__rps')?.remove();
  };
  window.addEventListener('afterprint', cleanup, { once: true });
  setTimeout(cleanup, 60_000); // safety fallback

  // 4. Trigger print — small delay lets DOM settle
  setTimeout(() => window.print(), 100);
}
