import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CreditCard, Plus, Search, AlertCircle, CheckCircle, XCircle, Trash2, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/services/api';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { PageSpinner } from '@/components/ui/Spinner';
import { formatCurrency } from '@/utils/formatters';

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500';
const sel = inp + ' bg-white';
const Field = ({ label, children, hint }) => (
  <div>
    <label className="mb-1 block text-xs font-medium text-gray-700">{label}</label>
    {children}
    {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
  </div>
);

const METHOD_LABELS = {
  bank_transfer: 'Bank Transfer',
  cash:          'Cash',
  cheque:        'Cheque',
  mpesa:         'M-Pesa',
  other:         'Other',
};

const METHOD_COLORS = {
  bank_transfer: 'bg-blue-100 text-blue-700',
  cash:          'bg-green-100 text-green-700',
  cheque:        'bg-purple-100 text-purple-700',
  mpesa:         'bg-emerald-100 text-emerald-700',
  other:         'bg-gray-100 text-gray-600',
};

function MethodBadge({ method }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${METHOD_COLORS[method] ?? 'bg-gray-100 text-gray-600'}`}>
      {METHOD_LABELS[method] ?? method}
    </span>
  );
}

// ── Payment Modal ─────────────────────────────────────────────────────────────

const emptyLine = () => ({ accountId: '', payeeName: '', amount: '' });

function PaymentModal({ onClose }) {
  const qc = useQueryClient();

  const [paymentType, setPaymentType] = useState('supplier');
  const [expenseLines, setExpenseLines] = useState([emptyLine()]);
  const [form, setForm] = useState({
    supplier_id:     '',
    branch_id:       '',
    bank_account_id: '',
    po_id:           '',
    payment_date:    new Date().toISOString().slice(0, 10),
    amount:          '',
    payment_method:  'bank_transfer',
    reference_number:'',
    notes:           '',
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const updateLine = (i, field, val) =>
    setExpenseLines((ls) => ls.map((l, idx) => idx === i ? { ...l, [field]: val } : l));
  const addLine    = () => setExpenseLines((ls) => [...ls, emptyLine()]);
  const removeLine = (i) => setExpenseLines((ls) => ls.filter((_, idx) => idx !== i));

  const { data: suppliersRaw } = useQuery({
    queryKey: ['suppliers'],
    queryFn:  () => api.get('/suppliers?limit=200').then((r) => r.data.data ?? r.data),
  });
  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn:  () => api.get('/branches').then((r) => r.data.data ?? []),
  });
  const { data: bankAccounts = [] } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn:  () => api.get('/bank-accounts').then((r) => r.data.data ?? []),
  });
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn:  () => api.get('/accounts').then((r) => r.data.data ?? []),
  });
  const { data: posRaw } = useQuery({
    queryKey: ['purchases-for-payment', form.supplier_id],
    queryFn:  () => api.get(`/purchases?supplierId=${form.supplier_id}&limit=100`).then((r) => r.data.data ?? r.data),
    enabled:  !!form.supplier_id && paymentType === 'supplier',
  });

  const suppliers      = Array.isArray(suppliersRaw) ? suppliersRaw : (suppliersRaw?.suppliers ?? []);
  const pos            = Array.isArray(posRaw) ? posRaw : (posRaw?.orders ?? []);
  const expenseAccounts = accounts.filter((a) => a.account_type === 'expense' && a.is_active);
  const selectedSupplier = suppliers.find((s) => s.supplier_id === form.supplier_id);
  const linesTotal = expenseLines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);

  const { mutate, isPending } = useMutation({
    mutationFn: (data) => api.post('/supplier-payments', data),
    onSuccess: () => {
      toast.success('Payment recorded');
      qc.invalidateQueries({ queryKey: ['supplier-payments'] });
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      qc.invalidateQueries({ queryKey: ['bank-accounts'] });
      onClose();
    },
    onError: (e) => toast.error(e.response?.data?.message ?? 'Failed to record payment'),
  });

  const handleSubmit = () => {
    if (!form.branch_id) return toast.error('Select a branch');
    if (paymentType === 'supplier') {
      if (!form.supplier_id) return toast.error('Select a supplier');
      if (!form.amount || parseFloat(form.amount) <= 0) return toast.error('Enter a valid amount');
    } else {
      if (expenseLines.some((l) => !l.accountId || !parseFloat(l.amount)))
        return toast.error('Each expense line needs an account and amount');
    }
    mutate({
      ...form,
      payment_type:    paymentType,
      amount:          paymentType === 'supplier' ? parseFloat(form.amount) : undefined,
      expense_lines:   paymentType === 'direct' ? expenseLines.map((l) => ({ ...l, amount: parseFloat(l.amount) })) : [],
      supplier_id:     paymentType === 'supplier' ? form.supplier_id : undefined,
      po_id:           paymentType === 'supplier' ? (form.po_id || undefined) : undefined,
      bank_account_id: form.bank_account_id || undefined,
      reference_number:form.reference_number || undefined,
      notes:           form.notes || undefined,
    });
  };

  return (
    <Modal open onClose={onClose} title="Record Payment" size="lg">
      <div className="space-y-4">

        {/* Type toggle */}
        <div className="flex gap-1 rounded-xl bg-gray-100 p-1">
          {[['supplier', 'Supplier Payment'], ['direct', 'Direct Expense']].map(([val, label]) => (
            <button key={val} type="button"
              onClick={() => { setPaymentType(val); set('supplier_id', ''); set('po_id', ''); setExpenseLines([emptyLine()]); }}
              className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                paymentType === val ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* Supplier payment fields */}
        {paymentType === 'supplier' && (
          <>
            <Field label="Supplier *">
              <select className={sel} value={form.supplier_id}
                onChange={(e) => { set('supplier_id', e.target.value); set('po_id', ''); }}>
                <option value="">— Select supplier —</option>
                {suppliers.map((s) => (
                  <option key={s.supplier_id} value={s.supplier_id}>{s.supplier_name}</option>
                ))}
              </select>
            </Field>

            {selectedSupplier && parseFloat(selectedSupplier.current_balance) > 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                <span className="text-sm text-amber-700">
                  Outstanding balance: <strong>{formatCurrency(selectedSupplier.current_balance)}</strong>
                </span>
              </div>
            )}

            {form.supplier_id && (
              <Field label="Against PO" hint="Optional — link to a specific purchase order">
                <select className={sel} value={form.po_id} onChange={(e) => set('po_id', e.target.value)}>
                  <option value="">— General payment —</option>
                  {pos.filter((po) => po.status !== 'cancelled' && po.status !== 'draft').map((po) => (
                    <option key={po.po_id} value={po.po_id}>
                      {po.po_number} · {po.status} — {formatCurrency(po.total_amount)}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </>
        )}

        {/* Direct expense lines */}
        {paymentType === 'direct' && (
          <div className="space-y-2">
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-600">Expense Account *</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-600 w-40">Payee / Description</th>
                    <th className="text-right px-3 py-2 text-xs font-medium text-gray-600 w-32">Amount *</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {expenseLines.map((l, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2">
                        <select className="w-full border rounded-lg px-2 py-1.5 text-xs"
                          value={l.accountId} onChange={(e) => updateLine(i, 'accountId', e.target.value)}>
                          <option value="">— Select —</option>
                          {expenseAccounts.map((a) => (
                            <option key={a.account_id} value={a.account_id}>
                              {a.account_code} — {a.account_name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input className="w-full border rounded-lg px-2 py-1.5 text-xs"
                          placeholder="e.g. Kenya Power"
                          value={l.payeeName} onChange={(e) => updateLine(i, 'payeeName', e.target.value)} />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" min="0" step="0.01" placeholder="0.00"
                          className="w-full border rounded-lg px-2 py-1.5 text-xs text-right"
                          value={l.amount} onChange={(e) => updateLine(i, 'amount', e.target.value)} />
                      </td>
                      <td className="px-2 py-2 text-center">
                        {expenseLines.length > 1 && (
                          <button onClick={() => removeLine(i)} className="text-gray-300 hover:text-red-500">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t bg-gray-50">
                  <tr>
                    <td colSpan={2} className="px-3 py-2 text-xs font-semibold text-gray-600">Total</td>
                    <td className="px-3 py-2 text-right text-xs font-bold text-gray-800">{formatCurrency(linesTotal)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            <button onClick={addLine} className="text-xs text-primary-600 hover:underline">+ Add line</button>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Branch *">
            <select className={sel} value={form.branch_id} onChange={(e) => set('branch_id', e.target.value)}>
              <option value="">— Select branch —</option>
              {branches.map((b) => (
                <option key={b.branch_id} value={b.branch_id}>{b.branch_name}</option>
              ))}
            </select>
          </Field>
          <Field label="Payment Date">
            <input type="date" className={inp} value={form.payment_date}
              onChange={(e) => set('payment_date', e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {paymentType === 'supplier' && (
            <Field label="Amount (KES) *">
              <input type="number" min="0.01" step="0.01" className={inp}
                value={form.amount} onChange={(e) => set('amount', e.target.value)}
                placeholder="0.00" />
            </Field>
          )}
          <Field label="Payment Method">
            <select className={sel} value={form.payment_method} onChange={(e) => set('payment_method', e.target.value)}>
              {Object.entries(METHOD_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Bank Account" hint="Optional — source of funds">
          <select className={sel} value={form.bank_account_id} onChange={(e) => set('bank_account_id', e.target.value)}>
            <option value="">— Cash / None —</option>
            {bankAccounts.map((ba) => (
              <option key={ba.bank_account_id} value={ba.bank_account_id}>
                {ba.account_name} ({ba.bank_name}) — {formatCurrency(ba.current_balance)}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Reference / Cheque No.">
          <input type="text" className={inp} value={form.reference_number}
            onChange={(e) => set('reference_number', e.target.value)}
            placeholder="Transaction ref, cheque number, etc." />
        </Field>

        <Field label="Notes">
          <textarea rows={2} className={inp} value={form.notes}
            onChange={(e) => set('notes', e.target.value)} />
        </Field>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} isLoading={isPending}>
            <CheckCircle className="h-4 w-4 mr-2" />Record Payment
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Payment Detail Modal ──────────────────────────────────────────────────────

const RO = ({ label, value, mono }) => (
  <div className="rounded-lg bg-gray-50 px-3 py-2.5">
    <p className="text-xs text-gray-400 mb-0.5">{label}</p>
    <p className={`text-sm font-medium text-gray-900 ${mono ? 'font-mono' : ''}`}>{value || '—'}</p>
  </div>
);

function PaymentDetail({ payment, onClose }) {
  const qc = useQueryClient();
  const user = JSON.parse(localStorage.getItem('auth-storage') || '{}')?.state?.user;
  const canVoid = user?.role === 'company_admin' || user?.role === 'super_admin';

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn:  () => api.get('/accounts').then((r) => r.data.data ?? []),
    staleTime: 60_000,
  });
  const accountMap = Object.fromEntries(accounts.map((a) => [a.account_id, a]));

  const voidM = useMutation({
    mutationFn: () => api.post(`/supplier-payments/${payment.payment_id}/void`),
    onSuccess: () => {
      toast.success('Payment voided');
      qc.invalidateQueries({ queryKey: ['supplier-payments'] });
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      qc.invalidateQueries({ queryKey: ['bank-accounts'] });
      onClose();
    },
    onError: (e) => toast.error(e.response?.data?.message ?? 'Void failed'),
  });

  const isDirect = payment.payment_type === 'direct';
  const expLines = Array.isArray(payment.expense_lines) ? payment.expense_lines : [];

  return (
    <Modal open onClose={onClose} title="Payment Details" size="md"
      footer={
        <div className="flex justify-between gap-3 w-full">
          {canVoid && !payment.is_void && (
            <Button variant="secondary" size="sm" className="!text-red-600 !border-red-200 hover:!bg-red-50"
              onClick={() => {
                if (window.confirm('Void this payment? The ledger entry will be reversed.'))
                  voidM.mutate();
              }}
              loading={voidM.isPending}>
              <XCircle className="h-4 w-4 mr-1" />Void
            </Button>
          )}
          <Button variant="secondary" onClick={onClose} className="ml-auto">Close</Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Header strip */}
        <div className="flex items-center gap-3">
          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${isDirect ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
            {isDirect ? 'Direct Expense' : 'Supplier Payment'}
          </span>
          <span className="font-mono text-xs text-gray-500">{payment.payment_number || '—'}</span>
          {payment.is_void && (
            <span className="inline-flex rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">VOID</span>
          )}
        </div>

        {/* Supplier / payee info */}
        {!isDirect && (
          <div className="grid grid-cols-2 gap-3">
            <RO label="Supplier" value={payment.supplier_name} />
            <RO label="PO Reference" value={payment.po_number} />
          </div>
        )}

        {/* Core fields */}
        <div className="grid grid-cols-2 gap-3">
          <RO label="Date" value={payment.payment_date?.slice(0, 10)} />
          <RO label="Branch" value={payment.branch_name} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-gray-50 px-3 py-2.5">
            <p className="text-xs text-gray-400 mb-0.5">Method</p>
            <MethodBadge method={payment.payment_method} />
          </div>
          <RO label="Bank Account" value={payment.bank_account_name || 'Cash / None'} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <RO label="Reference" value={payment.reference_number} />
          <div className="rounded-lg bg-gray-50 px-3 py-2.5">
            <p className="text-xs text-gray-400 mb-0.5">Amount</p>
            <p className="text-sm font-bold text-gray-900 font-mono">{formatCurrency(payment.amount)}</p>
          </div>
        </div>
        {payment.notes && <RO label="Notes" value={payment.notes} />}
        <RO label="Recorded By" value={payment.created_by} />

        {/* Expense lines (direct only) */}
        {isDirect && expLines.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Expense Lines</p>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-gray-600">Expense Account</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-600">Payee / Description</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-600">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {expLines.map((l, i) => {
                    const acc = accountMap[l.accountId];
                    return (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-700">
                          {acc ? `${acc.account_code} — ${acc.account_name}` : l.accountId}
                        </td>
                        <td className="px-3 py-2 text-gray-500">{l.payeeName || '—'}</td>
                        <td className="px-3 py-2 text-right font-mono font-semibold">{formatCurrency(l.amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="border-t bg-gray-50">
                  <tr>
                    <td colSpan={2} className="px-3 py-2 text-xs font-semibold text-gray-600">Total</td>
                    <td className="px-3 py-2 text-right text-xs font-bold font-mono">{formatCurrency(payment.amount)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── AP Summary Cards ──────────────────────────────────────────────────────────

function APSummary({ suppliers }) {
  const withBalance = suppliers.filter((s) => parseFloat(s.current_balance) > 0);
  const totalAP = withBalance.reduce((sum, s) => sum + parseFloat(s.current_balance), 0);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div className="rounded-xl border border-gray-200 bg-white px-5 py-4">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total AP Outstanding</p>
        <p className="mt-1 text-2xl font-bold text-red-600">{formatCurrency(totalAP)}</p>
      </div>
      <div className="rounded-xl border border-gray-200 bg-white px-5 py-4">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Suppliers with Balance</p>
        <p className="mt-1 text-2xl font-bold text-gray-900">{withBalance.length}</p>
      </div>
      <div className="rounded-xl border border-gray-200 bg-white px-5 py-4">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Suppliers</p>
        <p className="mt-1 text-2xl font-bold text-gray-900">{suppliers.length}</p>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PaymentsPage() {
  const [showModal,       setShowModal]       = useState(false);
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [search,          setSearch]          = useState('');
  const [supplierFilt,    setSupplierFilt]    = useState('');
  const [typeFilt,        setTypeFilt]        = useState('');

  const { data: suppliersRaw2 } = useQuery({
    queryKey: ['suppliers'],
    queryFn:  () => api.get('/suppliers?limit=200').then((r) => r.data.data ?? r.data),
  });
  const suppliers = Array.isArray(suppliersRaw2) ? suppliersRaw2 : (suppliersRaw2?.suppliers ?? []);

  const { data: paymentsRaw, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['supplier-payments', supplierFilt],
    queryFn:  () => api.get(`/supplier-payments?limit=100${supplierFilt ? `&supplierId=${supplierFilt}` : ''}`).then((r) => r.data.data ?? r.data),
  });
  const payments = Array.isArray(paymentsRaw) ? paymentsRaw : (paymentsRaw?.payments ?? []);

  const filtered = payments.filter((p) => {
    if (typeFilt && p.payment_type !== typeFilt) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        p.supplier_name?.toLowerCase().includes(q) ||
        p.payee_name?.toLowerCase().includes(q) ||
        p.reference_number?.toLowerCase().includes(q) ||
        p.payment_number?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const totalPaid = filtered.reduce((s, p) => s + parseFloat(p.amount), 0);

  return (
    <div className="space-y-6">
      <APSummary suppliers={suppliers} />

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            placeholder="Search number, supplier, payee…"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:border-primary-500 focus:outline-none"
          value={supplierFilt} onChange={(e) => { setSupplierFilt(e.target.value); setSearch(''); }}>
          <option value="">All suppliers</option>
          {suppliers.map((s) => (
            <option key={s.supplier_id} value={s.supplier_id}>{s.supplier_name}</option>
          ))}
        </select>
        <select className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:border-primary-500 focus:outline-none"
          value={typeFilt} onChange={(e) => setTypeFilt(e.target.value)}>
          <option value="">All types</option>
          <option value="supplier">Supplier</option>
          <option value="direct">Direct Expense</option>
        </select>
        <Button variant="secondary" size="sm"
          icon={<RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />}
          onClick={() => refetch()}>
          Refresh
        </Button>
        <Button size="sm" onClick={() => setShowModal(true)}>
          <Plus className="h-4 w-4 mr-1" />Record Payment
        </Button>
      </div>

      {/* Table */}
      {isLoading ? <PageSpinner /> : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="py-3 pl-4 text-left text-xs font-medium text-gray-500">No.</th>
                  <th className="py-3 px-4 text-left text-xs font-medium text-gray-500">Date</th>
                  <th className="py-3 px-4 text-left text-xs font-medium text-gray-500">Payee / Supplier</th>
                  <th className="hidden sm:table-cell py-3 px-4 text-left text-xs font-medium text-gray-500">Method</th>
                  <th className="hidden md:table-cell py-3 px-4 text-left text-xs font-medium text-gray-500">Reference</th>
                  <th className="hidden lg:table-cell py-3 px-4 text-left text-xs font-medium text-gray-500">Type</th>
                  <th className="py-3 px-4 text-right text-xs font-medium text-gray-500">Amount</th>
                  <th className="py-3 pr-4 text-center text-xs font-medium text-gray-500">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-gray-400">No payments recorded</td>
                  </tr>
                ) : filtered.map((p) => (
                  <tr key={p.payment_id} className="hover:bg-gray-50 active:bg-gray-100 cursor-pointer"
                    onClick={() => setSelectedPayment(p)}>
                    <td className="py-3 pl-4 font-mono text-xs text-gray-500">{p.payment_number || '—'}</td>
                    <td className="py-3 px-4 text-xs text-gray-600">{p.payment_date?.slice(0, 10)}</td>
                    <td className="py-3 px-4 font-medium text-gray-900 text-xs">
                      {p.payment_type === 'direct' ? (p.payee_name || '—') : p.supplier_name}
                    </td>
                    <td className="hidden sm:table-cell py-3 px-4"><MethodBadge method={p.payment_method} /></td>
                    <td className="hidden md:table-cell py-3 px-4 text-xs text-gray-500">{p.reference_number || '—'}</td>
                    <td className="hidden lg:table-cell py-3 px-4">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${p.payment_type === 'direct' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                        {p.payment_type === 'direct' ? 'Expense' : 'Supplier'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right text-xs font-semibold text-gray-900">{formatCurrency(p.amount)}</td>
                    <td className="py-3 pr-4 text-center" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => setSelectedPayment(p)}
                        className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-100 transition-colors">
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              {filtered.length > 0 && (
                <tfoot className="border-t border-gray-200 bg-gray-50">
                  <tr>
                    <td colSpan={7} className="py-2 pl-4 text-xs font-medium text-gray-500">
                      {filtered.length} payment{filtered.length !== 1 ? 's' : ''}
                    </td>
                    <td className="py-2 pr-4 text-right text-sm font-bold text-gray-900">
                      {formatCurrency(totalPaid)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {showModal && <PaymentModal onClose={() => setShowModal(false)} />}
      {selectedPayment && <PaymentDetail payment={selectedPayment} onClose={() => setSelectedPayment(null)} />}
    </div>
  );
}
