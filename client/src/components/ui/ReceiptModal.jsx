import { useRef } from 'react';
import { Printer } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import { formatCurrency, formatDateTime } from '@/utils/formatters';
import { printReceiptHtml } from '@/utils/printReceipt';
import Modal from './Modal';
import Button from './Button';

// ── Thermal-receipt styled print layout ───────────────────────────────────────
// Uses window.print() + @media print CSS to hide everything except the receipt

function ReceiptBody({ txn, company }) {
  const taxRate = txn.items?.some((i) => parseFloat(i.tax_amount) > 0)
    ? null // per-item tax, show total
    : null;

  return (
    <div id="receipt-content" className="font-mono text-xs text-gray-900 max-w-xs mx-auto">
      {/* Header */}
      <div className="text-center mb-3">
        {company?.logo_url && (
          <img src={company.logo_url} alt="logo" className="h-10 mx-auto mb-1 object-contain" />
        )}
        <p className="font-bold text-sm uppercase tracking-wide">{company?.company_name ?? 'POS Receipt'}</p>
        {company?.tax_id && <p className="text-gray-500">KRA PIN: {company.tax_id}</p>}
        <p className="text-gray-500">{txn.branch_name}</p>
      </div>

      <div className="border-t border-dashed border-gray-400 my-2" />

      {/* Meta */}
      <div className="space-y-0.5 mb-2">
        <div className="flex justify-between"><span>TXN #:</span><span className="font-bold">{txn.transaction_number}</span></div>
        <div className="flex justify-between"><span>Date:</span><span>{formatDateTime(txn.transaction_date)}</span></div>
        <div className="flex justify-between"><span>Cashier:</span><span>{txn.cashier_name}</span></div>
        {txn.customer_name && txn.customer_name !== 'Walk-in' && (
          <div className="flex justify-between"><span>Customer:</span><span>{txn.customer_name}</span></div>
        )}
      </div>

      <div className="border-t border-dashed border-gray-400 my-2" />

      {/* Items */}
      <div className="space-y-1 mb-2">
        {txn.items?.map((item, i) => {
          const qty = parseFloat(item.quantity);
          const price = parseFloat(item.unit_price);
          const disc = parseFloat(item.discount_amount) || 0;
          const tax = parseFloat(item.tax_amount) || 0;
          const line = parseFloat(item.line_total);
          return (
            <div key={item.item_id ?? i}>
              <div className="flex justify-between">
                <span className="flex-1 truncate pr-2">{item.product_name}</span>
                <span className="font-semibold">{formatCurrency(line)}</span>
              </div>
              <div className="text-gray-500 pl-2">
                {qty} × {formatCurrency(price)}
                {disc > 0 && <span className="ml-2">disc -{formatCurrency(disc)}</span>}
                {tax > 0 && <span className="ml-2">incl. VAT {formatCurrency(tax)}</span>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-dashed border-gray-400 my-2" />

      {/* Totals */}
      <div className="space-y-0.5 mb-2">
        <div className="flex justify-between text-gray-600">
          <span>Subtotal</span><span>{formatCurrency(txn.subtotal)}</span>
        </div>
        {parseFloat(txn.discount_amount) > 0 && (
          <div className="flex justify-between text-gray-600">
            <span>Discount</span><span>-{formatCurrency(txn.discount_amount)}</span>
          </div>
        )}
        <div className="flex justify-between font-bold text-sm border-t border-gray-400 pt-1 mt-1">
          <span>TOTAL PAYABLE</span><span>{formatCurrency(txn.total_amount)}</span>
        </div>
        {/* VAT is informational — embedded in prices, shown after total for compliance */}
        {parseFloat(txn.tax_amount) > 0 && (
          <div className="flex justify-between text-gray-500" style={{ fontSize: '10px' }}>
            <span>VAT (incl.)</span><span>{formatCurrency(txn.tax_amount)}</span>
          </div>
        )}
      </div>

      <div className="border-t border-dashed border-gray-400 my-2" />

      {/* Payments */}
      {txn.payments?.map((p, i) => (
        <div key={p.payment_id ?? i} className="flex justify-between">
          <span>{p.method_name}{p.reference_number ? ` (${p.reference_number})` : ''}</span>
          <span>{formatCurrency(p.amount_applied)}</span>
        </div>
      ))}
      {parseFloat(txn.change_total) > 0 && (
        <div className="flex justify-between font-semibold">
          <span>Change</span><span>{formatCurrency(txn.change_total)}</span>
        </div>
      )}

      <div className="border-t border-dashed border-gray-400 my-2" />

      {/* Footer */}
      <div className="text-center text-gray-500 text-xs mt-2 space-y-0.5">
        <p>Thank you for your business!</p>
      </div>
    </div>
  );
}

export default function ReceiptModal({ open, onClose, txn }) {
  const printRef = useRef(null);

  const { data: company } = useQuery({
    queryKey: ['company-mine'],
    queryFn: () => api.get('/companies/mine').then((r) => r.data.data),
    enabled: open,
    staleTime: 10 * 60 * 1000,
  });

  const handlePrint = () => {
    const content = document.getElementById('receipt-content');
    if (!content) return;
    printReceiptHtml(`Receipt — ${txn?.transaction_number}`, content.innerHTML);
  };

  return (
    <Modal open={open} onClose={onClose} title={txn ? `Receipt — ${txn.transaction_number}` : 'Receipt'} size="sm">
      {!txn ? (
        <div className="py-12 text-center text-sm text-gray-400">Loading…</div>
      ) : (
        <>
          <div ref={printRef} className="bg-white p-4 rounded-lg border border-gray-100">
            <ReceiptBody txn={txn} company={company} />
          </div>
          <div className="mt-4 flex justify-end">
            <Button icon={<Printer className="h-4 w-4" />} onClick={handlePrint}>
              Print Receipt
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
