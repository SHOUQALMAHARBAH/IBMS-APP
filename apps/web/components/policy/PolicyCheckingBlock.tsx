'use client';

import { useState } from 'react';
import { checkPolicy, type Policy } from '../../lib/policy/policy-api';
import { ApiError } from '../../lib/auth/api-client';
import { buttonStyle, errorStyle } from '../auth/auth-form.styles';
import { quoteFieldStyle } from '../quotation/quotation.styles';
import { useLanguage } from '../../lib/i18n/language-context';

/*
 * Process 20 — the independent policy check, extracted so the officer who
 * performs it can reach it.
 *
 * It used to live inside `PolicySection`, which renders only on
 * `/opportunities/[id]`. That route needs `opportunity.read`, and a Policy
 * Checking Officer does not hold it — their three permissions are
 * `policy.read`, `policy.check` and `dashboard.policy.view`. So the one role
 * whose entire purpose is this form had no screen that offered it, while the
 * API endpoint behind it accepted them perfectly well.
 *
 * Nothing here ever needed the Opportunity: the block reads `policy.status`
 * and `policy.checking` and posts to `checkPolicy(policy.id, …)`. Extracting
 * it changes nothing on the opportunity screen — `rfq.spec.ts`'s existing QC
 * test passes unmodified, which is what proves that.
 *
 * It owns its own busy/error state rather than borrowing the parent's `run()`
 * helper, because `/policies/[id]` has no such helper and a shared one would
 * have re-coupled it to `PolicySection`.
 */

/** The statuses a check may be recorded against. A policy that has not been
 *  issued has nothing to verify, and one already DELIVERED is past this gate. */
const CHECKABLE_STATES = new Set(['ISSUED', 'DISCREPANCY', 'CHECKING_IN_PROGRESS']);

function parseJsonObject(text: string): Record<string, unknown> | null {
  if (text.trim().length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function splitList(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function PolicyCheckingBlock({
  policy,
  canCheck,
  onChecked,
}: {
  policy: Pick<Policy, 'id' | 'status' | 'checking'>;
  canCheck: boolean;
  /** Reload the caller's own view — the check moves the policy's status. */
  onChecked: () => void | Promise<void>;
}) {
  const { t } = useLanguage();
  const [chkLimitsText, setChkLimitsText] = useState('{\n  "buildings": "5000000.000"\n}');
  const [chkSumsText, setChkSumsText] = useState('{\n  "total": "5000000.000"\n}');
  const [chkPerilsText, setChkPerilsText] = useState('fire, flood, theft');
  const [chkExtensionsText, setChkExtensionsText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canCheck || !CHECKABLE_STATES.has(policy.status)) return null;

  return (
    <div style={{ marginTop: '0.8rem', maxWidth: '36rem' }}>
      <strong>{policy.checking ? t('policyQcRerunHeading') : t('policyQcHeading')}</strong>
      <p style={{ opacity: 0.7, fontSize: '0.85rem', margin: '0.2rem 0' }}>
        {t('policyRequestedCoverageNote')}
      </p>
      <div style={quoteFieldStyle}>
        <label htmlFor="chk-limits">{t('policyRequestedLimitsLabel')}</label>
        <textarea
          id="chk-limits"
          rows={3}
          value={chkLimitsText}
          onChange={(e) => setChkLimitsText(e.target.value)}
        />
      </div>
      <div style={quoteFieldStyle}>
        <label htmlFor="chk-sums">{t('policyRequestedSumsLabel')}</label>
        <textarea
          id="chk-sums"
          rows={3}
          value={chkSumsText}
          onChange={(e) => setChkSumsText(e.target.value)}
        />
      </div>
      <div style={quoteFieldStyle}>
        <label htmlFor="chk-perils">{t('policyRequestedPerilsLabel')}</label>
        <input
          id="chk-perils"
          value={chkPerilsText}
          onChange={(e) => setChkPerilsText(e.target.value)}
        />
      </div>
      <div style={quoteFieldStyle}>
        <label htmlFor="chk-extensions">{t('policyRequestedExtensionsLabel')}</label>
        <input
          id="chk-extensions"
          value={chkExtensionsText}
          onChange={(e) => setChkExtensionsText(e.target.value)}
        />
      </div>
      {error ? (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={
          busy ||
          parseJsonObject(chkLimitsText) === null ||
          parseJsonObject(chkSumsText) === null
        }
        style={{ ...buttonStyle, width: 'auto', marginTop: '0.4rem' }}
        onClick={() => {
          setBusy(true);
          setError(null);
          checkPolicy(policy.id, {
            limits: parseJsonObject(chkLimitsText) ?? {},
            sumsInsured: parseJsonObject(chkSumsText) ?? {},
            namedPerils: splitList(chkPerilsText),
            extensions: splitList(chkExtensionsText),
          })
            .then(() => Promise.resolve(onChecked()))
            .catch((err: unknown) => {
              setError(
                err instanceof ApiError ? err.message : t('policyCheckError'),
              );
            })
            .finally(() => setBusy(false));
        }}
      >
        {busy ? t('policyCheckingButton') : t('policyCheckButton')}
      </button>
    </div>
  );
}
