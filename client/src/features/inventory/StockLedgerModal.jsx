import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import api from '@/services/api';
import { formatDateTime, todayLocal } from '@/utils/formatters';
import Modal from '@/components/ui/Modal';
import { PageSpinner } from '@/components/ui/Spinner';

export const MOVEMENT_LABELS = {
  sale:           { label: 'Sale',           color: 'bg-red-100 text-red-700' },
  return:         { label: 'Return',         color: 'bg-blue-100 text-blue-700' },
  grn:            { label: 'GRN Receipt',    color: 'bg-green-100 text-green-700' },
  adjustment_in:  { label: 'Adj In',         color: 'bg-emerald-100 text-emerald-700' },
  adjustment_out: { label: 'Adj Out',        color: 'bg-orange-100 text-orange-700' },
  opening_stock:  { label: 'Opening Stock',  color: 'bg-purple-100 text-purple-700' },
  transfer_in:    { label: 'Transfer In',    color: 'bg-teal-100 text-teal-700' },
  transfer_out:   { label: 'Transfer Out',   color: 'bg-amber-100 text-amber-700' },
};

export function MovementBadge({ type }) {
  const m = MOVEMENT_LABELS[type] ?? { label: type, color: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${m.color}`}>
      {m.label}
    </span>
  );
}

/**
 * StockLedgerModal
 * Props:
 *   open        — boolean
 *   onClose     — fn
 *   productId   — string|null  (if set, ledger is scoped to that product)
 *   productName — string|null  (used for modal title)
 */
export default function StockLedgerModal({ open, onClose, productId = null, productName = null, branchId = null, branchName = null }) {
  const today     = todayLocal();
  const thirtyAgo = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);

  const [search,   setSearch]   = useState('');
  const [movType,  setMovType]  = useState('');
  const [fromDate, setFromDate] = useState(thirtyAgo);
  const [toDate,   setToDate]   = useState(today);
  const [page,     setPage]     = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['inventory-movements', productId, branchId, movType, fromDate, toDate, page],
    queryFn: () =>
      api.get('/inventory/movements', {
        params: {
          productId:    productId || undefined,
          branchId:     branchId  || undefined,
          movementType: movType   || undefined,
          fromDate,
          toDate,
          page,
          limit: 50,
        },
      }).then((r) => r.data.data),
    keepPreviousData: true,
    enabled: open,
  });

  const movements = (data?.movements ?? []).filter((m) =>
    !search ||
    m.product_name?.toLowerCase().includes(search.toLowerCase()) ||
    m.sku?.toLowerCase().includes(search.toLowerCase())
  );
  const total = data?.total ?? 0;
  const pages = data?.pages ?? 1;

  const title = productName
    ? `Stock Ledger — ${productName}${branchName ? ` · ${branchName}` : ''}`
    : 'Stock Ledger';

  return (
    <Modal open={open} onClose={onClose} title={title} size="xl">
      <div className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          {/* Only show product search when not scoped to a single product */}
          {!productId && (
            <div className="relative flex-1 min-w-40">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input type="text" placeholder="Search product…" value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none" />
            </div>
          )}
          <select value={movType} onChange={(e) => { setMovType(e.target.value); setPage(1); }}
            className="rounded-lg border border-gray-200 py-2 px-3 text-sm bg-white focus:border-primary-500 focus:outline-none">
            <option value="">All types</option>
            {Object.entries(MOVEMENT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5">
            <input type="date" value={fromDate} max={toDate}
              onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
              className="text-xs border-none outline-none bg-transparent" />
            <span className="text-gray-400 text-xs">—</span>
            <input type="date" value={toDate} min={fromDate} max={today}
              onChange={(e) => { setToDate(e.target.value); setPage(1); }}
              className="text-xs border-none outline-none bg-transparent" />
          </div>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
          {isLoading ? <PageSpinner /> : movements.length === 0 ? (
            <p className="py-12 text-center text-gray-400">No movements found for the selected period</p>
          ) : (
            <>
            {/* Desktop table — every column always visible */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Date & Time</th>
                    {!productId && <th className="px-4 py-3 text-left font-medium text-gray-600">Product</th>}
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Branch</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Type</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">Qty In</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">Qty Out</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">Balance</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Reference</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">User</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {movements.map((m) => (
                    <tr key={m.movement_id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{formatDateTime(m.created_at)}</td>
                      {!productId && (
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900 text-xs">{m.product_name}</p>
                          {m.sku && <p className="text-xs text-gray-400 font-mono">{m.sku}</p>}
                        </td>
                      )}
                      <td className="px-4 py-3 text-xs text-gray-500">{m.branch_name}</td>
                      <td className="px-4 py-3"><MovementBadge type={m.movement_type} /></td>
                      <td className="px-4 py-3 text-right">
                        {m.qty_in > 0 ? (
                          <span className="flex items-center justify-end gap-1 text-green-600 font-semibold text-sm">
                            <ArrowDownCircle className="h-3.5 w-3.5" />+{m.qty_in}
                          </span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {m.qty_out > 0 ? (
                          <span className="flex items-center justify-end gap-1 text-red-500 font-semibold text-sm">
                            <ArrowUpCircle className="h-3.5 w-3.5" />-{m.qty_out}
                          </span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-gray-800 text-sm">{m.qty_after}</td>
                      <td className="px-4 py-3">
                        {m.reference_no
                          ? <span className="font-mono text-xs text-primary-700 bg-primary-50 rounded px-1.5 py-0.5">{m.reference_no}</span>
                          : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{m.created_by_name ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="sm:hidden space-y-2 p-3">
              {movements.map((m) => (
                <div key={m.movement_id} className="rounded-xl border border-gray-100 bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      {!productId ? (
                        <>
                          <p className="font-medium text-gray-900 text-xs truncate">{m.product_name}</p>
                          {m.sku && <p className="text-xs text-gray-400 font-mono">{m.sku}</p>}
                        </>
                      ) : (
                        <p className="text-xs text-gray-500">{m.branch_name}</p>
                      )}
                    </div>
                    <MovementBadge type={m.movement_type} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                    <span className="whitespace-nowrap">{formatDateTime(m.created_at)}</span>
                    {!productId && <span>{m.branch_name}</span>}
                    <span className="font-bold text-gray-800">Balance: {m.qty_after}</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-4 text-xs">
                    {m.qty_in > 0 && (
                      <span className="flex items-center gap-1 text-green-600 font-semibold">
                        <ArrowDownCircle className="h-3.5 w-3.5" />+{m.qty_in}
                      </span>
                    )}
                    {m.qty_out > 0 && (
                      <span className="flex items-center gap-1 text-red-500 font-semibold">
                        <ArrowUpCircle className="h-3.5 w-3.5" />-{m.qty_out}
                      </span>
                    )}
                    {m.reference_no && (
                      <span className="font-mono text-primary-700 bg-primary-50 rounded px-1.5 py-0.5">{m.reference_no}</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-gray-400">{m.created_by_name ?? '—'}</p>
                </div>
              ))}
            </div>
            </>
          )}
          {pages > 1 && (
            <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
              <p className="text-xs text-gray-500">Page {page} of {pages} ({total} total movements)</p>
              <div className="flex gap-1">
                <button disabled={page <= 1} onClick={() => setPage(page - 1)}
                  className="rounded-md border border-gray-200 px-3 py-1 text-xs disabled:opacity-40 hover:bg-gray-50">← Prev</button>
                <button disabled={page >= pages} onClick={() => setPage(page + 1)}
                  className="rounded-md border border-gray-200 px-3 py-1 text-xs disabled:opacity-40 hover:bg-gray-50">Next →</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
