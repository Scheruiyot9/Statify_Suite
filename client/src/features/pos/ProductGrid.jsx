import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, ScanLine, X, WifiOff, LayoutGrid, List, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/services/api';
import { useCartStore } from '@/app/store';
import { formatCurrency } from '@/utils/formatters';
import useNetworkStatus from '@/hooks/useNetworkStatus';
import useDebounce from '@/hooks/useDebounce';

function loadProductCache(branchId) {
  try {
    const raw = localStorage.getItem(`pos-products-cache-${branchId}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveProductCache(branchId, products) {
  try {
    localStorage.setItem(`pos-products-cache-${branchId}`, JSON.stringify(products));
  } catch {}
}

const TILE_COLORS = [
  'bg-primary-100 text-primary-700',
  'bg-secondary-100 text-secondary-700',
  'bg-green-100 text-green-700',
  'bg-purple-100 text-purple-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-cyan-100 text-cyan-700',
];

function tileColor(name = '') {
  return TILE_COLORS[(name.charCodeAt(0) || 0) % TILE_COLORS.length];
}

export function ProductThumb({ product, size = 'md' }) {
  const [imgError, setImgError] = useState(false);
  const dim = size === 'sm' ? 'h-9 w-9 text-sm' : 'h-14 w-14 text-xl';
  if (product.image_url && !imgError) {
    return (
      <img
        src={product.image_url}
        alt={product.product_name}
        onError={() => setImgError(true)}
        className={`${dim} rounded-lg object-cover flex-shrink-0`}
      />
    );
  }
  return (
    <div className={`${dim} flex flex-shrink-0 items-center justify-center rounded-lg font-bold ${tileColor(product.product_name)}`}>
      {product.product_name[0]?.toUpperCase()}
    </div>
  );
}

function ProductCardImage({ product }) {
  const [imgError, setImgError] = useState(false);
  if (product.image_url && !imgError) {
    return (
      <img
        src={product.image_url}
        alt={product.product_name}
        onError={() => setImgError(true)}
        className="h-full w-full object-cover"
      />
    );
  }
  return (
    <div className={`flex h-full w-full items-center justify-center text-3xl font-bold ${tileColor(product.product_name)}`}>
      {product.product_name[0]?.toUpperCase()}
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="flex animate-pulse flex-col overflow-hidden rounded-xl border border-gray-100 bg-white">
      <div className="aspect-[4/3] w-full bg-gray-100" />
      <div className="space-y-1.5 p-2">
        <div className="h-3 w-3/4 rounded-md bg-gray-100" />
        <div className="h-4 w-1/2 rounded-md bg-gray-100" />
        <div className="h-2.5 w-1/3 rounded-md bg-gray-100" />
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="flex animate-pulse items-center gap-3 rounded-xl border border-gray-100 bg-white px-3 py-2.5">
      <div className="h-9 w-9 flex-shrink-0 rounded-lg bg-gray-100" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 w-2/3 rounded bg-gray-100" />
        <div className="h-2.5 w-1/3 rounded bg-gray-100" />
      </div>
      <div className="flex flex-col items-end gap-1.5">
        <div className="h-4 w-16 rounded bg-gray-100" />
        <div className="h-2.5 w-10 rounded bg-gray-100" />
      </div>
    </div>
  );
}

export default function ProductGrid({ branchId, scanResetTrigger }) {
  const [search,     setSearch]     = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [scanMode,   setScanMode]   = useState(true);   // always start in scan mode
  const [barcodeVal, setBarcodeVal] = useState('');
  const [viewMode,   setViewMode]   = useState(
    () => localStorage.getItem('pos-view-mode') || 'grid'
  );
  const barcodeRef = useRef(null);
  const searchRef  = useRef(null);
  const addItem    = useCartStore((s) => s.addItem);
  const cartItems  = useCartStore((s) => s.items);
  const isOnline   = useNetworkStatus();
  const qc         = useQueryClient();

  const debouncedSearch = useDebounce(search, 300);

  useEffect(() => {
    localStorage.setItem('pos-view-mode', viewMode);
  }, [viewMode]);

  // Return to scan mode after sale / cancel / clear
  useEffect(() => {
    if (scanResetTrigger == null) return;
    setScanMode(true);
    setBarcodeVal('');
    setSearch('');
    setTimeout(() => barcodeRef.current?.focus(), 80);
  }, [scanResetTrigger]);

  const { data: liveProducts, isLoading, isError, fetchStatus } = useQuery({
    queryKey: ['pos-products', branchId, debouncedSearch, categoryId],
    queryFn: () =>
      api.get('/pos/products', { params: { branchId, search: debouncedSearch, categoryId, limit: 200 } })
         .then((r) => r.data.data.products ?? r.data.data),
    enabled: !!branchId && isOnline,
  });

  useEffect(() => {
    if (liveProducts && !debouncedSearch && !categoryId && branchId) {
      saveProductCache(branchId, liveProducts);
    }
  }, [liveProducts, debouncedSearch, categoryId, branchId]);

  // Fall back to localStorage cache when:
  //  (a) explicitly offline — enabled:false, so liveProducts is undefined, or
  //  (b) fetch errored — server unreachable but the 30-s ping hasn't flipped isOnline yet
  const cachedProducts = (!isOnline || isError) ? loadProductCache(branchId) : null;
  const products       = liveProducts ?? cachedProducts ?? undefined;
  const usingCache     = !liveProducts && products != null;

  // When enabled:false (offline, no in-flight request), React Query sets
  // isLoading:true with fetchStatus:'idle' — don't show the spinner for that.
  const isActuallyLoading = isLoading && fetchStatus !== 'idle';

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get('/products/categories').then((r) => r.data.data),
  });

  useEffect(() => {
    if (scanMode) barcodeRef.current?.focus();
    else          searchRef.current?.focus();
  }, [scanMode]);

  const refreshProducts = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['pos-products', branchId] });
  }, [qc, branchId]);

  const handleBarcodeScan = useCallback((code) => {
    if (!code.trim()) return;
    const exact = (products ?? []).find(
      (p) => p.barcode === code.trim() || p.sku === code.trim()
    );
    if (exact) {
      const outOfStock = exact.track_inventory !== false && parseFloat(exact.quantity_available ?? 0) <= 0;
      if (outOfStock) {
        toast.error(`${exact.product_name} is out of stock`);
      } else {
        addItem(exact, exact.branch_price);
        toast.success(`${exact.product_name} added`, { duration: 1200 });
        refreshProducts();
      }
    } else {
      api.get('/pos/products', { params: { branchId, search: code.trim(), limit: 5 } })
        .then((r) => {
          const list  = r.data.data.products ?? r.data.data ?? [];
          const match = list.find((p) => p.barcode === code.trim() || p.sku === code.trim());
          if (match) {
            addItem(match, match.branch_price);
            toast.success(`${match.product_name} added`, { duration: 1200 });
            refreshProducts();
          } else {
            toast.error(`No product found for "${code.trim()}"`, { duration: 2000 });
          }
        })
        .catch(() => toast.error('Barcode lookup failed'));
    }
    setBarcodeVal('');
  }, [products, branchId, addItem, refreshProducts]);

  const cartQtyMap = Object.fromEntries(
    cartItems.map((i) => [i.product.product_id, i.quantity])
  );

  return (
    <div className="flex h-full flex-col bg-gray-50">

      {/* ── Toolbar ── */}
      <div className="flex gap-2 border-b border-gray-200 bg-white p-2.5">
        {scanMode ? (
          <div className="relative flex-1">
            <ScanLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary-500" />
            <input
              ref={barcodeRef}
              type="text"
              placeholder="Scan or type barcode, then press Enter…"
              value={barcodeVal}
              onChange={(e) => setBarcodeVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { handleBarcodeScan(barcodeVal); e.preventDefault(); } }}
              className="w-full rounded-lg border-2 border-primary-400 bg-primary-50 py-2 pl-9 pr-3 text-sm font-medium focus:outline-none"
            />
          </div>
        ) : (
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search products…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-8 text-sm focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-400/30"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Scan toggle */}
        <button
          onClick={() => { setScanMode((v) => !v); setBarcodeVal(''); setSearch(''); }}
          title={scanMode ? 'Switch to search' : 'Barcode scan mode'}
          className={[
            'flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-all',
            scanMode
              ? 'border-primary-500 bg-primary-500 text-white'
              : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-700',
          ].join(' ')}
        >
          <ScanLine className="h-3.5 w-3.5" />
          {scanMode ? 'Search' : 'Scan'}
        </button>

        {/* Grid / List toggle */}
        <div className="flex overflow-hidden rounded-lg border border-gray-200 bg-white">
          <button
            onClick={() => setViewMode('grid')}
            title="Grid view"
            className={`flex items-center justify-center px-2.5 py-2 transition-colors ${
              viewMode === 'grid' ? 'bg-primary-500 text-white' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            title="List view"
            className={`flex items-center justify-center border-l border-gray-200 px-2.5 py-2 transition-colors ${
              viewMode === 'list' ? 'bg-primary-500 text-white' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <List className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* ── Category filter — pills ≤8, dropdown >8 ── */}
      {!scanMode && categories?.length > 0 && (
        categories.length > 8 ? (
          <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-3 py-2">
            <span className="text-xs text-gray-400 flex-shrink-0">Category</span>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 focus:border-primary-400 focus:outline-none"
            >
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c.category_id} value={String(c.category_id)}>{c.category_name}</option>
              ))}
            </select>
            {categoryId && (
              <button
                onClick={() => setCategoryId('')}
                className="flex-shrink-0 rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ) : (
          <div
            className="flex gap-1.5 overflow-x-auto border-b border-gray-200 bg-white px-3 py-2"
            style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch', touchAction: 'pan-x' }}
          >
            <button
              onClick={() => setCategoryId('')}
              className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-all active:scale-95 ${
                !categoryId ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 active:bg-gray-300'
              }`}
            >
              All
            </button>
            {categories.map((c) => (
              <button
                key={c.category_id}
                onClick={() => setCategoryId(categoryId === String(c.category_id) ? '' : String(c.category_id))}
                className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-all active:scale-95 ${
                  categoryId === String(c.category_id)
                    ? 'bg-primary-500 text-white active:bg-primary-600'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 active:bg-gray-300'
                }`}
              >
                {c.category_name}
              </button>
            ))}
          </div>
        )
      )}

      {/* ── Scan hint ── */}
      {scanMode && (
        <div className="flex items-center gap-2 border-b border-primary-100 bg-primary-50 px-4 py-1.5 text-xs text-primary-700">
          <ScanLine className="h-3.5 w-3.5 flex-shrink-0" />
          Barcode scan active — scan or type barcode/SKU and press Enter
        </div>
      )}

      {/* ── Offline banner ── */}
      {!isOnline && (
        <div className={`flex items-center gap-2 border-b px-4 py-1.5 text-xs ${
          usingCache ? 'border-amber-100 bg-amber-50 text-amber-700' : 'border-red-100 bg-red-50 text-red-700'
        }`}>
          <WifiOff className="h-3.5 w-3.5 flex-shrink-0" />
          {usingCache ? 'Offline — showing cached products' : 'Offline — no cached products available'}
        </div>
      )}

      {/* ── Product count ── */}
      {!isActuallyLoading && products != null && products.length > 0 && (
        <div className="border-b border-gray-100 bg-white px-3.5 py-1">
          <p className="text-[11px] text-gray-400">
            {products.length} product{products.length !== 1 ? 's' : ''}
          </p>
        </div>
      )}

      {/* ── Products ── */}
      <div className="flex-1 overflow-y-auto p-2">
        {isActuallyLoading ? (
          viewMode === 'grid' ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {Array.from({ length: 10 }).map((_, i) => <GridSkeleton key={i} />)}
            </div>
          ) : (
            <div className="space-y-1.5">
              {Array.from({ length: 10 }).map((_, i) => <ListSkeleton key={i} />)}
            </div>
          )
        ) : products?.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm">
              <Search className="h-6 w-6 text-gray-300" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-gray-400">No products found</p>
              {search && <p className="text-xs text-gray-300 mt-0.5">Try a different search term</p>}
            </div>
          </div>
        ) : viewMode === 'grid' ? (

          /* ── Grid view ── */
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {products.map((product) => {
              const quantity   = parseFloat(product.quantity_available ?? 0);
              const threshold  = parseFloat(product.reorder_level ?? 5);
              const outOfStock = product.track_inventory !== false && quantity <= 0;
              const lowStock   = !outOfStock && product.track_inventory !== false && quantity <= threshold;
              const inCartQty  = cartQtyMap[product.product_id] ?? 0;
              const price      = product.branch_price ?? product.base_price;

              return (
                <button
                  key={product.product_id}
                  disabled={outOfStock}
                  onClick={() => addItem(product, price)}
                  className={[
                    'group relative flex flex-col overflow-hidden rounded-xl border text-left transition-all',
                    outOfStock
                      ? 'cursor-not-allowed border-gray-100 bg-white opacity-40'
                      : inCartQty > 0
                      ? 'border-primary-300 bg-white shadow-sm hover:shadow-md active:scale-[0.97]'
                      : 'border-gray-100 bg-white hover:border-primary-200 hover:shadow-md active:scale-[0.97]',
                  ].join(' ')}
                >
                  {inCartQty > 0 && (
                    <div className="absolute right-1.5 top-1.5 z-10 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary-500 px-1 text-[10px] font-bold text-white shadow-sm">
                      {inCartQty}
                    </div>
                  )}
                  <div className="aspect-[4/3] w-full flex-shrink-0 overflow-hidden bg-gray-50">
                    <ProductCardImage product={product} />
                  </div>
                  <div className="flex flex-col gap-0.5 p-2.5">
                    <p className="line-clamp-2 text-xs font-semibold leading-snug text-gray-800 group-hover:text-primary-700">
                      {product.product_name}
                    </p>
                    {(product.barcode || product.sku) && (
                      <p className="truncate font-mono text-[10px] text-gray-400">
                        {product.barcode || product.sku}
                      </p>
                    )}
                    <p className="text-sm font-bold text-secondary-600">{formatCurrency(price)}</p>
                    {product.quantity_available !== undefined && (
                      <p className={`text-[10px] font-medium ${
                        outOfStock ? 'text-red-500' : lowStock ? 'text-amber-500' : 'text-gray-400'
                      }`}>
                        {outOfStock ? 'Out of stock' : lowStock ? `⚠ Low: ${quantity}` : `${quantity} in stock`}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

        ) : (

          /* ── List view ── */
          <div className="space-y-1">
            {products.map((product) => {
              const quantity   = parseFloat(product.quantity_available ?? 0);
              const threshold  = parseFloat(product.reorder_level ?? 5);
              const outOfStock = product.track_inventory !== false && quantity <= 0;
              const lowStock   = !outOfStock && product.track_inventory !== false && quantity <= threshold;
              const inCartQty  = cartQtyMap[product.product_id] ?? 0;
              const price      = product.branch_price ?? product.base_price;

              return (
                <button
                  key={product.product_id}
                  disabled={outOfStock}
                  onClick={() => addItem(product, price)}
                  className={[
                    'group flex w-full items-center gap-3 rounded-xl border bg-white px-3 py-2.5 text-left transition-all',
                    outOfStock
                      ? 'cursor-not-allowed border-gray-100 opacity-40'
                      : inCartQty > 0
                      ? 'border-primary-300 shadow-sm hover:shadow-md active:scale-[0.99]'
                      : 'border-gray-100 hover:border-primary-200 hover:shadow-sm active:scale-[0.99]',
                  ].join(' ')}
                >
                  <ProductThumb product={product} size="sm" />

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-800 group-hover:text-primary-700">
                      {product.product_name}
                    </p>
                    {(product.barcode || product.sku) ? (
                      <p className="truncate font-mono text-[11px] text-gray-400">
                        {product.barcode || product.sku}
                      </p>
                    ) : product.category_name ? (
                      <p className="truncate text-[11px] text-gray-400">{product.category_name}</p>
                    ) : null}
                  </div>

                  {product.quantity_available !== undefined && (
                    <p className={`flex-shrink-0 text-xs font-semibold w-14 text-right ${
                      outOfStock ? 'text-red-500' : lowStock ? 'text-amber-500' : 'text-gray-400'
                    }`}>
                      {outOfStock ? 'Out of stock' : lowStock ? `⚠ ${quantity}` : `${quantity}`}
                    </p>
                  )}

                  <p className="w-24 flex-shrink-0 text-right text-sm font-bold text-secondary-600">
                    {formatCurrency(price)}
                  </p>

                  <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-all ${
                    inCartQty > 0
                      ? 'bg-primary-500 text-white shadow-sm'
                      : 'border-2 border-gray-200 text-gray-300 lg:opacity-0 lg:group-hover:opacity-100'
                  }`}>
                    {inCartQty > 0 ? inCartQty : <Plus className="h-3.5 w-3.5" />}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
