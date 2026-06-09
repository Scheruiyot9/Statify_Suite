import { useState, useEffect } from 'react';
import { Download, X, Monitor } from 'lucide-react';

/**
 * PWA install prompt.
 * Shows a banner when the browser fires the `beforeinstallprompt` event.
 * Dismissed state is persisted in localStorage for 30 days.
 */
export default function InstallPrompt() {
  const [prompt, setPrompt]       = useState(null);
  const [visible, setVisible]     = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    // Don't show if already running as installed PWA
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    if (window.navigator.standalone) return; // iOS

    // Don't show if dismissed recently
    const dismissed = localStorage.getItem('pwa-install-dismissed');
    if (dismissed && Date.now() - Number(dismissed) < 30 * 24 * 60 * 60 * 1000) return;

    const handler = (e) => {
      e.preventDefault();
      setPrompt(e);
      setVisible(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', () => setInstalled(true));

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!prompt) return;
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') setInstalled(true);
    setVisible(false);
  };

  const handleDismiss = () => {
    localStorage.setItem('pwa-install-dismissed', String(Date.now()));
    setVisible(false);
  };

  if (!visible || installed) return null;

  return (
    <div className="fixed bottom-20 left-3 right-3 z-50 lg:bottom-6 lg:left-auto lg:right-6 lg:max-w-sm">
      <div
        className="flex items-start gap-3 rounded-2xl p-4 shadow-xl border border-white/10 text-white"
        style={{ background: 'linear-gradient(135deg, #024A59 0%, #012e3a 100%)' }}
      >
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-secondary-500">
          <Monitor className="h-5 w-5 text-primary-900" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white leading-tight">Install Statify POS</p>
          <p className="text-xs text-white/65 mt-0.5 leading-snug">
            Add to your desktop for faster access — works like a native app.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={handleInstall}
              className="flex items-center gap-1.5 rounded-lg bg-secondary-500 px-3 py-1.5 text-xs font-semibold text-primary-900 hover:bg-secondary-400 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Install
            </button>
            <button
              onClick={handleDismiss}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-xs font-medium text-white/70 hover:bg-white/10 transition-colors"
            >
              Not now
            </button>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="flex-shrink-0 rounded-md p-1 text-white/40 hover:text-white/70 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
