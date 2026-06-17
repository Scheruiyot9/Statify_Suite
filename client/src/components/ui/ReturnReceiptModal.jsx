import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import api from '@/services/api';
import { formatCurrency, formatDateTime } from '@/utils/formatters';
import { printReceiptHtml } from '@/utils/printReceipt';
import Modal from './Modal';
import Button from './Button';

function ReturnReceiptBody({ ret, company }) {
  return (
    <div id="return-receipt-content" className="font-mono text-xs text-gray-900 max-w-xs mx-auto">
      {/* Header */}
      <div className="text-center mb-3">
        {company?.logo_url && (
          <img src={company.logo_url} alt="logo" className="h-10 mx-auto mb-1 object-contain" />
        )}
        <p className="font-bold text-sm uppercase tracking-wide">{company?.company_name ?? 'POS'}</p>
        {company?.tax_id && <p className="text-gray-500">KRA PIN: {company.tax_id}</p>}
        <p className="text-gray-500">{ret.branch_name}</p>
        <p className="font-bold mt-1 text-sm">*** RETURN RECEIPT ***</p>
      </div>

      <div className="border-t border-dashed border-gray-400 my-2" />

      {/* Meta */}
      <div className="space-y-0.5 mb-2">
        <div className="flex justify-between"><span>RTN #:</span><span className="font-bold">{ret.return_number}</span></div>
        <div className="flex justify-between"><span>Date:</span><span>{formatDateTime(ret.return_date)}</span></div>
        <div className="flex justify-between"><span>Orig TXN:</span><span className="font-bold">{ret.original_transaction_number}</span></div>
        <div className="flex justify-between"><span>Processed by:</span><span>{ret.processed_by}</span></div>
        {ret.approved_by && (
          <div className="flex justify-between"><span>Approved by:</span><span>{ret.approved_by}</span></div>
        )}
      </div>

      <div className="border-t border-dashed border-gray-400 my-2" />

      {/* Items */}
      <div className="space-y-1 mb-2">
        {ret.items?.map((item, i) => (
          <div key={item.return_item_id ?? i}>
            <div className="flex justify-between">
              <span className="flex-1 truncate pr-2">{item.product_name}</span>
              <span className="font-semibold">{formatCurrency(item.line_refund_amount)}</span>
            </div>
            <div className="text-gray-500 pl-2">
              {parseFloat(item.quantity_returned)} × {formatCurrency(parseFloat(item.line_refund_amount) / parseFloat(item.quantity_returned))}
              {item.item_condition && <span className="ml-2 capitalize">({item.item_condition})</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-dashed border-gray-400 my-2" />

      {/* Total */}
      <div className="flex justify-between font-bold text-sm mb-2">
        <span>TOTAL REFUNDED</span>
        <span>{formatCurrency(ret.total_refunded)}</span>
      </div>

      {/* Refund methods */}
      {ret.refunds?.map((r, i) => (
        <div key={r.refund_id ?? i} className="flex justify-between text-gray-600">
          <span>
            {r.issued_as_store_credit ? 'Store Credit' : r.method_name}
            {r.reference_number ? ` (${r.reference_number})` : ''}
          </span>
          <span>{formatCurrency(r.amount_refunded)}</span>
        </div>
      ))}

      {/* Notes */}
      {ret.customer_notes && (
        <>
          <div className="border-t border-dashed border-gray-400 my-2" />
          <p className="text-gray-500 text-xs">Note: {ret.customer_notes}</p>
        </>
      )}

      <div className="border-t border-dashed border-gray-400 my-2" />

      <div className="text-center text-gray-500 text-xs mt-2">
        <p>Thank you. We apologise for any inconvenience.</p>
      </div>
    </div>
  );
}

export default function ReturnReceiptModal({ open, onClose, ret }) {
  const { data: company } = useQuery({
    queryKey: ['company-mine'],
    queryFn: () => api.get('/companies/mine').then((r) => r.data.data),
    enabled: open,
    staleTime: 10 * 60 * 1000,
  });

  const handlePrint = () => {
    const content = document.getElementById('return-receipt-content');
    if (!content) return;
    printReceiptHtml(`Return Receipt — ${ret?.return_number}`, content.innerHTML);
  };

  return (
    <Modal open={open} onClose={onClose} title="Return Receipt" size="sm">
      {ret && (
        <>
          <div className="bg-white p-4 rounded-lg border border-gray-100">
            <ReturnReceiptBody ret={ret} company={company} />
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
