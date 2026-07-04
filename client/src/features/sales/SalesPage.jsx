import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, XCircle, Receipt, Printer, Download, RefreshCw, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/services/api';
import { formatCurrency, formatDateTime } from '@/utils/formatters';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { PageSpinner } from '@/components/ui/Spinner';
import { usePermission } from '@/hooks/usePermission';
import ReceiptModal from '@/components/ui/ReceiptModal';
import { exportToExcel } from '@/utils/exportExcel';
import EditTransactionModal from './EditTransactionModal';

const STATUS_STYLES = {
  completed: 'bg-green-100 text-green-700',
  void:      'bg-red-100 text-red-600',
  pending:   'bg-yellow-100 text-yellow-700',
};

function TransactionDetail({ txn, onVoid, canVoid, onEdit, canEdit, onPrint }) {
  if (!txn) return null;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-xl bg-gray-50 p-4">
        <div>
          <p className="font-mono text-sm font-bold text-gray-800">{txn.transaction_number}</p>
          <p className="text-xs text-gray-500 mt-0.5">{formatDateTime(txn.transaction_date)}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLES[txn.status] ?? 'bg-gray-100 text-gray-600'}`}>
          {txn.status}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <div><span className="text-gray-500">Customer: </span><span className="font-medium">{txn.customer_name}</span></div>
        <div><span className="text-gray-500">Cashier: </span><span className="font-medium">{txn.cashier_name}</span></div>
        <div><span className="text-gray-500">Branch: </span><span className="font-medium">{txn.branch_name}</span></div>
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Items</p>
        <div className="rounded-lg border border-gray-100 overflow-hidden">
          <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Product</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Qty</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Price</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {txn.items?.map((item, i) => (
                <tr key={item.item_id ?? i}>
                  <td className="px-3 py-2">
                    <p className="font-medium text-gray-800">{item.product_name}</p>
                    <p className="text-xs text-gray-400">{item.sku}</p>
                  </td>
                  <td className="px-3 py-2 text-right">{parseFloat(item.quantity)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(item.unit_price)}</td>
                  <td className="px-3 py-2 text-right font-semibold">{formatCurrency(item.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <div className="sm:hidden divide-y divide-gray-50">
            {txn.items?.map((item, i) => (
              <div key={item.item_id ?? i} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-800 text-sm">{item.product_name}</p>
                    <p className="text-xs text-gray-400">{item.sku}</p>
                  </div>
                  <p className="flex-shrink-0 font-semibold text-sm text-gray-800">{formatCurrency(item.line_total)}</p>
                </div>
                <p className="mt-1 text-xs text-gray-500">{parseFloat(item.quantity)} × {formatCurrency(item.unit_price)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="space-y-1 text-sm border-t border-gray-100 pt-3">
        <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>{formatCurrency(txn.subtotal)}</span></div>
        {parseFloat(txn.discount_amount) > 0 && <div className="flex justify-between text-gray-600"><span>Discount</span><span>-{formatCurrency(txn.discount_amount)}</span></div>}
        <div className="flex justify-between font-bold text-base border-t border-gray-200 pt-2">
          <span>Total</span><span className="text-secondary-600">{formatCurrency(txn.total_amount)}</span>
        </div>
        {/* VAT is informational — embedded in prices, displayed below total */}
        {parseFloat(txn.tax_amount) > 0 && (
          <div className="flex justify-between text-xs text-gray-400 pt-0.5">
            <span>of which VAT (incl.)</span><span>{formatCurrency(txn.tax_amount)}</span>
          </div>
        )}
      </div>
      {txn.payments?.length > 0 && (
        <div className="text-sm">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Payments</p>
          {txn.payments.map((p, i) => (
            <div key={p.payment_id ?? i} className="flex justify-between text-gray-700 py-0.5">
              <span>{p.method_name}{p.reference_number && <span className="text-gray-400 text-xs ml-2">#{p.reference_number}</span>}</span>
              <span className="font-medium">{formatCurrency(p.amount_applied)}</span>
            </div>
          ))}
        </div>
      )}
      {txn.edit_reason && (
        <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-700">
          <span className="font-semibold">Edited: </span>{txn.edit_reason}
        </div>
      )}
      <div className="border-t border-gray-100 pt-3 flex gap-2 flex-wrap">
        <Button variant="secondary" size="sm" fullWidth icon={<Printer className="h-4 w-4" />}
          onClick={() => onPrint(txn)}>
          Print Receipt
        </Button>
        {canEdit && txn.status === 'completed' && (
          <Button variant="secondary" size="sm" fullWidth icon={<Pencil className="h-4 w-4 text-primary-500" />}
            onClick={() => onEdit(txn)}>
            Edit
          </Button>
        )}
        {canVoid && txn.status === 'completed' && (
          <Button variant="secondary" size="sm" fullWidth icon={<XCircle className="h-4 w-4 text-red-500" />}
            onClick={() => onVoid(txn.transaction_id)}>
            Void
          </Button>
        )}
      </div>
    </div>
  );
}

function VoidConfirm({ onConfirm, onClose }) {
  const [reason, setReason] = useState('');
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">This will reverse the transaction and restore inventory. This cannot be undone.</p>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Reason *</label>
        <textarea required rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
      </div>
      <div className="flex gap-3">
        <Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button>
        <Button variant="primary" fullWidth disabled={!reason.trim()} onClick={() => onConfirm(reason)}
          className="!bg-red-600 !hover:bg-red-700">Confirm Void</Button>
      </div>
    </div>
  );
}

export default function SalesPage() {
  const qc = useQueryClient();
  const { hasCapability } = usePermission();
  const canVoidSales  = hasCapability('sales.void');
  const canEditSales  = hasCapability('sales.void'); // edit requires same manager-level access
  const [search,        setSearch]        = useState('');
  const [startDate,     setStartDate]     = useState('');
  const [endDate,       setEndDate]       = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [minAmount,     setMinAmount]     = useState('');
  const [maxAmount,     setMaxAmount]     = useState('');
  const [page,          setPage]          = useState(1);
  const [selected,      setSelected]      = useState(null);
  const [voidTarget,    setVoidTarget]    = useState(null);
  const [editTarget,    setEditTarget]    = useState(null);
  const [receiptTxn,    setReceiptTxn]    = useState(null);
  const [exporting,     setExporting]     = useState(false);

  const { data: payMethods = [] } = useQuery({
    queryKey: ['payment-methods-sales'],
    queryFn:  () => api.get('/pos/payment-methods').then((r) => r.data.data),
  });

  const filters = { search, startDate, endDate, paymentMethod, minAmount, maxAmount, page, limit: 25 };

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['transactions', filters],
    queryFn: () => api.get('/sales/transactions', { params: filters }).then((r) => r.data.data),
    placeholderData: (prev) => prev,
  });

  const { data: txnDetail } = useQuery({
    queryKey: ['transaction-detail', selected],
    queryFn: () => api.get(`/sales/transactions/${selected}`).then((r) => r.data.data),
    enabled: !!selected,
  });

  const voidMut = useMutation({
    mutationFn: ({ id, reason }) => api.post(`/sales/transactions/${id}/void`, { reason }),
    onSuccess: () => {
      toast.success('Transaction voided');
      qc.invalidateQueries(['transactions']);
      qc.invalidateQueries(['transaction-detail', voidTarget]);
      setVoidTarget(null);
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed to void'),
  });

  const transactions = data?.transactions ?? [];
  const total        = data?.total        ?? 0;
  const pages        = data?.pages        ?? 1;

  const handleExport = async () => {
    setExporting(true);
    try {
      const exportFilters = { search, startDate, endDate, paymentMethod, minAmount, maxAmount, page: 1, limit: 100000 };
      const res = await api.get('/sales/transactions', { params: exportFilters });
      const all = res.data.data?.transactions ?? [];
      if (!all.length) { toast('No records to export'); return; }
      exportToExcel('sales-transactions', all, [
        'transaction_number','transaction_date','customer_name','cashier_name',
        'branch_name','payment_method','subtotal','tax_amount','discount_amount','total_amount','cogs','profit','status',
      ], [
        'TXN #','Date','Customer','Cashier','Branch','Payment','Subtotal','Tax','Discount','Total','COGS','Profit','Status',
      ]);
    } catch {
      toast.error('Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Search by TXN#, customer or cashier…"
            value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none" />
        </div>
        {/* Payment method filter */}
        <select value={paymentMethod} onChange={(e) => { setPaymentMethod(e.target.value); setPage(1); }}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none">
          <option value="">All Payments</option>
          {payMethods.map((m) => (
            <option key={m.payment_method_id} value={m.method_name}>{m.method_name}</option>
          ))}
        </select>
        {/* Amount range */}
        <input type="number" min="0" step="0.01" placeholder="Min amount"
          value={minAmount} onChange={(e) => { setMinAmount(e.target.value); setPage(1); }}
          className="w-28 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
        <span className="flex items-center text-gray-400 text-sm">–</span>
        <input type="number" min="0" step="0.01" placeholder="Max amount"
          value={maxAmount} onChange={(e) => { setMaxAmount(e.target.value); setPage(1); }}
          className="w-28 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
        {/* Date range */}
        <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
        <span className="flex items-center text-gray-400 text-sm">to</span>
        <input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
        {(search || startDate || endDate || paymentMethod || minAmount || maxAmount) && (
          <button onClick={() => { setSearch(''); setStartDate(''); setEndDate(''); setPaymentMethod(''); setMinAmount(''); setMaxAmount(''); setPage(1); }}
            className="text-xs text-gray-400 hover:text-gray-600 px-2">Clear</button>
        )}
        <Button variant="secondary" size="sm"
          icon={<RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />}
          onClick={() => refetch()}>
          Refresh
        </Button>
        <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />}
          loading={exporting} onClick={handleExport}>
          Export All
        </Button>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        {isLoading ? <PageSpinner /> : transactions.length === 0 ? (
          <p className="py-12 text-center text-gray-400">
            <Receipt className="mx-auto mb-2 h-8 w-8 opacity-30" />No transactions found
          </p>
        ) : (
          <>
          {/* Desktop table — every column always visible */}
          <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium text-gray-600">TXN #</th>
                <th className="px-3 py-2.5 text-left font-medium text-gray-600">Date</th>
                <th className="px-3 py-2.5 text-left font-medium text-gray-600">Customer</th>
                <th className="px-3 py-2.5 text-left font-medium text-gray-600">Cashier</th>
                <th className="px-3 py-2.5 text-left font-medium text-gray-600">Payment</th>
                <th className="px-3 py-2.5 text-right font-medium text-blue-600" title="DR Cash/Bank — total received">Dr</th>
                <th className="px-3 py-2.5 text-right font-medium text-green-600" title="CR Revenue — ex-VAT">Cr Rev</th>
                <th className="px-3 py-2.5 text-right font-medium text-purple-600" title="CR Tax Payable — VAT collected">Cr VAT</th>
                <th className="px-3 py-2.5 text-right font-medium text-gray-600">Total</th>
                <th className="px-3 py-2.5 text-right font-medium text-emerald-600">Profit</th>
                <th className="px-3 py-2.5 text-center font-medium text-gray-600">Status</th>
                <th className="px-3 py-2.5 text-center font-medium text-gray-600">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {transactions.map((t) => (
                <tr key={t.transaction_id} className="hover:bg-gray-50 active:bg-gray-100 transition-colors">
                  <td className="px-3 py-2.5 font-mono text-primary-600 font-semibold whitespace-nowrap">{t.transaction_number}</td>
                  <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{formatDateTime(t.transaction_date)}</td>
                  <td className="px-3 py-2.5 text-gray-700">{t.customer_name}</td>
                  <td className="px-3 py-2.5 text-gray-500">{t.cashier_name}</td>
                  <td className="px-3 py-2.5 text-gray-500">{t.payment_method}</td>
                  {/* Dr: Cash/Bank = total received */}
                  <td className="px-3 py-2.5 text-right font-mono">
                    <span className={`font-semibold ${t.status === 'void' ? 'text-gray-400 line-through' : 'text-blue-700'}`}>
                      {formatCurrency(t.total_amount)}
                    </span>
                  </td>
                  {/* Cr: Revenue = total ex-VAT */}
                  <td className="px-3 py-2.5 text-right font-mono">
                    <span className={`font-semibold ${t.status === 'void' ? 'text-gray-400 line-through' : 'text-green-700'}`}>
                      {formatCurrency(parseFloat(t.total_amount) - parseFloat(t.tax_amount || 0))}
                    </span>
                  </td>
                  {/* Cr: VAT Payable */}
                  <td className="px-3 py-2.5 text-right font-mono">
                    {parseFloat(t.tax_amount) > 0
                      ? <span className={`font-semibold ${t.status === 'void' ? 'text-gray-400 line-through' : 'text-purple-600'}`}>{formatCurrency(t.tax_amount)}</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  {/* Total — always visible */}
                  <td className="px-3 py-2.5 text-right font-mono">
                    <span className={`font-semibold ${t.status === 'void' ? 'text-gray-400 line-through' : 'text-blue-700'}`}>
                      {formatCurrency(t.total_amount)}
                    </span>
                  </td>
                  {/* Profit = revenue ex-VAT minus COGS */}
                  <td className="px-3 py-2.5 text-right font-mono">
                    {t.status === 'void'
                      ? <span className="text-gray-300">—</span>
                      : <span className={`font-semibold ${t.profit >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{formatCurrency(t.profit)}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[t.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {t.status}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <button onClick={() => setSelected(t.transaction_id)}
                      className="rounded-lg border border-primary-200 bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-100 transition-colors">
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden space-y-2 p-3">
            {transactions.map((t) => (
              <div key={t.transaction_id} className="rounded-xl border border-gray-100 bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-primary-600 font-semibold text-sm">{t.transaction_number}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{formatDateTime(t.transaction_date)}</p>
                    <p className="text-xs text-gray-700 mt-0.5 truncate">{t.customer_name}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`font-mono font-semibold text-sm ${t.status === 'void' ? 'text-gray-400 line-through' : 'text-blue-700'}`}>
                      {formatCurrency(t.total_amount)}
                    </p>
                    <span className={`inline-block mt-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[t.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {t.status}
                    </span>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                  <span>{t.cashier_name}</span>
                  <span>{t.payment_method}</span>
                  {parseFloat(t.tax_amount) > 0 && (
                    <span className="font-medium text-purple-600">VAT {formatCurrency(t.tax_amount)}</span>
                  )}
                  {t.status !== 'void' && (
                    <span className={`font-medium ${t.profit >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      Profit {formatCurrency(t.profit)}
                    </span>
                  )}
                </div>
                <button onClick={() => setSelected(t.transaction_id)}
                  className="mt-2 w-full rounded-lg border border-primary-200 bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-700 hover:bg-primary-100 transition-colors">
                  View
                </button>
              </div>
            ))}
          </div>
          </>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
            <p className="text-xs text-gray-500">Page {page} of {pages} ({total} total)</p>
            <div className="flex gap-1">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-md border border-gray-200 px-3 py-1 text-xs disabled:opacity-40 hover:bg-gray-50">← Prev</button>
              <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded-md border border-gray-200 px-3 py-1 text-xs disabled:opacity-40 hover:bg-gray-50">Next →</button>
            </div>
          </div>
        )}
      </div>

      <Modal open={!!selected && !voidTarget && !editTarget} onClose={() => setSelected(null)} title="Transaction Details" size="lg">
        <TransactionDetail
          txn={txnDetail}
          canVoid={canVoidSales}
          onVoid={(id) => { setVoidTarget(id); }}
          canEdit={canEditSales}
          onEdit={(txn) => setEditTarget(txn)}
          onPrint={(txn) => setReceiptTxn(txn)}
        />
      </Modal>

      <Modal open={canVoidSales && !!voidTarget} onClose={() => setVoidTarget(null)} title="Void Transaction" size="sm">
        <VoidConfirm onClose={() => setVoidTarget(null)} onConfirm={(reason) => voidMut.mutate({ id: voidTarget, reason })} />
      </Modal>

      <ReceiptModal open={!!receiptTxn} onClose={() => setReceiptTxn(null)} txn={receiptTxn} />

      <EditTransactionModal
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        txn={editTarget}
        onSaved={() => {
          setEditTarget(null);
          qc.invalidateQueries({ queryKey: ['transaction-detail', editTarget?.transaction_id] });
        }}
      />
    </div>
  );
}
