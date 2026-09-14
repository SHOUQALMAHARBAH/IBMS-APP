'use client';

import { useCallback, useState, type CSSProperties, type FormEvent } from 'react';
import { useLanguage } from '../../lib/i18n/language-context';
import { useRouter } from 'next/navigation';
import { useIdleTimer } from '../../lib/auth/use-idle-timer';
import { logout, stepUp, type MeResponse } from '../../lib/auth/auth-api';
import { ApiError } from '../../lib/auth/api-client';

interface IdleLockOverlayProps {
  user: MeResponse;
  onLockedOut: () => void;
}

export function IdleLockOverlay({ user, onLockedOut }: IdleLockOverlayProps) {
  const { t } = useLanguage();
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
      setError(err instanceof ApiError ? err.message : t('authUnlockError'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={t('authSessionLocked')} style={overlayStyle}>
      <form onSubmit={(e) => void handleUnlock(e)} style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>{t('authSessionLocked')}</h2>
        <p style={{ opacity: 0.8 }}>{t('authIdlePrompt')}</p>
        <label htmlFor="unlock-password" style={labelStyle}>
          {t('authPasswordLabel')}
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
              {t('authMfaCodeLabel')}
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
          {isSubmitting ? t('authUnlocking') : t('authUnlockButton')}
        </button>
        <button type="button" onClick={handleHardLogout} style={linkButtonStyle}>{t('authSignOutInstead')}</button>
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
