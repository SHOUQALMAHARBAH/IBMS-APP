'use client';

import { useCallback, useEffect, useState } from 'react';
import { ENUM_LABEL } from '../../../../lib/i18n/enum-labels';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth/auth-context';
import {
  getCustomer,
  listCustomerDocuments,
  listUbos,
  revealCustomerField,
  type Customer,
  type CustomerDocument,
  type RevealableField,
  type Ubo,
} from '../../../../lib/customer/customer-api';
import { CustomerContactCorrection } from '../../../../components/customer/CustomerContactCorrection';
import { CustomerIdentifierCorrection } from '../../../../components/customer/CustomerIdentifierCorrection';
import { ApiError } from '../../../../lib/auth/api-client';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
} from '../../../../components/ui';
import { pageStackStyle } from '../../../../components/lead/lead.styles';
import {
  profileFieldLabelStyle,
  profileFieldValueStyle,
  profileGridStyle,
} from '../../../../components/prospect/prospect.styles';
import { repeatableRowStyle } from '../../../../components/customer/customer.styles';
import { ConsentCaptureWidget } from '../../../../components/pdpl/ConsentCaptureWidget';
import { PrivacyNoticeDisplay } from '../../../../components/pdpl/PrivacyNoticeDisplay';
import { useLanguage } from '../../../../lib/i18n/language-context';
import type { TranslationKey } from '../../../../lib/i18n/translations';
import type { CustomerStatus, CustomerType } from '../../../../lib/customer/customer-api';
import { hasPermission } from '../../../../lib/auth/permissions';
import { permissionRefusal } from '../../../../lib/i18n/permission-refusal';
import { listKycRecords, type KycQueueRecord } from '../../../../lib/kyc/kyc-api';
import {
  KYC_AWAITING_DECISION,
  KYC_STATUS_LABEL_KEY,
} from '../../../../lib/kyc/kyc-status-labels';
import { WorkflowHistoryLink } from '../../../../components/ui/WorkflowHistoryLink';

const TYPE_LABEL_KEY: Record<CustomerType, TranslationKey> = {
  INDIVIDUAL: 'customerTypeIndividual',
  CORPORATE: 'customerTypeCorporate',
};

const STATUS_LABEL_KEY: Record<CustomerStatus, TranslationKey> = {
  PENDING_KYC: 'customerStatusPendingKyc',
  ACTIVE: 'customerStatusActive',
  SUSPENDED: 'customerStatusSuspended',
  CLOSED: 'customerStatusClosed',
};

