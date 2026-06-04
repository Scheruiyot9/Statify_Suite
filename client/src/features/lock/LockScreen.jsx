import { useState, useEffect, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Lock, Delete, LogOut, AlertCircle } from 'lucide-react';
import { useAuthStore } from '@/app/store';
import { computePinHash } from '@/lib/pinHash';
import api from '@/services/api';
import useNetworkStatus from '@/hooks/useNetworkStatus';

const MAX_ATTEMPTS = 5;

// ── Number pad ────────────────────────────────────────────────────────────────
const KEYS = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

function PadKey({ label, onClick, disabled }) {
  if (label === '') return <div />;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        'flex items-center justify-center rounded-2xl text-xl font-semibold h-16 w-16',
        'transition-all duration-150 select-none',
        label === '⌫'
          ? 'text-gray-400 hover:text-white hover:bg-white/10'
          : 'bg-white/10 text-white hover:bg-white/20 active:scale-95',
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
      ].join(' ')}
    >
      {label === '⌫' ? <Delete className="h-6 w-6" /> : label}
    </button>
  );
}

// ── PIN dots ──────────────────────────────────────────────────────────────────
function PinDots({ length, filled, shake }) {
  return (
    <div className={`flex gap-4 justify-center ${shake ? 'animate-shake' : ''}`}>
      {Array.from({ length }).map((_, i) => (
        <div
          key={i}
          className={[
            'h-4 w-4 rounded-full border-2 transition-all duration-200',
            i < filled
              ? 'bg-white border-white scale-110'
              : 'bg-transparent border-white/40',
          ].join(' ')}
        />
      ))}
    </div>
  );
}

// ── Clock ─────────────────────────────────────────────────────────────────────
function Clock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="text-center">
      <div className="text-5xl font-light text-white tabular-nums">
        {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </div>
      <div className="text-sm text-white/60 mt-1">
        {time.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
      </div>
    </div>
  );
}

// ── Main LockScreen ───────────────────────────────────────────────────────────
export default function LockScreen() {
  const isLocked  = useAuthStore((s) => s.isLocked);
  const unlock    = useAuthStore((s) => s.unlock);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const user      = useAuthStore((s) => s.user);
  const pinHash   = useAuthStore((s) => s.pinHash);
  const isOnline  = useNetworkStatus();

  const [pin,      setPin]      = useState('');
  const [attempts, setAttempts] = useState(0);
  const [shake,    setShake]    = useState(false);
  const [error,    setError]    = useState('');

  // Reset state whenever the screen appears
  useEffect(() => {
    if (isLocked) {
      setPin('');
      setAttempts(0);
      setError('');
    }
  }, [isLocked]);

  // Online verify-pin mutation
  const verifyMut = useMutation({
    mutationFn: (hash) => api.post('/auth/verify-pin', { pinHash: hash }).then((r) => r.data.data),
  });

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 600);
  };

  const handleWrongPin = useCallback((attemptsUsed) => {
    setPin('');
    triggerShake();
    const remaining = MAX_ATTEMPTS - attemptsUsed;
    if (remaining <= 0) {
      setError('Too many attempts. Please sign in again.');
      setTimeout(() => clearAuth(), 1500);
    } else {
      setError(`Incorrect PIN. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`);
    }
  }, [clearAuth]);

  const submitPin = useCallback(async (enteredPin) => {
    if (enteredPin.length !== 4) return;
    const newAttempts = attempts + 1;
    setAttempts(newAttempts);
    setError('');

    const hash = await computePinHash(enteredPin, user?.userId);

    if (isOnline) {
      // Prefer server-side verification (authoritative)
      try {
        const result = await verifyMut.mutateAsync(hash);
        if (result?.valid) {
          unlock();
          setPin('');
        } else {
          handleWrongPin(newAttempts);
        }
      } catch {
        // Server error — fall back to local check
        if (pinHash && hash === pinHash) {
          unlock();
          setPin('');
        } else {
          handleWrongPin(newAttempts);
        }
      }
    } else {
      // Offline — compare against locally cached hash
      if (pinHash && hash === pinHash) {
        unlock();
        setPin('');
      } else {
        handleWrongPin(newAttempts);
      }
    }
  }, [attempts, user?.userId, isOnline, pinHash, unlock, handleWrongPin, verifyMut]);

  const handleKey = useCallback((key) => {
    if (key === '⌫') {
      setPin((p) => p.slice(0, -1));
      setError('');
      return;
    }
    if (pin.length >= 4) return;
    const next = pin + key;
    setPin(next);
    if (next.length === 4) {
      // slight delay so user sees the 4th dot fill before submit
      setTimeout(() => submitPin(next), 80);
    }
  }, [pin, submitPin]);

  if (!isLocked) return null;

  const hasPinSet = !!pinHash;
  const locked    = attempts >= MAX_ATTEMPTS;

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-gradient-to-br from-[#024A59] to-[#012F38] select-none">

      {/* Company / user info */}
      <div className="flex flex-col items-center gap-2 mb-8">
        <div className="h-14 w-14 rounded-2xl bg-white/10 flex items-center justify-center mb-2">
          <Lock className="h-7 w-7 text-white" />
        </div>
        <Clock />
        <div className="mt-4 text-center">
          <p className="text-white font-semibold text-lg">
            {user?.firstName} {user?.lastName}
          </p>
          <p className="text-white/50 text-sm">{user?.activeCompanyName || 'Statify POS'}</p>
        </div>
      </div>

      {/* PIN area */}
      {hasPinSet ? (
        <div className="flex flex-col items-center gap-6">
          <p className="text-white/70 text-sm">Enter your PIN to unlock</p>

          <PinDots length={4} filled={pin.length} shake={shake} />

          {error && (
            <div className="flex items-center gap-2 text-red-300 text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Number pad */}
          <div className="grid grid-cols-3 gap-3 mt-2">
            {KEYS.map((k, i) => (
              <PadKey
                key={i}
                label={k}
                onClick={() => handleKey(k)}
                disabled={locked || verifyMut.isPending}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="text-center space-y-3 max-w-xs px-6">
          <p className="text-white/70 text-sm">
            No PIN has been set for this account. Please sign in with your password.
          </p>
        </div>
      )}

      {/* Sign-in fallback */}
      <button
        onClick={() => clearAuth()}
        className="mt-10 flex items-center gap-2 text-white/40 hover:text-white/70 text-sm transition-colors"
      >
        <LogOut className="h-4 w-4" />
        Sign in with password
      </button>

      {/* Offline badge */}
      {!isOnline && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs px-3 py-1.5 rounded-full">
          Offline — using cached PIN
        </div>
      )}
    </div>
  );
}
