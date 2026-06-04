import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X, Search, RotateCcw, ChevronLeft, CheckCircle2,
  Package, AlertTriangle, Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/services/api';
import { useCartStore } from '@/app/store';
import { formatCurrency } from '@/utils/formatters';
import Button from '@/components/ui/Button';

// ── Step 1: Transaction search ────────────────────────────────────────────────
function SearchStep({ onSelect }) {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');

  const { data: result, isFetching, error } = useQuery({
    queryKey: ['return-txn-search', submitted],
    queryFn:  () =>
      api.get('/sales/transactions', { params: { search: submitted, limit: 8 } })
         .then((r) => r.data.data?.transactions ?? r.data.data ?? []),
    enabled: submitted.length >= 1,
    staleTime: 0,
  });

  const txns = Array.isArray(result) ? result : [];

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-gray-500 mb-2">Enter the receipt or transaction number to find the original sale.</p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="e.g. INV-2026-000123"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && query.trim()) setSubmitted(query.trim()); }}
              autoFocus
              className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-3 text-sm focus:border-primary-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary-400"
            />
          </div>
          <Button
            onClick={() => query.trim() && setSubmitted(query.trim())}
            loading={isFetching}
            disabled={!query.trim()}
          >
            Search
          </Button>
        </div>
      </div>

      {/* Results */}
      {isFetching && (
        <div className="flex items-center justify-center py-8 gap-2 text-gray-400 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Searching…
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not search transactions. Try again.
        </div>
      )}

      {!isFetching && submitted && txns.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-200 py-8 text-center">
          <Package className="mx-auto mb-2 h-8 w-8 text-gray-300" />
          <p className="text-sm font-medium text-gray-500">No transactions found</p>
          <p className="text-xs text-gray-400 mt-0.5">for "{submitted}"</p>
        </div>
      )}

      {txns.length > 0 && (
        <div className="space-y-1.5">
          {txns.map((t) => {
            const isVoided = t.status === 'voided' || t.status === 'void';
            return (
              <button
                key={t.transaction_id}
                disabled={isVoided}
                onClick={() => onSelect(t.transaction_id)}
                className={[
                  'w-full flex items-start gap-3 rounded-xl border p-3 text-left transition-all',
                  isVoided
                    ? 'cursor-not-allowed border-gray-100 opacity-50'
                    : 'border-gray-100 hover:border-primary-300 hover:bg-primary-50/50',
                ].join(' ')}
              >
                <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full mt-0.5 ${
                  isVoided ? 'bg-gray-100' : 'bg-green-100'
                }`}>
                  <CheckCircle2 className={`h-4 w-4 ${isVoided ? 'text-gray-400' : 'text-green-600'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-900 font-mono">
                      {t.transaction_number || t.receipt_number || `#${t.transaction_id}`}
                    </p>
                    {isVoided && <span className="rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">Voided</span>}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {t.customer_name || 'Walk-in'} ·{' '}
                    {new Date(t.created_at).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-bold text-gray-900">{formatCurrency(t.total_amount)}</p>
                  <p className="text-[11px] text-gray-400">{t.item_count ?? '—'} items</p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Step 2: Items + reason + refund ──────────────────────────────────────────
function ReturnStep({ transactionId, onBack, onDone, session }) {
  const [selected, setSelected] = useState({});   // { itemId: quantityToReturn }
  const [reasonId, setReasonId] = useState('');
  const [notes,    setNotes]    = useState('');

  const { data: txn, isLoading: txnLoading } = useQuery({
    queryKey: ['txn-detail-return', transactionId],
    queryFn:  () => api.get(`/sales/transactions/${transactionId}`).then((r) => r.data.data),
    staleTime: 30_000,
  });

  const { data: reasons = [] } = useQuery({
    queryKey: ['return-reasons'],
    queryFn:  () => api.get('/returns/reasons').then((r) => r.data.data),
    staleTime: 5 * 60_000,
  });

  const qc = useQueryClient();

  const { mutate: createReturn, isPending } = useMutation({
    mutationFn: (data) => api.post('/returns', data),
    onSuccess: (res) => {
      const rtn = res.data.data;
      toast.success(`Return ${rtn.return_number} created`);
      qc.invalidateQueries({ queryKey: ['session-transactions'] });
      onDone(rtn);
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Could not process return'),
  });

  const items = txn?.items ?? [];

  const toggleItem = (itemId, max) => {
    setSelected((prev) => {
      if (prev[itemId] !== undefined) {
        const { [itemId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [itemId]: max };
    });
  };

  const setQty = (itemId, qty, max) => {
    const n = Math.max(1, Math.min(max, parseInt(qty, 10) || 1));
    setSelected((prev) => ({ ...prev, [itemId]: n }));
  };

  const returnItems = Object.entries(selected);
  const refundTotal = returnItems.reduce((sum, [id, qty]) => {
    const item = items.find((i) => String(i.item_id) === String(id));
    if (!item) return sum;
    const unitPrice = parseFloat(item.unit_price ?? item.line_total / item.quantity ?? 0);
    return sum + unitPrice * qty;
  }, 0);

  // Use first payment method from original transaction
  const payments     = txn?.payments ?? txn?.payment_methods ?? [];
  const firstPayment = payments[0];

  const canSubmit = returnItems.length > 0 && firstPayment && !isPending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    createReturn({
      originalTransactionId: transactionId,
      posSessionId:          session?.session_id ?? null,
      returnReasonId:        reasonId || null,
      customerNotes:         notes || null,
      items: returnItems.map(([id, qty]) => {
        const item = items.find((i) => String(i.item_id) === String(id));
        return {
          originalItemId:    parseInt(id),
          productId:         item?.product_id,
          quantityReturned:  qty,
          returnToInventory: true,
          itemCondition:     'good',
        };
      }),
      refunds: [{
        paymentMethodId:  firstPayment.payment_method_id,
        amountRefunded:   refundTotal,
        issuedAsStoreCredit: false,
      }],
    });
  };

  if (txnLoading) {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-gray-400 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading transaction…
      </div>
    );
  }

  if (!txn) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Could not load transaction details.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Original transaction header */}
      <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 space-y-0.5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-900 font-mono">
            {txn.transaction_number || txn.receipt_number}
          </p>
          <p className="text-sm font-bold text-gray-900">{formatCurrency(txn.total_amount)}</p>
        </div>
        <p className="text-xs text-gray-500">
          {txn.customer_name || 'Walk-in'} ·{' '}
          {new Date(txn.created_at).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}
        </p>
      </div>

      {/* Items to return */}
      <div>
        <p className="mb-2 text-xs font-semibold text-gray-700">Select items to return</p>
        <div className="space-y-1.5 rounded-xl border border-gray-100 overflow-hidden">
          {items.length === 0 && (
            <p className="py-4 text-center text-xs text-gray-400">No returnable items found.</p>
          )}
          {items.map((item) => {
            const maxQty    = parseFloat(item.quantity) - parseFloat(item.already_returned ?? 0);
            const isChecked = selected[item.item_id] !== undefined;
            const canReturn = maxQty > 0;

            return (
              <div
                key={item.item_id}
                onClick={() => canReturn && toggleItem(item.item_id, maxQty)}
                className={[
                  'flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors',
                  isChecked ? 'bg-primary-50' : canReturn ? 'bg-white hover:bg-gray-50' : 'bg-gray-50 opacity-50 cursor-not-allowed',
                ].join(' ')}
              >
                {/* Checkbox */}
                <div className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2 transition-colors ${
                  isChecked ? 'border-primary-500 bg-primary-500' : 'border-gray-300'
                }`}>
                  {isChecked && <CheckCircle2 className="h-3 w-3 text-white" />}
                </div>

                {/* Item info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{item.product_name}</p>
                  <p className="text-[11px] text-gray-400">
                    {formatCurrency(item.unit_price)} × {parseFloat(item.quantity)} = {formatCurrency(item.line_total)}
                    {maxQty < parseFloat(item.quantity) && (
                      <span className="ml-1.5 text-amber-600">({parseFloat(item.already_returned)} already returned)</span>
                    )}
                  </p>
                </div>

                {/* Qty input (when selected) */}
                {isChecked && (
                  <div
                    className="flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="text-xs text-gray-500">Qty:</span>
                    <input
                      type="number"
                      min="1"
                      max={maxQty}
                      value={selected[item.item_id]}
                      onChange={(e) => setQty(item.item_id, e.target.value, maxQty)}
                      className="w-14 rounded-lg border border-gray-200 px-2 py-1 text-center text-sm font-semibold focus:border-primary-400 focus:outline-none"
                    />
                    <span className="text-[11px] text-gray-400">/{maxQty}</span>
                  </div>
                )}

                {!isChecked && canReturn && (
                  <span className="text-[11px] text-gray-400">max {maxQty}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Reason */}
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-gray-700">
          Return Reason <span className="font-normal text-gray-400">(optional)</span>
        </label>
        <select
          value={reasonId}
          onChange={(e) => setReasonId(e.target.value)}
          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:border-primary-500 focus:outline-none"
        >
          <option value="">Select a reason…</option>
          {reasons.filter((r) => r.is_active !== false).map((r) => (
            <option key={r.reason_id} value={r.reason_id}>{r.reason_name}</option>
          ))}
        </select>
      </div>

      {/* Notes */}
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-gray-700">
          Notes <span className="font-normal text-gray-400">(optional)</span>
        </label>
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Customer notes or reason details…"
          className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
        />
      </div>

      {/* Refund summary */}
      {returnItems.length > 0 && firstPayment && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-green-800">Refund to customer</p>
            <p className="text-base font-bold text-green-700">{formatCurrency(refundTotal)}</p>
          </div>
          <p className="text-xs text-green-700">
            via {firstPayment.method_name || firstPayment.payment_method_name || 'original payment method'}
          </p>
        </div>
      )}

      {returnItems.length === 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          Select at least one item to return
        </div>
      )}

      {/* Footer */}
      <div className="flex gap-2 pt-1">
        <Button variant="secondary" fullWidth onClick={onBack}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <Button
          fullWidth
          loading={isPending}
          disabled={!canSubmit}
          onClick={handleSubmit}
          className="!bg-teal-600 hover:!bg-teal-700"
        >
          <RotateCcw className="h-4 w-4 mr-1.5" />
          Process Return
        </Button>
      </div>
    </div>
  );
}

// ── Success view ──────────────────────────────────────────────────────────────
function SuccessStep({ rtn, onClose }) {
  return (
    <div className="flex flex-col items-center text-center py-4 space-y-4">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-green-100">
        <CheckCircle2 className="h-8 w-8 text-green-600" />
      </div>
      <div>
        <p className="text-lg font-bold text-gray-900">Return Processed</p>
        <p className="text-sm font-mono text-gray-500 mt-1">{rtn.return_number}</p>
        <p className="text-sm text-gray-500 mt-1">
          Refund: <span className="font-semibold text-green-700">{formatCurrency(rtn.total_refunded)}</span>
        </p>
        {rtn.requires_approval && (
          <p className="mt-2 text-xs text-amber-600 font-medium">Pending manager approval before refund is dispensed.</p>
        )}
      </div>
      <Button fullWidth onClick={onClose}>Done</Button>
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────
export default function SalesReturnModal({ open, onClose, session }) {
  const [step,          setStep]          = useState('search'); // 'search' | 'return' | 'done'
  const [transactionId, setTransactionId] = useState(null);
  const [doneReturn,    setDoneReturn]    = useState(null);

  const handleSelect = (id) => {
    setTransactionId(id);
    setStep('return');
  };

  const handleDone = (rtn) => {
    setDoneReturn(rtn);
    setStep('done');
  };

  const handleClose = () => {
    setStep('search');
    setTransactionId(null);
    setDoneReturn(null);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-teal-100">
              <RotateCcw className="h-4 w-4 text-teal-600" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">Sales Return</h2>
              <p className="text-[11px] text-gray-400">
                {step === 'search' ? 'Find original transaction' : step === 'return' ? 'Select items & confirm' : 'Complete'}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Step indicator */}
        {step !== 'done' && (
          <div className="flex border-b border-gray-100 flex-shrink-0">
            {['search', 'return'].map((s, i) => (
              <div key={s} className={`flex flex-1 items-center justify-center gap-1.5 py-2 text-xs font-medium ${
                step === s ? 'text-teal-600 border-b-2 border-teal-500' : 'text-gray-400'
              }`}>
                <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${
                  step === s ? 'bg-teal-500 text-white' : 'bg-gray-200 text-gray-500'
                }`}>{i + 1}</span>
                {s === 'search' ? 'Find Transaction' : 'Select & Return'}
              </div>
            ))}
          </div>
        )}

        {/* Content */}
        <div className="overflow-y-auto flex-1 p-5">
          {step === 'search' && (
            <SearchStep onSelect={handleSelect} />
          )}
          {step === 'return' && transactionId && (
            <ReturnStep
              transactionId={transactionId}
              onBack={() => setStep('search')}
              onDone={handleDone}
              session={session}
            />
          )}
          {step === 'done' && doneReturn && (
            <SuccessStep rtn={doneReturn} onClose={handleClose} />
          )}
        </div>
      </div>
    </div>
  );
}
