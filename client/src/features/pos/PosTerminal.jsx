import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MonitorDot, Monitor, X, CheckCircle, BarChart3, BookmarkCheck, CloudOff, Wifi, WifiOff, LogOut, TrendingUp, Wallet, Receipt, Menu, ChevronDown, Printer, Search, ArrowDownLeft, ArrowLeftRight, UserCog, CreditCard } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/services/api';
import { useAuthStore, useCartStore, usePosDataStore } from '@/app/store';
import { formatCurrency, formatDateTime } from '@/utils/formatters';
import ProductGrid        from './ProductGrid';
import Cart, { CreditPaymentModal } from './Cart';
import PaymentModal       from './PaymentModal';
import HoldModal          from './HoldModal';
import OfflineQueueModal  from './OfflineQueueModal';
import SalesReturnModal   from './SalesReturnModal';
import Button             from '@/components/ui/Button';
import { PageSpinner }    from '@/components/ui/Spinner';
import useNetworkStatus   from '@/hooks/useNetworkStatus';
import ReceiptModal       from '@/components/ui/ReceiptModal';

// ── Session sales drill-down modal ───────────────────────────────────────────
const TXN_METHOD_COLORS = {
  cash: 'bg-amber-100 text-amber-700', mpesa: 'bg-green-100 text-green-700',
  card: 'bg-blue-100 text-blue-700',   mobile: 'bg-green-100 text-green-700',
};
function txnMethodColor(name = '') {
  const l = name.toLowerCase();
  if (l.includes('cash'))  return TXN_METHOD_COLORS.cash;
  if (l.includes('mpesa') || l.includes('m-pesa')) return TXN_METHOD_COLORS.mpesa;
  if (l.includes('card'))  return TXN_METHOD_COLORS.card;
  return 'bg-gray-100 text-gray-600';
}

