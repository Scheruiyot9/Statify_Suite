/**
 * Prints receipt HTML via a hidden iframe so it works on Android POS devices
 * (CS30 and similar) where window.open() is blocked by the WebView.
 * Also sets @page size to 58 mm so thermal printers use the correct paper width.
 */
export function printReceiptHtml(title, contentHtml) {
  const FRAME_ID = '__receipt_print_frame';
  const stale = document.getElementById(FRAME_ID);
  if (stale) stale.remove();

  const iframe = document.createElement('iframe');
  iframe.id = FRAME_ID;
  iframe.style.cssText =
    'position:fixed;right:0;bottom:0;width:1px;height:1px;border:none;opacity:0;pointer-events:none;';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
  if (!doc) return;

  doc.open();
  doc.write(`<!DOCTYPE html><html><head>
<title>${title}</title>
<meta charset="utf-8">
<style>
  @page { size: 58mm auto; margin: 2mm 2mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Courier New', monospace;
    font-size: 11px;
    color: #000;
    width: 54mm;
  }
  .flex { display: flex; }
  .justify-between { justify-content: space-between; }
  .font-bold { font-weight: bold; }
  .font-semibold { font-weight: 600; }
  .text-center { text-align: center; }
  .text-gray-500 { color: #555; }
  .text-gray-600 { color: #444; }
  .text-gray-400 { color: #888; }
  .text-sm { font-size: 12px; }
  .text-xs { font-size: 10px; }
  .uppercase { text-transform: uppercase; }
  .tracking-wide { letter-spacing: 0.03em; }
  .capitalize { text-transform: capitalize; }
  .border-t { border-top: 1px dashed #888; }
  .border-dashed { border-style: dashed; }
  .border-gray-400 { border-color: #888; }
  .my-2 { margin: 5px 0; }
  .mb-2 { margin-bottom: 5px; }
  .mb-3 { margin-bottom: 8px; }
  .mt-1 { margin-top: 3px; }
  .mt-2 { margin-top: 5px; }
  .pt-1 { padding-top: 3px; }
  .space-y-0\\.5 > * + * { margin-top: 2px; }
  .space-y-1 > * + * { margin-top: 3px; }
  .pl-2 { padding-left: 6px; }
  .pr-2 { padding-right: 6px; }
  .flex-1 { flex: 1; min-width: 0; }
  .truncate { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .max-w-xs { max-width: 100%; }
  .mx-auto { margin-left: auto; margin-right: auto; }
  img { max-height: 40px; display: block; margin: 0 auto 4px; }
</style>
</head><body>${contentHtml}</body></html>`);
  doc.close();

  setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch (e) {
      console.error('Print failed:', e);
    }
    setTimeout(() => {
      if (document.body.contains(iframe)) document.body.removeChild(iframe);
    }, 2000);
  }, 300);
}
