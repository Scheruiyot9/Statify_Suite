import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useAuthStore = create(
  persist(
    (set) => ({
      user:         null,
      accessToken:  null,
      // refreshToken is now an httpOnly cookie — never stored in JS memory or localStorage

      activeCompanyId:   null,
      activeCompanyName: null,

      // ── Terminal lock ─────────────────────────────────────────────────────
      isLocked:            false,  // whether the lock screen is showing
      pinHash:             null,   // SHA-256(pin:userId) — for offline unlock
      lockTimeoutMinutes:  null,   // from company settings; null = disabled

      setAuth: (user, accessToken) =>
        set({
          user,
          accessToken,
          // Sync PIN data from login / me response whenever available
          ...(user.pinHash             !== undefined && { pinHash: user.pinHash }),
          ...(user.lockTimeoutMinutes  !== undefined && { lockTimeoutMinutes: user.lockTimeoutMinutes }),
        }),

      setAccessToken: (accessToken) => set({ accessToken }),

      clearAuth: () => set({
        user: null, accessToken: null,
        activeCompanyId: null, activeCompanyName: null,
        isLocked: false, pinHash: null, lockTimeoutMinutes: null,
      }),

      setActiveCompany: (id, name) => set({ activeCompanyId: id, activeCompanyName: name }),
      clearActiveCompany: () => set({ activeCompanyId: null, activeCompanyName: null }),

      // Lock actions
      lock:   () => set({ isLocked: true }),
      unlock: () => set({ isLocked: false }),
      setPinHash:            (hash)    => set({ pinHash: hash }),
      setLockTimeoutMinutes: (minutes) => set({ lockTimeoutMinutes: minutes }),
    }),
    {
      name: 'statify-auth',
      partialize: (s) => ({
        user:                s.user,
        accessToken:         s.accessToken,
        activeCompanyId:     s.activeCompanyId,
        activeCompanyName:   s.activeCompanyName,
        pinHash:             s.pinHash,
        lockTimeoutMinutes:  s.lockTimeoutMinutes,
        // isLocked intentionally NOT persisted — always starts unlocked on fresh load
      }),
    }
  )
);

// ── POS Cart Store ────────────────────────────────────────────────────────────
// In-memory only — resets on page reload (intentional for POS terminal security)
//
// Each item shape:
//   { product, quantity, unitPrice, discountType, discountValue, discount, taxAmount, lineTotal }
//
// Tax model (consistent for both exclusive & inclusive):
//   gross     = quantity × unitPrice − discount   (raw amount before tax split)
//   lineTotal = pre-tax portion of gross          (always)
//   taxAmount = the tax portion of gross          (always)
//   lineTotal + taxAmount = gross = what customer pays for this line
//
// Exclusive (tax added on top):
//   lineTotal = gross,  taxAmount = gross × rate/100
//   Customer pays: gross + taxAmount
//
// Inclusive (tax embedded in price):
//   taxAmount = gross × rate/(100+rate),  lineTotal = gross − taxAmount
//   Customer pays: lineTotal + taxAmount = gross (no extra charged)
//
// This means the backend formula  total = Σ(lineTotal) + Σ(taxAmount)
// is correct for BOTH cases with no special-casing.

function computeItemDiscount(quantity, unitPrice, discountType, discountValue) {
  const raw = parseFloat(discountValue) || 0;
  if (discountType === 'percent') {
    return Math.min((quantity * unitPrice * raw) / 100, quantity * unitPrice);
  }
  if (discountType === 'fixed') {
    return Math.min(raw, quantity * unitPrice);
  }
  return 0;
}

// Resolve which tax to apply for an item:
// product-level tax takes priority over company default.
function resolveItemTax(product, defaultTax) {
  if (product?.tax_template_id && product.tax_rate != null) {
    return { tax_rate: product.tax_rate, is_inclusive: product.tax_inclusive ?? false };
  }
  if (defaultTax && defaultTax.tax_rate != null) {
    return { tax_rate: defaultTax.tax_rate, is_inclusive: defaultTax.is_inclusive ?? false };
  }
  return null;
}

