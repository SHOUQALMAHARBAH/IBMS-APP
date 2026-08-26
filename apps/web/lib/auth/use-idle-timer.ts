'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { heartbeat } from './auth-api';

// Part 8.3 — configurable idle timeout + automatic screen lock. Two
// thresholds: `idleTimeoutMinutes` locks the screen (still signed in,
// requires a password re-entry to resume); `hardLogoutAfterIdleMinutes` (a
// further grace period past that) signs the session out entirely.
const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = ['mousemove', 'keydown', 'mousedown', 'scroll', 'touchstart'];
const HEARTBEAT_THROTTLE_MS = 30_000;
const CHECK_INTERVAL_MS = 5_000;

interface UseIdleTimerOptions {
  idleTimeoutMinutes: number;
  hardLogoutAfterIdleMinutes: number;
  onHardLogout: () => void;
}

export function useIdleTimer({ idleTimeoutMinutes, hardLogoutAfterIdleMinutes, onHardLogout }: UseIdleTimerOptions) {
  const [isLocked, setIsLocked] = useState(false);
  // 0, not Date.now() — reading the clock is a side effect and isn't allowed
  // during render; the real starting timestamp is set in the effect below.
  const lastActivityAt = useRef(0);
  const lastHeartbeatAt = useRef(0);
  const isLockedRef = useRef(isLocked);

  useEffect(() => {
    isLockedRef.current = isLocked;
  }, [isLocked]);

  useEffect(() => {
    if (lastActivityAt.current === 0) lastActivityAt.current = Date.now();
  }, []);

  const recordActivity = useCallback(() => {
    if (isLockedRef.current) return; // locked screen doesn't count as activity — unlocking requires step-up
    const now = Date.now();
    lastActivityAt.current = now;
    if (now - lastHeartbeatAt.current > HEARTBEAT_THROTTLE_MS) {
      lastHeartbeatAt.current = now;
      // Keeps the *server-side* session alive during page-view-only activity
      // between real API calls — see AuthController#heartbeat.
      heartbeat().catch(() => {
        /* a failed heartbeat just means the next real request surfaces the 401 */
      });
    }
  }, []);

  useEffect(() => {
    for (const event of ACTIVITY_EVENTS) window.addEventListener(event, recordActivity, { passive: true });
    return () => {
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, recordActivity);
    };
  }, [recordActivity]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const idleMinutes = (Date.now() - lastActivityAt.current) / 60_000;
      if (idleMinutes >= hardLogoutAfterIdleMinutes) {
        onHardLogout();
      } else if (idleMinutes >= idleTimeoutMinutes) {
        setIsLocked(true);
      }
    }, CHECK_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [idleTimeoutMinutes, hardLogoutAfterIdleMinutes, onHardLogout]);

  const unlock = useCallback(() => {
    lastActivityAt.current = Date.now();
    setIsLocked(false);
  }, []);

  return { isLocked, unlock };
}
