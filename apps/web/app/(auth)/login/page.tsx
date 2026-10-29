'use client';

import { useState, type FormEvent } from 'react';
import { useLanguage } from '../../../lib/i18n/language-context';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { isMustChangePassword, login, verifyMfaChallenge } from '../../../lib/auth/auth-api';
import { ApiError } from '../../../lib/auth/api-client';
import { useAuth } from '../../../lib/auth/auth-context';
import { AuthFrame, BrandPitch, Button, IconField } from '../../../components/ui';
import {
  authFormStyle,
  authHeadingStyle,
  authPromptStyle,
  errorStyle,
  helperLinkStyle,
} from '../../../components/auth/auth-form.styles';

/*
 * THE SIGN-IN SCREEN — the first thing a client sees, and the first screen of the design batch.
 *
 * NOTHING ABOUT WHAT IT DOES CHANGED. The credentials submit, the MFA-challenge branch, the
 * forced-password-change redirect and the deliberate absence of a sign-up link are all byte-for-
 * byte the same decisions, including the one that matters most: only the VERIFY call can mean
 * "bad code", so a failure after it is never reported as one. This is a presentation change, and
 * `auth.spec.ts` is what holds that claim.
 *
 * WHAT CHANGED IS THE FRAME AND THE FIELDS: a brand panel whose mark draws itself in on load, and
 * fields whose icon sits inside the control. `AuthFrame` carries the reasoning.
 *
 * THE PANEL'S PROSE ARRIVED AFTER THE PILOT and is the owner's own brand pack rather than words
 * written here — see `BrandPitch`. The pilot shipped this panel deliberately wordless and said so;
 * that was correct then and is no longer the state.
 */
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
      } else if (isMustChangePassword(res)) {
        // Part II §4.3.1 — a provisioned account owes its first password
        // change and gets an onboarding token INSTEAD of a session. Without
        // this branch the else below ran, pushing to / with no token, and the
        // app bounced straight back here showing nothing: every
        // admin-created employee was locked out of their own first login.
        router.push(
          `/change-password?token=${encodeURIComponent(res.onboardingToken)}`,
        );
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
    // Only the VERIFY call can mean "bad code". Everything after it runs on an
    // already-accepted code, so a failure there must not be reported as one —
    // that is how a correct code ends up showing "Invalid code — try again".
    try {
      await verifyMfaChallenge({ mfaChallengeToken, code });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('authInvalidCode'));
      setIsSubmitting(false);
      return;
    }
    await refreshUser();
    setIsSubmitting(false);
    router.push('/');
  }

  return (
    <AuthFrame pitch={<BrandPitch />}>
      <h1 style={authHeadingStyle}>{t('authSignInHeading')}</h1>

      {mfaChallengeToken ? (
        <form
          onSubmit={(e) => void handleMfaSubmit(e)}
          style={authFormStyle}
        >
          {/* `--ink-secondary`, not `opacity: 0.8` — globals.css forbids muting text with opacity,
              because it composites toward whatever is behind and axe measures the blend. */}
          <p style={authPromptStyle}>{t('authMfaPrompt')}</p>
          <IconField
            id="code"
            label={t('authMfaCodeLabel')}
            icon="clock"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            dir="ltr"
            autoFocus
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          {error ? (
            <p role="alert" style={errorStyle}>
              {error}
            </p>
          ) : null}
          <Button type="submit" variant="primary" loading={isSubmitting} fullWidth>
            {isSubmitting ? t('authVerifying') : t('authVerifyButton')}
          </Button>
        </form>
      ) : (
        <form
          onSubmit={(e) => void handleCredentialsSubmit(e)}
          style={authFormStyle}
        >
          <IconField
            id="email"
            label={t('authEmailLabel')}
            icon="mail"
            type="email"
            autoComplete="username"
            dir="ltr"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <IconField
            id="password"
            label={t('authPasswordLabel')}
            icon="lock"
            type="password"
            autoComplete="current-password"
            dir="ltr"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error ? (
            <p role="alert" style={errorStyle}>
              {error}
            </p>
          ) : null}
          <Button type="submit" variant="primary" loading={isSubmitting} fullWidth>
            {isSubmitting ? t('authSigningIn') : t('authSignInButton')}
          </Button>
          <p style={helperLinkStyle}>
            <Link href="/forgot-password">{t('authForgotLink')}</Link>
          </p>
          {/*
            * THE SIGN-UP LINK IS REMOVED, MODULE 0-ب ITEM 5, and it promised a path this product
            * does not use.
            *
            * Offices are onboarded by the platform provider at `POST /provider/brokerage-offices`;
            * the first user inside one arrives by invitation. Measured before removing: signup is
            * NOT the bootstrap — a migration creates the default organization and the seed creates
            * the provider, its role and the sample accounts, which `scripts/from-empty.sh` proves
            * reaches a usable system from nothing. And signup assigns NO ROLE, so every account it
            * ever made could authenticate and reach nothing: zero permissions, and `MfaRequiredGuard`
            * refusing every route until TOTP is paired.
            *
            * THE ROUTE AND PAGE STAY, deliberately and measured: `POST /auth/signup` has 120
            * references across the api e2e suite, which creates its users through it. Removing the
            * route would take the suite down to fix a link. What is removed is the PROMISE on the
            * one screen every reader starts at; `/signup` remains reachable by URL with its own
            * four tests, and its refusal text — corrected this module — now names the provider
            * routes rather than claiming no office can be onboarded at all.
            */}
        </form>
      )}
    </AuthFrame>
  );
}
