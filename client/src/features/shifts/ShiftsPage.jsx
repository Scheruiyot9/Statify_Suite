import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Clock, XCircle, Receipt, CheckCircle,
  AlertTriangle, ChevronLeft, ChevronRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/services/api';
import { formatCurrency, formatDateTime, formatDate } from '@/utils/formatters';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { PageSpinner } from '@/components/ui/Spinner';

const STATUS_STYLES = {
  open:        'bg-green-100 text-green-700',
  closed:      'bg-gray-100 text-gray-600',
  reconciled:  'bg-blue-100 text-blue-700',
  disputed:    'bg-red-100 text-red-700',
};

const STATUS_ICONS = {
  open:       <Clock className="h-3 w-3" />,
  closed:     <CheckCircle className="h-3 w-3" />,
  reconciled: <CheckCircle className="h-3 w-3" />,
  disputed:   <AlertTriangle className="h-3 w-3" />,
};

// ── Shift Detail Modal ────────────────────────────────────────────────────────

function ShiftDetail({ sessionId, onForceClose }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['session-detail', sessionId],
    queryFn:  () => api.get(`/pos/sessions/${sessionId}/detail`).then((r) => r.data.data),
    enabled:  !!sessionId,
  });

  if (isLoading) return <PageSpinner />;
  if (isError || !data) return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
      <AlertTriangle className="h-8 w-8 text-amber-400" />
      <p className="text-sm font-medium text-gray-600">Could not load shift details</p>
      <p className="text-xs text-gray-400">The shift data may not be available</p>
    </div>
  );

  const variance = data.cash_variance ?? 0;
  const payModeOpen  = data.pay_mode_amounts?.filter((a) => a.count_type === 'opening') ?? [];
  const payModeClose = data.pay_mode_amounts?.filter((a) => a.count_type === 'closing') ?? [];

  return (
    <div className="space-y-5">
      {/* Header info */}
      <div className="grid grid-cols-2 gap-3">
        <InfoCard label="Terminal"   value={`${data.terminal_name} (${data.terminal_code})`} />
        <InfoCard label="Branch"     value={data.branch_name} />
        <InfoCard label="Cashier"    value={data.cashier_name} />
        <InfoCard label="Closed by"  value={data.closed_by_name ?? '—'} />
        <InfoCard label="Opened"     value={formatDateTime(data.session_start)} />
        <InfoCard label="Closed"     value={data.session_end ? formatDateTime(data.session_end) : '—'} />
      </div>

      {/* Sales summary */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Transactions" value={data.txn_count}                      color="primary" />
        <StatCard label="Total Sales"  value={formatCurrency(data.total_sales)}    color="green" />
        <StatCard
          label="Cash Variance"
          value={formatCurrency(Math.abs(variance))}
          color={Math.abs(variance) < 0.5 ? 'green' : variance > 0 ? 'blue' : 'red'}
          sub={variance > 0 ? 'Over' : variance < 0 ? 'Short' : 'Balanced'}
        />
      </div>

      {/* Cash reconciliation */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Cash Reconciliation</h3>
        <div className="rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-50">
              <RecRow label="Opening Float"   value={formatCurrency(data.opening_cash_amount)} />
              <RecRow label="Cash Sales"      value={formatCurrency(data.payment_breakdown?.find((p) => p.method_name === 'Cash')?.total ?? 0)} />
              <RecRow label="Expected Cash"   value={formatCurrency(data.expected_cash_amount)} bold />
              <RecRow label="Closing Count"   value={formatCurrency(data.closing_cash_counted)} />
              <RecRow
                label="Variance"
                value={(variance >= 0 ? '+' : '') + formatCurrency(variance)}
                className={Math.abs(variance) < 0.5 ? 'text-green-700' : 'text-red-600 font-semibold'}
              />
            </tbody>
          </table>
        </div>
      </div>

      {/* Payment breakdown */}
      {data.payment_breakdown?.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Payment Breakdown</h3>
          <div className="rounded-xl border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Method</th>
                  {payModeOpen.length > 0  && <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Opening</th>}
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Sales</th>
                  {payModeClose.length > 0 && <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Closing Count</th>}
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Txns</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.payment_breakdown.map((p) => {
                  const open  = payModeOpen.find((a) => a.method_name === p.method_name);
                  const close = payModeClose.find((a) => a.method_name === p.method_name);
                  return (
                    <tr key={p.method_name}>
                      <td className="px-4 py-3 font-medium text-gray-800">{p.method_name}</td>
                      {payModeOpen.length > 0  && <td className="px-4 py-3 text-right text-gray-500">{open  ? formatCurrency(open.amount)  : '—'}</td>}
                      <td className="px-4 py-3 text-right text-green-700 font-medium">{formatCurrency(p.total)}</td>
                      {payModeClose.length > 0 && <td className="px-4 py-3 text-right text-gray-700">{close ? formatCurrency(close.amount) : '—'}</td>}
                      <td className="px-4 py-3 text-right text-gray-500">{p.count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Notes */}
      {(data.opening_notes || data.closing_notes) && (
        <div className="space-y-2">
          {data.opening_notes && (
            <div className="rounded-lg bg-gray-50 p-3 text-sm">
              <span className="font-medium text-gray-500">Opening note: </span>
              <span className="text-gray-700">{data.opening_notes}</span>
            </div>
          )}
          {data.closing_notes && (
            <div className="rounded-lg bg-gray-50 p-3 text-sm">
              <span className="font-medium text-gray-500">Closing note: </span>
              <span className="text-gray-700">{data.closing_notes}</span>
            </div>
          )}
        </div>
      )}

      {/* Transactions */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Transactions ({data.txn_count})
        </h3>
        <div className="max-h-56 overflow-y-auto rounded-xl border border-gray-100">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">TXN #</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Time</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Customer</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Payment</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Total</th>
                <th className="px-4 py-2.5 text-center text-xs font-medium text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {data.transactions?.map((t) => (
                <tr key={t.transaction_id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-mono text-xs text-primary-600 font-semibold">{t.transaction_number}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">{formatDateTime(t.transaction_date)}</td>
                  <td className="px-4 py-2.5 text-gray-700">{t.customer_name}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">{t.payment_methods}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{formatCurrency(t.total_amount)}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[t.status] ?? 'bg-gray-100 text-gray-500'}`}>
                      {t.status}
                    </span>
                  </td>
                </tr>
              ))}
              {!data.transactions?.length && (
                <tr><td colSpan={6} className="py-6 text-center text-gray-400 text-xs">No transactions in this shift</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Force close */}
      {data.status === 'open' && (
        <div className="border-t border-gray-100 pt-4">
          <Button
            variant="secondary" fullWidth
            icon={<XCircle className="h-4 w-4 text-red-500" />}
            onClick={() => onForceClose(sessionId)}
          >
            Force Close Shift
          </Button>
        </div>
      )}
    </div>
  );
}

function InfoCard({ label, value }) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-sm font-medium text-gray-800">{value}</p>
    </div>
  );
}

function StatCard({ label, value, color, sub }) {
  const colors = {
    primary: 'bg-primary-50 text-primary-700',
    green:   'bg-green-50 text-green-700',
    red:     'bg-red-50 text-red-700',
    blue:    'bg-blue-50 text-blue-700',
  };
  return (
    <div className={`rounded-xl p-3 text-center ${colors[color] ?? colors.primary}`}>
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className="text-lg font-bold">{value}</p>
      {sub && <p className="text-xs mt-0.5 opacity-70">{sub}</p>}
    </div>
  );
}

function RecRow({ label, value, bold, className }) {
  return (
    <tr>
      <td className="px-4 py-2.5 text-gray-600">{label}</td>
      <td className={`px-4 py-2.5 text-right ${bold ? 'font-bold text-gray-900' : ''} ${className ?? 'text-gray-700'}`}>{value}</td>
    </tr>
  );
}

// ── Force Close Confirm ───────────────────────────────────────────────────────

function ForceCloseConfirm({ sessionId, onClose, onDone }) {
  const [closingCash, setClosingCash] = useState('');
  const [notes, setNotes]             = useState('');
  const qc = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: (data) => api.patch(`/pos/sessions/${sessionId}/force-close`, data),
    onSuccess: () => {
      toast.success('Shift force-closed');
      qc.invalidateQueries(['sessions']);
      qc.invalidateQueries(['session-detail', sessionId]);
      onDone();
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed to close shift'),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        This will close the shift on behalf of the cashier. Enter the actual cash in the drawer.
      </p>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Closing Cash Count (KES)</label>
        <input
          type="number" step="0.01" min="0"
          value={closingCash} onChange={(e) => setClosingCash(e.target.value)}
          placeholder="0.00"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
      </div>
      <div className="flex gap-3">
        <Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button>
        <Button
          fullWidth loading={isPending}
          className="!bg-red-600 hover:!bg-red-700"
          onClick={() => mutate({ closingCashCounted: parseFloat(closingCash) || 0, closingNotes: notes })}
        >
          Confirm Close
        </Button>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ShiftsPage() {
  const [startDate,  setStartDate]  = useState('');
  const [endDate,    setEndDate]    = useState('');
  const [status,     setStatus]     = useState('');
  const [page,       setPage]       = useState(1);
  const [selected,   setSelected]   = useState(null);  // session_id shown in detail panel
  const [forceClose, setForceClose] = useState(null);

  const filters = { startDate, endDate, status, page, limit: 20 };

  const { data, isLoading } = useQuery({
    queryKey: ['sessions', filters],
    queryFn:  () => api.get('/pos/sessions', { params: filters }).then((r) => r.data.data),
    keepPreviousData: true,
  });

  const sessions = data?.sessions ?? [];
  const total    = data?.total    ?? 0;
  const pages    = data?.pages    ?? 1;

  const clearFilters = () => { setStartDate(''); setEndDate(''); setStatus(''); setPage(1); };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
        <select
          value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
        >
          <option value="">All Statuses</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="reconciled">Reconciled</option>
        </select>
        <input type="date" value={startDate}
          onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
        <span className="flex items-center text-gray-400 text-sm">to</span>
        <input type="date" value={endDate}
          onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
        {(startDate || endDate || status) && (
          <button onClick={clearFilters} className="text-xs text-gray-400 hover:text-gray-600 px-2">Clear</button>
        )}
      </div>

      {/* Master-detail layout */}
      <div className={`flex gap-4 items-start ${selected ? 'flex-col xl:flex-row' : ''}`}>

        {/* ── Shift list ── */}
        <div className={`rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden ${selected ? 'w-full xl:w-[480px] xl:flex-shrink-0' : 'w-full'}`}>
          {isLoading ? <PageSpinner /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Date / Time</th>
                    <th className="hidden sm:table-cell px-4 py-3 text-left font-medium text-gray-600">Terminal</th>
                    <th className="hidden md:table-cell px-4 py-3 text-left font-medium text-gray-600">Cashier</th>
                    {!selected && <>
                      <th className="px-4 py-3 text-right font-medium text-gray-600">Sales</th>
                      <th className="hidden sm:table-cell px-4 py-3 text-center font-medium text-gray-600">Txns</th>
                      <th className="hidden md:table-cell px-4 py-3 text-right font-medium text-gray-600">Variance</th>
                    </>}
                    <th className="px-4 py-3 text-center font-medium text-gray-600">Status</th>
                    <th className="px-4 py-3 text-center font-medium text-gray-600">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {sessions.map((s) => {
                    const variance   = s.cash_variance ?? 0;
                    const isSelected = selected === s.session_id;
                    return (
                      <tr
                        key={s.session_id}
                        onClick={() => setSelected(isSelected ? null : s.session_id)}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-primary-50 hover:bg-primary-50'
                            : 'hover:bg-gray-50'
                        }`}
                      >
                        <td className="px-4 py-3">
                          <p className="text-gray-900 font-medium text-xs">{formatDate(s.session_start)}</p>
                          <p className="text-[11px] text-gray-400">{formatDateTime(s.session_start)}</p>
                        </td>
                        <td className="hidden sm:table-cell px-4 py-3">
                          <p className="text-gray-800 font-medium text-xs">{s.terminal_name}</p>
                          <p className="text-[11px] text-gray-400">{s.branch_name}</p>
                        </td>
                        <td className="hidden md:table-cell px-4 py-3 text-gray-700 text-xs">{s.cashier_name}</td>
                        {!selected && <>
                          <td className="px-4 py-3 text-right font-semibold text-gray-900 text-xs">{formatCurrency(s.total_sales)}</td>
                          <td className="hidden sm:table-cell px-4 py-3 text-center text-gray-600 text-xs">{s.txn_count}</td>
                          <td className="hidden md:table-cell px-4 py-3 text-right text-xs">
                            {s.status === 'open' ? (
                              <span className="text-gray-400">—</span>
                            ) : (
                              <span className={
                                Math.abs(variance) < 0.5 ? 'text-green-600 font-medium'
                                : variance > 0 ? 'text-blue-600 font-medium'
                                : 'text-red-600 font-medium'
                              }>
                                {variance >= 0 ? '+' : ''}{formatCurrency(variance)}
                              </span>
                            )}
                          </td>
                        </>}
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[s.status] ?? 'bg-gray-100 text-gray-600'}`}>
                            {STATUS_ICONS[s.status]}{s.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => setSelected(isSelected ? null : s.session_id)}
                            className={`rounded-lg border px-3 py-1 text-xs font-semibold transition-colors ${
                              isSelected
                                ? 'border-primary-300 bg-primary-100 text-primary-800'
                                : 'border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100'
                            }`}>
                            {isSelected ? 'Close' : 'View'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {sessions.length === 0 && (
                    <tr>
                      <td colSpan={selected ? 5 : 8} className="py-12 text-center text-gray-400">
                        <Clock className="mx-auto mb-2 h-8 w-8 opacity-30" />
                        No shifts found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {pages > 1 && (
            <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
              <p className="text-xs text-gray-500">Page {page} of {pages} ({total} total)</p>
              <div className="flex gap-1">
                <button disabled={page <= 1} onClick={() => setPage(page - 1)}
                  className="flex items-center gap-1 rounded-md border border-gray-200 px-3 py-1 text-xs disabled:opacity-40 hover:bg-gray-50">
                  <ChevronLeft className="h-3 w-3" /> Prev
                </button>
                <button disabled={page >= pages} onClick={() => setPage(page + 1)}
                  className="flex items-center gap-1 rounded-md border border-gray-200 px-3 py-1 text-xs disabled:opacity-40 hover:bg-gray-50">
                  Next <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Detail panel ── */}
        {selected && (
          <div className="flex-1 min-w-0 rounded-xl border border-primary-100 bg-white shadow-sm overflow-hidden">
            {/* Panel header */}
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3 bg-primary-50">
              <h2 className="text-sm font-semibold text-primary-800">Shift Details</h2>
              <button onClick={() => setSelected(null)}
                className="rounded-md p-1 text-primary-400 hover:bg-primary-100 hover:text-primary-700 transition-colors">
                <XCircle className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto max-h-[calc(100vh-220px)]">
              <ShiftDetail
                sessionId={selected}
                onForceClose={(id) => setForceClose(id)}
              />
            </div>
          </div>
        )}
      </div>

      {/* Force Close Modal */}
      <Modal open={!!forceClose} onClose={() => setForceClose(null)} title="Force Close Shift" size="sm">
        <ForceCloseConfirm
          sessionId={forceClose}
          onClose={() => setForceClose(null)}
          onDone={() => { setForceClose(null); setSelected(null); }}
        />
      </Modal>
    </div>
  );
}
