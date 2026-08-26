'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { login, verifyMfaChallenge } from '../../../lib/auth/auth-api';
import { ApiError } from '../../../lib/auth/api-client';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  buttonStyle,
  cardStyle,
  errorStyle,
  helperLinkStyle,
  inputStyle,
  labelStyle,
  pageStyle,
} from '../../../components/auth/auth-form.styles';

export default function LoginPage() {
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
      setError(err instanceof ApiError ? err.message : 'Something went wrong — try again.');
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
      setError(err instanceof ApiError ? err.message : 'Invalid code — try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main style={pageStyle}>
      <div style={cardStyle}>
        <h1 style={{ marginTop: 0 }}>Sign in</h1>

        {mfaChallengeToken ? (
          <form onSubmit={(e) => void handleMfaSubmit(e)}>
            <p style={{ opacity: 0.8 }}>Enter the 6-digit code from your authenticator app.</p>
            <label htmlFor="code" style={labelStyle}>
              Authentication code
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
              {isSubmitting ? 'Verifying…' : 'Verify'}
            </button>
          </form>
        ) : (
          <form onSubmit={(e) => void handleCredentialsSubmit(e)}>
            <label htmlFor="email" style={labelStyle}>
              Email
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
              Password
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
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </button>
            <p style={helperLinkStyle}>
              <Link href="/forgot-password">Forgot your password?</Link>
            </p>
            <p style={helperLinkStyle}>
              No account? <Link href="/signup">Sign up</Link>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
