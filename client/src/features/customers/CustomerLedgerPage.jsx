import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, CreditCard, AlertTriangle, CheckCircle, Clock,
  RefreshCw, Receipt,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/services/api';
import { formatCurrency, formatDate } from '@/utils/formatters';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { PageSpinner } from '@/components/ui/Spinner';

// ── Aging card ────────────────────────────────────────────────────────────────

function AgingCard({ label, amount, color }) {
  const colors = {
    green:  'bg-green-50 border-green-200 text-green-700',
    amber:  'bg-amber-50 border-amber-200 text-amber-700',
    orange: 'bg-orange-50 border-orange-200 text-orange-700',
    red:    'bg-red-50 border-red-200 text-red-700',
  };
  return (
    <div className={`rounded-xl border p-3 text-center ${colors[color]}`}>
      <p className="text-xs font-medium opacity-80 mb-0.5">{label}</p>
      <p className="text-lg font-bold">{formatCurrency(amount)}</p>
    </div>
  );
}

// ── Record Payment Modal ──────────────────────────────────────────────────────

function PaymentModal({ customerId, customerName, balance, selectedIds, selectedAmount, payMethods, onClose, onSaved }) {
  const qc = useQueryClient();
  const hasSelection = selectedIds.length > 0;
  const [amount,     setAmount]     = useState(hasSelection ? String(selectedAmount.toFixed(2)) : '');
  const [methodId,   setMethodId]   = useState('');

  const mut = useMutation({
    mutationFn: (body) => api.post(`/customers/${customerId}/credit-payment`, body),
    onSuccess: (res) => {
      toast.success(`Payment recorded — balance: ${formatCurrency(res.data.data.credit_balance)}`);
      qc.invalidateQueries({ queryKey: ['customer-ledger', customerId] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      onSaved();
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed to record payment'),
  });

  const handleSave = () => {
    const body = {
      amount:          parseFloat(amount),
      paymentMethodId: methodId || null,
    };
    if (hasSelection) body.transactionIds = selectedIds;
    mut.mutate(body);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Total outstanding: <span className="font-semibold text-red-600">{formatCurrency(balance)}</span>
      </p>

      {hasSelection && (
        <div className="rounded-lg bg-primary-50 border border-primary-200 px-3 py-2 text-xs text-primary-800">
          Applying to <span className="font-semibold">{selectedIds.length}</span> selected invoice{selectedIds.length !== 1 ? 's' : ''} —
          total <span className="font-semibold">{formatCurrency(selectedAmount)}</span>
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Amount (KES)</label>
        <input
          type="number" min="0.01" step="0.01" autoFocus
          value={amount} onChange={(e) => setAmount(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Payment Method</label>
        <select value={methodId} onChange={(e) => setMethodId(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none">
          <option value="">— Cash (default) —</option>
          {payMethods.map((m) => (
            <option key={m.payment_method_id} value={m.payment_method_id}>{m.method_name}</option>
          ))}
        </select>
      </div>

      <div className="flex gap-3">
        <Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button>
        <Button fullWidth loading={mut.isPending}
          disabled={!amount || parseFloat(amount) <= 0}
          onClick={handleSave}>
          Record Payment
        </Button>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CustomerLedgerPage() {
  const { customerId } = useParams();
  const navigate       = useNavigate();
  const [selected, setSelected]   = useState(new Set());
  const [payModal, setPayModal]   = useState(false);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['customer-ledger', customerId],
    queryFn:  () => api.get(`/customers/${customerId}/ledger`).then((r) => r.data.data),
    enabled:  !!customerId,
  });

  const { data: payMethods = [] } = useQuery({
    queryKey: ['payment-methods'],
    queryFn:  () => api.get('/pos/payment-methods').then((r) => r.data.data ?? r.data),
  });

  if (isLoading) return <PageSpinner />;
  if (isError || !data) return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-2">
      <AlertTriangle className="h-8 w-8 text-amber-400" />
      <p className="text-sm font-medium text-gray-600">Could not load credit entries</p>
    </div>
  );

  const { customer, aging, activity } = data;
  const availableCredit = Math.max(0, customer.credit_limit - customer.credit_balance);

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const unpaidSales = activity.filter((a) => a.type === 'SALE' && a.payment_status !== 'paid');
  const allSelected = unpaidSales.length > 0 && unpaidSales.every((a) => selected.has(a.id));
  const toggleAll   = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(unpaidSales.map((a) => a.id)));
    }
  };

  const selectedIds     = [...selected];
  const selectedAmount  = activity
    .filter((a) => selected.has(a.id))
    .reduce((s, a) => s + a.amount, 0);

  const totalAging = aging.current + aging.days30 + aging.days60 + aging.days90plus;

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/app/customers')}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors cursor-pointer">
          <ArrowLeft className="h-4 w-4" /> Customers
        </button>
      </div>

      {/* Customer summary card */}
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-lg font-bold text-gray-900">{customer.customer_name}</h1>
            <p className="text-xs text-gray-400 mt-0.5">Credit Account</p>
          </div>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-xs text-gray-400">Outstanding</p>
              <p className="text-base font-bold text-red-600">{formatCurrency(customer.credit_balance)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Limit</p>
              <p className="text-base font-bold text-gray-800">{formatCurrency(customer.credit_limit)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Available</p>
              <p className="text-base font-bold text-green-700">{formatCurrency(availableCredit)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Aging */}
      {totalAging > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Aging — Outstanding Balance</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <AgingCard label="0 – 30 days"  amount={aging.current}    color="green"  />
            <AgingCard label="31 – 60 days" amount={aging.days30}     color="amber"  />
            <AgingCard label="61 – 90 days" amount={aging.days60}     color="orange" />
            <AgingCard label="90+ days"     amount={aging.days90plus} color="red"    />
          </div>
        </div>
      )}

      {/* Activity */}
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-800">Credit Activity</h2>
          <div className="flex items-center gap-2">
            {selected.size > 0 && (
              <Button size="sm" icon={<CreditCard className="h-3.5 w-3.5" />}
                onClick={() => setPayModal(true)}>
                Pay {selected.size} Invoice{selected.size !== 1 ? 's' : ''}
              </Button>
            )}
            {customer.credit_balance > 0 && selected.size === 0 && (
              <Button size="sm" variant="secondary" icon={<CreditCard className="h-3.5 w-3.5" />}
                onClick={() => setPayModal(true)}>
                Record Payment
              </Button>
            )}
            <button onClick={() => refetch()}
              className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50 cursor-pointer transition-colors">
              <RefreshCw className={`h-3 w-3 ${isFetching ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-3 py-2.5 text-left w-8">
                  {unpaidSales.length > 0 && (
                    <input type="checkbox" checked={allSelected} onChange={toggleAll}
                      className="h-3.5 w-3.5 rounded border-gray-300 text-primary-600 cursor-pointer" />
                  )}
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500">Type</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500">Reference</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500">Date</th>
                <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500">Amount</th>
                <th className="px-3 py-2.5 text-center text-xs font-medium text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {activity.map((row) => {
                const isSale    = row.type === 'SALE';
                const isPaid    = row.payment_status === 'paid';
                const isChecked = selected.has(row.id);
                const canSelect = isSale && !isPaid;
                return (
                  <tr key={row.id}
                    className={`transition-colors ${canSelect ? 'cursor-pointer hover:bg-primary-50' : ''} ${isChecked ? 'bg-primary-50' : ''}`}
                    onClick={() => canSelect && toggleSelect(row.id)}>
                    <td className="px-3 py-3 text-center">
                      {canSelect && (
                        <input type="checkbox" checked={isChecked}
                          onChange={() => toggleSelect(row.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="h-3.5 w-3.5 rounded border-gray-300 text-primary-600 cursor-pointer" />
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {isSale ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                          <Receipt className="h-3 w-3" /> Invoice
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                          <CreditCard className="h-3 w-3" /> Payment
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-mono text-xs font-semibold text-gray-700">{row.ref}</p>
                      {isSale && row.items?.length > 0 && (
                        <p className="text-[10px] text-gray-400 mt-0.5 truncate max-w-[180px]">
                          {row.items.slice(0, 2).map((i) => `${i.name} ×${i.qty}`).join(', ')}
                          {row.items.length > 2 && ` +${row.items.length - 2} more`}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {formatDate(row.date)}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold text-xs">
                      <span className={isSale ? 'text-red-600' : 'text-green-700'}>
                        {isSale ? '' : '−'}{formatCurrency(row.amount)}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      {isSale ? (
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          isPaid ? 'bg-green-100 text-green-700'
                          : row.payment_status === 'partial' ? 'bg-amber-100 text-amber-700'
                          : 'bg-red-100 text-red-600'
                        }`}>
                          {isPaid
                            ? <><CheckCircle className="h-2.5 w-2.5" /> Paid</>
                            : row.payment_status === 'partial'
                              ? <><Clock className="h-2.5 w-2.5" /> Partial</>
                              : <><AlertTriangle className="h-2.5 w-2.5" /> Unpaid</>}
                        </span>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {activity.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-gray-400 text-sm">
                    No credit activity found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payment modal */}
      <Modal open={payModal} onClose={() => setPayModal(false)}
        title={`Record Payment — ${customer.customer_name}`} size="sm">
        <PaymentModal
          customerId={customerId}
          customerName={customer.customer_name}
          balance={customer.credit_balance}
          selectedIds={selectedIds}
          selectedAmount={selectedAmount}
          payMethods={payMethods}
          onClose={() => setPayModal(false)}
          onSaved={() => { setPayModal(false); setSelected(new Set()); }}
        />
      </Modal>
    </div>
  );
}
