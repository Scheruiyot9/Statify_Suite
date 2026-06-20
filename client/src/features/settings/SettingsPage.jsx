import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CreditCard, Plus, Pencil, ToggleLeft, ToggleRight, Check,
  Monitor, GitBranch, Package, Users, Star, Percent, Trash2,
  RotateCcw, Layers, ArrowUpCircle, CheckCircle2, Clock, XCircle, Send, ShieldCheck, BookOpen,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/services/api';
import { useAuthStore } from '@/app/store';
import Modal  from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { PageSpinner } from '@/components/ui/Spinner';

// ── Payment Methods Tab ───────────────────────────────────────────────────────

function PayModeForm({ initial, bankAccounts, onSave, onClose, isPending }) {
  const [name,          setName]          = useState(initial?.method_name       ?? '');
  const [requireRef,    setRequireRef]    = useState(initial?.requires_reference ?? false);
  const [bankAccountId, setBankAccountId] = useState(initial?.bank_account_id   ?? '');

  const valid = name.trim().length >= 2;

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Method Name *</label>
        <input
          type="text" value={name} onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Cash, M-Pesa, Card, Cheque…"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
      </div>
      <label className="flex items-center gap-3 cursor-pointer">
        <span className="text-sm text-gray-700">Requires reference number</span>
        <button type="button" onClick={() => setRequireRef(!requireRef)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${requireRef ? 'bg-primary-600' : 'bg-gray-300'}`}>
          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${requireRef ? 'translate-x-4' : 'translate-x-1'}`} />
        </button>
        <span className="text-xs text-gray-400">{requireRef ? 'Yes (M-Pesa code, card approval #, etc.)' : 'No'}</span>
      </label>
      {bankAccounts.length > 0 && (
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Linked Bank Account <span className="text-gray-400">(optional)</span></label>
          <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:border-primary-500 focus:outline-none">
            <option value="">— None —</option>
            {bankAccounts.map((b) => (
              <option key={b.bank_account_id} value={b.bank_account_id}>
                {b.account_name} — {b.bank_name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-400">Funds collected via this payment method will be tracked to this account.</p>
        </div>
      )}
      <div className="flex gap-3 pt-2">
        <Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button>
        <Button fullWidth disabled={!valid} loading={isPending}
          onClick={() => onSave({ methodName: name.trim(), requiresReference: requireRef, bankAccountId: bankAccountId || null })}>
          {initial ? 'Save Changes' : 'Add Pay Mode'}
        </Button>
      </div>
    </div>
  );
}

function PayModesTab() {
  const qc = useQueryClient();
  const [addOpen,    setAddOpen]    = useState(false);
  const [editMode,   setEditMode]   = useState(null);
  const [confirmDel, setConfirmDel] = useState(null); // method object to delete

  const companyId  = useAuthStore((s) => s.user?.companyId);
  const hasFinance = useAuthStore((s) => !!s.user?.planFeatures?.hasFinance);

  const { data: methods = [], isLoading } = useQuery({
    queryKey: ['payment-methods-all', companyId],
    queryFn:  () => api.get('/pos/payment-methods', { params: { all: 'true' } }).then((r) => r.data.data),
  });

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn:  () => api.get('/bank-accounts').then((r) => r.data.data ?? []),
    enabled:  hasFinance,
  });

  const createMut = useMutation({
    mutationFn: (body) => api.post('/pos/payment-methods', body),
    onSuccess: () => {
      toast.success('Pay mode added');
      qc.invalidateQueries(['payment-methods-all']);
      qc.invalidateQueries(['payment-methods']);
      setAddOpen(false);
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed to add pay mode'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }) => api.patch(`/pos/payment-methods/${id}`, body),
    onSuccess: () => {
      toast.success('Pay mode updated');
      qc.invalidateQueries(['payment-methods-all']);
      qc.invalidateQueries(['payment-methods']);
      setEditMode(null);
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed to update'),
  });

  const deleteMut = useMutation({
    mutationFn: (id) => api.delete(`/pos/payment-methods/${id}`),
    onSuccess: () => {
      toast.success('Payment method deleted');
      qc.invalidateQueries(['payment-methods-all']);
      qc.invalidateQueries(['payment-methods']);
      setConfirmDel(null);
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Cannot delete this payment method'),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }) => api.patch(`/pos/payment-methods/${id}`, { isActive }),
    onSuccess: () => {
      toast.success('Pay mode updated');
      qc.invalidateQueries(['payment-methods-all']);
      qc.invalidateQueries(['payment-methods']);
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed to update'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Payment Methods</h2>
        <Button icon={<Plus className="h-4 w-4" />} size="sm" onClick={() => setAddOpen(true)}>
          Add Pay Mode
        </Button>
      </div>

      {isLoading ? <PageSpinner /> : (
        <div className="rounded-xl border border-gray-100 bg-white overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Method Name</th>
                  {hasFinance && <th className="hidden md:table-cell px-4 py-3 text-left font-medium text-gray-600">Bank Account</th>}
                  <th className="hidden sm:table-cell px-4 py-3 text-center font-medium text-gray-600">Requires Ref #</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-600">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {methods.map((m) => (
                  <tr key={m.payment_method_id} className={`hover:bg-gray-50 active:bg-gray-100 transition-colors ${!m.is_active ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-100">
                          <CreditCard className="h-4 w-4 text-primary-600" />
                        </div>
                        <span className="font-medium text-gray-900">{m.method_name}</span>
                      </div>
                    </td>
                    {hasFinance && (
                      <td className="hidden md:table-cell px-4 py-3 text-sm text-gray-500">
                        {m.bank_account_name
                          ? <span className="font-medium text-gray-700">{m.bank_account_name}<span className="ml-1 text-xs font-normal text-gray-400">— {m.bank_name}</span></span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                    )}
                    <td className="hidden sm:table-cell px-4 py-3 text-center">
                      {m.requires_reference
                        ? <span className="inline-flex items-center gap-1 text-green-600 text-xs font-medium"><Check className="h-3 w-3" /> Yes</span>
                        : <span className="text-gray-400 text-xs">No</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => toggleMut.mutate({ id: m.payment_method_id, isActive: !m.is_active })}
                        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors">
                        {m.is_active
                          ? <><ToggleRight className="h-4 w-4 text-green-500" /><span className="text-green-700">Active</span></>
                          : <><ToggleLeft  className="h-4 w-4 text-gray-400" /><span className="text-gray-500">Inactive</span></>}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setEditMode(m)}
                          className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-primary-600 transition-colors">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button onClick={() => setConfirmDel(m)}
                          className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {methods.length === 0 && (
                  <tr>
                    <td colSpan={hasFinance ? 5 : 4} className="py-12 text-center text-gray-400">
                      <CreditCard className="mx-auto mb-2 h-8 w-8 opacity-30" />
                      No payment methods yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Pay Mode" size="sm">
        <PayModeForm bankAccounts={bankAccounts} onSave={(body) => createMut.mutate(body)} onClose={() => setAddOpen(false)} isPending={createMut.isPending} />
      </Modal>
      <Modal open={!!editMode} onClose={() => setEditMode(null)} title="Edit Pay Mode" size="sm">
        <PayModeForm initial={editMode} bankAccounts={bankAccounts}
          onSave={(body) => updateMut.mutate({ id: editMode?.payment_method_id, body })}
          onClose={() => setEditMode(null)} isPending={updateMut.isPending} />
      </Modal>

      <Modal open={!!confirmDel} onClose={() => setConfirmDel(null)} title="Delete Payment Method" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Are you sure you want to delete <span className="font-semibold text-gray-900">{confirmDel?.method_name}</span>?
            This cannot be undone. If the method has been used in transactions, deletion will be blocked — deactivate it instead.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmDel(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => deleteMut.mutate(confirmDel.payment_method_id)} isLoading={deleteMut.isPending}>
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── Terminals Tab ─────────────────────────────────────────────────────────────

function TerminalForm({ branches, initial, onSave, onClose, isPending }) {
  const [name,     setName]     = useState(initial?.terminal_name ?? '');
  const [code,     setCode]     = useState(initial?.terminal_code ?? '');
  const [desc,     setDesc]     = useState(initial?.description   ?? '');
  const [branchId, setBranchId] = useState(initial?.branch_id     ?? (branches[0]?.branch_id ?? ''));

  const isEdit = !!initial;
  const valid  = name.trim().length >= 2 && (isEdit || (code.trim().length >= 2 && branchId));

  const autoCode = (rawName) => {
    const slug = rawName.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    setCode(slug ? `TILL-${slug}` : '');
  };

  return (
    <div className="space-y-3">
      {!isEdit && (
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Branch *</label>
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none">
            <option value="">Select branch…</option>
            {branches.map((b) => <option key={b.branch_id} value={b.branch_id}>{b.branch_name}</option>)}
          </select>
        </div>
      )}
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Terminal Name *</label>
        <input value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!isEdit && !code) autoCode(e.target.value);
          }}
          placeholder="e.g. Counter 1, Drive-through Till"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
        />
      </div>
      {!isEdit && (
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Terminal Code *</label>
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="e.g. TILL-01"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-primary-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-400">Unique identifier per branch — used for session tracking</p>
        </div>
      )}
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Description</label>
        <input value={desc} onChange={(e) => setDesc(e.target.value)}
          placeholder="Optional notes about this terminal"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
        />
      </div>
      <div className="flex gap-3 pt-2">
        <Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button>
        <Button fullWidth disabled={!valid} loading={isPending}
          onClick={() => onSave({ terminalName: name.trim(), terminalCode: code.trim(), description: desc.trim() || null, branchId })}>
          {isEdit ? 'Save Changes' : 'Create Terminal'}
        </Button>
      </div>
    </div>
  );
}

function TerminalsTab() {
  const qc        = useQueryClient();
  const companyId = useAuthStore((s) => s.user?.companyId);
  const userRole  = useAuthStore((s) => s.user?.role);
  const isCompanyAdmin = userRole === 'company_admin';

  const [addOpen,    setAddOpen]    = useState(false);
  const [editTerm,   setEditTerm]   = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);

  // POS Behaviour state
  const [allowPriceEdit,         setAllowPriceEdit]         = useState(false);
  const [allowPartialQty,        setAllowPartialQty]        = useState(false);
  const [defaultScanMode,        setDefaultScanMode]        = useState(true);
  const [allowTotalEdit,         setAllowTotalEdit]         = useState(false);
  const [preventSalesBelowCost,  setPreventSalesBelowCost]  = useState(false);
  const [roundingMode,           setRoundingMode]           = useState('none');
  const [roundingUnit,           setRoundingUnit]           = useState(1);

  const { data: companyData } = useQuery({
    queryKey: ['company-mine', companyId],
    queryFn:  () => api.get('/companies/mine').then((r) => r.data.data),
    enabled:  !!companyId && isCompanyAdmin,
  });

  useEffect(() => {
    if (companyData) {
      setAllowPriceEdit(!!companyData.pos_allow_price_edit);
      setAllowPartialQty(!!companyData.pos_allow_partial_qty);
      setPreventSalesBelowCost(!!companyData.pos_prevent_sales_below_cost);
      setDefaultScanMode(companyData.pos_default_scan_mode !== false);
      setAllowTotalEdit(!!companyData.pos_allow_total_edit);
      setRoundingMode(companyData.pos_rounding_mode  || 'none');
      setRoundingUnit(parseFloat(companyData.pos_rounding_unit) || 1);
    }
  }, [companyData]);

  const savePosBehaviourMut = useMutation({
    mutationFn: (patch) => api.patch('/companies/mine/profile', patch).then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company-mine', companyId] });
      qc.invalidateQueries({ queryKey: ['my-company'] });
      toast.success('POS settings saved');
    },
  });

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn:  () => api.get('/branches').then((r) => r.data.data),
  });

  const { data: terminals = [], isLoading } = useQuery({
    queryKey: ['terminals-all'],
    queryFn:  () => api.get('/pos/terminals/all').then((r) => r.data.data),
  });

  const createMut = useMutation({
    mutationFn: (body) => api.post('/pos/terminals', body),
    onSuccess: () => {
      toast.success('Terminal created');
      qc.invalidateQueries(['terminals-all']);
      setAddOpen(false);
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Create failed'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }) => api.patch(`/pos/terminals/${id}`, body),
    onSuccess: () => {
      toast.success('Terminal updated');
      qc.invalidateQueries(['terminals-all']);
      setEditTerm(null);
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Update failed'),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }) => api.patch(`/pos/terminals/${id}`, { isActive }),
    onSuccess: () => {
      toast.success('Terminal updated');
      qc.invalidateQueries(['terminals-all']);
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Update failed'),
  });

  const termDeleteMut = useMutation({
    mutationFn: (id) => api.delete(`/pos/terminals/${id}`),
    onSuccess: () => {
      toast.success('Terminal deleted');
      qc.invalidateQueries(['terminals-all']);
      setConfirmDel(null);
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Cannot delete this terminal'),
  });

  // Group by branch for display
  const byBranch = terminals.reduce((acc, t) => {
    const key = t.branch_name;
    if (!acc[key]) acc[key] = [];
    acc[key].push(t);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">POS Terminals</h2>
        <Button icon={<Plus className="h-4 w-4" />} size="sm" onClick={() => setAddOpen(true)}>
          Add Terminal
        </Button>
      </div>

      {isLoading ? <PageSpinner /> : (
        terminals.length === 0 ? (
          <div className="rounded-xl border border-gray-100 bg-white py-14 text-center shadow-sm">
            <Monitor className="mx-auto mb-2 h-8 w-8 text-gray-300" />
            <p className="text-sm text-gray-400">No terminals configured. Add one to get started.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(byBranch).map(([branchName, terms]) => (
              <div key={branchName} className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
                {/* Branch header */}
                <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-4 py-2.5">
                  <GitBranch className="h-3.5 w-3.5 text-gray-400" />
                  <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{branchName}</span>
                  <span className="ml-auto text-xs text-gray-400">{terms.length} terminal{terms.length !== 1 ? 's' : ''}</span>
                </div>

                <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-50">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Name</th>
                      <th className="hidden sm:table-cell px-4 py-2.5 text-left text-xs font-medium text-gray-500">Code</th>
                      <th className="hidden md:table-cell px-4 py-2.5 text-left text-xs font-medium text-gray-500">Description</th>
                      <th className="hidden md:table-cell px-4 py-2.5 text-center text-xs font-medium text-gray-500">Sessions</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {terms.map((t) => (
                      <tr key={t.terminal_id} className="hover:bg-gray-50 active:bg-gray-100 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-100">
                              <Monitor className="h-3.5 w-3.5 text-primary-600" />
                            </div>
                            <span className="font-medium text-gray-900">{t.terminal_name}</span>
                          </div>
                        </td>
                        <td className="hidden sm:table-cell px-4 py-3 font-mono text-xs text-gray-500">{t.terminal_code}</td>
                        <td className="hidden md:table-cell px-4 py-3 text-gray-500">{t.description || <span className="text-gray-300">—</span>}</td>
                        <td className="hidden md:table-cell px-4 py-3 text-center text-gray-600">{t.session_count}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => setEditTerm(t)}
                              className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-primary-600 transition-colors"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => setConfirmDel(t)}
                              className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Terminal" size="sm">
        <TerminalForm
          branches={branches}
          onSave={(body) => createMut.mutate(body)}
          onClose={() => setAddOpen(false)}
          isPending={createMut.isPending}
        />
      </Modal>
      <Modal open={!!editTerm} onClose={() => setEditTerm(null)} title="Edit Terminal" size="sm">
        <TerminalForm
          branches={branches}
          initial={editTerm}
          onSave={(body) => updateMut.mutate({ id: editTerm?.terminal_id, body })}
          onClose={() => setEditTerm(null)}
          isPending={updateMut.isPending}
        />
      </Modal>

      <Modal open={!!confirmDel} onClose={() => setConfirmDel(null)} title="Delete Terminal" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Are you sure you want to delete terminal <span className="font-semibold text-gray-900">{confirmDel?.terminal_name}</span>?
            This cannot be undone. If the terminal has an open session, deletion will be blocked — close the session first.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmDel(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => termDeleteMut.mutate(confirmDel.terminal_id)} isLoading={termDeleteMut.isPending}>
              Delete
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── POS Behaviour ── */}
      {isCompanyAdmin && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-3 px-5 py-4 bg-gray-50 border-b border-gray-100">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50">
              <Monitor className="h-5 w-5 text-primary-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">POS Behaviour</p>
              <p className="text-xs text-gray-500 mt-0.5">Controls what cashiers can do at the point of sale.</p>
            </div>
          </div>

          {/* Toggle rows */}
          <div className="divide-y divide-gray-50">
            {[
              {
                label: 'Allow price editing on cart',
                desc:  'Cashiers can tap the unit price on any cart item to override it before checkout.',
                val: allowPriceEdit, set: setAllowPriceEdit, accent: 'primary',
              },
              {
                label: 'Partial quantity stepping (¼ units)',
                desc:  'The − button steps through 1 → 0.75 → 0.50 → 0.25. Useful for businesses that sell by weight or measure.',
                val: allowPartialQty, set: setAllowPartialQty, accent: 'primary',
              },
              {
                label: 'Allow editing the cart total',
                desc:  'Cashier can type a custom grand total; the difference is applied as an order discount.',
                val: allowTotalEdit, set: setAllowTotalEdit, accent: 'primary',
              },
              {
                label: 'Default to barcode scan mode',
                desc:  'When enabled, POS terminals open in scan mode. Disable to default to product search instead.',
                val: defaultScanMode, set: setDefaultScanMode, accent: 'primary',
              },
              {
                label: 'Prevent sales below purchase cost',
                desc:  'Cashiers cannot sell an item below its cost price. The POS will block checkout and warn when a price is set too low.',
                val: preventSalesBelowCost, set: setPreventSalesBelowCost, accent: 'red',
              },
            ].map(({ label, desc, val, set, accent }) => (
              <label key={label} className="flex items-center justify-between gap-4 px-5 py-3.5 cursor-pointer hover:bg-gray-50 transition-colors">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800">{label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
                </div>
                <div className="relative flex-shrink-0 ml-2">
                  <input type="checkbox" className="sr-only" checked={val} onChange={(e) => set(e.target.checked)} />
                  <div className={`h-5 w-9 rounded-full transition-colors ${val ? (accent === 'red' ? 'bg-red-500' : 'bg-primary-500') : 'bg-gray-200'}`} />
                  <div className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${val ? 'translate-x-4' : 'translate-x-0'}`} />
                </div>
              </label>
            ))}
          </div>

          {/* Price Rounding */}
          <div className="px-5 py-4 border-t border-gray-100 space-y-2">
            <div>
              <p className="text-sm font-medium text-gray-800">Price rounding</p>
              <p className="text-xs text-gray-500 mt-0.5">Auto-round the Amount Due at checkout. Cashiers can nudge amounts with ↑↓ buttons.</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={roundingMode}
                onChange={(e) => setRoundingMode(e.target.value)}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm focus:border-primary-500 focus:outline-none"
              >
                <option value="none">No rounding</option>
                <option value="nearest">Nearest</option>
                <option value="up">↑ Round Up</option>
                <option value="down">↓ Round Down</option>
              </select>
              {roundingMode !== 'none' && (
                <>
                  <input
                    type="number"
                    min="0.0001"
                    step="0.01"
                    value={roundingUnit}
                    onChange={(e) => setRoundingUnit(parseFloat(e.target.value) || 1)}
                    placeholder="1.00"
                    className="w-24 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-right focus:border-primary-500 focus:outline-none"
                  />
                  <span className="text-xs text-gray-400">unit (e.g. 0.05, 1.00, 5.00)</span>
                </>
              )}
            </div>
          </div>

          {/* Footer / Save */}
          <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex justify-end">
            <Button
              loading={savePosBehaviourMut.isPending}
              onClick={() => savePosBehaviourMut.mutate({
                pos_allow_price_edit:          allowPriceEdit,
                pos_allow_partial_qty:         allowPartialQty,
                pos_default_scan_mode:         defaultScanMode,
                pos_allow_total_edit:          allowTotalEdit,
                pos_prevent_sales_below_cost:  preventSalesBelowCost,
                pos_rounding_mode:             roundingMode,
                pos_rounding_unit:             roundingUnit,
              })}
            >
              Save POS Settings
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Loyalty Settings Tab ──────────────────────────────────────────────────────

function LoyaltyTab() {
  const qc = useQueryClient();
  const [earnRate,   setEarnRate]   = useState('');
  const [redeemRate, setRedeemRate] = useState('');
  const [dirty,      setDirty]      = useState(false);

  const { isLoading } = useQuery({
    queryKey: ['loyalty-settings'],
    queryFn:  () => api.get('/companies/mine/loyalty').then((r) => r.data.data),
    onSuccess: (d) => { setEarnRate(String(d.points_earn_rate)); setRedeemRate(String(d.points_redeem_rate)); },
  });

  const saveMut = useMutation({
    mutationFn: (body) => api.patch('/companies/mine/loyalty', body),
    onSuccess: (res) => {
      const d = res.data.data;
      setEarnRate(String(d.points_earn_rate));
      setRedeemRate(String(d.points_redeem_rate));
      setDirty(false);
      toast.success('Loyalty settings saved');
      qc.invalidateQueries({ queryKey: ['loyalty-settings'] });
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Save failed'),
  });

  const handle = (setter) => (e) => { setter(e.target.value); setDirty(true); };
  const valid  = parseFloat(earnRate) > 0 && parseFloat(redeemRate) > 0;

  const earnNum   = parseFloat(earnRate)   || 0;
  const redeemNum = parseFloat(redeemRate) || 0;

  return (
    <div className="space-y-6 max-w-lg">
      <h2 className="text-base font-semibold text-gray-900">Loyalty Points</h2>

      {isLoading ? <PageSpinner /> : (
        <>
          <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm space-y-5">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Earn Rate</label>
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-500 whitespace-nowrap">Spend</span>
                <input type="number" step="1" min="1" value={earnRate} onChange={handle(setEarnRate)}
                  className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm text-center font-semibold focus:border-primary-500 focus:outline-none" />
                <span className="text-sm text-gray-500 whitespace-nowrap">currency units to earn 1 point</span>
              </div>
              <p className="mt-1 text-xs text-gray-400">e.g. {earnNum} = a KES {earnNum} purchase earns 1 point</p>
            </div>

            <div className="border-t border-gray-50" />

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Redeem Rate</label>
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-500 whitespace-nowrap">1 point =</span>
                <input type="number" step="0.01" min="0.01" value={redeemRate} onChange={handle(setRedeemRate)}
                  className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm text-center font-semibold focus:border-primary-500 focus:outline-none" />
                <span className="text-sm text-gray-500 whitespace-nowrap">currency units on redemption</span>
              </div>
              <p className="mt-1 text-xs text-gray-400">e.g. {redeemNum} = 100 points redeems for {(100 * redeemNum).toFixed(2)} off</p>
            </div>
          </div>

          {/* Live preview */}
          {earnNum > 0 && redeemNum > 0 && (
            <div className="rounded-xl bg-primary-50 border border-primary-100 p-4 text-sm text-primary-800 space-y-1">
              <p className="font-semibold">Preview</p>
              <p>A KES 1,000 sale earns <strong>{Math.floor(1000 / earnNum)} points</strong></p>
              <p>100 points can be redeemed for <strong>KES {(100 * redeemNum).toFixed(2)} off</strong></p>
            </div>
          )}

          {dirty && (
            <Button loading={saveMut.isPending} disabled={!valid} onClick={() =>
              saveMut.mutate({ points_earn_rate: parseFloat(earnRate), points_redeem_rate: parseFloat(redeemRate) })
            }>
              Save Loyalty Settings
            </Button>
          )}
        </>
      )}
    </div>
  );
}

// ── Product Categories Tab ────────────────────────────────────────────────────

function CategoriesTab() {
  const qc = useQueryClient();
  const [addOpen,  setAddOpen]  = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [name,     setName]     = useState('');

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['categories'],
    queryFn:  () => api.get('/products/categories').then((r) => r.data.data),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['categories'] });

  const createMut = useMutation({
    mutationFn: (body) => api.post('/products/categories', body),
    onSuccess: () => { toast.success('Category created'); invalidate(); setAddOpen(false); setName(''); },
    onError: (e) => toast.error(e.response?.data?.message || 'Create failed'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }) => api.put(`/products/categories/${id}`, body),
    onSuccess: () => { toast.success('Category updated'); invalidate(); setEditItem(null); setName(''); },
    onError: (e) => toast.error(e.response?.data?.message || 'Update failed'),
  });

  const openEdit = (cat) => { setEditItem(cat); setName(cat.category_name); };
  const openAdd  = ()    => { setEditItem(null); setName(''); setAddOpen(true); };

  const CategoryForm = ({ onSave, isPending, onClose }) => (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Category Name *</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Beverages"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
      </div>
      <div className="flex gap-3 pt-2">
        <Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button>
        <Button fullWidth disabled={!name.trim()} loading={isPending} onClick={() => onSave({ category_name: name.trim() })}>
          {editItem ? 'Save Changes' : 'Create Category'}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Product Categories</h2>
        <Button icon={<Plus className="h-4 w-4" />} size="sm" onClick={openAdd}>Add Category</Button>
      </div>
      {isLoading ? <PageSpinner /> : (
        <div className="rounded-xl border border-gray-100 bg-white overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Category Name</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {categories.map((c) => (
                <tr key={c.category_id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{c.category_name}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openEdit(c)}
                      className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-primary-600 transition-colors">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {categories.length === 0 && (
                <tr><td colSpan={2} className="py-12 text-center text-gray-400">No categories yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Category" size="sm">
        <CategoryForm onSave={(b) => createMut.mutate(b)} isPending={createMut.isPending} onClose={() => setAddOpen(false)} />
      </Modal>
      <Modal open={!!editItem} onClose={() => setEditItem(null)} title={`Edit — ${editItem?.category_name}`} size="sm">
        <CategoryForm onSave={(b) => updateMut.mutate({ id: editItem.category_id, body: b })} isPending={updateMut.isPending} onClose={() => setEditItem(null)} />
      </Modal>
    </div>
  );
}

// ── Customer Groups Tab ───────────────────────────────────────────────────────

function CustomerGroupsTab() {
  const qc = useQueryClient();
  const [addOpen,  setAddOpen]  = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [name,     setName]     = useState('');
  const [discount, setDiscount] = useState('');  // maps to default_discount_value

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['customer-groups'],
    queryFn:  () => api.get('/customers/groups').then((r) => r.data.data),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['customer-groups'] });

  const createMut = useMutation({
    mutationFn: (body) => api.post('/customers/groups', body),
    onSuccess: () => { toast.success('Group created'); invalidate(); setAddOpen(false); setName(''); setDiscount(''); },
    onError: (e) => toast.error(e.response?.data?.message || 'Create failed'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }) => api.put(`/customers/groups/${id}`, body),
    onSuccess: () => { toast.success('Group updated'); invalidate(); setEditItem(null); setName(''); setDiscount(''); },
    onError: (e) => toast.error(e.response?.data?.message || 'Update failed'),
  });

  const openEdit = (g) => { setEditItem(g); setName(g.group_name); setDiscount(g.default_discount_value ?? ''); };
  const openAdd  = ()   => { setEditItem(null); setName(''); setDiscount(''); setAddOpen(true); };

  const GroupForm = ({ onSave, isPending, onClose }) => (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Group Name *</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. VIP, Wholesale"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Discount %</label>
        <input type="number" step="0.01" min="0" max="100" value={discount} onChange={(e) => setDiscount(e.target.value)}
          placeholder="0"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
      </div>
      <div className="flex gap-3 pt-2">
        <Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button>
        <Button fullWidth disabled={!name.trim()} loading={isPending}
          onClick={() => onSave({ group_name: name.trim(), default_discount_value: parseFloat(discount) || 0 })}>
          {editItem ? 'Save Changes' : 'Create Group'}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Customer Groups</h2>
          <p className="text-sm text-gray-500 mt-0.5">Segment customers and assign group discounts.</p>
        </div>
        <Button icon={<Plus className="h-4 w-4" />} size="sm" onClick={openAdd}>Add Group</Button>
      </div>
      {isLoading ? <PageSpinner /> : (
        <div className="rounded-xl border border-gray-100 bg-white overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Group Name</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600">Discount</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {groups.map((g) => (
                <tr key={g.group_id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{g.group_name}</td>
                  <td className="px-4 py-3 text-center text-gray-600">
                    {g.default_discount_value > 0
                      ? <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">{g.default_discount_value}%</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openEdit(g)}
                      className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-primary-600 transition-colors">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {groups.length === 0 && (
                <tr><td colSpan={3} className="py-12 text-center text-gray-400">No customer groups yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Customer Group" size="sm">
        <GroupForm onSave={(b) => createMut.mutate(b)} isPending={createMut.isPending} onClose={() => setAddOpen(false)} />
      </Modal>
      <Modal open={!!editItem} onClose={() => setEditItem(null)} title={`Edit — ${editItem?.group_name}`} size="sm">
        <GroupForm onSave={(b) => updateMut.mutate({ id: editItem.group_id, body: b })} isPending={updateMut.isPending} onClose={() => setEditItem(null)} />
      </Modal>
    </div>
  );
}

// ── Branches Tab ──────────────────────────────────────────────────────────────

function BranchForm({ initial, onSave, onClose, isPending }) {
  const isEdit = !!initial;
  const [name,     setName]     = useState(initial?.branch_name ?? '');
  const [code,     setCode]     = useState(initial?.branch_code ?? '');
  const [address,  setAddress]  = useState(initial?.address     ?? '');
  const [phone,    setPhone]    = useState(initial?.phone        ?? '');
  const [isActive, setIsActive] = useState(initial?.is_active   ?? true);

  const valid = name.trim().length >= 2 && (isEdit || code.trim().length >= 2);

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Branch Name *</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Westlands Branch"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Branch Code {!isEdit && '*'}</label>
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} disabled={isEdit}
          placeholder="e.g. NBO-01"
          className={`w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-primary-500 focus:outline-none ${isEdit ? 'bg-gray-50 text-gray-400' : ''}`} />
        {isEdit && <p className="mt-0.5 text-xs text-gray-400">Code cannot be changed after creation</p>}
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Address</label>
        <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2}
          placeholder="Street, City, Country"
          className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Phone</label>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+254…"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
      </div>
      {isEdit && (
        <label className="flex items-center gap-3 cursor-pointer">
          <span className="text-sm text-gray-700">Active</span>
          <button type="button" onClick={() => setIsActive(!isActive)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${isActive ? 'bg-primary-600' : 'bg-gray-300'}`}>
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${isActive ? 'translate-x-4' : 'translate-x-1'}`} />
          </button>
        </label>
      )}
      <div className="flex gap-3 pt-2">
        <Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button>
        <Button fullWidth disabled={!valid} loading={isPending}
          onClick={() => onSave({ branch_name: name.trim(), branch_code: code.trim(), address: address.trim() || null, phone: phone.trim() || null, is_active: isActive })}>
          {isEdit ? 'Save Changes' : 'Create Branch'}
        </Button>
      </div>
    </div>
  );
}

function BranchesTab() {
  const qc = useQueryClient();
  const [addOpen,    setAddOpen]    = useState(false);
  const [viewBranch, setViewBranch] = useState(null);
  const [editBranch, setEditBranch] = useState(null);

  const { data: branches = [], isLoading } = useQuery({
    queryKey: ['branches'],
    queryFn:  () => api.get('/branches').then((r) => r.data.data),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['branches'] });

  const createMut = useMutation({
    mutationFn: (body) => api.post('/branches', body),
    onSuccess: () => { toast.success('Branch created'); invalidate(); setAddOpen(false); },
    onError: (e) => toast.error(e.response?.data?.message || 'Create failed'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }) => api.put(`/branches/${id}`, body),
    onSuccess: () => { toast.success('Branch updated'); invalidate(); setEditBranch(null); },
    onError: (e) => toast.error(e.response?.data?.message || 'Update failed'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Branches</h2>
          <p className="text-sm text-gray-500 mt-0.5">Manage your company's branch locations.</p>
        </div>
        <Button icon={<Plus className="h-4 w-4" />} size="sm" onClick={() => setAddOpen(true)}>Add Branch</Button>
      </div>

      {isLoading ? <PageSpinner /> : (
        <div className="rounded-xl border border-gray-100 bg-white overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Branch</th>
                  <th className="hidden sm:table-cell px-4 py-3 text-left font-medium text-gray-600">Code</th>
                  <th className="hidden md:table-cell px-4 py-3 text-left font-medium text-gray-600">Address</th>
                  <th className="hidden md:table-cell px-4 py-3 text-left font-medium text-gray-600">Phone</th>
                  <th className="hidden sm:table-cell px-4 py-3 text-center font-medium text-gray-600">HQ</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-600">Status</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-600">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {branches.map((b) => (
                  <tr key={b.branch_id} className={`hover:bg-gray-50 active:bg-gray-100 transition-colors ${!b.is_active ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-100">
                          <GitBranch className="h-3.5 w-3.5 text-primary-600" />
                        </div>
                        <span className="font-medium text-gray-900">{b.branch_name}</span>
                      </div>
                    </td>
                    <td className="hidden sm:table-cell px-4 py-3 font-mono text-xs text-gray-500">{b.branch_code}</td>
                    <td className="hidden md:table-cell px-4 py-3 text-gray-500 text-xs">{b.address || <span className="text-gray-300">—</span>}</td>
                    <td className="hidden md:table-cell px-4 py-3 text-gray-500 text-xs">{b.phone   || <span className="text-gray-300">—</span>}</td>
                    <td className="hidden sm:table-cell px-4 py-3 text-center">
                      {b.is_headquarters
                        ? <span className="inline-flex items-center gap-1 text-green-600 text-xs font-medium"><Check className="h-3 w-3" /> HQ</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {b.is_active
                        ? <span className="text-green-600 text-xs font-medium">Active</span>
                        : <span className="text-gray-400 text-xs">Inactive</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => setViewBranch(b)}
                        className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-100 transition-colors">
                        View
                      </button>
                    </td>
                  </tr>
                ))}
                {branches.length === 0 && (
                  <tr><td colSpan={7} className="py-12 text-center text-gray-400">
                    <GitBranch className="mx-auto mb-2 h-8 w-8 opacity-30" />No branches found.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Branch" size="sm">
        <BranchForm onSave={(body) => createMut.mutate(body)} onClose={() => setAddOpen(false)} isPending={createMut.isPending} />
      </Modal>

      <Modal open={!!viewBranch && !editBranch} onClose={() => setViewBranch(null)}
        title={viewBranch?.branch_name ?? 'Branch Details'} size="sm"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" fullWidth onClick={() => setViewBranch(null)}>Close</Button>
            <Button fullWidth icon={<Pencil className="h-4 w-4" />}
              onClick={() => { setEditBranch(viewBranch); setViewBranch(null); }}>
              Edit
            </Button>
          </div>
        }
      >
        {viewBranch && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Branch Code', value: viewBranch.branch_code },
                { label: 'Status',      value: viewBranch.is_active ? 'Active' : 'Inactive' },
                { label: 'Phone',       value: viewBranch.phone || '—' },
                { label: 'HQ',          value: viewBranch.is_headquarters ? 'Yes' : 'No' },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg bg-gray-50 px-3 py-2.5">
                  <p className="text-xs text-gray-500">{label}</p>
                  <p className="font-semibold text-gray-900 mt-0.5">{value}</p>
                </div>
              ))}
            </div>
            {viewBranch.address && (
              <div className="rounded-lg bg-gray-50 px-3 py-2.5">
                <p className="text-xs text-gray-500">Address</p>
                <p className="font-semibold text-gray-900 mt-0.5">{viewBranch.address}</p>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal open={!!editBranch} onClose={() => setEditBranch(null)} title={`Edit — ${editBranch?.branch_name}`} size="sm">
        <BranchForm initial={editBranch}
          onSave={(body) => updateMut.mutate({ id: editBranch?.branch_id, body })}
          onClose={() => setEditBranch(null)} isPending={updateMut.isPending} />
      </Modal>
    </div>
  );
}

// ── Tax Rates Tab ─────────────────────────────────────────────────────────────

const KE_PRESETS = [
  { template_name: 'VAT 16%',    tax_type: 'VAT',    tax_rate: 16,  is_inclusive: false, is_default: false },
  { template_name: 'Zero-Rated', tax_type: 'VAT',    tax_rate: 0,   is_inclusive: false, is_default: false },
  { template_name: 'Exempt',     tax_type: 'Exempt', tax_rate: 0,   is_inclusive: false, is_default: false },
];

function TaxForm({ initial, onSave, onClose, isPending }) {
  const [name,        setName]        = useState(initial?.template_name ?? '');
  const [taxType,     setTaxType]     = useState(initial?.tax_type      ?? 'VAT');
  const [rate,        setRate]        = useState(String(initial?.tax_rate ?? ''));
  const [inclusive,   setInclusive]   = useState(initial?.is_inclusive  ?? false);
  const [isDefault,   setIsDefault]   = useState(initial?.is_default    ?? false);
  const valid = name.trim().length >= 2 && rate !== '';

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Template Name *</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. VAT 16%"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Tax Type</label>
          <select value={taxType} onChange={(e) => setTaxType(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none">
            <option value="VAT">VAT</option>
            <option value="Exempt">Exempt</option>
            <option value="Zero-Rated">Zero-Rated</option>
            <option value="Custom">Custom</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Rate (%)</label>
          <input type="number" step="0.01" min="0" max="100" value={rate} onChange={(e) => setRate(e.target.value)}
            placeholder="16"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
        </div>
      </div>
      <label className="flex items-center gap-3 cursor-pointer">
        <span className="text-sm text-gray-700">Tax inclusive in price</span>
        <button type="button" onClick={() => setInclusive(!inclusive)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${inclusive ? 'bg-primary-600' : 'bg-gray-300'}`}>
          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${inclusive ? 'translate-x-4' : 'translate-x-1'}`} />
        </button>
        <span className="text-xs text-gray-400">{inclusive ? 'Inclusive (price already includes tax)' : 'Exclusive (tax added on top)'}</span>
      </label>
      <label className="flex items-center gap-3 cursor-pointer">
        <span className="text-sm text-gray-700">Set as default</span>
        <button type="button" onClick={() => setIsDefault(!isDefault)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${isDefault ? 'bg-primary-600' : 'bg-gray-300'}`}>
          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${isDefault ? 'translate-x-4' : 'translate-x-1'}`} />
        </button>
        <span className="text-xs text-gray-400">Applied automatically in POS</span>
      </label>
      <div className="flex gap-3 pt-2">
        <Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button>
        <Button fullWidth disabled={!valid} loading={isPending}
          onClick={() => onSave({ template_name: name.trim(), tax_type: taxType, tax_rate: parseFloat(rate), is_inclusive: inclusive, is_default: isDefault })}>
          {initial ? 'Save Changes' : 'Create Tax Rate'}
        </Button>
      </div>
    </div>
  );
}

function TaxTab() {
  const qc = useQueryClient();
  const [addOpen,  setAddOpen]  = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [kraPin,   setKraPin]   = useState('');
  const [pinDirty, setPinDirty] = useState(false);

  const { data: rates = [], isLoading } = useQuery({
    queryKey: ['tax-rates'],
    queryFn:  () => api.get('/tax-rates').then((r) => r.data.data),
  });

  // Fetch KRA PIN from company profile
  useQuery({
    queryKey: ['company-mine'],
    queryFn:  () => api.get('/companies/mine').then((r) => r.data.data),
    onSuccess: (d) => setKraPin(d.tax_id ?? ''),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['tax-rates'] });

  const createMut = useMutation({
    mutationFn: (body) => api.post('/tax-rates', body),
    onSuccess: () => { toast.success('Tax rate created'); invalidate(); setAddOpen(false); },
    onError: (e) => toast.error(e.response?.data?.message || 'Create failed'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }) => api.put(`/tax-rates/${id}`, body),
    onSuccess: () => { toast.success('Tax rate updated'); invalidate(); setEditItem(null); },
    onError: (e) => toast.error(e.response?.data?.message || 'Update failed'),
  });

  const deleteMut = useMutation({
    mutationFn: (id) => api.delete(`/tax-rates/${id}`),
    onSuccess: () => { toast.success('Tax rate deleted'); invalidate(); },
    onError: (e) => toast.error(e.response?.data?.message || 'Delete failed'),
  });

  const savePinMut = useMutation({
    mutationFn: (taxId) => api.patch('/companies/mine/profile', { tax_id: taxId }),
    onSuccess: () => { toast.success('KRA PIN saved'); setPinDirty(false); qc.invalidateQueries({ queryKey: ['company-mine'] }); },
    onError: (e) => toast.error(e.response?.data?.message || 'Save failed'),
  });

  const addPreset = (preset) => createMut.mutate(preset);

  const usedPresets = rates.map((r) => r.template_name);
  const availablePresets = KE_PRESETS.filter((p) => !usedPresets.includes(p.template_name));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Tax Rates</h2>
          <p className="text-sm text-gray-500 mt-0.5">Configure tax templates applied at point of sale (Kenya VAT ready).</p>
        </div>
        <Button icon={<Plus className="h-4 w-4" />} size="sm" onClick={() => setAddOpen(true)}>Add Tax Rate</Button>
      </div>

      {/* KRA PIN row */}
      <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
        <label className="mb-1 block text-sm font-medium text-gray-700">KRA PIN (Tax Identification Number)</label>
        <div className="flex gap-3">
          <input value={kraPin} onChange={(e) => { setKraPin(e.target.value); setPinDirty(true); }}
            placeholder="e.g. P051234567A"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-primary-500 focus:outline-none" />
          {pinDirty && (
            <Button size="sm" loading={savePinMut.isPending} onClick={() => savePinMut.mutate(kraPin.trim() || null)}>
              Save PIN
            </Button>
          )}
        </div>
        <p className="mt-1 text-xs text-gray-400">Printed on receipts as required by KRA regulations.</p>
      </div>

      {/* Quick-add Kenyan presets */}
      {availablePresets.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-500 font-medium">Quick add:</span>
          {availablePresets.map((p) => (
            <button key={p.template_name}
              onClick={() => addPreset(p)}
              className="rounded-full border border-dashed border-primary-400 px-3 py-1 text-xs text-primary-600 hover:bg-primary-50 transition-colors">
              + {p.template_name}
            </button>
          ))}
        </div>
      )}

      {isLoading ? <PageSpinner /> : (
        <div className="rounded-xl border border-gray-100 bg-white overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Name</th>
                  <th className="hidden sm:table-cell px-4 py-3 text-left font-medium text-gray-600">Type</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-600">Rate</th>
                  <th className="hidden md:table-cell px-4 py-3 text-center font-medium text-gray-600">Inclusive</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-600">Default</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rates.map((r) => (
                  <tr key={r.tax_template_id} className="hover:bg-gray-50 active:bg-gray-100 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900">{r.template_name}</td>
                    <td className="hidden sm:table-cell px-4 py-3">
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">{r.tax_type}</span>
                    </td>
                    <td className="px-4 py-3 text-center font-semibold text-gray-700">{r.tax_rate}%</td>
                    <td className="hidden md:table-cell px-4 py-3 text-center">
                      {r.is_inclusive
                        ? <span className="text-green-600 text-xs font-medium">Incl.</span>
                        : <span className="text-gray-400 text-xs">Excl.</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {r.is_default
                        ? <span className="inline-flex items-center gap-1 rounded-full bg-primary-100 px-2 py-0.5 text-xs font-medium text-primary-700"><Check className="h-3 w-3" /> Default</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setEditItem(r)}
                          className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-primary-600 transition-colors">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => { if (window.confirm(`Delete "${r.template_name}"?`)) deleteMut.mutate(r.tax_template_id); }}
                          className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {rates.length === 0 && (
                  <tr><td colSpan={6} className="py-12 text-center text-gray-400">
                    <Percent className="mx-auto mb-2 h-8 w-8 opacity-30" />
                    No tax rates yet. Add one or use quick-add presets above.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Tax Rate" size="sm">
        <TaxForm onSave={(b) => createMut.mutate(b)} onClose={() => setAddOpen(false)} isPending={createMut.isPending} />
      </Modal>
      <Modal open={!!editItem} onClose={() => setEditItem(null)} title={`Edit — ${editItem?.template_name}`} size="sm">
        <TaxForm initial={editItem}
          onSave={(b) => updateMut.mutate({ id: editItem.tax_template_id, body: b })}
          onClose={() => setEditItem(null)} isPending={updateMut.isPending} />
      </Modal>
    </div>
  );
}

// ── Return Reasons Tab ────────────────────────────────────────────────────────

function ReasonForm({ initial, onSave, onClose, isPending }) {
  const [name,      setName]      = useState(initial?.reason_name   ?? '');
  const [code,      setCode]      = useState(initial?.reason_code   ?? '');
  const [restock,   setRestock]   = useState(initial?.restock_by_default ?? true);
  const [isActive,  setIsActive]  = useState(initial?.is_active     ?? true);
  const isEdit = !!initial;

  const valid = name.trim().length >= 2;

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Reason Name *</label>
        <input value={name} onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Defective product, Wrong item delivered…"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Reason Code (optional)</label>
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="e.g. DEFECT, WRONG"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-primary-500 focus:outline-none" />
      </div>
      <label className="flex items-center gap-3 cursor-pointer">
        <span className="text-sm text-gray-700">Restock to inventory by default</span>
        <button type="button" onClick={() => setRestock(!restock)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${restock ? 'bg-primary-600' : 'bg-gray-300'}`}>
          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${restock ? 'translate-x-4' : 'translate-x-1'}`} />
        </button>
        <span className="text-xs text-gray-400">{restock ? 'Yes — item goes back to stock' : 'No — write-off'}</span>
      </label>
      {isEdit && (
        <label className="flex items-center gap-3 cursor-pointer">
          <span className="text-sm text-gray-700">Active</span>
          <button type="button" onClick={() => setIsActive(!isActive)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${isActive ? 'bg-primary-600' : 'bg-gray-300'}`}>
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${isActive ? 'translate-x-4' : 'translate-x-1'}`} />
          </button>
        </label>
      )}
      <div className="flex gap-3 pt-2">
        <Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button>
        <Button fullWidth disabled={!valid} loading={isPending}
          onClick={() => onSave({ reason_name: name.trim(), reason_code: code.trim() || null, restock_by_default: restock, is_active: isActive })}>
          {isEdit ? 'Save Changes' : 'Add Reason'}
        </Button>
      </div>
    </div>
  );
}

function ReturnReasonsTab() {
  const qc = useQueryClient();
  const [addOpen,    setAddOpen]    = useState(false);
  const [editReason, setEditReason] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const { data: reasons = [], isLoading } = useQuery({
    queryKey: ['return-reasons-settings'],
    queryFn:  () => api.get('/returns/reasons').then((r) => r.data.data),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['return-reasons-settings'] });

  const createMut = useMutation({
    mutationFn: (body) => api.post('/returns/reasons', body),
    onSuccess: () => { toast.success('Reason added'); invalidate(); setAddOpen(false); },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed to add'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }) => api.put(`/returns/reasons/${id}`, body),
    onSuccess: () => { toast.success('Reason updated'); invalidate(); setEditReason(null); },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed to update'),
  });

  const deleteMut = useMutation({
    mutationFn: (id) => api.delete(`/returns/reasons/${id}`),
    onSuccess: () => { toast.success('Reason deleted'); invalidate(); setDeleteTarget(null); },
    onError: (e) => toast.error(e.response?.data?.message || 'Cannot delete this reason'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Return Reasons</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Define the reasons customers may give when returning items.
          </p>
        </div>
        <Button icon={<Plus className="h-4 w-4" />} size="sm" onClick={() => setAddOpen(true)}>
          Add Reason
        </Button>
      </div>

      {isLoading ? <PageSpinner /> : (
        <div className="rounded-xl border border-gray-100 bg-white overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Reason</th>
                <th className="hidden sm:table-cell px-4 py-3 text-left font-medium text-gray-600">Code</th>
                <th className="hidden md:table-cell px-4 py-3 text-center font-medium text-gray-600">Restock Default</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {reasons.map((r) => (
                <tr key={r.reason_id} className={`hover:bg-gray-50 active:bg-gray-100 transition-colors ${!r.is_active ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-100">
                        <RotateCcw className="h-3.5 w-3.5 text-primary-600" />
                      </div>
                      <div>
                        <span className="font-medium text-gray-900">{r.reason_name}</span>
                        {r.is_system_reason && (
                          <span className="ml-2 text-xs text-gray-400 italic">system</span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="hidden sm:table-cell px-4 py-3 font-mono text-xs text-gray-500">
                    {r.reason_code || <span className="text-gray-300">—</span>}
                  </td>
                  <td className="hidden md:table-cell px-4 py-3 text-center">
                    {r.restock_by_default
                      ? <span className="inline-flex items-center gap-1 text-green-600 text-xs font-medium"><Check className="h-3 w-3" /> Yes</span>
                      : <span className="text-gray-400 text-xs">No</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {r.is_active
                      ? <span className="text-green-600 text-xs font-medium">Active</span>
                      : <span className="text-gray-400 text-xs">Inactive</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setEditReason(r)}
                        className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-primary-600 transition-colors">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      {!r.is_system_reason && (
                        <button onClick={() => setDeleteTarget(r)}
                          className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-red-600 transition-colors">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {reasons.length === 0 && (
                <tr><td colSpan={5} className="py-12 text-center text-gray-400">
                  <RotateCcw className="mx-auto mb-2 h-8 w-8 opacity-30" />
                  No return reasons yet.
                </td></tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Add modal */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Return Reason" size="sm">
        <ReasonForm
          onSave={(body) => createMut.mutate(body)}
          onClose={() => setAddOpen(false)}
          isPending={createMut.isPending}
        />
      </Modal>

      {/* Edit modal */}
      <Modal open={!!editReason} onClose={() => setEditReason(null)} title={`Edit — ${editReason?.reason_name}`} size="sm">
        <ReasonForm
          initial={editReason}
          onSave={(body) => updateMut.mutate({ id: editReason?.reason_id, body })}
          onClose={() => setEditReason(null)}
          isPending={updateMut.isPending}
        />
      </Modal>

      {/* Delete confirm */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Return Reason" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Are you sure you want to delete <span className="font-semibold">{deleteTarget?.reason_name}</span>?
            This cannot be undone if the reason has never been used.
          </p>
          <div className="flex gap-3">
            <Button variant="secondary" fullWidth onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="danger" fullWidth loading={deleteMut.isPending}
              onClick={() => deleteMut.mutate(deleteTarget?.reason_id)}>
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── Subscription Tab ──────────────────────────────────────────────────────────

const STATUS_BADGE = {
  trial:     { cls: 'bg-blue-100 text-blue-700',    label: 'Trial'     },
  active:    { cls: 'bg-green-100 text-green-700',   label: 'Active'    },
  suspended: { cls: 'bg-red-100 text-red-600',       label: 'Suspended' },
  cancelled: { cls: 'bg-gray-100 text-gray-600',     label: 'Cancelled' },
};

const SUB_PERIODS = [
  { value: 'monthly',     label: 'Monthly',     months: 1  },
  { value: 'quarterly',   label: 'Quarterly',   months: 3  },
  { value: 'semi_annual', label: 'Semi-Annual', months: 6  },
  { value: 'annual',      label: 'Annual',      months: 12 },
  { value: 'biennial',    label: 'Biennial',    months: 24 },
];

const REQ_STATUS = {
  pending:  { cls: 'bg-amber-100 text-amber-700',  label: 'Pending',  Icon: Clock     },
  approved: { cls: 'bg-green-100 text-green-700',  label: 'Approved', Icon: CheckCircle2 },
  rejected: { cls: 'bg-red-100  text-red-600',     label: 'Rejected', Icon: XCircle   },
};

function SubscriptionTab() {
  const qc = useQueryClient();
  const [requestOpen, setRequestOpen] = useState(false);
  const [reqPlanId,   setReqPlanId]   = useState('');
  const [reqPeriod,   setReqPeriod]   = useState('annual');
  const [reqMessage,  setReqMessage]  = useState('');

  const { data: sub, isLoading: subLoading } = useQuery({
    queryKey: ['my-subscription'],
    queryFn:  () => api.get('/companies/mine/subscription').then((r) => r.data.data),
  });

  const { data: plans = [] } = useQuery({
    queryKey: ['subscription-plans'],
    queryFn:  () => api.get('/companies/plans').then((r) => r.data.data),
  });

  const { data: reqData } = useQuery({
    queryKey: ['my-subscription-requests'],
    queryFn:  () => api.get('/companies/mine/subscription-requests').then((r) => r.data.data),
  });
  const myRequests = reqData?.requests ?? [];

  const submitMut = useMutation({
    mutationFn: (body) => api.post('/companies/mine/subscription-requests', body),
    onSuccess: () => {
      toast.success('Subscription request submitted');
      qc.invalidateQueries({ queryKey: ['my-subscription-requests'] });
      setRequestOpen(false);
      setReqPlanId('');
      setReqPeriod('annual');
      setReqMessage('');
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Request failed'),
  });

  const openRequest = (planId = '') => { setReqPlanId(planId); setRequestOpen(true); };

  if (subLoading) return <PageSpinner />;

  const badge = STATUS_BADGE[sub?.subscription_status] ?? { cls: 'bg-gray-100 text-gray-600', label: sub?.subscription_status };

  return (
    <div className="space-y-6">
      <h2 className="text-base font-semibold text-gray-900">Subscription & Plan</h2>

      {/* Current plan card */}
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <div className="p-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Current Plan</p>
            <p className="text-2xl font-bold text-primary-700 mt-1">{sub?.plan_name ?? 'None'}</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap mt-1 ${badge.cls}`}>{badge.label}</span>
        </div>

        <div className="grid grid-cols-3 gap-px bg-gray-100 border-t border-gray-100">
          <div className="bg-white px-5 py-3">
            <p className="text-xs text-gray-400 mb-1">Started</p>
            <p className="text-sm font-medium text-gray-900">
              {sub?.subscription_start_date
                ? new Date(sub.subscription_start_date).toLocaleDateString()
                : '—'}
            </p>
          </div>
          <div className="bg-white px-5 py-3">
            <p className="text-xs text-gray-400 mb-1">Renews / Expires</p>
            <p className={`text-sm font-medium ${!sub?.subscription_end_date ? 'text-gray-400' : 'text-gray-900'}`}>
              {sub?.subscription_end_date
                ? new Date(sub.subscription_end_date).toLocaleDateString()
                : '—'}
            </p>
          </div>
          <div className="bg-white px-5 py-3">
            <p className="text-xs text-gray-400 mb-1">Monthly Rate</p>
            <p className="text-sm font-medium text-gray-900">
              {sub?.plan_price > 0 ? `KES ${sub.plan_price.toLocaleString()}` : '—'}
            </p>
          </div>
        </div>

        <div className="px-5 pb-5 flex gap-6 border-t border-gray-100 pt-4">
          <span className={`flex items-center gap-2 text-sm ${sub?.has_finance ? 'text-green-700' : 'text-gray-400'}`}>
            <CheckCircle2 className={`h-4 w-4 ${sub?.has_finance ? 'text-green-500' : 'text-gray-300'}`} />
            Finance Module
          </span>
          <span className={`flex items-center gap-2 text-sm ${sub?.has_api_access ? 'text-green-700' : 'text-gray-400'}`}>
            <CheckCircle2 className={`h-4 w-4 ${sub?.has_api_access ? 'text-green-500' : 'text-gray-300'}`} />
            API Access
          </span>
        </div>
      </div>

      {/* Available plans */}
      {plans.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Available Plans</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {plans.map((p) => {
              const isCurrent = p.plan_name === sub?.plan_name;
              const price = parseFloat(p.price);
              return (
                <div
                  key={p.plan_id}
                  className={`rounded-xl border p-4 ${
                    isCurrent ? 'border-primary-300 bg-primary-50' : 'border-gray-100 bg-white shadow-sm'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <p className="font-semibold text-gray-900">{p.plan_name}</p>
                    {isCurrent && (
                      <span className="rounded-full bg-primary-200 px-2.5 py-0.5 text-xs font-semibold text-primary-800 whitespace-nowrap">
                        Current
                      </span>
                    )}
                  </div>
                  <p className="text-xl font-bold text-gray-900">
                    {price > 0 ? `KES ${price.toLocaleString()}` : 'Free'}
                    {price > 0 && <span className="text-xs font-normal text-gray-400 ml-1">/ mo</span>}
                  </p>
                  <ul className="mt-3 space-y-1.5">
                    <li className="flex items-center gap-2 text-xs text-gray-600">
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                      {p.max_users > 0 ? `Up to ${p.max_users} users` : 'Unlimited users'}
                    </li>
                    <li className="flex items-center gap-2 text-xs text-gray-600">
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                      {p.max_branches > 0 ? `${p.max_branches} branch${p.max_branches !== 1 ? 'es' : ''}` : 'Unlimited branches'}
                    </li>
                    <li className={`flex items-center gap-2 text-xs ${p.has_finance ? 'text-gray-600' : 'text-gray-400'}`}>
                      {p.has_finance
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                        : <XCircle className="h-3.5 w-3.5 text-gray-300 shrink-0" />}
                      Finance module
                    </li>
                    <li className={`flex items-center gap-2 text-xs ${p.has_api_access ? 'text-gray-600' : 'text-gray-400'}`}>
                      {p.has_api_access
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                        : <XCircle className="h-3.5 w-3.5 text-gray-300 shrink-0" />}
                      API access
                    </li>
                  </ul>
                  <button
                    onClick={() => openRequest(p.plan_id)}
                    className={`mt-3 w-full rounded-lg py-2 text-sm font-semibold transition-colors ${
                      isCurrent
                        ? 'bg-white border border-primary-300 text-primary-700 hover:bg-primary-100'
                        : 'bg-primary-600 text-white hover:bg-primary-700'
                    }`}
                  >
                    {isCurrent ? 'Renew Plan' : 'Subscribe'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* My subscription requests */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">My Subscription Requests</h3>
          <Button size="sm" icon={<Send className="h-3.5 w-3.5" />} onClick={() => openRequest()}>
            New Request
          </Button>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white overflow-hidden shadow-sm">
          {myRequests.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-400">No subscription requests yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Plan</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Period</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Submitted</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {myRequests.map((r) => {
                  const s = REQ_STATUS[r.status] ?? REQ_STATUS.pending;
                  return (
                    <tr key={r.request_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-800">{r.plan_name}</td>
                      <td className="px-4 py-3 capitalize text-gray-600">{r.period?.replace('_', '-')}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{new Date(r.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>
                          <s.Icon className="h-3 w-3" />{s.label}
                        </span>
                        {r.status === 'rejected' && r.rejection_reason && (
                          <p className="mt-0.5 text-xs text-red-500">{r.rejection_reason}</p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <p className="text-xs text-gray-400">
        Questions? Contact{' '}
        <a href="mailto:support@statify.co.ke" className="text-primary-600 hover:underline">support@statify.co.ke</a>{' '}
        or call +254796265933.
      </p>

      {/* Submit subscription request modal */}
      <Modal open={requestOpen} onClose={() => setRequestOpen(false)} title="Submit Subscription Request" size="sm"
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" fullWidth onClick={() => setRequestOpen(false)}>Cancel</Button>
            <Button fullWidth loading={submitMut.isPending} disabled={!reqPlanId}
              icon={<Send className="h-4 w-4" />}
              onClick={() => submitMut.mutate({ planId: reqPlanId, period: reqPeriod, message: reqMessage || null })}>
              Submit Request
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Plan</label>
            <select value={reqPlanId} onChange={(e) => setReqPlanId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none bg-white">
              <option value="">Select plan…</option>
              {plans.map((p) => (
                <option key={p.plan_id} value={p.plan_id}>
                  {p.plan_name}{parseFloat(p.price) > 0 ? ` — KES ${parseFloat(p.price).toLocaleString()}/mo` : ' (Free)'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Billing Period</label>
            <select value={reqPeriod} onChange={(e) => setReqPeriod(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none bg-white">
              {SUB_PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Message <span className="font-normal text-gray-400">(optional)</span></label>
            <textarea rows={3} value={reqMessage} onChange={(e) => setReqMessage(e.target.value)}
              placeholder="Preferred start date, payment method, or any questions…"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none resize-none" />
          </div>
          <p className="text-xs text-blue-700 bg-blue-50 rounded-lg px-3 py-2">
            Our team will review and activate your subscription once payment is confirmed.
          </p>
        </div>
      </Modal>
    </div>
  );
}

// ── Security Tab ──────────────────────────────────────────────────────────────

const TIMEOUT_OPTIONS = [
  { label: 'Disabled',   value: '' },
  { label: '5 minutes',  value: '5' },
  { label: '10 minutes', value: '10' },
  { label: '15 minutes', value: '15' },
  { label: '30 minutes', value: '30' },
  { label: '1 hour',     value: '60' },
];

const SESSION_LIFETIME_OPTIONS = [
  { label: '1 day  (re-login every day)',   value: '1'  },
  { label: '3 days',                         value: '3'  },
  { label: '7 days (default)',               value: '7'  },
  { label: '14 days',                        value: '14' },
  { label: '30 days',                        value: '30' },
  { label: '90 days',                        value: '90' },
];

function SecurityTab() {
  const qc         = useQueryClient();
  const companyId  = useAuthStore((s) => s.user?.companyId);
  const userRole   = useAuthStore((s) => s.user?.role);
  const setLockTimeoutMinutes = useAuthStore((s) => s.setLockTimeoutMinutes);

  // Only company_admin can configure company-wide settings.
  // super_admin has no company context.
  const isCompanyAdmin = userRole === 'company_admin';

  const [timeoutVal,  setTimeoutVal]  = useState('');
  const [sessionDays, setSessionDays] = useState('7');

  // Fetch current company settings (React Query v5: use useEffect, not onSuccess)
  const { data: companyData } = useQuery({
    queryKey: ['company-mine', companyId],
    queryFn:  () => api.get('/companies/mine').then((r) => r.data.data),
    enabled:  !!companyId && isCompanyAdmin,
  });

  useEffect(() => {
    if (companyData) {
      setTimeoutVal(
        companyData.lock_timeout_minutes ? String(companyData.lock_timeout_minutes) : ''
      );
      setSessionDays(
        companyData.session_lifetime_days ? String(companyData.session_lifetime_days) : '7'
      );
    }
  }, [companyData]);

  // Single mutation handles both settings in one PATCH
  const saveLockMut = useMutation({
    mutationFn: (minutes) =>
      api.patch('/companies/mine/profile', { lock_timeout_minutes: minutes || null })
        .then((r) => r.data.data),
    onSuccess: (data) => {
      setLockTimeoutMinutes(data.lock_timeout_minutes ?? null);
      qc.invalidateQueries({ queryKey: ['company-mine', companyId] });
      toast.success('Auto-lock timeout saved');
    },
  });

  const saveSessionMut = useMutation({
    mutationFn: (days) =>
      api.patch('/companies/mine/profile', { session_lifetime_days: parseInt(days, 10) })
        .then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company-mine', companyId] });
      toast.success('Session lifetime saved — applies to new logins');
    },
  });

  return (
    <div className="max-w-lg space-y-8 py-4">

      {/* Company-admin only settings */}
      {isCompanyAdmin && (
        <>
          {/* Auto-lock timeout */}
          <div className="rounded-xl border border-gray-200 p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50">
                <Clock className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">Auto-lock Timeout</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Lock all terminals after this period of inactivity. Applies to everyone in your company.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <select
                value={timeoutVal}
                onChange={(e) => setTimeoutVal(e.target.value)}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:border-primary-500 focus:outline-none"
              >
                {TIMEOUT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <Button
                loading={saveLockMut.isPending}
                onClick={() => saveLockMut.mutate(timeoutVal ? parseInt(timeoutVal, 10) : null)}
              >
                Save
              </Button>
            </div>
            {timeoutVal === '' && (
              <p className="text-xs text-gray-400">
                When disabled, terminals stay unlocked until manually signed out.
              </p>
            )}
          </div>

          {/* Session lifetime */}
          <div className="rounded-xl border border-gray-200 p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50">
                <Clock className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">Session Lifetime</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  How long users stay logged in before being required to sign in again.
                  Takes effect on the next login — existing sessions are not affected.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <select
                value={sessionDays}
                onChange={(e) => setSessionDays(e.target.value)}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:border-primary-500 focus:outline-none"
              >
                {SESSION_LIFETIME_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <Button
                loading={saveSessionMut.isPending}
                onClick={() => saveSessionMut.mutate(sessionDays)}
              >
                Save
              </Button>
            </div>
            <p className="text-xs text-gray-400">
              For shift-based operations, 1 day ensures cashiers log in at the start of each shift.
            </p>
          </div>

        </>
      )}

    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

// ── Journal Settings Tab ──────────────────────────────────────────────────────

function JournalTab() {
  const qc        = useQueryClient();
  const companyId = useAuthStore((s) => s.user?.companyId);
  const userRole  = useAuthStore((s) => s.user?.role);
  const isAdmin   = userRole === 'company_admin';

  const [postingMode, setPostingMode] = useState('per_transaction');
  const [dailyBranchId, setDailyBranchId] = useState('');
  const [dailyDate,     setDailyDate]     = useState(new Date().toISOString().slice(0, 10));
  const [postMode,      setPostMode]      = useState('combined');

  const { data: companyData } = useQuery({
    queryKey: ['company-mine', companyId],
    queryFn:  () => api.get('/companies/mine').then((r) => r.data.data),
    enabled:  !!companyId && isAdmin,
  });

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn:  () => api.get('/branches').then((r) => r.data.data),
    enabled:  !!companyId && isAdmin,
  });

  useEffect(() => {
    if (companyData?.journal_posting_mode) setPostingMode(companyData.journal_posting_mode);
  }, [companyData]);

  const saveMut = useMutation({
    mutationFn: (mode) =>
      api.patch('/companies/mine/profile', { journal_posting_mode: mode }).then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company-mine', companyId] });
      toast.success('Journal posting mode saved');
    },
  });

  const dailyMut = useMutation({
    mutationFn: ({ branchId, date, mode }) =>
      api.post('/journal/daily-summaries', { branchId, date, mode }).then((r) => r.data),
    onSuccess: (data) => {
      if (data?.data?.posted !== undefined) {
        const { posted, skipped } = data.data;
        if (posted === 0 && skipped === 0) {
          toast.success('No unposted transactions found for this date');
        } else if (posted === 0) {
          toast.error(`0 posted — ${skipped} failed (check server logs or chart of accounts setup)`);
        } else {
          toast.success(`Posted ${posted} transaction${posted !== 1 ? 's' : ''}${skipped ? ` · ${skipped} failed` : ''}`);
        }
      } else {
        toast.success('Summary posted to journal');
      }
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Failed to post'),
  });

  const MODES = [
    {
      value: 'per_transaction',
      label: 'Per Transaction',
      desc:  'One journal entry for every sale. Full audit trail — best for low-to-medium volume.',
    },
    {
      value: 'session_summary',
      label: 'Session Summary',
      desc:  'One journal entry when a cashier closes their shift, covering all sales in that session.',
    },
    {
      value: 'daily_summary',
      label: 'Daily Summary',
      desc:  'One journal entry per branch per day, posted manually by an admin. Best for high-volume operations.',
    },
  ];

  return (
    <div className="max-w-lg space-y-6 py-4">
      {/* Posting mode */}
      <div className="rounded-xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50">
            <Layers className="h-5 w-5 text-violet-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">Journal Posting Mode</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Controls how sales are recorded in the double-entry journal. Does not affect inventory or reports.
            </p>
          </div>
        </div>

        <div>
          <div className="flex items-center gap-3">
            <select
              value={postingMode}
              onChange={(e) => setPostingMode(e.target.value)}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:border-primary-500 focus:outline-none"
            >
              {MODES.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <Button
              loading={saveMut.isPending}
              disabled={postingMode === companyData?.journal_posting_mode}
              onClick={() => saveMut.mutate(postingMode)}
            >
              Save
            </Button>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            {MODES.find((m) => m.value === postingMode)?.desc}
          </p>
        </div>
      </div>

      {/* Post unposted transactions — always visible so admins can retroactively post at any time */}
      <div className="rounded-xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50">
            <BookOpen className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">Post Unposted Transactions</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Manually post any sales that weren't recorded in the journal — useful after mode switches or to catch skipped entries.
            </p>
          </div>
        </div>

        {/* Mode toggle */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">Posting style</label>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            {[
              { value: 'combined',         label: 'Combined',        desc: 'One aggregate journal entry for the day' },
              { value: 'per_transaction',  label: 'Per Transaction', desc: 'One journal entry per sale' },
            ].map((opt, i) => (
              <button
                key={opt.value}
                onClick={() => setPostMode(opt.value)}
                className={[
                  'flex-1 px-3 py-2 text-center transition-colors',
                  i === 0 ? '' : 'border-l border-gray-200',
                  postMode === opt.value
                    ? 'bg-primary-600 text-white font-medium'
                    : 'bg-white text-gray-600 hover:bg-gray-50',
                ].join(' ')}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-gray-400">
            {postMode === 'combined'
              ? 'One aggregate journal entry covering all unposted sales for the selected branch and date.'
              : 'Individual journal entries for each unposted sale — matches per-transaction audit trail.'}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Branch</label>
            <select
              value={dailyBranchId}
              onChange={(e) => setDailyBranchId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:border-primary-500 focus:outline-none"
            >
              <option value="">— Select —</option>
              {(branches || []).map((b) => (
                <option key={b.branch_id} value={b.branch_id}>{b.branch_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Date</label>
            <input
              type="date"
              value={dailyDate}
              onChange={(e) => setDailyDate(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            loading={dailyMut.isPending}
            disabled={!dailyBranchId || !dailyDate}
            onClick={() => dailyMut.mutate({ branchId: dailyBranchId, date: dailyDate, mode: postMode })}
          >
            Post
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Inventory Settings Tab ────────────────────────────────────────────────────

function InventoryTab() {
  const qc        = useQueryClient();
  const companyId = useAuthStore((s) => s.user?.companyId);
  const userRole  = useAuthStore((s) => s.user?.role);
  const isAdmin   = userRole === 'company_admin';

  const [costingMethod, setCostingMethod] = useState('weighted_average');

  const { data: companyData } = useQuery({
    queryKey: ['company-mine', companyId],
    queryFn:  () => api.get('/companies/mine').then((r) => r.data.data),
    enabled:  !!companyId && isAdmin,
  });

  useEffect(() => {
    if (companyData?.costing_method) {
      setCostingMethod(companyData.costing_method);
    }
  }, [companyData]);

  const saveMut = useMutation({
    mutationFn: (method) =>
      api.patch('/companies/mine/profile', { costing_method: method }).then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company-mine', companyId] });
      toast.success('Costing method saved');
    },
  });

  const METHODS = [
    {
      value: 'weighted_average',
      label: 'Weighted Average Cost (WAC)',
      desc:  'Each purchase blends into a running average cost price. Simpler to manage and the recommended default.',
    },
    {
      value: 'fifo',
      label: 'First In, First Out (FIFO)',
      desc:  'Oldest stock layers are consumed first. More accurate COGS when purchase prices change frequently.',
    },
  ];

  return (
    <div className="max-w-lg space-y-6 py-4">
      <div className="rounded-xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50">
            <Package className="h-5 w-5 text-indigo-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">Inventory Costing Method</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Determines how cost of goods sold (COGS) is calculated on each sale.
              Applies to the whole company. Changing this only affects new GRNs and sales going forward.
            </p>
          </div>
        </div>

        <div>
          <div className="flex items-center gap-3">
            <select
              value={costingMethod}
              onChange={(e) => setCostingMethod(e.target.value)}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:border-primary-500 focus:outline-none"
            >
              {METHODS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <Button
              loading={saveMut.isPending}
              disabled={costingMethod === companyData?.costing_method}
              onClick={() => saveMut.mutate(costingMethod)}
            >
              Save
            </Button>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            {METHODS.find((m) => m.value === costingMethod)?.desc}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const NAV_GROUPS = [
  {
    label: 'POS Setup',
    items: [
      { id: 'branches',       label: 'Branches',         Icon: GitBranch  },
      { id: 'terminals',      label: 'Terminals',         Icon: Monitor    },
      { id: 'pay-modes',      label: 'Payment Methods',   Icon: CreditCard },
      { id: 'return-reasons', label: 'Return Reasons',    Icon: RotateCcw  },
    ],
  },
  {
    label: 'Products',
    items: [
      { id: 'categories', label: 'Product Categories', Icon: Package },
      { id: 'tax',        label: 'Tax Rates',           Icon: Percent },
      { id: 'inventory',  label: 'Inventory',           Icon: Layers  },
    ],
  },
  {
    label: 'Customers',
    items: [
      { id: 'cust-groups', label: 'Customer Groups', Icon: Users },
      { id: 'loyalty',     label: 'Loyalty Points',  Icon: Star  },
    ],
  },
  {
    label: 'System',
    items: [
      { id: 'journal',      label: 'Journal',      Icon: ArrowUpCircle },
      { id: 'security',     label: 'Security',     Icon: ShieldCheck   },
      { id: 'subscription', label: 'Subscription', Icon: Layers        },
    ],
  },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('pay-modes');

  const activeLabel = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.id === activeTab)?.label ?? '';

  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">Configure your POS system</p>

      <div className="flex gap-6 items-start">
        {/* Sidebar */}
        <aside className="w-48 flex-shrink-0 rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          {NAV_GROUPS.map((group, gi) => (
            <div key={group.label}>
              {gi > 0 && <div className="border-t border-gray-100" />}
              <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                {group.label}
              </p>
              {group.items.map(({ id, label, Icon }) => (
                <button key={id} onClick={() => setActiveTab(id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors text-left ${
                    activeTab === id
                      ? 'bg-primary-50 text-primary-700 font-semibold border-l-2 border-primary-600'
                      : 'text-gray-600 hover:bg-gray-50 border-l-2 border-transparent'
                  }`}>
                  <Icon className="h-3.5 w-3.5 flex-shrink-0" />
                  {label}
                </button>
              ))}
              {gi === NAV_GROUPS.length - 1 && <div className="pb-2" />}
            </div>
          ))}
        </aside>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-gray-800 mb-4">{activeLabel}</h2>
          {activeTab === 'branches'       && <BranchesTab />}
          {activeTab === 'categories'     && <CategoriesTab />}
          {activeTab === 'cust-groups'    && <CustomerGroupsTab />}
          {activeTab === 'loyalty'        && <LoyaltyTab />}
          {activeTab === 'tax'            && <TaxTab />}
          {activeTab === 'pay-modes'      && <PayModesTab />}
          {activeTab === 'terminals'      && <TerminalsTab />}
          {activeTab === 'return-reasons' && <ReturnReasonsTab />}
          {activeTab === 'inventory'      && <InventoryTab />}
          {activeTab === 'journal'        && <JournalTab />}
          {activeTab === 'security'       && <SecurityTab />}
          {activeTab === 'subscription'   && <SubscriptionTab />}
        </div>
      </div>
    </div>
  );
}
