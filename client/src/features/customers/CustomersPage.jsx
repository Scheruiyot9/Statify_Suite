import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Edit2, Star, Phone, Mail, Download, RefreshCw, CreditCard, ExternalLink, BookOpen } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/services/api';
import { formatCurrency, formatDate } from '@/utils/formatters';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import ReceiptModal from '@/components/ui/ReceiptModal';
import { PageSpinner } from '@/components/ui/Spinner';
import { usePermission } from '@/hooks/usePermission';
import { exportToExcel } from '@/utils/exportExcel';

function CustomerForm({ initial, groups, creditEnabled, onSave, onClose }) {
  const [form, setForm] = useState({
    customer_name:     initial?.customer_name     ?? '',
    phone:             initial?.phone             ?? '',
    email:             initial?.email             ?? '',
    customer_group_id: initial?.customer_group_id ?? '',
    id_number:         initial?.id_number         ?? '',
    kra_pin:           initial?.kra_pin           ?? '',
    notes:             initial?.notes             ?? '',
    allow_credit:      initial?.allow_credit      ?? false,
    credit_limit:      initial?.credit_limit      ?? 0,
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none';

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(form); }} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-full">
          <label className="block text-xs font-medium text-gray-700 mb-1">Full Name *</label>
          <input required className={inputCls} value={form.customer_name} onChange={(e) => set('customer_name', e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Phone</label>
          <input className={inputCls} value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+254…" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
          <input type="email" className={inputCls} value={form.email} onChange={(e) => set('email', e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">National ID / Passport</label>
          <input className={inputCls} value={form.id_number} onChange={(e) => set('id_number', e.target.value)}
            placeholder="e.g. 12345678" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">KRA PIN</label>
          <input className={inputCls} value={form.kra_pin} onChange={(e) => set('kra_pin', e.target.value.toUpperCase())}
            placeholder="e.g. A012345678B" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Customer Group</label>
          <select className={inputCls} value={form.customer_group_id} onChange={(e) => set('customer_group_id', e.target.value)}>
            <option value="">— None —</option>
            {groups?.map((g) => <option key={g.group_id} value={g.group_id}>{g.group_name}</option>)}
          </select>
        </div>
        <div className="col-span-full">
          <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
          <textarea rows={2} className={inputCls} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
        {creditEnabled && (
          <>
            <div className="col-span-full flex items-center gap-3 pt-1">
              <input type="checkbox" id="allow_credit" checked={form.allow_credit}
                onChange={(e) => set('allow_credit', e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
              <label htmlFor="allow_credit" className="text-sm font-medium text-gray-700 select-none">Allow credit sales</label>
            </div>
            {form.allow_credit && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Credit Limit (KES)</label>
                <input type="number" min="0" step="100" className={inputCls}
                  value={form.credit_limit}
                  onChange={(e) => set('credit_limit', e.target.value)} />
              </div>
            )}
          </>
        )}
      </div>
      <div className="flex justify-end gap-3 pt-2">
        <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
        <Button variant="primary" type="submit">{initial ? 'Save Changes' : 'Add Customer'}</Button>
      </div>
    </form>
  );
}

function CustomerDetail({ customer, creditEnabled, onRecordPayment, onViewTransaction }) {
  const qc = useQueryClient();
  const showCredit = creditEnabled && !!customer?.allow_credit;
  const { data: creditTxns = [] } = useQuery({
    queryKey: ['credit-transactions', customer?.customer_id],
    queryFn: () => api.get(`/customers/${customer.customer_id}/credit-transactions`).then((r) => r.data.data),
    enabled: showCredit && !!customer?.customer_id,
  });

  const syncMut = useMutation({
    mutationFn: () => api.post(`/customers/${customer.customer_id}/recalculate-balance`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['credit-transactions', customer.customer_id] });
    },
    onError: (e) => console.error('Balance sync failed:', e.response?.data?.message),
  });

  if (!customer) return null;
  const creditUsed      = customer.credit_balance  ?? 0;
  const creditLimit     = customer.credit_limit    ?? 0;
  const creditAvailable = Math.max(0, creditLimit - creditUsed);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 pb-4 border-b border-gray-100">
        <div className="h-12 w-12 flex-shrink-0 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-bold text-lg">
          {customer.customer_name[0]}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-gray-900 truncate">{customer.customer_name}</p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5">
            <span className="font-mono text-xs text-gray-400">{customer.customer_code}</span>
            {customer.group_name && (
              <span className="rounded-full bg-secondary-100 px-2 py-0.5 text-[10px] font-medium text-secondary-700">{customer.group_name}</span>
            )}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total Spent', value: formatCurrency(customer.total_spent) },
          { label: 'Purchases', value: customer.purchase_count },
          { label: 'Loyalty Points', value: (customer.loyalty_points_balance ?? 0).toLocaleString() },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg bg-gray-50 p-3 text-center">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="text-lg font-bold text-gray-900">{value}</p>
          </div>
        ))}
      </div>
      {showCredit && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
          <div className="flex items-center gap-2 text-amber-800 font-semibold text-sm">
            <CreditCard className="h-4 w-4" /> Credit Account
          </div>
          <div className="grid grid-cols-3 gap-3 text-center text-xs">
            <div>
              <div className="flex items-center justify-center gap-1">
                <p className="text-gray-500">Outstanding</p>
                <button
                  title="Sync balance from ledger"
                  onClick={() => syncMut.mutate()}
                  disabled={syncMut.isPending}
                  className="text-gray-300 hover:text-amber-600 cursor-pointer transition-colors"
                >
                  <RefreshCw className={`h-3 w-3 ${syncMut.isPending ? 'animate-spin' : ''}`} />
                </button>
              </div>
              <p className="font-bold text-red-600">{formatCurrency(creditUsed)}</p>
            </div>
            <div>
              <p className="text-gray-500">Limit</p>
              <p className="font-bold text-gray-800">{formatCurrency(creditLimit)}</p>
            </div>
            <div>
              <p className="text-gray-500">Available</p>
              <p className="font-bold text-green-700">{formatCurrency(creditAvailable)}</p>
            </div>
          </div>
          {creditTxns.length > 0 && (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {creditTxns.map((t) => (
                <button key={t.transaction_id}
                  onClick={() => onViewTransaction?.(t.transaction_id)}
                  className={`w-full flex items-center justify-between rounded-lg border px-3 py-2 text-xs text-left transition-colors hover:bg-gray-50 ${t.payment_status === 'paid' ? 'border-green-100 bg-green-50' : 'border-amber-100 bg-white'}`}>
                  <div className="min-w-0">
                    <p className="font-mono font-semibold text-gray-700 flex items-center gap-1">
                      {t.transaction_number}<ExternalLink className="h-2.5 w-2.5 text-gray-400" />
                    </p>
                    <p className="text-gray-400">{formatDate(t.transaction_date)}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`font-bold ${t.payment_status === 'paid' ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCurrency(t.total_amount)}
                    </p>
                    <p className={`text-[10px] uppercase font-semibold ${t.payment_status === 'paid' ? 'text-green-500' : 'text-orange-500'}`}>
                      {t.payment_status === 'paid' ? 'Paid' : 'Unpaid'}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
          {creditUsed > 0 && (
            <Button size="sm" variant="secondary" fullWidth icon={<CreditCard className="h-3.5 w-3.5" />}
              onClick={onRecordPayment}>
              Record Payment
            </Button>
          )}
        </div>
      )}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Contact & Details</p>
        <div className="grid grid-cols-2 gap-2 text-sm">
          {customer.phone && <div className="flex items-center gap-2 text-gray-600"><Phone className="h-4 w-4 text-gray-400" />{customer.phone}</div>}
          {customer.email && <div className="flex items-center gap-2 text-gray-600 truncate"><Mail className="h-4 w-4 text-gray-400 flex-shrink-0" />{customer.email}</div>}
          {customer.id_number && (
            <div className="text-gray-600 text-xs"><span className="text-gray-400">ID: </span>{customer.id_number}</div>
          )}
          {customer.kra_pin && (
            <div className="text-gray-600 text-xs font-mono"><span className="text-gray-400 font-sans">KRA: </span>{customer.kra_pin}</div>
          )}
          {!customer.phone && !customer.email && !customer.id_number && !customer.kra_pin && (
            <p className="col-span-full text-gray-400 text-xs">No contact details on file</p>
          )}
        </div>
        {customer.notes && (
          <p className="mt-2 rounded-lg bg-gray-50 p-2 text-xs text-gray-500">{customer.notes}</p>
        )}
      </div>
    </div>
  );
}

export default function CustomersPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { hasCapability } = usePermission();
  const canCreateCustomers = hasCapability('customers.create');
  const canManageCustomers = hasCapability('customers.manage');
  const [search, setSearch]         = useState('');
  const [page, setPage]             = useState(1);
  const [modal, setModal]           = useState(null);
  const [detail, setDetail]         = useState(null);
  const [creditPay, setCreditPay]       = useState(null);
  const [payAmount, setPayAmount]       = useState('');
  const [payMethodId, setPayMethodId]   = useState('');
  const [txnPreviewId, setTxnPreviewId] = useState(null);
  const [outstandingOnly, setOutstandingOnly] = useState(false);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['customers', search, page, outstandingOnly],
    queryFn: () => api.get('/customers', { params: { search, page, limit: 25, creditOutstanding: outstandingOnly ? 'true' : undefined } }).then((r) => r.data.data),
    keepPreviousData: true,
  });

  const { data: groups = [] } = useQuery({
    queryKey: ['customer-groups'],
    queryFn: () => api.get('/customers/groups').then((r) => r.data.data),
  });

  const { data: companyData } = useQuery({
    queryKey: ['my-company'],
    queryFn: () => api.get('/companies/mine').then((r) => r.data.data),
  });
  const creditEnabled = !!companyData?.credit_sales_enabled;

  const { data: txnDetail, isLoading: txnDetailLoading } = useQuery({
    queryKey: ['txn-detail', txnPreviewId],
    queryFn: () => api.get(`/sales/transactions/${txnPreviewId}`).then((r) => r.data.data),
    enabled: !!txnPreviewId,
    staleTime: Infinity,
  });

  const { data: customerDetail } = useQuery({
    queryKey: ['customer-detail', detail],
    queryFn: () => api.get(`/customers/${detail}`).then((r) => r.data.data),
    enabled: !!detail,
  });

  const createMut = useMutation({
    mutationFn: (d) => api.post('/customers', d),
    onSuccess: () => { toast.success('Customer added'); qc.invalidateQueries(['customers']); setModal(null); },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, ...d }) => api.put(`/customers/${id}`, d),
    onSuccess: () => { toast.success('Customer updated'); qc.invalidateQueries(['customers']); setModal(null); },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed'),
  });

  // The list row doesn't carry every field (e.g. notes) — fetch the full record before
  // opening the edit form, or an untouched field would submit as '' and blank it out.
  const openEdit = async (customerId) => {
    try {
      const res = await api.get(`/customers/${customerId}`);
      setModal(res.data.data);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load customer');
    }
  };

  const { data: payMethods = [] } = useQuery({
    queryKey: ['payment-methods'],
    queryFn: () => api.get('/pos/payment-methods').then((r) => r.data.data ?? r.data),
    enabled: creditEnabled,
  });

  const creditPayMut = useMutation({
    mutationFn: ({ id, amount, paymentMethodId }) => api.post(`/customers/${id}/credit-payment`, { amount, paymentMethodId }),
    onSuccess: (res) => {
      toast.success(`Payment recorded — balance: ${formatCurrency(res.data.data.credit_balance)}`);
      qc.invalidateQueries(['customers']);
      qc.invalidateQueries(['customer-detail', detail]);
      qc.invalidateQueries(['credit-transactions', creditPay?.id]);
      setCreditPay(null);
      setPayAmount('');
      setPayMethodId('');
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed'),
  });

  const customers = data?.customers ?? [];
  const total     = data?.total     ?? 0;
  const pages     = data?.pages     ?? 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Search by name, phone or email…"
            value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none" />
        </div>
        {creditEnabled && (
          <button onClick={() => { setOutstandingOnly((v) => !v); setPage(1); }}
            className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${outstandingOnly ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>
            {outstandingOnly ? 'Outstanding only' : 'All customers'}
          </button>
        )}
        <Button variant="secondary" size="sm"
          icon={<RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />}
          onClick={() => refetch()}>
          Refresh
        </Button>
        <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />}
          onClick={() => exportToExcel('customers', customers, [
            'customer_name','phone','email','loyalty_points_balance','total_spent','created_at',
          ], ['Name','Phone','Email','Loyalty Points','Total Spent','Joined'])}>
          Export
        </Button>
        {canCreateCustomers && (
          <Button variant="primary" size="sm" onClick={() => setModal('create')} icon={<Plus className="h-4 w-4" />}>
            Add Customer
          </Button>
        )}
      </div>

      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        {isLoading ? <PageSpinner /> : customers.length === 0 ? (
          <p className="py-12 text-center text-gray-400">No customers found</p>
        ) : (
          <>
          {/* Desktop table — every column always visible */}
          <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Customer</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Contact</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Group</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Purchases</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Points</th>
                {creditEnabled && <th className="px-4 py-3 text-right font-medium text-gray-600">Balance</th>}
                {canManageCustomers && <th className="px-4 py-3 text-center font-medium text-gray-600">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {customers.map((c) => (
                <tr key={c.customer_id} className="hover:bg-gray-50 active:bg-gray-100 cursor-pointer transition-colors"
                  onClick={() => setDetail(c.customer_id)}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="h-8 w-8 flex-shrink-0 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-bold text-xs">
                        {c.customer_name[0]}
                      </div>
                      <p className="font-medium text-gray-900 truncate">
                        {c.customer_name} <span className="font-normal text-gray-400">· {c.customer_code}</span>
                      </p>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    <p className="truncate max-w-[220px]">
                      {[c.phone, c.email].filter(Boolean).join('  ·  ') || '—'}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    {c.group_name
                      ? <span className="rounded-full bg-secondary-100 px-2 py-0.5 text-xs font-medium text-secondary-700">{c.group_name}</span>
                      : <span className="text-gray-400 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">{c.purchase_count}</td>
                  <td className="px-4 py-3 text-right">
                    <span className="flex items-center justify-end gap-1 text-secondary-600 font-medium text-xs">
                      <Star className="h-3 w-3" />{c.loyalty_points_balance.toLocaleString()}
                    </span>
                  </td>
                  {creditEnabled && (
                    <td className="px-4 py-3 text-right">
                      {c.allow_credit && c.credit_balance > 0
                        ? <span className="font-semibold text-red-600 text-xs">{formatCurrency(c.credit_balance)}</span>
                        : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                  )}
                  {canManageCustomers && (
                    <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1.5">
                        <button onClick={() => openEdit(c.customer_id)}
                          className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-primary-700 transition-colors">
                          <Edit2 className="h-3 w-3" />Edit
                        </button>
                        {c.allow_credit && (
                          <button onClick={() => navigate(`/app/customers/${c.customer_id}/ledger`)}
                            className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-primary-700 transition-colors">
                            <BookOpen className="h-3 w-3" />Entries
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden space-y-2 p-3">
            {customers.map((c) => (
              <div key={c.customer_id} onClick={() => setDetail(c.customer_id)}
                className="rounded-xl border border-gray-100 bg-white p-3 active:bg-gray-50 transition-colors">
                <div className="flex items-start gap-2">
                  <div className="h-9 w-9 flex-shrink-0 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-bold text-xs">
                    {c.customer_name[0]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-gray-900 truncate">{c.customer_name}</p>
                      {creditEnabled && c.allow_credit && c.credit_balance > 0 && (
                        <span className="shrink-0 text-xs font-semibold text-red-600">{formatCurrency(c.credit_balance)}</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400">{c.customer_code}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500">
                      {c.phone && <span>{c.phone}</span>}
                      {c.group_name && <span className="rounded-full bg-secondary-100 px-2 py-0.5 font-medium text-secondary-700">{c.group_name}</span>}
                      <span className="flex items-center gap-1 text-secondary-600 font-medium">
                        <Star className="h-3 w-3" />{c.loyalty_points_balance.toLocaleString()}
                      </span>
                      <span>{c.purchase_count} purchase{c.purchase_count === 1 ? '' : 's'}</span>
                    </div>
                  </div>
                </div>
                {canManageCustomers && (
                  <div className="mt-2 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => openEdit(c.customer_id)}
                      className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-primary-700 transition-colors">
                      <Edit2 className="h-3.5 w-3.5" />Edit
                    </button>
                    {c.allow_credit && (
                      <button onClick={() => navigate(`/app/customers/${c.customer_id}/ledger`)}
                        className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-primary-700 transition-colors">
                        <BookOpen className="h-3.5 w-3.5" />Entries
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          </>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
            <p className="text-xs text-gray-500">Page {page} of {pages}</p>
            <div className="flex gap-1">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-md border border-gray-200 px-3 py-1 text-xs disabled:opacity-40 hover:bg-gray-50">← Prev</button>
              <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded-md border border-gray-200 px-3 py-1 text-xs disabled:opacity-40 hover:bg-gray-50">Next →</button>
            </div>
          </div>
        )}
      </div>

      <Modal open={(canCreateCustomers && modal === 'create') || (canManageCustomers && !!modal && typeof modal === 'object')} onClose={() => setModal(null)}
        title={modal === 'create' ? 'New Customer' : `Edit: ${modal?.customer_name}`} size="md">
        <CustomerForm initial={modal !== 'create' ? modal : undefined} groups={groups} creditEnabled={creditEnabled}
          onClose={() => setModal(null)}
          onSave={(d) => modal === 'create' ? createMut.mutate(d) : updateMut.mutate({ id: modal.customer_id, ...d })} />
      </Modal>

      <Modal open={!!detail && !modal} onClose={() => setDetail(null)}
        title={customerDetail?.customer_name ?? 'Customer Details'} size="md"
        footer={canManageCustomers && customerDetail && (
          <div className="flex gap-3">
            <Button variant="secondary" fullWidth onClick={() => setDetail(null)}>Close</Button>
            {customerDetail.allow_credit && (
              <Button variant="secondary" fullWidth icon={<BookOpen className="h-4 w-4" />}
                onClick={() => { setDetail(null); navigate(`/app/customers/${customerDetail.customer_id}/ledger`); }}>
                View Entries
              </Button>
            )}
            <Button fullWidth icon={<Edit2 className="h-4 w-4" />}
              onClick={() => { setModal(customerDetail); setDetail(null); }}>
              Edit
            </Button>
          </div>
        )}
      >
        <CustomerDetail customer={customerDetail} creditEnabled={creditEnabled}
          onRecordPayment={() => setCreditPay({ id: customerDetail.customer_id, name: customerDetail.customer_name, balance: customerDetail.credit_balance })}
          onViewTransaction={(txnId) => setTxnPreviewId(txnId)} />
      </Modal>

      <ReceiptModal
        open={!!txnPreviewId}
        onClose={() => setTxnPreviewId(null)}
        txn={txnDetail}
      />

      <Modal open={!!creditPay} onClose={() => { setCreditPay(null); setPayAmount(''); setPayMethodId(''); }}
        title={`Record Payment — ${creditPay?.name ?? ''}`} size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Outstanding balance: <span className="font-semibold text-red-600">{formatCurrency(creditPay?.balance ?? 0)}</span>
          </p>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Payment Amount (KES)</label>
            <input type="number" min="1" step="0.01" autoFocus
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
              value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Payment Method</label>
            <select value={payMethodId} onChange={(e) => setPayMethodId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none">
              <option value="">— Cash (default) —</option>
              {payMethods.map((m) => (
                <option key={m.payment_method_id} value={m.payment_method_id}>{m.method_name}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" fullWidth onClick={() => { setCreditPay(null); setPayAmount(''); setPayMethodId(''); }}>Cancel</Button>
            <Button variant="primary" fullWidth
              disabled={!payAmount || parseFloat(payAmount) <= 0 || creditPayMut.isPending}
              onClick={() => creditPayMut.mutate({ id: creditPay.id, amount: parseFloat(payAmount), paymentMethodId: payMethodId || null })}>
              {creditPayMut.isPending ? 'Saving…' : 'Record Payment'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
