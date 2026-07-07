import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, Plus, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/services/api';
import { formatCurrency, formatDateTime, todayLocal } from '@/utils/formatters';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';

// ── helpers ───────────────────────────────────────────────────────────────────

function scaleTax(newTotal, baseTotal, baseTax) {
  if (!baseTotal || !baseTax) return 0;
  return Math.round((newTotal / baseTotal) * baseTax * 10000) / 10000;
}

function computeLine(item) {
  const qty       = parseFloat(item.quantity)   || 0;
  const price     = parseFloat(item.unitPrice)  || 0;
  const disc      = parseFloat(item.discount)   || 0;
  const lineTotal = Math.max(0, Math.round((qty * price - disc) * 100) / 100);
  const taxAmount = scaleTax(lineTotal, item._baseLineTotal, item._baseTax);
  return { lineTotal, taxAmount };
}

function fromServerItem(si) {
  return {
    _key:          si.item_id ?? `${si.product_id}-${Date.now()}`,
    productId:     si.product_id,
    productName:   si.product_name,
    sku:           si.sku ?? '',
    quantity:      String(parseFloat(si.quantity)),
    unitPrice:     String(parseFloat(si.unit_price)),
    discount:      parseFloat(si.discount_amount ?? 0),
    _baseTax:      parseFloat(si.tax_amount ?? 0),
    _baseLineTotal: parseFloat(si.line_total),
  };
}

function fromServerPayment(sp) {
  return {
    _key:              sp.payment_id ?? `pmt-${Date.now()}`,
    paymentMethodId:   sp.payment_method_id,
    methodName:        sp.method_name,
    amountApplied:     String(parseFloat(sp.amount_applied)),
    amountTendered:    String(parseFloat(sp.amount_tendered)),
    changeGiven:       parseFloat(sp.change_given ?? 0),
    referenceNumber:   sp.reference_number ?? '',
    requiresReference: !!sp.requires_reference,
  };
}

// ── product search dropdown ───────────────────────────────────────────────────

