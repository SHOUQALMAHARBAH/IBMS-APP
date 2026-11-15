'use client';

import { useState, type FormEvent } from 'react';
import { useLanguage } from '../../../lib/i18n/language-context';
import Link from 'next/link';
import { redirect, useRouter } from 'next/navigation';
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

/**
 * ROW 66 — THE ROUTE IS CLOSED AND THE CODE STAYS. Owner decision, 2026-11-07.
 *
 * `/login`'s own comment already records that the sign-up LINK was removed in module 0-ب and that
 * "THE ROUTE AND PAGE STAY" — measured, because `POST /auth/signup` had 120 references across the
 * api e2e suite. That reasoning was about the SERVER route and it still holds. What it left open is
 * the PAGE: anybody typing `/signup` by hand reached this form and created an account with **no
 * role at all** — it could authenticate and reach nothing, and `MfaRequiredGuard` refused every
 * route until TOTP was paired. A live door onto a dead end.
 *
 * The owner's decision, knowingly taken: **the page and its code stay in the repository, and the
 * route refuses.** Her reason is that she may want self-registration one day and does not want it
 * rebuilt from nothing.
 *
 * ## RE-ENABLING IS ONE LINE, AND THAT IS THE POINT
 *
 * Delete `SIGNUP_ROUTE_CLOSED` and the `redirect` below. Nothing else was removed: the form, its
 * fields, its validation, its submit and `signup()` in `lib/auth/auth-api.ts` are all intact and
 * are retained DELIBERATELY rather than left behind.
 *
 * ## WHY A REDIRECT RATHER THAN A NOTICE OR A 404
 *
 * Measured 2026-11-07: no shipping Arabic says "self-registration is closed", and this repository
 * has no `not-found.tsx`, so `notFound()` would render Next's own untranslated
 * "This page could not be found" — bare English as the first thing a reader sees, on an
 * Arabic-first product. A redirect to `/login` needs **no new string in either language**, is
 * fully localised because `/login` already is, and lands the reader exactly where the removed link
 * used to point them.
 *
 * ## ✅ AND THE SERVER DOOR IS CLOSED TOO NOW — OWNER DECISION 140, 2026-11-15
 *
 * This section used to read *"`POST /auth/signup` is `@Public()` and remains reachable by a direct
 * request … closing it is a separate decision with a large blast radius, not a line in this
 * batch."* That was true when written and is **false now**: the separate decision was taken.
 *
 * The route is still `@Public()` — it must be, because 117 api e2e spec files create their users
 * through it and decision 140's third criterion forbids deleting any of them — but
 * `AuthService.signup()` refuses before it does anything, through `selfSignupOpen()`. Production
 * is a HARD override there: no environment variable reopens it.
 *
 * ⟶ **So this page's redirect is no longer the only thing standing between the internet and an
 *   account.** It remains for the reason it was built: a browser typing `/signup` lands somewhere
 *   localised instead of on a form that would now 403.
 *
 * ## AND THE REDIRECT IS STILL RIGHT, FOR THE REASON RECORDED ABOVE
 *
 * Decision 140 §4 repeats the standing rule — if closing the door needs a sentence on the screen,
 * it is sliced from shipping text or it is the owner's. **Measured again 2026-11-15: no shipping
 * Arabic says «self-registration is closed».** A redirect needs no sentence at all, so it remains
 * the only shape that closes the page without inventing a word. That is reported as an empty cell
 * rather than filled.
 */
const SIGNUP_ROUTE_CLOSED = true;

export default function SignupPage() {
  if (SIGNUP_ROUTE_CLOSED) redirect('/login');

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
