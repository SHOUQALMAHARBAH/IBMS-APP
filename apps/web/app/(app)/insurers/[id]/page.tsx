'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  deactivateInsurer,
  clearFinancialStrengthRating,
  getInsurer,
  getInsurerStatusImpact,
  reactivateInsurer,
  STRUCTURE_LABEL_KEY,
  type Insurer,
  type InsurerStatusImpact,
} from '../../../../lib/insurer/insurer-api';
import { ApiError, isMfaEnrolmentError } from '../../../../lib/auth/api-client';
import {
  ErrorState,
  SkeletonList,
} from '../../../../components/ui';
import { pageStackStyle, sectionStyle } from '../../../../components/lead/lead.styles';
import {
  detailGridStyle,
  fieldLabelStyle,
  fieldValueStyle,
  impactCountAttentionStyle,
  impactCountStyle,
  impactPanelStyle,
  impactRowStyle,
  lineChipOfficeStyle,
  lineChipStyle,
} from '../../../../components/insurer/insurer.styles';
import { DeactivatedInsurerBadge } from '../../../../components/insurer/DeactivatedInsurerBadge';
import { hasPermission } from '../../../../lib/auth/permissions';
import { useLanguage } from '../../../../lib/i18n/language-context';
import type { TranslationKey } from '../../../../lib/i18n/translations';
import { permissionRefusal } from '../../../../lib/i18n/permission-refusal';

/**
 * One insurer, and the act of stopping or resuming work with them.
 *
 * ## The company / relationship split is the point of the layout
 *
 * Two headed sections, not one details grid. The company block is public knowledge and is exactly
 * what the cross-office directory shows; the relationship block is this office's own commercial
 * terms and never leaves it. Anyone adding a field here has to choose a section, and the choice is
 * the same one the API's two extractors make — which is why they are two functions there rather
 * than one that returns everything.
 *
 * ## Deactivation asks before it acts, and shows what the record will say
 *
 * `GET :id/status-impact` returns the same five counts the deactivation writes to the audit trail.
 * Showing them BEFORE the confirm step means the screen and the record cannot drift apart, and the
 * administrator decides with the numbers in front of them rather than after.
 *
 * It is ALLOW AND RECORD, never refuse: no count blocks the act, because refusing would not settle
 * an obligation. So the panel is neutral, not a warning — the two policy counts stay separate
 * because one is cover running on its own and the other is work the INSURER still owes, and a
 * single total would hide the half that should give someone pause.
 */