// Extract the VAT amount embedded in a gross price (informational only — never added to total).
// Always uses the inclusive formula: taxAmount = gross × rate / (100 + rate)
// For exclusive-tagged templates the same formula applies because the price the user
// entered IS the amount the customer pays; we simply surface the VAT component.
function extractTax(gross, taxConfig) {
  if (!taxConfig || taxConfig.tax_rate <= 0) return 0;
  return +(gross * taxConfig.tax_rate / (100 + taxConfig.tax_rate)).toFixed(4);
}

export const useCartStore = create((set, get) => ({
  items:             [],
  customer:          null,
  session:           null,
  notes:             '',
  orderDiscount:     0,
  orderDiscountType: 'fixed', // 'fixed' | 'percent'
  defaultTax:        null,    // { tax_rate, is_inclusive, template_name, tax_template_id }

  setDefaultTax: (tax) => set({ defaultTax: tax }),

  setSession:  (session)  => set({ session }),
  setCustomer: (customer) => set({ customer }),
  setNotes:    (notes)    => set({ notes }),

  setOrderDiscount: (value, type = 'fixed') =>
    set({ orderDiscount: parseFloat(value) || 0, orderDiscountType: type }),

  clearOrderDiscount: () => set({ orderDiscount: 0, orderDiscountType: 'fixed' }),

  addItem: (product, branchPrice) => {
    const { items, defaultTax } = get();
    const existing = items.find((i) => i.product.product_id === product.product_id);
    if (existing) {
      const newQty   = existing.quantity + 1;
      const discount = computeItemDiscount(newQty, existing.unitPrice, existing.discountType, existing.discountValue);
      const lineTotal = newQty * existing.unitPrice - discount;
      const taxAmount = extractTax(lineTotal, resolveItemTax(existing.product, defaultTax));
      set({
        items: items.map((i) =>
          i.product.product_id === product.product_id
            ? { ...i, quantity: newQty, discount, lineTotal, taxAmount }
            : i
        ),
      });
    } else {
      const unitPrice = branchPrice ?? product.base_price;
      const lineTotal = unitPrice;
      const taxAmount = extractTax(lineTotal, resolveItemTax(product, defaultTax));
      set({
        items: [
          ...items,
          {
            product,
            quantity:      1,
            unitPrice,
            discountType:  'none',
            discountValue: 0,
            discount:      0,
            taxAmount,
            lineTotal,
          },
        ],
      });
    }
  },

  updateQuantity: (productId, quantity) => {
    if (quantity <= 0) return get().removeItem(productId);
    const { defaultTax } = get();
    set({
      items: get().items.map((i) => {
        if (i.product.product_id !== productId) return i;
        const discount  = computeItemDiscount(quantity, i.unitPrice, i.discountType, i.discountValue);
        const lineTotal = quantity * i.unitPrice - discount;
        const taxAmount = extractTax(lineTotal, resolveItemTax(i.product, defaultTax));
        return { ...i, quantity, discount, lineTotal, taxAmount };
      }),
    });
  },

  updateUnitPrice: (productId, newPrice) => {
    const { defaultTax } = get();
    set({
      items: get().items.map((i) => {
        if (i.product.product_id !== productId) return i;
        const discount  = computeItemDiscount(i.quantity, newPrice, i.discountType, i.discountValue);
        const lineTotal = i.quantity * newPrice - discount;
        const taxAmount = extractTax(lineTotal, resolveItemTax(i.product, defaultTax));
        return { ...i, unitPrice: newPrice, discount, lineTotal, taxAmount };
      }),
    });
  },

  setItemDiscount: (productId, discountValue, discountType) => {
    const { defaultTax } = get();
    set({
      items: get().items.map((i) => {
        if (i.product.product_id !== productId) return i;
        const discount  = computeItemDiscount(i.quantity, i.unitPrice, discountType, discountValue);
        const lineTotal = i.quantity * i.unitPrice - discount;
        const taxAmount = extractTax(lineTotal, resolveItemTax(i.product, defaultTax));
        return {
          ...i,
          discountType,
          discountValue: parseFloat(discountValue) || 0,
          discount,
          lineTotal,
          taxAmount,
        };
      }),
    });
  },

  removeItem: (productId) =>
    set({ items: get().items.filter((i) => i.product.product_id !== productId) }),

  clearCart: () => set({
    items: [], customer: null, notes: '',
    orderDiscount: 0, orderDiscountType: 'fixed',
  }),

  loadFromHold: (hold) => set({
    items:             hold.items            ?? [],
    customer:          hold.customer         ?? null,
    notes:             hold.notes            ?? '',
    orderDiscount:     hold.orderDiscount    ?? 0,
    orderDiscountType: hold.orderDiscountType ?? 'fixed',
  }),

  totals: () => {
    const { items, orderDiscount, orderDiscountType } = get();
    // lineTotal = qty × unitPrice − itemDiscount (what the customer pays per line, VAT inclusive).
    // taxAmount = VAT extracted from lineTotal — informational only, never added to total.
    const subtotal      = items.reduce((s, i) => s + (i.lineTotal || 0), 0);
    const tax           = items.reduce((s, i) => s + (i.taxAmount || 0), 0); // display only
    const itemDiscounts = items.reduce((s, i) => s + (i.discount  || 0), 0);
    const orderDiscountAmt = orderDiscountType === 'percent'
      ? subtotal * (orderDiscount / 100)
      : Math.min(orderDiscount, subtotal);
    const total = Math.max(0, subtotal - orderDiscountAmt);
    return { subtotal, tax, itemDiscounts, orderDiscountAmt, total };
  },
}));

