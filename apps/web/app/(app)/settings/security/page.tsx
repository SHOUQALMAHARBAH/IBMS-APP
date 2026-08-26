'use client';

import Image from 'next/image';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import { enrollTotp, logout, verifyTotpEnrollment, type MfaEnrollResponse } from '../../../../lib/auth/auth-api';
import { ApiError } from '../../../../lib/auth/api-client';
import { buttonStyle, errorStyle, inputStyle, labelStyle, successStyle } from '../../../../components/auth/auth-form.styles';

export default function SecuritySettingsPage() {
  const router = useRouter();
  const { user, isLoading, refreshUser, clearUser } = useAuth();

  const [enrollment, setEnrollment] = useState<MfaEnrollResponse | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  if (isLoading || !user) return null;

  async function handleStartEnrollment() {
    setError(null);
    setIsBusy(true);
    try {
      setEnrollment(await enrollTotp());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start MFA enrollment.');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    if (!enrollment) return;
    setError(null);
    setIsBusy(true);
    try {
      await verifyTotpEnrollment({ credentialId: enrollment.credentialId, code });
      setEnrollment(null);
      setCode('');
      setMessage('Multi-factor authentication is now enabled on your account.');
      await refreshUser();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Invalid code — try again.');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleLogout() {
    await logout();
    clearUser();
    router.push('/login');
  }

  return (
    <main style={{ maxWidth: '32rem', margin: '0 auto', padding: '2rem' }}>
      <h1>Security</h1>

      <section style={{ marginTop: '2rem' }}>
        <h2>Multi-factor authentication</h2>
        <p>
          Status: <strong>{user.mfaEnabled ? 'Enabled' : 'Not enrolled — required before you can use most of IBMS'}</strong>
        </p>
        {!user.mfaPolicySatisfied && user.mfaEnabled ? (
          <p style={{ fontSize: '0.85rem', opacity: 0.8 }}>
            Your role requires a hardware security key. That enrollment path isn&apos;t available yet — an
            authenticator-app code satisfies the mandatory-MFA requirement for now.
          </p>
        ) : null}

        {message ? <p style={successStyle}>{message}</p> : null}

        {user.mfaEnabled ? null : enrollment ? (
          <div>
            <p>Scan this QR code with your authenticator app, then enter the 6-digit code it shows.</p>
            <Image src={enrollment.qrCodeDataUrl} alt="MFA enrollment QR code" width={200} height={200} unoptimized />
            <form onSubmit={(e) => void handleVerify(e)}>
              <label htmlFor="code" style={labelStyle}>
                Authentication code
              </label>
              <input
                id="code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                style={inputStyle}
              />
              {error ? (
                <p role="alert" style={errorStyle}>
                  {error}
                </p>
              ) : null}
              <button type="submit" disabled={isBusy} style={buttonStyle}>
                {isBusy ? 'Verifying…' : 'Verify and enable'}
              </button>
            </form>
          </div>
        ) : (
          <button type="button" onClick={() => void handleStartEnrollment()} disabled={isBusy} style={buttonStyle}>
            {isBusy ? 'Starting…' : 'Enroll authenticator app'}
          </button>
        )}
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2>Session</h2>
        <p>Idle timeout: {user.idleTimeoutMinutes} minutes</p>
        <p>Automatic sign-out after: {user.hardLogoutAfterIdleMinutes} minutes idle</p>
        {user.accessValidUntil ? <p>Your access to IBMS ends: {new Date(user.accessValidUntil).toLocaleString()}</p> : null}
      </section>

      <button type="button" onClick={() => void handleLogout()} style={{ ...buttonStyle, marginTop: '2rem' }}>
        Sign out
      </button>
    </main>
  );
}
