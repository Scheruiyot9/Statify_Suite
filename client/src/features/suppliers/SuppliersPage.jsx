import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Truck, Plus, Search, Trash2, Phone, Mail, RefreshCw } from 'lucide-react';
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

// ── Supplier Modal ────────────────────────────────────────────────────────────

function SupplierModal({ supplier, accounts, onClose }) {
  const qc = useQueryClient();
  const isEdit = !!supplier;

  const [form, setForm] = useState({
    supplier_name:  supplier?.supplier_name  ?? '',
    contact_person: supplier?.contact_person ?? '',
    email:          supplier?.email          ?? '',
    phone:          supplier?.phone          ?? '',
    address:        supplier?.address        ?? '',
    tax_pin:        supplier?.tax_pin        ?? '',
    payment_terms:  supplier?.payment_terms  ?? 30,
    credit_limit:   supplier?.credit_limit   ?? '',
    account_id:     supplier?.account_id     ?? '',
    currency:       supplier?.currency       ?? 'KES',
    notes:          supplier?.notes          ?? '',
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const { mutate, isPending } = useMutation({
    mutationFn: (data) => isEdit
      ? api.patch(`/suppliers/${supplier.supplier_id}`, data)
      : api.post('/suppliers', data),
    onSuccess: () => {
      toast.success(isEdit ? 'Supplier updated' : 'Supplier added');
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Save failed'),
  });

  const handleSave = () => {
    if (!form.supplier_name) { toast.error('Supplier name is required'); return; }
    mutate({ ...form, account_id: form.account_id || null, credit_limit: form.credit_limit || null });
  };

  const liabilityAccounts = accounts.filter((a) => a.account_type === 'liability' && a.is_active);

  return (
    <Modal open onClose={onClose} title={isEdit ? 'Edit Supplier' : 'Add Supplier'} size="lg"
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button>
          <Button fullWidth loading={isPending} onClick={handleSave}>
            {isEdit ? 'Save Changes' : 'Add Supplier'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Supplier Info</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="col-span-full">
              <Field label="Supplier Name *">
                <input value={form.supplier_name} onChange={(e) => set('supplier_name', e.target.value)}
                  placeholder="e.g. Nairobi Wholesale Ltd" className={inp} />
              </Field>
            </div>
            <Field label="Contact Person">
              <input value={form.contact_person} onChange={(e) => set('contact_person', e.target.value)}
                placeholder="Full name" className={inp} />
            </Field>
            <Field label="KRA PIN / Tax ID">
              <input value={form.tax_pin} onChange={(e) => set('tax_pin', e.target.value)}
                placeholder="P051234567A" className={inp} />
            </Field>
            <Field label="Phone">
              <input value={form.phone} onChange={(e) => set('phone', e.target.value)}
                placeholder="+254 7xx xxx xxx" className={inp} />
            </Field>
            <Field label="Email">
              <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)}
                placeholder="supplier@example.com" className={inp} />
            </Field>
            <div className="col-span-full">
              <Field label="Address">
                <textarea rows={2} value={form.address} onChange={(e) => set('address', e.target.value)}
                  placeholder="Physical or mailing address" className={inp + ' resize-none'} />
              </Field>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-100 pt-3">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Payment Terms</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Payment Terms (days)" hint="Days before payment is due">
              <input type="number" min={0} value={form.payment_terms}
                onChange={(e) => set('payment_terms', e.target.value)} className={inp} />
            </Field>
            <Field label="Credit Limit">
              <input type="number" min={0} value={form.credit_limit}
                onChange={(e) => set('credit_limit', e.target.value)}
                placeholder="Unlimited" className={inp} />
            </Field>
            <Field label="Currency">
              <select value={form.currency} onChange={(e) => set('currency', e.target.value)} className={sel}>
                <option value="KES">KES</option>
                <option value="USD">USD</option>
                <option value="UGX">UGX</option>
              </select>
            </Field>
            <div className="col-span-full">
              <Field label="Accounts Payable Account" hint="CoA liability account for this supplier's payables">
                <select value={form.account_id} onChange={(e) => set('account_id', e.target.value)} className={sel}>
                  <option value="">Not linked</option>
                  {liabilityAccounts.map((a) => (
                    <option key={a.account_id} value={a.account_id}>{a.account_code} — {a.account_name}</option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
        </div>

        <Field label="Notes">
          <textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)}
            className={inp + ' resize-none'} />
        </Field>
      </div>
    </Modal>
  );
}

// ── Supplier Detail Modal ─────────────────────────────────────────────────────

function SupplierDetail({ supplier, onEdit, onDelete, onClose }) {
  return (
    <Modal open onClose={onClose} title="Supplier Details" size="lg"
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" fullWidth onClick={onClose}>Close</Button>
          {onDelete && (
            <Button variant="secondary" icon={<Trash2 className="h-4 w-4 text-red-500" />} onClick={onDelete}>
              Deactivate
            </Button>
          )}
          <Button fullWidth onClick={onEdit}>Edit</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-xl bg-gray-50 p-4">
          <div>
            <p className="font-bold text-gray-900">{supplier.supplier_name}</p>
            {supplier.contact_person && <p className="text-sm text-gray-500 mt-0.5">{supplier.contact_person}</p>}
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500">Outstanding Balance</p>
            <p className={`text-xl font-bold ${parseFloat(supplier.current_balance) > 0 ? 'text-red-600' : 'text-gray-900'}`}>
              {formatCurrency(supplier.current_balance)}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          {supplier.phone && (
            <div className="flex items-center gap-2 text-gray-600">
              <Phone className="h-4 w-4 text-gray-400" />{supplier.phone}
            </div>
          )}
          {supplier.email && (
            <div className="flex items-center gap-2 text-gray-600">
              <Mail className="h-4 w-4 text-gray-400" />{supplier.email}
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-gray-50 px-3 py-2.5">
            <p className="text-xs text-gray-500">Payment Terms</p>
            <p className="font-semibold text-gray-900 mt-0.5">{supplier.payment_terms} days</p>
          </div>
          {supplier.credit_limit && (
            <div className="rounded-lg bg-gray-50 px-3 py-2.5">
              <p className="text-xs text-gray-500">Credit Limit</p>
              <p className="font-semibold text-gray-900 mt-0.5">{formatCurrency(supplier.credit_limit)}</p>
            </div>
          )}
          <div className="rounded-lg bg-gray-50 px-3 py-2.5">
            <p className="text-xs text-gray-500">Currency</p>
            <p className="font-semibold text-gray-900 mt-0.5">{supplier.currency}</p>
          </div>
        </div>

        {(supplier.address || supplier.tax_pin || supplier.notes) && (
          <div className="space-y-2 text-sm text-gray-600">
            {supplier.tax_pin   && <p><span className="text-gray-400">KRA PIN: </span>{supplier.tax_pin}</p>}
            {supplier.address   && <p><span className="text-gray-400">Address: </span>{supplier.address}</p>}
            {supplier.notes     && <p><span className="text-gray-400">Notes: </span>{supplier.notes}</p>}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SuppliersPage() {
  const qc       = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch]         = useState('');
  const [submitted, setSubmitted]   = useState('');
  const [page, setPage]             = useState(1);
  const [editTarget, setEditTarget] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const filters = { search: submitted, page, limit: 25 };

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['suppliers', filters],
    queryFn: () => api.get('/suppliers', { params: filters }).then((r) => r.data.data),
    placeholderData: (prev) => prev,
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get('/accounts').then((r) => r.data.data),
  });

  const deleteMut = useMutation({
    mutationFn: (id) => api.delete(`/suppliers/${id}`),
    onSuccess: () => {
      toast.success('Supplier deactivated');
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      setDeleteTarget(null);
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Delete failed'),
  });

  const suppliers = data?.suppliers ?? [];
  const total     = data?.total     ?? 0;
  const pages     = data?.pages     ?? 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setSubmitted(search)}
            placeholder="Search suppliers…"
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none" />
        </div>
        <Button variant="secondary" size="sm" onClick={() => { setSubmitted(search); setPage(1); }}>Search</Button>
        {submitted && (
          <Button variant="secondary" size="sm" onClick={() => { setSearch(''); setSubmitted(''); setPage(1); }}>Clear</Button>
        )}
        <Button variant="secondary" size="sm"
          icon={<RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />}
          onClick={() => refetch()}>
          Refresh
        </Button>
        <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>
          Add Supplier
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        {isLoading ? <PageSpinner /> : suppliers.length === 0 ? (
          <p className="py-14 text-center text-gray-400">
            <Truck className="mx-auto mb-2 h-8 w-8 opacity-25" />No suppliers found
          </p>
        ) : (
          <>
          {/* Desktop table — every column always visible */}
          <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Supplier</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Contact</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Phone / Email</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Payment Terms</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Balance</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500" colSpan={2}>Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {suppliers.map((s) => (
                <tr key={s.supplier_id} className={`hover:bg-gray-50 active:bg-gray-100 transition-colors ${!s.is_active ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{s.supplier_name}</p>
                    {s.tax_pin && <p className="text-xs text-gray-400">PIN: {s.tax_pin}</p>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{s.contact_person || '—'}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {s.phone && <p>{s.phone}</p>}
                    {s.email && <p className="text-gray-400">{s.email}</p>}
                    {!s.phone && !s.email && '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{s.payment_terms} days</td>
                  <td className="px-4 py-3">
                    <span className={`font-semibold ${parseFloat(s.current_balance) > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                      {formatCurrency(s.current_balance)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => setEditTarget(s)}
                      className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
                      Edit
                    </button>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => navigate(`/app/suppliers/${s.supplier_id}/ledger`)}
                      className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
                      Entries
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden space-y-2 p-3">
            {suppliers.map((s) => (
              <div key={s.supplier_id}
                className={`rounded-xl border border-gray-100 bg-white p-3 transition-colors ${!s.is_active ? 'opacity-50' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 truncate">{s.supplier_name}</p>
                    {s.tax_pin && <p className="text-xs text-gray-400">PIN: {s.tax_pin}</p>}
                  </div>
                  <span className={`shrink-0 text-sm font-semibold ${parseFloat(s.current_balance) > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                    {formatCurrency(s.current_balance)}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500">
                  {s.contact_person && <span>{s.contact_person}</span>}
                  {s.phone && <span>{s.phone}</span>}
                  {s.email && <span className="text-gray-400">{s.email}</span>}
                  <span>{s.payment_terms} days</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <button onClick={() => setEditTarget(s)}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
                    Edit
                  </button>
                  <button onClick={() => navigate(`/app/suppliers/${s.supplier_id}/ledger`)}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
                    Entries
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
                className="rounded-md border border-gray-200 px-3 py-1 text-xs disabled:opacity-40 hover:bg-gray-50">← Prev</button>
              <button disabled={page >= pages} onClick={() => setPage(page + 1)}
                className="rounded-md border border-gray-200 px-3 py-1 text-xs disabled:opacity-40 hover:bg-gray-50">Next →</button>
            </div>
          </div>
        )}
      </div>

      {createOpen && (
        <SupplierModal accounts={accounts} onClose={() => setCreateOpen(false)} />
      )}
      {editTarget && (
        <SupplierModal supplier={editTarget} accounts={accounts} onClose={() => setEditTarget(null)} />
      )}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Deactivate Supplier" size="sm"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" fullWidth onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button fullWidth loading={deleteMut.isPending}
              onClick={() => deleteMut.mutate(deleteTarget?.supplier_id)}
              className="!bg-red-600 hover:!bg-red-700">
              Deactivate
            </Button>
          </div>
        }
      >
        <p className="text-sm text-gray-600">Deactivate <strong>{deleteTarget?.supplier_name}</strong>? Historical purchase records are preserved.</p>
      </Modal>
    </div>
  );
}
