import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, AlertTriangle, Plus, Minus } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/services/api';
import { formatCurrency, formatDate } from '@/utils/formatters';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { PageSpinner } from '@/components/ui/Spinner';
import { usePermission } from '@/hooks/usePermission';

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

export default function InventoryPage() {
  const qc = useQueryClient();
  const { hasCapability } = usePermission();
  const canAdjustStock = hasCapability('inventory.adjust');
  const [search, setSearch]       = useState('');
  const [lowStock, setLowStock]   = useState(false);
  const [page, setPage]           = useState(1);
  const [adjustItem, setAdjustItem] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['inventory', search, lowStock, page],
    queryFn: () =>
      api.get('/inventory', { params: { search, lowStock, page, limit: 50 } }).then((r) => r.data.data),
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

  const inventory = data?.inventory ?? [];
  const total     = data?.total     ?? 0;
  const pages     = data?.pages     ?? 1;
  const lowCount  = inventory.filter((i) => i.is_low_stock).length;

  return (
    <div className="space-y-4">
      <div className="flex gap-3 rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Search by product name or SKU…"
            value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none" />
        </div>
        <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 select-none">
          <input type="checkbox" checked={lowStock} onChange={(e) => { setLowStock(e.target.checked); setPage(1); }}
            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
          Low stock only
        </label>
        {lowCount > 0 && (
          <div className="flex items-center gap-1.5 rounded-lg bg-red-50 border border-red-200 px-3 py-1.5 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4" />
            {lowCount} low stock
          </div>
        )}
      </div>

      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        {isLoading ? <PageSpinner /> : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Product</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 hidden md:table-cell">Branch</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 hidden md:table-cell">Category</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Available</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600 hidden lg:table-cell">Reorder At</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600 hidden sm:table-cell">Selling Price</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 hidden lg:table-cell">Last Updated</th>
                {canAdjustStock && <th className="px-4 py-3 text-center font-medium text-gray-600">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {inventory.map((item, i) => (
                <tr key={`${item.product_id}-${item.branch_id}`}
                  className={`hover:bg-gray-50 active:bg-gray-100 transition-colors ${item.is_low_stock ? 'bg-red-50/30' : ''}`}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{item.product_name}</p>
                    <p className="text-xs text-gray-400 font-mono">{item.sku}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs hidden md:table-cell">{item.branch_name}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs hidden md:table-cell">{item.category_name ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`font-bold text-base ${item.is_low_stock ? 'text-red-600' : 'text-gray-900'}`}>
                      {item.quantity_available}
                    </span>
                    <span className="text-xs text-gray-400 ml-1">{item.unit_of_measure}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500 hidden lg:table-cell">{item.reorder_level}</td>
                  <td className="px-4 py-3 text-right text-gray-700 hidden sm:table-cell">{formatCurrency(item.selling_price)}</td>
                  <td className="px-4 py-3 text-center">
                    {item.is_low_stock
                      ? <span className="flex items-center justify-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                          <AlertTriangle className="h-3 w-3" /> Low
                        </span>
                      : <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">OK</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 hidden lg:table-cell">
                    {item.last_updated ? formatDate(item.last_updated) : '—'}
                  </td>
                  {canAdjustStock && (
                    <td className="px-4 py-3">
                      <button onClick={() => setAdjustItem(item)}
                        className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-primary-50 hover:border-primary-300 hover:text-primary-700 transition-colors">
                        Adjust
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {inventory.length === 0 && (
                <tr><td colSpan={canAdjustStock ? 9 : 8} className="py-12 text-center text-gray-400">No inventory records found</td></tr>
              )}
            </tbody>
          </table>
          </div>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
            <p className="text-xs text-gray-500">Page {page} of {pages} ({total} total)</p>
            <div className="flex gap-1">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-md border border-gray-200 px-3 py-1 text-xs disabled:opacity-40 hover:bg-gray-50">← Prev</button>
              <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded-md border border-gray-200 px-3 py-1 text-xs disabled:opacity-40 hover:bg-gray-50">Next →</button>
            </div>
          </div>
        )}
      </div>

      <Modal open={canAdjustStock && !!adjustItem} onClose={() => setAdjustItem(null)} title="Adjust Stock" size="sm">
        <AdjustForm item={adjustItem} onClose={() => setAdjustItem(null)} onSave={(d) => adjustMut.mutate(d)} />
      </Modal>
    </div>
  );
}