export default function InsurerDetailPage() {
  const { t, language } = useLanguage();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const { user, isLoading } = useAuth();
  // Deactivating and reactivating are one capability pointed two ways, and this section is the only
  // thing on the page behind it. `insurer.deactivate` also gates the impact read the dialog performs,
  // so the button and the request it makes ask for the same code.
  const canDeactivate = !!user && hasPermission(user, 'insurer.deactivate');
  /*
   * DECISION 93's CONTROL — `insurer.update` and NOT a new code. This is a correction to the office's
   * own relationship record, which is what that permission is for, and the controller records the
   * argument against minting one: a code per action would be a checkbox on the Role screen for
   * something nobody administers separately. OFFICE_ADMINISTRATOR is the only holder.
   */
  const canCorrect = !!user && hasPermission(user, 'insurer.update');

  const [insurer, setInsurer] = useState<Insurer | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [confirming, setConfirming] = useState<'DEACTIVATE' | 'REACTIVATE' | null>(null);
  const [impact, setImpact] = useState<InsurerStatusImpact | null>(null);
  const [impactError, setImpactError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [statusError, setStatusError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ratingError, setRatingError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setInsurer(await getInsurer(id));
      setLoadError(null);
    } catch (err) {
      setInsurer(null);
      setLoadError(
        err instanceof ApiError && err.status === 404
          ? t('insDetailNotFound')
          : isMfaEnrolmentError(err)
            ? t('insMfaRequired')
            : err instanceof ApiError && err.status === 403
              ? permissionRefusal(t, 'insListRefusalAct', 'insurer.read')
            : t('insListLoadError'),
      );
    }
  }, [id, t]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!user || !id) return;
    void (async () => {
      await load();
    })();
  }, [user, id, load]);

  async function beginDeactivate() {
    setConfirming('DEACTIVATE');
    setReason('');
    setStatusError(null);
    setImpact(null);
    setImpactError(null);
    try {
      setImpact(await getInsurerStatusImpact(id));
    } catch {
      // The impact is context for a decision, not a precondition for it. A failure here must not
      // block the act — it says so and leaves the confirm button working, because an administrator
      // who has decided to stop dealing with a company should not be held up by a count.
      setImpactError(t('insImpactError'));
    }
  }

  async function confirm() {
    if (confirming === 'DEACTIVATE' && !reason.trim()) {
      setStatusError(t('insDeactivateReasonRequired'));
      return;
    }
    setBusy(true);
    setStatusError(null);
    try {
      const result =
        confirming === 'DEACTIVATE'
          ? await deactivateInsurer(id, reason.trim())
          : await reactivateInsurer(id, reason.trim() || undefined);
      setInsurer(result.insurer);
      setConfirming(null);
      setImpact(null);
    } catch (err) {
      setStatusError(err instanceof ApiError ? err.message : t('insStatusError'));
    } finally {
      setBusy(false);
    }
  }

  if (isLoading || !user) return null;

  if (loadError)
    return (
      <main style={pageStackStyle}>
        <ErrorState title={loadError} />
      </main>
    );
  if (!insurer) return <main style={pageStackStyle}>{t('insListLoading')}</main>;

  const dash = t('insDetailEmptyField');
  const field = (labelKey: TranslationKey, value: string | null) => (
    <div>
      <div style={fieldLabelStyle}>{t(labelKey)}</div>
      <div style={fieldValueStyle}>
        <bdi>{value ?? dash}</bdi>
      </div>
    </div>
  );

  return (
    <main style={pageStackStyle}>
      <h1>
        <bdi>{language === 'AR' ? (insurer.nameAr ?? insurer.name) : insurer.name}</bdi>
        <DeactivatedInsurerBadge isActive={insurer.isActive} />
      </h1>
      {insurer.isOfficeLocal ? (
        <p style={{ color: 'var(--ink-secondary)', fontSize: '0.85rem' }}>
          {t('insOfficeLocalExplain')}
        </p>
      ) : null}
      {!insurer.isActive ? (
        <p data-deactivated-notice="">{t('insDeactivatedNotice')}</p>
      ) : null}

      <section style={sectionStyle}>
        <h2>{t('insDetailCompanyHeading')}</h2>
        <div style={detailGridStyle}>
          {field(
            'insDetailStructureLabel',
            insurer.structure ? t(STRUCTURE_LABEL_KEY[insurer.structure]) : null,
          )}
          {field('insDetailPhoneLabel', insurer.companyPhone)}
          {field('insDetailEmailLabel', insurer.companyEmail)}
          {field('insDetailWebsiteLabel', insurer.companyWebsite)}
          {field('insDetailAddressLabel', insurer.companyCorrespondenceAddress)}
          {field(
            'insDetailRegisteredLabel',
            insurer.createdAt ? insurer.createdAt.slice(0, 10) : null,
          )}
        </div>
        <div style={{ marginTop: '0.75rem' }}>
          <div style={fieldLabelStyle}>{t('insLinesLabel')}</div>
          {insurer.linesOffered.length === 0 ? (
            <p style={{ color: 'var(--ink-secondary)', fontSize: '0.85rem' }}>
              {t('insLinesNone')}
            </p>
          ) : (
            <div style={{ marginTop: '0.3rem' }}>
              {insurer.linesOffered.map((line) => (
                <span
                  key={line.id}
                  style={line.isStandard ? lineChipStyle : lineChipOfficeStyle}
                  title={line.isStandard ? undefined : t('insOfficeLineBadge')}
                >
                  <bdi>{language === 'AR' ? line.nameAr : line.nameEn}</bdi>
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      <section style={sectionStyle}>
        <h2>{t('insDetailRelationshipHeading')}</h2>
        <p style={{ color: 'var(--ink-secondary)', fontSize: '0.85rem' }}>
          {t('insDetailRelationshipNote')}
        </p>
        <div style={detailGridStyle}>
          {field(
            'insDetailCreditTermsLabel',
            insurer.creditTermsDays === null
              ? null
              : t('insDetailCreditTermsDays', { days: insurer.creditTermsDays }),
          )}
          {/*
            THE RATING WITH ITS AS-OF DATE, AND A WAY TO CLEAR BOTH.

            The api has always sent `financialStrengthRatingAsOf` and this screen DROPPED it, so the
            office's own solvency judgement about an insurer rendered with no date on it — which is
            the exact state decision 93 exists to prevent, one layer above the clear. Hand-copied
            over HTTP, so neither the compiler nor any test could see the omission.

            The clear removes BOTH FIELDS TOGETHER, which is the whole of decision 93: a rating
            attributed to a month that has passed is a judgement nobody made today. There is no
            confirmation step — the act is a correction, not a disposal, and the audit row carries
            both halves of what was there as `beforeValue`, so the old rating is recoverable by a
            person reading the trail. What is NOT recoverable from the product is re-entering it:
            measured, `updateInsurer` has no caller anywhere in `apps/web`, so no screen sets a
            rating either. That is an adjacent gap, reported rather than closed here.
          */}
          <div>
            <div style={fieldLabelStyle}>{t('insDetailRatingLabel')}</div>
            <div style={fieldValueStyle} data-insurer-rating="">
              <bdi>
                {insurer.financialStrengthRating === null
                  ? dash
                  : insurer.financialStrengthRatingAsOf === null
                    ? insurer.financialStrengthRating
                    : `${insurer.financialStrengthRating} ${t('insDetailRatingAsOf', {
                        at: insurer.financialStrengthRatingAsOf.slice(0, 10),
                      })}`}
              </bdi>
            </div>
            {/* The control exists only where there is something to clear AND the reader may clear
                it — the frontend directive's rule, and it also keeps the api's own no-op branch
                unreachable from the screen rather than merely harmless. */}
            {canCorrect && insurer.financialStrengthRating !== null ? (
              <button
                type="button"
                disabled={busy}
                data-testid="insurer-clear-rating"
                onClick={() => {
                  setBusy(true);
                  setRatingError(null);
                  void (async () => {
                    try {
                      setInsurer(await clearFinancialStrengthRating(id));
                    } catch (err) {
                      setRatingError(
                        err instanceof ApiError
                          ? err.message
                          : t('insListLoadError'),
                      );
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
              >
                {busy ? t('commonWorking') : t('commonClear')}
              </button>
            ) : null}
            {ratingError !== null ? (
              <ErrorState title={ratingError} data-testid="insurer-rating-error" />
            ) : null}
          </div>
          {field('insDetailRfqContactLabel', insurer.rfqContactName)}
          {field('insDetailClaimsContactLabel', insurer.claimsContactName)}
          {field('insDetailUnderwriterLabel', insurer.underwriterContact)}
        </div>
      </section>

      {canDeactivate ? (
        <section style={sectionStyle}>
          {confirming === null ? (
            insurer.isActive ? (
              <button type="button" onClick={() => void beginDeactivate()}>
                {t('insDeactivateButton')}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setConfirming('REACTIVATE');
                  setReason('');
                  setStatusError(null);
                }}
              >
                {t('insReactivateButton')}
              </button>
            )
          ) : (
            <div>
              {confirming === 'DEACTIVATE' ? (
                <div style={impactPanelStyle} data-impact-panel="">
                  <h3 style={{ margin: 0, fontSize: '1rem' }}>{t('insImpactHeading')}</h3>
                  <p style={{ color: 'var(--ink-secondary)', fontSize: '0.85rem' }}>
                    {t('insImpactIntro')}
                  </p>
                  {impactError ? (
                    <ErrorState title={impactError} />
                  ) : impact === null ? (
                    <SkeletonList rows={4} label={t('insImpactLoading')} />
                  ) : (
                    <dl style={{ margin: 0 }}>
                      <div style={impactRowStyle}>
                        <dt>{t('insImpactInForce')}</dt>
                        <dd style={impactCountStyle} data-impact="in-force">
                          {impact.policiesInForce}
                        </dd>
                      </div>
                      <div style={impactRowStyle}>
                        {/* Emphasised, and NOT added to the figure above: this is work the insurer
                            still owes. The API reports the two separately for that reason. */}
                        <dt>{t('insImpactInIssuance')}</dt>
                        <dd
                          style={impactCountAttentionStyle}
                          data-impact="in-issuance"
                        >
                          {impact.policiesInIssuance}
                        </dd>
                      </div>
                      <div style={impactRowStyle}>
                        <dt>{t('insImpactRenewals')}</dt>
                        <dd style={impactCountStyle} data-impact="renewals">
                          {impact.openRenewalCases}
                        </dd>
                      </div>
                      <div style={impactRowStyle}>
                        <dt>{t('insImpactRfqs')}</dt>
                        <dd style={impactCountStyle} data-impact="rfqs">
                          {impact.pendingRfqSubmissions}
                        </dd>
                      </div>
                      <div style={impactRowStyle}>
                        <dt>{t('insImpactInvoices')}</dt>
                        <dd style={impactCountStyle} data-impact="invoices">
                          {impact.unsettledInvoices}
                        </dd>
                      </div>
                    </dl>
                  )}
                </div>
              ) : null}

              <label
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.25rem',
                  marginTop: '0.75rem',
                }}
              >
                {confirming === 'DEACTIVATE'
                  ? t('insDeactivateReasonLabel')
                  : t('insReactivateReasonLabel')}
                <input
                  aria-label={
                    confirming === 'DEACTIVATE'
                      ? t('insDeactivateReasonLabel')
                      : t('insReactivateReasonLabel')
                  }
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required={confirming === 'DEACTIVATE'}
                />
              </label>

              {statusError ? (
                <ErrorState title={statusError} />
              ) : null}

              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button type="button" disabled={busy} onClick={() => void confirm()}>
                  {busy
                    ? t('insStatusBusyButton')
                    : confirming === 'DEACTIVATE'
                      ? t('insDeactivateConfirmButton')
                      : t('insReactivateConfirmButton')}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setConfirming(null);
                    setImpact(null);
                    setStatusError(null);
                  }}
                >
                  {t('insStatusCancelButton')}
                </button>
              </div>
            </div>
          )}
        </section>
      ) : null}
    </main>
  );
}
