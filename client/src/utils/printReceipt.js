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
  html, body { height: auto !important; overflow: visible !important; margin: 0 !important; padding: 0 !important; }
  body > *:not(#__rpo) { display: none !important; }
  #__rpo {
    display: block !important;
    width: 54mm;
    font-family: 'Courier New', monospace;
    font-size: 11px;
    color: #000;
  }
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

/**
 * Prints a DRAFT receipt from raw cart data (before payment).
 * @param {object} opts
 *   cart           — { items, customer, orderDiscount, orderDiscountType }
 *   company        — { company_name, tax_id, logo_url }
 *   paymentDetails — string from branch.payment_details (e.g. "Mpesa Till: 123456")
 *   cashierName    — string
 */
export function printDraft({ cart, company, paymentDetails = '', cashierName = '' }) {
  const fmt = (n) => 'Ksh ' + Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const items   = cart.items || [];
  const subtotal = items.reduce((s, i) => s + (i.lineTotal || 0), 0);
  const discAmt  = cart.orderDiscountType === 'percent'
    ? subtotal * ((cart.orderDiscount || 0) / 100)
    : Math.min(cart.orderDiscount || 0, subtotal);
  const total    = Math.max(0, subtotal - discAmt);

  const itemRows = items.map((i) => {
    const name   = i.product?.product_name ?? '—';
    const qty    = parseFloat(i.quantity || 1);
    const price  = parseFloat(i.unitPrice || 0);
    const disc   = parseFloat(i.discountValue || 0);
    const line   = parseFloat(i.lineTotal || qty * price);
    let sub = `${qty} × ${fmt(price)}`;
    if (disc > 0) sub += ` disc -${i.discountType === 'percent' ? disc + '%' : fmt(disc)}`;
    return `<div><div class="flex justify-between"><span class="flex-1 truncate pr-2">${name}</span><span class="font-semibold">${fmt(line)}</span></div><div class="text-gray-500 pl-2">${sub}</div></div>`;
  }).join('');

  const payRows = (paymentDetails || '').trim()
    ? (paymentDetails.trim()).split('\n').map((line) => `<div>${line.trim()}</div>`).join('')
    : '';

  const now     = new Date().toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' });
  const custLine = cart.customer?.customer_name ? `<div class="flex justify-between"><span>Customer:</span><span>${cart.customer.customer_name}</span></div>` : '';
  const cashierLine = cashierName ? `<div class="flex justify-between"><span>Cashier:</span><span>${cashierName}</span></div>` : '';

  const html = `
    <div class="font-mono text-xs text-gray-900 max-w-xs mx-auto">
      <div class="text-center mb-3">
        ${company?.logo_url ? `<img src="${company.logo_url}" alt="logo" />` : ''}
        <p class="font-bold text-sm uppercase tracking-wide">${company?.company_name ?? 'POS'}</p>
        ${company?.tax_id ? `<p class="text-gray-500">KRA PIN: ${company.tax_id}</p>` : ''}
        <p class="font-bold uppercase tracking-wide" style="font-size:14px;letter-spacing:0.1em;border:1px dashed #888;padding:2px 6px;display:inline-block;margin-top:4px;">DRAFT</p>
      </div>
      <div class="border-t border-dashed border-gray-400 my-2"></div>
      <div class="space-y-0.5 mb-2">
        <div class="flex justify-between"><span>Date:</span><span>${now}</span></div>
        ${cashierLine}
        ${custLine}
      </div>
      <div class="border-t border-dashed border-gray-400 my-2"></div>
      <div class="space-y-1 mb-2">${itemRows}</div>
      <div class="border-t border-dashed border-gray-400 my-2"></div>
      <div class="space-y-0.5 mb-2">
        <div class="flex justify-between text-gray-600"><span>Subtotal</span><span>${fmt(subtotal)}</span></div>
        ${discAmt > 0 ? `<div class="flex justify-between text-gray-600"><span>Discount</span><span>-${fmt(discAmt)}</span></div>` : ''}
        <div class="flex justify-between font-bold text-sm border-t border-gray-400 pt-1 mt-1"><span>TOTAL DUE</span><span>${fmt(total)}</span></div>
      </div>
      ${payRows ? `
        <div class="border-t border-dashed border-gray-400 my-2"></div>
        <div class="text-center text-gray-500 mb-1" style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;">Payment Instructions</div>
        <div class="space-y-0.5">${payRows}</div>
      ` : ''}
      <div class="border-t border-dashed border-gray-400 my-2"></div>
      <div class="text-center text-gray-500 mt-2"><p>Thank you!</p></div>
    </div>
  `;

  printReceiptHtml('Draft Receipt', html);
}

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
