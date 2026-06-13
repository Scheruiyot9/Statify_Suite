import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw, X } from 'lucide-react';

export default function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onOfflineReady() {},
  });

  if (!needRefresh) return null;

  return (
    <div className="fixed bottom-20 left-3 right-3 z-50 lg:bottom-6 lg:left-auto lg:right-6 lg:max-w-sm">
      <div
        className="flex items-start gap-3 rounded-2xl p-4 shadow-xl border border-white/10 text-white"
        style={{ background: 'linear-gradient(135deg, #024A59 0%, #012e3a 100%)' }}
      >
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-secondary-500">
          <RefreshCw className="h-5 w-5 text-primary-900" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white leading-tight">Update available</p>
          <p className="text-xs text-white/65 mt-0.5 leading-snug">
            A new version of Statify is ready.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => updateServiceWorker(true)}
              className="flex items-center gap-1.5 rounded-lg bg-secondary-500 px-3 py-1.5 text-xs font-semibold text-primary-900 hover:bg-secondary-400 transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh now
            </button>
            <button
              onClick={() => setNeedRefresh(false)}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-xs font-medium text-white/70 hover:bg-white/10 transition-colors"
            >
              Later
            </button>
          </div>
        </div>
        <button
          onClick={() => setNeedRefresh(false)}
          className="flex-shrink-0 rounded-md p-1 text-white/40 hover:text-white/70 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
