import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Clock, XCircle, Receipt, CheckCircle,
  AlertTriangle, ChevronLeft, ChevronRight, RefreshCw, Edit2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/services/api';
import { formatCurrency, formatDateTime, formatDate, todayLocal } from '@/utils/formatters';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { PageSpinner } from '@/components/ui/Spinner';
import { usePermission } from '@/hooks/usePermission';

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

// ── Shift Detail (used by ShiftDetailPage) ────────────────────────────────────

export function ShiftDetail({ sessionId }) {
  const [correcting, setCorrecting] = useState(false);
  const [forceClose, setForceClose] = useState(false);
  const { hasRole } = usePermission();
  const canCorrect  = hasRole('company_admin');

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

  const payModeOpen   = data.pay_mode_amounts?.filter((a) => a.count_type === 'opening') ?? [];
  const payModeClose  = data.pay_mode_amounts?.filter((a) => a.count_type === 'closing') ?? [];
  const showOpenCol   = payModeOpen.length > 0 || (data.opening_cash_amount ?? 0) > 0;
  const showReconCols = data.status !== 'open';

  // Total variance across every payment mode, not just cash — a non-cash method
  // (e.g. M-Pesa Till) can be short/over just like the drawer, and that shouldn't
  // be invisible at the top-level KPI. Only counts methods that were actually
  // closed out (closingAmt !== null); uncounted methods don't contribute.
  const nonCashVariance = (data.payment_breakdown ?? [])
    .filter((p) => p.method_name !== 'Cash')
    .reduce((sum, p) => {
      const closingAmt = payModeClose.find((a) => a.method_name === p.method_name)?.amount ?? null;
      return closingAmt !== null ? sum + (closingAmt - p.total) : sum;
    }, 0);
  const totalVariance = (data.cash_variance ?? 0) + nonCashVariance;

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
        <StatCard label="Transactions" value={data.txn_count}                   color="primary" />
        <StatCard label="Total Sales"  value={formatCurrency(data.total_sales)} color="green" />
        {data.status !== 'open' && (() => {
          const v = totalVariance;
          return (
            <StatCard
              label="Total Variance"
              value={formatCurrency(Math.abs(v))}
              color={Math.abs(v) < 0.5 ? 'green' : v > 0 ? 'blue' : 'red'}
              sub={v > 0 ? 'Over' : v < 0 ? 'Short' : 'Balanced'}
            />
          );
        })()}
      </div>

      {/* Credit sales split */}
      {(data.credit_sale_count ?? 0) > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Credit Sales"     value={formatCurrency(data.credit_sale_amount)} color="red"
            sub={`${data.credit_sale_count} txn${data.credit_sale_count !== 1 ? 's' : ''} — charged to account`} />
          <StatCard label="Cash / Paid Sales" value={formatCurrency(data.total_sales - data.credit_sale_amount)} color="blue"
            sub="Collected at counter" />
        </div>
      )}

      {/* Payment breakdown — includes per-method reconciliation when session is closed */}
      {data.payment_breakdown?.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Payment Breakdown</h3>
          <div className="rounded-xl border border-gray-100 overflow-hidden">
            {/* Desktop table — every column always visible */}
            <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Method</th>
                  {showOpenCol     && <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Opening</th>}
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Sales</th>
                  {showReconCols   && <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Expected</th>}
                  {showReconCols   && <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Closing Count</th>}
                  {showReconCols   && <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Variance</th>}
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Txns</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.payment_breakdown.map((p) => {
                  const isCash     = p.method_name === 'Cash';
                  const open       = payModeOpen.find((a) => a.method_name === p.method_name)
                                   ?? (isCash && data.opening_cash_amount > 0
                                       ? { amount: data.opening_cash_amount } : undefined);
                  const closingAmt = isCash
                    ? data.closing_cash_counted
                    : payModeClose.find((a) => a.method_name === p.method_name)?.amount ?? null;
                  const expectedAmt = isCash ? data.expected_cash_amount : null;
                  const pmVar      = isCash
                    ? data.cash_variance
                    : closingAmt !== null ? closingAmt - p.total : null;
                  return (
                    <tr key={p.method_name} className={isCash ? 'bg-amber-50/30' : ''}>
                      <td className="px-4 py-3 font-medium text-gray-800">{p.method_name}</td>
                      {showOpenCol   && <td className="px-4 py-3 text-right text-gray-500">{open ? formatCurrency(open.amount) : '—'}</td>}
                      <td className="px-4 py-3 text-right text-green-700 font-medium">{formatCurrency(p.total)}</td>
                      {showReconCols && <td className="px-4 py-3 text-right text-gray-600">{expectedAmt !== null ? formatCurrency(expectedAmt) : '—'}</td>}
                      {showReconCols && <td className="px-4 py-3 text-right text-gray-700 font-medium">{closingAmt !== null ? formatCurrency(closingAmt) : '—'}</td>}
                      {showReconCols && (
                        <td className="px-4 py-3 text-right">
                          {pmVar !== null ? (
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                              Math.abs(pmVar) < 0.5 ? 'bg-green-100 text-green-700' :
                              pmVar > 0 ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'
                            }`}>
                              {Math.abs(pmVar) < 0.5 ? '✓' : pmVar > 0 ? `+${formatCurrency(pmVar)}` : formatCurrency(pmVar)}
                            </span>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                      )}
                      <td className="px-4 py-3 text-right text-gray-500">{p.count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>

            {/* Mobile cards */}
            <div className="sm:hidden divide-y divide-gray-50">
              {data.payment_breakdown.map((p) => {
                const isCash     = p.method_name === 'Cash';
                const open       = payModeOpen.find((a) => a.method_name === p.method_name)
                                 ?? (isCash && data.opening_cash_amount > 0
                                     ? { amount: data.opening_cash_amount } : undefined);
                const closingAmt = isCash
                  ? data.closing_cash_counted
                  : payModeClose.find((a) => a.method_name === p.method_name)?.amount ?? null;
                const expectedAmt = isCash ? data.expected_cash_amount : null;
                const pmVar      = isCash
                  ? data.cash_variance
                  : closingAmt !== null ? closingAmt - p.total : null;
                return (
                  <div key={p.method_name} className={`p-3 ${isCash ? 'bg-amber-50/30' : ''}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-gray-800 text-sm">{p.method_name}</span>
                      <span className="text-green-700 font-medium text-sm">{formatCurrency(p.total)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                      {showOpenCol && <span>Opening: {open ? formatCurrency(open.amount) : '—'}</span>}
                      {showReconCols && <span>Expected: {expectedAmt !== null ? formatCurrency(expectedAmt) : '—'}</span>}
                      {showReconCols && <span>Closing: {closingAmt !== null ? formatCurrency(closingAmt) : '—'}</span>}
                      <span>{p.count} txn{p.count !== 1 ? 's' : ''}</span>
                      {showReconCols && (
                        pmVar !== null ? (
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                            Math.abs(pmVar) < 0.5 ? 'bg-green-100 text-green-700' :
                            pmVar > 0 ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'
                          }`}>
                            {Math.abs(pmVar) < 0.5 ? '✓ Balanced' : pmVar > 0 ? `+${formatCurrency(pmVar)}` : formatCurrency(pmVar)}
                          </span>
                        ) : null
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Correction notice */}
      {data.corrected_at && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800 flex items-start gap-2">
          <Edit2 className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <div>
            <span className="font-semibold">Values corrected</span>
            {data.corrected_by_name && <span> by {data.corrected_by_name}</span>}
            {data.corrected_at && <span> on {formatDateTime(data.corrected_at)}</span>}
            {data.correction_reason && <div className="mt-0.5 text-amber-700">{data.correction_reason}</div>}
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
        {!data.transactions?.length ? (
          <div className="rounded-xl border border-gray-100 py-6 text-center text-gray-400 text-xs">No transactions in this shift</div>
        ) : (
          <div className="max-h-56 overflow-y-auto rounded-xl border border-gray-100">
            {/* Desktop table — every column always visible */}
            <div className="hidden sm:block">
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
                {data.transactions.map((t) => (
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
              </tbody>
            </table>
            </div>

            {/* Mobile cards */}
            <div className="sm:hidden divide-y divide-gray-50">
              {data.transactions.map((t) => (
                <div key={t.transaction_id} className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-primary-600 font-semibold">{t.transaction_number}</p>
                      <p className="text-xs text-gray-500">{formatDateTime(t.transaction_date)}</p>
                    </div>
                    <span className="font-semibold text-gray-900 text-sm shrink-0">{formatCurrency(t.total_amount)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                    <span className="text-gray-700">{t.customer_name}</span>
                    <span>{t.payment_methods}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[t.status] ?? 'bg-gray-100 text-gray-500'}`}>
                      {t.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer actions */}
      {(data.status === 'open' || canCorrect) && (
        <div className="border-t border-gray-100 pt-4 flex flex-col gap-2">
          {data.status === 'open' && (
            <Button
              variant="secondary" fullWidth
              icon={<XCircle className="h-4 w-4 text-red-500" />}
              onClick={() => setForceClose(true)}
            >
              Force Close Shift
            </Button>
          )}
          {canCorrect && (
            <Button
              variant="secondary" fullWidth
              icon={<Edit2 className="h-4 w-4 text-amber-500" />}
              onClick={() => setCorrecting(true)}
            >
              Correct Values
            </Button>
          )}
        </div>
      )}

      {correcting && (
        <Modal open title="Correct Shift Values" onClose={() => setCorrecting(false)} size="sm">
          <CorrectSessionModal
            sessionId={sessionId}
            session={data}
            onClose={() => setCorrecting(false)}
            onSaved={() => setCorrecting(false)}
          />
        </Modal>
      )}

      {forceClose && (
        <Modal open title="Force Close Shift" onClose={() => setForceClose(false)} size="sm">
          <ForceCloseConfirm
            sessionId={sessionId}
            onClose={() => setForceClose(false)}
            onDone={() => setForceClose(false)}
          />
        </Modal>
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

// ── Correct Session Modal ─────────────────────────────────────────────────────

function CorrectSessionModal({ sessionId, session, onClose, onSaved }) {
  const isOpen    = session.status === 'open';
  const breakdown = session.payment_breakdown ?? [];
  const payModeOpen  = (session.pay_mode_amounts ?? []).filter((a) => a.count_type === 'opening');
  const payModeClose = (session.pay_mode_amounts ?? []).filter((a) => a.count_type === 'closing');
  const qc        = useQueryClient();

  // Editable non-cash methods: union of methods with completed sales this shift
  // and methods with a recorded opening/closing float — a method with float but
  // no sales yet (e.g. a freshly opened shift) must still be correctable.
  const nonCashMethods = (() => {
    const map = new Map();
    breakdown.forEach((pm) => {
      if (pm.method_name !== 'Cash') map.set(pm.payment_method_id, pm.method_name);
    });
    [...payModeOpen, ...payModeClose].forEach((pm) => {
      if (pm.method_name !== 'Cash' && pm.payment_method_id && !map.has(pm.payment_method_id)) {
        map.set(pm.payment_method_id, pm.method_name);
      }
    });
    return Array.from(map, ([payment_method_id, method_name]) => ({ payment_method_id, method_name }));
  })();

  // Cash is always editable — it's tracked on the session row itself, not derived from sales.
  const [cashOpening, setCashOpening] = useState(String(session.opening_cash_amount ?? ''));

  // Non-cash opening amounts keyed by payment_method_id.
  const [openings, setOpenings] = useState(() => {
    const result = {};
    nonCashMethods.forEach((pm) => {
      const existing = payModeOpen.find((a) => a.payment_method_id === pm.payment_method_id);
      result[pm.payment_method_id] = String(existing?.amount ?? '');
    });
    return result;
  });

  // Non-cash closing amounts keyed by payment_method_id (only relevant on closed shifts).
  const [closings, setClosings] = useState(() => {
    const result = {};
    nonCashMethods.forEach((pm) => {
      const existing = payModeClose.find((a) => a.payment_method_id === pm.payment_method_id);
      result[pm.payment_method_id] = String(existing?.amount ?? '');
    });
    return result;
  });

  const [closing,  setClosing]  = useState(String(session.closing_cash_counted ?? ''));
  const [reason,   setReason]   = useState('');
  const [workDate, setWorkDate] = useState(
    session.session_start ? session.session_start.slice(0, 10) : ''
  );

  const { mutate, isPending } = useMutation({
    mutationFn: (body) => api.patch(`/pos/sessions/${sessionId}/correct`, body),
    onSuccess: () => {
      toast.success('Shift corrected');
      qc.invalidateQueries({ queryKey: ['sessions'] });
      qc.invalidateQueries({ queryKey: ['session-detail', sessionId] });
      onSaved();
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed to save correction'),
  });

  const handleSave = () => {
    const body = { correctionReason: reason };

    // Cash opening (stored on pos_sessions.opening_cash_amount)
    if (cashOpening !== '') {
      body.openingCashAmount = parseFloat(cashOpening) || 0;
    }

    // Non-cash openings (stored in session_pay_mode_amounts)
    const nonCash = nonCashMethods
      .filter((p) => openings[p.payment_method_id] !== '')
      .map((p) => ({ paymentMethodId: p.payment_method_id, amount: parseFloat(openings[p.payment_method_id]) || 0 }));
    if (nonCash.length) body.openingPayModeAmounts = nonCash;

    if (!isOpen && closing !== '') body.closingCashCounted = parseFloat(closing) || 0;

    // Non-cash closings (stored in session_pay_mode_amounts) — only on closed shifts
    if (!isOpen) {
      const nonCashClosing = nonCashMethods
        .filter((p) => closings[p.payment_method_id] !== '')
        .map((p) => ({ paymentMethodId: p.payment_method_id, amount: parseFloat(closings[p.payment_method_id]) || 0 }));
      if (nonCashClosing.length) body.closingPayModeAmounts = nonCashClosing;
    }

    const originalDate = session.session_start ? session.session_start.slice(0, 10) : '';
    if (workDate && workDate !== originalDate) body.workDate = workDate;

    mutate(body);
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Only change the values that are wrong. Variance will be recalculated automatically.
      </p>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Work Date</label>
        <input
          type="date"
          value={workDate}
          max={todayLocal()}
          onChange={(e) => setWorkDate(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
        />
        <p className="mt-0.5 text-xs text-gray-400">Change only if the shift was opened on the wrong calendar date.</p>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-2">Opening Float by Method</label>
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600 w-24 flex-shrink-0 truncate">Cash</span>
            <input
              type="number" step="0.01" min="0"
              value={cashOpening}
              onChange={(e) => setCashOpening(e.target.value)}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
            />
          </div>
          {nonCashMethods.map((pm) => (
            <div key={pm.payment_method_id} className="flex items-center gap-3">
              <span className="text-sm text-gray-600 w-24 flex-shrink-0 truncate">{pm.method_name}</span>
              <input
                type="number" step="0.01" min="0"
                value={openings[pm.payment_method_id] ?? ''}
                onChange={(e) =>
                  setOpenings((prev) => ({ ...prev, [pm.payment_method_id]: e.target.value }))
                }
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
              />
            </div>
          ))}
        </div>
      </div>

      {!isOpen && (
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-2">Closing Count by Method</label>
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600 w-24 flex-shrink-0 truncate">Cash</span>
              <input
                type="number" step="0.01" min="0"
                value={closing} onChange={(e) => setClosing(e.target.value)}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
              />
            </div>
            {nonCashMethods.map((pm) => (
              <div key={pm.payment_method_id} className="flex items-center gap-3">
                <span className="text-sm text-gray-600 w-24 flex-shrink-0 truncate">{pm.method_name}</span>
                <input
                  type="number" step="0.01" min="0"
                  value={closings[pm.payment_method_id] ?? ''}
                  onChange={(e) =>
                    setClosings((prev) => ({ ...prev, [pm.payment_method_id]: e.target.value }))
                  }
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Reason <span className="text-red-500">*</span></label>
        <textarea
          rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="Why are these values being corrected?"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none resize-none"
        />
      </div>

      <div className="flex gap-3">
        <Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button>
        <Button fullWidth loading={isPending} disabled={!reason.trim()} onClick={handleSave}>
          Save Correction
        </Button>
      </div>
    </div>
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
  const navigate     = useNavigate();
  const [startDate,  setStartDate]  = useState('');
  const [endDate,    setEndDate]    = useState('');
  const [status,     setStatus]     = useState('');
  const [page,       setPage]       = useState(1);

  const filters = { startDate, endDate, status, page, limit: 20 };

  const { data, isLoading, refetch, isFetching } = useQuery({
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
        <Button variant="secondary" size="sm"
          icon={<RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />}
          onClick={() => refetch()}>
          Refresh
        </Button>
      </div>

      {/* ── Shift list ── */}
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          {isLoading ? <PageSpinner /> : sessions.length === 0 ? (
            <div className="py-12 text-center text-gray-400">
              <Clock className="mx-auto mb-2 h-8 w-8 opacity-30" />
              No shifts found
            </div>
          ) : (
            <>
            {/* Desktop table — every column always visible */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Date / Time</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Terminal</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Cashier</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">Sales</th>
                    <th className="px-4 py-3 text-center font-medium text-gray-600">Txns</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">Variance</th>
                    <th className="px-4 py-3 text-center font-medium text-gray-600">Status</th>
                    <th className="px-4 py-3 text-center font-medium text-gray-600">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {sessions.map((s) => {
                    const variance = s.cash_variance ?? 0;
                    return (
                      <tr
                        key={s.session_id}
                        onClick={() => navigate(`/app/shifts/${s.session_id}`)}
                        className="cursor-pointer transition-colors hover:bg-gray-50"
                      >
                        <td className="px-4 py-3">
                          <p className="text-gray-900 font-medium text-xs">{formatDate(s.session_start)}</p>
                          <p className="text-[11px] text-gray-400">{formatDateTime(s.session_start)}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-gray-800 font-medium text-xs">{s.terminal_name}</p>
                          <p className="text-[11px] text-gray-400">{s.branch_name}</p>
                        </td>
                        <td className="px-4 py-3 text-gray-700 text-xs">{s.cashier_name}</td>
                        <td className="px-4 py-3 text-right font-semibold text-gray-900 text-xs">{formatCurrency(s.total_sales)}</td>
                        <td className="px-4 py-3 text-center text-gray-600 text-xs">{s.txn_count}</td>
                        <td className="px-4 py-3 text-right text-xs">
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
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[s.status] ?? 'bg-gray-100 text-gray-600'}`}>
                            {STATUS_ICONS[s.status]}{s.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => navigate(`/app/shifts/${s.session_id}`)}
                            className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-100 transition-colors">
                            View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="sm:hidden space-y-2 p-3">
              {sessions.map((s) => {
                const variance = s.cash_variance ?? 0;
                return (
                  <div key={s.session_id}
                    onClick={() => navigate(`/app/shifts/${s.session_id}`)}
                    className="rounded-xl border border-gray-100 bg-white p-3 transition-colors active:bg-gray-50"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-gray-900 font-medium text-xs">{formatDate(s.session_start)}</p>
                        <p className="text-[11px] text-gray-400">{formatDateTime(s.session_start)}</p>
                      </div>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[s.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_ICONS[s.status]}{s.status}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                      <span className="text-gray-800 font-medium">{s.terminal_name}</span>
                      <span className="text-gray-400">{s.branch_name}</span>
                      <span className="text-gray-600">{s.cashier_name}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs">
                      <span className="font-semibold text-gray-900">{formatCurrency(s.total_sales)}</span>
                      <span className="text-gray-500">{s.txn_count} txn{s.txn_count !== 1 ? 's' : ''}</span>
                      {s.status !== 'open' && (
                        <span className={
                          Math.abs(variance) < 0.5 ? 'text-green-600 font-medium'
                          : variance > 0 ? 'text-blue-600 font-medium'
                          : 'text-red-600 font-medium'
                        }>
                          {variance >= 0 ? '+' : ''}{formatCurrency(variance)}
                        </span>
                      )}
                    </div>
                    <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => navigate(`/app/shifts/${s.session_id}`)}
                        className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-100 transition-colors">
                        View
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            </>
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
    </div>
  );
}
