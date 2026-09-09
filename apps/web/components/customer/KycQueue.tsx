'use client';

import { useState } from 'react';
import {
  approveKyc,
  rejectKyc,
  runScreening,
  triggerEdd,
  type KycQueueRecord,
  type KycRecord,
  type KycStatus,
} from '../../lib/kyc/kyc-api';
import { ApiError } from '../../lib/auth/api-client';
import { useLanguage } from '../../lib/i18n/language-context';
import type { TranslationKey } from '../../lib/i18n/translations';
import { errorStyle } from '../auth/auth-form.styles';
import { smallButtonStyle } from '../lead/lead.styles';
import { badgeStyle, queueCellStyle, queueTableStyle } from './customer.styles';

interface KycQueueProps {
  items: KycQueueRecord[];
  onItemChanged: (updated: KycRecord) => void;
}

const STATUS_TONE: Record<KycRecord['status'], 'neutral' | 'warn' | 'good' | 'bad'> = {
  DRAFT: 'neutral',
  SUBMITTED: 'neutral',
  SCREENING: 'warn',
  EDD: 'warn',
  COMPLIANCE_REVIEW: 'warn',
  APPROVED: 'good',
  REJECTED: 'bad',
  PERIODIC_REVIEW_DUE: 'warn',
};

const STATUS_LABEL_KEY: Record<KycStatus, TranslationKey> = {
  DRAFT: 'kycStatusDraft',
  SUBMITTED: 'kycStatusSubmitted',
  SCREENING: 'kycStatusScreening',
  EDD: 'kycStatusEdd',
  COMPLIANCE_REVIEW: 'kycStatusComplianceReview',
  APPROVED: 'kycStatusApproved',
  REJECTED: 'kycStatusRejected',
  PERIODIC_REVIEW_DUE: 'kycStatusPeriodicReviewDue',
};

const TYPE_LABEL_KEY: Record<'INDIVIDUAL' | 'CORPORATE', TranslationKey> = {
  INDIVIDUAL: 'customerTypeIndividual',
  CORPORATE: 'customerTypeCorporate',
};

export function KycQueue({ items, onItemChanged }: KycQueueProps) {
  const { t } = useLanguage();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});

  async function run(id: string, action: () => Promise<KycRecord>) {
    setBusyId(id);
    setErrors((prev) => ({ ...prev, [id]: '' }));
    try {
      const updated = await action();
      onItemChanged(updated);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('kycQueueActionFailed');
      setErrors((prev) => ({ ...prev, [id]: message }));
    } finally {
      setBusyId(null);
    }
  }

  if (items.length === 0) {
    return <p style={{ opacity: 0.6 }}>{t('kycQueueEmpty')}</p>;
  }

  return (
    <table style={queueTableStyle}>
      <thead>
        <tr>
          <th style={queueCellStyle}>{t('kycQueueColumnCustomer')}</th>
          <th style={queueCellStyle}>{t('commonStatus')}</th>
          <th style={queueCellStyle}>{t('commonActions')}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const isBusy = busyId === item.id;
          return (
            <tr key={item.id}>
              <td style={queueCellStyle}>
                <strong>
                  <bdi>{item.customer.legalName}</bdi>
                </strong>
                <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>
                  {t(TYPE_LABEL_KEY[item.customer.customerType])}
                </div>
              </td>
              <td style={queueCellStyle}>
                <span style={badgeStyle(STATUS_TONE[item.status])}>{t(STATUS_LABEL_KEY[item.status])}</span>
                {item.isEdd ? (
                  <div style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>{t('kycQueueHighRiskResult')}</div>
                ) : null}
              </td>
              <td style={queueCellStyle}>
                {item.status === 'SUBMITTED' ? (
                  <button
                    type="button"
                    style={smallButtonStyle}
                    disabled={isBusy}
                    onClick={() => void run(item.id, () => runScreening(item.id))}
                  >
                    {t('kycQueueRunScreeningButton')}
                  </button>
                ) : null}
                {item.status === 'SCREENING' && item.isEdd ? (
                  <button
                    type="button"
                    style={smallButtonStyle}
                    disabled={isBusy}
                    onClick={() => void run(item.id, () => triggerEdd(item.id))}
                  >
                    {t('kycQueueEnterEddButton')}
                  </button>
                ) : null}
                {(item.status === 'SCREENING' && !item.isEdd) || item.status === 'EDD' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <button
                      type="button"
                      style={smallButtonStyle}
                      disabled={isBusy}
                      onClick={() => void run(item.id, () => approveKyc(item.id))}
                    >
                      {t('kycQueueApproveButton')}
                    </button>
                    <input
                      placeholder={t('kycQueueRejectReasonPlaceholder')}
                      value={rejectReason[item.id] ?? ''}
                      onChange={(e) => setRejectReason((prev) => ({ ...prev, [item.id]: e.target.value }))}
                      style={{ fontSize: '0.8rem', padding: '0.25rem' }}
                    />
                    <button
                      type="button"
                      style={smallButtonStyle}
                      disabled={isBusy || !rejectReason[item.id]?.trim()}
                      onClick={() => void run(item.id, () => rejectKyc(item.id, rejectReason[item.id]))}
                    >
                      {t('kycQueueRejectButton')}
                    </button>
                  </div>
                ) : null}
                {errors[item.id] ? (
                  <p role="alert" style={{ ...errorStyle, fontSize: '0.75rem', marginTop: '0.4rem' }}>
                    {errors[item.id]}
                  </p>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
