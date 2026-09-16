'use client';

import Image from 'next/image';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  changePassword,
  enrollTotp,
  listTrustedDevices,
  logout,
  revokeTrustedDevice,
  verifyTotpEnrollment,
  type MfaEnrollResponse,
  type TrustedDevice,
} from '../../../../lib/auth/auth-api';
import { ApiError } from '../../../../lib/auth/api-client';
import { buttonDisabledStyle, buttonStyle, errorStyle, inputStyle, labelStyle, successStyle } from '../../../../components/auth/auth-form.styles';
import {
  PasswordRequirements,
  meetsPasswordPolicy,
} from '../../../../components/auth/PasswordRequirements';
import { useLanguage } from '../../../../lib/i18n/language-context';
import { formatDateTime } from '../../../../lib/i18n/format';

export default function SecuritySettingsPage() {
  const router = useRouter();
  const { user, isLoading, refreshUser, clearUser } = useAuth();
  const { language, t, tPlural } = useLanguage();

  const [enrollment, setEnrollment] = useState<MfaEnrollResponse | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  // Part II §4.7 — self-service change. Its own error/message state, so a
  // failed password change never overwrites the MFA section's feedback (or
  // the other way round) on a screen that shows both at once.
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwMessage, setPwMessage] = useState<string | null>(null);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // Part II §4.4 — the devices skipping the second factor. Own error state,
  // like the password block: a failed revoke must not blank the MFA section.
  const [devices, setDevices] = useState<TrustedDevice[] | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  /*
   * The initial device read.
   *
   * Hooks sit above the early return below, because React requires the same
   * hook order on every render and this page returns null while the session
   * resolves.
   *
   * The state is set inside the promise callback rather than in the effect
   * body — the shape `react-hooks/set-state-in-effect` allows, and the one it
   * rejects when an awaited helper is called directly. `cancelled` closes the
   * other half of the same problem: navigating away mid-request would
   * otherwise set state on an unmounted page.
   */
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    listTrustedDevices()
      .then((list) => {
        if (!cancelled) setDevices(list);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDeviceError(err instanceof ApiError ? err.message : t('authGenericError'));
        // null would render the loading state forever; an empty list beside
        // the error line says "we tried, and could not".
        setDevices([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user, t]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  if (isLoading || !user) return null;

  async function handleStartEnrollment() {
    setError(null);
    setIsBusy(true);
    try {
      setEnrollment(await enrollTotp());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('secEnrollError'));
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
      setMessage(t('secEnabledMessage'));
      await refreshUser();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('secInvalidCode'));
    } finally {
      setIsBusy(false);
    }
  }

  const canChangePassword =
    !isChangingPassword &&
    currentPassword.length > 0 &&
    meetsPasswordPolicy(newPassword) &&
    newPassword === confirmPassword;

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    setPwError(null);
    setPwMessage(null);
    if (newPassword !== confirmPassword) {
      setPwError(t('authPasswordMismatch'));
      return;
    }
    setIsChangingPassword(true);
    try {
      const { otherSessionsRevoked } = await changePassword({
        currentPassword,
        newPassword,
      });
      // Worth stating rather than swallowing: how a user notices someone else
      // had a session open as them. Through tPlural because Arabic has six
      // forms for a count, not two.
      setPwMessage(
        `${t('secPasswordChanged')} ${tPlural('secOtherSessionsRevoked', otherSessionsRevoked)}`,
      );
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      // The server's own wording: a wrong current password, or a reuse of one
      // of the last five, which only the server can know.
      setPwError(err instanceof ApiError ? err.message : t('authGenericError'));
    } finally {
      setIsChangingPassword(false);
    }
  }

  async function handleRevokeDevice(id: string) {
    setDeviceError(null);
    setRevoking(id);
    try {
      await revokeTrustedDevice(id);
      // Re-read rather than splice the row out: the server decides what is
      // still live, and a device whose trust lapsed while this page was open
      // should disappear on the same refresh.
      setDevices(await listTrustedDevices());
    } catch (err) {
      setDeviceError(err instanceof ApiError ? err.message : t('authGenericError'));
    } finally {
      setRevoking(null);
    }
  }

  async function handleLogout() {
    await logout();
    clearUser();
    router.push('/login');
  }

  return (
    <main style={{ maxWidth: '32rem', margin: '0 auto', padding: '2rem' }}>
      <h1>{t('secHeading')}</h1>

      <section style={{ marginTop: '2rem' }}>
        <h2>{t('secMfaHeading')}</h2>
        <p>
          Status: <strong>{user.mfaEnabled ? t('secEnabled') : t('secNotEnrolled')}</strong>
        </p>
        {!user.mfaPolicySatisfied && user.mfaEnabled ? (
          <p style={{ fontSize: '0.85rem', opacity: 0.8 }}>
            {t('secHardwareKeyPending')}
          </p>
        ) : null}

        {message ? <p style={successStyle}>{message}</p> : null}

        {user.mfaEnabled ? null : enrollment ? (
          <div>
            <p>{t('secScanInstruction')}</p>
            <Image src={enrollment.qrCodeDataUrl} alt={t('secQrAlt')} width={200} height={200} unoptimized />
            <form onSubmit={(e) => void handleVerify(e)}>
              <label htmlFor="code" style={labelStyle}>
                {t('secAuthCodeLabel')}
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
                {isBusy ? t('secVerifyingButton') : t('secVerifyButton')}
              </button>
            </form>
          </div>
        ) : (
          <button type="button" onClick={() => void handleStartEnrollment()} disabled={isBusy} style={buttonStyle}>
            {isBusy ? t('secStartingButton') : t('secEnrollButton')}
          </button>
        )}
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2>{t('secPasswordHeading')}</h2>
        <p>{t('secPasswordIntro')}</p>
        <form onSubmit={(e) => void handleChangePassword(e)}>
          <label htmlFor="currentPassword" style={labelStyle}>
            {t('secCurrentPasswordLabel')}
          </label>
          <input
            id="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            style={inputStyle}
          />

          <label htmlFor="newPassword" style={labelStyle}>
            {t('authNewPasswordLabel')}
          </label>
          <input
            id="newPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            style={inputStyle}
          />

          <PasswordRequirements password={newPassword} />

          <label htmlFor="confirmPassword" style={labelStyle}>
            {t('authConfirmPasswordLabel')}
          </label>
          <input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            aria-invalid={confirmPassword.length > 0 && newPassword !== confirmPassword}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            style={inputStyle}
          />

          {pwError ? (
            <p role="alert" style={errorStyle}>
              {pwError}
            </p>
          ) : null}
          {pwMessage ? <p style={successStyle}>{pwMessage}</p> : null}

          <button
            type="submit"
            disabled={!canChangePassword}
            style={canChangePassword ? buttonStyle : buttonDisabledStyle}
          >
            {isChangingPassword
              ? t('secChangingPasswordButton')
              : t('secChangePasswordButton')}
          </button>
        </form>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2>{t('secDevicesHeading')}</h2>
        <p>{t('secDevicesIntro')}</p>
        {deviceError ? (
          <p role="alert" style={errorStyle}>
            {deviceError}
          </p>
        ) : null}
        {devices === null ? (
          <p>{t('commonLoading')}</p>
        ) : devices.length === 0 ? (
          <p>{t('secNoTrustedDevices')}</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 'var(--space-2)' }}>
            {devices.map((d) => (
              <li
                key={d.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 'var(--space-3)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-2) var(--space-3)',
                }}
              >
                <span style={{ display: 'grid', minWidth: 0 }}>
                  <strong>{d.label ?? t('secUnnamedDevice')}</strong>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-secondary)' }}>
                    {t('secDeviceTrustedOn')} {formatDateTime(d.trustedAt, language)}
                    {' · '}
                    {t('secDeviceExpires')} {formatDateTime(d.expiresAt, language)}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => void handleRevokeDevice(d.id)}
                  disabled={revoking === d.id}
                  /* Named per device, so a screen-reader user hears WHICH
                     device a button drops rather than five identical
                     "Revoke"s. */
                  aria-label={t('secRevokeDeviceAria', {
                    device: d.label ?? t('secUnnamedDevice'),
                  })}
                  style={revoking === d.id ? buttonDisabledStyle : buttonStyle}
                >
                  {revoking === d.id ? t('secRevokingDevice') : t('secRevokeDevice')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2>{t('secSession')}</h2>
        <p>{tPlural('secIdleTimeoutMinutes', user.idleTimeoutMinutes)}</p>
        <p>
          {tPlural('secHardLogoutMinutes', user.hardLogoutAfterIdleMinutes)}
        </p>
        {user.accessValidUntil ? <p>Your access to IBMS ends: {formatDateTime(user.accessValidUntil, language)}</p> : null}
      </section>

      <button type="button" onClick={() => void handleLogout()} style={{ ...buttonStyle, marginTop: '2rem' }}>
        {t('signOut')}
      </button>
    </main>
  );
}
