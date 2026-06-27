import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, UserCircle, Gift, Phone, X, UserPlus, Hash, BadgeCheck, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/services/api';
import { useAuthStore, useCartStore } from '@/app/store';
import { formatCurrency } from '@/utils/formatters';
import Button from '@/components/ui/Button';

const SEARCH_MODES = [
  { key: 'name',  label: 'Name',  placeholder: 'Search by customer name…',        icon: UserCircle },
  { key: 'phone', label: 'Phone', placeholder: 'Search by phone number…',          icon: Phone },
  { key: 'id',    label: 'Nat. ID', placeholder: 'Enter national ID number…',        icon: Hash },
];

export default function CustomerSelectModal({ open, onClose }) {
  const setCustomer  = useCartStore((s) => s.setCustomer);
  const currentCust  = useCartStore((s) => s.customer);

  const [mode,        setMode]        = useState('name');
  const [search,      setSearch]      = useState('');
  const [debounced,   setDebounced]   = useState('');
  const [quickCreate, setQuickCreate] = useState(false);
  const [form,        setForm]        = useState({ customer_name: '', phone: '', email: '', id_number: '', kra_pin: '', customer_group_id: '' });

  const searchRef = useRef(null);

  // Debounce
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Fetch customer posting groups
  const { data: groups = [] } = useQuery({
    queryKey: ['customer-groups'],
    queryFn:  () => api.get('/customers/groups').then((r) => r.data.data),
    enabled:  open,
    staleTime: 5 * 60_000,
  });

  // Default the posting group once groups load and quick-create is open
  useEffect(() => {
    if (quickCreate && groups.length && !form.customer_group_id) {
      setForm((f) => ({ ...f, customer_group_id: groups[0].group_id }));
    }
  }, [quickCreate, groups]);

  // Reset on open / mode switch
  useEffect(() => {
    if (open) {
      setSearch('');
      setDebounced('');
      setQuickCreate(false);
      setForm({ customer_name: '', phone: '', email: '', id_number: '', kra_pin: '', customer_group_id: '' });
      setTimeout(() => searchRef.current?.focus(), 80);
    }
  }, [open]);

  useEffect(() => {
    setSearch('');
    setDebounced('');
  }, [mode]);

  const activeMode = SEARCH_MODES.find((m) => m.key === mode);

  // Strip country code so storage and search stay in local 07/01 format
  const normalizePhone = (raw) => {
    let p = raw.replace(/[\s\-().]/g, '');
    if (p.startsWith('+254')) p = '0' + p.slice(4);
    else if (/^254\d{9}$/.test(p)) p = '0' + p.slice(3);
    return p;
  };

  // Build query params based on mode
  const buildParams = () => {
    if (!debounced) return null;
    if (mode === 'name')  return { search: debounced, limit: 10 };
    if (mode === 'phone') return { phone: normalizePhone(debounced), limit: 10 };
    if (mode === 'id')    return { customerId: debounced, limit: 5 };
    return null;
  };

  const params = buildParams();

  const { data: result, isFetching } = useQuery({
    queryKey: ['customers-search', mode, debounced],
    queryFn:  () =>
      api.get('/customers', { params })
         .then((r) => r.data.data),
    enabled: open && !!params && debounced.length >= 1,
    staleTime: 30_000,
  });

  const customers = result?.customers ?? [];

  const qc = useQueryClient();
  const { mutate: createCustomer, isPending: creating } = useMutation({
    mutationFn: (data) => api.post('/customers', data),
    onSuccess: (res) => {
      const raw = res.data.data;
      const customer = {
        ...raw,
        loyalty_points_balance: parseInt(raw.loyalty_points_balance || 0),
        credit_balance: parseFloat(raw.credit_balance || 0),
        purchase_count: 0,
        total_spent: 0,
      };
      setCustomer(customer);
      qc.invalidateQueries({ queryKey: ['customers-search'] });
      toast.success(`${customer.customer_name} added`);
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Could not create customer'),
  });

  const select = (customer) => {
    setCustomer(customer);
    onClose();
  };

  const clearCustomer = () => {
    setCustomer(null);
    onClose();
  };

  const handleCreate = () => {
    if (!form.customer_name.trim()) { toast.error('Name is required'); return; }
    createCustomer({
      customer_name:     form.customer_name.trim(),
      phone:             form.phone.trim()          || undefined,
      email:             form.email.trim()          || undefined,
      id_number:         form.id_number.trim()      || undefined,
      kra_pin:           form.kra_pin.trim()        || undefined,
      customer_group_id: form.customer_group_id     || undefined,
    });
  };

  const toggleQuickCreate = () => {
    setQuickCreate((v) => {
      const next = !v;
      if (next && groups.length && !form.customer_group_id) {
        setForm((f) => ({ ...f, customer_group_id: groups[0].group_id }));
      }
      return next;
    });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl flex flex-col max-h-[88vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900">Select Customer</h2>
            <p className="text-xs text-gray-400 mt-0.5">Search or create a customer for this sale</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-4 space-y-3">

          {/* Walk-in option */}
          <button
            onClick={clearCustomer}
            className={`w-full flex items-center gap-3 rounded-xl border p-3 text-left transition-all ${
              !currentCust
                ? 'border-primary-400 bg-primary-50 ring-1 ring-primary-300'
                : 'border-gray-100 hover:border-primary-200 hover:bg-primary-50/50'
            }`}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 flex-shrink-0">
              <UserCircle className="h-5 w-5 text-gray-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-800">Walk-in Customer</p>
              <p className="text-xs text-gray-400">No loyalty tracking · anonymous sale</p>
            </div>
            {!currentCust && <BadgeCheck className="h-4 w-4 text-primary-500 flex-shrink-0" />}
            {currentCust  && <ChevronRight className="h-4 w-4 text-gray-300 flex-shrink-0" />}
          </button>

          {/* Search mode tabs */}
          <div className="flex gap-1 rounded-xl bg-gray-100 p-1">
            {SEARCH_MODES.map((m) => {
              const Icon = m.icon;
              return (
                <button
                  key={m.key}
                  onClick={() => setMode(m.key)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-all ${
                    mode === m.key
                      ? 'bg-white text-primary-700 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {m.label}
                </button>
              );
            })}
          </div>

          {/* Search input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              ref={searchRef}
              type="text"
              inputMode={mode === 'phone' ? 'tel' : 'text'}
              placeholder={activeMode.placeholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-9 text-sm focus:border-primary-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary-400 transition-all"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Results */}
          {debounced.length >= 1 && (
            <div className="space-y-1.5">
              {isFetching && !customers.length && (
                <div className="py-6 text-center">
                  <div className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary-400 border-t-transparent" />
                  <p className="mt-2 text-xs text-gray-400">Searching…</p>
                </div>
              )}

              {!isFetching && customers.length === 0 && (
                <div className="rounded-xl border border-dashed border-gray-200 py-6 text-center">
                  <UserCircle className="mx-auto mb-2 h-8 w-8 text-gray-300" />
                  <p className="text-sm text-gray-500 font-medium">No customers found</p>
                  <p className="text-xs text-gray-400 mt-0.5">for "{debounced}"</p>
                </div>
              )}

              {customers.map((c) => {
                const isSelected = currentCust?.customer_id === c.customer_id;
                const initials   = c.customer_name?.slice(0, 2).toUpperCase() || '??';
                return (
                  <button
                    key={c.customer_id}
                    onClick={() => select(c)}
                    className={`w-full flex items-center gap-3 rounded-xl border p-3 text-left transition-all ${
                      isSelected
                        ? 'border-primary-400 bg-primary-50 ring-1 ring-primary-300'
                        : 'border-gray-100 hover:border-primary-200 hover:bg-primary-50/50'
                    }`}
                  >
                    {/* Avatar */}
                    <div className={`flex h-10 w-10 items-center justify-center rounded-full flex-shrink-0 text-sm font-bold ${
                      isSelected ? 'bg-primary-600 text-white' : 'bg-primary-100 text-primary-700'
                    }`}>
                      {initials}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-semibold text-gray-900 truncate">{c.customer_name}</p>
                        {c.loyalty_points_balance > 0 && (
                          <span className="flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 flex-shrink-0">
                            <Gift className="h-2.5 w-2.5" />
                            {c.loyalty_points_balance.toLocaleString()}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        {c.phone && (
                          <span className="flex items-center gap-1 text-[11px] text-gray-400">
                            <Phone className="h-2.5 w-2.5" />
                            {c.phone}
                          </span>
                        )}
                        {c.id_number && (
                          <span className="text-[11px] text-gray-400">ID {c.id_number}</span>
                        )}
                      </div>
                    </div>

                    {/* Stats */}
                    <div className="text-right flex-shrink-0 space-y-0.5">
                      <p className="text-[11px] text-gray-400">{c.purchase_count ?? 0} sales</p>
                      {c.total_spent > 0 && (
                        <p className="text-xs font-semibold text-gray-700">{formatCurrency(c.total_spent)}</p>
                      )}
                    </div>

                    {isSelected && <BadgeCheck className="h-4 w-4 text-primary-500 flex-shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}

          {/* Prompt when no search yet */}
          {debounced.length === 0 && (
            <p className="text-center text-xs text-gray-400 py-2">
              {mode === 'id'
                ? 'Type a national ID number to find the customer'
                : mode === 'phone'
                ? 'Type a phone number to find the customer'
                : 'Start typing to search customers'}
            </p>
          )}

          {/* Quick-create toggle */}
          <button
            onClick={toggleQuickCreate}
            className="flex w-full items-center gap-2 rounded-xl border border-dashed border-gray-200 p-3 text-sm text-gray-500 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-600 transition-all"
          >
            <UserPlus className="h-4 w-4" />
            {quickCreate ? 'Cancel' : 'Create new customer'}
          </button>

          {/* Quick-create form */}
          {quickCreate && (
            <div className="rounded-xl border border-primary-200 bg-primary-50/60 p-4 space-y-3">
              <p className="text-sm font-semibold text-primary-800">New Customer</p>
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Full name *"
                  value={form.customer_name}
                  onChange={(e) => setForm((f) => ({ ...f, customer_name: e.target.value }))}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-400"
                  autoFocus
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="tel"
                    placeholder="Phone (07…)"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: normalizePhone(e.target.value) }))}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-400"
                  />
                  <input
                    type="email"
                    placeholder="Email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-400"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="National ID"
                    value={form.id_number}
                    onChange={(e) => setForm((f) => ({ ...f, id_number: e.target.value }))}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-400"
                  />
                  <input
                    type="text"
                    placeholder="KRA PIN"
                    value={form.kra_pin}
                    onChange={(e) => setForm((f) => ({ ...f, kra_pin: e.target.value }))}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-400"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Customer Posting Group</label>
                  <select
                    value={form.customer_group_id}
                    onChange={(e) => setForm((f) => ({ ...f, customer_group_id: e.target.value }))}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-400"
                  >
                    {groups.length === 0 && <option value="">— no groups defined —</option>}
                    {groups.map((g) => (
                      <option key={g.group_id} value={g.group_id}>{g.group_name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <Button
                fullWidth size="sm"
                loading={creating}
                disabled={!form.customer_name.trim()}
                onClick={handleCreate}
              >
                Create &amp; Select
              </Button>
            </div>
          )}
        </div>

        <div className="border-t border-gray-100 px-4 py-3">
          <Button variant="secondary" fullWidth onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}
