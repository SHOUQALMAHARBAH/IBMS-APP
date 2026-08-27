'use client';

import { useState } from 'react';
import {
  approveKyc,
  KYC_STATUS_LABEL,
  rejectKyc,
  runScreening,
  triggerEdd,
  type KycQueueRecord,
  type KycRecord,
} from '../../lib/kyc/kyc-api';
import { ApiError } from '../../lib/auth/api-client';
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

export function KycQueue({ items, onItemChanged }: KycQueueProps) {
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
      const message = err instanceof ApiError ? err.message : 'Action failed — try again.';
      setErrors((prev) => ({ ...prev, [id]: message }));
    } finally {
      setBusyId(null);
    }
  }

  if (items.length === 0) {
    return <p style={{ opacity: 0.6 }}>Nothing in the KYC queue right now.</p>;
  }

  return (
    <table style={queueTableStyle}>
      <thead>
        <tr>
          <th style={queueCellStyle}>Customer</th>
          <th style={queueCellStyle}>Status</th>
          <th style={queueCellStyle}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const isBusy = busyId === item.id;
          return (
            <tr key={item.id}>
              <td style={queueCellStyle}>
                <strong>{item.customer.legalName}</strong>
                <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>{item.customer.customerType}</div>
              </td>
              <td style={queueCellStyle}>
                <span style={badgeStyle(STATUS_TONE[item.status])}>{KYC_STATUS_LABEL[item.status]}</span>
                {item.isEdd ? (
                  <div style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>High-risk screening result</div>
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
                    Run screening
                  </button>
                ) : null}
                {item.status === 'SCREENING' && item.isEdd ? (
                  <button
                    type="button"
                    style={smallButtonStyle}
                    disabled={isBusy}
                    onClick={() => void run(item.id, () => triggerEdd(item.id))}
                  >
                    Enter enhanced due diligence
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
                      Approve
                    </button>
                    <input
                      placeholder="Rejection reason"
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
                      Reject
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
