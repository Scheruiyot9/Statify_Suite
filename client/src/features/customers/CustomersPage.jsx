import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Edit2, Star, Phone, Mail, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/services/api';
import { formatCurrency, formatDate } from '@/utils/formatters';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { PageSpinner } from '@/components/ui/Spinner';
import { usePermission } from '@/hooks/usePermission';
import { exportToExcel } from '@/utils/exportExcel';

function CustomerForm({ initial, groups, onSave, onClose }) {
  const [form, setForm] = useState({
    customer_name:     initial?.customer_name     ?? '',
    phone:             initial?.phone             ?? '',
    email:             initial?.email             ?? '',
    customer_group_id: initial?.customer_group_id ?? '',
    id_number:         initial?.id_number         ?? '',
    kra_pin:           initial?.kra_pin           ?? '',
    notes:             initial?.notes             ?? '',
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
      </div>
      <div className="flex justify-end gap-3 pt-2">
        <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
        <Button variant="primary" type="submit">{initial ? 'Save Changes' : 'Add Customer'}</Button>
      </div>
    </form>
  );
}

function CustomerDetail({ customer }) {
  if (!customer) return null;
  return (
    <div className="space-y-4">
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
      <div className="grid grid-cols-2 gap-2 text-sm">
        {customer.phone && <div className="flex items-center gap-2 text-gray-600"><Phone className="h-4 w-4" />{customer.phone}</div>}
        {customer.email && <div className="flex items-center gap-2 text-gray-600"><Mail  className="h-4 w-4" />{customer.email}</div>}
        {customer.group_name && <div className="flex items-center gap-2 text-gray-600"><Star className="h-4 w-4 text-secondary-500" />{customer.group_name}</div>}
        {customer.id_number && (
          <div className="text-gray-600 text-xs"><span className="text-gray-400">ID: </span>{customer.id_number}</div>
        )}
        {customer.kra_pin && (
          <div className="text-gray-600 text-xs font-mono"><span className="text-gray-400 font-sans">KRA: </span>{customer.kra_pin}</div>
        )}
        {customer.notes && <div className="col-span-full text-gray-500 text-xs">{customer.notes}</div>}
      </div>
      {customer.recent_transactions?.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Recent Purchases</p>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {customer.recent_transactions.map((t) => (
              <div key={t.transaction_number} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-sm">
                <span className="font-mono text-xs text-gray-500">{t.transaction_number}</span>
                <span className="text-gray-400 text-xs">{formatDate(t.transaction_date)}</span>
                <span className="font-semibold text-gray-900">{formatCurrency(t.total_amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function CustomersPage() {
  const qc = useQueryClient();
  const { hasCapability } = usePermission();
  const canCreateCustomers = hasCapability('customers.create');
  const canManageCustomers = hasCapability('customers.manage');
  const [search, setSearch] = useState('');
  const [page, setPage]     = useState(1);
  const [modal, setModal]   = useState(null);
  const [detail, setDetail] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['customers', search, page],
    queryFn: () => api.get('/customers', { params: { search, page, limit: 25 } }).then((r) => r.data.data),
    keepPreviousData: true,
  });

  const { data: groups = [] } = useQuery({
    queryKey: ['customer-groups'],
    queryFn: () => api.get('/customers/groups').then((r) => r.data.data),
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

  const customers = data?.customers ?? [];
  const total     = data?.total     ?? 0;
  const pages     = data?.pages     ?? 1;

  return (
    <div className="space-y-4">
      <div className="flex gap-3 rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Search by name, phone or email…"
            value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none" />
        </div>
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
        {isLoading ? <PageSpinner /> : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Customer</th>
                <th className="hidden sm:table-cell px-4 py-3 text-left font-medium text-gray-600">Contact</th>
                <th className="hidden md:table-cell px-4 py-3 text-left font-medium text-gray-600">Group</th>
                <th className="hidden md:table-cell px-4 py-3 text-right font-medium text-gray-600">Purchases</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Total Spent</th>
                <th className="hidden sm:table-cell px-4 py-3 text-right font-medium text-gray-600">Points</th>
                {canManageCustomers && <th className="px-4 py-3 text-center font-medium text-gray-600">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {customers.map((c) => (
                <tr key={c.customer_id} className="hover:bg-gray-50 active:bg-gray-100 cursor-pointer transition-colors"
                  onClick={() => setDetail(c.customer_id)}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 flex-shrink-0 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-bold text-xs">
                        {c.customer_name[0]}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{c.customer_name}</p>
                        <p className="text-xs text-gray-400">{c.customer_code}</p>
                      </div>
                    </div>
                  </td>
                  <td className="hidden sm:table-cell px-4 py-3 text-gray-500 text-xs">
                    <div>{c.phone ?? '—'}</div>
                    {c.email && <div className="text-gray-400">{c.email}</div>}
                  </td>
                  <td className="hidden md:table-cell px-4 py-3">
                    {c.group_name
                      ? <span className="rounded-full bg-secondary-100 px-2 py-0.5 text-xs font-medium text-secondary-700">{c.group_name}</span>
                      : <span className="text-gray-400 text-xs">—</span>}
                  </td>
                  <td className="hidden md:table-cell px-4 py-3 text-right text-gray-700">{c.purchase_count}</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900">{formatCurrency(c.total_spent)}</td>
                  <td className="hidden sm:table-cell px-4 py-3 text-right">
                    <span className="flex items-center justify-end gap-1 text-secondary-600 font-medium text-xs">
                      <Star className="h-3 w-3" />{c.loyalty_points_balance.toLocaleString()}
                    </span>
                  </td>
                  {canManageCustomers && (
                    <td className="px-4 py-3 text-center">
                      <button onClick={(e) => { e.stopPropagation(); setDetail(c.customer_id); }}
                        className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-100 transition-colors">
                        View
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {customers.length === 0 && (
                <tr><td colSpan={canManageCustomers ? 7 : 6} className="py-12 text-center text-gray-400">No customers found</td></tr>
              )}
            </tbody>
          </table>
          </div>
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
        <CustomerForm initial={modal !== 'create' ? modal : undefined} groups={groups}
          onClose={() => setModal(null)}
          onSave={(d) => modal === 'create' ? createMut.mutate(d) : updateMut.mutate({ id: modal.customer_id, ...d })} />
      </Modal>

      <Modal open={!!detail && !modal} onClose={() => setDetail(null)}
        title={customerDetail?.customer_name ?? 'Customer Details'} size="md"
        footer={canManageCustomers && customerDetail && (
          <div className="flex gap-3">
            <Button variant="secondary" fullWidth onClick={() => setDetail(null)}>Close</Button>
            <Button fullWidth icon={<Edit2 className="h-4 w-4" />}
              onClick={() => { setModal(customerDetail); setDetail(null); }}>
              Edit
            </Button>
          </div>
        )}
      >
        <CustomerDetail customer={customerDetail} />
      </Modal>
    </div>
  );
}
