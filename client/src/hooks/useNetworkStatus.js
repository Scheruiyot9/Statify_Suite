import { useState, useEffect } from 'react';
import { onlineManager } from '@tanstack/react-query';

// ── Active connectivity detection ─────────────────────────────────────────────
// navigator.onLine only checks the network adapter — it stays true when the
// machine has LAN but the Contabo server is unreachable (the real offline case).
// We ping the server directly every 30 s instead.

const PING_URL      = '/api/v1/health';
const PING_INTERVAL = 30_000; // ms between checks
const PING_TIMEOUT  = 5_000;  // ms before giving up on a single ping

async function pingServer() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PING_TIMEOUT);
    const res = await fetch(PING_URL, {
      method: 'GET',
      cache:  'no-store',
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

// ── Singleton — shared across all hook consumers ──────────────────────────────
// One interval, one set of listeners — no matter how many components call the hook.

let _online   = true;         // optimistic initial value (avoids false offline flash)
let _interval = null;
const _listeners = new Set();

function _notify(online) {
  if (online === _online) return;   // no change — skip unnecessary renders
  _online = online;
  onlineManager.setOnline(online);  // keep React Query in sync — pauses/resumes queries
  _listeners.forEach((fn) => fn(online));
}

async function _check() {
  _notify(await pingServer());
}

function _ensureRunning() {
  if (_interval) return;                                  // already started
  _check();                                               // immediate first ping
  _interval = setInterval(_check, PING_INTERVAL);        // recurring pings
  window.addEventListener('online',  _check);            // browser hint → re-ping immediately
  window.addEventListener('offline', () => _notify(false)); // instant pessimistic on NIC drop
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export default function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(_online);

  useEffect(() => {
    _listeners.add(setIsOnline);
    _ensureRunning();
    return () => _listeners.delete(setIsOnline);
  }, []);

  return isOnline;
}
