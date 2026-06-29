import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Building2, Users, GitBranch, Plus, Search,
  CheckCircle, Clock, AlertTriangle, XCircle, CreditCard,
  Monitor, ShoppingCart, Package, BarChart2, UserCheck,
  Layers, ArrowRight, Pencil, Trash2, DollarSign,
  Power, Truck, BookOpen, Landmark, ScrollText, Smartphone, Settings, FileText,
  CalendarRange, Copy, KeyRound, CheckCircle2, Ban, ThumbsUp,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/services/api';
import { useAuthStore } from '@/app/store';
import { formatDate, formatCurrency, todayLocal } from '@/utils/formatters';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import ImageUpload from '@/components/ui/ImageUpload';
import { PageSpinner } from '@/components/ui/Spinner';

// ── Shared helpers ────────────────────────────────────────────────────────────

/** Pass explicit company context for super-admin → tenant-scoped calls */
const withCo = (id) => (id ? { headers: { 'X-Company-ID': id } } : {});

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none';
const sel = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none bg-white';

function Field({ label, required, hint, children }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-600">
        {label}{required && ' *'}
      </label>
      {children}
      {hint && <p className="mt-0.5 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

const STATUS_STYLE = {
  trial: 'bg-blue-100 text-blue-700', active: 'bg-green-100 text-green-700',
  suspended: 'bg-amber-100 text-amber-700', cancelled: 'bg-gray-100 text-gray-500',
  open: 'bg-green-100 text-green-700', closed: 'bg-gray-100 text-gray-500',
  void: 'bg-red-100 text-red-600',
};
const STATUS_ICON = {
  trial: <Clock className="h-3 w-3" />, active: <CheckCircle className="h-3 w-3" />,
  suspended: <AlertTriangle className="h-3 w-3" />, cancelled: <XCircle className="h-3 w-3" />,
  open: <CheckCircle className="h-3 w-3" />, closed: <XCircle className="h-3 w-3" />,
  void: <XCircle className="h-3 w-3" />,
};

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {STATUS_ICON[status]}{status}
    </span>
  );
}

function Pagination({ page, pages, total, onPage }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
      <p className="text-xs text-gray-500">Page {page} of {pages} ({total} total)</p>
      <div className="flex gap-1">
        <button disabled={page <= 1} onClick={() => onPage(page - 1)}
          className="rounded-md border border-gray-200 px-3 py-1 text-xs disabled:opacity-40 hover:bg-gray-50">Prev</button>
        <button disabled={page >= pages} onClick={() => onPage(page + 1)}
          className="rounded-md border border-gray-200 px-3 py-1 text-xs disabled:opacity-40 hover:bg-gray-50">Next</button>
      </div>
    </div>
  );
}

function CompanyFilter({ companies, value, onChange }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none min-w-44 bg-white">
      <option value="">All Companies</option>
      {companies.map((c) => <option key={c.company_id} value={c.company_id}>{c.company_name}</option>)}
    </select>
  );
}

