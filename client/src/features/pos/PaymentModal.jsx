import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  CreditCard, Smartphone, Banknote, CheckCircle, Plus, Trash2,
  Gift, WifiOff, Loader2, XCircle, Send, Search, UserCircle2, UserPlus,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/services/api';
import { useAuthStore, useCartStore, usePosDataStore } from '@/app/store';
import CustomerSelectModal from './CustomerSelectModal';
import { formatCurrency } from '@/utils/formatters';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import useNetworkStatus from '@/hooks/useNetworkStatus';

const METHOD_ICONS = { Cash: Banknote, Card: CreditCard, Mobile: Smartphone };

// ── Payment methods offline cache ─────────────────────────────────────────────
const PM_CACHE_KEY = 'pos-payment-methods-cache';
function loadMethodsCache() {
  try { return JSON.parse(localStorage.getItem(PM_CACHE_KEY) ?? 'null') ?? []; } catch { return []; }
}
function saveMethodsCache(methods) {
  try { localStorage.setItem(PM_CACHE_KEY, JSON.stringify(methods)); } catch {}
}

function quickAmounts(total) {
  return [50, 100, 200, 500, 1000, 2000, 5000].filter((v) => v >= total).slice(0, 4);
}

const isMpesa = (methodName) =>
  /mpesa|m-pesa/i.test(methodName || '');

// ── Manual entry sub-panel (with "find received payment" lookup) ──────────────

