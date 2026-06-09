import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { queryClient } from './app/queryClient';
import ErrorBoundary from './components/ui/ErrorBoundary';
import InstallPrompt from './components/ui/InstallPrompt';
import './index.css';

// Register service worker — auto-updates in the background
registerSW({
  onNeedRefresh() {}, // silent auto-update
  onOfflineReady() {
    console.log('[PWA] App ready to work offline');
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <InstallPrompt />
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: { fontSize: '0.875rem' },
            success: { iconTheme: { primary: '#FFA916', secondary: '#000' } },
          }}
        />
      </BrowserRouter>
    </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