function RowActions({ onEdit, onDelete, deleting }) {
  return (
    <div className="flex items-center gap-1 justify-end">
      {onEdit && (
        <button onClick={onEdit}
          className="rounded-md p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors" title="Edit">
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
      {onDelete && (
        <button onClick={onDelete} disabled={deleting}
          className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors disabled:opacity-40" title="Delete">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

// ── Create Company Modal ──────────────────────────────────────────────────────

function CreateCompanyModal({ plans, onClose }) {
  const qc = useQueryClient();
  const [form, setFormState] = useState({
    company_name: '', domain: '', timezone: 'Africa/Nairobi', currency: 'KES',
    subscription_plan_id: '', branch_name: 'Main Branch',
    admin_first_name: '', admin_last_name: '', admin_email: '', admin_password: 'Admin@123',
    logo_url: null,
  });
  const set = (k, v) => setFormState((f) => ({ ...f, [k]: v }));

  const { mutate, isPending } = useMutation({
    mutationFn: (data) => api.post('/companies', data),
    onSuccess: (res) => {
      const { company, admin_user } = res.data.data;
      toast.success(`${company.company_name} created! Admin: ${admin_user.email}`);
      qc.invalidateQueries({ queryKey: ['admin-companies'] });
      qc.invalidateQueries({ queryKey: ['platform-stats'] });
      qc.invalidateQueries({ queryKey: ['platform-companies-list'] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Create failed'),
  });

  const handleSubmit = () => {
    if (!form.company_name) { toast.error('Company name is required'); return; }
    if (!form.admin_email)  { toast.error('Admin email is required');  return; }
    const payload = { ...form };
    if (!payload.subscription_plan_id) delete payload.subscription_plan_id;
    mutate(payload);
  };

  return (
    <Modal open onClose={onClose} title="Onboard New Company" size="lg"
      footer={<div className="flex gap-3"><Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button><Button fullWidth loading={isPending} onClick={handleSubmit}>Create Company</Button></div>}
    >
      <div className="space-y-5">
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Company Details</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="col-span-full flex items-start gap-4">
              <ImageUpload value={form.logo_url} onChange={(v) => set('logo_url', v)} label="Company Logo" size="md" />
              <div className="flex-1"><Field label="Company Name" required><input value={form.company_name} onChange={(e) => set('company_name', e.target.value)} className={inp} /></Field></div>
            </div>
            <Field label="Domain"><input value={form.domain} onChange={(e) => set('domain', e.target.value)} placeholder="company.example.com" className={inp} /></Field>
            <Field label="Subscription Plan">
              <select value={form.subscription_plan_id} onChange={(e) => set('subscription_plan_id', e.target.value)} className={sel}>
                <option value="">No plan (trial)</option>
                {plans.map((p) => <option key={p.plan_id} value={p.plan_id}>{p.plan_name} — {formatCurrency(p.price)}/mo</option>)}
              </select>
              {form.subscription_plan_id && (() => {
                const p = plans.find((x) => x.plan_id === form.subscription_plan_id);
                return p ? (
                  <div className="mt-1.5 flex gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${p.has_finance ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
                      {p.has_finance ? '✓ Finance' : '✗ Finance'}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${p.has_api_access ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
                      {p.has_api_access ? '✓ API / M-Pesa' : '✗ API / M-Pesa'}
                    </span>
                  </div>
                ) : null;
              })()}
            </Field>
            <Field label="Currency">
              <select value={form.currency} onChange={(e) => set('currency', e.target.value)} className={sel}>
                <option value="KES">KES — Kenyan Shilling</option>
                <option value="USD">USD — US Dollar</option>
                <option value="UGX">UGX — Ugandan Shilling</option>
                <option value="TZS">TZS — Tanzanian Shilling</option>
              </select>
            </Field>
            <Field label="HQ Branch Name"><input value={form.branch_name} onChange={(e) => set('branch_name', e.target.value)} className={inp} /></Field>
          </div>
        </div>
        <div className="border-t border-gray-100" />
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Admin User</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="First Name"><input value={form.admin_first_name} onChange={(e) => set('admin_first_name', e.target.value)} className={inp} /></Field>
            <Field label="Last Name"><input value={form.admin_last_name} onChange={(e) => set('admin_last_name', e.target.value)} className={inp} /></Field>
            <div className="col-span-full"><Field label="Admin Email" required><input type="email" value={form.admin_email} onChange={(e) => set('admin_email', e.target.value)} className={inp} /></Field></div>
            <div className="col-span-full">
              <Field label="Temporary Password" hint="Default: Admin@123 — user must change on first login">
                <input type="password" value={form.admin_password} onChange={(e) => set('admin_password', e.target.value)} className={inp} />
              </Field>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── Company Edit Modal ─────────────────────────────────────────────────────────

function CompanyEditModal({ company, plans, onClose }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const setActiveCompany = useAuthStore((s) => s.setActiveCompany);

  const [form, setFormState] = useState({
    company_name: company.company_name ?? '',
    domain: company.domain ?? '',
    timezone: company.timezone ?? 'Africa/Nairobi',
    currency: company.currency ?? 'KES',
    subscription_plan_id: company.subscription_plan_id ?? '',
    logo_url: company.logo_url ?? null,
  });
  const [status, setStatus] = useState(company.subscription_status);
  const [mpesaConfigOpen, setMpesaConfigOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const set = (k, v) => setFormState((f) => ({ ...f, [k]: v }));

  const { data: mpesaData, isLoading: mpesaLoading } = useQuery({
    queryKey: ['platform-mpesa-configs', { companyId: company.company_id }],
    queryFn: () => api.get('/platform/mpesa-configs', { params: { companyId: company.company_id, limit: 10 } }).then((r) => r.data.data),
  });
  const mpesaConfigs = mpesaData?.configs ?? [];

  const { data: subData, isLoading: subLoading } = useQuery({
    queryKey: ['company-subscriptions', company.company_id],
    queryFn: () => api.get('/platform/subscriptions', { params: { companyId: company.company_id, limit: 10 } }).then((r) => r.data.data),
  });
  const subscriptions = subData?.subscriptions ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-companies'] });
    qc.invalidateQueries({ queryKey: ['platform-stats'] });
    qc.invalidateQueries({ queryKey: ['platform-companies-list'] });
    qc.invalidateQueries({ queryKey: ['my-company'] });
  };

  const updateMut = useMutation({
    mutationFn: (data) => api.patch(`/companies/${company.company_id}`, data),
    onSuccess: () => { toast.success('Company updated'); invalidate(); onClose(); },
    onError: (err) => toast.error(err.response?.data?.message || 'Update failed'),
  });

  const statusMut = useMutation({
    mutationFn: (s) => api.patch(`/companies/${company.company_id}/status`, { status: s }),
    onSuccess: () => { toast.success('Status updated'); invalidate(); },
    onError: (err) => toast.error(err.response?.data?.message || 'Update failed'),
  });

  const toggleMpesaMut = useMutation({
    mutationFn: (id) => api.patch(`/platform/mpesa-configs/${id}/toggle`),
    onSuccess: () => { toast.success('Status updated'); qc.invalidateQueries({ queryKey: ['platform-mpesa-configs'] }); },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed'),
  });

  const handleSave = () => {
    if (!form.company_name) { toast.error('Company name is required'); return; }
    updateMut.mutate({ ...form, subscription_plan_id: form.subscription_plan_id || null });
  };

  const handleManage = () => {
    setActiveCompany(company.company_id, company.company_name);
    toast.success(`Now managing: ${company.company_name}`);
    navigate('/app/dashboard');
    onClose();
  };

  const currentPlan    = plans.find((p) => p.plan_id === (form.subscription_plan_id || company.subscription_plan_id));
  const planHasFinance = currentPlan?.has_finance    ?? false;
  const planHasApi     = currentPlan?.has_api_access ?? false;

  return (
    <>
      <Modal open onClose={onClose} title={`Edit — ${company.company_name}`} size="lg"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button>
            <Button variant="outline" fullWidth icon={<ArrowRight className="h-4 w-4" />} onClick={handleManage}>Manage</Button>
            <Button fullWidth loading={updateMut.isPending} onClick={handleSave}>Save Changes</Button>
          </div>
        }
      >
        <div className="space-y-5">
          {/* Company identity */}
          <div className="flex items-start gap-4">
            <ImageUpload value={form.logo_url} onChange={(v) => set('logo_url', v)} label="Logo" size="md" />
            <div className="flex-1"><Field label="Company Name" required><input value={form.company_name} onChange={(e) => set('company_name', e.target.value)} className={inp} /></Field></div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Domain / Website"><input value={form.domain} onChange={(e) => set('domain', e.target.value)} placeholder="company.example.com" className={inp} /></Field>
            <Field label="Subscription Plan">
              <select value={form.subscription_plan_id} onChange={(e) => set('subscription_plan_id', e.target.value)} className={sel}>
                <option value="">No plan (trial)</option>
                {plans.map((p) => <option key={p.plan_id} value={p.plan_id}>{p.plan_name} — {formatCurrency(p.price)}/mo</option>)}
              </select>
              {form.subscription_plan_id && (
                <div className="mt-1.5 flex gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${planHasFinance ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
                    {planHasFinance ? '✓ Finance' : '✗ Finance'}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${planHasApi ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
                    {planHasApi ? '✓ API / M-Pesa' : '✗ API / M-Pesa'}
                  </span>
                </div>
              )}
            </Field>
            <Field label="Currency">
              <select value={form.currency} onChange={(e) => set('currency', e.target.value)} className={sel}>
                <option value="KES">KES — Kenyan Shilling</option>
                <option value="USD">USD — US Dollar</option>
                <option value="UGX">UGX — Ugandan Shilling</option>
                <option value="TZS">TZS — Tanzanian Shilling</option>
              </select>
            </Field>
            <Field label="Timezone">
              <select value={form.timezone} onChange={(e) => set('timezone', e.target.value)} className={sel}>
                <option value="Africa/Nairobi">Africa/Nairobi (EAT)</option>
                <option value="Africa/Kampala">Africa/Kampala (EAT)</option>
                <option value="Africa/Dar_es_Salaam">Africa/Dar_es_Salaam (EAT)</option>
                <option value="Africa/Lagos">Africa/Lagos (WAT)</option>
                <option value="UTC">UTC</option>
              </select>
            </Field>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-5 gap-3">
            <div className="rounded-xl bg-gray-50 p-3 text-center">
              <p className="text-xs text-gray-500">Branches</p>
              <p className="text-lg font-bold text-gray-800">{company.branch_count}{company.max_branches ? <span className="text-xs text-gray-400 font-normal"> /{company.max_branches}</span> : ''}</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-3 text-center">
              <p className="text-xs text-gray-500">Users</p>
              <p className="text-lg font-bold text-gray-800">{company.user_count}{company.max_users ? <span className="text-xs text-gray-400 font-normal"> /{company.max_users}</span> : ''}</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-3 text-center">
              <p className="text-xs text-gray-500">Finance</p>
              <p className="text-sm font-semibold mt-1">{planHasFinance ? <span className="text-green-600">Enabled</span> : <span className="text-gray-400">Disabled</span>}</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-3 text-center">
              <p className="text-xs text-gray-500">API / M-Pesa</p>
              <p className="text-sm font-semibold mt-1">{planHasApi ? <span className="text-green-600">Enabled</span> : <span className="text-gray-400">Disabled</span>}</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-3 text-center">
              <p className="text-xs text-gray-500">Created</p>
              <p className="text-xs font-semibold text-gray-700 mt-1">{formatDate(company.created_at)}</p>
            </div>
          </div>

          {/* Subscription Status */}
          <div className="rounded-xl border border-gray-100 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Subscription Status</p>
            <div className="flex items-center gap-3">
              <StatusBadge status={status} />
              <select value={status} onChange={(e) => setStatus(e.target.value)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-primary-500 focus:outline-none bg-white">
                {['trial','active','suspended','cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {status !== company.subscription_status && (
                <Button size="xs" loading={statusMut.isPending} onClick={() => statusMut.mutate(status)}>Apply Status</Button>
              )}
            </div>
          </div>

          {/* Subscriptions */}
          <div className="rounded-xl border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Subscriptions</p>
              <Button size="xs" icon={<CalendarRange className="h-3 w-3" />} onClick={() => setSubOpen(true)}>Record New</Button>
            </div>
            {subLoading ? (
              <div className="space-y-2">{[1,2].map((i) => <div key={i} className="h-8 animate-pulse rounded-lg bg-gray-100" />)}</div>
            ) : subscriptions.length === 0 ? (
              <p className="text-xs text-gray-400 py-2">No subscription history yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="pb-1.5 text-left font-medium text-gray-500">Plan</th>
                      <th className="pb-1.5 text-left font-medium text-gray-500">Period</th>
                      <th className="pb-1.5 text-left font-medium text-gray-500">Start</th>
                      <th className="pb-1.5 text-left font-medium text-gray-500">End</th>
                      <th className="pb-1.5 text-right font-medium text-gray-500">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {subscriptions.map((s) => {
                      const expired = s.end_date && new Date(s.end_date) < new Date();
                      const expiringSoon = !expired && s.end_date && (new Date(s.end_date) - new Date()) < 30 * 86400000;
                      return (
                        <tr key={s.subscription_id} className="hover:bg-gray-50">
                          <td className="py-1.5 font-medium text-gray-800">{s.plan_name}</td>
                          <td className="py-1.5 text-gray-500 capitalize">{s.period?.replace('_', '-') || '—'}</td>
                          <td className="py-1.5 text-gray-600">{s.start_date ? String(s.start_date).slice(0,10) : '—'}</td>
                          <td className={`py-1.5 font-medium ${expired ? 'text-red-600' : expiringSoon ? 'text-amber-600' : 'text-gray-600'}`}>
                            {s.end_date ? String(s.end_date).slice(0,10) : '—'}
                            {expired && <span className="ml-1 text-red-400">(expired)</span>}
                            {expiringSoon && <span className="ml-1 text-amber-400">(soon)</span>}
                          </td>
                          <td className="py-1.5 text-right font-mono text-gray-700">
                            {s.amount_paid != null ? formatCurrency(s.amount_paid) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* M-Pesa Configurations */}
          <div className="rounded-xl border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">M-Pesa Configurations</p>
              {planHasApi
                ? <Button size="xs" icon={<Plus className="h-3 w-3" />} onClick={() => setMpesaConfigOpen(true)}>Add Config</Button>
                : <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">API not included in plan</span>
              }
            </div>
            {!planHasApi ? (
              <p className="text-xs text-amber-600 py-1">Upgrade to Enterprise to enable M-Pesa / API access for this company.</p>
            ) : mpesaLoading ? (
              <div className="space-y-2">
                {[1, 2].map((i) => <div key={i} className="h-8 animate-pulse rounded-lg bg-gray-100" />)}
              </div>
            ) : mpesaConfigs.length === 0 ? (
              <p className="text-xs text-gray-400 py-2">No M-Pesa configuration set up yet. Click Add Config to get started.</p>
            ) : (
              <div className="space-y-1.5">
                {mpesaConfigs.map((cfg) => (
                  <div key={cfg.config_id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
                    <div className="flex items-center gap-2 text-xs">
                      <Smartphone className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                      <span className="font-mono text-gray-800 font-medium">{cfg.shortcode}</span>
                      <span className="text-gray-500 capitalize">{cfg.shortcode_type}</span>
                      <span className={`rounded-full px-1.5 py-0.5 font-medium capitalize ${cfg.environment === 'production' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {cfg.environment}
                      </span>
                      {cfg.branch_name && <span className="text-gray-400">· {cfg.branch_name}</span>}
                      {!cfg.branch_name && <span className="text-gray-400 italic">Company-wide</span>}
                    </div>
                    <button
                      onClick={() => toggleMpesaMut.mutate(cfg.config_id)}
                      className={`text-xs font-medium px-2 py-0.5 rounded-full transition-colors ${cfg.is_active ? 'text-green-600 bg-green-50 hover:bg-red-50 hover:text-red-600' : 'text-gray-400 bg-gray-100 hover:bg-green-50 hover:text-green-600'}`}
                    >
                      {cfg.is_active ? 'Active' : 'Inactive'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>
      {mpesaConfigOpen && (
        <MpesaConfigModal
          companyId={company.company_id}
          onClose={() => { setMpesaConfigOpen(false); qc.invalidateQueries({ queryKey: ['platform-mpesa-configs'] }); }}
        />
      )}
      {subOpen && (
        <RecordSubscriptionModal
          companyId={company.company_id}
          plans={plans}
          onClose={() => setSubOpen(false)}
        />
      )}
    </>
  );
}

// ── Record Subscription Modal ─────────────────────────────────────────────────

const PERIODS = [
  { value: 'monthly',    label: 'Monthly',     months: 1  },
  { value: 'quarterly',  label: 'Quarterly',   months: 3  },
  { value: 'semi_annual',label: 'Semi-Annual', months: 6  },
  { value: 'annual',     label: 'Annual',      months: 12 },
  { value: 'biennial',   label: 'Biennial',    months: 24 },
  { value: 'custom',     label: 'Custom',      months: null },
];

function addMonths(dateStr, months) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function computeAmount(plan, period) {
  if (!plan) return '';
  const p = PERIODS.find((p) => p.value === period);
  if (!p || !p.months) return '';
  if (period === 'annual' && plan.annual_price) return parseFloat(plan.annual_price).toFixed(2);
  if (period === 'biennial' && plan.annual_price) return (parseFloat(plan.annual_price) * 2).toFixed(2);
  return (parseFloat(plan.price) * p.months).toFixed(2);
}

function RecordSubscriptionModal({ companyId: initialCompanyId, companies = [], plans, onClose }) {
  const qc  = useQueryClient();
  const today = todayLocal();

  const [selectedCompanyId, setSelectedCompanyId] = useState(initialCompanyId ?? '');
  const companyId = selectedCompanyId;

  const [form, setFormState] = useState({
    planId:      plans.find((p) => p.is_active)?.plan_id ?? '',
    period:      'annual',
    startDate:   today,
    endDate:     addMonths(today, 12),
    amountPaid:  '',
    notes:       '',
  });
  const set = (k, v) => setFormState((f) => ({ ...f, [k]: v }));

  const selectedPlan = plans.find((p) => p.plan_id === form.planId);

  // When plan or period changes, recompute end date + amount
  const handlePlanChange = (planId) => {
    const plan = plans.find((p) => p.plan_id === planId);
    const p    = PERIODS.find((p) => p.value === form.period);
    setFormState((f) => ({
      ...f,
      planId,
      amountPaid: computeAmount(plan, f.period),
      endDate: p?.months ? addMonths(f.startDate, p.months) : f.endDate,
    }));
  };

  const handlePeriodChange = (period) => {
    const p = PERIODS.find((x) => x.value === period);
    setFormState((f) => ({
      ...f,
      period,
      endDate:    p?.months ? addMonths(f.startDate, p.months) : f.endDate,
      amountPaid: computeAmount(selectedPlan, period),
    }));
  };

  const handleStartChange = (startDate) => {
    const p = PERIODS.find((x) => x.value === form.period);
    setFormState((f) => ({
      ...f,
      startDate,
      endDate: p?.months ? addMonths(startDate, p.months) : f.endDate,
    }));
  };

  const { mutate, isPending } = useMutation({
    mutationFn: (data) => api.post('/platform/subscriptions', { companyId, ...data }),
    onSuccess: () => {
      toast.success('Subscription recorded');
      qc.invalidateQueries({ queryKey: ['company-subscriptions', companyId] });
      qc.invalidateQueries({ queryKey: ['platform-subscriptions'] });
      qc.invalidateQueries({ queryKey: ['admin-companies'] });
      qc.invalidateQueries({ queryKey: ['platform-stats'] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to record subscription'),
  });

  const handleSubmit = () => {
    if (!companyId)      { toast.error('Select a company');       return; }
    if (!form.planId)    { toast.error('Select a plan');          return; }
    if (!form.startDate) { toast.error('Start date is required'); return; }
    if (!form.endDate)   { toast.error('End date is required');   return; }
    if (form.endDate <= form.startDate) { toast.error('End date must be after start date'); return; }
    mutate({ ...form, amountPaid: form.amountPaid !== '' ? parseFloat(form.amountPaid) : null });
  };

  const suggestedAmount = computeAmount(selectedPlan, form.period);

  return (
    <Modal open onClose={onClose} title="Record Subscription" size="sm"
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button>
          <Button fullWidth loading={isPending} onClick={handleSubmit}>Record Subscription</Button>
        </div>
      }
    >
      <div className="space-y-3">
        {companies.length > 0 && (
          <Field label="Company" required>
            <select value={selectedCompanyId} onChange={(e) => setSelectedCompanyId(e.target.value)} className={sel}>
              <option value="">Select company…</option>
              {companies.map((c) => <option key={c.company_id} value={c.company_id}>{c.company_name}</option>)}
            </select>
          </Field>
        )}

        <Field label="Plan" required>
          <select value={form.planId} onChange={(e) => handlePlanChange(e.target.value)} className={sel}>
            <option value="">Select plan…</option>
            {plans.filter((p) => p.is_active).map((p) => (
              <option key={p.plan_id} value={p.plan_id}>{p.plan_name}</option>
            ))}
          </select>
        </Field>

        <Field label="Billing Period" required>
          <select value={form.period} onChange={(e) => handlePeriodChange(e.target.value)} className={sel}>
            {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Start Date" required>
            <input type="date" value={form.startDate} max={form.endDate}
              onChange={(e) => handleStartChange(e.target.value)} className={inp} />
          </Field>
          <Field label="End Date" required>
            <input type="date" value={form.endDate} min={form.startDate}
              onChange={(e) => set('endDate', e.target.value)} className={inp} />
          </Field>
        </div>

        <Field label="Amount Payable (KES)" hint={suggestedAmount ? `Suggested: ${Number(suggestedAmount).toLocaleString()}` : undefined}>
          <input type="number" min="0" step="0.01" value={form.amountPaid}
            onChange={(e) => set('amountPaid', e.target.value)}
            placeholder={suggestedAmount || '0.00'} className={inp} />
        </Field>

        <Field label="Notes">
          <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)}
            rows={2} placeholder="e.g. Annual renewal — paid via EFT"
            className={inp + ' resize-none'} />
        </Field>

        <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-xs text-blue-700">
          This will set the company status to <strong>active</strong> and update the active plan and dates.
        </div>
      </div>
    </Modal>
  );
}

// ── Plans Panel ───────────────────────────────────────────────────────────────

function PlanModal({ plan, onClose }) {
  const qc = useQueryClient();
  const isEdit = !!plan;
  const [form, setFormState] = useState({
    plan_name:     plan?.plan_name     ?? '',
    price:         plan?.price         ?? '',
    annual_price:  plan?.annual_price  ?? '',
    max_users:     plan?.max_users     ?? 5,
    max_branches:  plan?.max_branches  ?? 1,
    trial_days:    plan?.trial_days    ?? 14,
    has_finance:   plan?.has_finance   ?? false,
    has_api_access:plan?.has_api_access ?? false,
    sort_order:    plan?.sort_order    ?? 0,
    is_active:     plan?.is_active     ?? true,
  });
  const set = (k, v) => setFormState((f) => ({ ...f, [k]: v }));

  const { mutate, isPending } = useMutation({
    mutationFn: (data) => isEdit
      ? api.patch(`/platform/plans/${plan.plan_id}`, data)
      : api.post('/platform/plans', data),
    onSuccess: () => {
      toast.success(isEdit ? 'Plan updated' : 'Plan created');
      qc.invalidateQueries({ queryKey: ['subscription-plans'] });
      qc.invalidateQueries({ queryKey: ['platform-plans'] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Save failed'),
  });

  const handleSubmit = () => {
    if (!form.plan_name) { toast.error('Plan name is required'); return; }
    if (form.price === '') { toast.error('Price is required'); return; }
    mutate({
      ...form,
      price:        parseFloat(form.price),
      annual_price: form.annual_price !== '' ? parseFloat(form.annual_price) : null,
      max_users:    parseInt(form.max_users),
      max_branches: parseInt(form.max_branches),
      trial_days:   parseInt(form.trial_days),
      sort_order:   parseInt(form.sort_order),
    });
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? `Edit Plan — ${plan.plan_name}` : 'New Subscription Plan'} size="md"
      footer={<div className="flex gap-3"><Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button><Button fullWidth loading={isPending} onClick={handleSubmit}>{isEdit ? 'Save Changes' : 'Create Plan'}</Button></div>}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="col-span-full">
            <Field label="Plan Name" required>
              <input value={form.plan_name} onChange={(e) => set('plan_name', e.target.value)} className={inp} placeholder="e.g. Growth" />
            </Field>
          </div>
          <Field label="Monthly Price (KES)" required>
            <input type="number" value={form.price} onChange={(e) => set('price', e.target.value)} className={inp} placeholder="2999" />
          </Field>
          <Field label="Annual Price (KES)" hint="Leave blank to not offer annual billing">
            <input type="number" value={form.annual_price} onChange={(e) => set('annual_price', e.target.value)} className={inp} placeholder="29990" />
          </Field>
          <Field label="Max Users" hint="-1 = unlimited">
            <input type="number" value={form.max_users} onChange={(e) => set('max_users', e.target.value)} className={inp} />
          </Field>
          <Field label="Max Branches" hint="-1 = unlimited">
            <input type="number" value={form.max_branches} onChange={(e) => set('max_branches', e.target.value)} className={inp} />
          </Field>
          <Field label="Trial Days">
            <input type="number" value={form.trial_days} onChange={(e) => set('trial_days', e.target.value)} className={inp} />
          </Field>
          <Field label="Display Order">
            <input type="number" value={form.sort_order} onChange={(e) => set('sort_order', e.target.value)} className={inp} />
          </Field>
        </div>

        <div className="rounded-xl border border-gray-100 p-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Feature Flags</p>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={form.has_finance} onChange={(e) => set('has_finance', e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
            <div>
              <p className="text-sm font-medium text-gray-800">Finance Module</p>
              <p className="text-xs text-gray-500">Suppliers, Purchase Orders, AP Payments, CoA, Bank Accounts, Aging & Financial Reports</p>
            </div>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={form.has_api_access} onChange={(e) => set('has_api_access', e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
            <div>
              <p className="text-sm font-medium text-gray-800">API Access</p>
              <p className="text-xs text-gray-500">REST API access for integrations and custom development</p>
            </div>
          </label>
        </div>

        {isEdit && (
          <Field label="Status">
            <select value={form.is_active ? 'true' : 'false'} onChange={(e) => set('is_active', e.target.value === 'true')} className={sel}>
              <option value="true">Active</option>
              <option value="false">Inactive (hidden from new signups)</option>
            </select>
          </Field>
        )}
      </div>
    </Modal>
  );
}

function PlansPanel() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [selected,   setSelected]   = useState(null);

  const { data: plans = [], isLoading } = useQuery({
    queryKey: ['platform-plans'],
    queryFn: () => api.get('/platform/plans').then((r) => r.data.data),
  });

  const deactivateMut = useMutation({
    mutationFn: (id) => api.delete(`/platform/plans/${id}`),
    onSuccess: () => { toast.success('Plan deactivated'); qc.invalidateQueries({ queryKey: ['platform-plans'] }); },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed'),
  });

  const FEAT = (val) => val
    ? <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700"><CheckCircle className="h-3 w-3" /> Yes</span>
    : <span className="text-xs text-gray-300">—</span>;

  if (isLoading) return <PageSpinner />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>New Plan</Button>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              {['Plan','Monthly','Annual','Users','Branches','Trial','Finance','API','Order','Status',''].map((h) => (
                <th key={h} className="px-3 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {plans.map((p) => (
              <tr key={p.plan_id} className="hover:bg-gray-50 transition-colors">
                <td className="px-3 py-3 font-semibold text-gray-900">{p.plan_name}</td>
                <td className="px-3 py-3 text-gray-700">{formatCurrency(p.price)}<span className="text-xs text-gray-400">/mo</span></td>
                <td className="px-3 py-3 text-gray-500">{p.annual_price ? formatCurrency(p.annual_price) : <span className="text-gray-300">—</span>}</td>
                <td className="px-3 py-3 text-center text-gray-600">{p.max_users === -1 ? '∞' : p.max_users}</td>
                <td className="px-3 py-3 text-center text-gray-600">{p.max_branches === -1 ? '∞' : p.max_branches}</td>
                <td className="px-3 py-3 text-center text-gray-600">{p.trial_days}d</td>
                <td className="px-3 py-3 text-center">{FEAT(p.has_finance)}</td>
                <td className="px-3 py-3 text-center">{FEAT(p.has_api_access)}</td>
                <td className="px-3 py-3 text-center text-gray-400 text-xs">{p.sort_order}</td>
                <td className="px-3 py-3">
                  <StatusBadge status={p.is_active ? 'active' : 'cancelled'} />
                </td>
                <td className="px-3 py-3">
                  <RowActions
                    onEdit={() => setSelected(p)}
                    onDelete={() => { if (window.confirm(`Deactivate "${p.plan_name}"?`)) deactivateMut.mutate(p.plan_id); }}
                    deleting={deactivateMut.isPending}
                  />
                </td>
              </tr>
            ))}
            {plans.length === 0 && (
              <tr><td colSpan={11} className="py-12 text-center text-gray-400 text-sm">No plans configured</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {createOpen && <PlanModal onClose={() => setCreateOpen(false)} />}
      {selected   && <PlanModal plan={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

// ── Companies Panel ───────────────────────────────────────────────────────────

function CompaniesPanel({ plans }) {
  const qc = useQueryClient();
  const [search, setSearch]           = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage]               = useState(1);
  const [createOpen, setCreateOpen]   = useState(false);
  const [selected, setSelected]       = useState(null);

  const filters = { search, status: statusFilter, page, limit: 20 };
  const { data, isLoading } = useQuery({
    queryKey: ['admin-companies', filters],
    queryFn: () => api.get('/companies', { params: filters }).then((r) => r.data.data),
    placeholderData: (prev) => prev,
  });
  const companies = data?.companies ?? [];
  const total     = data?.total     ?? 0;
  const pages     = data?.pages     ?? 1;

  const deleteMut = useMutation({
    mutationFn: (id) => api.delete(`/companies/${id}`),
    onSuccess: (_, id) => {
      toast.success('Company deleted');
      qc.invalidateQueries({ queryKey: ['admin-companies'] });
      qc.invalidateQueries({ queryKey: ['platform-stats'] });
      qc.invalidateQueries({ queryKey: ['platform-companies-list'] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Delete failed'),
  });

  const handleDelete = (c) => {
    if (!window.confirm(
      `Permanently delete "${c.company_name}"?\n\nThis will remove ALL associated data — branches, users, products, sales, and inventory. This action cannot be undone.`
    )) return;
    deleteMut.mutate(c.company_id);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search company or domain…"
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none" />
        </div>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none bg-white">
          <option value="">All Statuses</option>
          {['trial','active','suspended','cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>New Company</Button>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        {isLoading ? <PageSpinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>{['Company','Plan','Branches','Users','Status','Created',''].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {companies.map((c) => (
                  <tr key={c.company_id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        {c.logo_url
                          ? <img src={c.logo_url} alt={c.company_name} className="h-8 w-8 flex-shrink-0 rounded-lg object-cover border border-gray-100" />
                          : <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-100 text-primary-700 font-bold text-sm flex-shrink-0">{c.company_name[0].toUpperCase()}</div>
                        }
                        <div>
                          <p className="font-medium text-gray-900">{c.company_name}</p>
                          {c.domain && <p className="text-xs text-gray-400">{c.domain}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{c.plan_name ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center gap-1 text-gray-700">
                        <GitBranch className="h-3 w-3 text-gray-400" />{c.branch_count}
                        {c.max_branches && <span className="text-gray-400 text-xs">/{c.max_branches}</span>}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center gap-1 text-gray-700">
                        <Users className="h-3 w-3 text-gray-400" />{c.user_count}
                        {c.max_users && <span className="text-gray-400 text-xs">/{c.max_users}</span>}
                      </span>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={c.subscription_status} /></td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{formatDate(c.created_at)}</td>
                    <td className="px-4 py-3">
                      <RowActions
                        onEdit={() => setSelected(c)}
                        onDelete={() => handleDelete(c)}
                        deleting={deleteMut.isPending}
                      />
                    </td>
                  </tr>
                ))}
                {companies.length === 0 && (
                  <tr><td colSpan={7} className="py-14 text-center text-gray-400">
                    <Building2 className="mx-auto mb-2 h-8 w-8 opacity-25" />No companies found
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pages={pages} total={total} onPage={setPage} />
      </div>

      {createOpen && <CreateCompanyModal plans={plans} onClose={() => setCreateOpen(false)} />}
      {selected   && <CompanyEditModal  company={selected} plans={plans} onClose={() => setSelected(null)} />}
    </div>
  );
}

// ── User Modal (Create / Edit) ────────────────────────────────────────────────

const FINANCE_ROLES = ['accountant'];
const API_ROLES     = ['mpesa_operator']; // future-proof: hide if plan has no API access

function TempPasswordModal({ name, email, password, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(password);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="bg-green-50 border-b border-green-100 px-6 py-4 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-green-100">
            <KeyRound className="h-5 w-5 text-green-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-green-800">User Created</p>
            <p className="text-xs text-green-600">Share this temporary password with the user</p>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <p className="text-xs text-gray-500 mb-0.5">User</p>
            <p className="text-sm font-medium text-gray-800">{name}</p>
            <p className="text-xs text-gray-500">{email}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Temporary Password</p>
            <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
              <code className="flex-1 text-sm font-mono font-semibold tracking-wider text-gray-900 select-all">{password}</code>
              <button onClick={copy} className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800 transition-colors font-medium">
                <Copy className="h-3.5 w-3.5" />
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
          <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
            This password is shown only once. The user should change it immediately after first login.
          </p>
          <button onClick={onClose} className="w-full rounded-lg bg-primary-600 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 transition-colors">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function UserModal({ companyId: initialCompanyId, user, onClose, companies = [] }) {
  const qc     = useQueryClient();
  const isEdit = !!user;

  const [tempPassword, setTempPassword] = useState(null);

  // Super-admin creation mode — no company, no role/branch selection
  const [asSuperAdmin, setAsSuperAdmin] = useState(false);

  const [pickedCompanyId, setPickedCompanyId] = useState(initialCompanyId || user?.company_id || '');
  const effectiveCompanyId = isEdit ? (user?.company_id || initialCompanyId) : (asSuperAdmin ? '' : pickedCompanyId);

  const selectedCompany = companies.find((c) => c.company_id === effectiveCompanyId);
  const hasFinance   = selectedCompany?.has_finance    ?? false;
  const hasApiAccess = selectedCompany?.has_api_access ?? false;

  const [form, setFormState] = useState({
    first_name: user?.first_name ?? '',
    last_name:  user?.last_name  ?? '',
    email:      user?.email      ?? '',
    phone:      user?.phone      ?? '',
    role_id:    user?.role_id    ?? '',
    branch_id:  user?.branch_id  ?? '',
    is_active:  user?.is_active  ?? true,
  });
  const set = (k, v) => setFormState((f) => ({ ...f, [k]: v }));

  // Reset role/branch when company changes or super-admin mode toggled
  useEffect(() => {
    if (!isEdit) setFormState((f) => ({ ...f, role_id: '', branch_id: '' }));
  }, [pickedCompanyId, asSuperAdmin, isEdit]);

  const { data: allRoles = [] } = useQuery({ queryKey: ['co-roles', effectiveCompanyId], queryFn: () => api.get('/users/roles', withCo(effectiveCompanyId)).then((r) => r.data.data), enabled: !!effectiveCompanyId });
  const roles = allRoles.filter((r) => {
    if (!hasFinance   && FINANCE_ROLES.includes(r.role_name)) return false;
    if (!hasApiAccess && API_ROLES.includes(r.role_name))     return false;
    return true;
  });
  const { data: branches = [] } = useQuery({ queryKey: ['co-branches', effectiveCompanyId], queryFn: () => api.get('/branches', withCo(effectiveCompanyId)).then((r) => r.data.data), enabled: !!effectiveCompanyId });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['platform-users'] });
    qc.invalidateQueries({ queryKey: ['platform-stats'] });
  };

  const { mutate, isPending } = useMutation({
    mutationFn: (data) => {
      if (!isEdit && asSuperAdmin) return api.post('/platform/users/super-admin', data);
      if (isEdit) return api.put(`/platform/users/${user.user_id}`, data);
      return api.post('/users', data, withCo(effectiveCompanyId));
    },
    onSuccess: (res) => {
      const u = res.data.data;
      invalidate();
      if (!isEdit && u.temp_password) {
        setTempPassword(u.temp_password);
      } else {
        toast.success(isEdit ? 'User updated' : 'User created');
        onClose();
      }
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Save failed'),
  });

  const handleSubmit = () => {
    if (!form.first_name)                          { toast.error('First name is required'); return; }
    if (!isEdit && !form.email)                    { toast.error('Email is required');      return; }
    if (!isEdit && !asSuperAdmin && !effectiveCompanyId) { toast.error('Select a company first'); return; }
    mutate(form);
  };

  const showCompanyPicker = !isEdit && !initialCompanyId;

  return (<>
    <Modal open onClose={onClose} title={isEdit ? `Edit User — ${user.first_name} ${user.last_name}` : 'Create User'}
      footer={<div className="flex gap-3"><Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button><Button fullWidth loading={isPending} onClick={handleSubmit}>{isEdit ? 'Save Changes' : 'Create User'}</Button></div>}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Super-admin toggle + company selector — only in create flow without pre-selected company */}
        {showCompanyPicker && (
          <div className="col-span-full space-y-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={asSuperAdmin} onChange={(e) => setAsSuperAdmin(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
              <span className="text-sm font-medium text-gray-700">Create as Super Admin (no company)</span>
            </label>
            {!asSuperAdmin && (
              <Field label="Company" required>
                <select value={pickedCompanyId} onChange={(e) => setPickedCompanyId(e.target.value)} className={sel}>
                  <option value="">Select company…</option>
                  {companies.map((c) => <option key={c.company_id} value={c.company_id}>{c.company_name}</option>)}
                </select>
              </Field>
            )}
          </div>
        )}
        <Field label="First Name" required><input value={form.first_name} onChange={(e) => set('first_name', e.target.value)} className={inp} /></Field>
        <Field label="Last Name"><input value={form.last_name} onChange={(e) => set('last_name', e.target.value)} className={inp} /></Field>
        {!isEdit && <div className="col-span-full"><Field label="Email" required><input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} className={inp} /></Field></div>}
        <Field label="Phone"><input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+254…" className={inp} /></Field>
        {!asSuperAdmin && (<>
        <Field label="Role">
          <select value={form.role_id} onChange={(e) => set('role_id', e.target.value)} className={sel} disabled={!effectiveCompanyId}>
            <option value="">No role</option>
            {roles.map((r) => <option key={r.role_id} value={r.role_id}>{r.role_name.replace(/_/g, ' ')}</option>)}
          </select>
        </Field>
        <Field label="Default Branch">
          <select value={form.branch_id} onChange={(e) => set('branch_id', e.target.value)} className={sel} disabled={!effectiveCompanyId}>
            <option value="">No branch</option>
            {branches.map((b) => <option key={b.branch_id} value={b.branch_id}>{b.branch_name}</option>)}
          </select>
        </Field>
        </>)}
        {isEdit && (
          <Field label="Status">
            <select value={form.is_active ? 'true' : 'false'} onChange={(e) => set('is_active', e.target.value === 'true')} className={sel}>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </Field>
        )}
      </div>
      {!isEdit && <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">A secure temporary password will be shown after creation.</p>}
    </Modal>
    {tempPassword && (
      <TempPasswordModal
        name={`${form.first_name} ${form.last_name}`.trim()}
        email={form.email}
        password={tempPassword}
        onClose={() => { setTempPassword(null); onClose(); }}
      />
    )}
  </>);
}

// ── Users Panel ───────────────────────────────────────────────────────────────

function UsersPanel({ companies }) {
  const qc = useQueryClient();
  const [search,    setSearch]      = useState('');
  const [companyId, setCompanyId]   = useState('');
  const [page,      setPage]        = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['platform-users', { search, companyId, page }],
    queryFn: () => api.get('/platform/users', { params: { search, companyId, page, limit: 25 } }).then((r) => r.data.data),
    placeholderData: (prev) => prev,
  });
  const rows  = data?.users ?? [];
  const total = data?.total ?? 0;
  const pages = data?.pages ?? 1;

  const deleteMut = useMutation({
    mutationFn: ({ id, coId }) => api.delete(`/users/${id}`, withCo(coId)),
    onSuccess: () => { toast.success('User deleted'); qc.invalidateQueries({ queryKey: ['platform-users'] }); qc.invalidateQueries({ queryKey: ['platform-stats'] }); },
    onError: (err) => toast.error(err.response?.data?.message || 'Delete failed'),
  });

  const handleDelete = (u) => {
    if (!window.confirm(`Delete user "${u.first_name} ${u.last_name}"? This cannot be undone.`)) return;
    deleteMut.mutate({ id: u.user_id, coId: u.company_id });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search name or email…"
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none" />
        </div>
        <CompanyFilter companies={companies} value={companyId} onChange={(v) => { setCompanyId(v); setPage(1); }} />
        <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>Add User</Button>
      </div>
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        {isLoading ? <PageSpinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>{['Name','Email','Role','Company','Branch','Created',''].map((h) => <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((u) => (
                  <tr key={u.user_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{u.first_name} {u.last_name}</td>
                    <td className="px-4 py-3 text-gray-600">{u.email}</td>
                    <td className="px-4 py-3"><span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs capitalize text-gray-600">{u.role_name?.replace(/_/g, ' ') ?? '—'}</span></td>
                    <td className="px-4 py-3 text-gray-600">{u.company_name}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{u.branch_name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{formatDate(u.created_at)}</td>
                    <td className="px-4 py-3"><RowActions onEdit={() => setEditTarget(u)} onDelete={() => handleDelete(u)} deleting={deleteMut.isPending} /></td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={7} className="py-14 text-center text-gray-400"><Users className="mx-auto mb-2 h-8 w-8 opacity-25" />No users found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pages={pages} total={total} onPage={setPage} />
      </div>
      {createOpen && <UserModal companyId={companyId} companies={companies} onClose={() => setCreateOpen(false)} />}
      {editTarget  && <UserModal companyId={editTarget.company_id} companies={companies} user={editTarget} onClose={() => setEditTarget(null)} />}
    </div>
  );
}

// ── Branch Modal (Create / Edit) ──────────────────────────────────────────────

function BranchModal({ companyId, branch, onClose }) {
  const qc     = useQueryClient();
  const isEdit = !!branch;
  const [form, setFormState] = useState({
    branch_name: branch?.branch_name ?? '',
    branch_code: branch?.branch_code ?? '',
    address:     branch?.address     ?? '',
    phone:       branch?.phone       ?? '',
    is_active:   branch?.is_active   ?? true,
  });
  const set = (k, v) => setFormState((f) => ({ ...f, [k]: v }));

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['platform-branches'] }); qc.invalidateQueries({ queryKey: ['co-branches', companyId] }); qc.invalidateQueries({ queryKey: ['platform-stats'] }); };

  const { mutate, isPending } = useMutation({
    mutationFn: (data) => isEdit ? api.put(`/branches/${branch.branch_id}`, data, withCo(companyId)) : api.post('/branches', data, withCo(companyId)),
    onSuccess: () => { toast.success(isEdit ? 'Branch updated' : 'Branch created'); invalidate(); onClose(); },
    onError: (err) => toast.error(err.response?.data?.message || 'Save failed'),
  });

  const handleSubmit = () => {
    if (!form.branch_name)           { toast.error('Branch name is required'); return; }
    if (!isEdit && !form.branch_code){ toast.error('Branch code is required'); return; }
    mutate(form);
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? `Edit Branch — ${branch.branch_name}` : 'Create Branch'}
      footer={<div className="flex gap-3"><Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button><Button fullWidth loading={isPending} onClick={handleSubmit}>{isEdit ? 'Save Changes' : 'Create Branch'}</Button></div>}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Branch Name" required><input value={form.branch_name} onChange={(e) => set('branch_name', e.target.value)} className={inp} /></Field>
        <Field label="Branch Code" required={!isEdit} hint={isEdit ? 'Code cannot be changed' : 'e.g. NBO-01'}>
          <input value={form.branch_code} onChange={(e) => set('branch_code', e.target.value.toUpperCase())} disabled={isEdit} className={`${inp} ${isEdit ? 'bg-gray-50 text-gray-400' : ''}`} />
        </Field>
        <div className="col-span-full"><Field label="Address"><textarea value={form.address} onChange={(e) => set('address', e.target.value)} rows={2} className={`${inp} resize-none`} placeholder="Street, City, Country" /></Field></div>
        <Field label="Phone"><input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+254…" className={inp} /></Field>
        {isEdit && (
          <Field label="Status">
            <select value={form.is_active ? 'true' : 'false'} onChange={(e) => set('is_active', e.target.value === 'true')} className={`${inp} bg-white`}>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </Field>
        )}
      </div>
    </Modal>
  );
}

// ── Branches Panel ────────────────────────────────────────────────────────────

function BranchesPanel({ companies }) {
  const qc = useQueryClient();
  const [search, setSearch]         = useState('');
  const [companyId, setCompanyId]   = useState('');
  const [page, setPage]             = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['platform-branches', { search, companyId, page }],
    queryFn: () => api.get('/platform/branches', { params: { search, companyId, page, limit: 25 } }).then((r) => r.data.data),
    placeholderData: (prev) => prev,
  });
  const rows  = data?.branches ?? [];
  const total = data?.total    ?? 0;
  const pages = data?.pages    ?? 1;

  const deleteMut = useMutation({
    mutationFn: (id) => api.delete(`/branches/${id}`, withCo(companyId)),
    onSuccess: () => { toast.success('Branch deleted'); qc.invalidateQueries({ queryKey: ['platform-branches'] }); qc.invalidateQueries({ queryKey: ['co-branches', companyId] }); qc.invalidateQueries({ queryKey: ['platform-stats'] }); },
    onError: (err) => toast.error(err.response?.data?.message || 'Delete failed'),
  });

  const handleDelete = (b) => {
    if (b.is_headquarters) { toast.error('Cannot delete the headquarters branch'); return; }
    if (!window.confirm(`Delete branch "${b.branch_name}"?`)) return;
    deleteMut.mutate(b.branch_id);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search branch name or code…"
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none" />
        </div>
        <CompanyFilter companies={companies} value={companyId} onChange={(v) => { setCompanyId(v); setPage(1); }} />
        {companyId && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>Add Branch</Button>}
      </div>
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        {isLoading ? <PageSpinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>{['Branch','Code','Company','HQ','Status','Created',''].map((h) => <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((b) => (
                  <tr key={b.branch_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{b.branch_name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{b.branch_code}</td>
                    <td className="px-4 py-3 text-gray-600">{b.company_name}</td>
                    <td className="px-4 py-3">{b.is_headquarters ? <CheckCircle className="h-4 w-4 text-green-500" /> : <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3">{b.is_active ? <span className="text-green-600 text-xs font-medium">Active</span> : <span className="text-gray-400 text-xs">Inactive</span>}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{formatDate(b.created_at)}</td>
                    <td className="px-4 py-3">{companyId && <RowActions onEdit={() => setEditTarget(b)} onDelete={b.is_headquarters ? undefined : () => handleDelete(b)} deleting={deleteMut.isPending} />}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={7} className="py-14 text-center text-gray-400"><GitBranch className="mx-auto mb-2 h-8 w-8 opacity-25" />No branches found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pages={pages} total={total} onPage={setPage} />
      </div>
      {createOpen && <BranchModal companyId={companyId} onClose={() => setCreateOpen(false)} />}
      {editTarget  && <BranchModal companyId={companyId} branch={editTarget} onClose={() => setEditTarget(null)} />}
    </div>
  );
}

// ── Terminal Modal (Create / Edit) ────────────────────────────────────────────

function TerminalModal({ companyId, terminal, onClose }) {
  const qc     = useQueryClient();
  const isEdit = !!terminal;
  const [form, setFormState] = useState({
    branchId:     terminal?.branch_id     ?? '',
    terminalName: terminal?.terminal_name ?? '',
    terminalCode: terminal?.terminal_code ?? '',
    description:  terminal?.description   ?? '',
    isActive:     terminal?.is_active     ?? true,
  });
  const set = (k, v) => setFormState((f) => ({ ...f, [k]: v }));

  const { data: branches = [] } = useQuery({ queryKey: ['co-branches', companyId], queryFn: () => api.get('/branches', withCo(companyId)).then((r) => r.data.data), enabled: !!companyId });

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['platform-terminals'] }); qc.invalidateQueries({ queryKey: ['platform-stats'] }); };

  const { mutate, isPending } = useMutation({
    mutationFn: (data) => isEdit ? api.patch(`/pos/terminals/${terminal.terminal_id}`, data, withCo(companyId)) : api.post('/pos/terminals', data, withCo(companyId)),
    onSuccess: () => { toast.success(isEdit ? 'Terminal updated' : 'Terminal created'); invalidate(); onClose(); },
    onError: (err) => toast.error(err.response?.data?.message || 'Save failed'),
  });

  const handleSubmit = () => {
    if (!form.terminalName)             { toast.error('Terminal name is required'); return; }
    if (!isEdit && !form.branchId)      { toast.error('Branch is required');       return; }
    if (!isEdit && !form.terminalCode)  { toast.error('Terminal code is required'); return; }
    mutate(form);
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? `Edit Terminal — ${terminal.terminal_name}` : 'Create Terminal'}
      footer={<div className="flex gap-3"><Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button><Button fullWidth loading={isPending} onClick={handleSubmit}>{isEdit ? 'Save Changes' : 'Create Terminal'}</Button></div>}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {!isEdit && <div className="col-span-full"><Field label="Branch" required><select value={form.branchId} onChange={(e) => set('branchId', e.target.value)} className={sel}><option value="">Select branch…</option>{branches.map((b) => <option key={b.branch_id} value={b.branch_id}>{b.branch_name}</option>)}</select></Field></div>}
        <Field label="Terminal Name" required><input value={form.terminalName} onChange={(e) => set('terminalName', e.target.value)} placeholder="e.g. Main Till" className={inp} /></Field>
        <Field label="Terminal Code" required={!isEdit} hint={isEdit ? 'Code cannot be changed' : 'e.g. TILL-01'}>
          <input value={form.terminalCode} onChange={(e) => set('terminalCode', e.target.value.toUpperCase())} disabled={isEdit} className={`${inp} ${isEdit ? 'bg-gray-50 text-gray-400' : ''}`} />
        </Field>
        <div className="col-span-full"><Field label="Description"><input value={form.description} onChange={(e) => set('description', e.target.value)} className={inp} /></Field></div>
        {isEdit && <Field label="Status"><select value={form.isActive ? 'true' : 'false'} onChange={(e) => set('isActive', e.target.value === 'true')} className={sel}><option value="true">Active</option><option value="false">Inactive</option></select></Field>}
      </div>
    </Modal>
  );
}

// ── Terminals Panel ───────────────────────────────────────────────────────────

function TerminalsPanel({ companies }) {
  const qc = useQueryClient();
  const [companyId, setCompanyId]   = useState('');
  const [page, setPage]             = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['platform-terminals', { companyId, page }],
    queryFn: () => api.get('/platform/terminals', { params: { companyId, page, limit: 25 } }).then((r) => r.data.data),
    placeholderData: (prev) => prev,
  });
  const rows  = data?.terminals ?? [];
  const total = data?.total     ?? 0;
  const pages = data?.pages     ?? 1;

  const deleteMut = useMutation({
    mutationFn: (id) => api.delete(`/pos/terminals/${id}`, withCo(companyId)),
    onSuccess: () => { toast.success('Terminal deactivated'); qc.invalidateQueries({ queryKey: ['platform-terminals'] }); },
    onError: (err) => toast.error(err.response?.data?.message || 'Delete failed'),
  });

  const handleDelete = (t) => {
    if (parseInt(t.open_sessions) > 0) { toast.error('Close the open session first'); return; }
    if (!window.confirm(`Deactivate terminal "${t.terminal_name}"?`)) return;
    deleteMut.mutate(t.terminal_id);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <CompanyFilter companies={companies} value={companyId} onChange={(v) => { setCompanyId(v); setPage(1); }} />
        {companyId && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>Add Terminal</Button>}
      </div>
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        {isLoading ? <PageSpinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>{['Terminal','Branch','Company','Open Sessions','Status','Created',''].map((h) => <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((t) => (
                  <tr key={t.terminal_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{t.terminal_name}</td>
                    <td className="px-4 py-3 text-gray-600">{t.branch_name}</td>
                    <td className="px-4 py-3 text-gray-600">{t.company_name}</td>
                    <td className="px-4 py-3">{parseInt(t.open_sessions) > 0 ? <span className="rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-xs font-medium">{t.open_sessions} open</span> : <span className="text-gray-400 text-xs">—</span>}</td>
                    <td className="px-4 py-3">{t.is_active ? <span className="text-green-600 text-xs font-medium">Active</span> : <span className="text-gray-400 text-xs">Inactive</span>}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{formatDate(t.created_at)}</td>
                    <td className="px-4 py-3">{companyId && <RowActions onEdit={() => setEditTarget(t)} onDelete={() => handleDelete(t)} deleting={deleteMut.isPending} />}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={7} className="py-14 text-center text-gray-400"><Monitor className="mx-auto mb-2 h-8 w-8 opacity-25" />No terminals found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pages={pages} total={total} onPage={setPage} />
      </div>
      {createOpen && <TerminalModal companyId={companyId} onClose={() => setCreateOpen(false)} />}
      {editTarget  && <TerminalModal companyId={companyId} terminal={editTarget} onClose={() => setEditTarget(null)} />}
    </div>
  );
}

// ── Sessions Panel ────────────────────────────────────────────────────────────

function SessionsPanel({ companies }) {
  const qc = useQueryClient();
  const [companyId,    setCompanyId]    = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page,         setPage]         = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['platform-sessions', { companyId, statusFilter, page }],
    queryFn: () => api.get('/platform/sessions', { params: { companyId, status: statusFilter, page, limit: 25 } }).then((r) => r.data.data),
    placeholderData: (prev) => prev,
  });
  const rows  = data?.sessions ?? [];
  const total = data?.total    ?? 0;
  const pages = data?.pages    ?? 1;

  const forceCloseMut = useMutation({
    mutationFn: (id) => api.patch(`/pos/sessions/${id}/force-close`, {}, withCo(companyId)),
    onSuccess: () => { toast.success('Session force-closed'); qc.invalidateQueries({ queryKey: ['platform-sessions'] }); qc.invalidateQueries({ queryKey: ['platform-stats'] }); },
    onError: (err) => toast.error(err.response?.data?.message || 'Force-close failed'),
  });

  const handleForceClose = (s) => {
    if (!window.confirm(`Force-close the session on terminal "${s.terminal_name}"? Use only if the cashier cannot close it themselves.`)) return;
    forceCloseMut.mutate(s.session_id);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <CompanyFilter companies={companies} value={companyId} onChange={(v) => { setCompanyId(v); setPage(1); }} />
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none bg-white">
          <option value="">All Statuses</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
        </select>
      </div>
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        {isLoading ? <PageSpinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>{['Terminal','Branch','Company','Cashier','Opened','Closed','Status',''].map((h) => <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((s) => (
                  <tr key={s.session_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{s.terminal_name}</td>
                    <td className="px-4 py-3 text-gray-600">{s.branch_name}</td>
                    <td className="px-4 py-3 text-gray-600">{s.company_name}</td>
                    <td className="px-4 py-3 text-gray-600">{s.cashier_name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{formatDate(s.session_start)}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{s.session_end ? formatDate(s.session_end) : '—'}</td>
                    <td className="px-4 py-3"><StatusBadge status={s.status} /></td>
                    <td className="px-4 py-3">
                      {s.status === 'open' && companyId && (
                        <button onClick={() => handleForceClose(s)} disabled={forceCloseMut.isPending}
                          className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-100 transition-colors disabled:opacity-40">
                          <Power className="h-3 w-3" /> Force Close
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={8} className="py-14 text-center text-gray-400"><Layers className="mx-auto mb-2 h-8 w-8 opacity-25" />No sessions found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pages={pages} total={total} onPage={setPage} />
      </div>
    </div>
  );
}

// ── Customer Modal (Create / Edit) ────────────────────────────────────────────

function CustomerModal({ companyId, customer, onClose }) {
  const qc     = useQueryClient();
  const isEdit = !!customer;
  const [form, setFormState] = useState({
    customer_name:     customer?.customer_name     ?? '',
    phone:             customer?.phone             ?? '',
    email:             customer?.email             ?? '',
    customer_group_id: customer?.customer_group_id ?? '',
  });
  const set = (k, v) => setFormState((f) => ({ ...f, [k]: v }));

  const { data: groups = [] } = useQuery({ queryKey: ['co-groups', companyId], queryFn: () => api.get('/customers/groups', withCo(companyId)).then((r) => r.data.data), enabled: !!companyId });

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['platform-customers'] }); qc.invalidateQueries({ queryKey: ['platform-stats'] }); };

  const { mutate, isPending } = useMutation({
    mutationFn: (data) => isEdit ? api.put(`/customers/${customer.customer_id}`, data, withCo(companyId)) : api.post('/customers', data, withCo(companyId)),
    onSuccess: () => { toast.success(isEdit ? 'Customer updated' : 'Customer created'); invalidate(); onClose(); },
    onError: (err) => toast.error(err.response?.data?.message || 'Save failed'),
  });

  const handleSubmit = () => {
    if (!form.customer_name) { toast.error('Customer name is required'); return; }
    mutate({ ...form, customer_group_id: form.customer_group_id || null });
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? `Edit Customer — ${customer.customer_name}` : 'Create Customer'}
      footer={<div className="flex gap-3"><Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button><Button fullWidth loading={isPending} onClick={handleSubmit}>{isEdit ? 'Save Changes' : 'Create Customer'}</Button></div>}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="col-span-full"><Field label="Customer Name" required><input value={form.customer_name} onChange={(e) => set('customer_name', e.target.value)} className={inp} /></Field></div>
        <Field label="Phone"><input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+254…" className={inp} /></Field>
        <Field label="Email"><input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} className={inp} /></Field>
        <div className="col-span-full">
          <Field label="Customer Group">
            <select value={form.customer_group_id} onChange={(e) => set('customer_group_id', e.target.value)} className={sel}>
              <option value="">No group</option>
              {groups.map((g) => <option key={g.group_id} value={g.group_id}>{g.group_name}</option>)}
            </select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}

// ── Customers Panel ───────────────────────────────────────────────────────────

function CustomersPanel({ companies }) {
  const qc = useQueryClient();
  const [search,    setSearch]      = useState('');
  const [companyId, setCompanyId]   = useState('');
  const [page,      setPage]        = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['platform-customers', { search, companyId, page }],
    queryFn: () => api.get('/platform/customers', { params: { search, companyId, page, limit: 25 } }).then((r) => r.data.data),
    placeholderData: (prev) => prev,
  });
  const rows  = data?.customers ?? [];
  const total = data?.total     ?? 0;
  const pages = data?.pages     ?? 1;

  const deleteMut = useMutation({
    mutationFn: (id) => api.delete(`/customers/${id}`, withCo(companyId)),
    onSuccess: () => { toast.success('Customer deleted'); qc.invalidateQueries({ queryKey: ['platform-customers'] }); qc.invalidateQueries({ queryKey: ['platform-stats'] }); },
    onError: (err) => toast.error(err.response?.data?.message || 'Delete failed'),
  });

  const handleDelete = (c) => {
    if (!window.confirm(`Delete customer "${c.customer_name}"?`)) return;
    deleteMut.mutate(c.customer_id);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search name or phone…"
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none" />
        </div>
        <CompanyFilter companies={companies} value={companyId} onChange={(v) => { setCompanyId(v); setPage(1); }} />
        {companyId && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>Add Customer</Button>}
      </div>
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        {isLoading ? <PageSpinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>{['Customer','Phone','Email','Group','Company','Created',''].map((h) => <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((c) => (
                  <tr key={c.customer_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{c.customer_name}</td>
                    <td className="px-4 py-3 text-gray-600">{c.phone ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{c.email ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{c.group_name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{c.company_name}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{formatDate(c.created_at)}</td>
                    <td className="px-4 py-3">{companyId && <RowActions onEdit={() => setEditTarget(c)} onDelete={() => handleDelete(c)} deleting={deleteMut.isPending} />}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={7} className="py-14 text-center text-gray-400"><UserCheck className="mx-auto mb-2 h-8 w-8 opacity-25" />No customers found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pages={pages} total={total} onPage={setPage} />
      </div>
      {createOpen && <CustomerModal companyId={companyId} onClose={() => setCreateOpen(false)} />}
      {editTarget  && <CustomerModal companyId={companyId} customer={editTarget} onClose={() => setEditTarget(null)} />}
    </div>
  );
}

// ── Product Modal (Create / Edit) ─────────────────────────────────────────────

function ProductModal({ companyId, product, onClose }) {
  const qc     = useQueryClient();
  const isEdit = !!product;
  const [form, setFormState] = useState({
    product_name:    product?.product_name    ?? '',
    sku:             product?.sku             ?? '',
    barcode:         product?.barcode         ?? '',
    category_id:     product?.category_id     ?? '',
    base_price:      product?.base_price      ?? '',
    cost_price:      product?.cost_price      ?? '',
    unit_of_measure: product?.unit_of_measure ?? 'Unit',
    is_active:       product?.is_active       ?? true,
  });
  const set = (k, v) => setFormState((f) => ({ ...f, [k]: v }));

  const { data: categories = [] } = useQuery({ queryKey: ['co-categories', companyId], queryFn: () => api.get('/products/categories', withCo(companyId)).then((r) => r.data.data), enabled: !!companyId });

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['platform-products'] }); qc.invalidateQueries({ queryKey: ['platform-stats'] }); };

  const { mutate, isPending } = useMutation({
    mutationFn: (data) => isEdit ? api.put(`/products/${product.product_id}`, data, withCo(companyId)) : api.post('/products', data, withCo(companyId)),
    onSuccess: () => { toast.success(isEdit ? 'Product updated' : 'Product created'); invalidate(); onClose(); },
    onError: (err) => toast.error(err.response?.data?.message || 'Save failed'),
  });

  const handleSubmit = () => {
    if (!form.product_name)        { toast.error('Product name is required'); return; }
    if (!form.base_price)          { toast.error('Base price is required');   return; }
    if (!isEdit && !form.sku)      { toast.error('SKU is required');          return; }
    mutate({ ...form, base_price: parseFloat(form.base_price) || 0, cost_price: parseFloat(form.cost_price) || 0, category_id: form.category_id || null });
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? `Edit Product — ${product.product_name}` : 'Create Product'} size="lg"
      footer={<div className="flex gap-3"><Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button><Button fullWidth loading={isPending} onClick={handleSubmit}>{isEdit ? 'Save Changes' : 'Create Product'}</Button></div>}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="col-span-full"><Field label="Product Name" required><input value={form.product_name} onChange={(e) => set('product_name', e.target.value)} className={inp} /></Field></div>
        <Field label="SKU" required={!isEdit} hint={isEdit ? 'SKU cannot be changed' : undefined}>
          <input value={form.sku} onChange={(e) => set('sku', e.target.value)} disabled={isEdit} className={`${inp} ${isEdit ? 'bg-gray-50 text-gray-400' : ''}`} />
        </Field>
        <Field label="Barcode"><input value={form.barcode} onChange={(e) => set('barcode', e.target.value)} className={inp} /></Field>
        <Field label="Category">
          <select value={form.category_id} onChange={(e) => set('category_id', e.target.value)} className={sel}>
            <option value="">No category</option>
            {categories.map((c) => <option key={c.category_id} value={c.category_id}>{c.category_name}</option>)}
          </select>
        </Field>
        <Field label="Unit of Measure">
          <select value={form.unit_of_measure} onChange={(e) => set('unit_of_measure', e.target.value)} className={sel}>
            {['Unit','Kg','g','L','ml','Box','Pack','Dozen','Pair','m'].map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </Field>
        <Field label="Base Price (selling)" required><input type="number" step="0.01" min="0" value={form.base_price} onChange={(e) => set('base_price', e.target.value)} className={inp} /></Field>
        <Field label="Cost Price"><input type="number" step="0.01" min="0" value={form.cost_price} onChange={(e) => set('cost_price', e.target.value)} className={inp} /></Field>
        {isEdit && <Field label="Status"><select value={form.is_active ? 'true' : 'false'} onChange={(e) => set('is_active', e.target.value === 'true')} className={sel}><option value="true">Active</option><option value="false">Inactive</option></select></Field>}
      </div>
    </Modal>
  );
}

// ── Products Panel ────────────────────────────────────────────────────────────

function ProductsPanel({ companies }) {
  const qc = useQueryClient();
  const [search,    setSearch]      = useState('');
  const [companyId, setCompanyId]   = useState('');
  const [page,      setPage]        = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['platform-products', { search, companyId, page }],
    queryFn: () => api.get('/platform/products', { params: { search, companyId, page, limit: 25 } }).then((r) => r.data.data),
    placeholderData: (prev) => prev,
  });
  const rows  = data?.products ?? [];
  const total = data?.total    ?? 0;
  const pages = data?.pages    ?? 1;

  const deleteMut = useMutation({
    mutationFn: (id) => api.delete(`/products/${id}`, withCo(companyId)),
    onSuccess: () => { toast.success('Product deleted'); qc.invalidateQueries({ queryKey: ['platform-products'] }); qc.invalidateQueries({ queryKey: ['platform-stats'] }); },
    onError: (err) => toast.error(err.response?.data?.message || 'Delete failed'),
  });

  const handleDelete = (p) => {
    if (!window.confirm(`Delete product "${p.product_name}"? This cannot be undone.`)) return;
    deleteMut.mutate(p.product_id);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search product or SKU…"
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none" />
        </div>
        <CompanyFilter companies={companies} value={companyId} onChange={(v) => { setCompanyId(v); setPage(1); }} />
        {companyId && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>Add Product</Button>}
      </div>
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        {isLoading ? <PageSpinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>{['Product','SKU','Category','Company','Base Price','Status',''].map((h) => <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((p) => (
                  <tr key={p.product_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{p.product_name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{p.sku ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{p.category_name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{p.company_name}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">{formatCurrency(p.base_price)}</td>
                    <td className="px-4 py-3">{p.is_active ? <span className="text-green-600 text-xs font-medium">Active</span> : <span className="text-gray-400 text-xs">Inactive</span>}</td>
                    <td className="px-4 py-3">{companyId && <RowActions onEdit={() => setEditTarget(p)} onDelete={() => handleDelete(p)} deleting={deleteMut.isPending} />}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={7} className="py-14 text-center text-gray-400"><Package className="mx-auto mb-2 h-8 w-8 opacity-25" />No products found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pages={pages} total={total} onPage={setPage} />
      </div>
      {createOpen && <ProductModal companyId={companyId} onClose={() => setCreateOpen(false)} />}
      {editTarget  && <ProductModal companyId={companyId} product={editTarget} onClose={() => setEditTarget(null)} />}
    </div>
  );
}

// ── Branch Pricing Modal ──────────────────────────────────────────────────────

function BranchPricingModal({ companyId, product, onClose }) {
  const qc = useQueryClient();
  const { data: pricing = [], isLoading } = useQuery({
    queryKey: ['branch-pricing', companyId, product.product_id],
    queryFn: () => api.get(`/products/${product.product_id}/branch-pricing`, withCo(companyId)).then((r) => r.data.data),
    enabled: !!companyId && !!product.product_id,
  });

  const [edits, setEdits] = useState({});
  const setEdit = (branchId, field, value) =>
    setEdits((prev) => ({ ...prev, [branchId]: { ...prev[branchId], [field]: value } }));

  const saveMut = useMutation({
    mutationFn: ({ branchId, selling_price, special_price }) =>
      api.put(`/products/${product.product_id}/branch-pricing`, { branchId, selling_price, special_price }, withCo(companyId)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['branch-pricing', companyId, product.product_id] }); toast.success('Pricing saved'); },
    onError: (err) => toast.error(err.response?.data?.message || 'Save failed'),
  });

  const handleSave = (row) => {
    const edit = edits[row.branch_id] ?? {};
    const selling_price = edit.selling_price !== undefined ? (edit.selling_price === '' ? null : parseFloat(edit.selling_price)) : row.selling_price;
    const special_price = edit.special_price !== undefined ? (edit.special_price === '' ? null : parseFloat(edit.special_price)) : row.special_price;
    saveMut.mutate({ branchId: row.branch_id, selling_price, special_price });
  };

  const handleReset = (row) => saveMut.mutate({ branchId: row.branch_id, selling_price: null, special_price: null });

  return (
    <Modal open onClose={onClose} title={`Branch Pricing — ${product.product_name}`} size="lg"
      footer={<Button fullWidth onClick={onClose}>Done</Button>}
    >
      <p className="mb-3 text-xs text-gray-500">
        Base price: <span className="font-semibold text-gray-800">{formatCurrency(product.base_price)}</span>
        {' '}— Leave selling price blank to use base price at that branch.
      </p>
      {isLoading ? <PageSpinner /> : (
        <div className="divide-y divide-gray-50 rounded-xl border border-gray-100 overflow-hidden">
          {pricing.map((row) => {
            const edit = edits[row.branch_id] ?? {};
            const sp  = edit.selling_price !== undefined ? edit.selling_price : (row.selling_price ?? '');
            const spp = edit.special_price !== undefined ? edit.special_price : (row.special_price ?? '');
            const dirty = edit.selling_price !== undefined || edit.special_price !== undefined;
            return (
              <div key={row.branch_id} className="flex items-center gap-3 px-4 py-3 bg-white hover:bg-gray-50">
                <div className="w-36 flex-shrink-0">
                  <p className="text-sm font-medium text-gray-800">{row.branch_name}</p>
                  {!row.selling_price && <p className="text-xs text-gray-400">Using base price</p>}
                </div>
                <div className="flex-1 grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-500 mb-0.5 block">Selling Price</label>
                    <input type="number" step="0.01" min="0" value={sp} onChange={(e) => setEdit(row.branch_id, 'selling_price', e.target.value)}
                      placeholder={String(row.base_price)}
                      className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-primary-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-0.5 block">Promo / Special Price</label>
                    <input type="number" step="0.01" min="0" value={spp} onChange={(e) => setEdit(row.branch_id, 'special_price', e.target.value)}
                      placeholder="Optional"
                      className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-primary-500 focus:outline-none" />
                  </div>
                </div>
                <div className="flex gap-1.5 flex-shrink-0">
                  {dirty && <Button size="xs" loading={saveMut.isPending} onClick={() => handleSave(row)}>Save</Button>}
                  {row.selling_price && (
                    <button onClick={() => handleReset(row)} className="rounded-md px-2 py-1 text-xs text-red-500 hover:bg-red-50 transition-colors" title="Reset to base price">Reset</button>
                  )}
                </div>
              </div>
            );
          })}
          {pricing.length === 0 && <div className="py-10 text-center text-gray-400 text-sm">No branches found for this company.</div>}
        </div>
      )}
    </Modal>
  );
}

// ── Pricing Panel ─────────────────────────────────────────────────────────────

function PricingPanel({ companies }) {
  const [search,       setSearch]       = useState('');
  const [companyId,    setCompanyId]    = useState('');
  const [page,         setPage]         = useState(1);
  const [pricingTarget, setPricingTarget] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['platform-products', { search, companyId, page }],
    queryFn: () => api.get('/platform/products', { params: { search, companyId, page, limit: 25 } }).then((r) => r.data.data),
    placeholderData: (prev) => prev,
    enabled: !!companyId,
  });
  const rows  = data?.products ?? [];
  const total = data?.total    ?? 0;
  const pages = data?.pages    ?? 1;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
        Select a company to manage branch-level pricing overrides. Per-branch pricing overrides the product's base price at that specific location.
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search product or SKU…"
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none" />
        </div>
        <CompanyFilter companies={companies} value={companyId} onChange={(v) => { setCompanyId(v); setPage(1); }} />
      </div>

      {!companyId ? (
        <div className="rounded-xl border border-gray-100 bg-white p-14 text-center text-gray-400">
          <DollarSign className="mx-auto mb-2 h-8 w-8 opacity-25" />
          <p className="text-sm">Select a company above to view and edit branch pricing</p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          {isLoading ? <PageSpinner /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>{['Product','SKU','Category','Base Price','Status',''].map((h) => <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {rows.map((p) => (
                    <tr key={p.product_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{p.product_name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{p.sku ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{p.category_name ?? '—'}</td>
                      <td className="px-4 py-3 font-medium text-gray-800">{formatCurrency(p.base_price)}</td>
                      <td className="px-4 py-3">{p.is_active ? <span className="text-green-600 text-xs font-medium">Active</span> : <span className="text-gray-400 text-xs">Inactive</span>}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => setPricingTarget(p)}
                          className="inline-flex items-center gap-1.5 rounded-md bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-700 hover:bg-primary-100 transition-colors">
                          <DollarSign className="h-3 w-3" /> Manage Pricing
                        </button>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={6} className="py-14 text-center text-gray-400"><Package className="mx-auto mb-2 h-8 w-8 opacity-25" />No products found</td></tr>}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={page} pages={pages} total={total} onPage={setPage} />
        </div>
      )}
      {pricingTarget && <BranchPricingModal companyId={companyId} product={pricingTarget} onClose={() => setPricingTarget(null)} />}
    </div>
  );
}

// ── Inventory Panel ───────────────────────────────────────────────────────────

function InventoryPanel({ companies }) {
  const [companyId,    setCompanyId]    = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [page,         setPage]         = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['platform-inventory', { companyId, lowStockOnly, page }],
    queryFn: () => api.get('/platform/inventory', { params: { companyId, lowStockOnly: lowStockOnly || undefined, page, limit: 25 } }).then((r) => r.data.data),
    placeholderData: (prev) => prev,
  });
  const rows  = data?.inventory ?? [];
  const total = data?.total     ?? 0;
  const pages = data?.pages     ?? 1;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <CompanyFilter companies={companies} value={companyId} onChange={(v) => { setCompanyId(v); setPage(1); }} />
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
          <input type="checkbox" checked={lowStockOnly} onChange={(e) => { setLowStockOnly(e.target.checked); setPage(1); }} className="rounded border-gray-300 text-primary-600" />
          Low stock only
        </label>
      </div>
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        {isLoading ? <PageSpinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>{['Product','Branch','Company','Qty','Reorder Level','Alert'].map((h) => <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((i) => {
                  const isLow = Number(i.quantity_available) <= Number(i.reorder_level);
                  return (
                    <tr key={`${i.product_id}-${i.branch_id}`} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{i.product_name}</td>
                      <td className="px-4 py-3 text-gray-600">{i.branch_name}</td>
                      <td className="px-4 py-3 text-gray-600">{i.company_name}</td>
                      <td className="px-4 py-3 font-semibold text-gray-800">{i.quantity_available}</td>
                      <td className="px-4 py-3 text-gray-500">{i.reorder_level}</td>
                      <td className="px-4 py-3">{isLow ? <span className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-600 px-2 py-0.5 text-xs font-medium"><AlertTriangle className="h-3 w-3" /> Low</span> : <span className="text-gray-300 text-xs">OK</span>}</td>
                    </tr>
                  );
                })}
                {rows.length === 0 && <tr><td colSpan={6} className="py-14 text-center text-gray-400"><BarChart2 className="mx-auto mb-2 h-8 w-8 opacity-25" />No inventory data found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pages={pages} total={total} onPage={setPage} />
      </div>
    </div>
  );
}

// ── Sales Panel ───────────────────────────────────────────────────────────────

function SalesPanel({ companies }) {
  const [companyId, setCompanyId] = useState('');
  const [dateFrom,  setDateFrom]  = useState('');
  const [dateTo,    setDateTo]    = useState('');
  const [page,      setPage]      = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['platform-sales', { companyId, dateFrom, dateTo, page }],
    queryFn: () => api.get('/platform/sales', { params: { companyId, dateFrom, dateTo, page, limit: 25 } }).then((r) => r.data.data),
    placeholderData: (prev) => prev,
  });
  const rows  = data?.sales ?? [];
  const total = data?.total ?? 0;
  const pages = data?.pages ?? 1;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <CompanyFilter companies={companies} value={companyId} onChange={(v) => { setCompanyId(v); setPage(1); }} />
        <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
        <input type="date" value={dateTo}   onChange={(e) => { setDateTo(e.target.value);   setPage(1); }} className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
      </div>
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        {isLoading ? <PageSpinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>{['Receipt','Company','Branch','Cashier','Total','Date','Status'].map((h) => <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((s) => (
                  <tr key={s.transaction_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">{s.transaction_number}</td>
                    <td className="px-4 py-3 text-gray-600">{s.company_name}</td>
                    <td className="px-4 py-3 text-gray-600">{s.branch_name}</td>
                    <td className="px-4 py-3 text-gray-600">{s.cashier_name ?? '—'}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{formatCurrency(s.total_amount)}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{formatDate(s.transaction_date)}</td>
                    <td className="px-4 py-3"><StatusBadge status={s.status} /></td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={7} className="py-14 text-center text-gray-400"><ShoppingCart className="mx-auto mb-2 h-8 w-8 opacity-25" />No sales found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pages={pages} total={total} onPage={setPage} />
      </div>
    </div>
  );
}

// ── Payment Method Modal (Create / Edit) ──────────────────────────────────────

function PaymentMethodModal({ companyId, pm, onClose }) {
  const qc     = useQueryClient();
  const isEdit = !!pm;
  const [form, setFormState] = useState({
    methodName:         pm?.method_name         ?? '',
    requiresReference:  pm?.requires_reference  ?? false,
    isActive:           pm?.is_active           ?? true,
  });
  const set = (k, v) => setFormState((f) => ({ ...f, [k]: v }));

  const { mutate, isPending } = useMutation({
    mutationFn: (data) => isEdit
      ? api.patch(`/pos/payment-methods/${pm.payment_method_id}`, data, withCo(companyId))
      : api.post('/pos/payment-methods', data, withCo(companyId)),
    onSuccess: () => {
      toast.success(isEdit ? 'Payment method updated' : 'Payment method created');
      qc.invalidateQueries({ queryKey: ['platform-payments'] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Save failed'),
  });

  const handleSubmit = () => {
    if (!form.methodName.trim()) { toast.error('Method name is required'); return; }
    mutate(form);
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? `Edit — ${pm.method_name}` : 'New Payment Method'}
      footer={<div className="flex gap-3"><Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button><Button fullWidth loading={isPending} onClick={handleSubmit}>{isEdit ? 'Save Changes' : 'Create'}</Button></div>}
    >
      <div className="space-y-4">
        <Field label="Method Name" required>
          <input value={form.methodName} onChange={(e) => set('methodName', e.target.value)} className={inp} placeholder="e.g. M-Pesa, Cash, Card" />
        </Field>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={form.requiresReference} onChange={(e) => set('requiresReference', e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
          <div>
            <p className="text-sm font-medium text-gray-800">Requires Reference</p>
            <p className="text-xs text-gray-500">Cashier must enter a reference number (e.g. M-Pesa confirmation code)</p>
          </div>
        </label>
        {isEdit && (
          <Field label="Status">
            <select value={form.isActive ? 'true' : 'false'} onChange={(e) => set('isActive', e.target.value === 'true')} className={sel}>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </Field>
        )}
      </div>
    </Modal>
  );
}

// ── M-Pesa Panel ──────────────────────────────────────────────────────────────

const MPESA_MODE_STYLE = {
  stk_push: 'bg-green-100 text-green-700',
  c2b:      'bg-blue-100 text-blue-700',
  manual:   'bg-gray-100 text-gray-600',
};

function MpesaPanel({ companies }) {
  const [search,    setSearch]    = useState('');
  const [companyId, setCompanyId] = useState('');
  const [mode,      setMode]      = useState('');
  const [page,      setPage]      = useState(1);

  const selectedCompany = companies.find((c) => c.company_id === companyId);
  const hasApiAccess    = !companyId || (selectedCompany?.has_api_access ?? false);

  const { data, isLoading } = useQuery({
    queryKey: ['platform-mpesa', { search, companyId, mode, page }],
    queryFn: () => api.get('/platform/mpesa', { params: { search, companyId, mode, page, limit: 25 } }).then((r) => r.data.data),
    placeholderData: (prev) => prev,
    enabled: hasApiAccess,
  });
  const rows  = data?.transactions ?? [];
  const total = data?.total        ?? 0;
  const pages = data?.pages        ?? 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search receipt, phone or reference…"
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none" />
        </div>
        <CompanyFilter companies={companies} value={companyId} onChange={(v) => { setCompanyId(v); setPage(1); }} />
        {companyId && !hasApiAccess && (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">M-Pesa not enabled — plan has no API access</span>
        )}
        <select value={mode} onChange={(e) => { setMode(e.target.value); setPage(1); }}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none bg-white">
          <option value="">All Modes</option>
          {['stk_push','c2b','manual'].map((m) => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
        </select>
      </div>
      {companyId && !hasApiAccess ? (
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-10 text-center text-sm text-amber-700">
          This company's plan does not include API/M-Pesa access. Upgrade to Enterprise to enable M-Pesa integration.
        </div>
      ) : (
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        {isLoading ? <PageSpinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>{['Receipt #','Phone','Amount','Mode','Reference','Branch','Company','Date'].map((h) => <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((t) => (
                  <tr key={t.mpesa_txn_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">{t.mpesa_receipt_number ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{t.phone_number}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{formatCurrency(t.amount)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${MPESA_MODE_STYLE[t.payment_mode] ?? 'bg-gray-100 text-gray-600'}`}>
                        {t.payment_mode?.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{t.account_reference ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{t.branch_name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{t.company_name}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{formatDate(t.completed_at)}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={8} className="py-14 text-center text-gray-400"><Smartphone className="mx-auto mb-2 h-8 w-8 opacity-25" />No M-Pesa transactions found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pages={pages} total={total} onPage={setPage} />
      </div>
      )}
    </div>
  );
}

// ── M-Pesa Config Modal ───────────────────────────────────────────────────────

function MpesaConfigModal({ companyId: initialCompanyId, companies = [], config, onClose }) {
  const qc     = useQueryClient();
  const isEdit = !!config;

  const [selectedCompanyId, setSelectedCompanyId] = useState(initialCompanyId ?? '');
  const companyId = selectedCompanyId;

  const [form, setFormState] = useState({
    branchId:       config?.branch_id      ?? '',
    shortcode:      config?.shortcode      ?? '',
    shortcodeType:  config?.shortcode_type ?? 'paybill',
    environment:    config?.environment    ?? 'sandbox',
    callbackUrl:    config?.callback_url   ?? '',
    consumerKey:    '',
    consumerSecret: '',
    passkey:        '',
  });
  const set = (k, v) => setFormState((f) => ({ ...f, [k]: v }));

  const { data: branches = [] } = useQuery({
    queryKey: ['co-branches', companyId],
    queryFn: () => api.get('/branches', withCo(companyId)).then((r) => r.data.data),
    enabled: !!companyId,
  });

  const { mutate, isPending } = useMutation({
    mutationFn: (data) => api.post('/platform/mpesa-configs', { companyId, ...data }),
    onSuccess: () => {
      toast.success(isEdit ? 'M-Pesa config updated' : 'M-Pesa config created');
      qc.invalidateQueries({ queryKey: ['platform-mpesa-configs'] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Save failed'),
  });

  const handleSubmit = () => {
    if (!companyId)           { toast.error('Select a company');            return; }
    if (!form.shortcode)      { toast.error('Shortcode is required');       return; }
    if (!form.consumerKey)    { toast.error('Consumer Key is required');    return; }
    if (!form.consumerSecret) { toast.error('Consumer Secret is required'); return; }
    if (!form.passkey)        { toast.error('Passkey is required');         return; }
    mutate(form);
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? `Edit Config — ${config.company_name}` : 'Create M-Pesa Config'} size="lg"
      footer={<div className="flex gap-3"><Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button><Button fullWidth loading={isPending} onClick={handleSubmit}>{isEdit ? 'Save Changes' : 'Create Config'}</Button></div>}
    >
      <div className="space-y-3">
        {isEdit && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
            Sensitive credentials must be re-entered to save changes. Current Consumer Key hint: <span className="font-mono font-semibold">{config.consumer_key_hint}</span>
          </div>
        )}
        {!isEdit && companies.length > 0 && (
          <Field label="Company" required>
            <select value={selectedCompanyId} onChange={(e) => setSelectedCompanyId(e.target.value)} className={sel}>
              <option value="">Select company…</option>
              {companies.map((c) => <option key={c.company_id} value={c.company_id}>{c.company_name}</option>)}
            </select>
          </Field>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Branch (blank = company-wide)">
            <select value={form.branchId} onChange={(e) => set('branchId', e.target.value)} className={sel}>
              <option value="">Company-wide</option>
              {branches.map((b) => <option key={b.branch_id} value={b.branch_id}>{b.branch_name}</option>)}
            </select>
          </Field>
          <Field label="Environment">
            <select value={form.environment} onChange={(e) => set('environment', e.target.value)} className={sel}>
              <option value="sandbox">Sandbox</option>
              <option value="production">Production</option>
            </select>
          </Field>
          <Field label="Shortcode" required>
            <input value={form.shortcode} onChange={(e) => set('shortcode', e.target.value)} placeholder="e.g. 174379" className={inp} />
          </Field>
          <Field label="Shortcode Type">
            <select value={form.shortcodeType} onChange={(e) => set('shortcodeType', e.target.value)} className={sel}>
              <option value="paybill">Paybill</option>
              <option value="till">Till Number</option>
            </select>
          </Field>
          <Field label="Consumer Key" required>
            <input value={form.consumerKey} onChange={(e) => set('consumerKey', e.target.value)}
              placeholder={isEdit ? `New key (current: ${config.consumer_key_hint})` : 'Consumer Key'} className={inp} />
          </Field>
          <Field label="Consumer Secret" required>
            <input type="password" value={form.consumerSecret} onChange={(e) => set('consumerSecret', e.target.value)}
              placeholder="Consumer Secret" className={inp} />
          </Field>
          <div className="col-span-full">
            <Field label="Passkey" required>
              <input type="password" value={form.passkey} onChange={(e) => set('passkey', e.target.value)}
                placeholder={isEdit ? `New passkey (current: ${config.passkey_hint})` : 'Passkey'} className={inp} />
            </Field>
          </div>
          <div className="col-span-full">
            <Field label="Callback URL" hint="Must be publicly accessible HTTPS URL">
              <input type="url" value={form.callbackUrl} onChange={(e) => set('callbackUrl', e.target.value)}
                placeholder="https://your-domain/api/mpesa/callback" className={inp} />
            </Field>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── M-Pesa Config Panel ───────────────────────────────────────────────────────

function MpesaConfigPanel({ companies }) {
  const qc = useQueryClient();
  const [companyId,  setCompanyId]  = useState('');
  const [page,       setPage]       = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);

  const selectedCompany = companies.find((c) => c.company_id === companyId);
  const hasApiAccess    = !companyId || (selectedCompany?.has_api_access ?? false);

  const { data, isLoading } = useQuery({
    queryKey: ['platform-mpesa-configs', { companyId, page }],
    queryFn: () => api.get('/platform/mpesa-configs', { params: { companyId, page, limit: 25 } }).then((r) => r.data.data),
    placeholderData: (prev) => prev,
    enabled: hasApiAccess,
  });
  const rows  = data?.configs ?? [];
  const total = data?.total   ?? 0;
  const pages = data?.pages   ?? 1;

  const toggleMut = useMutation({
    mutationFn: (id) => api.patch(`/platform/mpesa-configs/${id}/toggle`),
    onSuccess: () => { toast.success('Status updated'); qc.invalidateQueries({ queryKey: ['platform-mpesa-configs'] }); },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed'),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <CompanyFilter companies={companies} value={companyId} onChange={(v) => { setCompanyId(v); setPage(1); }} />
        {(!companyId || hasApiAccess) && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>Add Config</Button>}
        {companyId && !hasApiAccess && (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">M-Pesa not enabled — plan has no API access</span>
        )}
      </div>
      {companyId && !hasApiAccess ? (
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-10 text-center text-sm text-amber-700">
          This company's plan does not include API/M-Pesa access. Upgrade to Enterprise to enable M-Pesa integration.
        </div>
      ) : (
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        {isLoading ? <PageSpinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>{['Company','Branch','Shortcode','Type','Environment','Consumer Key','Status',''].map((h) => <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((c) => (
                  <tr key={c.config_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{c.company_name}</td>
                    <td className="px-4 py-3 text-gray-600">{c.branch_name ?? <span className="text-gray-400 text-xs italic">Company-wide</span>}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">{c.shortcode}</td>
                    <td className="px-4 py-3 text-gray-600 capitalize">{c.shortcode_type}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${c.environment === 'production' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {c.environment}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{c.consumer_key_hint}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleMut.mutate(c.config_id)}
                        disabled={toggleMut.isPending}
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${c.is_active ? 'bg-green-100 text-green-700 hover:bg-red-50 hover:text-red-600' : 'bg-gray-100 text-gray-500 hover:bg-green-50 hover:text-green-700'}`}
                      >
                        {c.is_active ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <RowActions onEdit={() => setEditTarget(c)} />
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={8} className="py-14 text-center text-gray-400"><Settings className="mx-auto mb-2 h-8 w-8 opacity-25" />No M-Pesa configurations found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pages={pages} total={total} onPage={setPage} />
      </div>
      )}
      {createOpen && (
        <MpesaConfigModal
          companyId={companyId || undefined}
          companies={companyId ? [] : companies}
          onClose={() => setCreateOpen(false)}
        />
      )}
      {editTarget && (
        <MpesaConfigModal
          companyId={editTarget.company_id}
          config={editTarget}
          onClose={() => setEditTarget(null)}
        />
      )}
    </div>
  );
}

// ── Payment Methods Panel ─────────────────────────────────────────────────────

function PaymentsPanel({ companies }) {
  const qc = useQueryClient();
  const [companyId,  setCompanyId]  = useState('');
  const [page,       setPage]       = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['platform-payments', { companyId, page }],
    queryFn: () => api.get('/platform/payment-methods', { params: { companyId, page, limit: 25 } }).then((r) => r.data.data),
    placeholderData: (prev) => prev,
  });
  const rows  = data?.paymentMethods ?? [];
  const total = data?.total          ?? 0;
  const pages = data?.pages          ?? 1;

  const deactivateMut = useMutation({
    mutationFn: (id) => api.patch(`/pos/payment-methods/${id}`, { isActive: false }, withCo(companyId)),
    onSuccess: () => { toast.success('Payment method deactivated'); qc.invalidateQueries({ queryKey: ['platform-payments'] }); },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed'),
  });

  const handleDeactivate = (pm) => {
    if (!window.confirm(`Deactivate payment method "${pm.method_name}"? It will no longer appear at the POS.`)) return;
    deactivateMut.mutate(pm.payment_method_id);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <CompanyFilter companies={companies} value={companyId} onChange={(v) => { setCompanyId(v); setPage(1); }} />
        {companyId && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>Add Method</Button>}
      </div>
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        {isLoading ? <PageSpinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>{['Method','Company','Requires Ref','Status',''].map((h) => <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((p) => (
                  <tr key={p.payment_method_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{p.method_name}</td>
                    <td className="px-4 py-3 text-gray-600">{p.company_name}</td>
                    <td className="px-4 py-3">{p.requires_reference ? <CheckCircle className="h-4 w-4 text-green-500" /> : <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3">{p.is_active ? <span className="text-green-600 text-xs font-medium">Active</span> : <span className="text-gray-400 text-xs">Inactive</span>}</td>
                    <td className="px-4 py-3">
                      {companyId && (
                        <RowActions
                          onEdit={() => setEditTarget(p)}
                          onDelete={p.is_active ? () => handleDeactivate(p) : undefined}
                          deleting={deactivateMut.isPending}
                        />
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={5} className="py-14 text-center text-gray-400"><CreditCard className="mx-auto mb-2 h-8 w-8 opacity-25" />No payment methods found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pages={pages} total={total} onPage={setPage} />
      </div>
      {createOpen && <PaymentMethodModal companyId={companyId} onClose={() => setCreateOpen(false)} />}
      {editTarget  && <PaymentMethodModal companyId={companyId} pm={editTarget} onClose={() => setEditTarget(null)} />}
    </div>
  );
}

// ── Suppliers Panel ───────────────────────────────────────────────────────────

function SuppliersPanel({ companies }) {
  const [search,    setSearch]    = useState('');
  const [companyId, setCompanyId] = useState('');
  const [page,      setPage]      = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['platform-suppliers', { search, companyId, page }],
    queryFn: () => api.get('/platform/suppliers', { params: { search, companyId, page, limit: 25 } }).then((r) => r.data.data),
    placeholderData: (prev) => prev,
  });
  const rows  = data?.suppliers ?? [];
  const total = data?.total     ?? 0;
  const pages = data?.pages     ?? 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search supplier name or email…"
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none" />
        </div>
        <CompanyFilter companies={companies} value={companyId} onChange={(v) => { setCompanyId(v); setPage(1); }} />
      </div>
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        {isLoading ? <PageSpinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>{['Supplier','Contact','Email','Phone','Terms','Currency','Company',''].map((h) => <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((s) => (
                  <tr key={s.supplier_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{s.supplier_name}</td>
                    <td className="px-4 py-3 text-gray-600">{s.contact_person ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{s.email ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{s.phone ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{s.payment_terms ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{s.currency ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{s.company_name}</td>
                    <td className="px-4 py-3">
                      {s.is_active
                        ? <span className="text-green-600 text-xs font-medium">Active</span>
                        : <span className="text-gray-400 text-xs">Inactive</span>}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={8} className="py-14 text-center text-gray-400"><Truck className="mx-auto mb-2 h-8 w-8 opacity-25" />No suppliers found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pages={pages} total={total} onPage={setPage} />
      </div>
    </div>
  );
}

// ── Purchases Panel ───────────────────────────────────────────────────────────

const PO_STATUS_STYLE = {
  draft:            'bg-gray-100 text-gray-600',
  pending_approval: 'bg-blue-100 text-blue-700',
  approved:         'bg-green-100 text-green-700',
  received:         'bg-teal-100 text-teal-700',
  cancelled:        'bg-red-100 text-red-600',
};

function PurchasesPanel({ companies }) {
  const [search,       setSearch]       = useState('');
  const [companyId,    setCompanyId]    = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page,         setPage]         = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['platform-purchases', { search, companyId, statusFilter, page }],
    queryFn: () => api.get('/platform/purchases', { params: { search, companyId, status: statusFilter, page, limit: 25 } }).then((r) => r.data.data),
    placeholderData: (prev) => prev,
  });
  const rows  = data?.purchases ?? [];
  const total = data?.total     ?? 0;
  const pages = data?.pages     ?? 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search PO number or supplier…"
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none" />
        </div>
        <CompanyFilter companies={companies} value={companyId} onChange={(v) => { setCompanyId(v); setPage(1); }} />
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none bg-white">
          <option value="">All Statuses</option>
          {['draft','pending_approval','approved','received','cancelled'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
      </div>
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        {isLoading ? <PageSpinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>{['PO #','Supplier','Branch','Company','Total','Order Date','Status'].map((h) => <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((p) => (
                  <tr key={p.po_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">{p.po_number}</td>
                    <td className="px-4 py-3 text-gray-800 font-medium">{p.supplier_name}</td>
                    <td className="px-4 py-3 text-gray-600">{p.branch_name}</td>
                    <td className="px-4 py-3 text-gray-600">{p.company_name}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{formatCurrency(p.total_amount)}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{formatDate(p.order_date)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${PO_STATUS_STYLE[p.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {p.status?.replace(/_/g, ' ')}
                      </span>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={7} className="py-14 text-center text-gray-400"><ShoppingCart className="mx-auto mb-2 h-8 w-8 opacity-25" />No purchase orders found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pages={pages} total={total} onPage={setPage} />
      </div>
    </div>
  );
}

// ── AP Payments Panel ─────────────────────────────────────────────────────────

function ApPaymentsPanel({ companies }) {
  const [search,    setSearch]    = useState('');
  const [companyId, setCompanyId] = useState('');
  const [page,      setPage]      = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['platform-ap-payments', { search, companyId, page }],
    queryFn: () => api.get('/platform/ap-payments', { params: { search, companyId, page, limit: 25 } }).then((r) => r.data.data),
    placeholderData: (prev) => prev,
  });
  const rows  = data?.payments ?? [];
  const total = data?.total    ?? 0;
  const pages = data?.pages    ?? 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search supplier or reference…"
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none" />
        </div>
        <CompanyFilter companies={companies} value={companyId} onChange={(v) => { setCompanyId(v); setPage(1); }} />
      </div>
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        {isLoading ? <PageSpinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>{['Supplier','Amount','Method','Reference','Bank Account','PO #','Company','Date'].map((h) => <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((p) => (
                  <tr key={p.payment_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{p.supplier_name}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{formatCurrency(p.amount)}</td>
                    <td className="px-4 py-3 text-gray-600 capitalize">{p.payment_method?.replace(/_/g, ' ') ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{p.reference_number ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{p.bank_account_name ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{p.po_number ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{p.company_name}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{formatDate(p.payment_date)}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={8} className="py-14 text-center text-gray-400"><DollarSign className="mx-auto mb-2 h-8 w-8 opacity-25" />No AP payments found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pages={pages} total={total} onPage={setPage} />
      </div>
    </div>
  );
}

// ── Accounts (CoA) Panel ──────────────────────────────────────────────────────

const ACCOUNT_TYPE_STYLE = {
  asset:     'bg-blue-100 text-blue-700',
  liability: 'bg-red-100 text-red-600',
  equity:    'bg-purple-100 text-purple-700',
  revenue:   'bg-green-100 text-green-700',
  expense:   'bg-amber-100 text-amber-700',
};

function AccountsPanel({ companies }) {
  const [search,      setSearch]      = useState('');
  const [companyId,   setCompanyId]   = useState('');
  const [accountType, setAccountType] = useState('');
  const [page,        setPage]        = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['platform-accounts', { search, companyId, accountType, page }],
    queryFn: () => api.get('/platform/accounts', { params: { search, companyId, accountType, page, limit: 25 } }).then((r) => r.data.data),
    placeholderData: (prev) => prev,
  });
  const rows  = data?.accounts ?? [];
  const total = data?.total    ?? 0;
  const pages = data?.pages    ?? 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search account name or code…"
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none" />
        </div>
        <CompanyFilter companies={companies} value={companyId} onChange={(v) => { setCompanyId(v); setPage(1); }} />
        <select value={accountType} onChange={(e) => { setAccountType(e.target.value); setPage(1); }}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none bg-white">
          <option value="">All Types</option>
          {['asset','liability','equity','revenue','expense'].map((t) => <option key={t} value={t} className="capitalize">{t}</option>)}
        </select>
      </div>
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        {isLoading ? <PageSpinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>{['Code','Account Name','Type','Subtype','Company','System'].map((h) => <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((a) => (
                  <tr key={a.account_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">{a.account_code}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{a.account_name}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${ACCOUNT_TYPE_STYLE[a.account_type] ?? 'bg-gray-100 text-gray-600'}`}>
                        {a.account_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs capitalize">{a.account_subtype?.replace(/_/g, ' ') ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{a.company_name}</td>
                    <td className="px-4 py-3">{a.is_system ? <CheckCircle className="h-4 w-4 text-blue-400" /> : <span className="text-gray-300">—</span>}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={6} className="py-14 text-center text-gray-400"><BookOpen className="mx-auto mb-2 h-8 w-8 opacity-25" />No accounts found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pages={pages} total={total} onPage={setPage} />
      </div>
    </div>
  );
}

// ── Bank Accounts Panel ───────────────────────────────────────────────────────

function BankAccountsPanel({ companies }) {
  const [search,    setSearch]    = useState('');
  const [companyId, setCompanyId] = useState('');
  const [page,      setPage]      = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['platform-bank-accounts', { search, companyId, page }],
    queryFn: () => api.get('/platform/bank-accounts', { params: { search, companyId, page, limit: 25 } }).then((r) => r.data.data),
    placeholderData: (prev) => prev,
  });
  const rows  = data?.bankAccounts ?? [];
  const total = data?.total        ?? 0;
  const pages = data?.pages        ?? 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search account name, bank or number…"
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none" />
        </div>
        <CompanyFilter companies={companies} value={companyId} onChange={(v) => { setCompanyId(v); setPage(1); }} />
      </div>
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        {isLoading ? <PageSpinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>{['Account Name','Bank','Account #','Currency','Balance','Default','Company','Status'].map((h) => <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((b) => (
                  <tr key={b.bank_account_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{b.account_name}</td>
                    <td className="px-4 py-3 text-gray-600">{b.bank_name ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{b.account_number ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{b.currency}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{formatCurrency(b.current_balance)}</td>
                    <td className="px-4 py-3">{b.is_default ? <CheckCircle className="h-4 w-4 text-green-500" /> : <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3 text-gray-600">{b.company_name}</td>
                    <td className="px-4 py-3">{b.is_active ? <span className="text-green-600 text-xs font-medium">Active</span> : <span className="text-gray-400 text-xs">Inactive</span>}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={8} className="py-14 text-center text-gray-400"><Landmark className="mx-auto mb-2 h-8 w-8 opacity-25" />No bank accounts found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pages={pages} total={total} onPage={setPage} />
      </div>
    </div>
  );
}

// ── Journals Panel ────────────────────────────────────────────────────────────

const JNL_STATUS_STYLE = {
  draft:  'bg-gray-100 text-gray-600',
  posted: 'bg-green-100 text-green-700',
  void:   'bg-red-100 text-red-600',
};

function JournalsPanel({ companies }) {
  const [search,       setSearch]       = useState('');
  const [companyId,    setCompanyId]    = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page,         setPage]         = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['platform-journals', { search, companyId, statusFilter, page }],
    queryFn: () => api.get('/platform/journals', { params: { search, companyId, status: statusFilter, page, limit: 25 } }).then((r) => r.data.data),
    placeholderData: (prev) => prev,
  });
  const rows  = data?.journals ?? [];
  const total = data?.total    ?? 0;
  const pages = data?.pages    ?? 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search journal number or description…"
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none" />
        </div>
        <CompanyFilter companies={companies} value={companyId} onChange={(v) => { setCompanyId(v); setPage(1); }} />
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none bg-white">
          <option value="">All Statuses</option>
          {['draft','posted','void'].map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
        </select>
      </div>
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        {isLoading ? <PageSpinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>{['Journal #','Description','Debit Total','Company','Created By','Date','Status'].map((h) => <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((j) => (
                  <tr key={j.journal_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">{j.journal_number}</td>
                    <td className="px-4 py-3 text-gray-800">{j.description ?? '—'}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{formatCurrency(j.total_debit)}</td>
                    <td className="px-4 py-3 text-gray-600">{j.company_name}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{j.created_by ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{formatDate(j.entry_date)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${JNL_STATUS_STYLE[j.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {j.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={7} className="py-14 text-center text-gray-400"><ScrollText className="mx-auto mb-2 h-8 w-8 opacity-25" />No journal entries found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pages={pages} total={total} onPage={setPage} />
      </div>
    </div>
  );
}

// ── Reports Panel ─────────────────────────────────────────────────────────────

const REPORT_DEFS = [
  { id: 'sales',             label: 'Sales Report',      endpoint: '/reports/sales',             needsDate: true,  needsBranch: true,  finance: false, platformLevel: false },
  { id: 'stock-valuation',   label: 'Stock Valuation',   endpoint: '/platform/stock-valuation',  needsDate: false, needsBranch: false, finance: false, platformLevel: true  },
  { id: 'pl',                label: 'Profit & Loss',     endpoint: '/reports/pl',                needsDate: true,  needsBranch: false, finance: true,  platformLevel: false },
  { id: 'ap-aging',          label: 'AP Aging',          endpoint: '/reports/ap-aging',          needsDate: false, needsBranch: false, finance: true,  platformLevel: false },
  { id: 'balance-sheet',     label: 'Balance Sheet',     endpoint: '/reports/balance-sheet',     needsDate: false, needsBranch: false, finance: true,  platformLevel: false },
  { id: 'purchases-summary', label: 'Purchases Summary', endpoint: '/reports/purchases-summary', needsDate: true,  needsBranch: false, finance: true,  platformLevel: false },
  { id: 'trial-balance',     label: 'Trial Balance',     endpoint: '/reports/trial-balance',     needsDate: true,  needsBranch: false, finance: true,  platformLevel: false },
  { id: 'cash-flow',         label: 'Cash Flow',         endpoint: '/reports/cash-flow',         needsDate: true,  needsBranch: false, finance: true,  platformLevel: false },
];

function extractReportData(reportId, data) {
  if (!data) return { summary: {}, rows: [] };
  switch (reportId) {
    case 'sales':
      return { summary: data.summary ?? {}, rows: data.topProducts ?? [] };
    case 'stock-valuation':
      return {
        summary: { totalValue: data.totalValue, totalUnits: data.totalUnits },
        rows: (data.items ?? []).map(({ companyName, productName, sku, category, branchName, qty, uom, unitCost, totalValue }) =>
          ({ company: companyName, product: productName, sku, category, branch: branchName, qty: `${qty} ${uom}`, unitCost, totalValue })
        ),
      };
    case 'pl':
      return { summary: { grossProfit: data.grossProfit, grossMargin: data.grossMargin, operatingProfit: data.operatingProfit, operatingMargin: data.operatingMargin }, rows: data.expenseBreakdown ?? [] };
    case 'ap-aging':
      return { summary: data.totals ?? {}, rows: data.suppliers ?? [] };
    case 'balance-sheet':
      return {
        summary: { totalAssets: data.assets?.total, totalLiabilities: data.liabilities?.total, equity: data.equity },
        rows: [
          { section: 'Assets',      item: 'Cash & Bank',       amount: data.assets?.cashAndBank?.total },
          { section: 'Assets',      item: 'Inventory',         amount: data.assets?.inventory?.total },
          { section: 'Assets',      item: 'Total Assets',      amount: data.assets?.total },
          { section: 'Liabilities', item: 'Accounts Payable',  amount: data.liabilities?.accountsPayable?.total },
          { section: 'Liabilities', item: 'Total Liabilities', amount: data.liabilities?.total },
          { section: 'Equity',      item: 'Net Equity',        amount: data.equity },
        ],
      };
    case 'purchases-summary':
      return { summary: { totalOrders: data.orders?.count, orderTotal: data.orders?.total, paidTotal: data.payments?.total }, rows: data.bySupplier ?? [] };
    case 'trial-balance':
      return { summary: { totalDebits: data.totalDebits, totalCredits: data.totalCredits, difference: data.difference }, rows: data.rows ?? [] };
    case 'cash-flow':
      return {
        summary: { netCashChange: data.netCashChange, openingBalance: data.openingBalance, closingBalance: data.closingBalance },
        rows: [
          { section: 'Operating', item: 'Receipts from customers',    amount: data.operating?.receiptsFromCustomers },
          { section: 'Operating', item: 'AR collections',             amount: data.operating?.arCollections },
          { section: 'Operating', item: 'Refunds to customers',       amount: data.operating?.refundsToCustomers },
          { section: 'Operating', item: 'Payments to suppliers',      amount: data.operating?.paymentsToSuppliers },
          { section: 'Operating', item: 'Supplier payment reversals', amount: data.operating?.supplierPaymentVoids },
          { section: 'Operating', item: 'Net Operating',              amount: data.operating?.net },
          { section: 'Financing', item: 'Opening equity deposits',    amount: data.financing?.openingDeposits },
          { section: 'Financing', item: 'Net Financing',              amount: data.financing?.net },
          { section: 'Other',     item: 'Net Other',                  amount: data.other?.net },
        ].filter((r) => r.amount != null && r.amount !== 0),
      };
    default:
      return { summary: {}, rows: [] };
  }
}

function downloadCSV(rows, filename) {
  if (!rows.length) { toast.error('No data to export'); return; }
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => {
      const v = row[h] ?? '';
      return typeof v === 'string' && (v.includes(',') || v.includes('"')) ? `"${v.replace(/"/g, '""')}"` : String(v);
    }).join(',')),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function ReportsPanel({ companies }) {
  const [companyId,  setCompanyId]  = useState('');
  const [reportId,   setReportId]   = useState('sales');
  const [startDate,  setStartDate]  = useState(() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); });
  const [endDate,    setEndDate]    = useState(() => todayLocal());
  const [branchId,   setBranchId]   = useState('');
  const [runKey,     setRunKey]     = useState(null);

  const selectedCompany = companies.find((c) => c.company_id === companyId);
  const hasFinance      = selectedCompany?.has_finance ?? false;
  const availableReports = REPORT_DEFS.filter((r) => !r.finance || hasFinance);

  const def = availableReports.find((r) => r.id === reportId) ?? availableReports[0];

  const { data: branches = [] } = useQuery({
    queryKey: ['co-branches', companyId],
    queryFn: () => api.get('/branches', withCo(companyId)).then((r) => r.data.data),
    enabled: !!companyId && def?.needsBranch,
  });

  const params = {
    ...(def?.needsDate ? { startDate, endDate } : {}),
    ...(def?.needsBranch && branchId ? { branchId } : {}),
    // For platform-level reports, pass companyId as a query param (optional filter)
    ...(def?.platformLevel && companyId ? { companyId } : {}),
  };

  const { data: reportData, isLoading: reportLoading, isError, error } = useQuery({
    queryKey: ['platform-report', companyId, reportId, params, runKey],
    queryFn: () => def.platformLevel
      ? api.get(def.endpoint, { params }).then((r) => r.data.data)
      : api.get(def.endpoint, { params, ...withCo(companyId) }).then((r) => r.data.data),
    enabled: (def?.platformLevel ? true : !!companyId) && !!runKey,
    retry: false,
  });

  const { summary, rows } = extractReportData(reportId, reportData);
  const columns = rows.length ? Object.keys(rows[0]) : [];

  const handleRun = () => {
    if (!def?.platformLevel && !companyId) { toast.error('Select a company first'); return; }
    setRunKey(Date.now());
  };

  const fmtCell = (col, val) => {
    if (val == null) return '—';
    if (typeof val === 'boolean') return val ? 'Yes' : 'No';
    if (typeof val === 'number') {
      const lc = col.toLowerCase();
      if (lc.includes('margin') || lc.includes('rate') || lc.includes('percent')) return `${val.toFixed(1)}%`;
      if (lc.includes('count') || lc.includes('qty') || lc.includes('units') || lc === 'id') return val.toLocaleString();
      return formatCurrency(val);
    }
    return String(val);
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <p className="text-xs font-medium text-gray-600 mb-1">
              Company{def?.platformLevel ? <span className="ml-1 font-normal text-gray-400">(optional filter)</span> : ''}
            </p>
            <CompanyFilter companies={companies} value={companyId} onChange={(v) => {
            setCompanyId(v); setRunKey(null); setBranchId('');
            const co = companies.find((c) => c.company_id === v);
            const coHasFinance = co?.has_finance ?? false;
            setReportId((prev) => {
              const prevDef = REPORT_DEFS.find((r) => r.id === prev);
              return (prevDef && (!prevDef.finance || coHasFinance)) ? prev : 'sales';
            });
          }} />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-600 mb-1">Report</p>
            <select value={def?.id ?? 'sales'} onChange={(e) => { setReportId(e.target.value); setRunKey(null); setBranchId(''); }}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none bg-white min-w-48">
              {availableReports.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </div>
          {def?.needsBranch && (
            <div>
              <p className="text-xs font-medium text-gray-600 mb-1">Branch</p>
              <select value={branchId} onChange={(e) => setBranchId(e.target.value)}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none bg-white">
                <option value="">All Branches</option>
                {branches.map((b) => <option key={b.branch_id} value={b.branch_id}>{b.branch_name}</option>)}
              </select>
            </div>
          )}
          {def?.needsDate && (
            <>
              <div>
                <p className="text-xs font-medium text-gray-600 mb-1">Start Date</p>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inp} />
              </div>
              <div>
                <p className="text-xs font-medium text-gray-600 mb-1">End Date</p>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inp} />
              </div>
            </>
          )}
          <Button icon={<BarChart2 className="h-4 w-4" />} onClick={handleRun}>Run Report</Button>
          {rows.length > 0 && (
            <Button variant="secondary" icon={<FileText className="h-4 w-4" />}
              onClick={() => downloadCSV(rows, `${reportId}-${companyId}-${new Date().toISOString().slice(0,10)}.csv`)}>
              Export CSV
            </Button>
          )}
        </div>
      </div>

      {/* Summary cards */}
      {reportData && Object.keys(summary).length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:grid-cols-4">
          {Object.entries(summary).map(([k, v]) => (
            <div key={k} className="rounded-xl border border-gray-100 bg-white shadow-sm p-4">
              <p className="text-xs text-gray-500 capitalize">{k.replace(/([A-Z])/g, ' $1').trim()}</p>
              <p className="text-xl font-bold text-gray-900 mt-1">{fmtCell(k, v)}</p>
            </div>
          ))}
        </div>
      )}

      {/* Placeholder */}
      {!runKey && (
        <div className="rounded-xl border border-gray-100 bg-white p-14 text-center text-gray-400">
          <BarChart2 className="mx-auto mb-2 h-8 w-8 opacity-25" />
          <p className="text-sm">Select a company and report, then click Run Report</p>
        </div>
      )}

      {runKey && reportLoading && <PageSpinner />}

      {runKey && isError && (
        <div className="rounded-xl border border-red-100 bg-red-50 p-6 text-center text-red-600 text-sm">
          {error?.response?.data?.message || 'Failed to load report. Ensure the company has this module enabled.'}
        </div>
      )}

      {/* Results table */}
      {runKey && !reportLoading && !isError && reportData && (
        <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {columns.map((c) => (
                    <th key={c} className="px-4 py-3 text-left text-xs font-medium text-gray-500 capitalize whitespace-nowrap">
                      {c.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').trim()}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    {columns.map((c) => (
                      <td key={c} className="px-4 py-3 text-gray-700 whitespace-nowrap">{fmtCell(c, row[c])}</td>
                    ))}
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={columns.length || 1} className="py-14 text-center text-gray-400 text-sm">No data for selected period</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Approve Request Modal ─────────────────────────────────────────────────────

function ApproveRequestModal({ request, plans, onClose }) {
  const qc    = useQueryClient();
  const today = todayLocal();

  const plan = plans.find((p) => p.plan_id === request.plan_id);

  const [form, setFormState] = useState(() => {
    const p = PERIODS.find((x) => x.value === request.period);
    const end = p?.months ? addMonths(today, p.months) : today;
    return {
      startDate:  today,
      endDate:    end,
      amountPaid: computeAmount(plan, request.period) || '',
    };
  });
  const set = (k, v) => setFormState((f) => ({ ...f, [k]: v }));

  const handleStartChange = (startDate) => {
    const p = PERIODS.find((x) => x.value === request.period);
    setFormState((f) => ({
      ...f,
      startDate,
      endDate: p?.months ? addMonths(startDate, p.months) : f.endDate,
    }));
  };

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.patch(`/platform/subscription-requests/${request.request_id}`, {
      action: 'approved',
      startDate:  form.startDate,
      endDate:    form.endDate,
      amountPaid: form.amountPaid !== '' ? parseFloat(form.amountPaid) : null,
    }),
    onSuccess: () => {
      toast.success('Subscription approved and activated');
      qc.invalidateQueries({ queryKey: ['platform-sub-requests'] });
      qc.invalidateQueries({ queryKey: ['platform-subscriptions'] });
      qc.invalidateQueries({ queryKey: ['admin-companies'] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Approval failed'),
  });

  return (
    <Modal open onClose={onClose} title="Approve Subscription Request" size="sm"
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button>
          <Button fullWidth loading={isPending} icon={<ThumbsUp className="h-4 w-4" />} onClick={() => mutate()}>
            Approve & Activate
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2.5 text-sm space-y-0.5">
          <p><span className="text-gray-500">Company:</span> <span className="font-medium text-gray-800">{request.company_name}</span></p>
          <p><span className="text-gray-500">Plan:</span> <span className="font-medium text-gray-800">{request.plan_name}</span></p>
          <p><span className="text-gray-500">Period:</span> <span className="capitalize text-gray-800">{request.period?.replace('_', '-')}</span></p>
          {request.message && <p><span className="text-gray-500">Note:</span> <span className="text-gray-700 italic">{request.message}</span></p>}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Start Date</label>
            <input type="date" value={form.startDate} max={form.endDate}
              onChange={(e) => handleStartChange(e.target.value)}
              className={inp} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">End Date</label>
            <input type="date" value={form.endDate} min={form.startDate}
              onChange={(e) => set('endDate', e.target.value)}
              className={inp} />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Amount Paid (KES)</label>
          <input type="number" min="0" step="0.01" value={form.amountPaid}
            onChange={(e) => set('amountPaid', e.target.value)}
            placeholder="0.00" className={inp} />
        </div>

        <div className="rounded-lg bg-green-50 border border-green-100 px-3 py-2 text-xs text-green-700">
          This will set the company status to <strong>active</strong> and update their plan and subscription dates.
        </div>
      </div>
    </Modal>
  );
}

// ── Reject Request Modal ──────────────────────────────────────────────────────

function RejectRequestModal({ request, onClose }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.patch(`/platform/subscription-requests/${request.request_id}`, {
      action: 'rejected',
      rejectionReason: reason || null,
    }),
    onSuccess: () => {
      toast.success('Request rejected');
      qc.invalidateQueries({ queryKey: ['platform-sub-requests'] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed'),
  });

  return (
    <Modal open onClose={onClose} title="Reject Subscription Request" size="sm"
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button>
          <Button fullWidth loading={isPending} variant="danger" icon={<Ban className="h-4 w-4" />} onClick={() => mutate()}>
            Reject Request
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2.5 text-sm space-y-0.5">
          <p><span className="text-gray-500">Company:</span> <span className="font-medium">{request.company_name}</span></p>
          <p><span className="text-gray-500">Plan:</span> <span className="font-medium">{request.plan_name}</span></p>
          <p><span className="text-gray-500">Period:</span> <span className="capitalize">{request.period?.replace('_', '-')}</span></p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Reason <span className="font-normal text-gray-400">(optional — shown to company)</span></label>
          <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Payment not received, please contact billing…"
            className={inp + ' resize-none'} />
        </div>
      </div>
    </Modal>
  );
}

// ── Subscriptions Panel ───────────────────────────────────────────────────────

const REQ_STATUS_STYLE = {
  pending:  { cls: 'bg-amber-100 text-amber-700', label: 'Pending'  },
  approved: { cls: 'bg-green-100 text-green-700', label: 'Approved' },
  rejected: { cls: 'bg-red-100  text-red-600',   label: 'Rejected' },
};

function SubscriptionsPanel({ companies }) {
  const [subTab,     setSubTab]     = useState('requests'); // 'requests' | 'recorded'
  const [companyId,  setCompanyId]  = useState('');
  const [statusFilt, setStatusFilt] = useState('');
  const [page,       setPage]       = useState(1);
  const [recordOpen, setRecordOpen] = useState(false);
  const [approving,  setApproving]  = useState(null);
  const [rejecting,  setRejecting]  = useState(null);

  const { data: plansData = [] } = useQuery({
    queryKey: ['platform-plans'],
    queryFn: () => api.get('/platform/plans').then((r) => r.data.data),
  });

  const { data: reqData, isLoading: reqLoading } = useQuery({
    queryKey: ['platform-sub-requests', companyId, statusFilt, page],
    queryFn: () => api.get('/platform/subscription-requests', {
      params: { companyId: companyId || undefined, status: statusFilt || undefined, page, limit: 25 },
    }).then((r) => r.data.data),
    placeholderData: (prev) => prev,
    enabled: subTab === 'requests',
  });

  const { data: subData, isLoading: subLoading } = useQuery({
    queryKey: ['platform-subscriptions', companyId, page],
    queryFn: () => api.get('/platform/subscriptions', {
      params: { companyId: companyId || undefined, page, limit: 25 },
    }).then((r) => r.data.data),
    placeholderData: (prev) => prev,
    enabled: subTab === 'recorded',
  });

  const reqRows  = reqData?.requests      ?? [];
  const subRows  = subData?.subscriptions ?? [];
  const pendingCount = reqData?.total ?? 0;

  const pages = subTab === 'requests' ? (reqData?.pages ?? 1) : (subData?.pages ?? 1);
  const total = subTab === 'requests' ? (reqData?.total  ?? 0) : (subData?.total  ?? 0);
  const isLoading = subTab === 'requests' ? reqLoading : subLoading;

  const handleTabChange = (t) => { setSubTab(t); setPage(1); };

  return (
    <div className="space-y-4">
      {/* Sub-tabs + filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-lg border border-gray-200 bg-white overflow-hidden text-sm font-medium">
          {[
            { id: 'requests', label: 'Requests' },
            { id: 'recorded', label: 'Recorded' },
          ].map((t) => (
            <button key={t.id} onClick={() => handleTabChange(t.id)}
              className={`px-4 py-2 transition-colors ${subTab === t.id ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <select value={companyId} onChange={(e) => { setCompanyId(e.target.value); setPage(1); }}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:border-primary-500">
            <option value="">All Companies</option>
            {companies.map((c) => <option key={c.company_id} value={c.company_id}>{c.company_name}</option>)}
          </select>

          {subTab === 'requests' && (
            <select value={statusFilt} onChange={(e) => { setStatusFilt(e.target.value); setPage(1); }}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:border-primary-500">
              <option value="">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          )}

          {subTab === 'recorded' && (
            <Button size="sm" icon={<CalendarRange className="h-4 w-4" />} onClick={() => setRecordOpen(true)}>
              Record Subscription
            </Button>
          )}
        </div>
      </div>

      {/* Requests table */}
      {subTab === 'requests' && (
        isLoading ? <PageSpinner /> : reqRows.length === 0 ? (
          <div className="rounded-xl border border-gray-100 bg-white py-16 text-center text-gray-400 text-sm">
            No subscription requests found
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Company</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Plan</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Period</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Submitted</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {reqRows.map((r) => {
                  const s = REQ_STATUS_STYLE[r.status] ?? REQ_STATUS_STYLE.pending;
                  return (
                    <tr key={r.request_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-800">{r.company_name}</td>
                      <td className="px-4 py-3 text-gray-600">{r.plan_name}</td>
                      <td className="px-4 py-3 capitalize text-gray-600">{r.period?.replace('_', '-')}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{r.created_at ? String(r.created_at).slice(0, 10) : '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>
                        {r.status === 'rejected' && r.rejection_reason && (
                          <p className="mt-0.5 text-xs text-red-500 max-w-[160px] truncate" title={r.rejection_reason}>{r.rejection_reason}</p>
                        )}
                        {r.status !== 'pending' && r.actioned_by_name && (
                          <p className="mt-0.5 text-xs text-gray-400">by {r.actioned_by_name}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {r.status === 'pending' && (
                          <div className="flex gap-2">
                            <button onClick={() => setApproving(r)}
                              className="flex items-center gap-1 rounded-lg bg-green-50 border border-green-200 px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-100 transition-colors">
                              <ThumbsUp className="h-3 w-3" /> Approve
                            </button>
                            <button onClick={() => setRejecting(r)}
                              className="flex items-center gap-1 rounded-lg bg-red-50 border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-100 transition-colors">
                              <Ban className="h-3 w-3" /> Reject
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* Recorded subscriptions table */}
      {subTab === 'recorded' && (
        isLoading ? <PageSpinner /> : subRows.length === 0 ? (
          <div className="rounded-xl border border-gray-100 bg-white py-16 text-center text-gray-400 text-sm">
            No subscription records found
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Company</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Plan</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Period</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Start</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">End</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Amount (KES)</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Recorded by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {subRows.map((s) => {
                  const expired      = s.end_date && new Date(s.end_date) < new Date();
                  const expiringSoon = !expired && s.end_date && (new Date(s.end_date) - new Date()) < 30 * 86400000;
                  return (
                    <tr key={s.subscription_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-800">{s.company_name}</td>
                      <td className="px-4 py-3 text-gray-600">{s.plan_name}</td>
                      <td className="px-4 py-3 capitalize text-gray-600">{s.period?.replace('_', '-') || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{s.start_date ? String(s.start_date).slice(0, 10) : '—'}</td>
                      <td className={`px-4 py-3 font-medium ${expired ? 'text-red-600' : expiringSoon ? 'text-amber-600' : 'text-gray-600'}`}>
                        {s.end_date ? String(s.end_date).slice(0, 10) : '—'}
                        {expired      && <span className="ml-1.5 rounded-full bg-red-100 text-red-600 px-1.5 py-0.5 text-xs">expired</span>}
                        {expiringSoon && <span className="ml-1.5 rounded-full bg-amber-100 text-amber-600 px-1.5 py-0.5 text-xs">soon</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-gray-700">
                        {s.amount_paid != null ? formatCurrency(s.amount_paid) : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{s.recorded_by || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {pages > 1 && (
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>Page {page} of {pages} · {total} records</span>
          <div className="flex gap-1">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
              className="rounded border px-3 py-1.5 disabled:opacity-40 hover:bg-gray-50">Prev</button>
            <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)}
              className="rounded border px-3 py-1.5 disabled:opacity-40 hover:bg-gray-50">Next</button>
          </div>
        </div>
      )}

      {recordOpen && (
        <RecordSubscriptionModal
          companyId={companyId || undefined}
          companies={companyId ? [] : companies}
          plans={plansData}
          onClose={() => setRecordOpen(false)}
        />
      )}

      {approving && (
        <ApproveRequestModal
          request={approving}
          plans={plansData}
          onClose={() => setApproving(null)}
        />
      )}

      {rejecting && (
        <RejectRequestModal
          request={rejecting}
          onClose={() => setRejecting(null)}
        />
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'companies',     label: 'Companies',     Icon: Building2    },
  { id: 'plans',         label: 'Plans',         Icon: CreditCard   },
  { id: 'users',         label: 'Users',         Icon: Users        },
  { id: 'branches',      label: 'Branches',      Icon: GitBranch    },
  { id: 'terminals',     label: 'Terminals',     Icon: Monitor      },
  { id: 'sessions',      label: 'Sessions',      Icon: Layers       },
  { id: 'pricing',       label: 'Pricing',       Icon: DollarSign   },
  { id: 'sales',         label: 'Sales',         Icon: ShoppingCart },
  { id: 'products',      label: 'Products',      Icon: Package      },
  { id: 'inventory',     label: 'Inventory',     Icon: BarChart2    },
  { id: 'customers',     label: 'Customers',     Icon: UserCheck    },
  { id: 'mpesa',         label: 'M-Pesa',        Icon: Smartphone   },
  { id: 'mpesa-config',  label: 'M-Pesa Config', Icon: Settings     },
  { id: 'payments',      label: 'Payments',      Icon: CreditCard   },
  { id: 'suppliers',     label: 'Suppliers',     Icon: Truck        },
  { id: 'purchases',     label: 'Purchases',     Icon: ShoppingCart },
  { id: 'ap-payments',   label: 'AP Payments',   Icon: DollarSign   },
  { id: 'accounts',      label: 'Accounts',      Icon: BookOpen     },
  { id: 'bank-accounts', label: 'Bank Accounts', Icon: Landmark     },
  { id: 'journals',      label: 'Journals',      Icon: ScrollText   },
  { id: 'reports',         label: 'Reports',       Icon: FileText     },
  { id: 'subscriptions',   label: 'Subscriptions', Icon: CalendarRange },
];

const TAB_BY_ID = Object.fromEntries(TABS.map((t) => [t.id, t]));

export default function AdminPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => {
    const t = searchParams.get('tab');
    return TABS.some((tab) => tab.id === t) ? t : 'companies';
  });
  const qc = useQueryClient();

  useEffect(() => {
    const t = searchParams.get('tab');
    if (t && TABS.some((tab) => tab.id === t) && t !== activeTab) {
      setActiveTab(t);
    }
  }, [searchParams]);

  const { data: plans = [] } = useQuery({
    queryKey: ['subscription-plans'],
    queryFn: () => api.get('/companies/plans').then((r) => r.data.data),
  });

  const { data: companiesForFilter = [] } = useQuery({
    queryKey: ['platform-companies-list'],
    queryFn: () => api.get('/platform/companies', { params: { limit: 200 } })
      .then((r) => r.data.data?.companies ?? r.data.data?.rows ?? []),
    staleTime: 60_000,
  });

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div>
        <h2 className="text-lg font-bold text-gray-900">{TAB_BY_ID[activeTab]?.label ?? 'Admin'}</h2>
        <p className="text-sm text-gray-400 mt-0.5">
          {activeTab === 'companies'      ? 'Manage all tenants, subscriptions, and platform health'
            : activeTab === 'plans'       ? 'Define subscription tiers and feature access'
            : activeTab === 'users'       ? 'View and manage users across all tenants'
            : activeTab === 'branches'    ? 'View and manage branches across all companies'
            : activeTab === 'sessions'    ? 'Monitor and force-close POS sessions'
            : activeTab === 'terminals'   ? 'Manage POS terminals across all companies'
            : activeTab === 'sales'       ? 'Browse transactions across all tenants'
            : activeTab === 'mpesa'       ? 'View M-Pesa transactions across all tenants'
            : activeTab === 'mpesa-config'? 'View and manage M-Pesa configurations across all tenants'
            : activeTab === 'reports'     ? 'View and export reports for any tenant'
            : activeTab === 'payments'    ? 'View payment methods configured per company'
            : activeTab === 'pricing'     ? 'Manage per-branch product pricing overrides'
            : activeTab === 'products'    ? 'View and manage products across all tenants'
            : activeTab === 'inventory'   ? 'Monitor stock levels across all companies'
            : activeTab === 'customers'   ? 'View and manage customers across all tenants'
            : activeTab === 'suppliers'   ? 'View suppliers registered across all tenants'
            : activeTab === 'purchases'   ? 'Browse purchase orders across all tenants'
            : activeTab === 'ap-payments' ? 'View supplier payments across all tenants'
            : activeTab === 'accounts'    ? 'View chart of accounts across all tenants'
            : activeTab === 'bank-accounts' ? 'View bank accounts registered across all tenants'
            : activeTab === 'journals'       ? 'Browse journal entries across all tenants'
            : activeTab === 'subscriptions'  ? 'Track and record subscription payments per company'
            : ''}
        </p>
      </div>

      {/* Tab panels */}
      {activeTab === 'companies' && <CompaniesPanel plans={plans} />}
      {activeTab === 'plans'     && <PlansPanel />}
      {activeTab === 'users'     && <UsersPanel companies={companiesForFilter} />}
      {activeTab === 'branches'  && <BranchesPanel companies={companiesForFilter} />}
      {activeTab === 'terminals' && <TerminalsPanel companies={companiesForFilter} />}
      {activeTab === 'sessions'  && <SessionsPanel companies={companiesForFilter} />}
      {activeTab === 'pricing'   && <PricingPanel companies={companiesForFilter} />}
      {activeTab === 'sales'     && <SalesPanel companies={companiesForFilter} />}
      {activeTab === 'products'  && <ProductsPanel companies={companiesForFilter} />}
      {activeTab === 'inventory' && <InventoryPanel companies={companiesForFilter} />}
      {activeTab === 'customers' && <CustomersPanel companies={companiesForFilter} />}
      {activeTab === 'mpesa'         && <MpesaPanel        companies={companiesForFilter} />}
      {activeTab === 'mpesa-config'  && <MpesaConfigPanel  companies={companiesForFilter} />}
      {activeTab === 'reports'       && <ReportsPanel      companies={companiesForFilter} />}
      {activeTab === 'payments'      && <PaymentsPanel     companies={companiesForFilter} />}
      {activeTab === 'suppliers'     && <SuppliersPanel    companies={companiesForFilter} />}
      {activeTab === 'purchases'     && <PurchasesPanel    companies={companiesForFilter} />}
      {activeTab === 'ap-payments'   && <ApPaymentsPanel   companies={companiesForFilter} />}
      {activeTab === 'accounts'      && <AccountsPanel     companies={companiesForFilter} />}
      {activeTab === 'bank-accounts' && <BankAccountsPanel companies={companiesForFilter} />}
      {activeTab === 'journals'       && <JournalsPanel      companies={companiesForFilter} />}
      {activeTab === 'subscriptions'  && <SubscriptionsPanel companies={companiesForFilter} />}
    </div>
  );
}
