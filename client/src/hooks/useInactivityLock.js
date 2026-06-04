import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/app/store';

// Events that count as "user is active"
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];

/**
 * Watches for user inactivity and locks the terminal after the company-configured
 * timeout.  Must be mounted inside an authenticated layout.
 *
 * Behaviour:
 *   - Timer resets on any mouse / keyboard / touch activity
 *   - When the timer fires it sets isLocked = true in the auth store
 *   - The LockScreen overlay reads isLocked and covers the whole app
 *   - Once locked the timer stops (avoids duplicate lock calls)
 */
export default function useInactivityLock() {
  const lockTimeoutMinutes = useAuthStore((s) => s.lockTimeoutMinutes);
  const isLocked           = useAuthStore((s) => s.isLocked);
  const accessToken        = useAuthStore((s) => s.accessToken);
  const lock               = useAuthStore((s) => s.lock);
  const timerRef           = useRef(null);

  useEffect(() => {
    // Conditions that disable the lock
    if (!accessToken)          return; // not logged in
    if (!lockTimeoutMinutes)   return; // company has disabled the feature
    if (isLocked)              return; // already locked — stop timer

    const ms = lockTimeoutMinutes * 60 * 1000;

    const reset = () => {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(lock, ms);
    };

    reset(); // start counting from now
    ACTIVITY_EVENTS.forEach((evt) =>
      window.addEventListener(evt, reset, { passive: true })
    );

    return () => {
      clearTimeout(timerRef.current);
      ACTIVITY_EVENTS.forEach((evt) =>
        window.removeEventListener(evt, reset)
      );
    };
  }, [accessToken, lockTimeoutMinutes, isLocked, lock]);
}