function ProductSearch({ branchId, onSelect }) {
  const [q, setQ]         = useState('');
  const [open, setOpen]   = useState(false);
  const wrapRef           = useRef(null);

  const { data: results = [] } = useQuery({
    queryKey: ['edit-product-search', q, branchId],
    queryFn:  () => api.get('/pos/products', { params: { search: q, branchId, limit: 8 } })
                       .then((r) => r.data.data?.products ?? []),
    enabled: q.length >= 2 && !!branchId,
    staleTime: 30_000,
  });

  useEffect(() => {
    function onClick(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const pick = (p) => {
    onSelect(p);
    setQ('');
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative">
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-2 focus-within:border-primary-400 focus-within:bg-white transition-colors">
        <Search className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search product to add…"
          className="flex-1 bg-transparent text-sm outline-none placeholder-gray-400"
        />
      </div>
      {open && results.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg max-h-52 overflow-y-auto">
          {results.map((p) => (
            <li key={p.product_id}>
              <button
                type="button"
                onMouseDown={() => pick(p)}
                className="w-full px-3 py-2 text-left text-sm hover:bg-primary-50 flex justify-between items-center"
              >
                <span>
                  <span className="font-medium text-gray-800">{p.product_name}</span>
                  {p.sku && <span className="ml-2 text-xs text-gray-400">{p.sku}</span>}
                </span>
                <span className="text-xs text-gray-500 font-mono">{formatCurrency(p.branch_price ?? p.base_price ?? 0)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── main modal ────────────────────────────────────────────────────────────────

export default function EditTransactionModal({ open, onClose, txn, onSaved }) {
  const qc = useQueryClient();

  const [items,            setItems]           = useState([]);
  const [payments,         setPayments]        = useState([]);
  const [notes,            setNotes]           = useState('');
  const [editReason,       setEditReason]      = useState('');
  const [transactionDate,  setTransactionDate] = useState('');

  // Payment methods list for the payments dropdown
  const { data: payMethods = [] } = useQuery({
    queryKey: ['payment-methods-pos'],
    queryFn:  () => api.get('/pos/payment-methods').then((r) => r.data.data ?? []),
    enabled:  open,
    staleTime: 5 * 60_000,
  });

  // Populate state when txn loads or changes
  useEffect(() => {
    if (!txn) return;
    setItems((txn.items ?? []).map(fromServerItem));
    setPayments((txn.payments ?? []).map(fromServerPayment));
    setNotes(txn.notes ?? '');
    setEditReason('');
    setTransactionDate(txn.transaction_date ? txn.transaction_date.slice(0, 10) : '');
  }, [txn]);

  // ── item helpers ────────────────────────────────────────────────────────────

  const updateItem = (key, field, value) => {
    setItems((prev) => prev.map((it) => it._key === key ? { ...it, [field]: value } : it));
  };

  const removeItem = (key) => {
    setItems((prev) => prev.filter((it) => it._key !== key));
  };

  const addProduct = (product) => {
    const price = parseFloat(product.branch_price ?? product.base_price ?? 0);
    setItems((prev) => [
      ...prev,
      {
        _key:           `new-${Date.now()}`,
        productId:      product.product_id,
        productName:    product.product_name,
        sku:            product.sku ?? '',
        quantity:       '1',
        unitPrice:      String(price),
        discount:       0,
        _baseTax:       0,
        _baseLineTotal: price,
      },
    ]);
  };

  // ── payment helpers ─────────────────────────────────────────────────────────

  const updatePayment = (key, field, value) => {
    setPayments((prev) => prev.map((p) => p._key === key ? { ...p, [field]: value } : p));
  };

  const removePayment = (key) => {
    setPayments((prev) => prev.filter((p) => p._key !== key));
  };

  const addPayment = () => {
    const first = payMethods[0];
    if (!first) return;
    setPayments((prev) => [
      ...prev,
      {
        _key:              `new-pmt-${Date.now()}`,
        paymentMethodId:   first.payment_method_id,
        methodName:        first.method_name,
        amountApplied:     '0',
        amountTendered:    '0',
        changeGiven:       0,
        referenceNumber:   '',
        requiresReference: !!first.requires_reference,
      },
    ]);
  };

  const onMethodChange = (key, pmId) => {
    const pm = payMethods.find((m) => m.payment_method_id === pmId);
    if (!pm) return;
    setPayments((prev) => prev.map((p) =>
      p._key === key
        ? { ...p, paymentMethodId: pmId, methodName: pm.method_name, requiresReference: !!pm.requires_reference }
        : p
    ));
  };

  // ── computed totals ─────────────────────────────────────────────────────────

  const computedItems = items.map((it) => ({ ...it, ...computeLine(it) }));
  const subtotal      = computedItems.reduce((s, i) => s + i.lineTotal, 0);
  const taxTotal      = computedItems.reduce((s, i) => s + i.taxAmount, 0);
  const totalPaid     = payments.reduce((s, p) => s + (parseFloat(p.amountApplied) || 0), 0);

  // ── submit ──────────────────────────────────────────────────────────────────

  const mut = useMutation({
    mutationFn: (payload) => api.put(`/sales/transactions/${txn.transaction_id}`, payload),
    onSuccess: () => {
      toast.success('Transaction updated');
      qc.invalidateQueries({ queryKey: ['transaction-detail', txn.transaction_id] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      onSaved?.();
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.message ?? 'Failed to save'),
  });

  const handleSave = () => {
    if (!editReason.trim()) { toast.error('Enter a reason for this edit'); return; }
    if (computedItems.length === 0) { toast.error('At least one item is required'); return; }
    if (payments.length === 0 && !txn.is_credit_sale) { toast.error('At least one payment is required'); return; }

    const payload = {
      items: computedItems.map((i) => ({
        productId:  i.productId,
        quantity:   parseFloat(i.quantity) || 1,
        unitPrice:  parseFloat(i.unitPrice) || 0,
        discount:   parseFloat(i.discount) || 0,
        taxAmount:  i.taxAmount,
        lineTotal:  i.lineTotal,
      })),
      payments: payments.map((p) => ({
        paymentMethodId: p.paymentMethodId,
        amountApplied:   parseFloat(p.amountApplied) || 0,
        amountTendered:  parseFloat(p.amountTendered) || parseFloat(p.amountApplied) || 0,
        changeGiven:     parseFloat(p.changeGiven) || 0,
        referenceNumber: p.referenceNumber || null,
      })),
      customerId:      txn.customer_id ?? null,
      notes:           notes || null,
      editReason:      editReason.trim(),
      transactionDate: transactionDate && transactionDate !== (txn.transaction_date?.slice(0, 10) ?? '')
        ? transactionDate : undefined,
    };

    mut.mutate(payload);
  };

  if (!txn) return null;

  return (
    <Modal open={open} onClose={onClose} title={`Edit Transaction — ${txn.transaction_number}`} size="xl">
      <div className="space-y-5">

        {/* Transaction meta (readonly) */}
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800 space-y-0.5">
          <p className="font-semibold">Editing a posted transaction</p>
          <p>Inventory and journal entries will be reversed and re-posted. The transaction number stays the same.</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs text-gray-500 items-start">
          <div>
            <span className="text-gray-400 block mb-1">Date</span>
            <input
              type="date"
              value={transactionDate}
              max={todayLocal()}
              onChange={(e) => setTransactionDate(e.target.value)}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs text-gray-800 focus:border-primary-500 focus:outline-none"
            />
          </div>
          <div><span className="text-gray-400 block mb-1">Cashier</span><p className="text-gray-700">{txn.cashier_name}</p></div>
          <div><span className="text-gray-400 block mb-1">Branch</span><p className="text-gray-700">{txn.branch_name}</p></div>
        </div>

        {/* Items */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Items</p>
          {/* Desktop table — every column always visible */}
          <div className="hidden sm:block overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Product</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 w-24">Qty</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 w-28">Unit Price</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 w-28">Total</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {computedItems.map((item) => (
                  <tr key={item._key} className="hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <p className="font-medium text-gray-800 text-xs">{item.productName}</p>
                      {item.sku && <p className="text-[10px] text-gray-400">{item.sku}</p>}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number" min="0.01" step="0.01"
                        value={item.quantity}
                        onChange={(e) => updateItem(item._key, 'quantity', e.target.value)}
                        className="w-full rounded border border-gray-200 px-1.5 py-1 text-right text-xs focus:border-primary-400 focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number" min="0" step="0.01"
                        value={item.unitPrice}
                        onChange={(e) => updateItem(item._key, 'unitPrice', e.target.value)}
                        className="w-full rounded border border-gray-200 px-1.5 py-1 text-right text-xs focus:border-primary-400 focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-xs font-mono text-gray-800">
                      {formatCurrency(item.lineTotal)}
                      {item.taxAmount > 0 && (
                        <p className="text-[9px] font-normal text-gray-400">incl. VAT {formatCurrency(item.taxAmount)}</p>
                      )}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <button
                        onClick={() => removeItem(item._key)}
                        className="text-gray-300 hover:text-red-500 transition-colors"
                        title="Remove item"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden space-y-2">
            {computedItems.map((item) => (
              <div key={item._key} className="rounded-lg border border-gray-200 p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-800 text-xs">{item.productName}</p>
                    {item.sku && <p className="text-[10px] text-gray-400">{item.sku}</p>}
                  </div>
                  <button
                    onClick={() => removeItem(item._key)}
                    className="flex-shrink-0 text-gray-300 hover:text-red-500 transition-colors"
                    title="Remove item"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-gray-400 mb-0.5">Qty</label>
                    <input
                      type="number" min="0.01" step="0.01"
                      value={item.quantity}
                      onChange={(e) => updateItem(item._key, 'quantity', e.target.value)}
                      className="w-full rounded border border-gray-200 px-1.5 py-1 text-right text-xs focus:border-primary-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 mb-0.5">Unit Price</label>
                    <input
                      type="number" min="0" step="0.01"
                      value={item.unitPrice}
                      onChange={(e) => updateItem(item._key, 'unitPrice', e.target.value)}
                      className="w-full rounded border border-gray-200 px-1.5 py-1 text-right text-xs focus:border-primary-400 focus:outline-none"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between border-t border-gray-100 pt-1.5 text-xs">
                  <span className="text-[10px] text-gray-400">Total</span>
                  <span className="font-mono font-semibold text-gray-800">
                    {formatCurrency(item.lineTotal)}
                    {item.taxAmount > 0 && (
                      <span className="ml-1.5 text-[9px] font-normal text-gray-400">incl. VAT {formatCurrency(item.taxAmount)}</span>
                    )}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Subtotal row */}
          <div className="mt-2 flex justify-end gap-6 text-xs text-gray-600 pr-8">
            {taxTotal > 0 && <span>VAT (incl.) {formatCurrency(taxTotal)}</span>}
            <span className="font-semibold text-gray-900">Total {formatCurrency(subtotal)}</span>
          </div>

          {/* Add item */}
          <div className="mt-2">
            <ProductSearch branchId={txn.branch_id} onSelect={addProduct} />
          </div>
        </div>

        {/* Payments */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Payments</p>
          <div className="space-y-2">
            {payments.map((p) => (
              <div key={p._key} className="flex flex-wrap items-center gap-2">
                <select
                  value={p.paymentMethodId}
                  onChange={(e) => onMethodChange(p._key, e.target.value)}
                  className="flex-1 min-w-[120px] rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:border-primary-400 focus:outline-none"
                >
                  {payMethods.map((m) => (
                    <option key={m.payment_method_id} value={m.payment_method_id}>{m.method_name}</option>
                  ))}
                </select>
                <input
                  type="number" min="0" step="0.01"
                  value={p.amountApplied}
                  onChange={(e) => updatePayment(p._key, 'amountApplied', e.target.value)}
                  placeholder="Amount"
                  className="w-28 rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-right focus:border-primary-400 focus:outline-none"
                />
                {p.requiresReference && (
                  <input
                    type="text"
                    value={p.referenceNumber}
                    onChange={(e) => updatePayment(p._key, 'referenceNumber', e.target.value)}
                    placeholder="Ref #"
                    className="w-24 rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:border-primary-400 focus:outline-none"
                  />
                )}
                <button
                  onClick={() => removePayment(p._key)}
                  className="text-gray-300 hover:text-red-500 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          <div className="mt-2 flex items-center justify-between">
            <button
              type="button"
              onClick={addPayment}
              className="flex items-center gap-1.5 text-xs text-primary-600 hover:text-primary-800 font-medium"
            >
              <Plus className="h-3.5 w-3.5" /> Add payment
            </button>
            <span className={`text-xs font-semibold ${Math.abs(totalPaid - subtotal) < 0.01 ? 'text-emerald-600' : 'text-amber-600'}`}>
              Paid {formatCurrency(totalPaid)} / Due {formatCurrency(subtotal)}
            </span>
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none resize-none"
          />
        </div>

        {/* Edit reason (required) */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Reason for edit <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={editReason}
            onChange={(e) => setEditReason(e.target.value)}
            placeholder="e.g. Wrong quantity entered, price correction…"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-1 border-t border-gray-100">
          <Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button>
          <Button
            fullWidth
            loading={mut.isPending}
            disabled={!editReason.trim() || computedItems.length === 0}
            onClick={handleSave}
          >
            Save Changes
          </Button>
        </div>
      </div>
    </Modal>
  );
}
