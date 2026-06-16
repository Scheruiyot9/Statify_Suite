import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, UserCheck, UserX, KeyRound, Search, ShieldCheck, Copy, ShieldOff, Trash2, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/services/api';
import Button      from '@/components/ui/Button';
import Modal       from '@/components/ui/Modal';
import { PageSpinner } from '@/components/ui/Spinner';
import { usePermission } from '@/hooks/usePermission';
import { useAuthStore }  from '@/app/store';

// ── Helpers ───────────────────────────────────────────────────────────────────
const ROLE_COLORS = {
  company_admin:  'bg-purple-100 text-purple-700',
  branch_manager: 'bg-blue-100 text-blue-700',
  cashier:        'bg-green-100 text-green-700',
  accountant:     'bg-teal-100 text-teal-700',
};

function RoleBadge({ role }) {
  const cls = ROLE_COLORS[role] || 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {role?.replace(/_/g, ' ')}
    </span>
  );
}

// ── Temp Password Modal ───────────────────────────────────────────────────────
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

// ── Clear PIN Modal ───────────────────────────────────────────────────────────
function ClearPinModal({ user, onClose }) {
  const qc = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.post(`/users/${user.user_id}/clear-pin`),
    onSuccess: () => {
      toast.success(`PIN cleared for ${user.first_name} ${user.last_name}`);
      qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to clear PIN'),
  });

  return (
    <Modal open onClose={onClose} title="Reset Terminal PIN" size="sm">
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg bg-amber-50 border border-amber-100 px-4 py-3">
          <ShieldOff className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-800">
              Clear PIN for {user.first_name} {user.last_name}?
            </p>
            <p className="text-xs text-amber-600 mt-0.5">
              Their terminal PIN will be removed. The next time their screen locks
              they will need to sign in with their password and set a new PIN.
            </p>
          </div>
        </div>
        <div className="flex gap-3 pt-1">
          <Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button>
          <Button fullWidth loading={isPending} onClick={() => mutate()}>
            Clear PIN
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── User Form Modal ───────────────────────────────────────────────────────────
function UserForm({ user, onClose }) {
  const qc = useQueryClient();
  const isEdit = !!user;

  const [tempPassword, setTempPassword] = useState(null);
  const [createdUser, setCreatedUser]   = useState(null);

  const [form, setForm] = useState({
    first_name: user?.first_name ?? '',
    last_name:  user?.last_name  ?? '',
    email:      user?.email      ?? '',
    phone:      user?.phone      ?? '',
    role_id:    user?.role_id    ?? '',
    branch_id:  user?.branch_id  ?? '',
    is_active:  user?.is_active  ?? true,
    password:   '',
  });

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none';

  const { data: roles    = [] } = useQuery({ queryKey: ['roles'],    queryFn: () => api.get('/users/roles').then((r) => r.data.data) });
  const { data: branches = [] } = useQuery({ queryKey: ['branches'], queryFn: () => api.get('/branches').then((r) => r.data.data) });

  const { mutate, isPending } = useMutation({
    mutationFn: (data) =>
      isEdit
        ? api.put(`/users/${user.user_id}`, data)
        : api.post('/users', data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['users'] });
      if (!isEdit && res.data.data?.temp_password) {
        setCreatedUser({ name: `${form.first_name} ${form.last_name}`.trim(), email: form.email });
        setTempPassword(res.data.data.temp_password);
      } else {
        toast.success(isEdit ? 'User updated' : 'User created');
        onClose();
      }
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Save failed'),
  });

  const handleSubmit = () => {
    if (!form.first_name.trim())           { toast.error('First name is required'); return; }
    if (!isEdit && !form.email.trim())     { toast.error('Email is required'); return; }
    if (!form.role_id)                     { toast.error('Role is required'); return; }

    const payload = { ...form };
    if (!payload.email?.trim()) delete payload.email; // skip blank (keeps existing on edit)
    if (!payload.password) delete payload.password;
    mutate(payload);
  };

  return (
    <>
    <Modal
      open
      onClose={onClose}
      title={isEdit ? `Edit: ${user.first_name} ${user.last_name}` : 'New User'}
      size="sm"
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button>
          <Button fullWidth loading={isPending} onClick={handleSubmit}>
            {isEdit ? 'Save Changes' : 'Create User'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {/* Name row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">First Name *</label>
            <input value={form.first_name} onChange={(e) => set('first_name', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Last Name</label>
            <input value={form.last_name} onChange={(e) => set('last_name', e.target.value)} className={inputCls} />
          </div>
        </div>

        {/* Email */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Email {isEdit ? <span className="text-gray-400 font-normal">(change to update login address)</span> : '*'}
          </label>
          <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} className={inputCls} />
        </div>

        {/* Phone */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Phone</label>
          <input value={form.phone} onChange={(e) => set('phone', e.target.value)} className={inputCls} />
        </div>

        {/* Role — always shown */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Role *</label>
          <select value={form.role_id} onChange={(e) => set('role_id', e.target.value)} className={inputCls}>
            <option value="">Select role…</option>
            {roles.map((r) => (
              <option key={r.role_id} value={r.role_id}>{r.role_name.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>

        {/* Branch — always shown */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Primary Branch</label>
          <select value={form.branch_id} onChange={(e) => set('branch_id', e.target.value)} className={inputCls}>
            <option value="">— No branch —</option>
            {branches.map((b) => (
              <option key={b.branch_id} value={b.branch_id}>{b.branch_name}</option>
            ))}
          </select>
        </div>

        {/* Status — edit only */}
        {isEdit && (
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Status</label>
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm font-medium">
              {[{ label: 'Active', value: true }, { label: 'Inactive', value: false }].map(({ label, value }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => set('is_active', value)}
                  className={`flex-1 py-2 transition-colors ${
                    form.is_active === value
                      ? value ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
                      : 'text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Temporary password — create only */}
        {!isEdit && (
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Temporary Password</label>
            <input type="password" value={form.password} onChange={(e) => set('password', e.target.value)}
              placeholder="Leave blank to auto-generate"
              className={inputCls} />
          </div>
        )}
      </div>
    </Modal>
    {tempPassword && (
      <TempPasswordModal
        name={createdUser?.name}
        email={createdUser?.email}
        password={tempPassword}
        onClose={() => { setTempPassword(null); onClose(); }}
      />
    )}
    </>
  );
}

// ── Reset Password Modal ──────────────────────────────────────────────────────
function ResetPasswordModal({ user, onClose }) {
  const [pwd, setPwd] = useState('');

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.post(`/users/${user.user_id}/reset-password`, { newPassword: pwd }),
    onSuccess:  () => { toast.success('Password reset'); onClose(); },
    onError:    (err) => toast.error(err.response?.data?.message || 'Reset failed'),
  });

  return (
    <Modal
      open onClose={onClose} title="Reset Password" size="sm"
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button>
          <Button fullWidth loading={isPending} onClick={() => mutate()} disabled={pwd.length < 8}>Reset</Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-gray-600">Set a new password for <span className="font-semibold">{user.first_name} {user.last_name}</span>.</p>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">New Password (min 8 characters)</label>
          <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
        </div>
      </div>
    </Modal>
  );
}

// ── Delete User Modal ─────────────────────────────────────────────────────────
function DeleteUserModal({ user, onClose }) {
  const qc = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.delete(`/users/${user.user_id}`),
    onSuccess: () => {
      toast.success(`${user.first_name} ${user.last_name} deleted`);
      qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Delete failed'),
  });

  return (
    <Modal open onClose={onClose} title="Delete User" size="sm"
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button>
          <Button variant="danger" fullWidth loading={isPending} onClick={() => mutate()}>Delete</Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex items-start gap-3 rounded-lg bg-red-50 border border-red-100 px-4 py-3">
          <Trash2 className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-red-800">
              Delete {user.first_name} {user.last_name}?
            </p>
            <p className="text-xs text-red-600 mt-0.5">
              This user will be deactivated and removed from the system. This action cannot be undone.
            </p>
          </div>
        </div>
        <p className="text-xs text-gray-500">Email: <span className="font-medium text-gray-700">{user.email}</span></p>
      </div>
    </Modal>
  );
}

// ── Roles & Permissions Tab ───────────────────────────────────────────────────

const MODULE_ORDER = [
  'sales', 'pos', 'returns', 'inventory', 'products', 'customers',
  'reports', 'users', 'settings', 'finance', 'shifts', 'mpesa',
];

function RolesTab() {
  const { data: roles = [], isLoading } = useQuery({
    queryKey: ['roles-with-permissions'],
    queryFn:  () => api.get('/users/roles/permissions').then((r) => r.data.data),
  });

  if (isLoading) return <PageSpinner />;

  if (!roles.length) return (
    <div className="rounded-xl border border-gray-100 bg-white p-12 text-center text-gray-400 shadow-sm">
      <ShieldCheck className="mx-auto mb-2 h-8 w-8 opacity-30" />
      No roles found.
    </div>
  );

  // Collect all unique modules across all roles
  const allModules = [];
  const seenMods = new Set();
  for (const mod of MODULE_ORDER) {
    for (const role of roles) {
      if (role.permissions.some((p) => p.module_name === mod) && !seenMods.has(mod)) {
        seenMods.add(mod);
        allModules.push(mod);
      }
    }
  }
  // Add any remaining modules not in MODULE_ORDER
  for (const role of roles) {
    for (const p of role.permissions) {
      if (!seenMods.has(p.module_name)) {
        seenMods.add(p.module_name);
        allModules.push(p.module_name);
      }
    }
  }

  // Build a nested map: module -> permission_name -> roleId -> { code, flags }
  const matrix = {}; // { [module]: { [permission_code]: { permission_name, [roleId]: flags } } }
  for (const role of roles) {
    for (const p of role.permissions) {
      if (!matrix[p.module_name]) matrix[p.module_name] = {};
      if (!matrix[p.module_name][p.permission_code]) {
        matrix[p.module_name][p.permission_code] = { permission_name: p.permission_name };
      }
      matrix[p.module_name][p.permission_code][role.role_id] = {
        can_read: p.can_read, can_create: p.can_create,
        can_update: p.can_update, can_delete: p.can_delete, can_export: p.can_export,
      };
    }
  }

  const flagLabel = { can_read: 'R', can_create: 'C', can_update: 'U', can_delete: 'D', can_export: 'X' };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Roles & Permissions</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Read-only view of what each role can do. <span className="font-mono text-xs">R</span>=Read&nbsp;
          <span className="font-mono text-xs">C</span>=Create&nbsp;
          <span className="font-mono text-xs">U</span>=Update&nbsp;
          <span className="font-mono text-xs">D</span>=Delete&nbsp;
          <span className="font-mono text-xs">X</span>=Export
        </p>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="px-4 py-3 text-left font-medium text-gray-600 min-w-[200px]">Permission</th>
              {roles.map((r) => (
                <th key={r.role_id} className="px-3 py-3 text-center font-medium text-gray-600 min-w-[90px]">
                  <span className="capitalize">{r.role_name.replace(/_/g, ' ')}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allModules.map((mod) => {
              const permCodes = Object.keys(matrix[mod] ?? {});
              if (!permCodes.length) return null;
              return (
                <>
                  {/* Module header row */}
                  <tr key={`mod-${mod}`} className="bg-primary-50/60 border-t border-b border-gray-100">
                    <td colSpan={roles.length + 1} className="px-4 py-1.5">
                      <span className="text-xs font-bold uppercase tracking-widest text-primary-600">
                        {mod}
                      </span>
                    </td>
                  </tr>
                  {permCodes.map((code) => {
                    const row = matrix[mod][code];
                    return (
                      <tr key={code} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-2 text-gray-700">
                          {row.permission_name}
                          <span className="ml-1.5 font-mono text-gray-400">({code})</span>
                        </td>
                        {roles.map((r) => {
                          const flags = row[r.role_id];
                          if (!flags) {
                            return (
                              <td key={r.role_id} className="px-3 py-2 text-center text-gray-200">—</td>
                            );
                          }
                          const active = Object.entries(flagLabel)
                            .filter(([k]) => flags[k])
                            .map(([, v]) => v);
                          return (
                            <td key={r.role_id} className="px-3 py-2 text-center">
                              <div className="flex items-center justify-center gap-0.5">
                                {active.map((lbl) => (
                                  <span key={lbl} className="inline-flex h-5 w-5 items-center justify-center rounded bg-primary-100 font-bold text-primary-700">
                                    {lbl}
                                  </span>
                                ))}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── User Detail Modal ─────────────────────────────────────────────────────────
function UserDetailModal({ user: u, onClose, onEdit, onReset, onClearPin, onToggleActive }) {
  return (
    <Modal
      open
      onClose={onClose}
      title={`${u.first_name} ${u.last_name}`}
      footer={
        <div className="flex gap-3 w-full">
          <Button fullWidth variant="secondary" onClick={onClose}>Close</Button>
          <Button fullWidth icon={<Edit2 className="h-4 w-4" />} onClick={onEdit}>Edit</Button>
        </div>
      }
    >
      <dl className="space-y-3 text-sm">
        <div className="flex justify-between">
          <dt className="text-gray-500">Email</dt>
          <dd className="font-medium text-gray-900">{u.email}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-500">Role</dt>
          <dd><RoleBadge role={u.role_name} /></dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-500">Branch</dt>
          <dd className="font-medium text-gray-900">{u.branch_name || '—'}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-500">Status</dt>
          <dd>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
              u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}>
              {u.is_active ? 'Active' : 'Inactive'}
            </span>
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-500">Last Login</dt>
          <dd className="text-gray-700">
            {u.last_login
              ? new Date(u.last_login).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })
              : 'Never'}
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex gap-2 border-t border-gray-100 pt-4">
        <button
          onClick={onReset}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <KeyRound className="h-3.5 w-3.5" />
          Reset Password
        </button>
        <button
          onClick={onClearPin}
          className="flex items-center gap-1.5 rounded-lg border border-purple-200 px-3 py-1.5 text-xs font-medium text-purple-600 hover:bg-purple-50 transition-colors"
        >
          <ShieldOff className="h-3.5 w-3.5" />
          Reset PIN
        </button>
        <button
          onClick={onToggleActive}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
            u.is_active
              ? 'border-red-200 text-red-600 hover:bg-red-50'
              : 'border-green-200 text-green-600 hover:bg-green-50'
          }`}
        >
          {u.is_active ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
          {u.is_active ? 'Deactivate' : 'Activate'}
        </button>
      </div>
    </Modal>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
function UsersListTab({ canManageUsers }) {
  const qc = useQueryClient();
  const [search,       setSearch]       = useState('');
  const [formUser,     setFormUser]     = useState(null);  // null=closed, false=new, obj=edit
  const [resetUser,    setResetUser]    = useState(null);
  const [clearPinUser, setClearPinUser] = useState(null);
  const [deleteUser,   setDeleteUser]   = useState(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['users', search],
    queryFn:  () => api.get('/users', { params: { search, limit: 50 } }).then((r) => r.data.data),
    placeholderData: (prev) => prev,
  });

  const { mutate: toggleActive } = useMutation({
    mutationFn: ({ userId, is_active }) => api.put(`/users/${userId}`, { is_active }),
    onSuccess:  () => { toast.success('User updated'); qc.invalidateQueries({ queryKey: ['users'] }); },
    onError:    (err) => toast.error(err.response?.data?.message || 'Update failed'),
  });

  const users = data?.users ?? [];

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="flex gap-3 rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>
        <Button variant="secondary" size="sm"
          icon={<RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />}
          onClick={() => refetch()}>
          Refresh
        </Button>
        {canManageUsers && (
          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setFormUser(false)}>
            New User
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="py-16 text-center text-sm text-gray-400">Loading…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Name</th>
                  <th className="hidden sm:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Role</th>
                  <th className="hidden md:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500">Branch</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Status</th>
                  <th className="hidden md:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500">Last Login</th>
                  {canManageUsers && <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {users.length === 0 ? (
                  <tr><td colSpan={canManageUsers ? 7 : 6} className="py-12 text-center text-sm text-gray-400">No users found</td></tr>
                ) : users.map((u) => (
                  <tr key={u.user_id} className="hover:bg-gray-50 active:bg-gray-100 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {u.first_name} {u.last_name}
                    </td>
                    <td className="hidden sm:table-cell px-4 py-3 text-gray-500">{u.email}</td>
                    <td className="px-4 py-3"><RoleBadge role={u.role_name} /></td>
                    <td className="hidden md:table-cell px-4 py-3 text-gray-500">{u.branch_name || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {u.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="hidden md:table-cell px-4 py-3 text-gray-400 text-xs">
                      {u.last_login ? new Date(u.last_login).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Never'}
                    </td>
                    {canManageUsers && (
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1.5">
                          <button title="Edit" onClick={() => setFormUser(u)}
                            className="rounded-md bg-gray-100 p-1.5 text-gray-600 hover:bg-gray-200 transition-colors">
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button title="Reset password" onClick={() => setResetUser(u)}
                            className="rounded-md bg-blue-50 p-1.5 text-blue-600 hover:bg-blue-100 transition-colors">
                            <KeyRound className="h-3.5 w-3.5" />
                          </button>
                          <button title="Reset terminal PIN" onClick={() => setClearPinUser(u)}
                            className="rounded-md bg-purple-50 p-1.5 text-purple-600 hover:bg-purple-100 transition-colors">
                            <ShieldOff className="h-3.5 w-3.5" />
                          </button>
                          <button
                            title={u.is_active ? 'Deactivate' : 'Activate'}
                            onClick={() => toggleActive({ userId: u.user_id, is_active: !u.is_active })}
                            className={`rounded-md p-1.5 transition-colors ${u.is_active
                              ? 'bg-red-50 text-red-600 hover:bg-red-100'
                              : 'bg-green-50 text-green-600 hover:bg-green-100'}`}>
                            {u.is_active ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                          </button>
                          <button title="Delete user" onClick={() => setDeleteUser(u)}
                            className="rounded-md bg-red-50 p-1.5 text-red-600 hover:bg-red-100 transition-colors">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      {canManageUsers && formUser !== null && (
        <UserForm user={formUser || null} onClose={() => setFormUser(null)} />
      )}
      {canManageUsers && resetUser && (
        <ResetPasswordModal user={resetUser} onClose={() => setResetUser(null)} />
      )}
      {canManageUsers && clearPinUser && (
        <ClearPinModal user={clearPinUser} onClose={() => setClearPinUser(null)} />
      )}
      {canManageUsers && deleteUser && (
        <DeleteUserModal user={deleteUser} onClose={() => setDeleteUser(null)} />
      )}
    </div>
  );
}

export default function UsersPage() {
  const { hasCapability } = usePermission();
  const canManageUsers = hasCapability('users.manage');
  const user = useAuthStore((s) => s.user);
  const isCompanyAdmin = user?.role === 'company_admin';
  const [activeTab, setActiveTab] = useState('users');

  const TABS = [
    { id: 'users', label: 'Users', Icon: UserCheck },
    ...(!isCompanyAdmin ? [{ id: 'roles', label: 'Roles & Permissions', Icon: ShieldCheck }] : []),
  ];

  return (
    <div className="space-y-4">
      {/* Tabs — only shown when there are multiple */}
      {TABS.length > 1 && (
        <div className="flex border-b border-gray-200">
          {TABS.map(({ id, label, Icon }) => (
            <button key={id} onClick={() => setActiveTab(id)}
              className={[
                'flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors',
                activeTab === id
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
              ].join(' ')}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      )}

      {activeTab === 'users' && <UsersListTab canManageUsers={canManageUsers} />}
      {activeTab === 'roles' && !isCompanyAdmin && <RolesTab />}
    </div>
  );
}
