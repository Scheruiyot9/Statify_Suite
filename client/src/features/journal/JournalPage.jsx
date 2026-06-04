import { useState, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ScrollText, Plus, XCircle, RefreshCw, Download, Upload,
  AlertCircle, CheckCircle2, Building2, User, Briefcase, BookOpen, Edit2,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';
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

// ── Smart Account Picker ──────────────────────────────────────────────────────

function SmartAccountPicker({ line, idx, accounts, bankAccounts, customers, suppliers, onChange }) {
  const arAccount = useMemo(() => accounts.find((a) => a.account_code === '1100'), [accounts]);
  const apAccount = useMemo(() => accounts.find((a) => a.account_code === '2000'), [accounts]);

  const handleTypeChange = (newType) => {
    onChange(idx, { ...line, lineType: newType, entityId: '', accountId: '', description: '' });
  };

  const handleEntityChange = (entityId) => {
    let accountId = line.accountId;
    let description = line.description;
    let entityType = line.lineType;

    if (line.lineType === 'bank') {
      const ba = bankAccounts.find((b) => b.bank_account_id === entityId);
      accountId   = ba?.account_id ?? '';
      description = ba ? `${ba.bank_name} – ${ba.account_name}` : '';
      entityType  = 'bank_account';
    } else if (line.lineType === 'customer') {
      const cust = customers.find((c) => c.customer_id === entityId);
      accountId   = arAccount?.account_id ?? '';
      description = cust ? cust.customer_name : '';
    } else if (line.lineType === 'supplier') {
      const sup = suppliers.find((s) => s.supplier_id === entityId);
      accountId   = sup?.account_id ?? apAccount?.account_id ?? '';
      description = sup ? sup.supplier_name : '';
    }

    onChange(idx, { ...line, entityId, accountId, description, _entityType: entityType });
  };

  return (
    <div className="space-y-1">
      <div className="flex gap-0.5 rounded-md bg-gray-100 p-0.5">
        {LINE_TYPES.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" onClick={() => handleTypeChange(id)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors flex-1 justify-center
              ${line.lineType === id ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            <Icon className="h-3 w-3" />{label}
          </button>
        ))}
      </div>

      {line.lineType === 'account' && (
        <select className="w-full border rounded-lg px-2 py-1.5 text-sm" value={line.accountId}
          onChange={(e) => onChange(idx, { ...line, accountId: e.target.value })}>
          <option value="">Select account…</option>
          {['asset','liability','equity','revenue','expense'].map((type) => {
            const group = accounts.filter((a) => a.account_type === type && a.is_active);
            if (!group.length) return null;
            return (
              <optgroup key={type} label={type.charAt(0).toUpperCase() + type.slice(1)}>
                {group.map((a) => (
                  <option key={a.account_id} value={a.account_id}>{a.account_code} — {a.account_name}</option>
                ))}
              </optgroup>
            );
          })}
        </select>
      )}

      {line.lineType === 'bank' && (
        <select className="w-full border rounded-lg px-2 py-1.5 text-sm" value={line.entityId}
          onChange={(e) => handleEntityChange(e.target.value)}>
          <option value="">Select bank account…</option>
          {bankAccounts.map((b) => (
            <option key={b.bank_account_id} value={b.bank_account_id}>
              {b.bank_name} – {b.account_name}{b.account_number ? ` (…${b.account_number.slice(-4)})` : ''}
            </option>
          ))}
        </select>
      )}

      {line.lineType === 'customer' && (
        <select className="w-full border rounded-lg px-2 py-1.5 text-sm" value={line.entityId}
          onChange={(e) => handleEntityChange(e.target.value)}>
          <option value="">Select customer…</option>
          {customers.map((c) => (
            <option key={c.customer_id} value={c.customer_id}>
              {c.customer_name}{c.phone ? ` — ${c.phone}` : ''}
            </option>
          ))}
        </select>
      )}

      {line.lineType === 'supplier' && (
        <select className="w-full border rounded-lg px-2 py-1.5 text-sm" value={line.entityId}
          onChange={(e) => handleEntityChange(e.target.value)}>
          <option value="">Select supplier…</option>
          {suppliers.map((s) => (
            <option key={s.supplier_id} value={s.supplier_id}>{s.supplier_name}</option>
          ))}
        </select>
      )}

      {line.lineType !== 'account' && line.accountId && (
        <p className="text-xs text-gray-400 pl-1">
          GL: {accounts.find((a) => a.account_id === line.accountId)?.account_code}{' '}
          {accounts.find((a) => a.account_id === line.accountId)?.account_name}
        </p>
      )}
      {line.lineType !== 'account' && !line.accountId && line.entityId && (
        <p className="text-xs text-amber-500 pl-1">⚠ No GL account linked</p>
      )}
    </div>
  );
}

