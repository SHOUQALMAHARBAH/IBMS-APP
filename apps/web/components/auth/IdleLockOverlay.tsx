'use client';

import { useCallback, useState, type CSSProperties, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useIdleTimer } from '../../lib/auth/use-idle-timer';
import { logout, stepUp, type MeResponse } from '../../lib/auth/auth-api';
import { ApiError } from '../../lib/auth/api-client';

interface IdleLockOverlayProps {
  user: MeResponse;
  onLockedOut: () => void;
}

export function IdleLockOverlay({ user, onLockedOut }: IdleLockOverlayProps) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleHardLogout = useCallback(() => {
    logout()
      .catch(() => {
        /* best-effort — the local session is being torn down either way */
      })
      .finally(() => {
        onLockedOut();
        router.push('/login?reason=idle');
      });
  }, [onLockedOut, router]);

  const { isLocked, unlock } = useIdleTimer({
    idleTimeoutMinutes: user.idleTimeoutMinutes,
    hardLogoutAfterIdleMinutes: user.hardLogoutAfterIdleMinutes,
    onHardLogout: handleHardLogout,
  });

  if (!isLocked) return null;

  async function handleUnlock(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await stepUp({ password, code: user.mfaEnabled ? code : undefined });
      setPassword('');
      setCode('');
      unlock();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not unlock — try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Session locked" style={overlayStyle}>
      <form onSubmit={(e) => void handleUnlock(e)} style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Session locked</h2>
        <p style={{ opacity: 0.8 }}>You&apos;ve been idle for a while. Re-enter your password to continue.</p>
        <label htmlFor="unlock-password" style={labelStyle}>
          Password
        </label>
        <input
          id="unlock-password"
          type="password"
          autoFocus
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={inputStyle}
        />
        {user.mfaEnabled ? (
          <>
            <label htmlFor="unlock-code" style={labelStyle}>
              Authentication code
            </label>
            <input
              id="unlock-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              style={inputStyle}
            />
          </>
        ) : null}
        {error ? (
          <p role="alert" style={{ color: '#d33', fontSize: '0.9rem' }}>
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={isSubmitting} style={buttonStyle}>
          {isSubmitting ? 'Unlocking…' : 'Unlock'}
        </button>
        <button type="button" onClick={handleHardLogout} style={linkButtonStyle}>
          Sign out instead
        </button>
      </form>
    </div>
  );
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 9999,
};

const cardStyle: CSSProperties = {
  background: 'var(--background)',
  color: 'var(--foreground)',
  padding: '2rem',
  borderRadius: '0.5rem',
  width: '22rem',
  maxWidth: '90vw',
  boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
};

const labelStyle: CSSProperties = { display: 'block', marginTop: '1rem', marginBottom: '0.25rem' };
const inputStyle: CSSProperties = { width: '100%', padding: '0.5rem', boxSizing: 'border-box' };
const buttonStyle: CSSProperties = {
  marginTop: '1.5rem',
  width: '100%',
  padding: '0.6rem',
  cursor: 'pointer',
};
const linkButtonStyle: CSSProperties = {
  marginTop: '0.75rem',
  width: '100%',
  background: 'none',
  border: 'none',
  textDecoration: 'underline',
  cursor: 'pointer',
  color: 'inherit',
};
