'use client';

/*
 * The office's own corporate mailbox — the six `/admin/email-integration` routes, which had no web
 * caller, so `email.integration.read` and `email.integration.manage` were both granted and neither
 * could be exercised.
 *
 * ## Four states, per the frontend directive § 2
 *
 * LOADING, EMPTY (no mailbox connected — and the empty state offers the one action that fills it),
 * ERROR, POPULATED. The empty state is the important one here: an office that has connected nothing
 * is the normal starting state, not a fault, and it must say what belongs there.
 *
 * ## The deployment gap is NOT shown as implementation detail — directive § 2
 *
 * With no OAuth application configured, the API refuses with a 422 naming the exact environment
 * variables. That message is correct and it is internal detail, which the directive reserves for
 * the System/Security Administrator. So the reader gets the fact in their own terms — this office
 * cannot connect a mailbox on this deployment, and it is not something they can fix — and the
 * variable names are shown only to the role that would act on them.
 *
 * The service's own comment agrees about the substance: "a deployment-side gap, so it is stated as
 * one. The administrator cannot fix this from the UI and should not be told to try."
 *
 * ## `state` is compared here, because nothing else can
 *
 * `authorize-url` returns a `state` and the API never sees the redirect, so the comparison is the
 * screen's job — "an authorization code accepted without checking it can be replayed from another
 * site". The administrator pastes the whole redirect address and the screen extracts both halves,
 * rather than offering two fields one of which can be left blank.
 *
 * ## Read and write are different grants, and the read-only view is a real state
 *
 * `email.integration.read` is held by four roles, `.manage` by two — measured. So a Manager or an
 * Executive sees whether the mailbox works and is offered no control, which is directive § 1: the
 * control does not exist on their screen rather than existing and refusing.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, isMfaEnrolmentError } from '../../../../lib/auth/api-client';
import { hasPermission } from '../../../../lib/auth/permissions';
import { useAuth } from '../../../../lib/auth/auth-context';
import { useLanguage } from '../../../../lib/i18n/language-context';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle, sectionStyle } from '../../../../components/lead/lead.styles';
import {
  connectEmailIntegration,
  emailAuthorizeUrl,
  getEmailIntegration,
  parseOAuthRedirect,
  revokeEmailIntegration,
  sendEmailIntegrationTest,
  verifyEmailIntegration,
  type EmailIntegrationStatus,
  type EmailProviderKind,
  type EmailSendResult,
} from '../../../../lib/email/email-integration-api';
import type { TranslationKey } from '../../../../lib/i18n/translations';
import { permissionRefusal } from '../../../../lib/i18n/permission-refusal';

/**
 * TOTAL maps, not concatenated keys — § 1.45. A missing label would otherwise render its own key on
 * screen, and `satisfies` makes a new provider or outcome a build error until both languages name it.
 */
const PROVIDER_LABEL = {
  MICROSOFT365: 'emailProviderMicrosoft',
  GOOGLE_WORKSPACE: 'emailProviderGoogle',
} satisfies Record<EmailProviderKind, TranslationKey>;

const OUTCOME_LABEL = {
  SENT: 'emailTestSent',
  NOT_CONFIGURED: 'emailTestNotConfigured',
  CREDENTIAL_REJECTED: 'emailTestCredentialRejected',
  SEND_FAILED: 'emailTestSendFailed',
} satisfies Record<EmailSendResult['outcome'], TranslationKey>;

const PROVIDERS: EmailProviderKind[] = ['MICROSOFT365', 'GOOGLE_WORKSPACE'];

/** The deployment-gap refusal, which names environment variables. */
function isDeploymentGap(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 422 &&
    error.message.includes('No OAuth application is configured')
  );
}

