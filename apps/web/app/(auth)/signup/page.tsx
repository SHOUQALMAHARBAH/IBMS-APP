'use client';

import { useState, type FormEvent } from 'react';
import { useLanguage } from '../../../lib/i18n/language-context';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signup } from '../../../lib/auth/auth-api';
import { ApiError } from '../../../lib/auth/api-client';
import {
  buttonStyle,
  errorStyle,
  helperLinkStyle,
  inputStyle,
  labelStyle,
} from '../../../components/auth/auth-form.styles';
import { AuthFrame } from '../../../components/ui';

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
    <AuthFrame>
      {/*
        The same frame `/login` wears. The pilot gave it only to the sign-in screen, and `/login`
        LINKS here — so a person clicking «نسيت كلمة المرور؟» left the designed screen and landed
        on the old bare card, which is this product's first impression going wrong one click in.
        `pitch` is deliberately OMITTED: `AuthFrame`'s own comment already records why — a reader
        who is already resetting a password is not being sold to, so the panel here is the mark
        alone. No new words, and the frame renders its own `<main>`.
      */}
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
    </AuthFrame>
  );
}
