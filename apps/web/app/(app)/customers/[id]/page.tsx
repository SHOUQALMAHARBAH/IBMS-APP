'use client';

import { useCallback, useEffect, useState } from 'react';
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
import { ApiError } from '../../../../lib/auth/api-client';
import { errorStyle } from '../../../../components/auth/auth-form.styles';
import { pageStyle, smallButtonStyle } from '../../../../components/lead/lead.styles';
import {
  profileFieldLabelStyle,
  profileFieldValueStyle,
  profileGridStyle,
} from '../../../../components/prospect/prospect.styles';
import { repeatableRowStyle } from '../../../../components/customer/customer.styles';
import { ConsentCaptureWidget } from '../../../../components/pdpl/ConsentCaptureWidget';
import { PrivacyNoticeDisplay, NOTICE_READ_ROLES } from '../../../../components/pdpl/PrivacyNoticeDisplay';
import { useLanguage } from '../../../../lib/i18n/language-context';
import type { TranslationKey } from '../../../../lib/i18n/translations';
import type { CustomerStatus, CustomerType } from '../../../../lib/customer/customer-api';

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
}: {
  label: string;
  value: string | null | undefined;
  revealed?: string;
  onReveal?: () => void;
  revealLabel: string;
}) {
  return (
    <div>
      <div style={profileFieldLabelStyle}>{label}</div>
      <div style={profileFieldValueStyle}>
        <bdi>{revealed ?? value ?? '—'}</bdi>
        {onReveal && !revealed ? (
          <button
            type="button"
            style={{ ...smallButtonStyle, marginInlineStart: '0.5rem' }}
            onClick={onReveal}
          >
            {revealLabel}
          </button>
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
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load]);

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
  const canStartNeedsAssessment = user.roles.includes('SALES_RELATIONSHIP_OFFICER');
  const canOpenRiskSurvey = user.roles.some((role) =>
    ['SALES_RELATIONSHIP_OFFICER', 'PLACEMENT_TECHNICAL_OFFICER'].includes(role),
  );
  const canOpenInsuranceProgram = user.roles.some((role) =>
    [
      'SALES_RELATIONSHIP_OFFICER',
      'PLACEMENT_TECHNICAL_OFFICER',
      'BRANCH_DEPARTMENT_MANAGER',
      'EXECUTIVE_MANAGEMENT',
    ].includes(role),
  );
  const canOpenCrossSell = user.roles.some((role) =>
    [
      'SALES_RELATIONSHIP_OFFICER',
      'BRANCH_DEPARTMENT_MANAGER',
      'EXECUTIVE_MANAGEMENT',
    ].includes(role),
  );
  const canOpenUpSell = canOpenCrossSell;
  const canOpenCrm = user.roles.some((role) =>
    [
      'SALES_RELATIONSHIP_OFFICER',
      'BRANCH_DEPARTMENT_MANAGER',
      'EXECUTIVE_MANAGEMENT',
      'COMPLIANCE_OFFICER',
      'EXTERNAL_AUDITOR',
    ].includes(role),
  );

  return (
    <main style={pageStyle}>
      <button type="button" onClick={() => router.push('/customers')} style={{ cursor: 'pointer' }}>
        {t('customerProfileBackButton')}
      </button>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {customer ? (
        <>
          <h1>
            <bdi>{customer.legalName}</bdi>
          </h1>
          <p style={{ opacity: 0.8 }}>
            {t('customerProfileTypeStatusLine', {
              type: t(TYPE_LABEL_KEY[customer.customerType]),
              status: t(STATUS_LABEL_KEY[customer.status]),
            })}
          </p>

          <ConsentCaptureWidget
            customerId={customer.id}
            purpose="KYC_AML"
            label={t('customerConsentLabel')}
            defaultConsentTextVersion="kyc-notice-v1"
          />
          <PrivacyNoticeDisplay
            touchpoint="onboarding_kyc"
            canRead={!!user && user.roles.some((r) => NOTICE_READ_ROLES.includes(r))}
          />

          <div style={profileGridStyle}>
            <ProfileField
              label={t('customerFieldNationalId')}
              value={customer.nationalId}
              revealed={revealed.nationalId}
              onReveal={
                customer.nationalId ? () => setRevealTarget('nationalId') : undefined
              }
              revealLabel={t('customerProfileFieldReveal')}
            />
            <ProfileField
              label={t('customerFieldContactPhone')}
              value={customer.contactPhone}
              revealed={revealed.contactPhone}
              onReveal={() => setRevealTarget('contactPhone')}
              revealLabel={t('customerProfileFieldReveal')}
            />
            <ProfileField
              label={t('customerFieldContactEmail')}
              value={customer.contactEmail}
              revealed={revealed.contactEmail}
              onReveal={() => setRevealTarget('contactEmail')}
              revealLabel={t('customerProfileFieldReveal')}
            />
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
              <button
                type="button"
                style={{ ...smallButtonStyle, marginTop: '0.5rem' }}
                onClick={() => void handleReveal(revealTarget)}
              >
                {t('customerRevealConfirmButton')}
              </button>
              {revealError ? (
                <p role="alert" style={{ ...errorStyle, marginTop: '0.4rem' }}>
                  {revealError}
                </p>
              ) : null}
            </div>
          ) : null}

          {customer.customerType === 'CORPORATE' ? (
            <section style={{ marginTop: '2rem' }}>
              <h2>{t('customerUbosHeading')}</h2>
              {ubos.length === 0 ? <p style={{ opacity: 0.6 }}>{t('customerUbosNone')}</p> : null}
              {ubos.map((u) => (
                <div key={u.id} style={repeatableRowStyle}>
                  <strong>
                    <bdi>{u.fullName}</bdi>
                  </strong>
                  {u.ownershipPercent ? <span> — {u.ownershipPercent}%</span> : null}
                  {u.isPep ? <span> — {t('customerUboPep')}</span> : null}
                </div>
              ))}
            </section>
          ) : null}

          <section style={{ marginTop: '2rem' }}>
            <h2>{t('customerDocumentsHeading')}</h2>
            {documents.length === 0 ? <p style={{ opacity: 0.6 }}>{t('customerDocumentsNone')}</p> : null}
            {documents.map((d) => (
              <div key={d.id} style={repeatableRowStyle}>
                <strong>{d.fileName}</strong> — {d.classification}
              </div>
            ))}
          </section>

          <section style={{ marginTop: '2rem' }}>
            <h2>{t('customerNeedsAssessmentHeading')}</h2>
            <p style={{ opacity: 0.8 }}>{t('customerNeedsAssessmentIntro')}</p>
            {canStartNeedsAssessment ? (
              <button
                type="button"
                style={{ cursor: 'pointer' }}
                onClick={() =>
                  router.push(`/needs-assessments/new?customerId=${customer.id}`)
                }
              >
                {t('customerNeedsAssessmentStartButton')}
              </button>
            ) : (
              <p style={{ opacity: 0.6 }}>{t('customerNeedsAssessmentNoPermission')}</p>
            )}
          </section>

          <section style={{ marginTop: '2rem' }}>
            <h2>{t('customerRiskSurveyHeading')}</h2>
            <p style={{ opacity: 0.8 }}>{t('customerRiskSurveyIntro')}</p>
            {canOpenRiskSurvey ? (
              <button
                type="button"
                style={{ cursor: 'pointer' }}
                onClick={() =>
                  router.push(`/risk-profiles?customerId=${customer.id}`)
                }
              >
                {t('customerRiskSurveyOpenButton')}
              </button>
            ) : (
              <p style={{ opacity: 0.6 }}>{t('customerRiskSurveyNoPermission')}</p>
            )}
          </section>

          <section style={{ marginTop: '2rem' }}>
            <h2>{t('customerInsuranceProgramHeading')}</h2>
            <p style={{ opacity: 0.8 }}>{t('customerInsuranceProgramIntro')}</p>
            {canOpenInsuranceProgram ? (
              <button
                type="button"
                style={{ cursor: 'pointer' }}
                onClick={() =>
                  router.push(`/insurance-programs?customerId=${customer.id}`)
                }
              >
                {t('customerInsuranceProgramOpenButton')}
              </button>
            ) : (
              <p style={{ opacity: 0.6 }}>{t('customerInsuranceProgramNoPermission')}</p>
            )}
          </section>

          <section style={{ marginTop: '2rem' }}>
            <h2>{t('customerCrossSellHeading')}</h2>
            <p style={{ opacity: 0.8 }}>{t('customerCrossSellIntro')}</p>
            {canOpenCrossSell ? (
              <button
                type="button"
                style={{ cursor: 'pointer' }}
                onClick={() =>
                  router.push(`/cross-sell?customerId=${customer.id}`)
                }
              >
                {t('customerCrossSellOpenButton')}
              </button>
            ) : (
              <p style={{ opacity: 0.6 }}>{t('customerCrossSellNoPermission')}</p>
            )}
          </section>

          <section style={{ marginTop: '2rem' }}>
            <h2>{t('customerUpSellHeading')}</h2>
            <p style={{ opacity: 0.8 }}>{t('customerUpSellIntro')}</p>
            {canOpenUpSell ? (
              <button
                type="button"
                style={{ cursor: 'pointer' }}
                onClick={() =>
                  router.push(`/up-sell?customerId=${customer.id}`)
                }
              >
                {t('customerUpSellOpenButton')}
              </button>
            ) : (
              <p style={{ opacity: 0.6 }}>{t('customerUpSellNoPermission')}</p>
            )}
          </section>

          <section style={{ marginTop: '2rem' }}>
            <h2>{t('customerCrmHeading')}</h2>
            <p style={{ opacity: 0.8 }}>{t('customerCrmIntro')}</p>
            {canOpenCrm ? (
              <button
                type="button"
                style={{ cursor: 'pointer' }}
                onClick={() => router.push(`/crm?customerId=${customer.id}`)}
              >
                {t('customerCrmOpenButton')}
              </button>
            ) : (
              <p style={{ opacity: 0.6 }}>{t('customerCrmNoPermission')}</p>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
