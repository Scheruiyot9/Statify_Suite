import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  Plus, Minus, UserCircle2, Percent, ChevronDown, Gift,
  Clock, BadgeCheck, Phone, X, Pencil,
  RotateCcw, XCircle, Wallet, ShoppingCart, Search,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useCartStore, useAuthStore } from '@/app/store';
import { formatCurrency, applyRounding } from '@/utils/formatters';
import api from '@/services/api';
import Button from '@/components/ui/Button';
import { ProductThumb } from './ProductGrid';
import CustomerSelectModal from './CustomerSelectModal';

// ── Inline item discount editor ───────────────────────────────────────────────
function ItemDiscountRow({ item, onClose }) {
  const setItemDiscount = useCartStore((s) => s.setItemDiscount);
  const [type,  setType]  = useState(item.discountType !== 'none' ? item.discountType : 'percent');
  const [value, setValue] = useState(item.discountValue > 0 ? String(item.discountValue) : '');

  const apply = () => {
    if (!value || parseFloat(value) <= 0) setItemDiscount(item.product.product_id, 0, 'none');
    else setItemDiscount(item.product.product_id, parseFloat(value), type);
    onClose();
  };

  return (
    <div className="mx-3 mb-1 rounded-lg border border-primary-100 bg-primary-50/60 p-2.5 space-y-2">
      <p className="text-[11px] font-semibold text-primary-700 flex items-center gap-1">
        <Percent className="h-3 w-3" /> Item Discount — {item.product.product_name}
      </p>
      <div className="flex items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-gray-200 text-xs font-medium">
          {['percent', 'fixed'].map((t) => (
            <button key={t} onClick={() => setType(t)}
              className={`px-3 py-1.5 transition-colors ${type === t ? 'bg-primary-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
              {t === 'percent' ? '%' : 'KES'}
            </button>
          ))}
        </div>
        <input
          type="number" min="0" max={type === 'percent' ? 100 : undefined} step="0.01"
          placeholder={type === 'percent' ? '0–100' : '0.00'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && apply()}
          className="flex-1 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm focus:border-primary-400 focus:outline-none"
        />
      </div>
      <div className="flex gap-1.5">
        <button onClick={() => { setItemDiscount(item.product.product_id, 0, 'none'); onClose(); }}
          className="flex-1 rounded-md border border-gray-200 bg-white py-1 text-xs text-gray-500 hover:bg-red-50 hover:text-red-600 transition-colors">
          Remove
        </button>
        <button onClick={apply}
          className="flex-1 rounded-md bg-primary-500 py-1 text-xs text-white hover:bg-primary-600 transition-colors">
          Apply
        </button>
        <button onClick={onClose}
          className="flex-1 rounded-md border border-gray-200 bg-white py-1 text-xs text-gray-500 hover:bg-gray-50 transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Order discount editor ─────────────────────────────────────────────────────
function OrderDiscountRow({ onClose }) {
  const { orderDiscount, orderDiscountType, setOrderDiscount, clearOrderDiscount } = useCartStore();
  const [type,  setType]  = useState(orderDiscountType || 'percent');
  const [value, setValue] = useState(orderDiscount > 0 ? String(orderDiscount) : '');

  const apply = () => {
    if (!value || parseFloat(value) <= 0) clearOrderDiscount();
    else setOrderDiscount(parseFloat(value), type);
    onClose();
  };

  return (
    <div className="border-t border-gray-100 px-4 py-3 bg-secondary-50/50 space-y-2">
      <p className="text-xs font-semibold text-secondary-700 flex items-center gap-1.5">
        <Percent className="h-3.5 w-3.5" /> Order Discount
      </p>
      <div className="flex items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-gray-200 text-xs font-medium">
          {['percent', 'fixed'].map((t) => (
            <button key={t} onClick={() => setType(t)}
              className={`px-3 py-1.5 transition-colors ${type === t ? 'bg-secondary-500 text-white' : 'bg-white text-gray-600'}`}>
              {t === 'percent' ? '%' : 'KES'}
            </button>
          ))}
        </div>
        <input
          type="number" min="0" step="0.01"
          placeholder={type === 'percent' ? '0–100' : '0.00'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && apply()}
          className="flex-1 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm focus:border-secondary-400 focus:outline-none"
        />
      </div>
      <div className="flex gap-1.5">
        <button onClick={() => { clearOrderDiscount(); onClose(); }}
          className="flex-1 rounded-md border border-gray-200 bg-white py-1 text-xs text-gray-500 hover:bg-red-50 hover:text-red-600 transition-colors">
          Remove
        </button>
        <button onClick={apply}
          className="flex-1 rounded-md bg-secondary-500 py-1 text-xs text-white hover:bg-secondary-600 transition-colors">
          Apply
        </button>
        <button onClick={onClose}
          className="flex-1 rounded-md border border-gray-200 bg-white py-1 text-xs text-gray-500 hover:bg-gray-50 transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Click-to-edit quantity ────────────────────────────────────────────────────
function QtyInput({ item }) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState('');
  const updateQuantity = useCartStore((s) => s.updateQuantity);

  const commit = () => {
    const n = parseFloat(draft);
    if (!isNaN(n) && n > 0) updateQuantity(item.product.product_id, Math.round(n * 100) / 100);
    setEditing(false);
  };

  const displayQty = Number.isInteger(item.quantity)
    ? item.quantity
    : item.quantity.toFixed(2).replace(/\.?0+$/, '');

  if (editing) {
    return (
      <input
        type="number" min="0.01" step="0.01"
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        className="w-14 rounded border border-primary-400 px-1 py-1 text-center text-sm font-semibold focus:outline-none"
      />
    );
  }
  return (
    <button
      onClick={() => { setDraft(String(item.quantity)); setEditing(true); }}
      title="Click to edit quantity"
      className="w-10 text-center text-sm font-bold text-gray-800 hover:text-primary-600 transition-colors"
    >
      {displayQty}
    </button>
  );
}

// ── Editable rate (unit price) column ────────────────────────────────────────
function RateCell({ item, editable }) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState('');
  const updateUnitPrice = useCartStore((s) => s.updateUnitPrice);

  const commit = () => {
    const n = parseFloat(draft);
    if (!isNaN(n) && n >= 0) updateUnitPrice(item.product.product_id, Math.round(n * 100) / 100);
    setEditing(false);
  };

  if (editing) return (
    <input
      type="number" min="0" step="0.01"
      value={draft} autoFocus
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
      className="w-full rounded border border-primary-400 px-1 py-0.5 text-right text-[11px] font-semibold focus:outline-none"
    />
  );
  return editable ? (
    <button
      onClick={() => { setDraft(String(item.unitPrice)); setEditing(true); }}
      title="Click to edit rate"
      className="block w-full text-right text-[11px] font-semibold text-primary-600 underline decoration-dotted hover:text-primary-800 transition-colors"
    >
      {formatCurrency(item.unitPrice)}
    </button>
  ) : (
    <span className="block w-full text-right text-[11px] font-semibold text-gray-700">
      {formatCurrency(item.unitPrice)}
    </span>
  );
}

// ── Editable total column ─────────────────────────────────────────────────────
function TotalCell({ item, editable, roundingMode, roundingUnit }) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState('');
  const updateUnitPrice = useCartStore((s) => s.updateUnitPrice);
  const setItemDiscount = useCartStore((s) => s.setItemDiscount);

  const commit = () => {
    const n = parseFloat(draft);
    if (!isNaN(n) && n > 0 && item.quantity > 0) {
      setItemDiscount(item.product.product_id, 0, 'none');
      updateUnitPrice(item.product.product_id, Math.round((n / item.quantity) * 100) / 100);
    }
    setEditing(false);
  };

  const displayed = applyRounding(item.lineTotal, roundingMode, roundingUnit);

  if (editing) return (
    <input
      type="number" min="0" step="0.01"
      value={draft} autoFocus
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
      className="w-full rounded border border-primary-400 px-1 py-0.5 text-right text-xs font-bold focus:outline-none"
    />
  );
  return editable ? (
    <button
      onClick={() => { setDraft(String(item.lineTotal)); setEditing(true); }}
      title="Click to edit total"
      className="block w-full text-right text-xs font-bold text-gray-900 underline decoration-dotted hover:text-primary-600 transition-colors"
    >
      {formatCurrency(displayed)}
    </button>
  ) : (
    <span className="block w-full text-right text-xs font-bold text-gray-900">
      {formatCurrency(displayed)}
    </span>
  );
}

// ── Partial-qty stepper helpers ───────────────────────────────────────────────
const QTR = [0.25, 0.5, 0.75];

function stepDown(qty) {
  if (qty > 1) return Math.round((qty - 1) * 100) / 100;
  if (qty === 1) return 0.75;
  const idx = QTR.indexOf(qty);
  return idx > 0 ? QTR[idx - 1] : 0.25; // floor at 0.25 (can't go lower)
}

function stepUp(qty) {
  const idx = QTR.indexOf(qty);
  if (idx !== -1 && qty < 1) return QTR[idx + 1] ?? 1;
  return Math.round((qty + 1) * 100) / 100;
}

// ── Hold dialog ───────────────────────────────────────────────────────────────
function HoldDialog({ onConfirm, onCancel }) {
  const [label, setLabel] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-xs rounded-2xl bg-white p-5 shadow-2xl space-y-4">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100">
            <Clock className="h-4 w-4 text-amber-600" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">Hold Transaction</p>
            <p className="text-xs text-gray-400">You can resume this cart any time</p>
          </div>
        </div>
        <input
          type="text" autoFocus
          placeholder="Label (optional — e.g. Table 3)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onConfirm(label); if (e.key === 'Escape') onCancel(); }}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none"
        />
        <div className="flex gap-2">
          <Button variant="secondary" fullWidth size="sm" onClick={onCancel}>Cancel</Button>
          <Button fullWidth size="sm" onClick={() => onConfirm(label)}>
            <Clock className="h-3.5 w-3.5 mr-1" /> Hold
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Inline customer typeahead ─────────────────────────────────────────────────
function CustomerTypeahead() {
  const customer    = useCartStore((s) => s.customer);
  const setCustomer = useCartStore((s) => s.setCustomer);

  const [search,     setSearch]     = useState('');
  const [debounced,  setDebounced]  = useState('');
  const [open,       setOpen]       = useState(false);
  const [modalOpen,  setModalOpen]  = useState(false);
  const containerRef = useRef(null);
  const inputRef     = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 280);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const { data, isFetching } = useQuery({
    queryKey: ['cust-inline', debounced],
    queryFn:  () => api.get('/customers', { params: { search: debounced, limit: 8 } }).then((r) => r.data.data?.customers ?? []),
    enabled:  debounced.length >= 2,
    staleTime: 30_000,
  });

  const results = data ?? [];

  const select = (c) => { setCustomer(c); setSearch(''); setOpen(false); };
  const clear  = () => setCustomer(null);

  // ── Shared dropdown ──
  const Dropdown = () => (
    open && debounced.length >= 2 ? (
      <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded-xl border border-gray-100 bg-white shadow-xl overflow-hidden">
        {isFetching && !results.length && (
          <div className="flex items-center justify-center gap-2 py-4 text-xs text-gray-400">
            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-400 border-t-transparent" />
            Searching…
          </div>
        )}
        {!isFetching && results.length === 0 && (
          <p className="py-4 text-center text-xs text-gray-400">No results for "{debounced}"</p>
        )}
        {results.map((c) => {
          const initials = c.customer_name?.slice(0, 2).toUpperCase() || '??';
          return (
            <button
              key={c.customer_id}
              onMouseDown={(e) => { e.preventDefault(); select(c); }}
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-primary-50 transition-colors border-b border-gray-50 last:border-0"
            >
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-700 text-xs font-bold">
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-900 truncate">{c.customer_name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  {c.phone     && <span className="text-[11px] text-gray-400">{c.phone}</span>}
                  {c.id_number && <span className="text-[11px] text-gray-400">ID {c.id_number}</span>}
                </div>
              </div>
              {c.loyalty_points_balance > 0 && (
                <span className="flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 flex-shrink-0">
                  <Gift className="h-2.5 w-2.5" />{c.loyalty_points_balance.toLocaleString()}
                </span>
              )}
            </button>
          );
        })}
      </div>
    ) : null
  );

  // ── No customer — walk-in + search + Select button ──
  if (!customer) {
    return (
      <>
        <div ref={containerRef} className="relative flex items-center gap-2">

          {/* Walk-in badge (default / active) */}
          <div className="flex items-center gap-1.5 flex-shrink-0 rounded-lg bg-gray-100 px-2 py-1">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white">
              <UserCircle2 className="h-3.5 w-3.5 text-gray-400" />
            </div>
            <div className="leading-tight">
              <p className="text-[11px] font-semibold text-gray-600">Walk-in</p>
            </div>
            <BadgeCheck className="h-3 w-3 text-gray-400" />
          </div>

          {/* Divider */}
          <div className="h-7 w-px bg-gray-200 flex-shrink-0" />

          {/* Inline search */}
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
              onFocus={() => search.length >= 2 && setOpen(true)}
              placeholder="Search by name, phone or ID…"
              className="w-full rounded-lg border border-gray-200 bg-gray-50 py-1.5 pl-7 pr-6 text-xs text-gray-700 placeholder-gray-400 focus:border-primary-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary-300 transition-all"
            />
            {search && (
              <button onClick={() => { setSearch(''); setOpen(false); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Full-modal Select button */}
          <button
            onClick={() => setModalOpen(true)}
            className="flex-shrink-0 rounded-lg border border-primary-200 bg-primary-50 px-2.5 py-1.5 text-[11px] font-semibold text-primary-700 hover:bg-primary-100 transition-colors"
          >
            Select
          </button>

          <Dropdown />
        </div>

        <CustomerSelectModal open={modalOpen} onClose={() => setModalOpen(false)} />
      </>
    );
  }

  // ── Customer selected ──
  const loyaltyPoints = customer.loyalty_points_balance ?? 0;
  const creditBalance = parseFloat(customer.credit_balance ?? 0);
  return (
    <>
      <div ref={containerRef} className="relative flex items-center gap-2">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-700 text-sm font-bold">
          {customer.customer_name[0]?.toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold text-gray-900 truncate">{customer.customer_name}</p>
            <BadgeCheck className="h-3.5 w-3.5 flex-shrink-0 text-primary-500" />
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {customer.phone && (
              <span className="flex items-center gap-1 text-[11px] text-gray-400">
                <Phone className="h-2.5 w-2.5" />{customer.phone}
              </span>
            )}
            {loyaltyPoints > 0 && (
              <span className="flex items-center gap-1 text-[11px] font-medium text-amber-600">
                <Gift className="h-2.5 w-2.5" />{loyaltyPoints.toLocaleString()} pts
              </span>
            )}
            {creditBalance > 0 && (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-orange-500">
                <Wallet className="h-2.5 w-2.5" />Balance {formatCurrency(creditBalance)}
              </span>
            )}
          </div>
        </div>

        {/* Change — opens modal pre-loaded to swap customer */}
        <button
          onClick={() => setModalOpen(true)}
          className="flex-shrink-0 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-medium text-gray-500 hover:border-primary-300 hover:text-primary-600 transition-colors"
        >
          Change
        </button>

        {/* Clear to walk-in */}
        <button
          onClick={clear}
          title="Back to walk-in"
          className="flex-shrink-0 rounded-full p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <CustomerSelectModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}


// ── Main Cart ─────────────────────────────────────────────────────────────────
export default function Cart({ session, onCheckout, onSalesReturn, onCartCleared }) {
  const {
    items, updateQuantity, removeItem, clearCart, totals,
    orderDiscount, orderDiscountType, setOrderDiscount, clearOrderDiscount,
    defaultTax, notes, setNotes,
  } = useCartStore();
  const { subtotal, tax, itemDiscounts, orderDiscountAmt, total } = totals();
  const branchId = session?.branch_id ?? useAuthStore.getState().user?.branchIds?.[0];

  // Read company POS settings from the cached query (AppLayout already fetches this)
  const qc = useQueryClient();
  const companySettings = qc.getQueryData(['my-company']);
  const allowPriceEdit  = companySettings?.pos_allow_price_edit  ?? false;
  const allowPartialQty = companySettings?.pos_allow_partial_qty ?? false;
  const allowTotalEdit  = companySettings?.pos_allow_total_edit  ?? false;
  const roundingMode    = companySettings?.pos_rounding_mode     || 'none';
  const roundingUnit    = parseFloat(companySettings?.pos_rounding_unit ?? 1);
  const displayTotal    = applyRounding(total, roundingMode, roundingUnit);

  const holdMut = useMutation({
    mutationFn: ({ label, cartData }) =>
      api.post('/pos/holds', { label, cartData, branchId }).then((r) => r.data.data),
    onSuccess: (_, { label }) => {
      qc.invalidateQueries({ queryKey: ['pos-holds'] });
      clearCart();
      setHoldDialogOpen(false);
      toast.success(label ? `"${label}" held` : 'Cart held');
      onCartCleared?.();
    },
    onError: () => toast.error('Failed to hold cart'),
  });

  const [discountItemId, setDiscountItemId] = useState(null);
  const [orderDiscOpen,  setOrderDiscOpen]  = useState(false);
  const [holdDialogOpen, setHoldDialogOpen] = useState(false);
  const [showNotes,         setShowNotes]         = useState(false);
  const [cancelConfirm,     setCancelConfirm]     = useState(false);
  const [editingTotal,      setEditingTotal]      = useState(false);
  const [totalDraft,        setTotalDraft]        = useState('');

  // Auto-reset cancel confirmation after 3 s
  useEffect(() => {
    if (!cancelConfirm) return;
    const t = setTimeout(() => setCancelConfirm(false), 3000);
    return () => clearTimeout(t);
  }, [cancelConfirm]);

  // Close discount editor if item is removed
  useEffect(() => {
    if (discountItemId && !items.find((i) => i.product.product_id === discountItemId)) {
      setDiscountItemId(null);
    }
  }, [items, discountItemId]);

  const handleHold = (label) => {
    const snap = useCartStore.getState();
    holdMut.mutate({
      label,
      cartData: {
        items:             snap.items,
        customer:          snap.customer,
        notes:             snap.notes,
        orderDiscount:     snap.orderDiscount,
        orderDiscountType: snap.orderDiscountType,
      },
    });
  };

  const handleCancelSale = () => {
    if (!cancelConfirm) { setCancelConfirm(true); return; }
    clearCart();
    setCancelConfirm(false);
    toast('Sale cancelled', { icon: '🗑' });
    onCartCleared?.();
  };

  const totalQty = Math.round(items.reduce((n, i) => n + i.quantity, 0) * 100) / 100;

  return (
    <div className="flex h-full w-full flex-col bg-white">

      {/* ── Customer section ── */}
      <div className="border-b border-gray-100 px-4 py-2.5">
        <CustomerTypeahead />
      </div>

      {/* ── Items area ── */}
      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-50">
              <ShoppingCart className="h-8 w-8 text-gray-200" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-gray-400">Cart is empty</p>
              <p className="text-xs text-gray-300 mt-0.5">Tap a product to add it</p>
            </div>
          </div>
        ) : (
          <>
            {/* Column headings */}
            <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-gray-100 bg-gray-50/95 px-3 py-1.5">
              <div className="w-9 flex-shrink-0" />
              <div className="w-[28%] flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Item</div>
              <div className="w-[16%] flex-shrink-0 text-right text-[10px] font-semibold uppercase tracking-wide text-gray-400">Rate</div>
              <div className="w-[92px] flex-shrink-0 text-center text-[10px] font-semibold uppercase tracking-wide text-gray-400">Qty</div>
              <div className="flex-1 text-right text-[10px] font-semibold uppercase tracking-wide text-gray-400">Total</div>
              <div className="w-[52px] flex-shrink-0" />
            </div>

            {/* Rows */}
            {items.map((item) => (
              <div key={item.product.product_id} className="border-b border-gray-50 last:border-0">
                <div className="flex items-center gap-2 px-3 py-2.5 hover:bg-gray-50/60 transition-colors">

                  {/* Thumb */}
                  <div className="flex-shrink-0">
                    <ProductThumb product={item.product} size="sm" />
                  </div>

                  {/* Name + SKU */}
                  <div className="w-[28%] flex-shrink-0 min-w-0">
                    <p className="truncate text-xs font-semibold text-gray-800 leading-snug">
                      {item.product.product_name}
                    </p>
                    <p className="text-[10px] text-gray-400 font-mono truncate leading-snug">
                      {item.product.barcode || item.product.sku || `#${item.product.product_id}`}
                    </p>
                  </div>

                  {/* Rate column */}
                  <div className="w-[16%] flex-shrink-0 min-w-0">
                    <RateCell item={item} editable={allowPriceEdit} />
                  </div>

                  {/* Stepper */}
                  <div className="flex items-center gap-1 flex-shrink-0 w-28 justify-center">
                    {(() => {
                      const atMin = allowPartialQty ? item.quantity <= 0.25 : item.quantity <= 1;
                      const handleDown = () => {
                        if (atMin) return;
                        const next = allowPartialQty ? stepDown(item.quantity) : item.quantity - 1;
                        updateQuantity(item.product.product_id, next);
                      };
                      const handleUp = () => {
                        const next = allowPartialQty ? stepUp(item.quantity) : item.quantity + 1;
                        updateQuantity(item.product.product_id, next);
                      };
                      return (
                        <>
                          <button
                            onClick={handleDown}
                            disabled={atMin}
                            className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
                              atMin
                                ? 'bg-gray-50 text-gray-300 cursor-not-allowed'
                                : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                            }`}
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <QtyInput item={item} />
                          <button
                            onClick={handleUp}
                            className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </>
                      );
                    })()}
                  </div>

                  {/* Total (editable) */}
                  <div className="flex-1 min-w-0">
                    <TotalCell item={item} editable={allowPriceEdit} roundingMode={roundingMode} roundingUnit={roundingUnit} />
                    {item.discount > 0 && (
                      <span className="block text-right text-[9px] font-semibold text-green-600">
                        −{formatCurrency(item.discount)}
                      </span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <button
                      onClick={() => setDiscountItemId(discountItemId === item.product.product_id ? null : item.product.product_id)}
                      title="Item discount"
                      className={`rounded p-1.5 transition-colors ${
                        item.discount > 0
                          ? 'bg-green-100 text-green-600 hover:bg-green-200'
                          : 'text-gray-300 hover:bg-gray-100 hover:text-gray-500'
                      }`}
                    >
                      <Percent className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => removeItem(item.product.product_id)}
                      className="rounded p-1.5 text-gray-300 hover:bg-red-50 hover:text-red-500 transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {discountItemId === item.product.product_id && (
                  <ItemDiscountRow item={item} onClose={() => setDiscountItemId(null)} />
                )}
              </div>
            ))}

            {/* Summary + notes row */}
            <div className="flex items-center justify-between border-t border-gray-50 bg-gray-50 px-3 py-1.5">
              <p className="text-[11px] text-gray-400">
                {items.length} line{items.length !== 1 ? 's' : ''} ·{' '}
                <span className="font-semibold text-gray-600">{totalQty} qty</span>
              </p>
              <button
                onClick={() => setShowNotes((v) => !v)}
                className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
              >
                <Pencil className="h-3 w-3" />
                {notes ? <span className="italic text-gray-500 max-w-[140px] truncate">{notes}</span> : 'Note'}
              </button>
            </div>

            {showNotes && (
              <div className="border-t border-gray-100 flex items-start gap-2 px-3 py-2 bg-white">
                <textarea
                  autoFocus rows={2}
                  value={notes || ''}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Order notes…"
                  className="flex-1 resize-none rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-700 focus:border-primary-400 focus:outline-none"
                />
                <button onClick={() => setShowNotes(false)} className="mt-1 rounded p-1 text-gray-400 hover:text-gray-600">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Order discount editor */}
      {orderDiscOpen && <OrderDiscountRow onClose={() => setOrderDiscOpen(false)} />}

      {/* ── Totals ── */}
      <div className="border-t border-gray-100 bg-gray-50/60 px-4 py-2 space-y-1">
        {itemDiscounts > 0 && (
          <div className="flex justify-between text-xs text-green-600">
            <span>Item discounts</span>
            <span>−{formatCurrency(itemDiscounts)}</span>
          </div>
        )}

        {/* Order discount toggle */}
        <button
          onClick={() => setOrderDiscOpen((v) => !v)}
          disabled={!items.length}
          className={[
            'flex w-full items-center justify-between rounded-lg px-2 py-1 text-xs transition-all disabled:opacity-40',
            orderDiscountAmt > 0 ? 'bg-green-50 text-green-700' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600',
          ].join(' ')}
        >
          <span className="flex items-center gap-1">
            <Percent className="h-3 w-3" />
            {orderDiscountAmt > 0
              ? `Order discount${orderDiscountType === 'percent' ? ` (${orderDiscount}%)` : ''}`
              : 'Add order discount'}
          </span>
          {orderDiscountAmt > 0
            ? <span className="font-semibold text-green-700">−{formatCurrency(orderDiscountAmt)}</span>
            : <ChevronDown className={`h-3 w-3 transition-transform ${orderDiscOpen ? 'rotate-180' : ''}`} />
          }
        </button>

        <div className="flex items-baseline justify-between border-t border-gray-200 pt-1.5">
          <span className="text-sm font-bold text-gray-800">Total</span>
          {allowTotalEdit && items.length > 0 && editingTotal ? (
            <input
              autoFocus
              type="number"
              min="0"
              step="0.01"
              value={totalDraft}
              onChange={(e) => setTotalDraft(e.target.value)}
              onBlur={() => {
                const n = parseFloat(totalDraft);
                if (!isNaN(n) && n >= 0 && n < subtotal) {
                  setOrderDiscount(subtotal - n, 'fixed');
                } else if (!isNaN(n) && n >= subtotal) {
                  clearOrderDiscount();
                }
                setEditingTotal(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.target.blur();
                if (e.key === 'Escape') { setEditingTotal(false); }
              }}
              className="w-32 rounded-lg border border-primary-400 bg-white px-2 py-1 text-right text-xl font-bold text-secondary-600 focus:outline-none focus:ring-2 focus:ring-primary-300"
            />
          ) : (
            <button
              disabled={!allowTotalEdit || !items.length}
              onClick={() => { setTotalDraft(total.toFixed(2)); setEditingTotal(true); }}
              title={allowTotalEdit ? 'Click to set a custom total' : undefined}
              className={`text-2xl font-bold text-secondary-600 leading-none ${allowTotalEdit && items.length ? 'cursor-pointer hover:opacity-75 active:opacity-60 transition-opacity' : 'cursor-default'}`}
            >
              {formatCurrency(displayTotal)}
              {displayTotal !== total && (
                <span className="block text-[11px] font-normal text-gray-400 text-right">{formatCurrency(total)}</span>
              )}
            </button>
          )}
        </div>
        {tax > 0 && (
          <p className="text-[11px] text-gray-400 text-right">
            incl. {defaultTax?.template_name ?? 'VAT'} {formatCurrency(tax)}
          </p>
        )}
      </div>

      {/* ── Action strip ── */}
      <div className="border-t border-gray-100 p-3 space-y-2">
        {/* Hold · Cancel · Return */}
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => items.length && setHoldDialogOpen(true)}
            disabled={!items.length}
            className="flex flex-col items-center gap-1 rounded-xl border border-amber-200 bg-amber-50 py-3 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 active:scale-[0.97] disabled:opacity-40 transition-all"
          >
            <Clock className="h-4 w-4 text-amber-500" />
            Hold
          </button>

          <button
            onClick={handleCancelSale}
            disabled={!items.length && !cancelConfirm}
            className={[
              'flex flex-col items-center gap-1 rounded-xl border py-3 text-[11px] font-semibold transition-all active:scale-[0.97] disabled:opacity-40',
              cancelConfirm
                ? 'animate-pulse border-red-400 bg-red-100 text-red-700'
                : 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100',
            ].join(' ')}
          >
            <XCircle className="h-4 w-4 text-red-500" />
            {cancelConfirm ? 'Confirm?' : 'Cancel'}
          </button>

          <button
            onClick={onSalesReturn}
            className="flex flex-col items-center gap-1 rounded-xl border border-teal-200 bg-teal-50 py-3 text-[11px] font-semibold text-teal-700 hover:bg-teal-100 active:scale-[0.97] transition-all"
          >
            <RotateCcw className="h-4 w-4 text-teal-500" />
            Return
          </button>
        </div>

        {/* Pay */}
        <Button
          variant="accent"
          fullWidth
          onClick={onCheckout}
          disabled={!items.length}
          className="h-14 !text-base !font-bold !rounded-xl shadow-md"
        >
          <span className="flex items-center gap-2">
            Pay {formatCurrency(displayTotal)}
            <kbd className="rounded bg-black/15 px-1.5 py-0.5 text-[10px] font-mono">F2</kbd>
          </span>
        </Button>
      </div>

      {/* ── Modals ── */}
      {holdDialogOpen && (
        <HoldDialog onConfirm={handleHold} onCancel={() => setHoldDialogOpen(false)} />
      )}
    </div>
  );
}
