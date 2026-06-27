import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, AlertTriangle, Plus, Minus, Layers, BookOpen, RefreshCw, ChevronUp, ChevronDown, ChevronsUpDown, ClipboardCheck, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/services/api';
import { formatCurrency, formatDate } from '@/utils/formatters';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { PageSpinner } from '@/components/ui/Spinner';
import { usePermission } from '@/hooks/usePermission';
import StockLedgerModal from './StockLedgerModal';

// ── Single-item adjust form ───────────────────────────────────────────────────

function AdjustForm({ item, onSave, onClose }) {
  const [qty, setQty]     = useState('');
  const [notes, setNotes] = useState('');
  const num = parseFloat(qty);
  const preview = item ? (item.quantity_available + (isNaN(num) ? 0 : num)) : 0;

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-gray-50 p-4">
        <p className="font-semibold text-gray-900">{item?.product_name}</p>
        <p className="text-sm text-gray-500">{item?.sku} · {item?.branch_name}</p>
        <p className="text-sm text-gray-600 mt-1">Current stock: <span className="font-bold">{item?.quantity_available}</span></p>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Adjustment (positive = add, negative = remove)
        </label>
        <div className="flex gap-2">
          <button onClick={() => setQty(String((parseFloat(qty) || 0) - 1))}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50">
            <Minus className="h-4 w-4" />
          </button>
          <input type="number" value={qty} onChange={(e) => setQty(e.target.value)}
            placeholder="e.g. 10 or -5"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-center text-lg font-semibold focus:border-primary-500 focus:outline-none" />
          <button onClick={() => setQty(String((parseFloat(qty) || 0) + 1))}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50">
            <Plus className="h-4 w-4" />
          </button>
        </div>
        {qty && !isNaN(num) && (
          <p className={`mt-1 text-sm ${preview < 0 ? 'text-red-600' : 'text-gray-600'}`}>
            New quantity: <span className="font-bold">{preview}</span>
          </p>
        )}
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="Reason for adjustment…"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
      </div>
      <div className="flex gap-3">
        <Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button>
        <Button variant="primary" fullWidth
          disabled={!qty || isNaN(num) || num === 0 || preview < 0}
          onClick={() => onSave({ product_id: item.product_id, branch_id: item.branch_id, adjustment: num, notes })}>
          Apply Adjustment
        </Button>
      </div>
    </div>
  );
}

// ── Bulk adjust modal ─────────────────────────────────────────────────────────

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none';

