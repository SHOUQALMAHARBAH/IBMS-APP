'use client';

import { useCallback, useEffect, useState } from 'react';
import { ENUM_LABEL } from '../../lib/i18n/enum-labels';
import {
  acknowledgePolicyReceipt,
  attachPolicyDocuments,
  checkPolicy,
  downloadPolicyCertificateDocument,
  downloadPolicyScheduleDocument,
  listPoliciesForOpportunity,
  placePolicy,
  recordPolicyDelivery,
  recordPolicyIssuance,
  DATA_CLASSIFICATION_OPTIONS,
  DELIVERY_METHOD_OPTIONS,
  DOCUMENT_CATEGORY_OPTIONS,
  type DataClassification,
  type DeliveryMethod,
  type DocumentCategory,
  type Policy,
  type PolicyDocumentInput,
} from '../../lib/policy/policy-api';
import type { OpportunityWithContext } from '../../lib/opportunity/opportunity-api';
import { ApiError } from '../../lib/auth/api-client';
import { buttonStyle, errorStyle } from '../auth/auth-form.styles';
import { rfqBadgeStyle } from '../rfq/rfq.styles';
import { quoteChainCardStyle, quoteFieldStyle } from '../quotation/quotation.styles';
import { useLanguage } from '../../lib/i18n/language-context';
import { formatDate, formatDateTime, formatMoney } from '../../lib/i18n/format';
import type { TranslationKey } from '../../lib/i18n/translations';

/** `DELIVERY_METHOD_OPTIONS` carries an English `label` alongside each value;
 *  the select rendered it directly. The value is the contract with the API, the
 *  label is copy — so the copy moves here and the option list keeps its shape. */
const DELIVERY_METHOD_LABEL_KEY: Record<DeliveryMethod, TranslationKey> = {
  email: 'policyDeliveryMethodEmail',
  portal: 'policyDeliveryMethodPortal',
  courier: 'policyDeliveryMethodCourier',
  in_person: 'policyDeliveryMethodInPerson',
};

interface Props {
  opportunity: OpportunityWithContext;
  isPlacement: boolean;
  canCheck: boolean;
  canDeliver: boolean;
  onOpportunityChanged: () => void;
}

const CHECKABLE_STATES = new Set([
  'ISSUED',
  'DISCREPANCY',
  'CHECKING_IN_PROGRESS',
]);

/** The section only makes sense once the client has accepted (the Opportunity
 * reaches PLACEMENT) — or a Policy already exists (a status that lagged the
 * routing shouldn't hide a real placed policy). */
const POLICY_ELIGIBLE_STATES = new Set(['PLACEMENT']);

function emptyDocRow(): PolicyDocumentInput {
  return { category: 'POLICY', classification: 'CONFIDENTIAL', fileName: '', storageRef: '' };
}

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

function DocumentRowsEditor({
  rows,
  setRows,
}: {
  rows: PolicyDocumentInput[];
  setRows: (rows: PolicyDocumentInput[]) => void;
}) {
  const { t } = useLanguage();
  function update(i: number, patch: Partial<PolicyDocumentInput>) {
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  return (
    <div>
      {rows.map((row, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            gap: '0.4rem',
            flexWrap: 'wrap',
            alignItems: 'center',
            margin: '0.3rem 0',
          }}
        >
          <select
            aria-label={t('policyDocCategoryAria', { n: i + 1 })}
            value={row.category}
            onChange={(e) => update(i, { category: e.target.value as DocumentCategory })}
          >
            {DOCUMENT_CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {t(ENUM_LABEL.DocumentCategory[c])}
              </option>
            ))}
          </select>
          <select
            aria-label={t('policyDocClassificationAria', { n: i + 1 })}
            value={row.classification}
            onChange={(e) =>
              update(i, { classification: e.target.value as DataClassification })
            }
          >
            {DATA_CLASSIFICATION_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {t(ENUM_LABEL.DataClassification[c])}
              </option>
            ))}
          </select>
          <input
            aria-label={t('policyDocFileNameAria', { n: i + 1 })}
            placeholder={t('policyDocFileNamePlaceholder')}
            value={row.fileName}
            onChange={(e) => update(i, { fileName: e.target.value })}
          />
          <input
            aria-label={t('policyDocStorageRefAria', { n: i + 1 })}
            placeholder={t('policyDocStorageRefPlaceholder')}
            value={row.storageRef}
            onChange={(e) => update(i, { storageRef: e.target.value })}
          />
          <button
            type="button"
            style={{ ...buttonStyle, width: 'auto' }}
            onClick={() => setRows(rows.filter((_, idx) => idx !== i))}
          >
            {t('policyRemoveDocRowButton')}
          </button>
        </div>
      ))}
      <button
        type="button"
        style={{ ...buttonStyle, width: 'auto' }}
        onClick={() => setRows([...rows, emptyDocRow()])}
      >{t('policyAddDocumentButton')}</button>
    </div>
  );
}

