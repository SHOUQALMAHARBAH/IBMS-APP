'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useLanguage } from '../../../lib/i18n/language-context';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { resetPassword } from '../../../lib/auth/auth-api';
import { ApiError } from '../../../lib/auth/api-client';
import {
  buttonStyle,
  authCardStyle,
  errorStyle,
  helperLinkStyle,
  inputStyle,
  labelStyle,
  authPageStyle,
  successStyle,
} from '../../../components/auth/auth-form.styles';

function ResetPasswordForm() {
  const { t } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await resetPassword({ token, newPassword });
      setDone(true);
      setTimeout(() => router.push('/login'), 1500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('authGenericError'));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!token) {
    return (
      <p role="alert" style={errorStyle}>
        {t('authResetMissingToken')}{' '}
        <Link href="/forgot-password">{t('authForgotHeading')}</Link>.
      </p>
    );
  }

  if (done) {
    return <p style={successStyle}>{t('authResetDone')}</p>;
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)}>
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
      <p style={{ fontSize: '0.8rem', opacity: 0.7 }}>
        {t('authPasswordRule')}
      </p>
      {error ? (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={isSubmitting} style={buttonStyle}>
        {isSubmitting ? t('authResetting') : t('authResetButton')}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  const { t } = useLanguage();
  return (
    <main style={authPageStyle}>
      <div style={authCardStyle}>
        <h1 style={{ marginTop: 0 }}>{t('authResetHeading')}</h1>
        <Suspense fallback={null}>
          <ResetPasswordForm />
        </Suspense>
        <p style={helperLinkStyle}>
          <Link href="/login">{t('authBackToSignIn')}</Link>
        </p>
      </div>
    </main>
  );
}
