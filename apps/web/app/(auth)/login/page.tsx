'use client';

import { useState, type FormEvent } from 'react';
import { useLanguage } from '../../../lib/i18n/language-context';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { login, verifyMfaChallenge } from '../../../lib/auth/auth-api';
import { ApiError } from '../../../lib/auth/api-client';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  buttonStyle,
  authCardStyle,
  errorStyle,
  helperLinkStyle,
  inputStyle,
  labelStyle,
  authPageStyle,
} from '../../../components/auth/auth-form.styles';

export default function LoginPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const { refreshUser } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [mfaChallengeToken, setMfaChallengeToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleCredentialsSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await login({ email, password });
      if ('mfaRequired' in res) {
        setMfaChallengeToken(res.mfaChallengeToken);
      } else {
        await refreshUser();
        router.push('/');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('authGenericError'));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleMfaSubmit(e: FormEvent) {
    e.preventDefault();
    if (!mfaChallengeToken) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await verifyMfaChallenge({ mfaChallengeToken, code });
      await refreshUser();
      router.push('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('authInvalidCode'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main style={authPageStyle}>
      <div style={authCardStyle}>
        <h1 style={{ marginTop: 0 }}>{t('authSignInHeading')}</h1>

        {mfaChallengeToken ? (
          <form onSubmit={(e) => void handleMfaSubmit(e)}>
            <p style={{ opacity: 0.8 }}>{t('authMfaPrompt')}</p>
            <label htmlFor="code" style={labelStyle}>
              {t('authMfaCodeLabel')}
            </label>
            <input
              id="code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoFocus
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
            <button type="submit" disabled={isSubmitting} style={buttonStyle}>
              {isSubmitting ? t('authVerifying') : t('authVerifyButton')}
            </button>
          </form>
        ) : (
          <form onSubmit={(e) => void handleCredentialsSubmit(e)}>
            <label htmlFor="email" style={labelStyle}>
              {t('authEmailLabel')}
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputStyle}
            />
            <label htmlFor="password" style={labelStyle}>
              {t('authPasswordLabel')}
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle}
            />
            {error ? (
              <p role="alert" style={errorStyle}>
                {error}
              </p>
            ) : null}
            <button type="submit" disabled={isSubmitting} style={buttonStyle}>
              {isSubmitting ? t('authSigningIn') : t('authSignInButton')}
            </button>
            <p style={helperLinkStyle}>
              <Link href="/forgot-password">{t('authForgotLink')}</Link>
            </p>
            <p style={helperLinkStyle}>
              {t('authNoAccount')} <Link href="/signup">{t('authSignUpLink')}</Link>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
