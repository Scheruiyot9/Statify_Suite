import { useState, useRef, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ScrollText, Plus, XCircle, RefreshCw, Download, Upload,
  AlertCircle, CheckCircle2, Building2, User, Briefcase, BookOpen, Edit2,
  ArrowDownLeft, Calendar,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';
import { todayLocal } from '@/utils/formatters';
import api from '@/services/api';
import Modal from '@/components/ui/Modal';

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n) =>
  Number(n).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS_COLORS = {
  draft:  'bg-amber-100 text-amber-700',
  posted: 'bg-green-100 text-green-700',
  void:   'bg-red-100 text-red-700',
};

// ── Line type definitions ─────────────────────────────────────────────────────

const LINE_TYPES = [
  { id: 'account',  label: 'Account',  icon: BookOpen  },
  { id: 'bank',     label: 'Bank',     icon: Building2 },
  { id: 'customer', label: 'Customer', icon: User      },
  { id: 'supplier', label: 'Supplier', icon: Briefcase },
];

const emptyLine = () => ({ lineType: 'account', entityId: '', accountId: '', debit: '', credit: '', description: '' });

// ── Lines form (shared between create + edit) ─────────────────────────────────
// Columns: Type | Account / Entity | Line Note | Debit | Credit | Del

function JournalLinesForm({ accounts, bankAccounts, customers, suppliers, lines, onChange }) {
  const arAccount = useMemo(() => accounts.find((a) => a.account_code === '1100'), [accounts]);
  const apAccount = useMemo(() => accounts.find((a) => a.account_code === '2000'), [accounts]);

  const addLine    = () => onChange([...lines, emptyLine()]);
  const removeLine = (i) => onChange(lines.filter((_, idx) => idx !== i));
  const updateLine = (i, l) => onChange(lines.map((x, idx) => (idx === i ? l : x)));

  const handleTypeChange = (i, newType) => {
    updateLine(i, { ...lines[i], lineType: newType, entityId: '', accountId: '', description: '' });
  };

  const handleEntityChange = (i, entityId) => {
    const l = lines[i];
    let accountId = l.accountId;
    let description = l.description;
    let _entityType = l.lineType;
    if (l.lineType === 'bank') {
      const ba = bankAccounts.find((b) => b.bank_account_id === entityId);
      accountId   = ba?.account_id ?? '';
      description = ba ? `${ba.bank_name} – ${ba.account_name}` : '';
      _entityType = 'bank_account';
    } else if (l.lineType === 'customer') {
      const cust = customers.find((c) => c.customer_id === entityId);
      accountId   = arAccount?.account_id ?? '';
      description = cust ? cust.customer_name : '';
    } else if (l.lineType === 'supplier') {
      const sup = suppliers.find((s) => s.supplier_id === entityId);
      accountId   = sup?.account_id ?? apAccount?.account_id ?? '';
      description = sup ? sup.supplier_name : '';
    }
    updateLine(i, { ...l, entityId, accountId, description, _entityType });
  };

  const totalDr  = lines.reduce((s, l) => s + (parseFloat(l.debit)  || 0), 0);
  const totalCr  = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const balanced = Math.abs(totalDr - totalCr) < 0.005;

  const selectCls = 'w-full border rounded-lg px-2 py-1.5 text-xs bg-white focus:border-primary-500 focus:outline-none';

  return (
    <>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-2 py-2 font-medium text-gray-600 w-28">Type</th>
              <th className="text-left px-2 py-2 font-medium text-gray-600">Account / Entity</th>
              <th className="text-left px-2 py-2 font-medium text-gray-600 w-36">Line Note</th>
              <th className="text-right px-2 py-2 font-medium text-gray-600 w-24">Debit</th>
              <th className="text-right px-2 py-2 font-medium text-gray-600 w-24">Credit</th>
              <th className="w-7" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {lines.map((l, i) => (
              <tr key={i} className="align-middle">
                {/* ── Type column ── */}
                <td className="px-2 py-1.5">
                  <select value={l.lineType} onChange={(e) => handleTypeChange(i, e.target.value)}
                    className={selectCls}>
                    {LINE_TYPES.map(({ id, label }) => (
                      <option key={id} value={id}>{label}</option>
                    ))}
                  </select>
                </td>

                {/* ── Account / Entity column ── */}
                <td className="px-2 py-1.5">
                  {l.lineType === 'account' && (
                    <select className={selectCls} value={l.accountId}
                      onChange={(e) => updateLine(i, { ...l, accountId: e.target.value })}>
                      <option value="">Select account…</option>
                      {['asset','liability','equity','revenue','expense'].map((type) => {
                        const group = accounts.filter((a) => a.account_type === type && a.is_active);
                        if (!group.length) return null;
                        return (
                          <optgroup key={type} label={type.charAt(0).toUpperCase() + type.slice(1)}>
                            {group.map((a) => (
                              <option key={a.account_id} value={a.account_id}>
                                {a.account_code} — {a.account_name}
                              </option>
                            ))}
                          </optgroup>
                        );
                      })}
                    </select>
                  )}
                  {l.lineType === 'bank' && (
                    <select className={selectCls} value={l.entityId}
                      onChange={(e) => handleEntityChange(i, e.target.value)}>
                      <option value="">Select bank account…</option>
                      {bankAccounts.map((b) => (
                        <option key={b.bank_account_id} value={b.bank_account_id}>
                          {b.bank_name} – {b.account_name}{b.account_number ? ` (…${b.account_number.slice(-4)})` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                  {l.lineType === 'customer' && (
                    <select className={selectCls} value={l.entityId}
                      onChange={(e) => handleEntityChange(i, e.target.value)}>
                      <option value="">Select customer…</option>
                      {customers.map((c) => (
                        <option key={c.customer_id} value={c.customer_id}>
                          {c.customer_name}{c.phone ? ` — ${c.phone}` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                  {l.lineType === 'supplier' && (
                    <select className={selectCls} value={l.entityId}
                      onChange={(e) => handleEntityChange(i, e.target.value)}>
                      <option value="">Select supplier…</option>
                      {suppliers.map((s) => (
                        <option key={s.supplier_id} value={s.supplier_id}>{s.supplier_name}</option>
                      ))}
                    </select>
                  )}
                  {/* GL hint for entity types */}
                  {l.lineType !== 'account' && l.accountId && (
                    <p className="text-[10px] text-gray-400 mt-0.5 pl-0.5">
                      GL {accounts.find((a) => a.account_id === l.accountId)?.account_code}
                      {' '}{accounts.find((a) => a.account_id === l.accountId)?.account_name}
                    </p>
                  )}
                  {l.lineType !== 'account' && !l.accountId && l.entityId && (
                    <p className="text-[10px] text-amber-500 mt-0.5 pl-0.5">⚠ No GL account linked</p>
                  )}
                </td>

                {/* ── Note ── */}
                <td className="px-2 py-1.5">
                  <input className="w-full border rounded-lg px-2 py-1.5 text-xs"
                    placeholder="Note…" value={l.description}
                    onChange={(e) => updateLine(i, { ...l, description: e.target.value })} />
                </td>

                {/* ── Debit ── */}
                <td className="px-2 py-1.5">
                  <input type="number" min="0" step="0.01" placeholder="0.00"
                    className="w-full border rounded-lg px-2 py-1.5 text-xs text-right"
                    value={l.debit}
                    onChange={(e) => updateLine(i, { ...l, debit: e.target.value, credit: e.target.value ? '' : l.credit })} />
                </td>

                {/* ── Credit ── */}
                <td className="px-2 py-1.5">
                  <input type="number" min="0" step="0.01" placeholder="0.00"
                    className="w-full border rounded-lg px-2 py-1.5 text-xs text-right"
                    value={l.credit}
                    onChange={(e) => updateLine(i, { ...l, credit: e.target.value, debit: e.target.value ? '' : l.debit })} />
                </td>

                <td className="px-2 py-1.5 text-center">
                  {lines.length > 2 && (
                    <button onClick={() => removeLine(i)} className="text-gray-300 hover:text-red-500 transition-colors">
                      <XCircle className="h-4 w-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t bg-gray-50">
            <tr>
              <td colSpan={3} className="px-2 py-1.5 text-sm font-semibold">Totals</td>
              <td className={`px-2 py-1.5 text-right font-mono font-semibold text-sm ${!balanced && totalDr > 0 ? 'text-red-600' : 'text-green-700'}`}>
                {fmt(totalDr)}
              </td>
              <td className={`px-2 py-1.5 text-right font-mono font-semibold text-sm ${!balanced && totalDr > 0 ? 'text-red-600' : 'text-green-700'}`}>
                {fmt(totalCr)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button onClick={addLine} className="text-sm text-primary-600 hover:underline">+ Add line</button>
        {!balanced && totalDr > 0 && (
          <p className="text-sm text-red-600 flex items-center gap-1">
            <AlertCircle className="h-4 w-4" />
            Not balanced — difference: {fmt(Math.abs(totalDr - totalCr))}
          </p>
        )}
      </div>
    </>
  );
}

// ── Create / Edit Journal Modal ───────────────────────────────────────────────

function JournalFormModal({ existing, accounts, onClose }) {
  const qc = useQueryClient();
  const isEdit = !!existing;

  const [entryDate,    setEntryDate]    = useState(existing?.entry_date?.slice(0, 10) ?? new Intl.DateTimeFormat('en-CA').format(new Date()));
  const [description,  setDescription]  = useState(existing?.description ?? '');
  const [reference,    setReference]    = useState(existing?.reference ?? '');
  const [lines,        setLines]        = useState(
    existing?.lines?.length
      ? existing.lines.map((l) => ({
          lineType:    'account',
          entityId:    l.entityId ?? '',
          accountId:   l.accountId,
          debit:       l.debit  > 0 ? String(l.debit)  : '',
          credit:      l.credit > 0 ? String(l.credit) : '',
          description: l.description ?? '',
          _entityType: l.entityType ?? null,
        }))
      : [emptyLine(), emptyLine()]
  );
  const [error, setError] = useState('');

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: () => api.get('/bank-accounts').then((r) => r.data.data ?? []),
  });
  const { data: customers = [] } = useQuery({
    queryKey: ['customers-list'],
    queryFn: () => api.get('/customers', { params: { limit: 200 } }).then((r) => r.data.data?.customers ?? []),
  });
  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: () => api.get('/suppliers', { params: { limit: 200 } }).then((r) => r.data.data?.suppliers ?? []),
  });

  const buildPayload = () => {
    const validLines = lines.filter((l) => l.accountId);
    return {
      entryDate, description, reference: reference || undefined,
      lines: validLines.map((l) => ({
        accountId:   l.accountId,
        debit:       parseFloat(l.debit)  || 0,
        credit:      parseFloat(l.credit) || 0,
        description: l.description || undefined,
        entityType:  l._entityType || undefined,
        entityId:    l.entityId    || undefined,
      })),
    };
  };

  const validate = () => {
    const validLines = lines.filter((l) => l.accountId);
    if (validLines.length < 2) { setError('At least two lines are required.'); return false; }
    const dr = validLines.reduce((s, l) => s + (parseFloat(l.debit)  || 0), 0);
    const cr = validLines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
    if (Math.abs(dr - cr) > 0.005) { setError('Entry must be balanced before posting.'); return false; }
    return true;
  };

  const saveMut = useMutation({
    mutationFn: (payload) => isEdit
      ? api.patch(`/journals/${existing.journal_id}`, payload).then((r) => r.data.data)
      : api.post('/journals', payload).then((r) => r.data.data),
    onSuccess: () => {
      toast.success(isEdit ? 'Journal saved' : 'Draft saved');
      qc.invalidateQueries({ queryKey: ['journals'] });
      onClose();
    },
    onError: (e) => setError(e.response?.data?.message ?? e.message),
  });

  const postMut = useMutation({
    mutationFn: async (payload) => {
      let journalId = existing?.journal_id;
      if (!journalId) {
        const draft = await api.post('/journals', payload).then((r) => r.data.data);
        journalId = draft.journal_id;
      } else {
        await api.patch(`/journals/${journalId}`, payload);
      }
      return api.post(`/journals/${journalId}/post`).then((r) => r.data.data);
    },
    onSuccess: () => {
      toast.success('Journal posted to ledger');
      qc.invalidateQueries({ queryKey: ['journals'] });
      onClose();
    },
    onError: (e) => setError(e.response?.data?.message ?? e.message),
  });

  const isPending = saveMut.isPending || postMut.isPending;

  return (
    <Modal open title={isEdit ? `Edit Journal — ${existing.journal_number}` : 'New Journal Entry'} onClose={onClose} size="xl">
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Date *</label>
            <input type="date" className="w-full border rounded-lg px-2 py-2 text-sm"
              value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
            <input className="w-full border rounded-lg px-2 py-2 text-sm" placeholder="e.g. Monthly accrual"
              value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Reference</label>
            <input className="w-full border rounded-lg px-2 py-2 text-sm" placeholder="e.g. INV-001"
              value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
        </div>

        <JournalLinesForm accounts={accounts} bankAccounts={bankAccounts}
          customers={customers} suppliers={suppliers} lines={lines} onChange={setLines} />

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-between gap-2 border-t pt-4">
        <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border hover:bg-gray-50">
          Cancel
        </button>
        <div className="flex gap-2">
          <button
            onClick={() => { setError(''); saveMut.mutate(buildPayload()); }}
            disabled={isPending}
            className="flex-1 sm:flex-none px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            {isPending ? 'Saving…' : 'Save Draft'}
          </button>
          <button
            onClick={() => { setError(''); if (validate()) postMut.mutate(buildPayload()); }}
            disabled={isPending}
            className="flex-1 sm:flex-none px-4 py-2 text-sm rounded-lg bg-primary-600 text-white disabled:opacity-40"
          >
            {isPending ? 'Posting…' : 'Save & Post'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Journal Detail Modal ──────────────────────────────────────────────────────

function JournalDetailModal({ journalId, onClose, onEdit }) {
  const qc = useQueryClient();
  const { data: j, isLoading } = useQuery({
    queryKey: ['journal', journalId],
    queryFn: () => api.get(`/journals/${journalId}`).then((r) => r.data.data),
    enabled: !!journalId,
  });

  const [voidReason,    setVoidReason]    = useState('');
  const [showVoidForm,  setShowVoidForm]  = useState(false);
  const [editingDate,   setEditingDate]   = useState(false);
  const [newDate,       setNewDate]       = useState('');

  const postMut = useMutation({
    mutationFn: () => api.post(`/journals/${journalId}/post`).then((r) => r.data),
    onSuccess: () => { toast.success('Journal posted'); qc.invalidateQueries({ queryKey: ['journals'] }); onClose(); },
    onError:   (e) => toast.error(e.response?.data?.message ?? e.message),
  });

  const voidMut = useMutation({
    mutationFn: () => api.post(`/journals/${journalId}/void`, { reason: voidReason }).then((r) => r.data),
    onSuccess: () => { toast.success('Journal voided'); qc.invalidateQueries({ queryKey: ['journals'] }); onClose(); },
    onError:   (e) => toast.error(e.response?.data?.message ?? e.message),
  });

  const dateMut = useMutation({
    mutationFn: (entryDate) => api.patch(`/journals/${journalId}/date`, { entryDate }).then((r) => r.data.data),
    onSuccess: (updated) => {
      toast.success('Date updated');
      qc.setQueryData(['journal', journalId], updated);
      qc.invalidateQueries({ queryKey: ['journals'] });
      setEditingDate(false);
    },
    onError: (e) => toast.error(e.response?.data?.message ?? e.message),
  });

  return (
    <Modal open title={isLoading ? 'Loading…' : `${j?.journal_number} — ${j?.status?.toUpperCase()}`}
      onClose={onClose} size="lg">
      {isLoading ? (
        <div className="py-12 text-center text-gray-400">Loading…</div>
      ) : j ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm bg-gray-50 rounded-lg p-3">
            <div><span className="text-gray-500 text-xs">Number</span><p className="font-mono font-semibold text-sm">{j.journal_number}</p></div>
            <div>
              <span className="text-gray-500 text-xs">Date</span>
              {editingDate ? (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <input type="date" autoFocus
                    className="border rounded px-1.5 py-0.5 text-sm focus:border-primary-500 focus:outline-none"
                    value={newDate} onChange={(e) => setNewDate(e.target.value)} />
                  <button onClick={() => dateMut.mutate(newDate)} disabled={!newDate || dateMut.isPending}
                    className="px-2 py-0.5 text-xs rounded bg-primary-600 text-white disabled:opacity-40">
                    {dateMut.isPending ? '…' : 'Save'}
                  </button>
                  <button onClick={() => setEditingDate(false)}
                    className="px-2 py-0.5 text-xs rounded border text-gray-600 hover:bg-gray-100">
                    ✕
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <p className="font-medium">{String(j.entry_date).slice(0, 10)}</p>
                  {j.status !== 'void' && (
                    <button onClick={() => { setNewDate(String(j.entry_date).slice(0, 10)); setEditingDate(true); }}
                      className="text-[10px] text-primary-600 underline hover:text-primary-800 cursor-pointer">
                      edit
                    </button>
                  )}
                </div>
              )}
            </div>
            <div><span className="text-gray-500 text-xs">Status</span>
              <p><span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLORS[j.status]}`}>{j.status}</span></p>
            </div>
            {j.description && <div className="col-span-full"><span className="text-gray-500 text-xs">Description</span><p className="break-words">{j.description}</p></div>}
            {j.reference   && <div><span className="text-gray-500 text-xs">Reference</span><p>{j.reference}</p></div>}
            {j.created_by  && <div><span className="text-gray-500 text-xs">Created by</span><p>{j.created_by}</p></div>}
            {j.posted_by   && <div><span className="text-gray-500 text-xs">Posted by</span><p>{j.posted_by}</p></div>}
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm min-w-[420px]">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="text-left px-3 py-2 font-medium text-gray-600">Account</th>
                  <th className="hidden sm:table-cell text-left px-3 py-2 font-medium text-gray-600">Entity / Note</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600 w-28">Debit</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600 w-28">Credit</th>
                </tr>
              </thead>
              <tbody>
                {(j.lines ?? []).map((l) => (
                  <tr key={l.lineId} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      <span className="font-mono text-xs text-gray-500 mr-1">{l.accountCode}</span>
                      <span className="text-sm">{l.accountName}</span>
                      {l.entityName && (
                        <p className="sm:hidden text-xs text-gray-400 mt-0.5">
                          <span className="capitalize">{l.entityType?.replace('_', ' ')}</span>: {l.entityName}
                        </p>
                      )}
                      {!l.entityName && l.description && (
                        <p className="sm:hidden text-xs text-gray-400 mt-0.5">{l.description}</p>
                      )}
                    </td>
                    <td className="hidden sm:table-cell px-3 py-2 text-xs text-gray-500">
                      {l.entityName
                        ? <><span className="capitalize text-gray-400">{l.entityType?.replace('_', ' ')}</span>: {l.entityName}</>
                        : l.description || '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-sm">{l.debit  > 0 ? fmt(l.debit)  : '—'}</td>
                    <td className="px-3 py-2 text-right font-mono text-sm">{l.credit > 0 ? fmt(l.credit) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 bg-gray-50">
                <tr>
                  <td colSpan={2} className="px-3 py-2 font-semibold">Totals</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold">
                    {fmt((j.lines ?? []).reduce((s, l) => s + l.debit, 0))}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold">
                    {fmt((j.lines ?? []).reduce((s, l) => s + l.credit, 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Actions */}
          {j.status === 'draft' && (
            <div className="border-t pt-4 flex flex-wrap gap-2">
              <button onClick={() => onEdit(j)}
                className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border text-gray-700 hover:bg-gray-50">
                <Edit2 className="h-4 w-4" />Edit Draft
              </button>
              <button onClick={() => postMut.mutate()} disabled={postMut.isPending}
                className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-primary-600 text-white disabled:opacity-40">
                {postMut.isPending ? 'Posting…' : 'Post to Ledger'}
              </button>
            </div>
          )}

          {j.status === 'posted' && (
            <div className="border-t pt-4">
              {showVoidForm ? (
                <div className="flex flex-col sm:flex-row gap-2">
                  <input className="flex-1 border rounded-lg px-2 py-2 text-sm"
                    placeholder="Reason for voiding…"
                    value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
                  <div className="flex gap-2">
                    <button onClick={() => voidMut.mutate()} disabled={!voidReason.trim() || voidMut.isPending}
                      className="flex-1 sm:flex-none px-4 py-2 text-sm rounded-lg bg-red-600 text-white disabled:opacity-40">
                      Confirm Void
                    </button>
                    <button onClick={() => setShowVoidForm(false)}
                      className="flex-1 sm:flex-none px-4 py-2 text-sm rounded-lg border">Cancel</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShowVoidForm(true)}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-red-300 text-red-600 hover:bg-red-50">
                  <XCircle className="h-4 w-4" />Void Journal
                </button>
              )}
            </div>
          )}

          {j.status === 'void' && (
            <div className="border-t pt-4 text-sm text-red-700 bg-red-50 rounded-lg p-3">
              <strong>Voided</strong>{j.void_reason ? `: ${j.void_reason}` : ''}
              {j.voided_at ? ` · ${String(j.voided_at).slice(0, 10)}` : ''}
              {j.voided_by ? ` by ${j.voided_by}` : ''}
            </div>
          )}
        </div>
      ) : null}

      <div className="mt-6 flex justify-end border-t pt-4">
        <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border hover:bg-gray-50">Close</button>
      </div>
    </Modal>
  );
}

// ── Excel Import ──────────────────────────────────────────────────────────────

function downloadTemplate() {
  const headers  = ['Date', 'Entry Description', 'Account Code', 'Debit', 'Credit', 'Line Note'];
  const examples = [
    ['2024-01-15', 'Office supplies purchase', '5500', 500,  '',   'Stationery'],
    ['',           '',                          '1000', '',   500,  'Cash paid'],
    ['2024-01-16', 'Revenue accrual',           '1100', 2000, '',   'Invoice #001'],
    ['',           '',                          '4000', '',   2000, 'Sales revenue'],
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers, ...examples]);
  ws['!cols'] = [{ wch: 14 }, { wch: 28 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 22 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Journal Template');
  const instrData = [
    ['HOW TO USE THIS TEMPLATE'],
    [''],
    ['1. Each group of rows sharing the same Date = one journal entry.'],
    ['2. First row of an entry must have a Date and Entry Description.'],
    ['3. Subsequent lines for the same entry leave Date and Description BLANK.'],
    ['4. Account Code must match a code in your Chart of Accounts.'],
    ['5. Each entry MUST balance: total Debit = total Credit.'],
  ];
  const wsI = XLSX.utils.aoa_to_sheet(instrData);
  wsI['!cols'] = [{ wch: 60 }];
  XLSX.utils.book_append_sheet(wb, wsI, 'Instructions');
  XLSX.writeFile(wb, 'journal_import_template.xlsx');
}

function ImportModal({ onClose }) {
  const fileRef = useRef(null);
  const [rows, setRows] = useState(null);
  const [parseError, setParseError] = useState('');
  const [validationErrors, setValidationErrors] = useState([]);
  const qc = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: (entries) => api.post('/journals/bulk-import', { entries }).then((r) => r.data),
    onSuccess: (res) => {
      toast.success(`${res.data?.imported ?? 0} entries imported`);
      qc.invalidateQueries({ queryKey: ['journals'] });
      onClose();
    },
    onError: (e) => toast.error(e.response?.data?.message ?? e.message),
  });

  const handleFile = (e) => {
    setParseError(''); setValidationErrors([]); setRows(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'binary', cellDates: true });
        const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
        const headerIdx = raw.findIndex((r) =>
          String(r[0]).toLowerCase().includes('date') || String(r[2]).toLowerCase().includes('account'));
        if (headerIdx === -1) { setParseError('Could not locate header row.'); return; }
        const dataRows = raw.slice(headerIdx + 1).filter((r) => r.some((c) => c !== ''));
        const entries = [];
        let current = null;
        dataRows.forEach((r) => {
          const rawDate = r[0];
          const entryDesc = String(r[1] ?? '').trim();
          const accountCode = String(r[2] ?? '').trim();
          const debit  = parseFloat(String(r[3]).replace(/,/g, '')) || 0;
          const credit = parseFloat(String(r[4]).replace(/,/g, '')) || 0;
          const lineNote = String(r[5] ?? '').trim();
          if (rawDate !== '' && rawDate != null) {
            const parsed = rawDate instanceof Date ? rawDate : new Date(rawDate);
            const dateStr = isNaN(parsed) ? String(rawDate).slice(0, 10) : parsed.toISOString().slice(0, 10);
            current = { entryDate: dateStr, description: entryDesc, lines: [] };
            entries.push(current);
          }
          if (current && accountCode) {
            current.lines.push({ accountCode, debit, credit, description: lineNote || undefined });
          }
        });
        const errs = [];
        entries.forEach((en, i) => {
          if (en.lines.length < 2) errs.push(`Entry ${i + 1}: needs at least 2 lines`);
          const dr = en.lines.reduce((s, l) => s + l.debit, 0);
          const cr = en.lines.reduce((s, l) => s + l.credit, 0);
          if (Math.abs(dr - cr) > 0.005) errs.push(`Entry ${i + 1}: not balanced — Dr ${fmt(dr)} ≠ Cr ${fmt(cr)}`);
        });
        setValidationErrors(errs);
        setRows(entries);
      } catch (err) { setParseError(`Failed to parse: ${err.message}`); }
    };
    reader.readAsBinaryString(file);
  };

  const canImport = rows?.length > 0 && validationErrors.length === 0;

  return (
    <Modal open title="Import Journals from Excel" onClose={onClose} size="xl">
      <div className="space-y-5">
        <div className="rounded-lg border border-dashed p-4 bg-gray-50 flex items-center gap-3">
          <Download className="h-5 w-5 text-primary-500 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-700">Download the template first</p>
            <p className="text-xs text-gray-500">Fill it in then upload below.</p>
          </div>
          <button onClick={downloadTemplate}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border bg-white hover:bg-gray-50">
            <Download className="h-4 w-4" />Get Template
          </button>
        </div>

        <label className="flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-6 cursor-pointer hover:bg-gray-50">
          <Upload className="h-8 w-8 text-gray-400 mb-2" />
          <span className="text-sm text-gray-600">Click to browse or drag & drop</span>
          <span className="text-xs text-gray-400 mt-1">.xlsx, .xls files only</span>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
        </label>

        {parseError && <p className="text-sm text-red-600 flex items-center gap-1"><AlertCircle className="h-4 w-4" />{parseError}</p>}

        {validationErrors.length > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-semibold text-red-700 mb-2">{validationErrors.length} issue(s) found</p>
            <ul className="text-xs text-red-600 space-y-0.5 list-disc list-inside">
              {validationErrors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        )}

        {canImport && (
          <p className="text-sm font-medium text-green-700 flex items-center gap-1">
            <CheckCircle2 className="h-4 w-4" />{rows.length} entr{rows.length === 1 ? 'y' : 'ies'} ready
          </p>
        )}
      </div>

      <div className="mt-6 flex justify-end gap-2 border-t pt-4">
        <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border hover:bg-gray-50">Cancel</button>
        <button onClick={() => mutate(rows)} disabled={!canImport || isPending}
          className="px-4 py-2 text-sm rounded-lg bg-primary-600 text-white disabled:opacity-40 flex items-center gap-2">
          <Upload className="h-4 w-4" />{isPending ? 'Importing…' : `Import ${rows?.length ?? 0} Entr${rows?.length === 1 ? 'y' : 'ies'}`}
        </button>
      </div>
    </Modal>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const OUT_TYPE_LABELS = { withdrawal: 'Withdrawal', expense: 'Expense', stock_payment: 'Stock Payment' };
const OUT_TYPE_COLORS = {
  withdrawal:    'bg-amber-100 text-amber-700',
  expense:       'bg-red-100 text-red-600',
  stock_payment: 'bg-blue-100 text-blue-700',
};

// Source-type badge styling for posted ledger entries — one shared source of truth so the
// filter dropdown, table badges, and detail modal always agree on label/color per type.
const SOURCE_TYPE_META = {
  SALE:                  { label: 'Sale',              color: 'bg-green-100 text-green-700' },
  SESSION_SALE_SUMMARY:  { label: 'Session Summary',   color: 'bg-blue-100 text-blue-700' },
  DAILY_SALE_SUMMARY:    { label: 'Daily Summary',     color: 'bg-purple-100 text-purple-700' },
  OPENING_BALANCE:       { label: 'Opening Balance',   color: 'bg-amber-100 text-amber-700' },
  AR_SETTLEMENT:         { label: 'AR Settlement',     color: 'bg-teal-100 text-teal-700' },
  MANUAL:                { label: 'Manual Journal',    color: 'bg-indigo-100 text-indigo-700' },
  CREDIT_PAYMENT:        { label: 'Credit Payment',    color: 'bg-emerald-100 text-emerald-700' },
};
const sourceTypeBadge = (sourceType) =>
  SOURCE_TYPE_META[sourceType] ?? { label: sourceType?.replace(/_/g, ' ') ?? '—', color: 'bg-gray-100 text-gray-600' };

export default function JournalPage() {
  const [activeTab,    setActiveTab]    = useState('journals');

  // ── Journal entries state ──
  const [startDate,    setStartDate]    = useState(() => { const d = new Date(); d.setDate(d.getDate() - 29); return d.toISOString().slice(0, 10); });
  const [endDate,      setEndDate]      = useState(todayLocal());
  const [statusFilter, setStatusFilter] = useState('');
  const [page,         setPage]         = useState(1);
  const [selectedId,   setSelectedId]   = useState(null);
  const [editTarget,   setEditTarget]   = useState(null);
  const [showNew,      setShowNew]      = useState(false);
  const [showImport,   setShowImport]   = useState(false);

  // ── Cash outs state ──
  const [coStart, setCoStart] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 29); return d.toISOString().slice(0, 10); });
  const [coEnd,   setCoEnd]   = useState(todayLocal());
  const [coPage,  setCoPage]  = useState(1);

  // ── Posted entries (auto-generated) state ──
  const [aeStart,      setAeStart]      = useState(() => { const d = new Date(); d.setDate(d.getDate() - 29); return d.toISOString().slice(0, 10); });
  const [aeEnd,        setAeEnd]        = useState(todayLocal());
  const [aeSourceType, setAeSourceType] = useState('!SALE'); // default: hide per-sale entries
  const [aePage,       setAePage]       = useState(1);
  const [aeSelected,   setAeSelected]   = useState(null);

  // ── Post unposted state ──
  const yesterdayLocal = () => {
    const [y, m, d] = todayLocal().split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
  };
  const [postMode,      setPostMode]      = useState('combined');
  const [postBranchId,  setPostBranchId]  = useState('');
  // Default to yesterday, not today — a Combined post locks that day forever once made,
  // so posting a day before it's actually over silently drops any sale that arrives after.
  const [postDate,      setPostDate]      = useState(yesterdayLocal());
  const [showPostPanel, setShowPostPanel] = useState(false);
  const postPanelRef = useRef(null);

  useEffect(() => {
    if (!showPostPanel) return;
    const handler = (e) => { if (postPanelRef.current && !postPanelRef.current.contains(e.target)) setShowPostPanel(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPostPanel]);

  const qc = useQueryClient();

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get('/accounts').then((r) => r.data.data),
  });

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => api.get('/branches').then((r) => r.data.data),
  });

  const postMut = useMutation({
    mutationFn: ({ branchId, date, mode }) =>
      api.post('/journal/daily-summaries', { branchId, date, mode }).then((r) => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['journal-entries'] });
      if (data?.data?.posted !== undefined) {
        const { posted, skipped, remaining } = data.data;
        if (posted === 0 && skipped === 0) toast.success('No unposted transactions found for this date');
        else if (posted === 0) toast.error(`0 posted — ${skipped} failed (check chart of accounts setup)`);
        else if (remaining > 0) toast(`Posted ${posted} · ${remaining} still unposted`, { icon: '⚠️' });
        else toast.success(`Posted ${posted} transaction${posted !== 1 ? 's' : ''}${skipped ? ` · ${skipped} failed` : ''}`);
      } else {
        toast.success('Summary posted to journal');
      }
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed to post'),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['journals', startDate, endDate, statusFilter, page],
    queryFn: () => api.get('/journals', {
      params: { startDate, endDate, status: statusFilter || undefined, page, limit: 25 },
    }).then((r) => r.data.data),
    placeholderData: (prev) => prev,
  });

  const { data: coData, isLoading: coLoading } = useQuery({
    queryKey: ['pos-cash-outs-all', coStart, coEnd, coPage],
    queryFn: () => api.get('/pos/cash-outs', {
      params: { startDate: coStart, endDate: coEnd, page: coPage, limit: 30 },
    }).then((r) => r.data.data),
    placeholderData: (prev) => prev,
    enabled: activeTab === 'cash-outs',
  });

  const { data: trData, isLoading: trLoading } = useQuery({
    queryKey: ['pos-transfers-all', coStart, coEnd, coPage],
    queryFn: () => api.get('/pos/transfers', {
      params: { startDate: coStart, endDate: coEnd, page: coPage, limit: 30 },
    }).then((r) => r.data.data),
    placeholderData: (prev) => prev,
    enabled: activeTab === 'cash-outs',
  });

  const aeParams = aeSourceType === '!SALE'
    ? { startDate: aeStart, endDate: aeEnd, excludeSourceType: 'SALE', page: aePage, limit: 25 }
    : { startDate: aeStart, endDate: aeEnd, sourceType: aeSourceType || undefined, page: aePage, limit: 25 };

  const { data: aeData, isLoading: aeLoading } = useQuery({
    queryKey: ['journal-entries', aeStart, aeEnd, aeSourceType, aePage],
    queryFn: () => api.get('/journal/entries', { params: aeParams }).then((r) => r.data.data),
    placeholderData: (prev) => prev,
    enabled: activeTab === 'posted-entries',
  });

  const { data: aeDetail, isLoading: aeDetailLoading } = useQuery({
    queryKey: ['journal-entry-detail', aeSelected],
    queryFn: () => api.get(`/journal/entries/${aeSelected}`).then((r) => r.data.data),
    enabled: !!aeSelected,
  });

  const journals   = data?.journals ?? [];
  const total      = data?.total    ?? 0;
  const pages      = data?.pages    ?? 1;
  const cashOuts   = coData?.cashOuts ?? [];
  const coTotal    = coData?.total    ?? 0;
  const coPages    = coData?.pages    ?? 1;

  return (
    <div className="h-full flex flex-col">
      {/* Header — stacks on mobile so the tab strip and action buttons never get clipped */}
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4 border-b bg-white flex-shrink-0">
        <div className="flex flex-wrap items-center gap-3">
          <div className="hidden sm:flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
            <ScrollText className="h-5 w-5 text-primary-600" />
          </div>
          {/* Tab strip */}
          <div className="flex flex-wrap gap-1 rounded-lg border border-gray-200 bg-gray-50 p-0.5">
            <button
              onClick={() => setActiveTab('journals')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                activeTab === 'journals' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <ScrollText className="h-3.5 w-3.5" />Journal Entries
            </button>
            <button
              onClick={() => setActiveTab('cash-outs')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                activeTab === 'cash-outs' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <ArrowDownLeft className="h-3.5 w-3.5" />Cash Outs
            </button>
            <button
              onClick={() => setActiveTab('posted-entries')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                activeTab === 'posted-entries' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />Sales Entries
            </button>
          </div>
        </div>
        {activeTab === 'journals' && (
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={downloadTemplate}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg border text-sm text-gray-600 hover:bg-gray-50">
              <Download className="h-4 w-4" /><span className="hidden sm:inline">Template</span>
            </button>
            <button onClick={() => setShowImport(true)}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg border text-sm text-gray-600 hover:bg-gray-50">
              <Upload className="h-4 w-4" /><span className="hidden sm:inline">Import</span>
            </button>
<button onClick={() => setShowNew(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700">
              <Plus className="h-4 w-4" />New Journal
            </button>
          </div>
        )}
        {activeTab === 'posted-entries' && (
          <div className="relative" ref={postPanelRef}>
            <button
              onClick={() => setShowPostPanel((v) => !v)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700"
            >
              <CheckCircle2 className="h-4 w-4" />Post Sales Entries
            </button>
            {showPostPanel && (
              <div className="absolute right-0 top-full mt-2 z-30 w-[calc(100vw-2rem)] max-w-[420px] rounded-xl border border-gray-200 bg-white shadow-xl p-5 space-y-4">
                <p className="text-sm font-semibold text-gray-800">Post Sales Entries</p>

                {/* Mode toggle */}
                <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs w-fit">
                  {[{ value: 'combined', label: 'Combined' }, { value: 'per_transaction', label: 'Per Transaction' }].map((opt, i) => (
                    <button key={opt.value} onClick={() => {
                      setPostMode(opt.value);
                      // Combined locks the day once posted — never let it default to today
                      if (opt.value === 'combined' && postDate >= todayLocal()) setPostDate(yesterdayLocal());
                    }}
                      className={['px-3 py-1.5 transition-colors', i > 0 ? 'border-l border-gray-200' : '',
                        postMode === opt.value ? 'bg-primary-600 text-white font-medium' : 'bg-white text-gray-600 hover:bg-gray-50',
                      ].join(' ')}>
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-400 -mt-2">
                  {postMode === 'combined'
                    ? 'One aggregate entry covering all unposted sales for the branch and date.'
                    : 'One entry per unposted sale — full audit trail.'}
                </p>

                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Branch</label>
                    <select value={postBranchId} onChange={(e) => setPostBranchId(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-xs bg-white focus:border-primary-500 focus:outline-none">
                      <option value="">— Select —</option>
                      {branches.map((b) => <option key={b.branch_id} value={b.branch_id}>{b.branch_name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                    <input type="date" value={postDate} onChange={(e) => setPostDate(e.target.value)}
                      max={postMode === 'combined' ? yesterdayLocal() : todayLocal()}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs focus:border-primary-500 focus:outline-none" />
                  </div>
                  <button
                    disabled={!postBranchId || !postDate || postMut.isPending}
                    onClick={() => postMut.mutate({ branchId: postBranchId, date: postDate, mode: postMode }, { onSuccess: () => setShowPostPanel(false) })}
                    className="rounded-lg bg-primary-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-40 transition-colors whitespace-nowrap">
                    {postMut.isPending ? 'Posting…' : 'Post'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Filters */}
      {activeTab === 'journals' ? (
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6 border-b bg-gray-50 flex-shrink-0">
          <div className="flex items-center gap-2 text-sm">
            <label className="text-gray-500 font-medium">From</label>
            <input type="date" className="border rounded-lg px-3 py-1.5 text-sm"
              value={startDate} onChange={(e) => { setStartDate(e.target.value); setPage(1); }} />
            <label className="text-gray-500 font-medium">To</label>
            <input type="date" className="border rounded-lg px-3 py-1.5 text-sm"
              value={endDate} onChange={(e) => { setEndDate(e.target.value); setPage(1); }} />
          </div>
          <select className="border rounded-lg px-3 py-1.5 text-sm"
            value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="posted">Posted</option>
            <option value="void">Void</option>
          </select>
          <button onClick={() => qc.invalidateQueries({ queryKey: ['journals'] })}
            className="ml-auto flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900">
            <RefreshCw className="h-4 w-4" />Refresh
          </button>
        </div>
      ) : activeTab === 'cash-outs' ? (
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6 border-b bg-gray-50 flex-shrink-0">
          <Calendar className="h-4 w-4 text-gray-400 flex-shrink-0" />
          <div className="flex items-center gap-2 text-sm">
            <input type="date" className="border rounded-lg px-3 py-1.5 text-sm"
              value={coStart} onChange={(e) => { setCoStart(e.target.value); setCoPage(1); }} />
            <span className="text-gray-400">—</span>
            <input type="date" className="border rounded-lg px-3 py-1.5 text-sm"
              value={coEnd} onChange={(e) => { setCoEnd(e.target.value); setCoPage(1); }} />
          </div>
          <button onClick={() => qc.invalidateQueries({ queryKey: ['pos-cash-outs-all'] })}
            className="ml-auto flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900">
            <RefreshCw className="h-4 w-4" />Refresh
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6 border-b bg-gray-50 flex-shrink-0">
          <Calendar className="h-4 w-4 text-gray-400 flex-shrink-0" />
          <div className="flex items-center gap-2 text-sm">
            <input type="date" className="border rounded-lg px-3 py-1.5 text-sm"
              value={aeStart} onChange={(e) => { setAeStart(e.target.value); setAePage(1); }} />
            <span className="text-gray-400">—</span>
            <input type="date" className="border rounded-lg px-3 py-1.5 text-sm"
              value={aeEnd} onChange={(e) => { setAeEnd(e.target.value); setAePage(1); }} />
          </div>
          <select className="border rounded-lg px-3 py-1.5 text-sm"
            value={aeSourceType} onChange={(e) => { setAeSourceType(e.target.value); setAePage(1); }}>
            <option value="!SALE">Summaries Only</option>
            <option value="">All (incl. per-sale)</option>
            <option value="SALE">Per-Sale Only</option>
            <option value="SESSION_SALE_SUMMARY">Session Summary</option>
            <option value="DAILY_SALE_SUMMARY">Daily Summary</option>
            <option value="OPENING_BALANCE">Opening Balance</option>
            <option value="AR_SETTLEMENT">AR Settlement</option>
            <option value="MANUAL">Manual Journal</option>
            <option value="CREDIT_PAYMENT">Credit Payment</option>
          </select>
          <button onClick={() => qc.invalidateQueries({ queryKey: ['journal-entries'] })}
            className="ml-auto flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900">
            <RefreshCw className="h-4 w-4" />Refresh
          </button>
        </div>
      )}

      {/* Table */}
      {activeTab === 'posted-entries' ? (
        <div className="flex-1 overflow-auto">
          {aeLoading ? (
            <div className="py-24 text-center text-gray-400">Loading…</div>
          ) : (aeData?.entries ?? []).length === 0 ? (
            <div className="py-24 text-center text-gray-400">
              <CheckCircle2 className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p>No posted entries in this period.</p>
            </div>
          ) : (
            <>
            {/* Desktop table — every column always visible */}
            <table className="hidden sm:table w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 border-b z-10">
                <tr>
                  <th className="text-left px-3 py-1.5 font-medium text-gray-600 w-36">Number</th>
                  <th className="text-left px-3 py-1.5 font-medium text-gray-600 w-28">Date</th>
                  <th className="text-left px-3 py-1.5 font-medium text-gray-600 w-40">Type</th>
                  <th className="text-left px-3 py-1.5 font-medium text-gray-600">Description</th>
                  <th className="text-right px-3 py-1.5 font-medium text-gray-600 w-32">Debit</th>
                  <th className="text-right px-3 py-1.5 font-medium text-gray-600 w-32">Credit</th>
                  <th className="text-center px-3 py-1.5 font-medium text-gray-600 w-20">Action</th>
                </tr>
              </thead>
              <tbody>
                {(aeData?.entries ?? []).map((e) => (
                  <tr key={e.journalEntryId} className="border-b hover:bg-gray-50 cursor-pointer"
                    onClick={() => setAeSelected(e.journalEntryId)}>
                    <td className="px-3 py-1.5 font-mono text-xs text-gray-700">{e.entryNumber}</td>
                    <td className="px-3 py-1.5 text-xs text-gray-600">{String(e.entryDate).slice(0, 10)}</td>
                    <td className="px-3 py-1.5">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${sourceTypeBadge(e.sourceType).color}`}>
                        {sourceTypeBadge(e.sourceType).label}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-xs text-gray-800 truncate max-w-xs">{e.description ?? '—'}</td>
                    <td className="px-3 py-1.5 text-xs text-right font-mono">{fmt(e.totalDebit)}</td>
                    <td className="px-3 py-1.5 text-xs text-right font-mono">{fmt(e.totalCredit)}</td>
                    <td className="px-3 py-1.5 text-center" onClick={(ev) => ev.stopPropagation()}>
                      <button onClick={() => setAeSelected(e.journalEntryId)}
                        className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-100 transition-colors">
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile cards */}
            <div className="sm:hidden divide-y">
              {(aeData?.entries ?? []).map((e) => (
                <div key={e.journalEntryId} onClick={() => setAeSelected(e.journalEntryId)}
                  className="p-3 active:bg-gray-50 cursor-pointer transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-xs font-semibold text-gray-700">{e.entryNumber}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{String(e.entryDate).slice(0, 10)}</p>
                    </div>
                    <span className={`flex-shrink-0 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${sourceTypeBadge(e.sourceType).color}`}>
                      {sourceTypeBadge(e.sourceType).label}
                    </span>
                  </div>
                  {e.description && <p className="mt-1.5 text-xs text-gray-800 truncate">{e.description}</p>}
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-x-3 text-xs font-mono">
                      <span>Dr {fmt(e.totalDebit)}</span>
                      <span>Cr {fmt(e.totalCredit)}</span>
                    </div>
                    <button onClick={(ev) => { ev.stopPropagation(); setAeSelected(e.journalEntryId); }}
                      className="flex-shrink-0 rounded-lg border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-100 transition-colors">
                      View
                    </button>
                  </div>
                </div>
              ))}
            </div>
            </>
          )}
        </div>
      ) : activeTab === 'journals' ? (
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="py-24 text-center text-gray-400">Loading…</div>
          ) : journals.length === 0 ? (
            <div className="py-24 text-center text-gray-400">
              <ScrollText className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p>No journal entries in this period.</p>
              <p className="text-sm mt-1">Create a manual journal entry using the button above.</p>
            </div>
          ) : (
            <>
            {/* Desktop table — every column always visible */}
            <table className="hidden sm:table w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 border-b z-10">
                <tr>
                  <th className="text-left px-2 py-1.5 font-medium text-gray-600 w-36">Number</th>
                  <th className="text-left px-2 py-1.5 font-medium text-gray-600 w-28">Date</th>
                  <th className="text-left px-2 py-1.5 font-medium text-gray-600">Description</th>
                  <th className="text-left px-2 py-1.5 font-medium text-gray-600 w-28">Reference</th>
                  <th className="text-right px-2 py-1.5 font-medium text-gray-600 w-32">Debit</th>
                  <th className="text-right px-2 py-1.5 font-medium text-gray-600 w-32">Credit</th>
                  <th className="text-left px-2 py-1.5 font-medium text-gray-600 w-24">Status</th>
                  <th className="text-center px-2 py-1.5 font-medium text-gray-600 w-20">Action</th>
                </tr>
              </thead>
              <tbody>
                {journals.map((j) => (
                  <tr key={j.journalId} className="border-b hover:bg-gray-50 active:bg-gray-100 cursor-pointer"
                    onClick={() => setSelectedId(j.journalId)}>
                    <td className="px-2 py-1.5 font-mono text-xs text-gray-700">{j.journalNumber}</td>
                    <td className="px-2 py-1.5 text-xs text-gray-600">{String(j.entryDate).slice(0, 10)}</td>
                    <td className="px-2 py-1.5 text-xs text-gray-800 truncate max-w-xs">{j.description ?? '—'}</td>
                    <td className="px-2 py-1.5 text-gray-500 text-xs">{j.reference ?? '—'}</td>
                    <td className="px-2 py-1.5 text-xs text-right font-mono">{fmt(j.totalDebit)}</td>
                    <td className="px-2 py-1.5 text-xs text-right font-mono">{fmt(j.totalCredit)}</td>
                    <td className="px-2 py-1.5">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLORS[j.status]}`}>
                        {j.status}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => setSelectedId(j.journalId)}
                        className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-100 transition-colors">
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile cards */}
            <div className="sm:hidden divide-y">
              {journals.map((j) => (
                <div key={j.journalId} onClick={() => setSelectedId(j.journalId)}
                  className="p-3 active:bg-gray-50 cursor-pointer transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-xs font-semibold text-gray-700">{j.journalNumber}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{String(j.entryDate).slice(0, 10)}</p>
                    </div>
                    <span className={`flex-shrink-0 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLORS[j.status]}`}>
                      {j.status}
                    </span>
                  </div>
                  {j.description && <p className="mt-1.5 text-xs text-gray-800 truncate">{j.description}</p>}
                  {j.reference && <p className="mt-0.5 text-xs text-gray-500">Ref: {j.reference}</p>}
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-x-3 text-xs font-mono">
                      <span>Dr {fmt(j.totalDebit)}</span>
                      <span>Cr {fmt(j.totalCredit)}</span>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); setSelectedId(j.journalId); }}
                      className="flex-shrink-0 rounded-lg border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-100 transition-colors">
                      View
                    </button>
                  </div>
                </div>
              ))}
            </div>
            </>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          {coLoading ? (
            <div className="py-24 text-center text-gray-400">Loading…</div>
          ) : cashOuts.length === 0 ? (
            <div className="py-24 text-center text-gray-400">
              <ArrowDownLeft className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p>No cash outs in this period.</p>
            </div>
          ) : (
            <>
            {/* Desktop table — every column always visible */}
            <table className="hidden sm:table w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 border-b z-10">
                <tr>
                  <th className="text-left px-2 py-1.5 font-medium text-gray-600 w-36">Date</th>
                  <th className="text-left px-2 py-1.5 font-medium text-gray-600 w-28">Type</th>
                  <th className="text-right px-2 py-1.5 font-medium text-gray-600 w-32">Amount</th>
                  <th className="text-left px-2 py-1.5 font-medium text-gray-600">Account / Supplier</th>
                  <th className="text-left px-2 py-1.5 font-medium text-gray-600 w-32">Payment</th>
                  <th className="text-left px-2 py-1.5 font-medium text-gray-600">Notes</th>
                  <th className="text-left px-2 py-1.5 font-medium text-gray-600 w-28">Terminal</th>
                  <th className="text-left px-2 py-1.5 font-medium text-gray-600 w-28">Branch</th>
                  <th className="text-left px-2 py-1.5 font-medium text-gray-600 w-32">Posted By</th>
                </tr>
              </thead>
              <tbody>
                {cashOuts.map((co) => (
                  <tr key={co.cash_out_id} className="border-b hover:bg-gray-50">
                    <td className="px-2 py-1.5 text-xs text-gray-600">{String(co.created_at).slice(0, 10)}</td>
                    <td className="px-2 py-1.5">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${OUT_TYPE_COLORS[co.out_type] ?? 'bg-gray-100 text-gray-600'}`}>
                        {OUT_TYPE_LABELS[co.out_type] ?? co.out_type}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-xs text-right font-mono">{fmt(co.amount)}</td>
                    <td className="px-2 py-1.5 text-xs text-gray-800 truncate max-w-xs">
                      {co.supplier_name ?? (
                        co.account_name
                          ? <>{co.account_name}{co.account_code && <span className="ml-1 text-gray-400">({co.account_code})</span>}</>
                          : '—'
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-xs text-gray-600">{co.payment_method_name ?? '—'}</td>
                    <td className="px-2 py-1.5 text-xs text-gray-600 truncate max-w-[12rem]">{co.notes ?? '—'}</td>
                    <td className="px-2 py-1.5 text-xs text-gray-600">{co.terminal_name ?? '—'}</td>
                    <td className="px-2 py-1.5 text-xs text-gray-600">{co.branch_name ?? '—'}</td>
                    <td className="px-2 py-1.5 text-xs text-gray-600">{co.created_by_name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile cards */}
            <div className="sm:hidden divide-y">
              {cashOuts.map((co) => (
                <div key={co.cash_out_id} className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${OUT_TYPE_COLORS[co.out_type] ?? 'bg-gray-100 text-gray-600'}`}>
                        {OUT_TYPE_LABELS[co.out_type] ?? co.out_type}
                      </span>
                      <p className="text-xs text-gray-500 mt-1">{String(co.created_at).slice(0, 10)}</p>
                    </div>
                    <span className="flex-shrink-0 text-xs font-mono font-semibold text-gray-800">{fmt(co.amount)}</span>
                  </div>
                  <p className="mt-1.5 text-xs text-gray-800 truncate">
                    {co.supplier_name ?? (
                      co.account_name
                        ? <>{co.account_name}{co.account_code && <span className="ml-1 text-gray-400">({co.account_code})</span>}</>
                        : '—'
                    )}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500">
                    {co.payment_method_name && <span>{co.payment_method_name}</span>}
                    {co.branch_name && <span>{co.branch_name}</span>}
                    {co.terminal_name && <span>{co.terminal_name}</span>}
                    {co.created_by_name && <span>By {co.created_by_name}</span>}
                  </div>
                  {co.notes && <p className="mt-0.5 text-xs text-gray-400 truncate">{co.notes}</p>}
                </div>
              ))}
            </div>
            </>
          )}

          {/* Transfers section */}
          {!trLoading && (trData?.transfers ?? []).length > 0 && (
            <>
              <div className="px-4 py-2 border-t border-b bg-gray-50">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Pay Mode Transfers</p>
              </div>
              {/* Desktop table — every column always visible */}
              <table className="hidden sm:table w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-2 py-1.5 font-medium text-gray-600 w-36">Date</th>
                    <th className="text-left px-2 py-1.5 font-medium text-gray-600 w-28">Type</th>
                    <th className="text-right px-2 py-1.5 font-medium text-gray-600 w-32">Amount</th>
                    <th className="text-left px-2 py-1.5 font-medium text-gray-600">From → To</th>
                    <th className="text-left px-2 py-1.5 font-medium text-gray-600">Notes</th>
                    <th className="text-left px-2 py-1.5 font-medium text-gray-600 w-28">Terminal</th>
                    <th className="text-left px-2 py-1.5 font-medium text-gray-600 w-28">Branch</th>
                    <th className="text-left px-2 py-1.5 font-medium text-gray-600 w-32">By</th>
                  </tr>
                </thead>
                <tbody>
                  {(trData?.transfers ?? []).map((t) => (
                    <tr key={t.transfer_id} className="border-b hover:bg-gray-50">
                      <td className="px-2 py-1.5 text-xs text-gray-600">{String(t.created_at).slice(0, 10)}</td>
                      <td className="px-2 py-1.5">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                          t.transfer_type === 'sweep'       ? 'bg-purple-100 text-purple-700' :
                          t.transfer_type === 'float_topup' ? 'bg-blue-100 text-blue-700' :
                          'bg-amber-100 text-amber-700'
                        }`}>
                          {t.transfer_type === 'float_topup' ? 'Float Top-up' :
                           t.transfer_type === 'sweep'       ? 'Sweep' : 'Correction'}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-xs text-right font-mono">{fmt(t.amount)}</td>
                      <td className="px-2 py-1.5 text-xs text-gray-800">
                        {t.from_method_name ?? '—'} → {t.to_method_name ?? '—'}
                      </td>
                      <td className="px-2 py-1.5 text-xs text-gray-600 truncate max-w-[12rem]">{t.notes ?? '—'}</td>
                      <td className="px-2 py-1.5 text-xs text-gray-600">{t.terminal_name ?? '—'}</td>
                      <td className="px-2 py-1.5 text-xs text-gray-600">{t.branch_name ?? '—'}</td>
                      <td className="px-2 py-1.5 text-xs text-gray-600">{t.created_by_name ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Mobile cards */}
              <div className="sm:hidden divide-y">
                {(trData?.transfers ?? []).map((t) => (
                  <div key={t.transfer_id} className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                          t.transfer_type === 'sweep'       ? 'bg-purple-100 text-purple-700' :
                          t.transfer_type === 'float_topup' ? 'bg-blue-100 text-blue-700' :
                          'bg-amber-100 text-amber-700'
                        }`}>
                          {t.transfer_type === 'float_topup' ? 'Float Top-up' :
                           t.transfer_type === 'sweep'       ? 'Sweep' : 'Correction'}
                        </span>
                        <p className="text-xs text-gray-500 mt-1">{String(t.created_at).slice(0, 10)}</p>
                      </div>
                      <span className="flex-shrink-0 text-xs font-mono font-semibold text-gray-800">{fmt(t.amount)}</span>
                    </div>
                    <p className="mt-1.5 text-xs text-gray-800">{t.from_method_name ?? '—'} → {t.to_method_name ?? '—'}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500">
                      {t.branch_name && <span>{t.branch_name}</span>}
                      {t.terminal_name && <span>{t.terminal_name}</span>}
                      {t.created_by_name && <span>By {t.created_by_name}</span>}
                    </div>
                    {t.notes && <p className="mt-0.5 text-xs text-gray-400 truncate">{t.notes}</p>}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Pagination */}
      {activeTab === 'journals' ? (
        total > 0 && (
          <div className="flex items-center justify-between px-6 py-3 border-t bg-white flex-shrink-0 text-sm text-gray-600">
            <span>{total} journal{total !== 1 ? 's' : ''}</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
                className="px-3 py-1.5 rounded-lg border disabled:opacity-40">Previous</button>
              <span>Page {page} of {pages}</span>
              <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages}
                className="px-3 py-1.5 rounded-lg border disabled:opacity-40">Next</button>
            </div>
          </div>
        )
      ) : activeTab === 'cash-outs' ? (
        coTotal > 0 && (
          <div className="flex items-center justify-between px-6 py-3 border-t bg-white flex-shrink-0 text-sm text-gray-600">
            <span>{coTotal} cash out{coTotal !== 1 ? 's' : ''}</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setCoPage((p) => Math.max(1, p - 1))} disabled={coPage <= 1}
                className="px-3 py-1.5 rounded-lg border disabled:opacity-40">Previous</button>
              <span>Page {coPage} of {coPages}</span>
              <button onClick={() => setCoPage((p) => Math.min(coPages, p + 1))} disabled={coPage >= coPages}
                className="px-3 py-1.5 rounded-lg border disabled:opacity-40">Next</button>
            </div>
          </div>
        )
      ) : (
        (aeData?.total ?? 0) > 0 && (
          <div className="flex items-center justify-between px-6 py-3 border-t bg-white flex-shrink-0 text-sm text-gray-600">
            <span>{aeData.total} entr{aeData.total !== 1 ? 'ies' : 'y'}</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setAePage((p) => Math.max(1, p - 1))} disabled={aePage <= 1}
                className="px-3 py-1.5 rounded-lg border disabled:opacity-40">Previous</button>
              <span>Page {aePage} of {aeData.pages ?? 1}</span>
              <button onClick={() => setAePage((p) => Math.min(aeData.pages ?? 1, p + 1))} disabled={aePage >= (aeData.pages ?? 1)}
                className="px-3 py-1.5 rounded-lg border disabled:opacity-40">Next</button>
            </div>
          </div>
        )
      )}

      {/* Modals */}
      {selectedId && !editTarget && (
        <JournalDetailModal journalId={selectedId} onClose={() => setSelectedId(null)}
          onEdit={(j) => { setSelectedId(null); setEditTarget(j); }} />
      )}
      {(showNew || editTarget) && (
        <JournalFormModal existing={editTarget} accounts={accounts}
          onClose={() => { setShowNew(false); setEditTarget(null); }} />
      )}
      {showImport && <ImportModal onClose={() => setShowImport(false)} />}

      {/* Posted entry detail modal */}
      {aeSelected && (
        <Modal open title={aeDetail?.entry_number ?? 'Entry Detail'} onClose={() => setAeSelected(null)} size="lg">
          {aeDetailLoading ? (
            <div className="py-16 text-center text-gray-400">Loading…</div>
          ) : aeDetail ? (() => {
            const totalDr = (aeDetail.lines ?? []).reduce((s, l) => s + l.debit,  0);
            const totalCr = (aeDetail.lines ?? []).reduce((s, l) => s + l.credit, 0);
            const badge = sourceTypeBadge(aeDetail.source_type);
            return (
              <div className="space-y-4">
                {/* Meta row */}
                <div className="flex items-start justify-between gap-3 border-b pb-3">
                  <div className="space-y-0.5 min-w-0">
                    <p className="text-xs text-gray-400">{String(aeDetail.entry_date).slice(0, 10)}</p>
                    {aeDetail.description && (
                      <p className="text-sm text-gray-700 break-words">{aeDetail.description}</p>
                    )}
                    {aeDetail.created_by && (
                      <p className="text-xs text-gray-400">Posted by {aeDetail.created_by}</p>
                    )}
                  </div>
                  <span className={`flex-shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${badge.color}`}>
                    {badge.label}
                  </span>
                </div>

                {/* Lines table */}
                <div className="rounded-xl border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="text-left px-4 py-2.5 font-medium text-gray-600">Account</th>
                        <th className="text-right px-4 py-2.5 font-medium text-gray-600 w-28">Debit</th>
                        <th className="text-right px-4 py-2.5 font-medium text-gray-600 w-28">Credit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(aeDetail.lines ?? []).map((l) => (
                        <tr key={l.lineId}>
                          <td className="px-4 py-3">
                            <div className="flex items-baseline gap-2">
                              <span className="font-mono text-xs text-gray-400 flex-shrink-0">{l.accountCode}</span>
                              <span className="text-sm text-gray-800">{l.accountName}</span>
                            </div>
                            {(l.entityName || l.description) && (
                              <p className="mt-0.5 text-xs text-gray-400 pl-0">{l.entityName || l.description}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm">{l.debit  > 0 ? fmt(l.debit)  : '—'}</td>
                          <td className="px-4 py-3 text-right font-mono text-sm">{l.credit > 0 ? fmt(l.credit) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                      <tr>
                        <td className="px-4 py-2.5 font-semibold text-gray-700">Total</td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold">{fmt(totalDr)}</td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold">{fmt(totalCr)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            );
          })() : null}
        </Modal>
      )}
    </div>
  );
}