export default function EmailIntegrationPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const canRead = !!user && hasPermission(user, 'email.integration.read');
  const canManage = !!user && hasPermission(user, 'email.integration.manage');
  // The one role the directive allows implementation detail to reach.
  const seesInternalDetail =
    !!user && user.roles.includes('SYSTEM_SECURITY_ADMINISTRATOR');

  const [status, setStatus] = useState<EmailIntegrationStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [gapDetail, setGapDetail] = useState<string | null>(null);

  const [provider, setProvider] = useState<EmailProviderKind>('MICROSOFT365');
  const [expectedState, setExpectedState] = useState<string | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [pastedRedirect, setPastedRedirect] = useState('');
  const [connectedEmail, setConnectedEmail] = useState('');
  const [tenantId, setTenantId] = useState('');

  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await getEmailIntegration());
      setLoadError(null);
    } catch (error) {
      if (error instanceof ApiError && isMfaEnrolmentError(error)) {
        router.push('/settings/security');
        return;
      }
      setLoadError(
        error instanceof ApiError ? error.message : t('emailLoadFailed'),
      );
    }
  }, [router, t]);

  useEffect(() => {
    if (!canRead) return;
    let live = true;
    void (async () => {
      if (live) await load();
    })();
    return () => {
      live = false;
    };
  }, [canRead, load]);

  function reportError(error: unknown, fallback: TranslationKey) {
    if (isDeploymentGap(error)) {
      // Job language for everybody; the variable names only where they can be acted on.
      setActionError(t('emailNotConfiguredOnDeployment'));
      setGapDetail(
        seesInternalDetail && error instanceof ApiError ? error.message : null,
      );
      return;
    }
    setGapDetail(null);
    setActionError(
      error instanceof ApiError ? error.message : t(fallback),
    );
  }

  async function beginConnect() {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const { url, state } = await emailAuthorizeUrl(provider);
      setAuthUrl(url);
      setExpectedState(state);
    } catch (error) {
      reportError(error, 'emailAuthorizeFailed');
    } finally {
      setBusy(false);
    }
  }

  async function finishConnect() {
    const { code, state } = parseOAuthRedirect(pastedRedirect);
    if (code === null) {
      setActionError(t('emailRedirectNoCode'));
      return;
    }
    // THE COMPARISON. Refusing here is the whole reason `authorize-url` returns a state: an
    // authorization code accepted without it can be replayed from another site.
    if (state === null || state !== expectedState) {
      setActionError(t('emailRedirectStateMismatch'));
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const next = await connectEmailIntegration({
        provider,
        authorizationCode: code,
        connectedEmail: connectedEmail.trim(),
        // Absent, never '' — an empty tenant id is a different claim from "this provider has none".
        providerTenantId: tenantId.trim() || undefined,
      });
      setStatus(next);
      setAuthUrl(null);
      setExpectedState(null);
      setPastedRedirect('');
      setTenantId('');
      setNotice(
        t('emailConnectedNotice', { address: next.connectedEmail ?? '' }),
      );
    } catch (error) {
      reportError(error, 'emailConnectFailed');
    } finally {
      setBusy(false);
    }
  }

  async function runVerify() {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const health = await verifyEmailIntegration();
      // The provider's own sentence is the useful part — it says WHY a credential is refused.
      setNotice(
        health.operational
          ? t('emailVerifyOk', {
              address: health.fromAddress ?? '',
              detail: health.detail,
            })
          : t('emailVerifyNotOperational', { detail: health.detail }),
      );
      await load();
    } catch (error) {
      reportError(error, 'emailVerifyFailed');
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const result = await sendEmailIntegrationTest();
      // Specific about what happened, per directive § 2 — including WHERE it was sent, because a
      // test that mails the office's own mailbox is the whole point and a reader needs to know
      // which inbox to open.
      setNotice(
        t(OUTCOME_LABEL[result.outcome], {
          address: result.fromAddress ?? status?.connectedEmail ?? '',
          detail: result.detail ?? '',
        }),
      );
      await load();
    } catch (error) {
      reportError(error, 'emailTestFailed');
    } finally {
      setBusy(false);
    }
  }

  async function runRevoke() {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const next = await revokeEmailIntegration();
      setStatus(next);
      setNotice(t('emailRevokedNotice'));
    } catch (error) {
      reportError(error, 'emailRevokeFailed');
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) return <main style={pageStyle}>{t('emailLoading')}</main>;

  if (!canRead) {
    return (
      <main style={pageStyle}>
        <h1>{t('emailHeading')}</h1>
        <p role="alert" style={errorStyle}>
          {permissionRefusal(t, 'emailRefusalAct', 'email.integration.read')}
        </p>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <h1>{t('emailHeading')}</h1>
      <p style={{ color: 'var(--ink-secondary)', maxWidth: '50rem' }}>
        {t('emailIntro')}
      </p>

      {/* ERROR state — the load failed, so there is nothing to report about the mailbox. */}
      {loadError !== null && (
        <p role="alert" style={errorStyle} data-testid="email-load-error">
          {loadError}
        </p>
      )}

      {/* LOADING state. */}
      {status === null && loadError === null && (
        <p data-testid="email-loading">{t('emailLoading')}</p>
      )}

      {status !== null && (
        <section style={sectionStyle} data-testid="email-status">
          <h2>{t('emailStatusHeading')}</h2>

          {status.connected ? (
            /* POPULATED. */
            <div data-testid="email-connected">
              <p>
                {t('emailConnectedTo', { address: status.connectedEmail ?? '' })}
              </p>
              <p>
                {t('emailProviderLabel')}{' '}
                {status.provider ? t(PROVIDER_LABEL[status.provider]) : '—'}
              </p>
              <p>
                {t('emailLastSucceeded')}{' '}
                {status.lastSucceededAt?.slice(0, 10) ?? t('emailNeverSent')}
              </p>
              {/* The provider's own complaint, already sanitised server-side. Shown because it is
                  the only thing that says WHY sending stopped working. */}
              {status.lastError !== null && (
                <p style={errorStyle} data-testid="email-last-error">
                  {t('emailLastError', { detail: status.lastError })}
                </p>
              )}
            </div>
          ) : (
            /* EMPTY — the normal starting state, not a fault, and it names the one action that
               fills it. Per directive § 2 an empty state explains what belongs there. */
            <p data-testid="email-empty">
              {canManage ? t('emailEmptyWithAction') : t('emailEmptyReadOnly')}
            </p>
          )}
        </section>
      )}

      {notice !== null && (
        <p role="status" style={sectionStyle} data-testid="email-notice">
          {notice}
        </p>
      )}

      {actionError !== null && (
        <section style={sectionStyle}>
          <p role="alert" style={errorStyle} data-testid="email-action-error">
            {actionError}
          </p>
          {/* Implementation detail for the one role the directive allows it to reach. */}
          {gapDetail !== null && (
            <p
              style={{ fontSize: '0.8rem', color: 'var(--ink-secondary)' }}
              data-testid="email-gap-detail"
            >
              {gapDetail}
            </p>
          )}
        </section>
      )}

      {canManage && status !== null && (
        <section style={sectionStyle} data-testid="email-controls">
          <h2>
            {status.connected
              ? t('emailManageHeading')
              : t('emailConnectHeading')}
          </h2>

          {status.connected ? (
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => void runVerify()}
                disabled={busy}
                data-testid="email-verify"
              >
                {t('emailVerifyButton')}
              </button>
              <button
                type="button"
                onClick={() => void runTest()}
                disabled={busy}
                data-testid="email-test"
              >
                {t('emailTestButton')}
              </button>
              <button
                type="button"
                onClick={() => void runRevoke()}
                disabled={busy}
                data-testid="email-revoke"
              >
                {t('emailRevokeButton')}
              </button>
            </div>
          ) : authUrl === null ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void beginConnect();
              }}
              data-testid="email-begin-form"
            >
              <label>
                {t('emailProviderLabel')}
                <select
                  value={provider}
                  onChange={(e) =>
                    setProvider(e.target.value as EmailProviderKind)
                  }
                  data-testid="email-provider"
                >
                  {PROVIDERS.map((kind) => (
                    <option key={kind} value={kind}>
                      {t(PROVIDER_LABEL[kind])}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" disabled={busy} data-testid="email-begin">
                {t('emailBeginButton')}
              </button>
            </form>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void finishConnect();
              }}
              data-testid="email-finish-form"
            >
              <p>{t('emailStep1')}</p>
              {/* `rel="noreferrer"` matters here: the address carries the `state`, and a referrer
                  header would leak it to whatever the provider links onward to. */}
              <p>
                <a
                  href={authUrl}
                  target="_blank"
                  rel="noreferrer"
                  data-testid="email-auth-link"
                >
                  {t('emailOpenProvider')}
                </a>
              </p>
              <p>{t('emailStep2')}</p>

              <label>
                {t('emailRedirectLabel')}
                <input
                  value={pastedRedirect}
                  onChange={(e) => setPastedRedirect(e.target.value)}
                  required
                  data-testid="email-redirect"
                />
              </label>

              <label>
                {t('emailMailboxLabel')}
                <input
                  type="email"
                  value={connectedEmail}
                  onChange={(e) => setConnectedEmail(e.target.value)}
                  required
                  data-testid="email-mailbox"
                />
              </label>

              {provider === 'MICROSOFT365' && (
                <label>
                  {t('emailTenantLabel')}
                  <input
                    value={tenantId}
                    onChange={(e) => setTenantId(e.target.value)}
                    data-testid="email-tenant"
                  />
                </label>
              )}

              <div style={{ marginTop: '0.5rem' }}>
                <button
                  type="submit"
                  disabled={busy || connectedEmail.trim() === ''}
                  data-testid="email-connect"
                >
                  {t('emailConnectButton')}
                </button>{' '}
                <button
                  type="button"
                  onClick={() => {
                    setAuthUrl(null);
                    setExpectedState(null);
                    setPastedRedirect('');
                    setActionError(null);
                  }}
                >
                  {t('emailCancelButton')}
                </button>
              </div>
            </form>
          )}
        </section>
      )}
    </main>
  );
}
