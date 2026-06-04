import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Calendar } from 'lucide-react';
import api from '@/services/api';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { PageSpinner } from '@/components/ui/Spinner';
import { formatCurrency, formatDate } from '@/utils/formatters';

const todayISO = new Date().toISOString().slice(0, 10);
const toISO    = (d) => d.toISOString().slice(0, 10);

const SOURCE_COLORS = {
  GRN:     'bg-blue-100 text-blue-700',
  PAYMENT: 'bg-green-100 text-green-700',
  MANUAL:  'bg-gray-100 text-gray-600',
  VOID:    'bg-rose-100 text-rose-700',
  BILL:    'bg-amber-100 text-amber-700',
};

// ── Entry Lines Modal ─────────────────────────────────────────────────────────

function EntryLinesModal({ entryId, onClose }) {
  const { data: j, isLoading, error } = useQuery({
    queryKey: ['journal-entry', entryId],
    queryFn:  () => api.get(`/accounts/entry/${entryId}`).then((r) => r.data.data),
    enabled:  !!entryId,
    retry: false,
  });

  const fmt     = (n) => n > 0 ? formatCurrency(n) : '';
  const totalDr = (j?.lines ?? []).reduce((s, l) => s + (l.debit  ?? 0), 0);
  const totalCr = (j?.lines ?? []).reduce((s, l) => s + (l.credit ?? 0), 0);

  return (
    <Modal open onClose={onClose} size="lg"
      title={
        isLoading ? 'Loading…' : (
          <div>
            <p className="text-sm font-semibold text-gray-900 font-mono">{j?.journal_number}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {j?.entry_date ? String(j.entry_date).slice(0, 10) : ''}
              {j?.status && (
                <span className={`ml-2 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                  j.status === 'posted' ? 'bg-green-100 text-green-700'
                  : j.status === 'void' ? 'bg-red-100 text-red-600'
                  : 'bg-gray-100 text-gray-600'
                }`}>{j.status}</span>
              )}
            </p>
          </div>
        )
      }
      footer={<Button variant="secondary" fullWidth onClick={onClose}>Close</Button>}
    >
      {isLoading ? <PageSpinner /> : j ? (
        <div className="space-y-3">
          {j.description && (
            <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
              <span className="text-gray-400">Description: </span>{j.description}
            </div>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 text-xs font-medium text-gray-500">Account</th>
                <th className="text-left py-2 text-xs font-medium text-gray-500">Note / Entity</th>
                <th className="text-right py-2 text-xs font-medium text-blue-600 w-28">Dr</th>
                <th className="text-right py-2 text-xs font-medium text-green-600 w-28">Cr</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(j.lines ?? []).map((l) => (
                <tr key={l.lineId} className="hover:bg-gray-50">
                  <td className="py-2.5">
                    <span className="font-mono text-xs text-gray-400 mr-1.5">{l.accountCode}</span>
                    <span className="text-gray-800 text-xs">{l.accountName}</span>
                  </td>
                  <td className="py-2.5 text-xs text-gray-500">
                    {l.entityName
                      ? <><span className="capitalize text-gray-400">{l.entityType?.replace('_', ' ')}</span>: {l.entityName}</>
                      : l.description || '—'}
                  </td>
                  <td className="py-2.5 text-right font-mono text-xs font-semibold text-blue-700">{fmt(l.debit)}</td>
                  <td className="py-2.5 text-right font-mono text-xs font-semibold text-green-700">{fmt(l.credit)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-gray-300">
              <tr>
                <td colSpan={2} className="py-2 text-xs font-semibold text-gray-600">Totals</td>
                <td className="py-2 text-right font-mono text-xs font-bold text-blue-700">{formatCurrency(totalDr)}</td>
                <td className="py-2 text-right font-mono text-xs font-bold text-green-700">{formatCurrency(totalCr)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <p className="py-8 text-center text-gray-400 text-sm">
          {error ? `Error: ${error.response?.data?.message ?? error.message}` : 'Entry not found'}
        </p>
      )}
    </Modal>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SupplierLedgerPage() {
  const { supplierId } = useParams();
  const navigate       = useNavigate();

  const [startDate,      setStart]   = useState(toISO(new Date(Date.now() - 89 * 86400000)));
  const [endDate,        setEnd]     = useState(todayISO);
  const [page,           setPage]    = useState(1);
  const [viewingEntryId, setViewing] = useState(null);

  const { data: supplier } = useQuery({
    queryKey: ['supplier', supplierId],
    queryFn:  () => api.get(`/suppliers/${supplierId}`).then((r) => r.data.data),
    enabled:  !!supplierId,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['supplier-ledger', supplierId, startDate, endDate, page],
    queryFn:  () => api.get(`/suppliers/${supplierId}/ledger`, {
      params: { startDate, endDate, page, limit: 30 },
    }).then((r) => r.data.data),
    placeholderData: (prev) => prev,
    enabled: !!supplierId,
  });

  const { entries = [], total = 0, pages = 1 } = data ?? {};

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/app/suppliers')}
            className="flex items-center justify-center rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">{supplier?.supplier_name ?? 'Supplier'}</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              {supplier?.contact_person && `${supplier.contact_person} · `}
              {supplier?.payment_terms != null && `Net ${supplier.payment_terms} days`}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-400">Outstanding Balance</p>
          <p className={`text-lg font-bold mt-0.5 ${parseFloat(supplier?.current_balance ?? 0) > 0 ? 'text-red-600' : 'text-gray-800'}`}>
            {supplier ? formatCurrency(supplier.current_balance) : '—'}
          </p>
        </div>
      </div>

      {/* Date filter */}
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 w-fit">
        <Calendar className="h-3.5 w-3.5 text-gray-400" />
        <input type="date" value={startDate} max={endDate}
          onChange={(e) => { setStart(e.target.value); setPage(1); }}
          className="text-xs border-none outline-none bg-transparent" />
        <span className="text-gray-400 text-xs">—</span>
        <input type="date" value={endDate} min={startDate} max={todayISO}
          onChange={(e) => { setEnd(e.target.value); setPage(1); }}
          className="text-xs border-none outline-none bg-transparent" />
      </div>

      {/* Entries table */}
      {isLoading ? <PageSpinner /> : entries.length === 0 ? (
        <div className="rounded-xl border border-gray-100 bg-white py-16 text-center text-gray-400 text-sm">
          No journal entries for this supplier in the selected period
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Date</th>
                <th className="hidden sm:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500">Type</th>
                <th className="hidden sm:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500">Reference</th>
                <th className="hidden md:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500">Description</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-blue-600">Dr</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-green-600">Cr</th>
                <th className="px-2 py-3 text-center text-xs font-medium text-gray-500">Entry</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {entries.map((e) => (
                <tr key={e.entryId} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{formatDate(e.entryDate)}</td>
                  <td className="hidden sm:table-cell px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${SOURCE_COLORS[e.sourceType] ?? 'bg-gray-100 text-gray-600'}`}>
                      {e.sourceType ?? '—'}
                    </span>
                  </td>
                  <td className="hidden sm:table-cell px-4 py-3 font-mono text-xs text-gray-600">{e.entryNumber ?? '—'}</td>
                  <td className="hidden md:table-cell px-4 py-3 text-xs text-gray-700 truncate max-w-xs">{e.description ?? '—'}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs">
                    {e.debit > 0 ? <span className="font-semibold text-blue-700">{formatCurrency(e.debit)}</span> : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs">
                    {e.credit > 0 ? <span className="font-semibold text-green-700">{formatCurrency(e.credit)}</span> : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-2 py-3 text-center">
                    <button onClick={() => setViewing(e.entryId)}
                      className="rounded-lg border border-primary-200 bg-primary-50 px-2 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-100 transition-colors">
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>Page {page} of {pages} · {total} entries</span>
          <div className="flex gap-1">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
              className="rounded border px-3 py-1.5 disabled:opacity-40 hover:bg-gray-50">Prev</button>
            <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)}
              className="rounded border px-3 py-1.5 disabled:opacity-40 hover:bg-gray-50">Next</button>
          </div>
        </div>
      )}

      {viewingEntryId && <EntryLinesModal entryId={viewingEntryId} onClose={() => setViewing(null)} />}
    </div>
  );
}
