'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { forgotPassword } from '../../../lib/auth/auth-api';
import { ApiError } from '../../../lib/auth/api-client';
import {
  buttonStyle,
  cardStyle,
  errorStyle,
  helperLinkStyle,
  inputStyle,
  labelStyle,
  pageStyle,
  successStyle,
} from '../../../components/auth/auth-form.styles';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Dev-only convenience: no email/notification provider exists yet (see
  // A.1 plan) — the API returns the raw reset token outside production so
  // this flow can be exercised end-to-end without a real mailbox.
  const [devResetLink, setDevResetLink] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await forgotPassword(email);
      setMessage(res.message);
      setDevResetLink(res.devResetToken ? `/reset-password?token=${encodeURIComponent(res.devResetToken)}` : null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main style={pageStyle}>
      <div style={cardStyle}>
        <h1 style={{ marginTop: 0 }}>Forgot password</h1>
        {message ? (
          <>
            <p style={successStyle}>{message}</p>
            {devResetLink ? (
              <p style={{ fontSize: '0.85rem' }}>
                Dev mode — no email provider configured yet:{' '}
                <Link href={devResetLink}>continue to reset password</Link>
              </p>
            ) : null}
          </>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)}>
            <label htmlFor="email" style={labelStyle}>
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputStyle}
            />
            {error ? (
              <p role="alert" style={errorStyle}>
                {error}
              </p>
            ) : null}
            <button type="submit" disabled={isSubmitting} style={buttonStyle}>
              {isSubmitting ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}
        <p style={helperLinkStyle}>
          <Link href="/login">Back to sign in</Link>
        </p>
      </div>
    </main>
  );
}