function ManualPanel({ line, phone, setPhone, manualCode, setManualCode, isSubmitting, handleManual, onReferenceResolved, inputCls, autoOpenLookup, onAutoOpenDone }) {
  const [showLookup, setShowLookup]   = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [unlinked, setUnlinked]       = useState([]);
  const [lookupError, setLookupError] = useState('');

  const fetchUnlinked = async () => {
    setLookupLoading(true);
    setLookupError('');
    try {
      const params = new URLSearchParams({ hours: 48 });
      if (line.amount) params.set('amount', Math.round(line.amount));
      const { data } = await api.get(`/mpesa/unlinked?${params}`);
      setUnlinked(data.data);
      setShowLookup(true);
    } catch (e) {
      setLookupError(e.response?.data?.message || 'Failed to load payments');
    } finally {
      setLookupLoading(false);
    }
  };

  // When coming from a timed-out STK session, auto-open the lookup immediately
  useEffect(() => {
    if (autoOpenLookup) {
      fetchUnlinked();
      onAutoOpenDone?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelect = (txn) => {
    // Use the existing transaction — skip /manual creation entirely
    onReferenceResolved(line.methodId, txn.mpesa_receipt_number, txn.mpesa_txn_id);
    setShowLookup(false);
  };

  if (showLookup) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-700">Received payments (last 48 h)</span>
          <button onClick={() => setShowLookup(false)}
            className="text-xs text-gray-400 hover:text-gray-600">Back</button>
        </div>
        {unlinked.length === 0 ? (
          <p className="text-xs text-center text-gray-400 py-3">
            No unlinked payments found{line.amount ? ` for ${formatCurrency(line.amount)}` : ''}.
          </p>
        ) : (
          <div className="space-y-1 max-h-44 overflow-y-auto">
            {unlinked.map((txn) => (
              <button
                key={txn.mpesa_txn_id}
                onClick={() => handleSelect(txn)}
                className="w-full text-left rounded-lg border border-green-200 bg-white px-3 py-2 hover:bg-green-50 transition-colors">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-semibold text-gray-800">{txn.mpesa_receipt_number}</span>
                  <span className="text-xs font-bold text-green-700">{formatCurrency(parseFloat(txn.amount))}</span>
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {txn.phone_number && <span>{txn.phone_number} · </span>}
                  {new Date(txn.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </button>
            ))}
          </div>
        )}
        <button onClick={fetchUnlinked}
          className="text-xs text-green-600 hover:text-green-800 font-medium">
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div>
        <label className="text-xs text-gray-600 mb-1 block">M-Pesa Receipt Code *</label>
        <input type="text" value={manualCode} onChange={(e) => setManualCode(e.target.value.toUpperCase())}
          placeholder="e.g. QGH7XXXXXX"
          className={`${inputCls} font-mono uppercase tracking-wider`} />
      </div>
      <div>
        <label className="text-xs text-gray-600 mb-1 block">Customer Phone (optional)</label>
        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
          placeholder="07XX XXX XXX"
          className={inputCls} />
      </div>
      {lookupError && (
        <p className="text-xs text-red-600">{lookupError}</p>
      )}
      <div className="flex gap-2">
        <Button size="sm" fullWidth
          onClick={handleManual}
          disabled={isSubmitting || manualCode.trim().length < 3}
          loading={isSubmitting}
          className="!bg-green-600 !text-white hover:!bg-green-700">
          Process
        </Button>
        <button
          onClick={fetchUnlinked}
          disabled={lookupLoading}
          title="Find a received M-Pesa payment not yet applied to a sale"
          className="flex-shrink-0 flex items-center gap-1 rounded-lg border border-green-300 bg-white px-2.5 py-1.5 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50 transition-colors">
          {lookupLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Find
        </button>
      </div>
    </div>
  );
}

// ── STK Push panel (shown when M-Pesa is added) ───────────────────────────────

const SESSION_LIMIT_MS = 120 * 1000; // 2 min — covers 55 s Daraja fallback wait + response time

function formatElapsed(ms) {
  const total = Math.floor(ms / 1000);
  const m     = Math.floor(total / 60);
  const s     = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function MpesaPanel({ line, methods, onReferenceResolved, onRemove }) {
  const method        = methods.find((m) => m.payment_method_id === line.methodId);
  const customerPhone = useAuthStore((s) => s.user)?.phone || '';

  const [mpesaMode,   setMpesaMode]   = useState('manual');
  const [phone,       setPhone]       = useState(customerPhone);
  const [manualCode,  setManualCode]  = useState('');
  const [stkState,    setStkState]    = useState('idle');   // idle|sending|waiting|done|failed
  const [stkError,    setStkError]    = useState('');
  const [pendingTxn,  setPendingTxn]  = useState(null);
  const [elapsed,     setElapsed]     = useState(0);        // ms since first STK push
  const [autoLookup,  setAutoLookup]  = useState(false);   // open lookup immediately in manual mode

  const pollRef        = useRef(null);
  const clockRef       = useRef(null);
  const sessionStartRef = useRef(null);  // timestamp of first STK push this session

  const amount = line.amount;

  // Clear intervals on unmount
  useEffect(() => () => {
    clearInterval(pollRef.current);
    clearInterval(clockRef.current);
  }, []);

  const stopSession = () => {
    clearInterval(pollRef.current);
    clearInterval(clockRef.current);
    sessionStartRef.current = null;
    setElapsed(0);
  };

  const startClock = () => {
    clearInterval(clockRef.current);
    clockRef.current = setInterval(() => {
      const ms = Date.now() - sessionStartRef.current;
      setElapsed(ms);
      if (ms >= SESSION_LIMIT_MS) {
        stopSession();
        setStkState('failed');
        setStkError('Payment session expired. If the customer already paid, use "Find Payment" below.');
      }
    }, 1000);
  };

  const { mutate: startSTK, isPending: isSending } = useMutation({
    mutationFn: (body) => api.post('/mpesa/stk-push', body).then((r) => r.data.data),
    onSuccess: (data) => {
      setPendingTxn(data);
      setStkState('waiting');
      setStkError('');
      if (!sessionStartRef.current) {
        sessionStartRef.current = Date.now();
        startClock();
      }
      clearInterval(pollRef.current);
      pollRef.current = setInterval(() => pollStatus(data.checkoutRequestId), 4000);
    },
    onError: (e) => {
      setStkState('failed');
      setStkError(e.response?.data?.message || 'STK Push failed. Check M-Pesa configuration.');
    },
  });

  const { mutate: submitManual, isPending: isSubmitting } = useMutation({
    mutationFn: (body) => api.post('/mpesa/manual', body).then((r) => r.data.data),
    onSuccess: (data) => {
      onReferenceResolved(line.methodId, data.mpesaReceiptNumber, data.mpesaTxnId);
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed to record receipt'),
  });

  const pollStatus = async (checkoutRequestId) => {
    try {
      const { data } = await api.get(`/mpesa/stk-status/${checkoutRequestId}`);
      const result = data.data;

      if (result.status === 'completed') {
        clearInterval(pollRef.current);
        stopSession();
        setStkState('done');
        onReferenceResolved(line.methodId, result.mpesaReceiptNumber, result.mpesaTxnId);
        toast.success('M-Pesa payment confirmed!');

      } else if (result.status === 'timeout') {
        // Prompt expired on customer's phone — resend automatically if session still open
        clearInterval(pollRef.current);
        const sessionMs = Date.now() - (sessionStartRef.current || Date.now());
        if (sessionMs < SESSION_LIMIT_MS) {
          toast('Prompt expired — resending to customer…', { icon: '🔄', duration: 3000 });
          startSTK({ phone, amount, accountReference: 'POS', description: 'POS Payment' });
        } else {
          stopSession();
          setStkState('failed');
          setStkError('Payment session expired. Please start a new transaction.');
        }

      } else if (result.status === 'cancelled') {
        clearInterval(pollRef.current);
        stopSession();
        setStkState('failed');
        setStkError('Customer cancelled the M-Pesa prompt. Tap "Resend" to try again.');

      } else if (result.status === 'failed') {
        clearInterval(pollRef.current);
        stopSession();
        setStkState('failed');
        setStkError(result.failureReason || 'Payment failed. Please retry.');
      }
    } catch {
      // Network blip — keep polling
    }
  };

  const handleSendSTK = () => {
    if (stkState !== 'idle') return;
    if (!phone.trim()) { toast.error('Enter a phone number'); return; }
    setStkState('sending');
    setStkError('');
    startSTK({ phone, amount, accountReference: 'POS', description: 'POS Payment' });
  };

  const handleResend = () => {
    setStkState('sending');
    setStkError('');
    startSTK({ phone, amount, accountReference: 'POS', description: 'POS Payment' });
  };

  const handleCancel = () => {
    clearInterval(pollRef.current);
    stopSession();
    setStkState('idle');
    setPendingTxn(null);
    setStkError('');
  };

  const handleManual = () => {
    if (!manualCode.trim()) { toast.error('Enter the M-Pesa receipt code'); return; }
    submitManual({ receiptNumber: manualCode.trim(), amount, phone: phone || undefined });
  };

  const sessionActive   = !!sessionStartRef.current;
  const remainingMs     = Math.max(0, SESSION_LIMIT_MS - elapsed);
  const inputCls = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-green-500 focus:outline-none';

  return (
    <div className="rounded-xl border border-green-200 bg-green-50 p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Smartphone className="h-4 w-4 text-green-600" />
          <span className="text-sm font-semibold text-green-800">{method?.method_name}</span>
          <span className="rounded-full bg-green-200 px-2 py-0.5 text-xs font-medium text-green-800">
            {formatCurrency(amount)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {sessionActive && stkState === 'waiting' && (
            <span className="text-xs text-gray-400 font-mono">
              {formatElapsed(SESSION_LIMIT_MS - elapsed)} left
            </span>
          )}
          <button onClick={onRemove} className="text-gray-300 hover:text-red-500 transition-colors">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Mode toggle — only shown before session starts */}
      {stkState === 'idle' && (
        <div className="flex rounded-lg border border-green-200 bg-white overflow-hidden text-xs font-medium">
          <button
            className={`flex-1 py-1.5 transition-colors ${mpesaMode === 'stk' ? 'bg-green-600 text-white' : 'text-gray-500 hover:bg-green-50'}`}
            onClick={() => setMpesaMode('stk')}>
            STK Push
          </button>
          <button
            className={`flex-1 py-1.5 transition-colors ${mpesaMode === 'manual' ? 'bg-green-600 text-white' : 'text-gray-500 hover:bg-green-50'}`}
            onClick={() => setMpesaMode('manual')}>
            Manual Code
          </button>
        </div>
      )}

      {/* ── STK Push flow ── */}
      {mpesaMode === 'stk' && (
        <>
          {stkState === 'idle' && (
            <div className="space-y-2">
              <div>
                <label className="text-xs text-gray-600 mb-1 block">Customer Phone *</label>
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                  placeholder="07XX XXX XXX"
                  className={inputCls} />
              </div>
              <Button size="sm" fullWidth
                icon={<Send className="h-3.5 w-3.5" />}
                onClick={handleSendSTK}
                disabled={isSending || !phone.trim()}
                loading={isSending}
                className="!bg-green-600 !text-white hover:!bg-green-700">
                Send STK Push — {formatCurrency(amount)}
              </Button>
            </div>
          )}

          {stkState === 'waiting' && (
            <div className="flex flex-col items-center gap-2 py-2">
              <Loader2 className="h-6 w-6 text-green-600 animate-spin" />
              <p className="text-sm font-medium text-green-800">Waiting for customer…</p>
              <p className="text-xs text-gray-500 text-center">
                M-Pesa prompt sent to <strong>{phone}</strong>. Ask the customer to enter their PIN.
              </p>
              <p className="text-xs text-gray-400">
                Session open for {formatElapsed(elapsed)} · resends automatically if prompt expires
              </p>
              <button onClick={handleCancel}
                className="text-xs text-red-500 hover:text-red-700 mt-1">
                Cancel
              </button>
            </div>
          )}

          {stkState === 'done' && (
            <div className="flex items-center gap-2 rounded-lg bg-green-100 px-3 py-2">
              <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-green-800">Payment confirmed!</p>
                <p className="text-xs text-green-700 flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Completing sale…
                </p>
              </div>
            </div>
          )}

          {stkState === 'failed' && (
            <div className="space-y-2">
              <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                <XCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-red-700">{stkError}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" fullWidth variant="secondary" onClick={handleCancel}>
                  Cancel
                </Button>
                {remainingMs > 0 ? (
                  <Button size="sm" fullWidth
                    icon={<Send className="h-3.5 w-3.5" />}
                    onClick={handleResend}
                    disabled={isSending}
                    loading={isSending}
                    className="!bg-green-600 !text-white hover:!bg-green-700">
                    Resend
                  </Button>
                ) : (
                  <Button size="sm" fullWidth
                    icon={<Search className="h-3.5 w-3.5" />}
                    onClick={() => {
                      stopSession();
                      setStkState('idle');
                      setMpesaMode('manual');
                      setAutoLookup(true);
                    }}
                    className="!bg-green-600 !text-white hover:!bg-green-700">
                    Find Payment
                  </Button>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Manual entry flow ── */}
      {mpesaMode === 'manual' && (
        <ManualPanel
          line={line}
          phone={phone}
          setPhone={setPhone}
          manualCode={manualCode}
          setManualCode={setManualCode}
          isSubmitting={isSubmitting}
          handleManual={handleManual}
          onReferenceResolved={onReferenceResolved}
          inputCls={inputCls}
          autoOpenLookup={autoLookup}
          onAutoOpenDone={() => setAutoLookup(false)}
        />
      )}
    </div>
  );
}

// ── Regular (non-M-Pesa) payment line ─────────────────────────────────────────

function PaymentLine({ line, remaining, methods, onRemove, onUpdate }) {
  const method = methods.find((m) => m.payment_method_id === line.methodId);
  const isCash = method?.method_name === 'Cash';
  const change = isCash ? Math.max(0, parseFloat(line.tendered || 0) - line.amount) : 0;

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">{method?.method_name}</span>
        <button onClick={onRemove} className="text-gray-300 hover:text-red-500 transition-colors">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500 w-16 flex-shrink-0">Amount</label>
        <input
          type="number" step="0.01" min="0"
          value={line.amount}
          onChange={(e) => onUpdate({ ...line, amount: parseFloat(e.target.value) || 0 })}
          className="flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-sm font-semibold text-right focus:border-primary-500 focus:outline-none"
        />
        {remaining > 0 && (
          <button
            onClick={() => onUpdate({ ...line, amount: remaining + line.amount, tendered: remaining + line.amount })}
            className="text-xs text-primary-500 hover:text-primary-700 font-medium whitespace-nowrap">
            Fill {formatCurrency(remaining)}
          </button>
        )}
      </div>

      {isCash && (
        <>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 w-16 flex-shrink-0">Tendered</label>
            <input
              type="number" step="0.01" min={line.amount}
              value={line.tendered}
              onChange={(e) => onUpdate({ ...line, tendered: parseFloat(e.target.value) || 0 })}
              className="flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-sm font-semibold text-right focus:border-primary-500 focus:outline-none"
            />
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {quickAmounts(line.amount).map((v) => (
              <button key={v} onClick={() => onUpdate({ ...line, tendered: v })}
                className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-medium hover:border-primary-300 hover:bg-primary-50 transition-colors">
                {formatCurrency(v)}
              </button>
            ))}
            <button onClick={() => onUpdate({ ...line, tendered: line.amount })}
              className="rounded-lg border border-primary-200 bg-primary-50 px-2 py-1 text-xs font-medium text-primary-700 hover:bg-primary-100 transition-colors">
              Exact
            </button>
          </div>
          {parseFloat(line.tendered) >= line.amount && (
            <div className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-1.5">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <span className="text-sm font-medium text-green-700">Change: {formatCurrency(change)}</span>
            </div>
          )}
        </>
      )}

      {!isCash && method?.requires_reference && (
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 w-16 flex-shrink-0">Ref #</label>
          <input type="text" value={line.reference}
            onChange={(e) => onUpdate({ ...line, reference: e.target.value })}
            placeholder="Reference number"
            className="flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:border-primary-500 focus:outline-none"
          />
        </div>
      )}
    </div>
  );
}

// ── Main payment modal ────────────────────────────────────────────────────────

export default function PaymentModal({ open, onClose, onSuccess }) {
  const { items, customer, session, notes, totals, clearCart, orderDiscount, orderDiscountType } = useCartStore();
  const branchId           = useAuthStore((s) => s.user?.branchIds?.[0]);
  const enqueueTransaction = usePosDataStore((s) => s.enqueueTransaction);
  const isOnline           = useNetworkStatus();

  const cartTotals     = totals();
  const cartTotal      = cartTotals.total;
  const loyaltyBalance = customer?.loyalty_points_balance ?? 0;

  const { data: loyaltySettings } = useQuery({
    queryKey: ['loyalty-settings'],
    queryFn:  () => api.get('/companies/mine/loyalty').then((r) => r.data.data),
    staleTime: 5 * 60 * 1000,
  });
  const redeemRate = loyaltySettings?.points_redeem_rate ?? 0.10;

  const [pointsToRedeem, setPointsToRedeem] = useState(0);
  const loyaltyDiscount = pointsToRedeem * redeemRate;
  const netTotal        = Math.max(0, cartTotal - loyaltyDiscount);

  // Each line: { methodId, amount, tendered, reference, mpesaTxnId }
  const [paymentLines, setPaymentLines] = useState([]);

  const totalCovered   = paymentLines.reduce((s, l) => s + (l.amount || 0), 0);
  const remaining      = Math.max(0, netTotal - totalCovered);
  const isFullyCovered = totalCovered >= netTotal && netTotal > 0;

  const { data: liveMethods, isError: methodsError } = useQuery({
    queryKey: ['payment-methods'],
    queryFn:  () => api.get('/pos/payment-methods').then((r) => r.data.data),
    enabled:  open && isOnline,
  });

  // Persist to localStorage whenever we get fresh data
  useEffect(() => {
    if (liveMethods?.length) saveMethodsCache(liveMethods);
  }, [liveMethods]);

  // Online: use live data. Offline or errored: fall back to localStorage cache.
  const methods = liveMethods ?? ((!isOnline || methodsError) ? loadMethodsCache() : []);

  useEffect(() => {
    if (open) { setPaymentLines([]); setPointsToRedeem(0); }
  }, [open]);

  const setCustomer = useCartStore((s) => s.setCustomer);
  const [custModalOpen, setCustModalOpen] = useState(false);

  const addPaymentLine = (method) => {
    if (paymentLines.some((l) => l.methodId === method.payment_method_id)) return;
    const isCash = method.method_name === 'Cash';
    setPaymentLines((prev) => [
      ...prev,
      {
        methodId:  method.payment_method_id,
        amount:    Math.max(0, remaining),
        tendered:  isCash ? Math.max(0, remaining) : 0,
        reference: '',
        mpesaTxnId: null,
      },
    ]);
  };

  const updateLine = (idx, updated) =>
    setPaymentLines((prev) => prev.map((l, i) => (i === idx ? updated : l)));

  const removeLine = (idx) =>
    setPaymentLines((prev) => prev.filter((_, i) => i !== idx));

  const maxRedeemPoints = Math.min(
    loyaltyBalance,
    redeemRate > 0 ? Math.floor(cartTotal / redeemRate) : 0
  );

  // M-Pesa lines are ready when they have a confirmed txn ID (even without a receipt
  // number, which Daraja's query API doesn't return — only the callback does).
  const canProcess = isFullyCovered && paymentLines.every((l) => {
    const m      = methods.find((m) => m.payment_method_id === l.methodId);
    const isCash = m?.method_name === 'Cash';
    if (isCash)           return parseFloat(l.tendered || 0) >= l.amount;
    if (isMpesa(m?.method_name)) return !!l.reference || !!l.mpesaTxnId;
    return true;
  });

  const { mutate: processPayment, isPending } = useMutation({
    mutationFn: (payload) => api.post('/sales/transactions', payload),
    onSuccess: async (res) => {
      const { transaction_id, loyalty_points_earned } = res.data.data;

      // Link any M-Pesa transactions to the new sale (fire-and-forget)
      const mpesaLines = paymentLines.filter((l) => l.mpesaTxnId);
      for (const l of mpesaLines) {
        api.patch(`/mpesa/${l.mpesaTxnId}/link-sale`, { salesTransactionId: transaction_id })
          .catch((e) => console.error('[mpesa] link-sale failed:', e?.response?.data || e.message));
      }

      let msg = 'Payment successful!';
      if (loyalty_points_earned > 0) msg += ` +${loyalty_points_earned} points earned.`;
      toast.success(msg);
      clearCart();
      onSuccess?.(res.data.data);
      onClose();
    },
    onError: (err, payload) => {
      if (!err.response) {
        enqueueTransaction(payload, session?.session_id);
        toast('No connection — transaction saved for sync', {
          icon: '📶', duration: 4000,
          style: { background: '#fef3c7', color: '#92400e' },
        });
        clearCart();
        onClose();
        return;
      }
      toast.error(err.response?.data?.message || 'Payment failed. Please try again.');
    },
  });

  // Set when M-Pesa resolves so the canProcess effect knows to auto-submit
  const autoSubmitRef = useRef(false);
  const autoSubmitTimerRef = useRef(null);

  // Called by MpesaPanel when STK or manual entry resolves with a confirmed receipt
  const handleMpesaResolved = (methodId, receiptNumber, mpesaTxnId) => {
    autoSubmitRef.current = true;
    setPaymentLines((prev) =>
      prev.map((l) =>
        l.methodId === methodId
          ? { ...l, reference: receiptNumber || '', mpesaTxnId }
          : l
      )
    );
  };

  const handleCharge = useCallback(() => {
    if (!canProcess) return;
    processPayment({
      branchId,
      sessionId:            session?.session_id ?? null,
      customerId:           customer?.customer_id ?? null,
      notes,
      loyaltyPointsRedeemed: pointsToRedeem,
      orderDiscount:         cartTotals.orderDiscountAmt,
      items: items.map((i) => ({
        productId: i.product.product_id,
        quantity:  i.quantity,
        unitPrice: i.unitPrice,
        discount:  i.discount,
        taxAmount: i.taxAmount,
        lineTotal: i.lineTotal,
      })),
      payments: paymentLines.map((l) => {
        const m      = methods.find((m) => m.payment_method_id === l.methodId);
        const isCash = m?.method_name === 'Cash';
        return {
          paymentMethodId: l.methodId,
          amountTendered:  isCash ? parseFloat(l.tendered || 0) : l.amount,
          amountApplied:   l.amount,
          changeGiven:     isCash ? Math.max(0, parseFloat(l.tendered || 0) - l.amount) : 0,
          referenceNumber: l.reference || null,
        };
      }),
    });
  }, [canProcess, processPayment, branchId, session, customer, notes, cartTotals, items, methods, paymentLines, pointsToRedeem]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-submit after M-Pesa resolves and all payment lines are satisfied.
  useEffect(() => {
    if (!autoSubmitRef.current || !canProcess || isPending) return;
    autoSubmitRef.current = false;
    autoSubmitTimerRef.current = setTimeout(() => handleCharge(), 800);
    return () => clearTimeout(autoSubmitTimerRef.current);
  }, [canProcess, handleCharge, isPending]);

  // Cancel any pending auto-submit when modal closes
  useEffect(() => {
    if (!open) {
      autoSubmitRef.current = false;
      clearTimeout(autoSubmitTimerRef.current);
    }
  }, [open]);

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      title="Payment"
      size="md"
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" fullWidth onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button
            variant="accent" fullWidth
            disabled={!canProcess}
            loading={isPending}
            onClick={handleCharge}>
            Process {formatCurrency(netTotal)}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Offline warning */}
        {!isOnline && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5">
            <WifiOff className="h-4 w-4 text-amber-600 flex-shrink-0" />
            <p className="text-xs font-medium text-amber-800">
              You're offline. Payment will be queued and synced when connection is restored.
            </p>
          </div>
        )}

        {/* Customer section */}
        <button
          type="button"
          onClick={() => setCustModalOpen(true)}
          className="w-full flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-left hover:border-primary-300 hover:bg-primary-50 transition-all"
        >
          {customer ? (
            <>
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary-600 text-white text-sm font-bold">
                {customer.customer_name[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{customer.customer_name}</p>
                <p className="text-xs text-gray-400">
                  {customer.phone ? customer.phone + ' · ' : ''}
                  {customer.id_number ? `ID ${customer.id_number} · ` : ''}
                  {customer.customer_id}
                </p>
              </div>
              <span className="text-xs font-medium text-primary-600 flex-shrink-0">Change</span>
            </>
          ) : (
            <>
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gray-200">
                <UserPlus className="h-5 w-5 text-gray-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-600">Add Customer</p>
                <p className="text-xs text-gray-400">Optional — for loyalty &amp; records</p>
              </div>
              <span className="text-xs font-medium text-primary-600 flex-shrink-0">Select</span>
            </>
          )}
        </button>

        {/* Amount summary */}
        <div className="rounded-xl bg-secondary-50 border border-secondary-200 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">Cart Total</p>
            <p className="text-lg font-bold text-gray-900">{formatCurrency(cartTotal)}</p>
          </div>
          {loyaltyDiscount > 0 && (
            <div className="flex items-center justify-between mt-1">
              <p className="text-xs text-amber-600">Loyalty discount ({pointsToRedeem} pts)</p>
              <p className="text-xs font-semibold text-amber-600">-{formatCurrency(loyaltyDiscount)}</p>
            </div>
          )}
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-secondary-200">
            <p className="text-sm font-semibold text-gray-700">Amount Due</p>
            <p className="text-2xl font-bold text-secondary-700">{formatCurrency(netTotal)}</p>
          </div>
        </div>

        {/* Loyalty points redemption */}
        {customer && loyaltyBalance > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Gift className="h-4 w-4 text-amber-600" />
                <span className="text-sm font-semibold text-amber-800">Loyalty Points</span>
              </div>
              <span className="text-xs text-amber-700 font-medium">
                {loyaltyBalance.toLocaleString()} pts available
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input type="range" min="0" max={maxRedeemPoints} step="10"
                value={pointsToRedeem}
                onChange={(e) => setPointsToRedeem(parseInt(e.target.value) || 0)}
                className="flex-1 accent-amber-500" />
              <input type="number" min="0" max={maxRedeemPoints} step="10"
                value={pointsToRedeem}
                onChange={(e) => setPointsToRedeem(Math.min(parseInt(e.target.value) || 0, maxRedeemPoints))}
                className="w-20 rounded-lg border border-amber-200 bg-white px-2 py-1 text-sm text-right font-semibold focus:outline-none focus:border-amber-400" />
            </div>
            {pointsToRedeem > 0 && (
              <p className="mt-1 text-xs text-amber-700">
                Redeeming {pointsToRedeem} pts = {formatCurrency(loyaltyDiscount)} discount
              </p>
            )}
          </div>
        )}

        {/* Method selector */}
        <div>
          <p className="mb-2 text-sm font-medium text-gray-700">Add Payment Method</p>
          <div className="flex flex-wrap gap-2">
            {methods.map((m) => {
              const Icon  = isMpesa(m.method_name) ? Smartphone : (METHOD_ICONS[m.method_name] ?? CreditCard);
              const inUse = paymentLines.some((l) => l.methodId === m.payment_method_id);
              return (
                <button
                  key={m.payment_method_id}
                  onClick={() => addPaymentLine(m)}
                  disabled={inUse || remaining <= 0}
                  className={[
                    'flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-all',
                    isMpesa(m.method_name)
                      ? 'border-green-300 text-green-700 hover:bg-green-50 disabled:opacity-50'
                      : '',
                    inUse
                      ? 'border-primary-300 bg-primary-50 text-primary-600 opacity-60 cursor-default'
                      : remaining <= 0
                      ? 'border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed'
                      : !isMpesa(m.method_name)
                      ? 'border-gray-200 text-gray-600 hover:border-primary-300 hover:bg-primary-50'
                      : '',
                  ].join(' ')}
                >
                  <Icon className="h-4 w-4" />
                  {m.method_name}
                  {inUse && <CheckCircle className="h-3.5 w-3.5 text-primary-500" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Payment lines */}
        {paymentLines.length > 0 && (
          <div className="space-y-2">
            {paymentLines.map((line, idx) => {
              const method = methods.find((m) => m.payment_method_id === line.methodId);
              return isMpesa(method?.method_name) ? (
                <MpesaPanel
                  key={line.methodId}
                  line={line}
                  methods={methods}
                  onReferenceResolved={handleMpesaResolved}
                  onRemove={() => removeLine(idx)}
                />
              ) : (
                <PaymentLine
                  key={line.methodId}
                  line={line}
                  remaining={remaining + line.amount}
                  methods={methods}
                  onRemove={() => removeLine(idx)}
                  onUpdate={(updated) => updateLine(idx, updated)}
                />
              );
            })}
          </div>
        )}

        {/* Remaining balance */}
        {paymentLines.length > 0 && (
          <div className={`flex items-center justify-between rounded-xl px-4 py-2.5 text-sm font-semibold ${
            remaining <= 0
              ? 'bg-green-50 border border-green-200 text-green-700'
              : 'bg-amber-50 border border-amber-200 text-amber-700'
          }`}>
            <span>{remaining <= 0 ? 'Fully covered' : 'Remaining'}</span>
            <span>{remaining <= 0 ? formatCurrency(0) : formatCurrency(remaining)}</span>
          </div>
        )}

        {paymentLines.some((l) => {
          const m = methods.find((m) => m.payment_method_id === l.methodId);
          return isMpesa(m?.method_name) && !l.reference;
        }) && (
          <p className="text-xs text-center text-green-700 font-medium">
            Sale completes automatically once M-Pesa payment is confirmed
          </p>
        )}

        {paymentLines.length === 0 && (
          <p className="text-center text-sm text-gray-400 py-2">
            Select a payment method above to begin
          </p>
        )}
      </div>
    </Modal>
    <CustomerSelectModal open={custModalOpen} onClose={() => setCustModalOpen(false)} />
    </>
  );
}