// ── POS Data Store (persisted — holds + offline queue survive page refresh) ────
export const usePosDataStore = create(
  persist(
    (set, get) => ({
      holds:        [],
      offlineQueue: [],

      // ── Holds ────────────────────────────────────────────────────────────────
      holdCart: (snapshot, label) => {
        const hold = {
          id:                `hold-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          savedAt:           new Date().toISOString(),
          label:             label || null,
          items:             snapshot.items,
          customer:          snapshot.customer ?? null,
          notes:             snapshot.notes    ?? '',
          orderDiscount:     snapshot.orderDiscount    ?? 0,
          orderDiscountType: snapshot.orderDiscountType ?? 'fixed',
        };
        set({ holds: [...get().holds, hold] });
        return hold.id;
      },

      deleteHold: (id) =>
        set({ holds: get().holds.filter((h) => h.id !== id) }),

      // ── Offline queue ─────────────────────────────────────────────────────────
      enqueueTransaction: (payload, sessionId) => {
        const id = `offline-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const item = {
          id,
          queuedAt:        new Date().toISOString(),
          status:          'pending',
          // idempotencyKey is stable for this queued item across retries
          payload:         { ...payload, sessionId: sessionId ?? payload.sessionId, idempotencyKey: id },
          errorMsg:        null,
        };
        set({ offlineQueue: [...get().offlineQueue, item] });
        return id;
      },

      markSynced: (id) =>
        set({ offlineQueue: get().offlineQueue.filter((q) => q.id !== id) }),

      markFailed: (id, errorMsg) =>
        set({
          offlineQueue: get().offlineQueue.map((q) =>
            q.id === id ? { ...q, status: 'failed', errorMsg } : q
          ),
        }),

      retryItem: (id) =>
        set({
          offlineQueue: get().offlineQueue.map((q) =>
            q.id === id ? { ...q, status: 'pending', errorMsg: null } : q
          ),
        }),
    }),
    { name: 'statify-pos-data' }
  )
);