function ProfileField({
  label,
  value,
  revealed,
  onReveal,
  revealLabel,
  /** Untranslated hook for the three revealable fields, so a test can assert
   *  which ROW offers a reveal. All three buttons carry the same translated
   *  label, and `getByRole(name)` matches substrings, so without this an
   *  assertion about the national-ID row can pass off the phone row's button. */
  fieldKey,
}: {
  label: string;
  value: string | null | undefined;
  revealed?: string;
  onReveal?: () => void;
  revealLabel: string;
  fieldKey?: string;
}) {
  return (
    <div data-field={fieldKey}>
      <div style={profileFieldLabelStyle}>{label}</div>
      <div style={profileFieldValueStyle}>
        <bdi>{revealed ?? value ?? '—'}</bdi>
        {onReveal && !revealed ? (
          <Button
            variant="secondary"
            size="sm"
            style={{ marginInlineStart: 'var(--space-2)' }}
            onClick={onReveal}
          >
            {revealLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export default function CustomerProfilePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [ubos, setUbos] = useState<Ubo[]>([]);
  const [documents, setDocuments] = useState<CustomerDocument[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Partial<Record<RevealableField, string>>>({});
  const [revealReason, setRevealReason] = useState('');
  const [revealTarget, setRevealTarget] = useState<RevealableField | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [kyc, setKyc] = useState<KycQueueRecord | null>(null);
  // The same codes `GET /kyc-records` requires — `PermissionsGuard` ORs them, so either is enough.
  const canReadKyc =
    hasPermission(user, 'kyc.capture') || hasPermission(user, 'kyc.approve');

  const load = useCallback(async () => {
    try {
      const result = await getCustomer(params.id);
      setCustomer(result);
      setLoadError(null);
      if (result.customerType === 'CORPORATE') {
        setUbos(await listUbos(params.id));
      }
      setDocuments(await listCustomerDocuments(params.id));
    } catch (err) {
      setLoadError(
        err instanceof ApiError && (err.status === 403 || err.status === 404)
          ? t('customerProfileNotFound')
          : err instanceof ApiError
            ? err.message
            : t('commonTryAgain'),
      );
    }
  }, [params.id, t]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load, t]);

  // DEFECT 1 of `docs/kyc-path.md`. Its OWN effect rather than folded into `load()`: that read is gated
  // on `customer.360-view.read` and this one on the KYC codes, so a reader holding the first and not the
  // second must still get the page. Folded in, one 403 would close the whole screen — the failure
  // `/settings/org-units` already solved by rendering the half the reader holds.
  useEffect(() => {
    if (!user || !canReadKyc) return;
    let cancelled = false;
    void (async () => {
      try {
        const records = await listKycRecords({ customerId: params.id });
        // The MOST RECENT file, which is what "what stage is this customer at" means. A customer can
        // hold several over time — a rejection followed by a fresh capture, or a periodic re-review —
        // and the api returns them newest first.
        if (!cancelled) setKyc(records[0] ?? null);
      } catch {
        // Deliberately silent. The stage is a read ALONGSIDE the file, not the reason the page exists,
        // and an error banner for it would report the customer as unloadable when the customer loaded
        // fine. The section simply does not appear.
        if (!cancelled) setKyc(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, canReadKyc, params.id]);

  async function handleReveal(field: RevealableField) {
    setRevealError(null);
    if (!revealReason.trim()) {
      setRevealError(t('customerRevealJustificationRequired'));
      return;
    }
    try {
      const { value } = await revealCustomerField(params.id, field, revealReason);
      setRevealed((prev) => ({ ...prev, [field]: value }));
      setRevealTarget(null);
      setRevealReason('');
    } catch (err) {
      setRevealError(err instanceof ApiError ? err.message : t('customerRevealError'));
    }
  }

  if (isLoading || !user) return null;

  // Client-side hint only (same convention as CAN_CREATE_CUSTOMER_ROLES) —
  // the backend enforces needs-assessment.create / risk-profile.* on write
  // regardless.
  const canStartNeedsAssessment = hasPermission(user, 'needs-assessment.create');
  const canOpenRiskSurvey = hasPermission(user, 'risk-profile.create');
  const canOpenInsuranceProgram = hasPermission(user, 'program.read');
  const canOpenCrossSell = hasPermission(user, 'cross-sell.read');
  const canOpenUpSell = canOpenCrossSell;
  const canOpenCrm = hasPermission(user, 'customer.360-view.read');
  // Part 10.2. Revealing a national ID is its own permission as of the
  // office-scoped RBAC work — held by Compliance, not by everyone who can open
  // the file. Without this check the button renders for every reader and 403s on
  // click, which is the dead control the UX directive rules out.
  const canRevealNationalId = hasPermission(user, 'customer.national-id.reveal');

  return (
    <main style={pageStackStyle}>
      <Button variant="ghost" onClick={() => router.push('/customers')}>
        {t('customerProfileBackButton')}
      </Button>

      {loadError ? (
        <ErrorState title={loadError} />
      ) : null}

      {customer ? (
        <>
          <h1>
            <bdi>{customer.legalName}</bdi>
          </h1>
          <p style={{ margin: '0 0 1rem' }}>
            <WorkflowHistoryLink entityType='Customer' entityId={customer.id} />
          </p>
          <p style={{ color: 'var(--ink-secondary)' }}>
            {t('customerProfileTypeStatusLine', {
              type: t(TYPE_LABEL_KEY[customer.customerType]),
              status: t(STATUS_LABEL_KEY[customer.status]),
            })}
          </p>

          {/* DEFECT 1 of `docs/kyc-path.md`. Directly under the customer's own status because the two
              are halves of one fact: `PENDING_KYC` says the customer is not active, and the stage says
              why. A reader seeing the first and not the second is the state the defect describes —
              including the officer who has just pressed "submit for review" and is sent here. */}
          {canReadKyc ? (
            <p data-kyc-stage={kyc?.status ?? 'none'} style={{ color: 'var(--ink-secondary)' }}>
              {kyc ? (
                <>
                  {t('customerKycStageLine', {
                    stage: t(KYC_STATUS_LABEL_KEY[kyc.status]),
                  })}
                  {KYC_AWAITING_DECISION.includes(kyc.status) ? (
                    <>
                      {' '}
                      <Link href="/customers/kyc-queue" data-kyc-queue-link="">
                        {t('customerKycStageQueueLink')}
                      </Link>
                    </>
                  ) : null}
                </>
              ) : (
                /* No file at all is a real state, not an error: a customer imported from a back-book
                   has none until somebody opens one. Saying so beats rendering nothing, which is the
                   whole complaint. */
                t('customerKycStageNone')
              )}
            </p>
          ) : null}

          <ConsentCaptureWidget
            customerId={customer.id}
            purpose="KYC_AML"
            label={t('customerConsentLabel')}
            defaultConsentTextVersion="kyc-notice-v1"
          />
          <PrivacyNoticeDisplay
            touchpoint="onboarding_kyc"
            canRead={hasPermission(user, 'privacy-notice.read')}
          />

          {/* THE RECORD'S OWN FACTS. A plain `Card` and deliberately no title: the block
              is identified by what is in it, and inventing a heading here would be an
              Arabic word nobody chose. It had no surface at all until this pass — two
              cards above it, a stretch of bare page, then cards again. */}
          <Card>
            <div style={profileGridStyle}>
            {/* INDIVIDUAL ONLY — a company has no national ID, and this field was
                rendered for one anyway. The owner's walk: «لما سجلت عميل ك شركة،
                الرقم الوطني بطلعله – شرطة لأني ما ضفته، فش اله حقل تعبئة بعملية
                التسجيل» — she read the dash as a field she had failed to fill,
                which is the only reasonable reading of a labelled empty row. */}
            {customer.customerType === 'INDIVIDUAL' ? (
              <>
                <ProfileField
                  label={t('customerFieldNationalId')}
                  value={customer.nationalId}
                  fieldKey="nationalId"
                  revealed={revealed.nationalId}
                  onReveal={
                    customer.nationalId && canRevealNationalId
                      ? () => setRevealTarget('nationalId')
                      : undefined
                  }
                  revealLabel={t('customerProfileFieldReveal')}
                />
                {/* THE TWO SCREENING DISCRIMINATORS, rendered for the first time.
                    `Customer.dateOfBirth` and `.nationality` have been on the wire
                    and in the web's own type since the columns shipped, and no
                    screen read either — so the two facts that separate a true
                    sanctions match from a coincidence of names were invisible to
                    the person reviewing the match. Stored in the CLEAR by decision
                    (see the column's own comment), so no reveal control. */}
                <ProfileField
                  label={t('customerFieldDateOfBirth')}
                  value={customer.dateOfBirth}
                  revealLabel={t('customerProfileFieldReveal')}
                />
                <ProfileField
                  label={t('impFieldNationality')}
                  value={customer.nationality}
                  revealLabel={t('customerProfileFieldReveal')}
                />
              </>
            ) : null}
            <ProfileField
              label={t('customerFieldContactPhone')}
              value={customer.contactPhone}
              fieldKey="contactPhone"
              revealed={revealed.contactPhone}
              onReveal={() => setRevealTarget('contactPhone')}
              revealLabel={t('customerProfileFieldReveal')}
            />
            <ProfileField
              label={t('customerFieldContactEmail')}
              value={customer.contactEmail}
              fieldKey="contactEmail"
              revealed={revealed.contactEmail}
              onReveal={() => setRevealTarget('contactEmail')}
              revealLabel={t('customerProfileFieldReveal')}
            />
            {/* CORPORATE ONLY. These three were rendered on an INDIVIDUAL's page as
                three empty rows, and they are the very three the brief believed had
                no form field: «سجلت عميل ك فرد وهيك طلعلي زي – عند هذول الحقول لأني
                ما ضفتهم لأنه فش الهم حقول من البداية». They DO have form fields — on
                the corporate branch of the wizard, which the company she registered
                the same day used successfully. What was wrong was showing them to a
                natural person, who can never have any of them. */}
            {customer.customerType === 'CORPORATE' ? (
              <>
                <ProfileField
                  label={t('customerFieldRegistrationNumber')}
                  value={customer.registrationNumber}
                  revealLabel={t('customerProfileFieldReveal')}
                />
                <ProfileField
                  label={t('customerFieldRegisteredAddress')}
                  value={customer.registeredAddress}
                  revealLabel={t('customerProfileFieldReveal')}
                />
                <ProfileField
                  label={t('customerFieldNatureOfBusiness')}
                  value={customer.natureOfBusiness}
                  revealLabel={t('customerProfileFieldReveal')}
                />
              </>
            ) : null}
            <ProfileField
              label={t('customerFieldLanguagePreference')}
              value={customer.languagePreference}
              revealLabel={t('customerProfileFieldReveal')}
            />
            {customer.customerType === 'INDIVIDUAL' ? (
              <>
                <ProfileField
                  label={t('customerFieldGivenName')}
                  value={customer.givenName}
                  revealLabel={t('customerProfileFieldReveal')}
                />
                <ProfileField
                  label={t('customerFieldFatherName')}
                  value={customer.fatherName}
                  revealLabel={t('customerProfileFieldReveal')}
                />
                <ProfileField
                  label={t('customerFieldGrandfatherName')}
                  value={customer.grandfatherName}
                  revealLabel={t('customerProfileFieldReveal')}
                />
                <ProfileField
                  label={t('customerFieldFamilyName')}
                  value={customer.familyName}
                  revealLabel={t('customerProfileFieldReveal')}
                />
              </>
              ) : null}
            </div>
          </Card>

          {revealTarget ? (
            <div style={repeatableRowStyle}>
              <label htmlFor="reveal-reason">
                {t('customerRevealJustificationLabel', { field: revealTarget })}
              </label>
              <input
                id="reveal-reason"
                value={revealReason}
                onChange={(e) => setRevealReason(e.target.value)}
                style={{ width: '100%', padding: '0.4rem', marginTop: '0.4rem' }}
              />
              <Button
                variant="secondary"
                size="sm"
                style={{ marginTop: 'var(--space-2)' }}
                onClick={() => void handleReveal(revealTarget)}
              >
                {t('customerRevealConfirmButton')}
              </Button>
              {revealError ? (
                <ErrorState title={revealError} />
              ) : null}
            </div>
          ) : null}

          {/* Correcting the three contact fields. Placed directly under the profile
            * it edits, and it reloads through the same `load` the page already uses,
            * because a correction changes the MASKED values shown above. */}
          <div style={{ marginTop: '1.25rem' }}>
            <CustomerContactCorrection
              customerId={customer.id}
              onCorrected={load}
            />
          </div>

          {/* Correcting the two SCREENING DISCRIMINATORS — the owner's narrow strike of her own
            * 2026-09-28 deferral (2026-10-28). A sibling control rather than two more fields on
            * the form above: the reason is mandatory, the fields are INDIVIDUAL-only, and saving
            * re-screens. It renders nothing at all on a corporate customer, which is why the
            * type is passed rather than the condition being written here — the component owns
            * that decision, and a second copy of it is a second answer. */}
          <div style={{ marginTop: '1.25rem' }}>
            <CustomerIdentifierCorrection
              customerId={customer.id}
              customerType={customer.customerType}
              onCorrected={load}
            />
          </div>

          {customer.customerType === 'CORPORATE' ? (
            <Card title={t('customerUbosHeading')}>
              {ubos.length === 0 ? <EmptyState title={t('customerUbosNone')} /> : null}
              {ubos.map((u) => (
                <div key={u.id} style={repeatableRowStyle}>
                  <strong>
                    <bdi>{u.fullName}</bdi>
                  </strong>
                  {u.ownershipPercent ? <span> — {u.ownershipPercent}%</span> : null}
                  {u.isPep ? <span> — {t('customerUboPep')}</span> : null}
                </div>
              ))}
            </Card>
          ) : null}

          <Card title={t('customerDocumentsHeading')}>
            {documents.length === 0 ? <EmptyState title={t('customerDocumentsNone')} /> : null}
            {documents.map((d) => (
              <div key={d.id} style={repeatableRowStyle}>
                <strong>{d.fileName}</strong> — {t(ENUM_LABEL.DocumentClassification[d.classification])}
              </div>
            ))}
          </Card>

          <Card title={t('customerNeedsAssessmentHeading')}>
            <p style={{ color: 'var(--ink-secondary)' }}>{t('customerNeedsAssessmentIntro')}</p>
            {canStartNeedsAssessment ? (
              <Button
                onClick={() =>
                  router.push(`/needs-assessments/new?customerId=${customer.id}`)
                }
              >
                {t('customerNeedsAssessmentStartButton')}
              </Button>
            ) : (
              <p style={{ color: 'var(--ink-secondary)' }}>{permissionRefusal(t, 'customerNeedsAssessmentRefusalAct', 'needs-assessment.create')}</p>
            )}
          </Card>

          <Card title={t('customerRiskSurveyHeading')}>
            <p style={{ color: 'var(--ink-secondary)' }}>{t('customerRiskSurveyIntro')}</p>
            {canOpenRiskSurvey ? (
              <Button
                onClick={() =>
                  router.push(`/risk-profiles?customerId=${customer.id}`)
                }
              >
                {t('customerRiskSurveyOpenButton')}
              </Button>
            ) : (
              <p style={{ color: 'var(--ink-secondary)' }}>{permissionRefusal(t, 'customerRiskSurveyRefusalAct', 'risk-profile.read')}</p>
            )}
          </Card>

          <Card title={t('customerInsuranceProgramHeading')}>
            <p style={{ color: 'var(--ink-secondary)' }}>{t('customerInsuranceProgramIntro')}</p>
            {canOpenInsuranceProgram ? (
              <Button
                onClick={() =>
                  router.push(`/insurance-programs?customerId=${customer.id}`)
                }
              >
                {t('customerInsuranceProgramOpenButton')}
              </Button>
            ) : (
              <p style={{ color: 'var(--ink-secondary)' }}>{permissionRefusal(t, 'customerInsuranceProgramRefusalAct', 'program.read')}</p>
            )}
          </Card>

          <Card title={t('customerCrossSellHeading')}>
            <p style={{ color: 'var(--ink-secondary)' }}>{t('customerCrossSellIntro')}</p>
            {canOpenCrossSell ? (
              <Button
                onClick={() =>
                  router.push(`/cross-sell?customerId=${customer.id}`)
                }
              >
                {t('customerCrossSellOpenButton')}
              </Button>
            ) : (
              <p style={{ color: 'var(--ink-secondary)' }}>{permissionRefusal(t, 'customerCrossSellRefusalAct', 'cross-sell.read')}</p>
            )}
          </Card>

          <Card title={t('customerUpSellHeading')}>
            <p style={{ color: 'var(--ink-secondary)' }}>{t('customerUpSellIntro')}</p>
            {canOpenUpSell ? (
              <Button
                onClick={() =>
                  router.push(`/up-sell?customerId=${customer.id}`)
                }
              >
                {t('customerUpSellOpenButton')}
              </Button>
            ) : (
              <p style={{ color: 'var(--ink-secondary)' }}>{permissionRefusal(t, 'customerUpSellRefusalAct', 'up-sell.read')}</p>
            )}
          </Card>

          <Card title={t('customerCrmHeading')}>
            <p style={{ color: 'var(--ink-secondary)' }}>{t('customerCrmIntro')}</p>
            {canOpenCrm ? (
              <Button
                onClick={() => router.push(`/crm?customerId=${customer.id}`)}
              >
                {t('customerCrmOpenButton')}
              </Button>
            ) : (
              <p style={{ color: 'var(--ink-secondary)' }}>{permissionRefusal(t, 'customerCrmRefusalAct', 'customer.360-view.read')}</p>
            )}
          </Card>
        </>
      ) : null}
    </main>
  );
}
