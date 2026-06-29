import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Landmark, Plus, Edit2, Star, BookOpen, Calendar, ArrowDownLeft, ArrowUpRight, CheckSquare, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/services/api';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { PageSpinner } from '@/components/ui/Spinner';
import { formatCurrency, formatDate, todayLocal } from '@/utils/formatters';

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500';
const sel = inp + ' bg-white';
const Field = ({ label, children, hint }) => (
  <div>
    <label className="mb-1 block text-xs font-medium text-gray-700">{label}</label>
    {children}
    {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
  </div>
);

// ── Bank Account Modal ────────────────────────────────────────────────────────

function BankAccountModal({ account, accounts: coaAccounts, onClose }) {
  const qc = useQueryClient();
  const isEdit = !!account;

  const [form, setForm] = useState({
    account_name:    account?.account_name    ?? '',
    bank_name:       account?.bank_name       ?? '',
    account_number:  account?.account_number  ?? '',
    bank_branch:     account?.bank_branch     ?? '',
    currency:        account?.currency        ?? 'KES',
    opening_balance: account?.opening_balance ?? '0',
    is_default:      account?.is_default      ?? false,
    account_id:      account?.account_id      ?? '',
    notes:           account?.notes           ?? '',
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const { mutate, isPending } = useMutation({
    mutationFn: (data) => isEdit
      ? api.patch(`/bank-accounts/${account.bank_account_id}`, data)
      : api.post('/bank-accounts', data),
    onSuccess: () => {
      toast.success(isEdit ? 'Bank account updated' : 'Bank account added');
      qc.invalidateQueries({ queryKey: ['bank-accounts'] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Save failed'),
  });

  const handleSave = () => {
    if (!form.account_name) { toast.error('Account name is required'); return; }
    if (!form.bank_name)    { toast.error('Bank name is required');    return; }
    mutate({ ...form, account_id: form.account_id || null, opening_balance: parseFloat(form.opening_balance) || 0 });
  };

  const assetAccounts = (Array.isArray(coaAccounts) ? coaAccounts : []).filter((a) => a.account_type === 'asset' && a.is_active);

  return (
    <Modal open onClose={onClose} title={isEdit ? 'Edit Bank Account' : 'Add Bank Account'}
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button>
          <Button fullWidth loading={isPending} onClick={handleSave}>
            {isEdit ? 'Save Changes' : 'Add Account'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-full">
            <Field label="Account Name *">
              <input value={form.account_name} onChange={(e) => set('account_name', e.target.value)}
                placeholder="e.g. KCB Business Account" className={inp} />
            </Field>
          </div>
          <Field label="Bank Name *">
            <input value={form.bank_name} onChange={(e) => set('bank_name', e.target.value)}
              placeholder="e.g. KCB Bank" className={inp} />
          </Field>
          <Field label="Account Number">
            <input value={form.account_number} onChange={(e) => set('account_number', e.target.value)}
              placeholder="1234567890" className={inp} />
          </Field>
          <Field label="Bank Branch">
            <input value={form.bank_branch} onChange={(e) => set('bank_branch', e.target.value)}
              placeholder="e.g. Westlands" className={inp} />
          </Field>
          <Field label="Currency">
            <select value={form.currency} onChange={(e) => set('currency', e.target.value)} className={sel}>
              <option value="KES">KES</option>
              <option value="USD">USD</option>
              <option value="UGX">UGX</option>
              <option value="TZS">TZS</option>
            </select>
          </Field>
          {!isEdit && (
            <div className="col-span-full">
              <Field label="Opening Balance" hint="Current balance at the time of setup">
                <input type="number" value={form.opening_balance}
                  onChange={(e) => set('opening_balance', e.target.value)} className={inp} />
              </Field>
            </div>
          )}
          <div className="col-span-full">
            <Field label="Link to Chart of Accounts" hint="Optional — links this bank account to a CoA asset account">
              <select value={form.account_id} onChange={(e) => set('account_id', e.target.value)} className={sel}>
                <option value="">Not linked</option>
                {assetAccounts.map((a) => (
                  <option key={a.account_id} value={a.account_id}>{a.account_code} — {a.account_name}</option>
                ))}
              </select>
            </Field>
          </div>
        </div>
        <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
          <input type="checkbox" checked={form.is_default} onChange={(e) => set('is_default', e.target.checked)}
            className="rounded border-gray-300 text-primary-600" />
          Set as default bank account
        </label>
        <Field label="Notes">
          <textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)}
            className={inp + ' resize-none'} />
        </Field>
      </div>
    </Modal>
  );
}

// ── Bank Account Detail Modal ─────────────────────────────────────────────────

function BankAccountDetailModal({ account, onClose, onEdit, onReconcile, onNavigateLedger }) {
  return (
    <Modal open onClose={onClose} title={account.account_name}
      footer={
        <div className="flex flex-col gap-2 w-full">
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth icon={<BookOpen className="h-4 w-4" />}
              onClick={onNavigateLedger}>
              Transactions
            </Button>
            <Button variant="secondary" fullWidth icon={<CheckSquare className="h-4 w-4" />}
              onClick={onReconcile}>
              Reconcile
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={onClose}>Close</Button>
            <Button fullWidth icon={<Edit2 className="h-4 w-4" />} onClick={() => { onClose(); onEdit(account); }}>
              Edit
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="rounded-lg bg-primary-50 border border-primary-200 px-4 py-3 text-center">
          <p className="text-xs text-gray-500">Current Balance</p>
          <p className={`text-2xl font-bold mt-0.5 ${parseFloat(account.current_balance) >= 0 ? 'text-primary-700' : 'text-red-600'}`}>
            {account.currency} {formatCurrency(account.current_balance).replace('KES', '').trim()}
          </p>
        </div>
        <dl className="divide-y divide-gray-100 text-sm">
          {[
            ['Bank',          account.bank_name],
            ['Account No.',   account.account_number || '—'],
            ['Branch',        account.bank_branch    || '—'],
            ['Currency',      account.currency],
            ['CoA Account',   account.coa_account_name || 'Not linked'],
            ['Default',       account.is_default ? 'Yes' : 'No'],
          ].map(([label, val]) => (
            <div key={label} className="flex items-center justify-between py-2">
              <dt className="text-gray-500">{label}</dt>
              <dd className="font-medium text-gray-900 text-right">{val}</dd>
            </div>
          ))}
        </dl>
        {account.notes && (
          <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
            <span className="text-gray-400">Notes: </span>{account.notes}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Bank Ledger type → badge colour ──────────────────────────────────────────
const BANK_TYPE_COLORS = {
  SALE:           'bg-green-100 text-green-700',
  AR_SETTLEMENT:  'bg-teal-100 text-teal-700',
  GRN:            'bg-blue-100 text-blue-700',
  PAYMENT:        'bg-red-100 text-red-600',
  RETURN:         'bg-amber-100 text-amber-700',
  OPENING:        'bg-purple-100 text-purple-700',
  MANUAL:         'bg-gray-100 text-gray-600',
  VOID:           'bg-rose-100 text-rose-700',
};

// ── Bank Account Ledger Modal ─────────────────────────────────────────────────

function toISO(d) { return d.toISOString().slice(0, 10); }
const todayISO = toISO(new Date());

function BankLedgerModal({ account, onClose }) {
  const [startDate, setStart] = useState(toISO(new Date(Date.now() - 29 * 86400000)));
  const [endDate,   setEnd]   = useState(todayISO);
  const [page, setPage]       = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['bank-ledger', account.bank_account_id, startDate, endDate, page],
    queryFn:  () => api.get(`/bank-accounts/${account.bank_account_id}/ledger`, {
      params: { startDate, endDate, page, limit: 30 },
    }).then((r) => r.data.data),
    placeholderData: (prev) => prev,
  });

  const { entries = [], total = 0, pages = 1, summary = {}, warning } = data ?? {};

  return (
    <Modal open onClose={onClose} size="xl"
      title={
        <div>
          <div className="flex items-center gap-2">
            <Landmark className="h-4 w-4 text-primary-600" />
            <p className="text-sm font-semibold text-gray-900">{account.account_name}</p>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">{account.bank_name}{account.account_number ? ` · ${account.account_number}` : ''}</p>
        </div>
      }
      footer={<Button variant="secondary" fullWidth onClick={onClose}>Close</Button>}
    >
      <div className="space-y-4">
        {/* Balance + summary row */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-primary-50 border border-primary-200 p-3 text-center">
            <p className="text-xs text-gray-500">Current Balance</p>
            <p className="text-base font-bold text-primary-700 mt-0.5">{account.currency} {formatCurrency(account.current_balance).replace('KES', '').trim()}</p>
          </div>
          <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-center">
            <p className="text-xs text-gray-500 flex items-center justify-center gap-1"><ArrowDownLeft className="h-3 w-3 text-green-600" />Money In</p>
            <p className="text-base font-bold text-green-700 mt-0.5">{formatCurrency(summary.totalIn ?? 0)}</p>
          </div>
          <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-center">
            <p className="text-xs text-gray-500 flex items-center justify-center gap-1"><ArrowUpRight className="h-3 w-3 text-red-500" />Money Out</p>
            <p className="text-base font-bold text-red-600 mt-0.5">{formatCurrency(summary.totalOut ?? 0)}</p>
          </div>
        </div>

        {/* Warning: bank account not linked to CoA */}
        {warning && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800">
            ⚠ {warning}
          </div>
        )}

        {/* Date range */}
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 w-fit">
          <Calendar className="h-3.5 w-3.5 text-gray-400" />
          <input type="date" value={startDate} max={endDate}
            onChange={(e) => { setStart(e.target.value); setPage(1); }}
            className="text-xs border-none outline-none bg-transparent" />
          <span className="text-gray-400 text-xs">—</span>
          <input type="date" value={endDate} min={startDate} max={todayISO}
            onChange={(e) => { setEnd(e.target.value); setPage(1); }}
            className="text-xs border-none outline-none bg-transparent" />
        </div>

        {/* Entries table */}
        {isLoading ? <PageSpinner /> : entries.length === 0 ? (
          <p className="py-8 text-center text-gray-400 text-sm">No transactions for this period</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-100">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500">Date</th>
                  <th className="hidden sm:table-cell px-3 py-2.5 text-left text-xs font-medium text-gray-500">Type</th>
                  <th className="hidden sm:table-cell px-3 py-2.5 text-left text-xs font-medium text-gray-500">Reference</th>
                  <th className="hidden md:table-cell px-3 py-2.5 text-left text-xs font-medium text-gray-500">Description</th>
                  <th className="px-3 py-2.5 text-right text-xs font-medium text-green-600">In (Cr)</th>
                  <th className="px-3 py-2.5 text-right text-xs font-medium text-red-500">Out (Dr)</th>
                  <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {entries.map((e, idx) => (
                  <tr key={`${e.lineId ?? e.entryId ?? idx}`} className="hover:bg-gray-50 active:bg-gray-100">
                    <td className="px-3 py-2.5 text-gray-500 text-xs whitespace-nowrap">{formatDate(e.entryDate)}</td>
                    <td className="hidden sm:table-cell px-3 py-2.5">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${BANK_TYPE_COLORS[e.sourceType] ?? 'bg-gray-100 text-gray-600'}`}>
                        {e.sourceType ?? '—'}
                      </span>
                    </td>
                    <td className="hidden sm:table-cell px-3 py-2.5 font-mono text-xs text-gray-600 truncate">{e.sourceRef ?? e.entryNumber}</td>
                    <td className="hidden md:table-cell px-3 py-2.5 text-xs text-gray-700">
                      <p className="truncate" title={e.description}>{e.description}</p>
                    </td>
                    {/* For bank/cash accounts: debit = money in, credit = money out */}
                    <td className="px-3 py-2.5 text-right font-mono text-xs">
                      {e.debit > 0 ? <span className="font-semibold text-green-700">{formatCurrency(e.debit)}</span> : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs">
                      {e.credit > 0 ? <span className="font-semibold text-red-600">{formatCurrency(e.credit)}</span> : <span className="text-gray-300">—</span>}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-mono text-xs font-semibold ${(e.balance ?? 0) >= 0 ? 'text-gray-800' : 'text-red-600'}`}>
                      {e.balance != null ? formatCurrency(e.balance) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>Page {page} of {pages} · {total} transactions</span>
            <div className="flex gap-1">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
                className="rounded border px-3 py-1 disabled:opacity-40 hover:bg-gray-50">Prev</button>
              <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)}
                className="rounded border px-3 py-1 disabled:opacity-40 hover:bg-gray-50">Next</button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Reconciliation Modal ──────────────────────────────────────────────────────

function ReconciliationModal({ account, onClose }) {
  const qc = useQueryClient();
  const [startDate, setStart] = useState(new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10));
  const [endDate,   setEnd]   = useState(todayLocal());
  const [selected,  setSelected] = useState(new Set());

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['unreconciled', account?.bank_account_id, startDate, endDate],
    queryFn:  () => api.get('/journal/unreconciled', {
      params: { bankAccountId: account?.bank_account_id, startDate, endDate },
    }).then((r) => r.data.data),
    enabled: !!account,
  });

  const lines = data?.lines ?? [];

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const toggleAll = () => {
    if (selected.size === lines.length) setSelected(new Set());
    else setSelected(new Set(lines.map((l) => l.lineId)));
  };

  const { mutate, isPending } = useMutation({
    mutationFn: (lineIds) => api.post('/journal/reconcile', { lineIds }),
    onSuccess: (r) => {
      toast.success(`${r.data.data.reconciled} lines marked as reconciled`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['unreconciled'] });
      refetch();
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Reconcile failed'),
  });

  const selectedTotal = lines
    .filter((l) => selected.has(l.lineId))
    .reduce((s, l) => s + l.debit - l.credit, 0);

  return (
    <Modal open onClose={onClose} title={`Reconcile — ${account?.account_name}`} size="xl"
      footer={
        <div className="flex items-center justify-between gap-3 w-full">
          <span className="text-sm text-gray-500">
            {selected.size} selected · Net: <span className={`font-semibold ${selectedTotal >= 0 ? 'text-green-700' : 'text-red-600'}`}>{formatCurrency(selectedTotal)}</span>
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Close</Button>
            <Button disabled={selected.size === 0} loading={isPending}
              onClick={() => mutate([...selected])}>
              Mark Reconciled ({selected.size})
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        {/* Date filter */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5">
            <Calendar className="h-3.5 w-3.5 text-gray-400" />
            <input type="date" value={startDate} max={endDate}
              onChange={(e) => setStart(e.target.value)}
              className="text-xs border-none outline-none bg-transparent" />
            <span className="text-gray-400 text-xs">—</span>
            <input type="date" value={endDate} min={startDate}
              onChange={(e) => setEnd(e.target.value)}
              className="text-xs border-none outline-none bg-transparent" />
          </div>
        </div>

        {isLoading ? (
          <p className="text-center text-gray-400 py-8 text-sm">Loading…</p>
        ) : lines.length === 0 ? (
          <div className="text-center py-10">
            <CheckSquare className="mx-auto h-10 w-10 text-green-400 mb-2" />
            <p className="text-gray-500 font-medium">All clear</p>
            <p className="text-gray-400 text-sm mt-1">No unreconciled cash lines in this period</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-100">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2.5 w-8">
                    <input type="checkbox" checked={selected.size === lines.length && lines.length > 0}
                      onChange={toggleAll} className="rounded" />
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500">Date</th>
                  <th className="hidden sm:table-cell px-3 py-2.5 text-left text-xs font-medium text-gray-500">Ref</th>
                  <th className="hidden sm:table-cell px-3 py-2.5 text-left text-xs font-medium text-gray-500">Type</th>
                  <th className="hidden md:table-cell px-3 py-2.5 text-left text-xs font-medium text-gray-500">Description</th>
                  <th className="px-3 py-2.5 text-right text-xs font-medium text-green-600">In</th>
                  <th className="px-3 py-2.5 text-right text-xs font-medium text-red-500">Out</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lines.map((l) => (
                  <tr key={l.lineId} onClick={() => toggle(l.lineId)}
                    className={`cursor-pointer transition-colors ${selected.has(l.lineId) ? 'bg-primary-50' : 'hover:bg-gray-50 active:bg-gray-100'}`}>
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(l.lineId)} onChange={() => toggle(l.lineId)} className="rounded" />
                    </td>
                    <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">{formatDate(l.entryDate)}</td>
                    <td className="hidden sm:table-cell px-3 py-2.5 font-mono text-xs text-gray-600">{l.entryNumber}</td>
                    <td className="hidden sm:table-cell px-3 py-2.5">
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{l.sourceType}</span>
                    </td>
                    <td className="hidden md:table-cell px-3 py-2.5 text-xs text-gray-700 max-w-xs truncate">{l.description}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs">
                      {l.debit > 0 ? <span className="text-green-700 font-semibold">{formatCurrency(l.debit)}</span> : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs">
                      {l.credit > 0 ? <span className="text-red-600 font-semibold">{formatCurrency(l.credit)}</span> : <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function BankAccountsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [editTarget,       setEditTarget]       = useState(null);
  const [createOpen,       setCreateOpen]       = useState(false);
  const [reconcileTarget,  setReconcileTarget]  = useState(null);

  const { data: accounts = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: () => api.get('/bank-accounts').then((r) => r.data.data),
  });

  const { data: coaAccounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get('/accounts').then((r) => r.data.data ?? []),
  });

  const total = accounts.reduce((s, a) => s + parseFloat(a.current_balance || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm"
          icon={<RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />}
          onClick={() => refetch()}>
          Refresh
        </Button>
        <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>
          Add Bank Account
        </Button>
      </div>

      {/* Summary card */}
      {accounts.length > 0 && (
        <div className="rounded-xl bg-primary-500 text-white p-5">
          <p className="text-sm text-white/60">Total Cash Balance</p>
          <p className="text-3xl font-bold mt-1">{formatCurrency(total)}</p>
          <p className="text-xs text-white/40 mt-1">Across {accounts.length} account{accounts.length !== 1 ? 's' : ''}</p>
        </div>
      )}

      {isLoading ? <PageSpinner /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {accounts.map((acc) => (
            <div key={acc.bank_account_id}
              className={`rounded-xl border bg-white shadow-sm p-5 space-y-3 ${!acc.is_active ? 'opacity-50' : ''}`}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100">
                    <Landmark className="h-5 w-5 text-primary-700" />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">{acc.account_name}</p>
                    <p className="text-xs text-gray-500">{acc.bank_name}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {acc.is_default && (
                    <Star className="h-4 w-4 text-amber-400 fill-amber-400" title="Default account" />
                  )}
                  <button onClick={() => setEditTarget(acc)}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
                    Edit
                  </button>
                </div>
              </div>

              <div className="rounded-lg bg-gray-50 px-3 py-2.5">
                <p className="text-xs text-gray-500">Current Balance</p>
                <p className={`text-xl font-bold mt-0.5 ${parseFloat(acc.current_balance) >= 0 ? 'text-gray-900' : 'text-red-600'}`}>
                  {acc.currency} {formatCurrency(acc.current_balance).replace('KES', '').trim()}
                </p>
              </div>

              <div className="text-xs text-gray-400 space-y-0.5">
                {acc.account_number && <p>Acc #: {acc.account_number}</p>}
                {acc.bank_branch    && <p>Branch: {acc.bank_branch}</p>}
                {acc.coa_account_name && <p>CoA: {acc.coa_account_name}</p>}
              </div>

              <div className="flex gap-2">
                <button onClick={() => navigate(`/app/bank-accounts/${acc.bank_account_id}/ledger`)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 py-2 text-xs font-medium text-gray-600 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 transition-colors">
                  <BookOpen className="h-3.5 w-3.5" />
                  Transactions
                </button>
                <button onClick={() => setReconcileTarget(acc)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 py-2 text-xs font-medium text-gray-600 hover:border-green-300 hover:bg-green-50 hover:text-green-700 transition-colors">
                  <CheckSquare className="h-3.5 w-3.5" />
                  Reconcile
                </button>
              </div>
            </div>
          ))}
          {accounts.length === 0 && (
            <div className="col-span-3 rounded-xl border border-dashed border-gray-200 py-16 text-center">
              <Landmark className="mx-auto h-10 w-10 text-gray-300 mb-3" />
              <p className="text-gray-500 font-medium">No bank accounts yet</p>
              <p className="text-gray-400 text-sm mt-1">Add a bank account to track cash positions.</p>
            </div>
          )}
        </div>
      )}

      {createOpen && (
        <BankAccountModal accounts={coaAccounts} onClose={() => setCreateOpen(false)} />
      )}
      {editTarget && (
        <BankAccountModal account={editTarget} accounts={coaAccounts} onClose={() => setEditTarget(null)} />
      )}
      {reconcileTarget && (
        <ReconciliationModal account={reconcileTarget} onClose={() => setReconcileTarget(null)} />
      )}
    </div>
  );
}
