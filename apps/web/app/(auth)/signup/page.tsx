'use client';

import { useState, type FormEvent } from 'react';
import { useLanguage } from '../../../lib/i18n/language-context';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signup } from '../../../lib/auth/auth-api';
import { ApiError } from '../../../lib/auth/api-client';
import {
  buttonStyle,
  authCardStyle,
  errorStyle,
  helperLinkStyle,
  inputStyle,
  labelStyle,
  authPageStyle,
} from '../../../components/auth/auth-form.styles';

export default function SignupPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await signup({ fullName, email, password });
      router.push('/login');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('authGenericError'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main style={authPageStyle}>
      <div style={authCardStyle}>
        <h1 style={{ marginTop: 0 }}>{t('authCreateAccountHeading')}</h1>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <label htmlFor="fullName" style={labelStyle}>
            {t('authFullNameLabel')}
          </label>
          <input
            id="fullName"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            style={inputStyle}
          />
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
            autoComplete="new-password"
            required
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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
            {isSubmitting ? t('authCreatingAccount') : t('authSignUpButton')}
          </button>
          <p style={helperLinkStyle}>
            {t('authAlreadyHaveAccount')} <Link href="/login">{t('authSignInButton')}</Link>
          </p>
        </form>
      </div>
    </main>
  );
}
