import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Smartphone, Search, CheckCircle2, XCircle, Clock, AlertCircle,
  Download, Settings, RefreshCw, Link,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/services/api';
import { formatCurrency, formatDateTime } from '@/utils/formatters';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { PageSpinner } from '@/components/ui/Spinner';
import { usePermission } from '@/hooks/usePermission';
import { exportToExcel } from '@/utils/exportExcel';

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_META = {
  completed: { label: 'Completed', cls: 'bg-green-100  text-green-700',  Icon: CheckCircle2 },
  pending:   { label: 'Pending',   cls: 'bg-yellow-100 text-yellow-700', Icon: Clock },
  failed:    { label: 'Failed',    cls: 'bg-red-100    text-red-600',    Icon: XCircle },
  cancelled: { label: 'Cancelled', cls: 'bg-gray-100   text-gray-500',   Icon: XCircle },
  timeout:   { label: 'Timeout',   cls: 'bg-orange-100 text-orange-600', Icon: AlertCircle },
};

function StatusBadge({ status }) {
  const m = STATUS_META[status] ?? STATUS_META.pending;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${m.cls}`}>
      <m.Icon className="h-3 w-3" />
      {m.label}
    </span>
  );
}

const MODE_META = {
  stk_push: { label: 'STK Push', cls: 'bg-blue-100   text-blue-700'   },
  manual:   { label: 'Manual',   cls: 'bg-purple-100 text-purple-700' },
  c2b:      { label: 'C2B',      cls: 'bg-teal-100   text-teal-700'   },
};

function ModeBadge({ mode }) {
  const m = MODE_META[mode] ?? { label: mode, cls: 'bg-gray-100 text-gray-600' };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${m.cls}`}>{m.label}</span>;
}

// ── Detail row ────────────────────────────────────────────────────────────────

function DetailRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex justify-between text-sm py-1 border-b border-gray-50 last:border-0">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-800 text-right">{value}</span>
    </div>
  );
}

// ── Config modal ──────────────────────────────────────────────────────────────

