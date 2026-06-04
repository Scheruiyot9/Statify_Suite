import { X, WifiOff, Clock, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { usePosDataStore } from '@/app/store';
import { formatCurrency } from '@/utils/formatters';
import Button from '@/components/ui/Button';

const STATUS_CONFIG = {
  pending: { label: 'Queued',  icon: Clock,         cls: 'bg-amber-100 text-amber-700' },
  failed:  { label: 'Failed',  icon: AlertCircle,   cls: 'bg-red-100   text-red-700'   },
  synced:  { label: 'Synced',  icon: CheckCircle,   cls: 'bg-green-100 text-green-700' },
};

function timeStr(isoString) {
  return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function payloadTotal(payload) {
  if (!payload?.items) return 0;
  return payload.items.reduce((s, i) => s + (i.lineTotal || 0), 0);
}

export default function OfflineQueueModal({ open, onClose, onSyncAll, isSyncing }) {
  const queue     = usePosDataStore((s) => s.offlineQueue);
  const retryItem = usePosDataStore((s) => s.retryItem);
  const markSynced = usePosDataStore((s) => s.markSynced);

  if (!open) return null;

  const pending = queue.filter((q) => q.status === 'pending').length;
  const failed  = queue.filter((q) => q.status === 'failed').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <WifiOff className="h-5 w-5 text-amber-600" />
            <h2 className="text-base font-bold text-gray-900">
              Offline Queue
              {queue.length > 0 && (
                <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                  {queue.length}
                </span>
              )}
            </h2>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Status summary */}
        {queue.length > 0 && (
          <div className="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
            <div className="flex gap-4 text-xs">
              {pending > 0 && <span className="text-amber-700 font-medium">{pending} pending</span>}
              {failed  > 0 && <span className="text-red-600   font-medium">{failed}  failed</span>}
            </div>
            {pending > 0 && (
              <button
                onClick={onSyncAll}
                disabled={isSyncing}
                className="flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-600 disabled:opacity-60 transition-colors"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                {isSyncing ? 'Syncing…' : 'Sync All'}
              </button>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {queue.length === 0 && (
            <div className="py-12 text-center">
              <CheckCircle className="mx-auto mb-3 h-10 w-10 text-green-200" />
              <p className="text-sm text-gray-400">Queue is empty</p>
              <p className="text-xs text-gray-300 mt-1">All transactions have been synced</p>
            </div>
          )}

          {queue.map((item) => {
            const cfg   = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.pending;
            const Icon  = cfg.icon;
            const total = payloadTotal(item.payload);
            const itemCount = item.payload?.items?.length ?? 0;
            return (
              <div key={item.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${cfg.cls}`}>
                        <Icon className="h-3 w-3" />
                        {cfg.label}
                      </span>
                      <span className="text-xs text-gray-400">{timeStr(item.queuedAt)}</span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">{itemCount} item{itemCount !== 1 ? 's' : ''}</p>
                    {item.errorMsg && (
                      <p className="mt-1 text-xs text-red-500">{item.errorMsg}</p>
                    )}
                  </div>
                  <p className="text-sm font-bold text-secondary-600 flex-shrink-0">
                    {formatCurrency(total)}
                  </p>
                </div>

                {/* Customer */}
                {item.payload?.customerId && (
                  <p className="text-xs text-gray-400">Customer ID: {item.payload.customerId}</p>
                )}

                {/* Actions for failed items */}
                {item.status === 'failed' && (
                  <button
                    onClick={() => retryItem(item.id)}
                    className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800 font-medium"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Retry
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="border-t border-gray-100 px-4 py-3">
          <Button variant="secondary" fullWidth onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}
