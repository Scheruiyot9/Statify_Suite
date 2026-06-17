/**
 * Prints receipt HTML via a hidden iframe — works on Android POS devices
 * (CS30 and similar) where window.open() is blocked by the WebView.
 *
 * Key fixes vs the original 1px/opacity:0 approach:
 *  - iframe is off-screen (left:-9999px) but full-sized so the WebView
 *    actually lays out and renders the content before printing.
 *  - srcdoc attribute is used instead of document.write() — more reliable
 *    inside Android WebView and avoids same-origin quirks.
 *  - print() fires on the iframe's onload event, not a fixed timeout, so
 *    it waits until the document is actually ready.
 *  - A "printed" flag prevents the fallback setTimeout from double-firing
 *    if onload also triggers.
 */

const STYLES = `
  @page { size: 58mm auto; margin: 2mm; }
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
`;

export function printReceiptHtml(title, contentHtml) {
  const FRAME_ID = '__receipt_print_frame';
  const stale = document.getElementById(FRAME_ID);
  if (stale) stale.remove();

  const iframe = document.createElement('iframe');
  iframe.id = FRAME_ID;
  // Off-screen with real dimensions so the WebView renders the content.
  // 1px / opacity:0 causes Android Chrome to skip layout → empty print job.
  iframe.style.cssText =
    'position:fixed;left:-9999px;top:0;width:300px;height:600px;border:none;';

  const fullHtml =
    `<!DOCTYPE html><html><head>` +
    `<title>${title}</title>` +
    `<meta charset="utf-8">` +
    `<style>${STYLES}</style>` +
    `</head><body>${contentHtml}</body></html>`;

  let printed = false;
  const doPrint = () => {
    if (printed) return;
    printed = true;
    // Small delay after load lets fonts/images settle before the print path runs.
    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch (e) {
        console.error('[printReceipt] print() failed:', e);
      }
      setTimeout(() => {
        if (document.body.contains(iframe)) document.body.removeChild(iframe);
      }, 3000);
    }, 250);
  };

  iframe.onload = doPrint;
  document.body.appendChild(iframe);

  if ('srcdoc' in iframe) {
    // srcdoc triggers onload reliably in modern WebViews
    iframe.srcdoc = fullHtml;
  } else {
    // Older WebView fallback: document.write + manual timeout
    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(fullHtml);
      doc.close();
    }
    // document.write may not trigger onload in all WebViews — fire manually
    setTimeout(doPrint, 600);
  }
}