export function PolicySection({
  opportunity,
  isPlacement,
  canCheck,
  canDeliver,
  onOpportunityChanged,
}: Props) {
  const { language, t } = useLanguage();
  const [policy, setPolicy] = useState<Policy | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [inceptionDate, setInceptionDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');

  const [policyNumber, setPolicyNumber] = useState('');
  const [issuedPremium, setIssuedPremium] = useState('');
  const [limitsText, setLimitsText] = useState('{\n  "buildings": "5000000.000"\n}');
  const [sumsInsuredText, setSumsInsuredText] = useState('{\n  "total": "5000000.000"\n}');
  const [namedPerilsText, setNamedPerilsText] = useState('fire, flood, theft');
  const [extensionsText, setExtensionsText] = useState('');
  const [issuanceDocs, setIssuanceDocs] = useState<PolicyDocumentInput[]>([
    emptyDocRow(),
  ]);

  const [attachDocs, setAttachDocs] = useState<PolicyDocumentInput[]>([emptyDocRow()]);

  // Process 20 — the checker's transcription of the Requested Coverage.
  const [chkLimitsText, setChkLimitsText] = useState(
    '{\n  "buildings": "5000000.000"\n}',
  );
  const [chkSumsText, setChkSumsText] = useState('{\n  "total": "5000000.000"\n}');
  const [chkPerilsText, setChkPerilsText] = useState('fire, flood, theft');
  const [chkExtensionsText, setChkExtensionsText] = useState('');

  // Process 21 — delivery.
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('email');
  const [deliveryRecipient, setDeliveryRecipient] = useState('');

  const load = useCallback(async () => {
    try {
      const rows = await listPoliciesForOpportunity(opportunity.id);
      setPolicy(rows[0] ?? null);
      setLoadError(null);
    } catch (err) {
      setPolicy(null);
      setLoadError(
        err instanceof ApiError
          ? err.message
          : t('policyLoadError'),
      );
    }
  }, [opportunity.id, t]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  // Part F item #7 — the customer's own languagePreference decides the
  // document's language server-side; no picker here for a first pass.
  // The button is only rendered once schedules.length > 0 (see below),
  // so this call should never actually hit the api's own 422 — the
  // try/catch here is a safety net, not the expected path.
  async function downloadDocument(id: string) {
    setFormError(null);
    try {
      const blob = await downloadPolicyScheduleDocument(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `policy-schedule-summary-${id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setFormError(
        err instanceof ApiError
          ? err.message
          : t('policyScheduleDownloadError'),
      );
    }
  }

  // Part F item #7 — the certificate-of-insurance PDF, the 6th and final
  // named document type. Same gating shape as downloadDocument above
  // (button only rendered once schedules.length > 0), a genuinely
  // different content endpoint.
  async function downloadCertificate(id: string) {
    setFormError(null);
    try {
      const blob = await downloadPolicyCertificateDocument(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `certificate-of-insurance-${id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setFormError(
        err instanceof ApiError
          ? err.message
          : t('policyCertificateDownloadError'),
      );
    }
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setFormError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setFormError(
        err instanceof ApiError
          ? err.message
          : t('policyActionError'),
      );
    } finally {
      setBusy(false);
    }
  }

  if (policy === undefined) {
    return (
      <section>
        <h2 style={{ marginTop: '2.5rem' }}>{t('policySectionHeading')}</h2>
        <p>{t('policyCommonLoading')}</p>
      </section>
    );
  }
  if (policy === null && !POLICY_ELIGIBLE_STATES.has(opportunity.status)) {
    return null;
  }

  const limits = parseJsonObject(limitsText);
  const sumsInsured = parseJsonObject(sumsInsuredText);
  const issuanceReady =
    policyNumber.trim().length >= 2 &&
    issuedPremium.trim().length > 0 &&
    limits !== null &&
    sumsInsured !== null;

  return (
    <section>
      <h2 style={{ marginTop: '2.5rem' }}>{t('policySectionHeading')}</h2>
      <p style={{ opacity: 0.7, margin: '0.25rem 0 0' }}>{t('policyIntro')}</p>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}
      {formError ? (
        <p role="alert" style={errorStyle}>
          {formError}
        </p>
      ) : null}

      {policy === null ? (
        isPlacement ? (
          <div style={{ marginTop: '1rem', maxWidth: '30rem' }}>
            <div style={quoteFieldStyle}>
              <label htmlFor="pol-inception">{t('policyInceptionDateLabel')}</label>
              <input
                id="pol-inception"
                type="date"
                value={inceptionDate}
                onChange={(e) => setInceptionDate(e.target.value)}
              />
            </div>
            <div style={quoteFieldStyle}>
              <label htmlFor="pol-expiry">{t('policyExpiryDateLabel')}</label>
              <input
                id="pol-expiry"
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
              />
            </div>
            <button
              type="button"
              disabled={busy || inceptionDate.trim().length === 0}
              style={{ ...buttonStyle, width: 'auto' }}
              onClick={() =>
                void run(async () => {
                  await placePolicy({
                    opportunityId: opportunity.id,
                    inceptionDate,
                    expiryDate: expiryDate.trim() || undefined,
                  });
                  onOpportunityChanged();
                })
              }
            >
              {busy ? t('policyPlacingButton') : t('policyPlaceButton')}
            </button>
          </div>
        ) : (
          <p style={{ color: 'var(--ink-secondary)', marginTop: '1rem' }}>{t('policyNoneYet')}</p>
        )
      ) : (
        <div style={{ ...quoteChainCardStyle, marginTop: '1rem' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '1rem',
              flexWrap: 'wrap',
            }}
          >
            <strong>
              <bdi>{policy.insurer?.name ?? policy.insurerId}</bdi>
            </strong>
            <span style={rfqBadgeStyle}>{t(ENUM_LABEL.PolicyStatus[policy.status])}</span>
          </div>
          <p style={{ margin: '0.4rem 0' }}>
            <bdi>{policy.insuranceLine}</bdi>
            {policy.policyNumber ? (
              <>
                {' · '}
                <bdi>{policy.policyNumber}</bdi>
              </>
            ) : (
              ''
            )}
          </p>
          <p style={{ margin: '0.4rem 0' }}>
            Requested {formatMoney(policy.requestedPremium, language, policy.currency)}
            {policy.issuedPremium
              ? ` · Issued ${formatMoney(policy.issuedPremium, language, policy.currency)}` +
                (policy.premiumVariance
                  ? ` (Δ ${formatMoney(policy.premiumVariance, language, policy.currency)})`
                  : '')
              : ''}
          </p>
          <p style={{ opacity: 0.7, fontSize: '0.85rem', margin: '0.4rem 0' }}>
            Inception{' '}
            {policy.inceptionDate ? formatDate(policy.inceptionDate, language) : '—'}
            {' · '}
            Expiry {policy.expiryDate ? formatDate(policy.expiryDate, language) : '—'}
          </p>

          {policy.status === 'PLACEMENT_CONFIRMED' && isPlacement ? (
            <div style={{ marginTop: '0.8rem', maxWidth: '36rem' }}>
              <strong>{t('policyRecordIssuanceHeading')}</strong>
              <div style={quoteFieldStyle}>
                <label htmlFor="pol-number">{t('policyPolicyNumberLabel')}</label>
                <input
                  id="pol-number"
                  value={policyNumber}
                  onChange={(e) => setPolicyNumber(e.target.value)}
                />
              </div>
              <div style={quoteFieldStyle}>
                <label htmlFor="pol-issued-premium">{t('policyIssuedPremiumLabel')}</label>
                <input
                  id="pol-issued-premium"
                  inputMode="decimal"
                  placeholder="118500.000"
                  value={issuedPremium}
                  onChange={(e) => setIssuedPremium(e.target.value)}
                />
              </div>
              <div style={quoteFieldStyle}>
                <label htmlFor="pol-limits">{t('policyLimitsLabel')}</label>
                <textarea
                  id="pol-limits"
                  rows={3}
                  value={limitsText}
                  onChange={(e) => setLimitsText(e.target.value)}
                />
                {limits === null ? (
                  <span style={{ ...errorStyle, fontSize: '0.8rem' }}>{t('policyMustBeJsonObject')}</span>
                ) : null}
              </div>
              <div style={quoteFieldStyle}>
                <label htmlFor="pol-sums-insured">{t('policySumsInsuredLabel')}</label>
                <textarea
                  id="pol-sums-insured"
                  rows={3}
                  value={sumsInsuredText}
                  onChange={(e) => setSumsInsuredText(e.target.value)}
                />
                {sumsInsured === null ? (
                  <span style={{ ...errorStyle, fontSize: '0.8rem' }}>{t('policyMustBeJsonObject')}</span>
                ) : null}
              </div>
              <div style={quoteFieldStyle}>
                <label htmlFor="pol-perils">{t('policyNamedPerilsLabel')}</label>
                <input
                  id="pol-perils"
                  value={namedPerilsText}
                  onChange={(e) => setNamedPerilsText(e.target.value)}
                />
              </div>
              <div style={quoteFieldStyle}>
                <label htmlFor="pol-extensions">{t('policyExtensionsLabel')}</label>
                <input
                  id="pol-extensions"
                  value={extensionsText}
                  onChange={(e) => setExtensionsText(e.target.value)}
                />
              </div>
              <p style={{ fontWeight: 600, marginTop: '0.6rem' }}>{t('policyIssuedDocumentsHeading')}</p>
              <DocumentRowsEditor rows={issuanceDocs} setRows={setIssuanceDocs} />
              <button
                type="button"
                disabled={busy || !issuanceReady}
                style={{ ...buttonStyle, width: 'auto', marginTop: '0.6rem' }}
                onClick={() =>
                  void run(() =>
                    recordPolicyIssuance(policy.id, {
                      policyNumber: policyNumber.trim(),
                      issuedPremium: issuedPremium.trim(),
                      schedule: {
                        limits: limits ?? {},
                        sumsInsured: sumsInsured ?? {},
                        namedPerils: splitList(namedPerilsText),
                        extensions: splitList(extensionsText),
                      },
                      documents: issuanceDocs.filter(
                        (d) => d.fileName.trim().length > 0 && d.storageRef.trim().length > 0,
                      ),
                    }),
                  )
                }
              >
                {busy ? t('policyIssuingButton') : t('policyIssueButton')}
              </button>
            </div>
          ) : null}

          {policy.schedules.length > 0 ? (
            <div style={{ marginTop: '0.8rem' }}>
              <p style={{ fontWeight: 600 }}>{t('policyCoverageScheduleHeading')}</p>
              {policy.schedules.map((s) => (
                <div key={s.id} style={{ fontSize: '0.9rem', margin: '0.3rem 0' }}>
                  Effective {formatDate(s.effectiveFrom, language)}
                  {s.effectiveTo
                    ? ` – ${formatDate(s.effectiveTo, language)}`
                    : ' – ongoing'}
                  {' · perils: '}
                  {s.namedPerils.join(', ') || '—'}
                  {' · extensions: '}
                  {s.extensions.join(', ') || '—'}
                </div>
              ))}
              <button
                type="button"
                onClick={() => void downloadDocument(policy.id)}
                style={{ ...buttonStyle, width: 'auto', marginTop: '0.4rem' }}
              >
                {t('policyDownloadScheduleButton')}
              </button>
              <button
                type="button"
                onClick={() => void downloadCertificate(policy.id)}
                style={{
                  ...buttonStyle,
                  width: 'auto',
                  marginTop: '0.4rem',
                  marginInlineStart: '0.5rem',
                }}
              >{t('policyDownloadCertificate')}</button>
            </div>
          ) : null}

          {policy.documents.length > 0 ? (
            <div style={{ marginTop: '0.8rem' }}>
              <p style={{ fontWeight: 600 }}>{t('policyElectronicFileHeading')}</p>
              <ul style={{ margin: '0.3rem 0' }}>
                {policy.documents.map((d) => (
                  <li key={d.id} style={{ fontSize: '0.9rem' }}>
                    {t(ENUM_LABEL.DocumentCategory[d.category])} · {t(ENUM_LABEL.DataClassification[d.classification])} · {d.fileName} (v{d.versionNumber})
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {isPlacement && policy.status !== 'PLACEMENT_CONFIRMED' ? (
            <div style={{ marginTop: '0.8rem' }}>
              <p style={{ fontWeight: 600 }}>{t('policyAttachDocumentHeading')}</p>
              <DocumentRowsEditor rows={attachDocs} setRows={setAttachDocs} />
              <button
                type="button"
                disabled={
                  busy ||
                  attachDocs.every(
                    (d) => d.fileName.trim().length === 0 || d.storageRef.trim().length === 0,
                  )
                }
                style={{ ...buttonStyle, width: 'auto', marginTop: '0.4rem' }}
                onClick={() =>
                  void run(async () => {
                    await attachPolicyDocuments(
                      policy.id,
                      attachDocs.filter(
                        (d) =>
                          d.fileName.trim().length > 0 && d.storageRef.trim().length > 0,
                      ),
                    );
                    setAttachDocs([emptyDocRow()]);
                  })
                }
              >
                {t('policyAttachDocsButton')}
              </button>
            </div>
          ) : null}

          {policy.checking ? (
            <div
              style={{
                marginTop: '0.8rem',
                padding: '0.6rem',
                borderInlineStart: `3px solid ${policy.checking.discrepancyFound ? 'var(--error, #c00)' : 'var(--ok, #2a7)'}`,
              }}
            >
              <p style={{ fontWeight: 600, margin: 0 }}>
                {t('policyQcResultLabel')}{' '}
                {policy.checking.discrepancyFound
                  ? t('policyQcDiscrepancyBlocked')
                  : t('policyQcVerified')}
              </p>
              {policy.checking.discrepancyDetail ? (
                <p style={{ margin: '0.3rem 0', fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>
                  {policy.checking.discrepancyDetail}
                </p>
              ) : null}
              {policy.checking.discrepancyLoggedAsPiRiskEvent ? (
                <p style={{ margin: '0.3rem 0', fontSize: '0.85rem', opacity: 0.75 }}>{t('policyPiRiskEventLogged')}</p>
              ) : null}
              <p style={{ margin: '0.3rem 0 0', fontSize: '0.8rem', color: 'var(--ink-secondary)' }}>
                Checked by {policy.checking.checkedByUserId ?? '—'}
                {policy.checking.checkedAt
                  ? ` on ${formatDateTime(policy.checking.checkedAt, language)}`
                  : ''}
              </p>
            </div>
          ) : null}

          {canCheck && CHECKABLE_STATES.has(policy.status) ? (
            <div style={{ marginTop: '0.8rem', maxWidth: '36rem' }}>
              <strong>
                {policy.checking ? t('policyQcRerunHeading') : t('policyQcHeading')}
              </strong>
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
              <button
                type="button"
                disabled={
                  busy ||
                  parseJsonObject(chkLimitsText) === null ||
                  parseJsonObject(chkSumsText) === null
                }
                style={{ ...buttonStyle, width: 'auto', marginTop: '0.4rem' }}
                onClick={() =>
                  void run(async () => {
                    await checkPolicy(policy.id, {
                      limits: parseJsonObject(chkLimitsText) ?? {},
                      sumsInsured: parseJsonObject(chkSumsText) ?? {},
                      namedPerils: splitList(chkPerilsText),
                      extensions: splitList(chkExtensionsText),
                    });
                    onOpportunityChanged();
                  })
                }
              >
                {busy ? t('policyCheckingButton') : t('policyCheckButton')}
              </button>
            </div>
          ) : null}

          {policy.delivery ? (
            <div style={{ marginTop: '0.8rem' }}>
              <p style={{ fontWeight: 600 }}>{t('policyDeliveryHeading')}</p>
              <p style={{ fontSize: '0.9rem', margin: '0.3rem 0' }}>
                {t(ENUM_LABEL.DeliveryMethod[policy.delivery.method])} · to {policy.delivery.recipient} ·{' '}
                {formatDate(policy.delivery.deliveredAt, language)}
                {' · '}
                {policy.delivery.receiptAcknowledgedAt
                  ? `receipt acknowledged ${formatDate(policy.delivery.receiptAcknowledgedAt, language)}`
                  : t('policyAwaitingAcknowledgement')}
              </p>
              {canDeliver && !policy.delivery.receiptAcknowledgedAt ? (
                <button
                  type="button"
                  disabled={busy}
                  style={{ ...buttonStyle, width: 'auto' }}
                  onClick={() =>
                    void run(async () => {
                      await acknowledgePolicyReceipt(policy.id);
                      onOpportunityChanged();
                    })
                  }
                >{t('policyAcknowledgeReceiptButton')}</button>
              ) : null}
            </div>
          ) : null}

          {canDeliver && !policy.delivery && policy.status === 'VERIFIED' ? (
            <div style={{ marginTop: '0.8rem', maxWidth: '30rem' }}>
              <strong>{t('policyRecordDeliveryButtonText')}</strong>
              <div style={quoteFieldStyle}>
                <label htmlFor="del-method">{t('financeMethodLabel')}</label>
                <select
                  id="del-method"
                  value={deliveryMethod}
                  onChange={(e) =>
                    setDeliveryMethod(e.target.value as DeliveryMethod)
                  }
                >
                  {DELIVERY_METHOD_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {t(DELIVERY_METHOD_LABEL_KEY[o.value])}
                    </option>
                  ))}
                </select>
              </div>
              <div style={quoteFieldStyle}>
                <label htmlFor="del-recipient">{t('policyDeliveryRecipientLabel')}</label>
                <input
                  id="del-recipient"
                  value={deliveryRecipient}
                  maxLength={200}
                  placeholder={t('policyDeliveryRecipientPlaceholder')}
                  onChange={(e) => setDeliveryRecipient(e.target.value)}
                />
              </div>
              <button
                type="button"
                disabled={busy || deliveryRecipient.trim().length < 2}
                style={{ ...buttonStyle, width: 'auto' }}
                onClick={() =>
                  void run(async () => {
                    await recordPolicyDelivery(policy.id, {
                      method: deliveryMethod,
                      recipient: deliveryRecipient.trim(),
                    });
                    onOpportunityChanged();
                  })
                }
              >
                {busy ? t('policyIssuingButton') : t('policyRecordDeliveryButton')}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