function SessionSalesModal({ session, onClose }) {
  const [reprintId, setReprintId] = useState(null);
  const [search,    setSearch]    = useState('');

  const { data: txns = [], isFetching } = useQuery({
    queryKey: ['session-txns-drill', session?.session_id],
    queryFn:  () =>
      api.get('/sales/transactions', { params: { sessionId: session.session_id, limit: 200 } })
         .then((r) => r.data.data?.transactions ?? r.data.data ?? []),
    enabled: !!session?.session_id,
    refetchInterval: 20_000,
  });

  const { data: reprintDetail } = useQuery({
    queryKey: ['receipt-drill', reprintId],
    queryFn:  () => api.get(`/sales/transactions/${reprintId}`).then((r) => r.data.data),
    enabled:  !!reprintId,
    staleTime: Infinity,
  });

  const salesTotal = txns
    .filter((t) => t.status !== 'voided' && !t.is_refund)
    .reduce((s, t) => s + parseFloat(t.total_amount || 0), 0);

  const q = search.trim().toLowerCase();
  const filtered = [...txns].reverse().filter((t) => {
    if (!q) return true;
    const txnNum  = (t.transaction_number || t.receipt_number || '').toLowerCase();
    const cust    = (t.customer_name || '').toLowerCase();
    const amt     = String(parseFloat(t.total_amount || 0));
    return txnNum.includes(q) || cust.includes(q) || amt.includes(q);
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/30" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-gray-900">Session Sales</h2>
            <p className="text-xs text-gray-400">
              {session?.terminal_name} · {txns.length} transactions · {formatCurrency(salesTotal)}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search bar */}
        <div className="border-b border-gray-100 px-3 py-2 flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search by TXN, customer, amount…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-8 pr-8 text-xs focus:border-primary-400 focus:bg-white focus:outline-none transition-all"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {isFetching && txns.length === 0 && (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex animate-pulse items-center gap-3 rounded-xl border border-gray-100 px-3 py-3">
                  <div className="h-8 w-8 rounded-full bg-gray-100 flex-shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-1/2 rounded bg-gray-100" />
                    <div className="h-2.5 w-2/3 rounded bg-gray-100" />
                  </div>
                  <div className="h-4 w-16 rounded bg-gray-100" />
                </div>
              ))}
            </div>
          )}
          {!isFetching && txns.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Receipt className="h-10 w-10 text-gray-200" />
              <p className="text-sm text-gray-400">No transactions yet this session</p>
            </div>
          )}
          {!isFetching && txns.length > 0 && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <Search className="h-8 w-8 text-gray-200" />
              <p className="text-sm text-gray-400">No results for "{search}"</p>
            </div>
          )}
          {filtered.map((txn) => {
            const isVoid   = txn.status === 'voided' || txn.status === 'void';
            const isRefund = txn.status === 'refunded' || txn.is_refund;
            const rawDate  = txn.transaction_date || txn.created_at;
            const d        = rawDate ? new Date(rawDate) : null;
            const time     = d && !isNaN(d) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
            const dateStr  = d && !isNaN(d) ? d.toLocaleDateString('en-KE', { day: '2-digit', month: 'short' }) : '—';
            const methods  = txn.payment_methods ?? txn.payments ?? [];
            return (
              <div key={txn.transaction_id}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${isVoid ? 'opacity-50 border-gray-100' : 'border-gray-100 hover:border-gray-200'}`}
              >
                <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  isVoid ? 'bg-gray-100 text-gray-400' : isRefund ? 'bg-amber-100 text-amber-600' : 'bg-green-100 text-green-700'
                }`}>
                  {isVoid ? '✕' : isRefund ? '↩' : '✓'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-semibold text-gray-800 font-mono truncate">
                      {txn.transaction_number || txn.receipt_number || `#${txn.transaction_id}`}
                    </p>
                    {isVoid   && <span className="rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">Void</span>}
                    {isRefund && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">Return</span>}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <span className="text-[11px] text-gray-400">{dateStr} {time}</span>
                    {txn.customer_name && txn.customer_name !== 'Walk-in' && (
                      <span className="text-[11px] text-gray-500 truncate">· {txn.customer_name}</span>
                    )}
                    {methods.slice(0, 2).map((m, i) => (
                      <span key={i} className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${txnMethodColor(m.method_name || m.payment_method_name || '')}`}>
                        {m.method_name || m.payment_method_name || 'Pay'}
                      </span>
                    ))}
                  </div>
                </div>
                <p className={`flex-shrink-0 text-sm font-bold ${isVoid ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                  {formatCurrency(txn.total_amount)}
                </p>
                <button
                  onClick={() => setReprintId(txn.transaction_id)}
                  className="flex-shrink-0 rounded-lg p-1.5 text-gray-300 hover:bg-primary-50 hover:text-primary-600 transition-colors"
                  title="Reprint receipt"
                >
                  <Printer className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <ReceiptModal
        open={!!reprintId}
        onClose={() => setReprintId(null)}
        txn={reprintDetail}
      />
    </div>
  );
}

// ── Session bar Menu dropdown ─────────────────────────────────────────────────
function MenuAction({ icon: Icon, iconBg, label, sub, badge, kbd: shortcut, danger, onClick }) {
  return (
    <button
      onClick={onClick}
      className={[
        'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors',
        danger ? 'hover:bg-red-50' : 'hover:bg-gray-50',
      ].join(' ')}
    >
      <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl ${iconBg}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${danger ? 'text-red-600' : 'text-gray-800'}`}>{label}</p>
        {sub && <p className="text-[11px] text-gray-400 truncate">{sub}</p>}
      </div>
      {badge > 0 && (
        <span className={`flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold ${
          danger ? 'bg-red-100 text-red-700' : 'bg-primary-100 text-primary-700'
        }`}>
          {badge}
        </span>
      )}
      {shortcut && (
        <kbd className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-mono text-gray-500">{shortcut}</kbd>
      )}
    </button>
  );
}

// ── Open Session Screen ───────────────────────────────────────────────────────
function OpenSessionScreen({ branchId, onSessionOpened }) {
  const [terminalId,    setTerminalId]    = useState('');
  const [openingAmount, setOpeningAmount] = useState('');
  const [notes,         setNotes]         = useState('');
  const [pmAmounts,     setPmAmounts]     = useState({});
  // Stuck session recovery state
  const [stuckSession,    setStuckSession]    = useState(null); // { sessionId, sessionStart, cashierName }
  const [showTakeover,    setShowTakeover]    = useState(false);
  const [takeoverCash,    setTakeoverCash]    = useState('');
  const [takeoverNotes,   setTakeoverNotes]   = useState('');

  const { data: terminals = [], isPending: terminalsLoading } = useQuery({
    queryKey: ['pos-terminals', branchId],
    queryFn:  () => api.get('/pos/terminals', { params: { branchId } }).then((r) => r.data.data),
    enabled:  !!branchId,
  });

  const { data: payMethods = [] } = useQuery({
    queryKey: ['payment-methods'],
    queryFn:  () => api.get('/pos/payment-methods').then((r) => r.data.data),
  });

  const nonCashMethods = payMethods.filter((m) => m.method_name !== 'Cash');

  useEffect(() => {
    if (terminals.length && !terminalId) setTerminalId(String(terminals[0].terminal_id));
  }, [terminals, terminalId]);

  // Clear stuck-session banner when the user picks a different terminal
  useEffect(() => { setStuckSession(null); setShowTakeover(false); setTakeoverCash(''); setTakeoverNotes(''); }, [terminalId]);

  const { mutate: open, isPending } = useMutation({
    mutationFn: (data) => api.post('/pos/sessions', data),
    onSuccess:  (res)  => {
      toast.success('Session opened!');
      setStuckSession(null);
      onSessionOpened(res.data.data);
    },
    onError: (err) => {
      const resp = err.response?.data;
      if (resp?.code === 'SESSION_ALREADY_OPEN' && resp?.data?.sessionId) {
        // Surface the stuck session so the user can take over
        setStuckSession(resp.data);
      } else {
        toast.error(resp?.message || 'Could not open session');
      }
    },
  });

  if (terminalsLoading) return <PageSpinner />;

  const payModeAmounts = nonCashMethods
    .filter((m) => parseFloat(pmAmounts[m.payment_method_id]) > 0)
    .map((m) => ({ paymentMethodId: m.payment_method_id, amount: parseFloat(pmAmounts[m.payment_method_id]) }));

  const doOpen = (forceClose = false, extra = {}) => open({
    branchId,
    terminalId,
    openingCashAmount: parseFloat(openingAmount) || 0,
    openingNotes: notes || null,
    payModeAmounts,
    forceClose,
    ...extra,
  });

  const confirmTakeover = () => doOpen(true, {
    takeoverCashCounted: parseFloat(takeoverCash) || 0,
    takeoverNotes: takeoverNotes || null,
  });

  return (
    <div className="flex h-full items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-8 shadow-lg">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-100">
            <Monitor className="h-7 w-7 text-primary-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900">Open POS Session</h2>
          <p className="mt-1 text-sm text-gray-500">Select a terminal and count your opening float</p>
        </div>

        {/* Stuck session recovery banner */}
        {stuckSession && !showTakeover && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2">
            <div className="flex items-start gap-2">
              <span className="text-amber-500 text-lg leading-none">⚠</span>
              <div>
                <p className="text-sm font-semibold text-amber-800">Terminal has an open session</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  {stuckSession.cashierName ? `Opened by ${stuckSession.cashierName}` : 'Unknown cashier'}
                  {stuckSession.sessionStart ? ` · ${new Date(stuckSession.sessionStart).toLocaleString()}` : ''}
                </p>
              </div>
            </div>
            <Button
              fullWidth
              className="!bg-amber-600 hover:!bg-amber-700 !text-white"
              onClick={() => setShowTakeover(true)}
            >
              Take Over Terminal
            </Button>
          </div>
        )}

        {/* Takeover cash count form */}
        {stuckSession && showTakeover && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
            <div>
              <p className="text-sm font-semibold text-amber-800">Close {stuckSession.cashierName ?? 'previous'}'s session</p>
              <p className="text-xs text-amber-700 mt-0.5">Count the cash in the drawer to close their shift before you start yours.</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-amber-800">Cash in drawer now</label>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={takeoverCash}
                onChange={(e) => setTakeoverCash(e.target.value)}
                className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-amber-800">Notes (optional)</label>
              <textarea
                rows={2}
                placeholder="e.g. Taking over from morning shift"
                value={takeoverNotes}
                onChange={(e) => setTakeoverNotes(e.target.value)}
                className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowTakeover(false)}
                className="flex-1 rounded-lg border border-amber-300 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100"
              >
                Back
              </button>
              <Button
                loading={isPending}
                className="flex-1 !bg-amber-600 hover:!bg-amber-700 !text-white"
                onClick={confirmTakeover}
              >
                Confirm Takeover
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Terminal</label>
            <select
              value={terminalId}
              onChange={(e) => setTerminalId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              <option value="">Select terminal…</option>
              {terminals.map((t) => (
                <option key={t.terminal_id} value={t.terminal_id}>
                  {t.terminal_name} ({t.terminal_code})
                </option>
              ))}
            </select>
          </div>

          {/* Opening amounts per pay mode */}
          <div className="rounded-xl border border-gray-100 overflow-hidden">
            <div className="bg-gray-50 px-4 py-2 border-b border-gray-100">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Opening Amounts</p>
            </div>
            <div className="divide-y divide-gray-50">
              {/* Cash always first */}
              <div className="flex items-center justify-between px-4 py-3">
                <label className="text-sm font-medium text-gray-800">Cash Float</label>
                <input
                  type="number" step="0.01" min="0"
                  value={openingAmount}
                  onChange={(e) => setOpeningAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-32 rounded-lg border border-gray-300 px-2 py-1.5 text-right text-sm font-semibold focus:border-primary-500 focus:outline-none"
                />
              </div>
              {/* Non-cash methods */}
              {nonCashMethods.map((m) => (
                <div key={m.payment_method_id} className="flex items-center justify-between px-4 py-3">
                  <label className="text-sm font-medium text-gray-800">{m.method_name}</label>
                  <input
                    type="number" step="0.01" min="0"
                    value={pmAmounts[m.payment_method_id] ?? ''}
                    onChange={(e) => setPmAmounts((prev) => ({ ...prev, [m.payment_method_id]: e.target.value }))}
                    placeholder="0.00"
                    className="w-32 rounded-lg border border-gray-300 px-2 py-1.5 text-right text-sm font-semibold focus:border-primary-500 focus:outline-none"
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Any opening notes…"
              className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>

          <Button
            fullWidth size="lg" loading={isPending}
            disabled={!terminalId}
            onClick={() => doOpen(false)}
          >
            Open Session
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Shift Summary Modal ───────────────────────────────────────────────────────
function ShiftSummaryModal({ session, onClose }) {
  const { data: summary, isLoading, isError } = useQuery({
    queryKey: ['session-summary', session.session_id],
    queryFn:  () => api.get(`/pos/sessions/${session.session_id}/summary`).then((r) => r.data.data),
    refetchInterval: 30_000,
  });

  const openingFloat = parseFloat(session.opening_cash_amount) || 0;
  const breakdown    = summary?.payment_breakdown ?? [];
  const cashMethod   = breakdown.find((p) => p.method_name === 'Cash');
  const cashSales    = parseFloat(cashMethod?.total) || 0;
  const expectedCash = openingFloat + cashSales;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Shift Summary</h2>
            <p className="text-sm text-gray-500">{session.terminal_name}</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {isLoading ? (
            <div className="py-8 text-center text-sm text-gray-400">Loading…</div>
          ) : isError ? (
            <div className="py-8 text-center text-sm text-red-500">Could not load shift summary. Please try again.</div>
          ) : (
            <>
              {/* Quick stats */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl bg-primary-50 p-3 text-center">
                  <p className="text-xs text-gray-500">Transactions</p>
                  <p className="text-2xl font-bold text-primary-700">{summary?.txn_count ?? 0}</p>
                </div>
                <div className="rounded-xl bg-green-50 p-3 text-center">
                  <p className="text-xs text-gray-500">Total Sales</p>
                  <p className="text-lg font-bold text-green-700">{formatCurrency(summary?.total_sales ?? 0)}</p>
                </div>
                <div className="rounded-xl bg-secondary-50 p-3 text-center">
                  <p className="text-xs text-gray-500">Opening Float</p>
                  <p className="text-lg font-bold text-secondary-700">{formatCurrency(openingFloat)}</p>
                </div>
              </div>

              {/* Per-payment-method breakdown */}
              <div>
                <h3 className="mb-2 text-sm font-semibold text-gray-700">Payment Method Breakdown</h3>
                <div className="rounded-xl border border-gray-100 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100">
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Method</th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Opening</th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Sales</th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Expected Total</th>
                        <th className="px-4 py-2.5 text-center text-xs font-medium text-gray-500">Txns</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {/* Cash row */}
                      <tr className="bg-amber-50/40">
                        <td className="px-4 py-3 font-medium text-gray-800">Cash</td>
                        <td className="px-4 py-3 text-right text-gray-600">{formatCurrency(openingFloat)}</td>
                        <td className="px-4 py-3 text-right text-green-700 font-medium">{formatCurrency(cashSales)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-gray-900">{formatCurrency(expectedCash)}</td>
                        <td className="px-4 py-3 text-center text-gray-500">{cashMethod?.count ?? 0}</td>
                      </tr>
                      {/* Other methods */}
                      {breakdown.filter((p) => p.method_name !== 'Cash').map((p) => (
                        <tr key={p.method_name}>
                          <td className="px-4 py-3 font-medium text-gray-800">{p.method_name}</td>
                          <td className="px-4 py-3 text-right text-gray-400">—</td>
                          <td className="px-4 py-3 text-right text-green-700 font-medium">{formatCurrency(p.total)}</td>
                          <td className="px-4 py-3 text-right font-semibold text-gray-900">{formatCurrency(p.total)}</td>
                          <td className="px-4 py-3 text-center text-gray-500">{p.count}</td>
                        </tr>
                      ))}
                      {/* Total row */}
                      <tr className="border-t border-gray-200 bg-gray-50">
                        <td className="px-4 py-3 font-semibold text-gray-900">Total</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-700">{formatCurrency(openingFloat)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-green-700">{formatCurrency(summary?.total_sales ?? 0)}</td>
                        <td className="px-4 py-3 text-right font-bold text-gray-900">{formatCurrency(openingFloat + (summary?.total_sales ?? 0))}</td>
                        <td className="px-4 py-3 text-center font-semibold text-gray-700">{summary?.txn_count ?? 0}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="border-t border-gray-100 px-6 py-4">
          <Button variant="secondary" fullWidth onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}

// ── Cash-out modal ────────────────────────────────────────────────────────────
const OUT_TYPES = [
  { value: 'withdrawal',   label: 'Cash Withdrawal',  hint: 'Owner / manager takes cash from drawer' },
  { value: 'expense',      label: 'Expense Payment',  hint: 'Pay an operational expense (cleaning, supplies…)' },
  { value: 'stock_payment',label: 'Stock Payment',    hint: 'Pay a supplier for goods received' },
];

function CashOutModal({ session, methods, onClose }) {
  const qc = useQueryClient();
  const hasFinance = useAuthStore((s) => s.user?.planFeatures?.hasFinance);

  const [outType,         setOutType]         = useState('expense');
  const [amount,          setAmount]          = useState('');
  const [notes,           setNotes]           = useState('');
  const [accountId,       setAccountId]       = useState('');
  const [supplierId,      setSupplierId]      = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState(
    methods.find((m) => /cash/i.test(m.method_name))?.payment_method_id ?? ''
  );

  const { data: accounts = [] } = useQuery({
    queryKey: ['pos-expense-accounts'],
    queryFn:  () => api.get('/pos/expense-accounts').then((r) => r.data.data),
    enabled:  !!hasFinance,
    staleTime: 5 * 60 * 1000,
  });

  const { data: suppliersRaw } = useQuery({
    queryKey: ['suppliers'],
    queryFn:  () => api.get('/suppliers?limit=200').then((r) => r.data.data ?? r.data),
    enabled:  outType === 'stock_payment',
    staleTime: 5 * 60 * 1000,
  });
  const suppliers = Array.isArray(suppliersRaw) ? suppliersRaw : (suppliersRaw?.suppliers ?? []);

  const { mutate, isPending } = useMutation({
    mutationFn: (body) => api.post(`/pos/sessions/${session.session_id}/cash-outs`, body),
    onSuccess: () => {
      toast.success('Cash out recorded');
      qc.invalidateQueries({ queryKey: ['session-summary', session.session_id] });
      onClose();
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed to record cash out'),
  });

  const amt = parseFloat(amount);
  const canSubmit = amount !== '' && !isNaN(amt) && amt > 0;

  const handleSubmit = () => {
    mutate({
      out_type:          outType,
      amount:            amt,
      notes:             notes || undefined,
      payment_method_id: paymentMethodId || undefined,
      account_id:        (hasFinance && accountId)  ? accountId  : undefined,
      supplier_id:       (hasFinance && supplierId) ? supplierId : undefined,
    });
  };

  const inpCls = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
        <div className="border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-900">Cash Out</h2>
            <p className="text-xs text-gray-500">{session.terminal_name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-4 p-6">
          {/* Type selector */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-700">Type *</label>
            <div className="space-y-1.5">
              {OUT_TYPES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setOutType(t.value)}
                  className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    outType === t.value
                      ? 'border-primary-400 bg-primary-50'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <p className={`text-sm font-medium ${outType === t.value ? 'text-primary-800' : 'text-gray-800'}`}>{t.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{t.hint}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Amount */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Amount *</label>
            <input type="number" min="0.01" step="0.01" value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00" className={inpCls} />
          </div>

          {/* Payment mode */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Paid from *</label>
            <div className="flex flex-wrap gap-2">
              {methods.map((m) => (
                <button
                  key={m.payment_method_id}
                  onClick={() => setPaymentMethodId(m.payment_method_id)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    paymentMethodId === m.payment_method_id
                      ? 'border-primary-400 bg-primary-50 text-primary-800'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {m.method_name}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-gray-400">Select which payment mode the funds are drawn from.</p>
          </div>

          {/* Finance: account selector */}
          {hasFinance && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                GL Account {outType === 'withdrawal' ? '(optional)' : '*'}
              </label>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={`${inpCls} bg-white`}>
                <option value="">— Select account —</option>
                {accounts
                  .filter((a) => outType === 'withdrawal' ? a.account_type !== 'liability' : true)
                  .map((a) => (
                    <option key={a.account_id} value={a.account_id}>
                      {a.account_code} — {a.account_name}
                    </option>
                  ))}
              </select>
              <p className="mt-1 text-xs text-gray-400">
                A journal entry (DR account / CR selected payment mode) will be auto-posted.
              </p>
            </div>
          )}

          {/* Stock payment: supplier */}
          {outType === 'stock_payment' && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Supplier (optional)</label>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={`${inpCls} bg-white`}>
                <option value="">— Select supplier —</option>
                {suppliers.map((s) => (
                  <option key={s.supplier_id} value={s.supplier_id}>{s.supplier_name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Notes</label>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Brief description…"
              className={inpCls} />
          </div>
        </div>

        <div className="flex gap-3 border-t border-gray-100 px-6 py-4">
          <Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button>
          <Button fullWidth disabled={!canSubmit} loading={isPending} onClick={handleSubmit}>
            <ArrowDownLeft className="h-4 w-4 mr-1" />Record Cash Out
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Pay Mode Transfer Modal ───────────────────────────────────────────────────
const TRANSFER_TYPES = [
  {
    value:     'sweep',
    label:     'Sweep',
    hint:      'Move collected funds between modes — e.g. M-Pesa receipts swept to bank',
    fromLabel: 'Collected in',
    toLabel:   'Transfer to',
  },
  {
    value:     'float_topup',
    label:     'Float Top-up',
    hint:      'Load funds into another mode — e.g. cash moved to mobile wallet float',
    fromLabel: 'Take from',
    toLabel:   'Add to',
  },
  {
    value:     'correction',
    label:     'Payment Correction',
    hint:      'Fix a sale recorded with the wrong payment method',
    fromLabel: 'Was recorded as',
    toLabel:   'Correct to',
  },
];

function TransferModal({ session, methods, onClose }) {
  const qc = useQueryClient();

  const [transferType,   setTransferType]   = useState('sweep');
  const [fromMethodId,   setFromMethodId]   = useState(methods[0]?.payment_method_id ?? '');
  const [toMethodId,     setToMethodId]     = useState(methods[1]?.payment_method_id ?? '');
  const [amount,         setAmount]         = useState('');
  const [notes,          setNotes]          = useState('');
  const [referenceTxnId, setReferenceTxnId] = useState('');

  const typeInfo = TRANSFER_TYPES.find((t) => t.value === transferType);
  const amt = parseFloat(amount);
  const canSubmit = amount !== '' && !isNaN(amt) && amt > 0 && fromMethodId && toMethodId && fromMethodId !== toMethodId;

  const { mutate, isPending } = useMutation({
    mutationFn: (body) => api.post(`/pos/sessions/${session.session_id}/transfers`, body),
    onSuccess: () => {
      toast.success('Transfer recorded');
      qc.invalidateQueries({ queryKey: ['session-summary', session.session_id] });
      qc.invalidateQueries({ queryKey: ['session-transfers', session.session_id] });
      onClose();
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed to record transfer'),
  });

  const handleSubmit = () => mutate({
    transferType,
    fromMethodId,
    toMethodId,
    amount:         amt,
    notes:          notes || undefined,
    referenceTxnId: referenceTxnId.trim() || undefined,
  });

  const inpCls = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500';

  const MethodPicker = ({ label, value, onChange }) => (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-700">{label} *</label>
      <div className="flex flex-wrap gap-2">
        {methods.map((m) => (
          <button
            key={m.payment_method_id}
            onClick={() => onChange(m.payment_method_id)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              value === m.payment_method_id
                ? 'border-primary-400 bg-primary-50 text-primary-800'
                : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            {m.method_name}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl max-h-[90vh] flex flex-col">
        <div className="border-b border-gray-100 px-6 py-4 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-gray-900">Pay Mode Transfer</h2>
            <p className="text-xs text-gray-500">{session.terminal_name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>

        <div className="overflow-y-auto flex-1">
          <div className="space-y-4 p-6">
            {/* Type selector */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-700">Transfer Type *</label>
              <div className="space-y-1.5">
                {TRANSFER_TYPES.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setTransferType(t.value)}
                    className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      transferType === t.value
                        ? 'border-primary-400 bg-primary-50'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <p className={`text-sm font-medium ${transferType === t.value ? 'text-primary-800' : 'text-gray-800'}`}>{t.label}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{t.hint}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* From / To pickers */}
            <MethodPicker label={typeInfo.fromLabel} value={fromMethodId} onChange={setFromMethodId} />

            <div className="flex items-center gap-2 text-gray-400">
              <div className="flex-1 h-px bg-gray-100" />
              <ArrowLeftRight className="h-4 w-4" />
              <div className="flex-1 h-px bg-gray-100" />
            </div>

            <MethodPicker label={typeInfo.toLabel} value={toMethodId} onChange={setToMethodId} />

            {fromMethodId === toMethodId && fromMethodId && (
              <p className="text-xs text-red-500">From and To modes must be different.</p>
            )}

            {/* Amount */}
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Amount *</label>
              <input type="number" min="0.01" step="0.01" value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00" className={inpCls} />
            </div>

            {/* Correction: optional transaction reference */}
            {transferType === 'correction' && (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">Transaction ID <span className="text-gray-400">(optional)</span></label>
                <input type="text" value={referenceTxnId}
                  onChange={(e) => setReferenceTxnId(e.target.value)}
                  placeholder="Paste transaction ID to link this correction"
                  className={inpCls} />
                <p className="mt-1 text-xs text-gray-400">Find the ID in the shift summary or on the receipt.</p>
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Notes</label>
              <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="Brief description…"
                className={inpCls} />
            </div>
          </div>
        </div>

        <div className="flex gap-3 border-t border-gray-100 px-6 py-4 flex-shrink-0">
          <Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button>
          <Button fullWidth disabled={!canSubmit} loading={isPending} onClick={handleSubmit}>
            <ArrowLeftRight className="h-4 w-4 mr-1" />Record Transfer
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Close Session Modal ───────────────────────────────────────────────────────
function CloseSessionModal({ session, onClose, onClosed }) {
  const [closingAmount, setClosingAmount] = useState('');
  const [notes,         setNotes]         = useState('');
  const [pmClosing,     setPmClosing]     = useState({});

  const { data: summary } = useQuery({
    queryKey: ['session-summary', session.session_id],
    queryFn:  () => api.get(`/pos/sessions/${session.session_id}/summary`).then((r) => r.data.data),
  });

  const { mutate: close, isPending } = useMutation({
    mutationFn: (data) => api.patch(`/pos/sessions/${session.session_id}/close`, data),
    onSuccess: (res) => {
      const v = parseFloat(res.data.data.cash_variance);
      if (Math.abs(v) < 0.5) {
        toast.success('Session closed. Cash balanced!');
      } else {
        toast(
          v > 0
            ? `Session closed. Cash over by ${formatCurrency(v)}`
            : `Session closed. Cash short by ${formatCurrency(Math.abs(v))}`,
          { icon: v > 0 ? '💰' : '⚠️' }
        );
      }
      onClosed();
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Could not close session'),
  });

  const openingFloat      = parseFloat(session.opening_cash_amount) || 0;
  const breakdown         = summary?.payment_breakdown ?? [];
  const cashOuts          = summary?.cash_outs ?? [];
  const totalCashOuts     = summary?.total_cash_outs ?? 0;
  const cashOutsByMethod  = summary?.cash_outs_by_method ?? {};
  const cashMethod        = breakdown.find((p) => p.method_name === 'Cash');
  // Cash-outs with null payment_method_id (legacy) fall under '__cash__'
  const cashSpecificOuts  = (cashMethod ? (cashOutsByMethod[cashMethod.payment_method_id] || 0) : 0)
                          + (cashOutsByMethod['__cash__'] || 0);
  const cashSales         = parseFloat(cashMethod?.total) || 0;
  const expectedCash      = openingFloat + cashSales - cashSpecificOuts;
  const closingCounted    = parseFloat(closingAmount) || 0;
  const variance          = closingAmount !== '' ? closingCounted - expectedCash : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl">
        {/* Header */}
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 className="text-lg font-bold text-gray-900">Close Session</h2>
          <p className="text-sm text-gray-500">{session.terminal_name}</p>
        </div>

        <div className="max-h-[70vh] overflow-y-auto space-y-5 p-6">
          {/* Summary stats */}
          {summary && (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-gray-50 p-3 text-center">
                <p className="text-xs text-gray-500">Transactions</p>
                <p className="text-2xl font-bold text-gray-900">{summary.txn_count}</p>
              </div>
              <div className="rounded-xl bg-green-50 p-3 text-center">
                <p className="text-xs text-gray-500">Total Sales</p>
                <p className="text-xl font-bold text-green-700">{formatCurrency(summary.total_sales)}</p>
              </div>
              {summary.credit_sale_count > 0 && (
                <>
                  <div className="rounded-xl bg-orange-50 p-3 text-center">
                    <p className="text-xs text-orange-600">Credit Sales</p>
                    <p className="text-xl font-bold text-orange-700">{formatCurrency(summary.credit_sale_amount)}</p>
                    <p className="text-[10px] text-orange-500 mt-0.5">{summary.credit_sale_count} txn{summary.credit_sale_count !== 1 ? 's' : ''} — charged to account</p>
                  </div>
                  <div className="rounded-xl bg-blue-50 p-3 text-center">
                    <p className="text-xs text-blue-600">Cash Sales</p>
                    <p className="text-xl font-bold text-blue-700">{formatCurrency(summary.total_sales - summary.credit_sale_amount)}</p>
                    <p className="text-[10px] text-blue-500 mt-0.5">Paid at counter</p>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Per-payment-method closing table */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-gray-700">Balance by Payment Method</h3>
            <div className="rounded-xl border border-gray-100 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Method</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Opening</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Sales</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Expected</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Closing Count</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Variance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {/* Cash row */}
                  <tr className="bg-amber-50/30">
                    <td className="px-4 py-3 font-medium text-gray-800">
                      Cash
                      {totalCashOuts > 0 && (
                        <span className="ml-1.5 text-xs text-red-500 font-normal">
                          (−{formatCurrency(totalCashOuts)} cash-outs)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">{formatCurrency(openingFloat)}</td>
                    <td className="px-4 py-3 text-right text-green-700">{formatCurrency(cashSales)}</td>
                    <td className="px-4 py-3 text-right font-semibold">{formatCurrency(expectedCash)}</td>
                    <td className="px-4 py-3 text-right">
                      <input
                        type="number" step="0.01" min="0"
                        value={closingAmount}
                        onChange={(e) => setClosingAmount(e.target.value)}
                        placeholder="0.00"
                        className="w-28 rounded-lg border border-gray-300 px-2 py-1 text-right text-sm font-semibold focus:border-primary-500 focus:outline-none"
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {variance !== null ? (
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                          Math.abs(variance) < 0.5 ? 'bg-green-100 text-green-700' :
                          variance > 0 ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {Math.abs(variance) < 0.5 ? '✓ Balanced' :
                           variance > 0 ? `+${formatCurrency(variance)}` : formatCurrency(variance)}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  </tr>

                  {/* Other methods — count entered manually */}
                  {breakdown.filter((p) => p.method_name !== 'Cash').map((p) => {
                    const methodOuts = cashOutsByMethod[p.payment_method_id] || 0;
                    const expected   = p.total - methodOuts;
                    const counted    = parseFloat(pmClosing[p.method_name] ?? '') || null;
                    const pmVar      = counted !== null ? counted - expected : null;
                    return (
                      <tr key={p.method_name}>
                        <td className="px-4 py-3 font-medium text-gray-800">
                          {p.method_name}
                          {methodOuts > 0 && (
                            <span className="ml-1.5 text-xs text-red-500 font-normal">(−{formatCurrency(methodOuts)} out)</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-400">—</td>
                        <td className="px-4 py-3 text-right text-green-700">{formatCurrency(p.total)}</td>
                        <td className="px-4 py-3 text-right font-semibold">{formatCurrency(expected)}</td>
                        <td className="px-4 py-3 text-right">
                          <input
                            type="number" step="0.01" min="0"
                            value={pmClosing[p.method_name] ?? ''}
                            onChange={(e) => setPmClosing((prev) => ({ ...prev, [p.method_name]: e.target.value }))}
                            placeholder="0.00"
                            className="w-28 rounded-lg border border-gray-300 px-2 py-1 text-right text-sm font-semibold focus:border-primary-500 focus:outline-none"
                          />
                        </td>
                        <td className="px-4 py-3 text-right">
                          {pmVar !== null ? (
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                              Math.abs(pmVar) < 0.5 ? 'bg-green-100 text-green-700' :
                              pmVar > 0 ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'
                            }`}>
                              {Math.abs(pmVar) < 0.5 ? '✓ Balanced' : pmVar > 0 ? `+${formatCurrency(pmVar)}` : formatCurrency(pmVar)}
                            </span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-1.5 text-xs text-gray-400">Card and mobile transactions auto-reconcile via bank records.</p>
          </div>

          {/* Cash-outs breakdown */}
          {cashOuts.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                <ArrowDownLeft className="h-4 w-4 text-red-500" />
                Cash Outs ({cashOuts.length})
                <span className="ml-auto text-red-600 font-bold">{formatCurrency(totalCashOuts)}</span>
              </h3>

              {/* Desktop table */}
              <div className="hidden sm:block rounded-xl border border-red-100 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-red-50 border-b border-red-100">
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Date</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Type</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Mode</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Notes</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-500">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-red-50">
                    {cashOuts.map((co) => (
                      <tr key={co.cash_out_id}>
                        <td className="px-3 py-2 text-gray-400 whitespace-nowrap">{formatDateTime(co.created_at)}</td>
                        <td className="px-3 py-2 font-medium text-gray-700 capitalize">
                          {co.out_type.replace('_', ' ')}
                          {co.account_name && <span className="block text-gray-400 font-normal">{co.account_name}</span>}
                          {co.supplier_name && <span className="block text-gray-400 font-normal">{co.supplier_name}</span>}
                        </td>
                        <td className="px-3 py-2 text-gray-500">{co.payment_method_name || 'Cash'}</td>
                        <td className="px-3 py-2 text-gray-500">{co.notes || '—'}</td>
                        <td className="px-3 py-2 text-right font-semibold text-red-600">{formatCurrency(co.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="sm:hidden space-y-2">
                {cashOuts.map((co) => (
                  <div key={co.cash_out_id} className="rounded-xl border border-red-100 bg-red-50/30 px-3 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-gray-700 capitalize">{co.out_type.replace('_', ' ')}</p>
                        {co.account_name  && <p className="text-xs text-gray-400">{co.account_name}</p>}
                        {co.supplier_name && <p className="text-xs text-gray-400">{co.supplier_name}</p>}
                        <p className="mt-0.5 text-xs text-gray-400">{co.payment_method_name || 'Cash'} · {formatDateTime(co.created_at)}</p>
                        {co.notes && <p className="mt-0.5 text-xs text-gray-500 italic">{co.notes}</p>}
                      </div>
                      <p className="shrink-0 text-sm font-bold text-red-600">{formatCurrency(co.amount)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Overall variance summary — cash + non-cash methods */}
          {(() => {
            const nonCashVarIssues = breakdown
              .filter((p) => p.method_name !== 'Cash')
              .map((p) => {
                const methodOuts = cashOutsByMethod[p.payment_method_id] || 0;
                const expected   = p.total - methodOuts;
                const counted    = parseFloat(pmClosing[p.method_name] ?? '');
                return isNaN(counted) ? null : { name: p.method_name, variance: counted - expected };
              })
              .filter((v) => v !== null && Math.abs(v.variance) >= 0.5);

            const allBalanced = variance !== null && Math.abs(variance) < 0.5 && nonCashVarIssues.length === 0;
            const anyIssue    = (variance !== null && Math.abs(variance) >= 0.5) || nonCashVarIssues.length > 0;

            return (
              <>
                {anyIssue && (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-1.5">
                    <p className="text-sm font-semibold text-red-800 flex items-center gap-1.5">
                      <CheckCircle className="h-4 w-4 text-red-500" />
                      Variance detected
                    </p>
                    {variance !== null && Math.abs(variance) >= 0.5 && (
                      <p className="text-xs text-red-700">
                        Cash {variance > 0 ? 'over' : 'short'}: {variance > 0 ? '+' : ''}{formatCurrency(variance)}
                        <span className="text-gray-500 ml-1">(expected {formatCurrency(expectedCash)} · counted {formatCurrency(closingCounted)})</span>
                      </p>
                    )}
                    {nonCashVarIssues.map((v) => (
                      <p key={v.name} className="text-xs text-red-700">
                        {v.name} {v.variance > 0 ? 'over' : 'short'}: {v.variance > 0 ? '+' : ''}{formatCurrency(v.variance)}
                      </p>
                    ))}
                  </div>
                )}
                {allBalanced && (
                  <div className="flex items-center gap-3 rounded-xl bg-green-50 border border-green-200 p-4">
                    <CheckCircle className="h-5 w-5 flex-shrink-0 text-green-500" />
                    <p className="text-sm font-semibold text-green-800">All payment methods balanced!</p>
                  </div>
                )}
              </>
            );
          })()}

          {/* Notes */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Closing Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Any notes for this shift…"
              className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 border-t border-gray-100 px-6 py-4">
          <Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button>
          <Button
            variant="danger" fullWidth loading={isPending}
            disabled={isPending}
            onClick={() => {
              const closingPayModeAmounts = breakdown
                .filter((p) => p.method_name !== 'Cash' && pmClosing[p.method_name] !== undefined)
                .map((p) => ({ paymentMethodId: p.payment_method_id, amount: parseFloat(pmClosing[p.method_name]) || 0 }));
              close({
                closingCashCounted: closingCounted,
                closingNotes: notes || null,
                closingPayModeAmounts,
              });
            }}
          >
            Close Session
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main POS Terminal ─────────────────────────────────────────────────────────
export default function PosTerminal() {
  const branchId      = useAuthStore((s) => s.user?.branchIds?.[0]);
  const userRole      = useAuthStore((s) => s.user?.role);
  const isManager     = ['super_admin', 'company_admin', 'branch_manager'].includes(userRole);
  const session       = useCartStore((s) => s.session);
  const setSession    = useCartStore((s) => s.setSession);
  const clearCart     = useCartStore((s) => s.clearCart);
  const setDefaultTax = useCartStore((s) => s.setDefaultTax);
  const items         = useCartStore((s) => s.items);

  // Populate ['my-company'] cache so Cart.jsx can read pos_allow_partial_qty / pos_allow_price_edit.
  // PosLayout does not use AppLayout, so this fetch would otherwise never happen on the /pos route.
  const { data: companySettings } = useQuery({
    queryKey: ['my-company'],
    queryFn:  () => api.get('/companies/mine').then((r) => r.data.data),
    staleTime: 5 * 60 * 1000,
  });
  const creditSalesEnabled = !!companySettings?.credit_sales_enabled;
  const allowOverpayment   = !!companySettings?.pos_allow_overpayment;

  // Fetch and apply the default tax rate for this company
  // onSuccess was removed in TanStack Query v5 — use useEffect instead
  const { data: defaultTaxData } = useQuery({
    queryKey: ['default-tax-rate'],
    queryFn:  () => api.get('/tax-rates/default').then((r) => r.data.data),
    staleTime: 5 * 60 * 1000,
  });
  useEffect(() => {
    if (defaultTaxData !== undefined) setDefaultTax(defaultTaxData ?? null);
  }, [defaultTaxData, setDefaultTax]);

  const { data: posMethods = [] } = useQuery({
    queryKey: ['payment-methods'],
    queryFn:  () => api.get('/pos/payment-methods').then((r) => r.data.data),
    staleTime: 5 * 60 * 1000,
  });

  const { data: holdsData = [] } = useQuery({
    queryKey: ['pos-holds', branchId],
    queryFn:  () => api.get('/pos/holds', { params: { branchId } }).then((r) => r.data.data),
    enabled:  !!branchId,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const holdsCount = holdsData.length;
  const offlineQueue = usePosDataStore((s) => s.offlineQueue);
  const markSynced   = usePosDataStore((s) => s.markSynced);
  const markFailed   = usePosDataStore((s) => s.markFailed);
  const isOnline       = useNetworkStatus();
  const wasOnlineRef   = useRef(isOnline);
  const [isSyncing,    setIsSyncing]    = useState(false);

  const [checkoutOpen,     setCheckoutOpen]     = useState(false);
  const [closeOpen,        setCloseOpen]        = useState(false);
  const [cashOutOpen,      setCashOutOpen]      = useState(false);
  const [transferOpen,     setTransferOpen]     = useState(false);
  const [shiftOpen,        setShiftOpen]        = useState(false);
  const [holdsOpen,        setHoldsOpen]        = useState(false);
  const [queueOpen,        setQueueOpen]        = useState(false);
  const [salesReturnOpen,  setSalesReturnOpen]  = useState(false);
  const [salesDrillOpen,   setSalesDrillOpen]   = useState(false);
  const [creditPayOpen,    setCreditPayOpen]    = useState(false);
  const [receiptTxnId,     setReceiptTxnId]     = useState(null);
  const [menuOpen,         setMenuOpen]         = useState(false);
  const [scanResetKey,     setScanResetKey]      = useState(0);
  const [mobilePosTab,     setMobilePosTab]     = useState('products'); // 'products' | 'cart'
  const menuRef = useRef(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  // ── Auto-sync offline queue when connection is restored ───────────────────
  const syncQueue = useCallback(async (queue) => {
    const pending = queue.filter((q) => q.status === 'pending');
    if (!pending.length) return;
    setIsSyncing(true);
    let synced = 0;
    let failed = 0;
    for (const item of pending) {
      try {
        await api.post('/sales/transactions', item.payload);
        markSynced(item.id);
        synced++;
      } catch (err) {
        const msg = err.response?.data?.message || 'Sync failed';
        markFailed(item.id, msg);
        failed++;
      }
    }
    setIsSyncing(false);
    if (synced > 0) toast.success(`${synced} transaction${synced > 1 ? 's' : ''} synced`);
    if (failed > 0) toast.error(`${failed} transaction${failed > 1 ? 's' : ''} failed to sync`);
  }, [markSynced, markFailed]);

  useEffect(() => {
    if (isOnline && !wasOnlineRef.current) {
      toast('Back online', { icon: '✅', duration: 2000 });
      const current = usePosDataStore.getState().offlineQueue;
      if (current.some((q) => q.status === 'pending')) syncQueue(current);
    }
    wasOnlineRef.current = isOnline;
  }, [isOnline, syncQueue]);

  // Keyboard shortcuts: F2 = checkout, F3 = shift summary, Escape = close modals
  useEffect(() => {
    const onKey = (e) => {
      if (!session) return;
      if (e.key === 'F2') {
        e.preventDefault();
        if (items.length > 0 && !checkoutOpen) setCheckoutOpen(true);
      }
      if (e.key === 'F3') {
        e.preventDefault();
        setShiftOpen((v) => !v);
      }
      if (e.key === 'Escape') {
        setCheckoutOpen(false);
        setShiftOpen(false);
        setHoldsOpen(false);
        setQueueOpen(false);
        setCloseOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session, items.length, checkoutOpen]);

  // On mount / page refresh: restore existing open session if store is empty
  const { isPending: sessionChecking, isFetching: sessionFetching, data: fetchedSession } = useQuery({
    queryKey: ['active-session', branchId],
    queryFn:  () => api.get('/pos/sessions/active', { params: { branchId } }).then((r) => r.data.data),
    enabled:  !!branchId && !session,
    retry:    1,
  });

  useEffect(() => {
    if (fetchedSession) setSession(fetchedSession);
  }, [fetchedSession, setSession]);

  const handleSessionOpened = useCallback((newSession) => {
    setSession(newSession);
  }, [setSession]);

  const handleSessionClosed = useCallback(() => {
    clearCart();
    setSession(null);
    setCloseOpen(false);
  }, [clearCart, setSession]);

  const { data: receiptDetail } = useQuery({
    queryKey: ['receipt-detail', receiptTxnId],
    queryFn:  () => api.get(`/sales/transactions/${receiptTxnId}`).then((r) => r.data.data),
    enabled:  !!receiptTxnId,
    staleTime: Infinity,
  });

  const handlePaymentSuccess = useCallback((txn) => {
    setCheckoutOpen(false);
    const current = useCartStore.getState().session;
    setSession({
      ...current,
      txn_count:    (current?.txn_count    || 0) + 1,
      session_sales:(current?.session_sales || 0) + (txn?.total_amount || 0),
    });
    if (txn?.transaction_id) setReceiptTxnId(txn.transaction_id);
    setScanResetKey((k) => k + 1);
  }, [setSession]);

  // Show spinner while any session fetch is in flight (covers initial load and background refetches)
  const isCheckingSession = !session && (sessionChecking || sessionFetching);

  if (!branchId) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-50">
        <div className="text-center">
          <Monitor className="mx-auto mb-3 h-12 w-12 text-gray-300" />
          <p className="text-gray-500 font-medium">No branch assigned</p>
          <p className="text-sm text-gray-400 mt-1">Contact your administrator to assign a branch.</p>
        </div>
      </div>
    );
  }

  if (isCheckingSession) return <PageSpinner />;

  if (!session) {
    return <OpenSessionScreen branchId={branchId} onSessionOpened={handleSessionOpened} />;
  }

  const pendingQueueCount = offlineQueue.filter((q) => q.status === 'pending').length;
  const failedQueueCount  = offlineQueue.filter((q) => q.status === 'failed').length;

  return (
    <div className="flex h-full flex-col">
      {/* Offline banner */}
      {!isOnline && (
        <div className="flex items-center justify-between bg-red-600 px-4 py-1.5 text-white text-xs">
          <div className="flex items-center gap-2">
            <WifiOff className="h-3.5 w-3.5" />
            <span className="font-medium">You're offline — payments will be queued for sync</span>
          </div>
          {(pendingQueueCount > 0 || failedQueueCount > 0) && (
            <button
              onClick={() => setQueueOpen(true)}
              className="flex items-center gap-1.5 rounded-md bg-white/20 px-2 py-0.5 hover:bg-white/30 transition-colors"
            >
              {pendingQueueCount} queued{failedQueueCount > 0 ? `, ${failedQueueCount} failed` : ''}
            </button>
          )}
        </div>
      )}

      {/* Coming back online with pending queue */}
      {isOnline && pendingQueueCount > 0 && (
        <div className="flex items-center justify-between bg-amber-500 px-4 py-1.5 text-white text-xs">
          <div className="flex items-center gap-2">
            <Wifi className="h-3.5 w-3.5" />
            <span className="font-medium">{isSyncing ? 'Syncing offline transactions…' : `${pendingQueueCount} offline transaction${pendingQueueCount > 1 ? 's' : ''} pending sync`}</span>
          </div>
          {!isSyncing && (
            <button
              onClick={() => syncQueue(offlineQueue)}
              className="flex items-center gap-1.5 rounded-md bg-white/20 px-2 py-0.5 hover:bg-white/30 transition-colors"
            >
              Sync now
            </button>
          )}
        </div>
      )}

      {/* ── Session info bar ── */}
      <div className="flex items-center justify-between bg-primary-700 px-4 py-2 text-white">
        {/* Left: connection pill + terminal + live stats */}
        <div className="flex items-center gap-3 text-xs overflow-hidden">
          {/* Connection status pill */}
          <div className={`flex flex-shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
            isOnline
              ? pendingQueueCount > 0
                ? 'bg-amber-500/25 text-amber-300'
                : 'bg-green-500/25 text-green-300'
              : 'bg-red-500/25 text-red-300'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${
              isOnline
                ? pendingQueueCount > 0 ? 'bg-amber-400' : 'bg-green-400'
                : 'bg-red-400 animate-pulse'
            }`} />
            {isOnline
              ? pendingQueueCount > 0
                ? `${pendingQueueCount} pending`
                : failedQueueCount > 0
                ? `${failedQueueCount} failed`
                : 'Live'
              : 'Offline'
            }
          </div>

          <span className="h-3 w-px bg-white/20 flex-shrink-0" />

          <div className="flex items-center gap-1.5 flex-shrink-0">
            <MonitorDot className="h-3.5 w-3.5 text-primary-300" />
            <span className="font-semibold tracking-wide">{session.terminal_name}</span>
          </div>

          {isManager && session.cashier_name && (
            <>
              <span className="h-3 w-px bg-white/20 flex-shrink-0" />
              <div className="flex items-center gap-1.5 flex-shrink-0 text-white/70 text-[11px]">
                <UserCog className="h-3 w-3" />
                <span>{session.cashier_name}</span>
              </div>
            </>
          )}

          <span className="h-3 w-px bg-white/20 flex-shrink-0" />

          <button
            onClick={() => setSalesDrillOpen(true)}
            className="flex items-center gap-2 rounded-lg px-2 py-1 text-white/70 hover:bg-white/10 hover:text-white transition-colors flex-shrink-0"
            title="View session transactions"
          >
            <Receipt className="h-3 w-3" />
            <span>{session.txn_count ?? 0} sales</span>
            <span className="h-3 w-px bg-white/20" />
            <TrendingUp className="h-3 w-3 text-secondary-400" />
            <span className="font-semibold text-secondary-300">{formatCurrency(session.session_sales ?? 0)}</span>
          </button>
        </div>

        {/* Right: Holds button + Menu dropdown */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={() => setHoldsOpen(true)}
            className="relative flex items-center gap-1.5 rounded-lg border border-white/20 px-2.5 py-1.5 text-xs font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          >
            <BookmarkCheck className="h-3.5 w-3.5" />
            Holds
            {holdsCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[10px] font-bold text-gray-900">
                {holdsCount}
              </span>
            )}
          </button>

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-1.5 text-xs font-semibold text-white/80 transition-all hover:bg-white/10 hover:text-white"
          >
            <Menu className="h-3.5 w-3.5" />
            Menu
            <ChevronDown className={`h-3 w-3 transition-transform duration-150 ${menuOpen ? 'rotate-180' : ''}`} />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-2 w-60 overflow-hidden rounded-2xl border border-gray-100 bg-white py-1.5 shadow-2xl z-50">
              <MenuAction
                icon={BarChart3}
                iconBg="bg-blue-100 text-blue-600"
                label="Shift Summary"
                sub="View today's performance"
                kbd="F3"
                onClick={() => { setShiftOpen(true); setMenuOpen(false); }}
              />
              {offlineQueue.length > 0 && (
                <MenuAction
                  icon={CloudOff}
                  iconBg="bg-amber-100 text-amber-600"
                  label="Offline Queue"
                  sub={`${pendingQueueCount} pending · ${failedQueueCount} failed`}
                  badge={failedQueueCount || pendingQueueCount}
                  onClick={() => { setQueueOpen(true); setMenuOpen(false); }}
                />
              )}
              <MenuAction
                icon={ArrowDownLeft}
                iconBg="bg-orange-100 text-orange-600"
                label="Cash Out"
                sub="Record withdrawal, expense or stock payment"
                onClick={() => { setCashOutOpen(true); setMenuOpen(false); }}
              />
              <MenuAction
                icon={ArrowLeftRight}
                iconBg="bg-violet-100 text-violet-600"
                label="Pay Mode Transfer"
                sub="Sweep, float top-up or payment correction"
                onClick={() => { setTransferOpen(true); setMenuOpen(false); }}
              />
              {creditSalesEnabled && (
                <MenuAction
                  icon={CreditCard}
                  iconBg="bg-blue-100 text-blue-600"
                  label={allowOverpayment ? 'Receive Payment' : 'Collect Credit Payment'}
                  sub={allowOverpayment
                    ? 'Collect an outstanding balance or top up a customer\'s account'
                    : 'Record payment against outstanding credit balance'}
                  onClick={() => { setCreditPayOpen(true); setMenuOpen(false); }}
                />
              )}
              <div className="my-1 h-px bg-gray-100" />
              <MenuAction
                icon={LogOut}
                iconBg="bg-red-100 text-red-600"
                label="Close Shift"
                sub="End session and count cash"
                danger
                onClick={() => { setCloseOpen(true); setMenuOpen(false); }}
              />
            </div>
          )}
        </div>
        </div>
      </div>

      {/* ── Mobile tab bar (hidden on lg+) ── */}
      <div className="flex flex-shrink-0 border-b border-gray-200 bg-white lg:hidden">
        <button
          onClick={() => setMobilePosTab('products')}
          className={[
            'flex-1 py-2.5 text-sm font-semibold border-b-2 transition-colors',
            mobilePosTab === 'products'
              ? 'border-primary-500 text-primary-600'
              : 'border-transparent text-gray-500 hover:text-gray-700',
          ].join(' ')}
        >
          Products
        </button>
        <button
          onClick={() => setMobilePosTab('cart')}
          className={[
            'flex-1 py-2.5 text-sm font-semibold border-b-2 transition-colors',
            mobilePosTab === 'cart'
              ? 'border-primary-500 text-primary-600'
              : 'border-transparent text-gray-500 hover:text-gray-700',
          ].join(' ')}
        >
          Cart{items.length > 0 && <span className="ml-1.5 rounded-full bg-primary-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{items.length}</span>}
        </button>
      </div>

      {/* ── POS main area ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Product grid — full width on mobile when active, flex-1 on desktop */}
        <div className={[
          'min-w-0 overflow-hidden',
          mobilePosTab === 'cart' ? 'hidden lg:flex lg:flex-1' : 'flex-1',
        ].join(' ')}>
          <ProductGrid branchId={branchId} scanResetTrigger={scanResetKey} />
        </div>
        {/* Cart — full width on mobile when active, fixed 55% on desktop */}
        <div className={[
          'overflow-hidden border-l border-gray-200',
          mobilePosTab === 'products' ? 'hidden lg:flex lg:w-[55%] lg:flex-shrink-0' : 'flex-1 lg:flex-none lg:w-[55%] lg:flex-shrink-0',
        ].join(' ')}>
          <Cart
            session={session}
            onCheckout={() => setCheckoutOpen(true)}
            onSalesReturn={() => setSalesReturnOpen(true)}
            onCartCleared={() => setScanResetKey((k) => k + 1)}
          />
        </div>
      </div>

      {/* Modals */}
      <PaymentModal
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        onSuccess={handlePaymentSuccess}
      />

      <HoldModal
        open={holdsOpen}
        onClose={() => setHoldsOpen(false)}
        branchId={branchId}
      />

      <OfflineQueueModal
        open={queueOpen}
        onClose={() => setQueueOpen(false)}
        onSyncAll={() => syncQueue(offlineQueue)}
        isSyncing={isSyncing}
      />

      {shiftOpen && (
        <ShiftSummaryModal
          session={session}
          onClose={() => setShiftOpen(false)}
        />
      )}

      {cashOutOpen && (
        <CashOutModal
          session={session}
          methods={posMethods}
          onClose={() => setCashOutOpen(false)}
        />
      )}

      {transferOpen && (
        <TransferModal
          session={session}
          methods={posMethods}
          onClose={() => setTransferOpen(false)}
        />
      )}

      {closeOpen && (
        <CloseSessionModal
          session={session}
          onClose={() => setCloseOpen(false)}
          onClosed={handleSessionClosed}
        />
      )}

      <ReceiptModal
        open={!!receiptTxnId}
        onClose={() => setReceiptTxnId(null)}
        txn={receiptDetail}
      />

      <SalesReturnModal
        open={salesReturnOpen}
        onClose={() => setSalesReturnOpen(false)}
        session={session}
      />

      {creditSalesEnabled && (
        <CreditPaymentModal
          open={creditPayOpen}
          sessionId={session?.session_id}
          onClose={() => setCreditPayOpen(false)}
        />
      )}

      {salesDrillOpen && (
        <SessionSalesModal
          session={session}
          onClose={() => setSalesDrillOpen(false)}
        />
      )}
    </div>
  );
}
