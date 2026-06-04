import { useState, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ShieldCheck, Delete } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/app/store';
import { computePinHash } from '@/lib/pinHash';
import api from '@/services/api';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';

// ── Shared sub-components (same style as LockScreen) ─────────────────────────

const KEYS = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

function PadKey({ label, onClick, disabled }) {
  if (label === '') return <div />;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'flex items-center justify-center rounded-xl text-lg font-semibold h-12 w-12',
        'transition-all duration-150 select-none border',
        label === '⌫'
          ? 'border-transparent text-gray-400 hover:text-gray-700'
          : 'border-gray-200 bg-gray-50 text-gray-800 hover:bg-gray-100 active:scale-95',
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
      ].join(' ')}
    >
      {label === '⌫' ? <Delete className="h-5 w-5" /> : label}
    </button>
  );
}

function PinDots({ length, filled, label }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
      <div className="flex gap-3 justify-center">
        {Array.from({ length }).map((_, i) => (
          <div
            key={i}
            className={[
              'h-3.5 w-3.5 rounded-full border-2 transition-all duration-150',
              i < filled
                ? 'bg-primary-600 border-primary-600 scale-110'
                : 'bg-transparent border-gray-300',
            ].join(' ')}
          />
        ))}
      </div>
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

/**
 * @param {boolean} open
 * @param {() => void} onClose
 * @param {boolean} hasPinSet  — true when changing an existing PIN
 */
export default function PinSetupModal({ open, onClose, hasPinSet = false }) {
  const user         = useAuthStore((s) => s.user);
  const setPinHash   = useAuthStore((s) => s.setPinHash);

  const [step,    setStep]    = useState('enter');   // 'enter' | 'confirm'
  const [first,   setFirst]   = useState('');
  const [second,  setSecond]  = useState('');
  const [mismatch, setMismatch] = useState(false);

  const reset = useCallback(() => {
    setStep('enter');
    setFirst('');
    setSecond('');
    setMismatch(false);
  }, []);

  const handleClose = () => { reset(); onClose(); };

  const setMut = useMutation({
    mutationFn: (pinHash) =>
      api.post('/auth/set-pin', { pinHash }).then((r) => r.data),
    onSuccess: (_, pinHash) => {
      setPinHash(pinHash);
      toast.success(hasPinSet ? 'PIN updated' : 'PIN set successfully');
      handleClose();
    },
    onError: () => toast.error('Failed to save PIN. Try again.'),
  });

  const activePin   = step === 'enter' ? first : second;
  const setActivePin = step === 'enter' ? setFirst : setSecond;

  const handleKey = useCallback(async (key) => {
    setMismatch(false);

    if (key === '⌫') {
      setActivePin((p) => p.slice(0, -1));
      return;
    }

    if (activePin.length >= 4) return;
    const next = activePin + key;
    setActivePin(next);

    if (next.length === 4) {
      if (step === 'enter') {
        // Move to confirm step
        setTimeout(() => setStep('confirm'), 80);
      } else {
        // Confirm step complete — check match
        setTimeout(async () => {
          if (next !== first) {
            setMismatch(true);
            setSecond('');
            return;
          }
          const hash = await computePinHash(first, user?.userId);
          setMut.mutate(hash);
        }, 80);
      }
    }
  }, [activePin, step, first, user?.userId, setActivePin, setMut]);

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={hasPinSet ? 'Change PIN' : 'Set Lock PIN'}
      size="sm"
    >
      <div className="flex flex-col items-center gap-6 py-2">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50">
          <ShieldCheck className="h-6 w-6 text-primary-600" />
        </div>

        <p className="text-sm text-gray-500 text-center max-w-xs">
          {step === 'enter'
            ? 'Choose a 4-digit PIN to lock your terminal.'
            : 'Enter the same PIN again to confirm.'}
        </p>

        <PinDots
          length={4}
          filled={activePin.length}
          label={step === 'enter' ? 'New PIN' : 'Confirm PIN'}
        />

        {mismatch && (
          <p className="text-sm text-red-600">PINs don't match — try again.</p>
        )}

        {/* Number pad */}
        <div className="grid grid-cols-3 gap-2">
          {KEYS.map((k, i) => (
            <PadKey
              key={i}
              label={k}
              onClick={() => handleKey(k)}
              disabled={setMut.isPending}
            />
          ))}
        </div>

        {step === 'confirm' && (
          <button
            type="button"
            onClick={() => { setStep('enter'); setFirst(''); setSecond(''); setMismatch(false); }}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Start over
          </button>
        )}

        <Button variant="secondary" fullWidth onClick={handleClose}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}