// ── Lines form (shared between create + edit) ─────────────────────────────────

function JournalLinesForm({ accounts, bankAccounts, customers, suppliers, lines, onChange }) {
  const addLine    = () => onChange([...lines, emptyLine()]);
  const removeLine = (i) => onChange(lines.filter((_, idx) => idx !== i));
  const updateLine = (i, l) => onChange(lines.map((x, idx) => (idx === i ? l : x)));

  const totalDr  = lines.reduce((s, l) => s + (parseFloat(l.debit)  || 0), 0);
  const totalCr  = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const balanced = Math.abs(totalDr - totalCr) < 0.005;

  return (
    <>
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-3 py-2 font-medium text-gray-600">Account / Entity</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600 w-40">Line Note</th>
              <th className="text-right px-3 py-2 font-medium text-gray-600 w-28">Debit</th>
              <th className="text-right px-3 py-2 font-medium text-gray-600 w-28">Credit</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {lines.map((l, i) => (
              <tr key={i} className="align-top">
                <td className="px-3 py-2">
                  <SmartAccountPicker line={l} idx={i} accounts={accounts}
                    bankAccounts={bankAccounts} customers={customers} suppliers={suppliers}
                    onChange={updateLine} />
                </td>
                <td className="px-3 py-2">
                  <input className="w-full border rounded-lg px-2 py-1.5 text-sm" placeholder="Note…"
                    value={l.description}
                    onChange={(e) => updateLine(i, { ...l, description: e.target.value })} />
                </td>
                <td className="px-3 py-2">
                  <input type="number" min="0" step="0.01" placeholder="0.00"
                    className="w-full border rounded-lg px-2 py-1.5 text-sm text-right"
                    value={l.debit}
                    onChange={(e) => updateLine(i, { ...l, debit: e.target.value, credit: e.target.value ? '' : l.credit })} />
                </td>
                <td className="px-3 py-2">
                  <input type="number" min="0" step="0.01" placeholder="0.00"
                    className="w-full border rounded-lg px-2 py-1.5 text-sm text-right"
                    value={l.credit}
                    onChange={(e) => updateLine(i, { ...l, credit: e.target.value, debit: e.target.value ? '' : l.debit })} />
                </td>
                <td className="px-3 py-2 pt-3">
                  {lines.length > 2 && (
                    <button onClick={() => removeLine(i)} className="text-gray-400 hover:text-red-500">
                      <XCircle className="h-4 w-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t bg-gray-50">
            <tr>
              <td colSpan={2} className="px-3 py-2 text-sm font-semibold">Totals</td>
              <td className={`px-3 py-2 text-right font-mono font-semibold ${!balanced && totalDr > 0 ? 'text-red-600' : 'text-green-700'}`}>
                {fmt(totalDr)}
              </td>
              <td className={`px-3 py-2 text-right font-mono font-semibold ${!balanced && totalDr > 0 ? 'text-red-600' : 'text-green-700'}`}>
                {fmt(totalCr)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="flex items-center justify-between">
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

  const [entryDate,    setEntryDate]    = useState(existing?.entry_date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10));
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
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Date *</label>
            <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm"
              value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
            <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. Monthly accrual"
              value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Reference</label>
            <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. INV-001"
              value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
        </div>

        <JournalLinesForm accounts={accounts} bankAccounts={bankAccounts}
          customers={customers} suppliers={suppliers} lines={lines} onChange={setLines} />

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      <div className="mt-6 flex justify-between gap-2 border-t pt-4">
        <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border hover:bg-gray-50">
          Cancel
        </button>
        <div className="flex gap-2">
          <button
            onClick={() => { setError(''); saveMut.mutate(buildPayload()); }}
            disabled={isPending}
            className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            {isPending ? 'Saving…' : 'Save as Draft'}
          </button>
          <button
            onClick={() => { setError(''); if (validate()) postMut.mutate(buildPayload()); }}
            disabled={isPending}
            className="px-4 py-2 text-sm rounded-lg bg-primary-600 text-white disabled:opacity-40"
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

  const [voidReason,   setVoidReason]   = useState('');
  const [showVoidForm, setShowVoidForm] = useState(false);

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

  return (
    <Modal open title={isLoading ? 'Loading…' : `${j?.journal_number} — ${j?.status?.toUpperCase()}`}
      onClose={onClose} size="lg">
      {isLoading ? (
        <div className="py-12 text-center text-gray-400">Loading…</div>
      ) : j ? (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4 text-sm bg-gray-50 rounded-lg p-4">
            <div><span className="text-gray-500 text-xs">Number</span><p className="font-mono font-semibold">{j.journal_number}</p></div>
            <div><span className="text-gray-500 text-xs">Date</span><p className="font-medium">{String(j.entry_date).slice(0, 10)}</p></div>
            <div><span className="text-gray-500 text-xs">Status</span>
              <p><span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLORS[j.status]}`}>{j.status}</span></p>
            </div>
            {j.description && <div className="col-span-full"><span className="text-gray-500 text-xs">Description</span><p>{j.description}</p></div>}
            {j.reference   && <div><span className="text-gray-500 text-xs">Reference</span><p>{j.reference}</p></div>}
            {j.created_by  && <div><span className="text-gray-500 text-xs">Created by</span><p>{j.created_by}</p></div>}
            {j.posted_by   && <div><span className="text-gray-500 text-xs">Posted by</span><p>{j.posted_by}</p></div>}
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 font-medium text-gray-600">Account</th>
                <th className="text-left py-2 font-medium text-gray-600">Entity / Note</th>
                <th className="text-right py-2 font-medium text-gray-600 w-32">Debit</th>
                <th className="text-right py-2 font-medium text-gray-600 w-32">Credit</th>
              </tr>
            </thead>
            <tbody>
              {(j.lines ?? []).map((l) => (
                <tr key={l.lineId} className="border-b last:border-0">
                  <td className="py-2">
                    <span className="font-mono text-xs text-gray-500 mr-1">{l.accountCode}</span>{l.accountName}
                  </td>
                  <td className="py-2 text-xs text-gray-500">
                    {l.entityName
                      ? <><span className="capitalize text-gray-400">{l.entityType?.replace('_', ' ')}</span>: {l.entityName}</>
                      : l.description || '—'}
                  </td>
                  <td className="py-2 text-right font-mono">{l.debit  > 0 ? fmt(l.debit)  : ''}</td>
                  <td className="py-2 text-right font-mono">{l.credit > 0 ? fmt(l.credit) : ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2">
              <tr>
                <td colSpan={2} className="py-2 font-semibold">Totals</td>
                <td className="py-2 text-right font-mono font-semibold">
                  {fmt((j.lines ?? []).reduce((s, l) => s + l.debit, 0))}
                </td>
                <td className="py-2 text-right font-mono font-semibold">
                  {fmt((j.lines ?? []).reduce((s, l) => s + l.credit, 0))}
                </td>
              </tr>
            </tfoot>
          </table>

          {/* Actions */}
          {j.status === 'draft' && (
            <div className="border-t pt-4 flex gap-2">
              <button onClick={() => onEdit(j)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border text-gray-700 hover:bg-gray-50">
                <Edit2 className="h-4 w-4" />Edit Draft
              </button>
              <button onClick={() => postMut.mutate()} disabled={postMut.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-primary-600 text-white disabled:opacity-40">
                {postMut.isPending ? 'Posting…' : 'Post to Ledger'}
              </button>
            </div>
          )}

          {j.status === 'posted' && (
            <div className="border-t pt-4">
              {showVoidForm ? (
                <div className="flex gap-2">
                  <input className="flex-1 border rounded-lg px-3 py-2 text-sm"
                    placeholder="Reason for voiding…"
                    value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
                  <button onClick={() => voidMut.mutate()} disabled={!voidReason.trim() || voidMut.isPending}
                    className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white disabled:opacity-40">
                    Confirm Void
                  </button>
                  <button onClick={() => setShowVoidForm(false)}
                    className="px-4 py-2 text-sm rounded-lg border">Cancel</button>
                </div>
              ) : (
                <button onClick={() => setShowVoidForm(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-red-300 text-red-600 hover:bg-red-50">
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

export default function JournalPage() {
  const [startDate,    setStartDate]    = useState(() => { const d = new Date(); d.setDate(d.getDate() - 29); return d.toISOString().slice(0, 10); });
  const [endDate,      setEndDate]      = useState(new Date().toISOString().slice(0, 10));
  const [statusFilter, setStatusFilter] = useState('');
  const [page,         setPage]         = useState(1);
  const [selectedId,   setSelectedId]   = useState(null);
  const [editTarget,   setEditTarget]   = useState(null);
  const [showNew,      setShowNew]      = useState(false);
  const [showImport,   setShowImport]   = useState(false);

  const qc = useQueryClient();

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get('/accounts').then((r) => r.data.data),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['journals', startDate, endDate, statusFilter, page],
    queryFn: () => api.get('/journals', {
      params: { startDate, endDate, status: statusFilter || undefined, page, limit: 25 },
    }).then((r) => r.data.data),
    placeholderData: (prev) => prev,
  });

  const journals = data?.journals ?? [];
  const total    = data?.total    ?? 0;
  const pages    = data?.pages    ?? 1;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-white flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
            <ScrollText className="h-5 w-5 text-primary-600" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={downloadTemplate}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border text-sm text-gray-600 hover:bg-gray-50">
            <Download className="h-4 w-4" />Template
          </button>
          <button onClick={() => setShowImport(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border text-sm text-gray-600 hover:bg-gray-50">
            <Upload className="h-4 w-4" />Import
          </button>
          <button onClick={() => setShowNew(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700">
            <Plus className="h-4 w-4" />New Journal
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 px-6 py-3 border-b bg-gray-50 flex-shrink-0">
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

      {/* Table */}
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
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 border-b z-10">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600 w-36">Number</th>
                <th className="hidden sm:table-cell text-left px-4 py-3 font-medium text-gray-600 w-28">Date</th>
                <th className="hidden md:table-cell text-left px-4 py-3 font-medium text-gray-600">Description</th>
                <th className="hidden lg:table-cell text-left px-4 py-3 font-medium text-gray-600 w-28">Reference</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600 w-32">Debit</th>
                <th className="hidden sm:table-cell text-right px-4 py-3 font-medium text-gray-600 w-32">Credit</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 w-24">Status</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600 w-20">Action</th>
              </tr>
            </thead>
            <tbody>
              {journals.map((j) => (
                <tr key={j.journalId} className="border-b hover:bg-gray-50 active:bg-gray-100 cursor-pointer"
                  onClick={() => setSelectedId(j.journalId)}>
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{j.journalNumber}</td>
                  <td className="hidden sm:table-cell px-4 py-3 text-xs text-gray-600">{String(j.entryDate).slice(0, 10)}</td>
                  <td className="hidden md:table-cell px-4 py-3 text-xs text-gray-800 truncate max-w-xs">{j.description ?? '—'}</td>
                  <td className="hidden lg:table-cell px-4 py-3 text-gray-500 text-xs">{j.reference ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-right font-mono">{fmt(j.totalDebit)}</td>
                  <td className="hidden sm:table-cell px-4 py-3 text-xs text-right font-mono">{fmt(j.totalCredit)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLORS[j.status]}`}>
                      {j.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => setSelectedId(j.journalId)}
                      className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-100 transition-colors">
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {total > 0 && (
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
    </div>
  );
}
