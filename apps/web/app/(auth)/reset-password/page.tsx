'use client';

import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { resetPassword } from '../../../lib/auth/auth-api';
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

function ResetPasswordForm() {
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
      setError(err instanceof ApiError ? err.message : 'Something went wrong — try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!token) {
    return (
      <p role="alert" style={errorStyle}>
        This reset link is missing its token — request a new one from{' '}
        <Link href="/forgot-password">Forgot password</Link>.
      </p>
    );
  }

  if (done) {
    return <p style={successStyle}>Password updated — redirecting to sign in…</p>;
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)}>
      <label htmlFor="newPassword" style={labelStyle}>
        New password
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
        At least 12 characters, with an uppercase letter, lowercase letter, digit, and symbol.
      </p>
      {error ? (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={isSubmitting} style={buttonStyle}>
        {isSubmitting ? 'Resetting…' : 'Reset password'}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main style={pageStyle}>
      <div style={cardStyle}>
        <h1 style={{ marginTop: 0 }}>Reset password</h1>
        <Suspense fallback={null}>
          <ResetPasswordForm />
        </Suspense>
        <p style={helperLinkStyle}>
          <Link href="/login">Back to sign in</Link>
        </p>
      </div>
    </main>
  );
}
