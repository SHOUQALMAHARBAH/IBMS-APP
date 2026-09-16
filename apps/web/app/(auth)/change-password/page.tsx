'use client';

import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLanguage } from '../../../lib/i18n/language-context';
import { forceChangePassword } from '../../../lib/auth/auth-api';
import { ApiError } from '../../../lib/auth/api-client';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  PasswordRequirements,
  meetsPasswordPolicy,
} from '../../../components/auth/PasswordRequirements';
import {
  authCardStyle,
  authPageStyle,
  buttonDisabledStyle,
  buttonStyle,
  errorStyle,
  helperLinkStyle,
  inputStyle,
  labelStyle,
} from '../../../components/auth/auth-form.styles';

/*
 * Part II §4.3.1 — the mandatory first password change.
 *
 * Every account created through `POST /admin/users` carries
 * `mustChangePassword: true`, so `POST /auth/login` answers it with
 * MUST_CHANGE_PASSWORD and an onboarding token INSTEAD of a session. This
 * screen is what consumes that token; before it existed the login page had no
 * branch for the outcome, pushed to `/` with no session, and was bounced
 * straight back to `/login` showing nothing at all — a provisioned employee
 * could not get in, and nothing said why.
 *
 * Pre-auth, so it lives beside login/forgot/reset in `(auth)` rather than
 * behind the app shell: there is no session here yet, and `AppNav` would have
 * no permissions to render from.
 *
 * The token travels in the query string rather than in state because this is a
 * real navigation: a `router.push` with state would not survive the reload a
 * user performs when a form looks stuck. It is single-use, scoped to this one
 * endpoint, and dies the moment `mustChangePassword` flips — see
 * `AuthService.forceChangePassword`.
 */
function ChangePasswordForm() {
  const { t } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refreshUser } = useAuth();
  const token = searchParams.get('token') ?? '';

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const canSubmit =
    meetsPasswordPolicy(newPassword) && newPassword === confirmPassword && !isSubmitting;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError(t('authPasswordMismatch'));
      return;
    }
    setIsSubmitting(true);
    try {
      await forceChangePassword({ onboardingToken: token, newPassword });
      // The endpoint issues a real session, so this lands in the app exactly
      // where a normal sign-in would. Same order the login page uses: resolve
      // /auth/me first, so the shell never renders a signed-out frame.
      await refreshUser();
      router.push('/');
    } catch (err) {
      // The server's own words, not a generic failure: this is where password
      // REUSE is reported (the last five hashes live only on the server, so
      // nothing on this page can know about them) and where any policy rule
      // the client-side list cannot express would surface.
      setError(err instanceof ApiError ? err.message : t('authGenericError'));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!token) {
    return (
      <p role="alert" style={errorStyle}>
        {t('authChangeMissingToken')}
      </p>
    );
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)}>
      <p>{t('authChangeIntro')}</p>

      <label htmlFor="newPassword" style={labelStyle}>
        {t('authNewPasswordLabel')}
      </label>
      <input
        id="newPassword"
        type="password"
        autoComplete="new-password"
        autoFocus
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
        aria-invalid={mismatch}
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        style={inputStyle}
      />
      {mismatch ? (
        <p role="alert" style={errorStyle}>
          {t('authPasswordMismatch')}
        </p>
      ) : null}

      {error ? (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      ) : null}

      <button type="submit" disabled={!canSubmit} style={canSubmit ? buttonStyle : buttonDisabledStyle}>
        {isSubmitting ? t('authChangingButton') : t('authChangeSubmit')}
      </button>
    </form>
  );
}

export default function ChangePasswordPage() {
  const { t } = useLanguage();
  return (
    <main style={authPageStyle}>
      <div style={authCardStyle}>
        <h1 style={{ marginTop: 0 }}>{t('authChangeHeading')}</h1>
        <Suspense fallback={null}>
          <ChangePasswordForm />
        </Suspense>
        <p style={helperLinkStyle}>
          <Link href="/login">{t('authBackToSignIn')}</Link>
        </p>
      </div>
    </main>
  );
}