function ConfigModal({ open, onClose, prefill = null }) {
  const qc = useQueryClient();

  const blank = {
    branchId:       '',
    consumerKey:    '',
    consumerSecret: '',
    shortcode:      '',
    shortcodeType:  'paybill',
    passkey:        '',
    environment:    'sandbox',
    callbackUrl:    '',
  };

  const [form, setForm] = useState(blank);

  // When opening to edit an existing config, pre-fill branch selection
  useEffect(() => {
    if (open) setForm(prefill ? { ...blank, branchId: prefill.branch_id ?? '' } : blank);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn:  () => api.get('/branches').then((r) => r.data.data),
    enabled:  open,
  });

  const { mutate: save, isPending } = useMutation({
    mutationFn: (data) => api.post('/mpesa/config', data),
    onSuccess: () => {
      toast.success('M-Pesa configuration saved');
      qc.invalidateQueries(['mpesa-config']);
      onClose();
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed to save config'),
  });

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const inputCls = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none';
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1';

  return (
    <Modal open={open} onClose={onClose} title="M-Pesa Configuration" size="md"
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" fullWidth onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button variant="primary" fullWidth loading={isPending}
            onClick={() => save({ ...form, branchId: form.branchId || null })}
            disabled={!form.consumerKey || !form.consumerSecret || !form.shortcode || !form.passkey}>
            Save Configuration
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {prefill && (
          <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
            Updating config for <strong>{prefill.branch_name ?? 'company-wide'}</strong> — shortcode <strong>{prefill.shortcode}</strong>.
            Enter new credentials to replace existing values.
          </div>
        )}
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800 space-y-1">
          <p className="font-semibold">Daraja credentials required</p>
          <p>Obtain your Consumer Key, Consumer Secret, Shortcode, and Passkey from the{' '}
            <a href="https://developer.safaricom.co.ke" target="_blank" rel="noreferrer"
              className="underline">Safaricom Developer Portal</a>.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Branch selector */}
          <div className="sm:col-span-full">
            <label className={labelCls}>Branch</label>
            <select className={inputCls} value={form.branchId} onChange={set('branchId')}
              disabled={!!prefill}>
              <option value="">Company-wide (fallback for all branches)</option>
              {branches.map((b) => (
                <option key={b.branch_id} value={b.branch_id}>{b.branch_name}</option>
              ))}
            </select>
          </div>
          <div className="col-span-full">
            <label className={labelCls}>Consumer Key *</label>
            <input className={inputCls} type="text" value={form.consumerKey} onChange={set('consumerKey')} placeholder="From Daraja portal" />
          </div>
          <div className="col-span-full">
            <label className={labelCls}>Consumer Secret *</label>
            <input className={inputCls} type="password" value={form.consumerSecret} onChange={set('consumerSecret')} placeholder="From Daraja portal" />
          </div>
          <div>
            <label className={labelCls}>Shortcode *</label>
            <input className={inputCls} type="text" value={form.shortcode} onChange={set('shortcode')} placeholder="e.g. 174379" />
          </div>
          <div>
            <label className={labelCls}>Shortcode Type</label>
            <select className={inputCls} value={form.shortcodeType} onChange={set('shortcodeType')}>
              <option value="paybill">Paybill</option>
              <option value="till">Buy Goods (Till)</option>
            </select>
          </div>
          <div className="col-span-full">
            <label className={labelCls}>Passkey *</label>
            <input className={inputCls} type="password" value={form.passkey} onChange={set('passkey')} placeholder="Lipa Na M-Pesa online passkey" />
          </div>
          <div>
            <label className={labelCls}>Environment</label>
            <select className={inputCls} value={form.environment} onChange={set('environment')}>
              <option value="sandbox">Sandbox (Test)</option>
              <option value="production">Production (Live)</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Callback URL</label>
            <input className={inputCls} type="url" value={form.callbackUrl} onChange={set('callbackUrl')} placeholder="https://your-domain.com/api/v1/mpesa/callback" />
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── Transaction detail modal ──────────────────────────────────────────────────

function TxnDetail({ txn }) {
  if (!txn) return null;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-3">
        <StatusBadge status={txn.status} />
        <ModeBadge mode={txn.payment_mode} />
      </div>
      <DetailRow label="Amount"         value={formatCurrency(txn.amount)} />
      <DetailRow label="Receipt #"      value={txn.mpesa_receipt_number || '—'} />
      <DetailRow label="Phone"          value={txn.phone_number} />
      <DetailRow label="Account Ref"    value={txn.account_reference} />
      <DetailRow label="Branch"         value={txn.branch_name} />
      <DetailRow label="Linked Sale"    value={txn.sale_number} />
      <DetailRow label="Initiated"      value={formatDateTime(txn.initiated_at)} />
      <DetailRow label="Completed"      value={txn.completed_at ? formatDateTime(txn.completed_at) : null} />
      {txn.failure_reason && (
        <div className="mt-3 rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-sm text-red-700">
          <span className="font-semibold">Failure reason: </span>{txn.failure_reason}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MpesaPage() {
  const qc = useQueryClient();
  const { hasCapability } = usePermission();
  const isAdmin = hasCapability('settings.manage');

  const [search,      setSearch]      = useState('');
  const [status,      setStatus]      = useState('');
  const [mode,        setMode]        = useState('');
  const [startDate,   setStartDate]   = useState('');
  const [endDate,     setEndDate]     = useState('');
  const [page,        setPage]        = useState(1);
  const [selected,    setSelected]    = useState(null);
  const [showConfig,  setShowConfig]  = useState(false);
  const [editConfig,  setEditConfig]  = useState(null);   // config row being edited

  const filters = { search, status, paymentMode: mode, startDate, endDate, page, limit: 25 };

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['mpesa-transactions', filters],
    queryFn:  () => api.get('/mpesa/transactions', { params: filters }).then((r) => r.data.data),
    keepPreviousData: true,
  });

  // Array of per-branch configs (admin only)
  const { data: configs = [] } = useQuery({
    queryKey: ['mpesa-config'],
    queryFn:  () => api.get('/mpesa/config').then((r) => r.data.data),
    enabled:  isAdmin,
    retry:    false,
  });

  const { mutate: registerC2B, isPending: isRegistering } = useMutation({
    mutationFn: (branchId) => api.post('/mpesa/register-c2b', { branchId: branchId || null }),
    onSuccess: (res) => {
      const d = res.data.data;
      toast.success(`C2B registered! Confirmation: ${d.confirmationURL}`);
    },
    onError: (e) => toast.error(e.response?.data?.message || 'C2B registration failed'),
  });

  const transactions = data?.transactions ?? [];
  const total        = data?.total        ?? 0;
  const pages        = data?.pages        ?? 1;

  // Summary stats from current page data
  const completedAmt  = transactions.filter((t) => t.status === 'completed')
    .reduce((s, t) => s + t.amount, 0);
  const completedCount = transactions.filter((t) => t.status === 'completed').length;

  const clearFilters = () => {
    setSearch(''); setStatus(''); setMode('');
    setStartDate(''); setEndDate(''); setPage(1);
  };
  const hasFilters = search || status || mode || startDate || endDate;

  return (
    <div className="space-y-4">

      {/* ── Branch configs list (admin only) ── */}
      {isAdmin && (
        <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-700">M-Pesa Configurations</p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 mr-1">{configs.length} configured</span>
              <Button variant="secondary" size="sm"
                icon={<RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />}
                onClick={() => refetch()}>
                Refresh
              </Button>
              <Button variant="secondary" size="sm" icon={<Settings className="h-4 w-4" />}
                onClick={() => { setEditConfig(null); setShowConfig(true); }}>
                Add Config
              </Button>
              <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />}
                onClick={() => exportToExcel('mpesa-transactions', transactions, [
                  'payment_mode','phone_number','amount','mpesa_receipt_number',
                  'account_reference','status','initiated_at','completed_at','branch_name','sale_number',
                ], [
                  'Mode','Phone','Amount','Receipt #','Account Ref',
                  'Status','Initiated','Completed','Branch','Sale #',
                ])}>
                Export
              </Button>
            </div>
          </div>
          {configs.length === 0 ? (
            <div className="flex items-center gap-3 px-4 py-4">
              <AlertCircle className="h-5 w-5 text-amber-500 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-amber-700">No M-Pesa configuration yet</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Click <strong>Add Config</strong> to set up Daraja credentials per branch.
                </p>
              </div>
            </div>
          ) : (
            <>
            {/* Desktop table — every column always visible */}
            <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Branch</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Shortcode</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Type</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Environment</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Status</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {configs.map((cfg) => (
                  <tr key={cfg.config_id} onClick={() => { setEditConfig(cfg); setShowConfig(true); }}
                    className="cursor-pointer hover:bg-gray-50 active:bg-gray-100">
                    <td className="px-4 py-2.5 font-medium text-gray-800">
                      {cfg.branch_name ?? <span className="text-gray-400 italic">Company-wide</span>}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-700">{cfg.shortcode}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 capitalize">{cfg.shortcode_type}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        cfg.environment === 'production'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-yellow-100 text-yellow-700'
                      }`}>
                        {cfg.environment}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        cfg.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {cfg.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => registerC2B(cfg.branch_id)}
                          disabled={isRegistering}
                          title="Register C2B callback URL with Daraja so direct paybill payments appear here"
                          className="flex items-center gap-1 text-xs text-teal-600 hover:text-teal-800 font-medium disabled:opacity-50">
                          <Link className="h-3 w-3" />
                          Register C2B
                        </button>
                        <button
                          onClick={() => { setEditConfig(cfg); setShowConfig(true); }}
                          className="text-xs text-primary-600 hover:text-primary-800 font-medium">
                          Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>

            {/* Mobile cards */}
            <div className="sm:hidden divide-y divide-gray-50">
              {configs.map((cfg) => (
                <div key={cfg.config_id} onClick={() => { setEditConfig(cfg); setShowConfig(true); }}
                  className="p-4 cursor-pointer active:bg-gray-50">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-gray-800 text-sm">
                        {cfg.branch_name ?? <span className="text-gray-400 italic">Company-wide</span>}
                      </p>
                      <p className="font-mono text-xs text-gray-500">{cfg.shortcode}</p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      cfg.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {cfg.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                    <span className="capitalize">{cfg.shortcode_type}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      cfg.environment === 'production'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {cfg.environment}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => registerC2B(cfg.branch_id)}
                      disabled={isRegistering}
                      title="Register C2B callback URL with Daraja so direct paybill payments appear here"
                      className="flex items-center gap-1 text-xs text-teal-600 hover:text-teal-800 font-medium disabled:opacity-50">
                      <Link className="h-3 w-3" />
                      Register C2B
                    </button>
                    <button
                      onClick={() => { setEditConfig(cfg); setShowConfig(true); }}
                      className="text-xs text-primary-600 hover:text-primary-800 font-medium">
                      Edit
                    </button>
                  </div>
                </div>
              ))}
            </div>
            </>
          )}
        </div>
      )}

      {/* ── Summary cards (visible when there's data) ── */}
      {total > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm min-w-0">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide truncate">Total Records</p>
            <p className="text-2xl font-bold text-gray-900 mt-1 truncate">{total}</p>
          </div>
          <div className="rounded-xl border border-green-100 bg-green-50 p-4 min-w-0">
            <p className="text-xs text-green-600 font-medium uppercase tracking-wide truncate">Collected (this page)</p>
            <p className="text-2xl font-bold text-green-700 mt-1 truncate">{formatCurrency(completedAmt)}</p>
          </div>
          <div className="rounded-xl border border-green-100 bg-green-50 p-4 min-w-0">
            <p className="text-xs text-green-600 font-medium uppercase tracking-wide truncate">Completed (this page)</p>
            <p className="text-2xl font-bold text-green-700 mt-1 truncate">{completedCount}</p>
          </div>
        </div>
      )}

      {/* ── Filters ── */}
      <div className="flex flex-wrap gap-3 rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
        <div className="relative flex-1 min-w-44">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Receipt #, phone, or sale #…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none" />
        </div>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none">
          <option value="">All Statuses</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
          <option value="timeout">Timeout</option>
        </select>
        <select value={mode} onChange={(e) => { setMode(e.target.value); setPage(1); }}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none">
          <option value="">All Modes</option>
          <option value="stk_push">STK Push</option>
          <option value="c2b">C2B (Direct Paybill)</option>
          <option value="manual">Manual Entry</option>
        </select>
        <input type="date" value={startDate}
          onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
        <span className="flex items-center text-gray-400 text-sm">to</span>
        <input type="date" value={endDate}
          onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
        {hasFilters && (
          <button onClick={clearFilters} className="text-xs text-gray-400 hover:text-gray-600 px-2">
            Clear
          </button>
        )}
      </div>

      {/* ── Table ── */}
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        {isLoading ? <PageSpinner /> : transactions.length === 0 ? (
          <div className="py-12 text-center text-gray-400">
            <Smartphone className="mx-auto mb-2 h-8 w-8 opacity-30" />
            No M-Pesa transactions found
          </div>
        ) : (
          <>
          {/* Desktop table — every column always visible */}
          <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Mode</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Phone</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Amount</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Receipt #</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Date &amp; Time</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Branch</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Linked Sale</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {transactions.map((t) => (
                <tr key={t.mpesa_txn_id} onClick={() => setSelected(t)}
                  className="cursor-pointer hover:bg-gray-50 active:bg-gray-100 transition-colors">
                  <td className="px-4 py-3">
                    <ModeBadge mode={t.payment_mode} />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">
                    {t.phone_number || '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900">
                    {formatCurrency(t.amount)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-green-700 font-semibold">
                    {t.mpesa_receipt_number || <span className="text-gray-400 font-normal">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {formatDateTime(t.initiated_at)}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {t.branch_name || '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-primary-600">
                    {t.sale_number || <span className="text-gray-400 font-normal">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge status={t.status} />
                  </td>
                  <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => setSelected(t)}
                      className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-100 transition-colors">
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
              <div key={t.mpesa_txn_id} onClick={() => setSelected(t)}
                className="rounded-xl border border-gray-100 bg-white p-3 active:bg-gray-50 transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <ModeBadge mode={t.payment_mode} />
                      <StatusBadge status={t.status} />
                    </div>
                    <p className="mt-1 font-mono text-xs text-gray-700">{t.phone_number || '—'}</p>
                  </div>
                  <span className="shrink-0 font-semibold text-gray-900">{formatCurrency(t.amount)}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                  <span>{formatDateTime(t.initiated_at)}</span>
                  {t.mpesa_receipt_number && <span className="font-mono text-green-700 font-semibold">{t.mpesa_receipt_number}</span>}
                  {t.branch_name && <span>{t.branch_name}</span>}
                  {t.sale_number && <span className="font-mono text-primary-600">{t.sale_number}</span>}
                </div>
                <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => setSelected(t)}
                    className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-100 transition-colors">
                    View
                  </button>
                </div>
              </div>
            ))}
          </div>
          </>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
            <p className="text-xs text-gray-500">Page {page} of {pages} ({total} total)</p>
            <div className="flex gap-1">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)}
                className="rounded-md border border-gray-200 px-3 py-1 text-xs disabled:opacity-40 hover:bg-gray-50">
                ← Prev
              </button>
              <button disabled={page >= pages} onClick={() => setPage(page + 1)}
                className="rounded-md border border-gray-200 px-3 py-1 text-xs disabled:opacity-40 hover:bg-gray-50">
                Next →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Detail modal ── */}
      <Modal open={!!selected} onClose={() => setSelected(null)} title="M-Pesa Transaction" size="sm">
        <TxnDetail txn={selected} />
      </Modal>

      {/* ── Config modal ── */}
      <ConfigModal
        open={showConfig}
        onClose={() => { setShowConfig(false); setEditConfig(null); }}
        prefill={editConfig}
      />
    </div>
  );
}
