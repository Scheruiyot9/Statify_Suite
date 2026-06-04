import { useState } from 'react';
import { X, Pause, RotateCcw, Trash2, ShoppingCart, UserCircle } from 'lucide-react';
import { usePosDataStore, useCartStore } from '@/app/store';
import { formatCurrency } from '@/utils/formatters';
import Button from '@/components/ui/Button';

function holdTotal(hold) {
  // lineTotal = qty × unitPrice − itemDiscount (VAT inclusive — what customer pays)
  // taxAmount = VAT extracted from lineTotal — informational only, never added to total
  // total = Σ(lineTotal) − orderDiscountAmt  (matches store.js totals() model)
  const subtotal = hold.items.reduce((s, i) => s + (i.lineTotal || 0), 0);
  const orderDiscountAmt = hold.orderDiscountType === 'percent'
    ? subtotal * (hold.orderDiscount / 100)
    : Math.min(hold.orderDiscount, subtotal);
  return Math.max(0, subtotal - orderDiscountAmt);
}

function timeAgo(isoString) {
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 60)       return `${diff}s ago`;
  if (diff < 3600)     return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)    return `${Math.floor(diff / 3600)}h ago`;
  return new Date(isoString).toLocaleDateString();
}

export default function HoldModal({ open, onClose }) {
  const holds        = usePosDataStore((s) => s.holds);
  const deleteHold   = usePosDataStore((s) => s.deleteHold);
  const loadFromHold = useCartStore((s) => s.loadFromHold);
  const cartItems    = useCartStore((s) => s.items);

  const [confirmRecall, setConfirmRecall] = useState(null); // hold id to recall
  const [confirmDelete, setConfirmDelete] = useState(null);

  if (!open) return null;

  const handleRecall = (hold) => {
    if (cartItems.length > 0) {
      setConfirmRecall(hold);
    } else {
      loadFromHold(hold);
      deleteHold(hold.id);
      onClose();
    }
  };

  const doRecall = (hold) => {
    loadFromHold(hold);
    deleteHold(hold.id);
    setConfirmRecall(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <Pause className="h-5 w-5 text-primary-600" />
            <h2 className="text-base font-bold text-gray-900">
              Held Transactions
              {holds.length > 0 && (
                <span className="ml-2 rounded-full bg-primary-100 px-2 py-0.5 text-xs font-semibold text-primary-700">
                  {holds.length}
                </span>
              )}
            </h2>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {holds.length === 0 && (
            <div className="py-12 text-center">
              <Pause className="mx-auto mb-3 h-10 w-10 text-gray-200" />
              <p className="text-sm text-gray-400">No held transactions</p>
              <p className="text-xs text-gray-300 mt-1">Hold a cart to pause it and start a new sale</p>
            </div>
          )}

          {holds.map((hold) => (
            <div key={hold.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  {hold.label ? (
                    <p className="text-sm font-semibold text-gray-800 truncate">{hold.label}</p>
                  ) : (
                    <p className="text-sm font-medium text-gray-500 italic">Unnamed hold</p>
                  )}
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-gray-400">{timeAgo(hold.savedAt)}</span>
                    <span className="text-xs text-gray-300">·</span>
                    <span className="text-xs text-gray-400">{hold.items.length} item{hold.items.length !== 1 ? 's' : ''}</span>
                  </div>
                </div>
                <p className="text-sm font-bold text-secondary-600 flex-shrink-0">
                  {formatCurrency(holdTotal(hold))}
                </p>
              </div>

              {/* Customer + items preview */}
              {hold.customer && (
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <UserCircle className="h-3.5 w-3.5 flex-shrink-0" />
                  {hold.customer.customer_name}
                </div>
              )}
              <div className="flex flex-wrap gap-1">
                {hold.items.slice(0, 4).map((item, i) => (
                  <span key={i} className="rounded-md bg-white border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-600 truncate max-w-[120px]">
                    {item.quantity}× {item.product.product_name}
                  </span>
                ))}
                {hold.items.length > 4 && (
                  <span className="rounded-md bg-white border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-400">
                    +{hold.items.length - 4} more
                  </span>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setConfirmDelete(hold.id)}
                  className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-400 hover:border-red-200 hover:text-red-500 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
                <button
                  onClick={() => handleRecall(hold)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary-500 py-1.5 text-xs font-semibold text-white hover:bg-primary-600 transition-colors"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Recall to Cart
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-gray-100 px-4 py-3">
          <Button variant="secondary" fullWidth onClick={onClose}>Close</Button>
        </div>
      </div>

      {/* Confirm recall when cart has items */}
      {confirmRecall && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
                <ShoppingCart className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">Replace current cart?</p>
                <p className="text-xs text-gray-500 mt-0.5">Your current cart will be cleared.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" fullWidth onClick={() => setConfirmRecall(null)}>Cancel</Button>
              <Button variant="accent" fullWidth onClick={() => doRecall(confirmRecall)}>Replace & Recall</Button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete hold */}
      {confirmDelete && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <p className="text-sm font-bold text-gray-900">Delete this hold?</p>
            <p className="text-xs text-gray-500">This cannot be undone.</p>
            <div className="flex gap-3">
              <Button variant="secondary" fullWidth onClick={() => setConfirmDelete(null)}>Cancel</Button>
              <Button variant="danger" fullWidth onClick={() => { deleteHold(confirmDelete); setConfirmDelete(null); }}>
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
