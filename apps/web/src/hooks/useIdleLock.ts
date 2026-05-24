import { useEffect, useRef } from 'react';

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'] as const;

/**
 * Calls `onLock` after `timeoutMs` milliseconds of inactivity.
 * Resets whenever the user moves the mouse, presses a key, etc.
 */
export function useIdleLock(onLock: () => void, timeoutMs: number) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onLockRef = useRef(onLock);
  onLockRef.current = onLock;

  useEffect(() => {
    if (timeoutMs <= 0) return;

    const reset = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        onLockRef.current();
      }, timeoutMs);
    };

    reset(); // start the clock immediately

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, reset, { passive: true });
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, reset);
      }
    };
  }, [timeoutMs]);
}
