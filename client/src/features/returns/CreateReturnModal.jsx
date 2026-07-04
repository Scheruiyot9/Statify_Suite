import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, ChevronRight, ChevronLeft, RotateCcw, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/services/api';
import { formatCurrency, formatDateTime } from '@/utils/formatters';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { PageSpinner } from '@/components/ui/Spinner';
import { useAuthStore } from '@/app/store';
import ReturnReceiptModal from '@/components/ui/ReturnReceiptModal';

const CONDITIONS = ['resellable', 'damaged', 'expired', 'other'];

// ── Step 1 — Find original sale ───────────────────────────────────────────────

function StepFindSale({ onSelect }) {
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState('');

  const { data, isFetching } = useQuery({
    queryKey: ['return-sale-search', submitted],
    queryFn: () => api.get('/sales/transactions', { params: { search: submitted, limit: 10 } })
      .then((r) => r.data.data?.transactions ?? []),
    enabled: submitted.length >= 3,
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">Search for the original sale by transaction number or customer name.</p>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setSubmitted(search)}
            placeholder="Transaction number or customer name…"
            className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none"
          />
        </div>
        <Button onClick={() => setSubmitted(search)} loading={isFetching}>Search</Button>
      </div>

      {isFetching && <PageSpinner />}

      {data && (
        <div className="rounded-xl border border-gray-100 overflow-hidden">
          {data.length === 0
            ? <p className="py-8 text-center text-sm text-gray-400">No transactions found</p>
            : data.map((txn) => (
              <button
                key={txn.transaction_id}
                onClick={() => onSelect(txn)}
                className="flex w-full items-center justify-between px-4 py-3 text-sm hover:bg-gray-50 border-b border-gray-50 last:border-0 transition-colors"
              >
                <div className="text-left">
                  <p className="font-mono font-semibold text-primary-700">{txn.transaction_number}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{formatDateTime(txn.transaction_date)} · {txn.customer_name ?? 'Walk-in'}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-gray-900">{formatCurrency(txn.total_amount)}</p>
                  <ChevronRight className="h-4 w-4 text-gray-400 ml-auto mt-0.5" />
                </div>
              </button>
            ))
          }
        </div>
      )}
    </div>
  );
}

// ── Step 2 — Select items to return ──────────────────────────────────────────

function StepSelectItems({ transaction, items, setItems, reasons }) {
  const { data: txnDetail, isLoading } = useQuery({
    queryKey: ['txn-detail-for-return', transaction.transaction_id],
    queryFn: () => api.get(`/sales/transactions/${transaction.transaction_id}`).then((r) => r.data.data),
  });

  const toggle = (item) => {
    setItems((prev) => {
      const exists = prev.find((i) => i.originalItemId === item.item_id);
      if (exists) return prev.filter((i) => i.originalItemId !== item.item_id);
      const maxReturnable = parseFloat(item.quantity) - parseFloat(item.already_returned ?? 0);
      return [...prev, {
        originalItemId:     item.item_id,
        productId:          item.product_id,
        productName:        item.product_name,
        quantityReturned:   maxReturnable,
        maxReturnable,
        unitPriceAtSale:    parseFloat(item.unit_price),
        unitTaxAtSale:      parseFloat(item.tax_amount ?? 0),
        unitDiscountAtSale: parseFloat(item.discount ?? 0),
        lineRefundAmount:   parseFloat(item.unit_price) * maxReturnable,
        returnToInventory:  true,
        itemCondition:      'resellable',
        returnReasonId:     null,
      }];
    });
  };

  const updateItem = (originalItemId, field, value) => {
    setItems((prev) => prev.map((i) => {
      if (i.originalItemId !== originalItemId) return i;
      const updated = { ...i, [field]: value };
      if (field === 'quantityReturned') {
        updated.lineRefundAmount = parseFloat(value) * i.unitPriceAtSale;
      }
      return updated;
    }));
  };

  if (isLoading) return <PageSpinner />;

  const saleItems = txnDetail?.items ?? [];

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-gray-50 px-4 py-2.5 text-sm">
        <span className="text-gray-500">Sale: </span>
        <span className="font-mono font-semibold text-primary-700">{transaction.transaction_number}</span>
        <span className="mx-2 text-gray-300">·</span>
        <span className="text-gray-700">{formatCurrency(transaction.total_amount)}</span>
        <span className="mx-2 text-gray-300">·</span>
        <span className="text-gray-500">{formatDateTime(transaction.transaction_date)}</span>
      </div>

      <p className="text-xs text-gray-500">Select the items to return and enter quantities.</p>

      <div className="space-y-2">
        {saleItems.map((item) => {
          const maxReturnable = parseFloat(item.quantity) - parseFloat(item.already_returned ?? 0);
          const selected = items.find((i) => i.originalItemId === item.item_id);
          const disabled = maxReturnable <= 0;

          return (
            <div key={item.item_id}
              className={[
                'rounded-xl border p-3 transition-colors',
                disabled ? 'opacity-40 border-gray-100 bg-gray-50' :
                selected ? 'border-primary-200 bg-primary-50' : 'border-gray-100 bg-white hover:border-gray-200',
              ].join(' ')}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={!!selected}
                  disabled={disabled}
                  onChange={() => toggle(item)}
                  className="mt-1 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-gray-900 text-sm">{item.product_name}</p>
                    <p className="text-sm text-gray-600">{formatCurrency(item.unit_price)} × {parseFloat(item.quantity)}</p>
                  </div>
                  {disabled && <p className="text-xs text-gray-400 mt-0.5">Already fully returned</p>}
                  {!disabled && !selected && maxReturnable < parseFloat(item.quantity) && (
                    <p className="text-xs text-amber-600 mt-0.5">Up to {maxReturnable} returnable</p>
                  )}

                  {selected && (
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Qty to return (max {maxReturnable})</label>
                        <input
                          type="number"
                          min={0.01}
                          max={maxReturnable}
                          step={1}
                          value={selected.quantityReturned}
                          onChange={(e) => updateItem(item.item_id, 'quantityReturned', parseFloat(e.target.value) || 0)}
                          className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Condition</label>
                        <select
                          value={selected.itemCondition}
                          onChange={(e) => updateItem(item.item_id, 'itemCondition', e.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm bg-white focus:border-primary-500 focus:outline-none capitalize"
                        >
                          {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Return reason</label>
                        <select
                          value={selected.returnReasonId ?? ''}
                          onChange={(e) => updateItem(item.item_id, 'returnReasonId', e.target.value || null)}
                          className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm bg-white focus:border-primary-500 focus:outline-none"
                        >
                          <option value="">Select reason…</option>
                          {reasons.map((r) => <option key={r.reason_id} value={r.reason_id}>{r.reason_name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Restock</label>
                        <select
                          value={selected.returnToInventory ? 'yes' : 'no'}
                          onChange={(e) => updateItem(item.item_id, 'returnToInventory', e.target.value === 'yes')}
                          className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm bg-white focus:border-primary-500 focus:outline-none"
                        >
                          <option value="yes">Yes — add back to stock</option>
                          <option value="no">No — write off</option>
                        </select>
                      </div>
                      <div className="col-span-full flex items-center justify-between rounded-lg bg-white border border-gray-100 px-3 py-2">
                        <span className="text-xs text-gray-500">Line refund</span>
                        <span className="font-semibold text-gray-900 text-sm">{formatCurrency(selected.lineRefundAmount)}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Step 3 — Refund method ────────────────────────────────────────────────────

function StepRefundMethod({ totalRefund, refunds, setRefunds }) {
  const { data: methods = [] } = useQuery({
    queryKey: ['payment-methods-for-return'],
    queryFn: () => api.get('/pos/payment-methods').then((r) => r.data.data),
  });

  const addRefund = () => {
    const firstMethod = methods[0];
    setRefunds((prev) => [...prev, {
      paymentMethodId:    firstMethod?.payment_method_id ?? '',
      amountRefunded:     Math.max(0, totalRefund - prev.reduce((s, r) => s + parseFloat(r.amountRefunded || 0), 0)),
      referenceNumber:    '',
      issuedAsStoreCredit: false,
    }]);
  };

  const update = (i, field, val) => setRefunds((prev) => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r));
  const remove = (i) => setRefunds((prev) => prev.filter((_, idx) => idx !== i));

  const allocated = refunds.reduce((s, r) => s + parseFloat(r.amountRefunded || 0), 0);
  const remaining = totalRefund - allocated;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3">
        <span className="text-sm text-gray-600">Total to refund</span>
        <span className="text-lg font-bold text-primary-700">{formatCurrency(totalRefund)}</span>
      </div>

      {Math.abs(remaining) > 0.01 && (
        <div className={`rounded-lg px-3 py-2 text-xs font-medium ${remaining > 0 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'}`}>
          {remaining > 0 ? `${formatCurrency(remaining)} still unallocated` : `Over-allocated by ${formatCurrency(Math.abs(remaining))}`}
        </div>
      )}

      <div className="space-y-3">
        {refunds.map((r, i) => {
          const method = methods.find((m) => m.payment_method_id === r.paymentMethodId);
          return (
            <div key={i} className="rounded-xl border border-gray-100 p-3 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Refund via</label>
                  <select
                    value={r.paymentMethodId}
                    onChange={(e) => update(i, 'paymentMethodId', e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm bg-white focus:border-primary-500 focus:outline-none"
                  >
                    {methods.map((m) => <option key={m.payment_method_id} value={m.payment_method_id}>{m.method_name}</option>)}
                    <option value="">Store Credit</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Amount (KES)</label>
                  <input
                    type="number"
                    value={r.amountRefunded}
                    onChange={(e) => update(i, 'amountRefunded', e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary-500 focus:outline-none"
                  />
                </div>
              </div>
              {(method?.requires_reference || !r.paymentMethodId) && (
                <input
                  placeholder="Reference / receipt number"
                  value={r.referenceNumber}
                  onChange={(e) => update(i, 'referenceNumber', e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary-500 focus:outline-none"
                />
              )}
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={r.issuedAsStoreCredit}
                    onChange={(e) => update(i, 'issuedAsStoreCredit', e.target.checked)}
                    className="rounded border-gray-300 text-primary-600" />
                  Issue as store credit
                </label>
                {refunds.length > 1 && (
                  <button onClick={() => remove(i)} className="text-xs text-red-400 hover:text-red-600">Remove</button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <button
        onClick={addRefund}
        className="w-full rounded-xl border border-dashed border-gray-300 py-2.5 text-sm text-gray-500 hover:border-primary-400 hover:text-primary-600 transition-colors"
      >
        + Add another refund method
      </button>
    </div>
  );
}

// ── Step 4 — Review & Submit ──────────────────────────────────────────────────

function StepReview({ transaction, items, refunds, notes, setNotes }) {
  const totalItems = items.reduce((s, i) => s + parseFloat(i.lineRefundAmount || 0), 0);
  const totalRefunds = refunds.reduce((s, r) => s + parseFloat(r.amountRefunded || 0), 0);

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-gray-50 px-4 py-3 text-sm">
        <span className="text-gray-500">Returning from: </span>
        <span className="font-mono font-semibold text-primary-700">{transaction.transaction_number}</span>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Items being returned</p>
        <div className="rounded-xl border border-gray-100 overflow-hidden">
          {/* Desktop table — every column always visible */}
          <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Product</th>
                <th className="px-3 py-2 text-center text-xs font-medium text-gray-500">Qty</th>
                <th className="px-3 py-2 text-center text-xs font-medium text-gray-500">Condition</th>
                <th className="px-3 py-2 text-center text-xs font-medium text-gray-500">Restock</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Refund</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {items.map((i) => (
                <tr key={i.originalItemId}>
                  <td className="px-3 py-2 font-medium text-gray-800">{i.productName}</td>
                  <td className="px-3 py-2 text-center">{i.quantityReturned}</td>
                  <td className="px-3 py-2 text-center capitalize text-gray-500">{i.itemCondition}</td>
                  <td className="px-3 py-2 text-center">
                    {i.returnToInventory
                      ? <span className="text-green-600 text-xs">Yes</span>
                      : <span className="text-gray-400 text-xs">No</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">{formatCurrency(i.lineRefundAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden divide-y divide-gray-50">
            {items.map((i) => (
              <div key={i.originalItemId} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-gray-800 min-w-0">{i.productName}</p>
                  <p className="flex-shrink-0 font-semibold">{formatCurrency(i.lineRefundAmount)}</p>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                  <span>Qty: {i.quantityReturned}</span>
                  <span className="capitalize">{i.itemCondition}</span>
                  {i.returnToInventory
                    ? <span className="text-green-600">Restocked</span>
                    : <span className="text-gray-400">Not restocked</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Refund method</p>
        <div className="space-y-1.5">
          {refunds.map((r, i) => (
            <div key={i} className="flex items-center justify-between text-sm text-gray-700 rounded-lg bg-gray-50 px-3 py-2">
              <span>{r.issuedAsStoreCredit ? 'Store Credit' : 'Cash / Card / M-Pesa'}
                {r.referenceNumber && <span className="text-gray-400 text-xs ml-2">#{r.referenceNumber}</span>}
              </span>
              <span className="font-semibold">{formatCurrency(r.amountRefunded)}</span>
            </div>
          ))}
        </div>
      </div>

      {Math.abs(totalItems - totalRefunds) > 0.01 && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Warning: Item refund total ({formatCurrency(totalItems)}) does not match refund method total ({formatCurrency(totalRefunds)})
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Customer notes (optional)</label>
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Reason for return as communicated by customer…"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none resize-none"
        />
      </div>
    </div>
  );
}

// ── Main Modal ────────────────────────────────────────────────────────────────

const STEPS = ['Find Sale', 'Select Items', 'Refund Method', 'Review'];

export default function CreateReturnModal({ onClose, preloadedTxn }) {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const [step,          setStep]          = useState(preloadedTxn ? 1 : 0);
  const [transaction,   setTransaction]   = useState(preloadedTxn ?? null);
  const [items,         setItems]         = useState([]);
  const [refunds,       setRefunds]       = useState([{ paymentMethodId: '', amountRefunded: 0, referenceNumber: '', issuedAsStoreCredit: false }]);
  const [notes,         setNotes]         = useState('');
  const [createdReturn, setCreatedReturn] = useState(null);

  const { data: reasons = [] } = useQuery({
    queryKey: ['return-reasons'],
    queryFn: () => api.get('/returns/reasons').then((r) => r.data.data),
  });

  const totalRefund = items.reduce((s, i) => s + parseFloat(i.lineRefundAmount || 0), 0);

  const selectTransaction = (txn) => {
    setTransaction(txn);
    setItems([]);
    setRefunds([{ paymentMethodId: '', amountRefunded: totalRefund, referenceNumber: '', issuedAsStoreCredit: false }]);
    setStep(1);
  };

  const goNext = () => {
    if (step === 1 && items.length === 0) { toast.error('Select at least one item to return'); return; }
    if (step === 1) {
      // Pre-fill refund amount
      const total = items.reduce((s, i) => s + parseFloat(i.lineRefundAmount || 0), 0);
      setRefunds([{ paymentMethodId: '', amountRefunded: total, referenceNumber: '', issuedAsStoreCredit: false }]);
    }
    if (step === 2) {
      const allocated = refunds.reduce((s, r) => s + parseFloat(r.amountRefunded || 0), 0);
      if (refunds.some((r) => !r.paymentMethodId && !r.issuedAsStoreCredit)) {
        toast.error('Select a refund method for each entry'); return;
      }
    }
    setStep((s) => s + 1);
  };

  const createMut = useMutation({
    mutationFn: (payload) => api.post('/returns', payload),
    onSuccess: (res) => {
      const returnData = res.data.data;
      toast.success(`Return ${returnData.return_number} created`);
      qc.invalidateQueries(['returns']);
      setCreatedReturn(returnData);
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to create return'),
  });

  const handleSubmit = () => {
    if (!transaction) return;
    createMut.mutate({
      originalTransactionId: transaction.transaction_id,
      branchId:              transaction.branch_id,
      items:                 items.map((i) => ({
        originalItemId:      i.originalItemId,
        productId:           i.productId,
        quantityReturned:    parseFloat(i.quantityReturned),
        unitPriceAtSale:     i.unitPriceAtSale,
        unitTaxAtSale:       i.unitTaxAtSale,
        unitDiscountAtSale:  i.unitDiscountAtSale,
        lineRefundAmount:    parseFloat(i.lineRefundAmount),
        returnToInventory:   i.returnToInventory,
        itemCondition:       i.itemCondition,
        returnReasonId:      i.returnReasonId || null,
      })),
      refunds: refunds.map((r) => ({
        paymentMethodId:     r.paymentMethodId || null,
        amountRefunded:      parseFloat(r.amountRefunded),
        referenceNumber:     r.referenceNumber || null,
        issuedAsStoreCredit: r.issuedAsStoreCredit,
      })),
      customerNotes:  notes || null,
      requiresApproval: false,
    });
  };

  const canGoNext = step < STEPS.length - 1;
  const canSubmit = step === STEPS.length - 1;

  const footer = (
    <div className="flex flex-wrap gap-3">
      {step > 0 && (
        <Button variant="secondary" onClick={() => setStep((s) => s - 1)} icon={<ChevronLeft className="h-4 w-4" />}>
          Back
        </Button>
      )}
      <Button variant="secondary" fullWidth={step === 0} onClick={onClose}>Cancel</Button>
      {canGoNext && step > 0 && (
        <Button fullWidth onClick={goNext} icon={<ChevronRight className="h-4 w-4" />}>
          Next
        </Button>
      )}
      {canSubmit && (
        <Button fullWidth onClick={handleSubmit} loading={createMut.isPending} icon={<CheckCircle className="h-4 w-4" />}>
          Submit Return
        </Button>
      )}
    </div>
  );

  if (createdReturn) {
    return (
      <ReturnReceiptModal
        open
        ret={createdReturn}
        onClose={() => { setCreatedReturn(null); onClose(createdReturn); }}
      />
    );
  }

  return (
    <Modal open onClose={onClose} title="Create Return" size="lg" footer={footer}>
      {/* Step indicator */}
      <div className="mb-5 flex items-center gap-1">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-1 flex-1">
            <div className={[
              'flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold flex-shrink-0',
              i < step ? 'bg-green-500 text-white' : i === step ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-400',
            ].join(' ')}>
              {i < step ? <CheckCircle className="h-3.5 w-3.5" /> : i + 1}
            </div>
            <span className={`text-xs ${i === step ? 'font-semibold text-primary-700' : 'text-gray-400'}`}>{label}</span>
            {i < STEPS.length - 1 && <div className="flex-1 h-px bg-gray-100 mx-1" />}
          </div>
        ))}
      </div>

      {step === 0 && <StepFindSale onSelect={selectTransaction} />}
      {step === 1 && transaction && (
        <StepSelectItems
          transaction={transaction}
          items={items}
          setItems={setItems}
          reasons={reasons}
        />
      )}
      {step === 2 && (
        <StepRefundMethod
          totalRefund={totalRefund}
          refunds={refunds}
          setRefunds={setRefunds}
        />
      )}
      {step === 3 && (
        <StepReview
          transaction={transaction}
          items={items}
          refunds={refunds}
          notes={notes}
          setNotes={setNotes}
        />
      )}
    </Modal>
  );
}