function BulkAdjustModal({ items, allInventory, onClose, onSave, isSaving }) {
  // rows keyed by product_id+branch_id; initialise from selected items
  const [rows, setRows] = useState(
    items.map((i) => ({
      key: `${i.product_id}:${i.branch_id}`,
      product_id:          i.product_id,
      branch_id:           i.branch_id,
      product_name:        i.product_name,
      branch_name:         i.branch_name,
      quantity_available:  i.quantity_available,
      adjustment:          '',
      notes:               '',
    }))
  );

  const usedKeys = new Set(rows.map((r) => r.key));

  const addRow = (inv) => {
    const key = `${inv.product_id}:${inv.branch_id}`;
    if (usedKeys.has(key)) return;
    setRows((prev) => [...prev, {
      key,
      product_id:         inv.product_id,
      branch_id:          inv.branch_id,
      product_name:       inv.product_name,
      branch_name:        inv.branch_name,
      quantity_available: inv.quantity_available,
      adjustment:         '',
      notes:              '',
    }]);
  };

  const removeRow = (key) => setRows((prev) => prev.filter((r) => r.key !== key));
  const updateRow = (key, field, value) =>
    setRows((prev) => prev.map((r) => r.key === key ? { ...r, [field]: value } : r));

  const validRows = rows.filter((r) => {
    const n = parseFloat(r.adjustment);
    return !isNaN(n) && n !== 0 && (r.quantity_available + n) >= 0;
  });

  const handleSubmit = () => {
    if (!validRows.length) return toast.error('Enter valid adjustments for at least one item');
    onSave(validRows.map((r) => ({
      product_id: r.product_id,
      branch_id:  r.branch_id,
      adjustment: parseFloat(r.adjustment),
      notes:      r.notes,
    })));
  };

  const availableToAdd = allInventory.filter((i) => !usedKeys.has(`${i.product_id}:${i.branch_id}`));

  return (
    <Modal open onClose={onClose} title="Bulk Stock Adjustment" size="xl">
      <div className="space-y-4">

        {/* Row table */}
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="py-2 pl-3 text-left text-xs font-medium text-gray-500">Product</th>
                <th className="py-2 px-2 text-left text-xs font-medium text-gray-500 hidden sm:table-cell">Branch</th>
                <th className="py-2 px-2 text-right text-xs font-medium text-gray-500 w-20">Current</th>
                <th className="py-2 px-2 text-center text-xs font-medium text-gray-500 w-32">Adjustment</th>
                <th className="py-2 px-2 text-right text-xs font-medium text-gray-500 w-20">New Qty</th>
                <th className="py-2 px-2 text-left text-xs font-medium text-gray-500">Notes</th>
                <th className="py-2 pr-3 w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => {
                const n       = parseFloat(row.adjustment);
                const newQty  = isNaN(n) ? null : row.quantity_available + n;
                const invalid = newQty !== null && newQty < 0;
                return (
                  <tr key={row.key} className={invalid ? 'bg-red-50' : ''}>
                    <td className="py-2 pl-3">
                      <p className="font-medium text-gray-900 text-xs">{row.product_name}</p>
                    </td>
                    <td className="py-2 px-2 text-xs text-gray-500 hidden sm:table-cell">{row.branch_name}</td>
                    <td className="py-2 px-2 text-right text-xs font-semibold text-gray-700">{row.quantity_available}</td>
                    <td className="py-2 px-2">
                      <input
                        type="number"
                        value={row.adjustment}
                        onChange={(e) => updateRow(row.key, 'adjustment', e.target.value)}
                        placeholder="e.g. 10 or -5"
                        className={`w-full rounded border px-2 py-1 text-center text-sm focus:outline-none focus:ring-1 ${
                          invalid
                            ? 'border-red-400 focus:ring-red-400'
                            : 'border-gray-300 focus:ring-primary-400'
                        }`}
                      />
                    </td>
                    <td className={`py-2 px-2 text-right text-xs font-bold ${invalid ? 'text-red-600' : newQty !== null ? 'text-green-700' : 'text-gray-400'}`}>
                      {newQty !== null ? newQty : '—'}
                    </td>
                    <td className="py-2 px-2">
                      <input
                        type="text"
                        value={row.notes}
                        onChange={(e) => updateRow(row.key, 'notes', e.target.value)}
                        placeholder="Reason (optional)"
                        className="w-full rounded border border-gray-200 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary-400"
                      />
                    </td>
                    <td className="py-2 pr-3 text-center">
                      <button onClick={() => removeRow(row.key)}
                        className="text-gray-300 hover:text-red-500 transition-colors text-xs">✕</button>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-xs text-gray-400">
                    No items added — use the dropdown below to add products.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Add more items */}
        {availableToAdd.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 flex-shrink-0">Add product:</span>
            <select
              className="flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white focus:border-primary-500 focus:outline-none"
              value=""
              onChange={(e) => {
                const inv = allInventory.find(
                  (i) => `${i.product_id}:${i.branch_id}` === e.target.value
                );
                if (inv) addRow(inv);
              }}
            >
              <option value="">— Select a product to add —</option>
              {availableToAdd.map((i) => (
                <option key={`${i.product_id}:${i.branch_id}`} value={`${i.product_id}:${i.branch_id}`}>
                  {i.product_name} · {i.branch_name} (stock: {i.quantity_available})
                </option>
              ))}
            </select>
          </div>
        )}

        <p className="text-xs text-gray-400">
          {validRows.length} of {rows.length} row{rows.length !== 1 ? 's' : ''} ready to apply.
        </p>

        <div className="flex justify-end gap-3 pt-1">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} isLoading={isSaving} disabled={!validRows.length}>
            Apply {validRows.length > 0 ? `${validRows.length} Adjustment${validRows.length > 1 ? 's' : ''}` : 'Adjustments'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Stock count / balance update modal ───────────────────────────────────────
// Enter the actual counted quantity; system calculates the adjustment automatically.

function StockCountModal({ onClose, onSave, isSaving, branches, categories }) {
  const [branchId,    setBranchId]    = useState(branches.length === 1 ? branches[0].branch_id : '');
  const [categoryId,  setCategoryId]  = useState('');
  const [search,      setSearch]      = useState('');
  const [counts,      setCounts]      = useState({});   // "productId:branchId" → string
  const [notes,       setNotes]       = useState('Stock count');

  const { data, isLoading } = useQuery({
    queryKey: ['inventory-stock-count', branchId, categoryId],
    queryFn: () => api.get('/inventory', {
      params: { branchId: branchId || undefined, categoryId: categoryId || undefined, limit: 500, page: 1 },
    }).then((r) => r.data.data),
    staleTime: 0,   // always fresh — this is a live count
  });

  const inventory = data?.inventory ?? [];
  const filtered  = inventory
    .filter((i) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return i.product_name.toLowerCase().includes(q) || (i.sku || '').toLowerCase().includes(q);
    })
    .sort((a, b) => (a.sku || '').localeCompare(b.sku || '', undefined, { numeric: true, sensitivity: 'base' }));

  const setCount = (key, val) => setCounts((prev) => ({ ...prev, [key]: val }));
  const clearCount = (key) => setCounts((prev) => { const n = { ...prev }; delete n[key]; return n; });

  // Items where a count was entered and differs from current balance
  const changedItems = filtered.flatMap((i) => {
    const key     = `${i.product_id}:${i.branch_id}`;
    const raw     = counts[key];
    if (raw === '' || raw === undefined || raw === null) return [];
    const counted = parseFloat(raw);
    if (isNaN(counted) || counted < 0) return [];
    const diff = parseFloat((counted - i.quantity_available).toFixed(4));
    if (diff === 0) return [];
    return [{ product_id: i.product_id, branch_id: i.branch_id, adjustment: diff, notes,
              _counted: counted, _current: i.quantity_available, _name: i.product_name }];
  });

  const gains  = changedItems.filter((i) => i.adjustment > 0).length;
  const losses = changedItems.filter((i) => i.adjustment < 0).length;
  const countedTotal = Object.keys(counts).filter((k) => counts[k] !== '' && counts[k] !== undefined).length;

  const handleSubmit = () => {
    if (!changedItems.length) return toast.error('No stock changes to apply');
    onSave(changedItems.map(({ product_id, branch_id, adjustment, notes }) => ({ product_id, branch_id, adjustment, notes })));
  };

  return (
    <Modal open onClose={onClose} title="Stock Count / Balance Update" size="xl">
      <div className="space-y-4">

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          {branches.length > 1 && (
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)}
              className="rounded-lg border border-gray-200 py-1.5 px-2 text-sm bg-white focus:border-primary-500 focus:outline-none">
              <option value="">All Branches</option>
              {branches.map((b) => <option key={b.branch_id} value={b.branch_id}>{b.branch_name}</option>)}
            </select>
          )}
          {categories.length > 0 && (
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
              className="rounded-lg border border-gray-200 py-1.5 px-2 text-sm bg-white focus:border-primary-500 focus:outline-none">
              <option value="">All Categories</option>
              {categories.map((c) => <option key={c.category_id} value={c.category_id}>{c.category_name}</option>)}
            </select>
          )}
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Search product or SKU…" value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-gray-200 pl-8 pr-3 py-1.5 text-sm focus:border-primary-500 focus:outline-none" />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Instruction banner */}
        <div className="rounded-lg bg-primary-50 border border-primary-100 px-3 py-2 text-xs text-primary-700">
          Enter the <strong>actual counted quantity</strong> for each item you've physically counted.
          Items left blank will not be updated. The system will calculate the adjustment automatically.
        </div>

        {/* Count table */}
        <div className="overflow-x-auto rounded-lg border border-gray-200 max-h-[45vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="py-2 pl-3 text-left text-xs font-medium text-gray-500">Product</th>
                <th className="py-2 px-2 text-left text-xs font-medium text-gray-500 hidden sm:table-cell">SKU</th>
                {!branchId && <th className="py-2 px-2 text-left text-xs font-medium text-gray-500 hidden md:table-cell">Branch</th>}
                <th className="py-2 px-2 text-right text-xs font-medium text-gray-500 w-24">System Bal.</th>
                <th className="py-2 px-2 text-center text-xs font-medium text-gray-500 w-32">Counted Qty</th>
                <th className="py-2 px-2 text-right text-xs font-medium text-gray-500 w-24">Variance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr><td colSpan={6} className="py-8 text-center text-xs text-gray-400">Loading inventory…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-xs text-gray-400">No items found</td></tr>
              ) : filtered.map((item) => {
                const key     = `${item.product_id}:${item.branch_id}`;
                const raw     = counts[key] ?? '';
                const counted = raw !== '' ? parseFloat(raw) : null;
                const invalid = counted !== null && (isNaN(counted) || counted < 0);
                const diff    = (!invalid && counted !== null) ? parseFloat((counted - item.quantity_available).toFixed(4)) : null;
                const hasChange = diff !== null && diff !== 0;
                return (
                  <tr key={key} className={invalid ? 'bg-red-50' : hasChange ? 'bg-amber-50/40' : ''}>
                    <td className="py-2 pl-3">
                      <p className="font-medium text-gray-900 text-xs leading-tight">{item.product_name}</p>
                    </td>
                    <td className="py-2 px-2 text-xs font-mono text-gray-400 hidden sm:table-cell">{item.sku}</td>
                    {!branchId && <td className="py-2 px-2 text-xs text-gray-500 hidden md:table-cell">{item.branch_name}</td>}
                    <td className="py-2 px-2 text-right text-xs font-semibold text-gray-700">
                      {item.quantity_available}
                      <span className="ml-0.5 text-gray-400 font-normal">{item.unit_of_measure}</span>
                    </td>
                    <td className="py-2 px-2">
                      <div className="flex items-center gap-1">
                        <input
                          type="number" min="0" step="0.01"
                          value={raw}
                          onChange={(e) => setCount(key, e.target.value)}
                          placeholder={String(item.quantity_available)}
                          className={`w-full rounded border px-2 py-1 text-center text-sm focus:outline-none focus:ring-1 ${
                            invalid
                              ? 'border-red-400 bg-red-50 focus:ring-red-400'
                              : raw !== ''
                                ? 'border-primary-300 bg-primary-50 focus:ring-primary-400'
                                : 'border-gray-200 focus:ring-primary-400'
                          }`}
                        />
                        {raw !== '' && (
                          <button onClick={() => clearCount(key)} className="text-gray-300 hover:text-gray-500 flex-shrink-0">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="py-2 px-2 text-right text-xs font-bold">
                      {diff === null || invalid ? (
                        <span className="text-gray-300">—</span>
                      ) : diff === 0 ? (
                        <span className="text-gray-400">no change</span>
                      ) : (
                        <span className={diff > 0 ? 'text-green-600' : 'text-red-600'}>
                          {diff > 0 ? '+' : ''}{diff}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Summary + notes */}
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1 space-y-1 text-xs text-gray-500">
            <p>{filtered.length} item{filtered.length !== 1 ? 's' : ''} shown
              {countedTotal > 0 && <span className="ml-1">· <strong>{countedTotal} counted</strong></span>}
              {gains  > 0 && <span className="ml-1 text-green-600">· +{gains} gain{gains !== 1 ? 's' : ''}</span>}
              {losses > 0 && <span className="ml-1 text-red-600">· {losses} shortage{losses !== 1 ? 's' : ''}</span>}
            </p>
            {changedItems.length > 0 && (
              <p className="text-primary-600 font-medium">{changedItems.length} item{changedItems.length !== 1 ? 's' : ''} will be updated.</p>
            )}
          </div>
          <div className="w-full sm:w-64">
            <label className="block text-xs font-medium text-gray-700 mb-1">Notes (applied to all changes)</label>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Monthly stock count June 2026"
              className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-primary-500 focus:outline-none" />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-1 border-t border-gray-100">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} isLoading={isSaving} disabled={!changedItems.length}>
            <ClipboardCheck className="h-4 w-4 mr-1" />
            Apply {changedItems.length > 0 ? `${changedItems.length} Update${changedItems.length > 1 ? 's' : ''}` : 'Count'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function InventoryPage() {
  const qc = useQueryClient();
  const { hasCapability } = usePermission();
  const canAdjustStock    = hasCapability('inventory.adjust');
  const [search, setSearch]             = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage]                 = useState(1);
  const [adjustItem, setAdjustItem]   = useState(null);
  const [ledgerItem, setLedgerItem]   = useState(null); // { product_id, product_name }
  const [selected, setSelected]       = useState(new Set());
  const [bulkOpen, setBulkOpen]       = useState(false);
  const [stockCountOpen, setStockCountOpen] = useState(false);
  const [sortBy,  setSortBy]  = useState('name');
  const [sortDir, setSortDir] = useState('asc');

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
    setPage(1);
  };

  const SortTh = ({ col, label, className = '' }) => {
    const active = sortBy === col;
    const Icon = active ? (sortDir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown;
    return (
      <th onClick={() => toggleSort(col)}
        className={`px-3 py-2 font-medium text-gray-600 cursor-pointer select-none hover:bg-gray-100 transition-colors ${className}`}>
        <span className="flex items-center gap-1 whitespace-nowrap">
          {label}<Icon className={`h-3.5 w-3.5 flex-shrink-0 ${active ? 'text-primary-600' : 'text-gray-300'}`} />
        </span>
      </th>
    );
  };

  // Filter option lists
  const { data: branchesData } = useQuery({
    queryKey: ['branches-list'],
    queryFn: () => api.get('/branches').then((r) => r.data.data ?? r.data),
    staleTime: 5 * 60 * 1000,
  });
  const { data: categoriesData } = useQuery({
    queryKey: ['categories-list'],
    queryFn: () => api.get('/products/categories').then((r) => r.data.data ?? r.data),
    staleTime: 5 * 60 * 1000,
  });
  const branches   = Array.isArray(branchesData)   ? branchesData   : [];
  const categories = Array.isArray(categoriesData) ? categoriesData : [];

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['inventory', search, branchFilter, categoryFilter, statusFilter, page, sortBy, sortDir],
    queryFn: () =>
      api.get('/inventory', {
        params: {
          search:      search      || undefined,
          branchId:    branchFilter || undefined,
          categoryId:  categoryFilter || undefined,
          stockStatus: statusFilter || undefined,
          page,
          limit: 50,
          sortBy,
          sortDir,
        },
      }).then((r) => r.data.data),
    keepPreviousData: true,
  });

  const adjustMut = useMutation({
    mutationFn: (d) => api.post('/inventory/adjust', d),
    onSuccess: (res) => {
      const d = res.data.data;
      toast.success(`Stock adjusted: ${d.quantity_before} → ${d.quantity_after}`);
      qc.invalidateQueries(['inventory']);
      setAdjustItem(null);
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Adjustment failed'),
  });

  const bulkMut = useMutation({
    mutationFn: (items) => api.post('/inventory/adjust-bulk', { items }),
    onSuccess: (res) => {
      const results = res.data.data;
      toast.success(`${results.length} adjustment${results.length > 1 ? 's' : ''} applied`);
      qc.invalidateQueries(['inventory']);
      setBulkOpen(false);
      setSelected(new Set());
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Bulk adjustment failed'),
  });

  const stockCountMut = useMutation({
    mutationFn: (items) => api.post('/inventory/adjust-bulk', { items }),
    onSuccess: (res) => {
      const results = res.data.data;
      toast.success(`Stock count applied — ${results.length} balance${results.length > 1 ? 's' : ''} updated`);
      qc.invalidateQueries(['inventory']);
      setStockCountOpen(false);
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Stock count failed'),
  });

  const inventory = data?.inventory ?? [];
  const total     = data?.total     ?? 0;
  const pages     = data?.pages     ?? 1;
  const lowCount  = inventory.filter((i) => i.is_low_stock).length;

  const toggleSelect = (key) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const toggleAll = () => {
    if (selected.size === inventory.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(inventory.map((i) => `${i.product_id}:${i.branch_id}`)));
    }
  };

  const selectedItems = inventory.filter((i) => selected.has(`${i.product_id}:${i.branch_id}`));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
        {/* Search */}
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Search by product name or SKU…"
            value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none" />
        </div>

        {/* Branch filter */}
        {branches.length > 1 && (
          <select value={branchFilter} onChange={(e) => { setBranchFilter(e.target.value); setPage(1); }}
            className="rounded-lg border border-gray-200 py-2 px-3 text-sm bg-white focus:border-primary-500 focus:outline-none min-w-36">
            <option value="">All Branches</option>
            {branches.map((b) => (
              <option key={b.branch_id} value={b.branch_id}>{b.branch_name}</option>
            ))}
          </select>
        )}

        {/* Category filter */}
        {categories.length > 0 && (
          <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
            className="rounded-lg border border-gray-200 py-2 px-3 text-sm bg-white focus:border-primary-500 focus:outline-none min-w-36">
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c.category_id} value={c.category_id}>{c.category_name}</option>
            ))}
          </select>
        )}

        {/* Status filter */}
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="rounded-lg border border-gray-200 py-2 px-3 text-sm bg-white focus:border-primary-500 focus:outline-none min-w-32">
          <option value="">All Status</option>
          <option value="ok">OK</option>
          <option value="low">Low Stock</option>
          <option value="out">Out of Stock</option>
        </select>

        {/* Low stock badge */}
        {lowCount > 0 && !statusFilter && (
          <button onClick={() => { setStatusFilter('low'); setPage(1); }}
            className="flex items-center gap-1.5 rounded-lg bg-red-50 border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-100 transition-colors">
            <AlertTriangle className="h-4 w-4" />
            {lowCount} low stock
          </button>
        )}

        <Button variant="secondary" size="sm"
          icon={<RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />}
          onClick={() => refetch()}>
          Refresh
        </Button>
        {/* Stock count */}
        {canAdjustStock && (
          <Button size="sm" variant="secondary" onClick={() => setStockCountOpen(true)}>
            <ClipboardCheck className="h-4 w-4 mr-1" />
            Stock Count
          </Button>
        )}

        {/* Bulk adjust */}
        {canAdjustStock && selected.size > 0 && (
          <Button size="sm" onClick={() => setBulkOpen(true)}>
            <Layers className="h-4 w-4 mr-1" />
            Adjust {selected.size} selected
          </Button>
        )}
      </div>

      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        {isLoading ? <PageSpinner /> : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {canAdjustStock && (
                  <th className="px-3 py-2 w-8">
                    <input type="checkbox"
                      checked={inventory.length > 0 && selected.size === inventory.length}
                      onChange={toggleAll}
                      className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                  </th>
                )}
                <SortTh col="name"     label="Product"       className="text-left" />
                <SortTh col="sku"      label="SKU"           className="text-left hidden sm:table-cell" />
                <SortTh col="branch"   label="Branch"        className="text-left hidden md:table-cell" />
                <SortTh col="category" label="Category"      className="text-left hidden md:table-cell" />
                <SortTh col="stock"    label="Available"     className="text-right" />
                <SortTh col="reorder"  label="Min"           className="text-right hidden lg:table-cell w-16" />
                <SortTh col="price"    label="Selling Price" className="text-right hidden sm:table-cell" />
                <th className="px-3 py-2 text-center font-medium text-gray-600">Status</th>
                <th className="px-3 py-2 text-center font-medium text-gray-600">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {inventory.map((item) => {
                const key = `${item.product_id}:${item.branch_id}`;
                const isSelected = selected.has(key);
                return (
                  <tr key={key}
                    className={`hover:bg-gray-50 transition-colors ${item.is_low_stock ? 'bg-red-50/30' : ''} ${isSelected ? 'bg-primary-50/40' : ''}`}>
                    {canAdjustStock && (
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(key)}
                          className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                      </td>
                    )}
                    <td className="px-3 py-2 font-medium text-gray-900">{item.product_name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-400 hidden sm:table-cell">{item.sku}</td>
                    <td className="px-3 py-2 text-gray-600 text-xs hidden md:table-cell">{item.branch_name}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs hidden md:table-cell">{item.category_name ?? '—'}</td>
                    <td className="px-3 py-2 text-right">
                      <span className={`font-bold text-base ${item.is_low_stock ? 'text-red-600' : 'text-gray-900'}`}>
                        {item.quantity_available}
                      </span>
                      <span className="text-xs text-gray-400 ml-1">{item.unit_of_measure}</span>
                    </td>
                    <td className="px-3 py-2 text-right text-gray-500 text-xs hidden lg:table-cell">{item.reorder_level}</td>
                    <td className="px-3 py-2 text-right text-gray-700 hidden sm:table-cell">{formatCurrency(item.selling_price)}</td>
                    <td className="px-3 py-2 text-center">
                      {item.is_low_stock
                        ? <span className="flex items-center justify-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                            <AlertTriangle className="h-3 w-3" /> Low
                          </span>
                        : <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">OK</span>}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button onClick={() => setLedgerItem({ product_id: item.product_id, product_name: item.product_name, branch_id: item.branch_id, branch_name: item.branch_name })}
                          className="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition-colors">
                          <BookOpen className="h-3 w-3" />Ledger
                        </button>
                        {canAdjustStock && (
                          <button onClick={() => setAdjustItem(item)}
                            className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-primary-50 hover:border-primary-300 hover:text-primary-700 transition-colors">
                            Adjust
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {inventory.length === 0 && (
                <tr><td colSpan={canAdjustStock ? 10 : 9} className="py-12 text-center text-gray-400">No inventory records found</td></tr>
              )}
            </tbody>
          </table>
          </div>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2">
            <p className="text-xs text-gray-500">Page {page} of {pages} ({total} total)</p>
            <div className="flex gap-1">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-md border border-gray-200 px-3 py-1 text-xs disabled:opacity-40 hover:bg-gray-50">← Prev</button>
              <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded-md border border-gray-200 px-3 py-1 text-xs disabled:opacity-40 hover:bg-gray-50">Next →</button>
            </div>
          </div>
        )}
      </div>

      {/* Single adjust modal */}
      <Modal open={canAdjustStock && !!adjustItem} onClose={() => setAdjustItem(null)} title="Adjust Stock" size="sm">
        <AdjustForm item={adjustItem} onClose={() => setAdjustItem(null)} onSave={(d) => adjustMut.mutate(d)} />
      </Modal>

      {/* Bulk adjust modal */}
      {canAdjustStock && bulkOpen && (
        <BulkAdjustModal
          items={selectedItems}
          allInventory={inventory}
          onClose={() => setBulkOpen(false)}
          onSave={(items) => bulkMut.mutate(items)}
          isSaving={bulkMut.isPending}
        />
      )}

      {/* Stock count modal */}
      {canAdjustStock && stockCountOpen && (
        <StockCountModal
          onClose={() => setStockCountOpen(false)}
          onSave={(items) => stockCountMut.mutate(items)}
          isSaving={stockCountMut.isPending}
          branches={branches}
          categories={categories}
        />
      )}

      {/* Stock ledger modal */}
      <StockLedgerModal
        open={!!ledgerItem}
        onClose={() => setLedgerItem(null)}
        productId={ledgerItem?.product_id}
        productName={ledgerItem?.product_name}
        branchId={ledgerItem?.branch_id}
        branchName={ledgerItem?.branch_name}
      />
    </div>
  );
}
