'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  DISPOSAL_METHODS,
  closeDisposalBatch,
  confirmRetentionScheduleItem,
  createLegalHold,
  createRetentionScheduleItem,
  dpoApproveDisposalBatch,
  executeDisposalBatch,
  issueCertificateOfDestruction,
  listDisposalBatches,
  listLegalHolds,
  listRetentionSchedule,
  managerApproveDisposalBatch,
  nominateDisposalBatch,
  releaseLegalHold,
  reviewLegalHold,
  updateRetentionScheduleItem,
  type DisposalBatch,
  type LegalHold,
  type RetentionScheduleItem,
} from '../../../lib/pdpl/retention-disposal-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';
import { hasAnyPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';

const SCHEDULE_ROLES = [
  'retention-schedule.manage',
];
const LEGAL_HOLD_ROLES = [
  'legal-hold.manage',
];
const DISPOSE_NOMINATE_ROLES = [
  'retention.dispose.nominate',
];
const DISPOSE_APPROVE_ROLES = [
  'retention.dispose.approve',
];

const cell: CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'start',
  verticalAlign: 'top',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid #d1d5db' };
const sectionStyle: CSSProperties = { margin: '2rem 0' };


export default function RetentionDisposalPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();
  const canManageSchedule = hasAnyPermission(user, SCHEDULE_ROLES);
  const canManageHolds = hasAnyPermission(user, LEGAL_HOLD_ROLES);
  const canNominate = hasAnyPermission(user, DISPOSE_NOMINATE_ROLES);
  const canApprove = hasAnyPermission(user, DISPOSE_APPROVE_ROLES);

  const [schedule, setSchedule] = useState<RetentionScheduleItem[] | null>(null);
  const [holds, setHolds] = useState<LegalHold[] | null>(null);
  const [batches, setBatches] = useState<DisposalBatch[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [category, setCategory] = useState('');
  const [months, setMonths] = useState('');
  const [legalBasis, setLegalBasis] = useState('');
  const [editMonths, setEditMonths] = useState<Record<string, string>>({});

  const [holdScope, setHoldScope] = useState('');
  const [holdReason, setHoldReason] = useState('');
  const [holdCategoryId, setHoldCategoryId] = useState('');
  const [holdCustomerId, setHoldCustomerId] = useState('');
  const [holdInsuredPersonId, setHoldInsuredPersonId] = useState('');

  const [nominateCategoryId, setNominateCategoryId] = useState('');
  const [method, setMethod] = useState<string>(DISPOSAL_METHODS[0]);

  const load = useCallback(async () => {
    try {
      const [s, h, b] = await Promise.all([
        listRetentionSchedule(),
        listLegalHolds(),
        listDisposalBatches(),
      ]);
      setSchedule(s);
      setHolds(h);
      setBatches(b);
      setLoadError(null);
    } catch (err) {
      setSchedule(null);
      setHolds(null);
      setBatches(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? t('rdNoPermission')
          : err instanceof ApiError
            ? err.message
            : t('rdLoadError'),
      );
    }
  }, [t]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);
  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load, t]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : t('rdActionError'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitSchedule(ev: React.FormEvent) {
    ev.preventDefault();
    await run(async () => {
      await createRetentionScheduleItem({
        recordCategory: category.trim(),
        retentionPeriodMonths: Number(months),
        legalBasis: legalBasis.trim() || undefined,
      });
      setCategory('');
      setMonths('');
      setLegalBasis('');
    });
  }

  async function submitHold(ev: React.FormEvent) {
    ev.preventDefault();
    await run(async () => {
      await createLegalHold({
        scope: holdScope.trim(),
        reason: holdReason.trim(),
        retentionScheduleItemId: holdCategoryId.trim() || undefined,
        customerId: holdCustomerId.trim() || undefined,
        insuredPersonId: holdInsuredPersonId.trim() || undefined,
      });
      setHoldScope('');
      setHoldReason('');
      setHoldCategoryId('');
      setHoldCustomerId('');
      setHoldInsuredPersonId('');
    });
  }

  async function submitNominate(ev: React.FormEvent) {
    ev.preventDefault();
    await run(async () => {
      await nominateDisposalBatch(nominateCategoryId.trim() || undefined);
      setNominateCategoryId('');
    });
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('rdHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('rdIntro')}
      </p>

      {actionError ? (
        <p role="alert" style={errorStyle}>
          {actionError}
        </p>
      ) : null}
      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {/* --- Retention schedule --- */}
      <section style={sectionStyle}>
        <h2>{t('rdScheduleHeading')}</h2>
        {canManageSchedule ? (
          <form
            onSubmit={submitSchedule}
            style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', margin: '0.75rem 0' }}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {t('rdRecordCategoryLabel')}
              <input
                aria-label={t('rdRecordCategoryLabel')}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                required
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {t('rdRetentionMonthsLabel')}
              <input
                aria-label={t('rdRetentionMonthsLabel')}
                type="number"
                min={1}
                value={months}
                onChange={(e) => setMonths(e.target.value)}
                required
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {t('rdLegalBasisLabel')}
              <input
                aria-label={t('rdColLegalBasis')}
                value={legalBasis}
                onChange={(e) => setLegalBasis(e.target.value)}
              />
            </label>
            <button type="submit" disabled={busy}>
              {busy ? t('rdSavingButton') : t('rdAddCategoryButton')}
            </button>
          </form>
        ) : null}
        {schedule ? (
          schedule.length === 0 ? (
            <p style={{ color: 'var(--ink-secondary)' }}>{t('rdNoScheduleItems')}</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: '56rem' }}>
                <thead>
                  <tr>
                    <th style={head}>{t('rdColCategory')}</th>
                    <th style={head}>{t('rdColMonths')}</th>
                    <th style={head}>{t('rdColLegalBasis')}</th>
                    <th style={head}>{t('rdColConfirmed')}</th>
                    <th style={head}>{t('rdColAction')}</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.map((s) => (
                    <tr key={s.id}>
                      <td style={cell}>{s.recordCategory}</td>
                      <td style={cell}>
                        {canManageSchedule && !s.isConfirmed ? (
                          <input
                            aria-label={`Months for ${s.recordCategory}`}
                            style={{ width: '5rem' }}
                            value={editMonths[s.id] ?? String(s.retentionPeriodMonths)}
                            onChange={(e) =>
                              setEditMonths((m) => ({ ...m, [s.id]: e.target.value }))
                            }
                          />
                        ) : (
                          s.retentionPeriodMonths
                        )}
                      </td>
                      <td style={cell}>{s.legalBasis ?? '—'}</td>
                      <td style={cell}>{s.isConfirmed ? 'Yes' : t('rdDraftPending')}</td>
                      <td style={cell}>
                        <div style={{ display: 'flex', gap: '0.35rem' }}>
                          {canManageSchedule && !s.isConfirmed && editMonths[s.id] ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void run(() =>
                                  updateRetentionScheduleItem(s.id, {
                                    retentionPeriodMonths: Number(editMonths[s.id]),
                                  }),
                                )
                              }
                            >
                              {t('rdSaveButton')}
                            </button>
                          ) : null}
                          {canManageSchedule && !s.isConfirmed ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void run(() => confirmRetentionScheduleItem(s.id))
                              }
                            >
                              {t('rdConfirmButton')}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : loadError ? null : (
          <p>{t('rdLoading')}</p>
        )}
      </section>

      {/* --- Legal holds --- */}
      <section style={sectionStyle}>
        <h2>{t('rdHoldsHeading')}</h2>
        {canManageHolds ? (
          <form
            onSubmit={submitHold}
            style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', margin: '0.75rem 0' }}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {t('rdScopeFieldLabel')}
              <input
                aria-label={t('rdScopeAria')}
                value={holdScope}
                onChange={(e) => setHoldScope(e.target.value)}
                required
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {t('rdReasonLabel')}
              <input
                aria-label={t('rdReasonAria')}
                value={holdReason}
                onChange={(e) => setHoldReason(e.target.value)}
                required
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {t('rdHoldCategoryIdLabel')}
              <input
                aria-label={t('rdHoldCategoryIdAria')}
                value={holdCategoryId}
                onChange={(e) => setHoldCategoryId(e.target.value)}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {t('rdHoldCustomerIdLabel')}
              <input
                aria-label={t('rdHoldCustomerIdAria')}
                value={holdCustomerId}
                onChange={(e) => setHoldCustomerId(e.target.value)}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {t('rdHoldInsuredPersonIdLabel')}
              <input
                aria-label={t('rdHoldInsuredPersonIdAria')}
                value={holdInsuredPersonId}
                onChange={(e) => setHoldInsuredPersonId(e.target.value)}
              />
            </label>
            <button type="submit" disabled={busy}>
              {busy ? t('commonSaving') : t('rdPlaceHoldButton')}
            </button>
          </form>
        ) : null}
        {holds ? (
          holds.length === 0 ? (
            <p style={{ color: 'var(--ink-secondary)' }}>{t('rdNoHolds')}</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: '56rem' }}>
                <thead>
                  <tr>
                    <th style={head}>{t('rdScopeLabel')}</th>
                    <th style={head}>{t('rdColCategory')}</th>
                    <th style={head}>{t('rdColSubject')}</th>
                    <th style={head}>{t('rdColNextReviewDue')}</th>
                    <th style={head}>{t('rdColStatus')}</th>
                    <th style={head}>{t('rdColAction')}</th>
                  </tr>
                </thead>
                <tbody>
                  {holds.map((h) => (
                    <tr key={h.id}>
                      <td style={cell}>{h.scope}</td>
                      <td style={cell}>
                        {h.retentionScheduleItemId ? h.retentionScheduleItemId.slice(0, 8) + '…' : '—'}
                      </td>
                      <td style={cell}>
                        {h.customerId
                          ? `Customer ${h.customerId.slice(0, 8)}…`
                          : h.insuredPersonId
                            ? `Insured person ${h.insuredPersonId.slice(0, 8)}…`
                            : '—'}
                      </td>
                      <td style={cell}>{h.nextReviewDueAt.slice(0, 10)}</td>
                      <td style={cell}>{h.isActive ? 'Active' : t('rdReleased')}</td>
                      <td style={cell}>
                        {canManageHolds && h.isActive ? (
                          <div style={{ display: 'flex', gap: '0.35rem' }}>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void run(() => reviewLegalHold(h.id))}
                            >
                              {t('rdRecordReviewButton')}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void run(() => releaseLegalHold(h.id))}
                            >
                              {t('rdReleaseButton')}
                            </button>
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : loadError ? null : (
          <p>{t('rdLoading')}</p>
        )}
      </section>

      {/* --- Disposal batches --- */}
      <section style={sectionStyle}>
        <h2>{t('rdBatchesHeading')}</h2>
        {canNominate ? (
          <form
            onSubmit={submitNominate}
            style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', margin: '0.75rem 0' }}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {t('rdBatchCategoryIdFieldLabel')}
              <input
                aria-label={t('rdBatchCategoryIdLabel')}
                value={nominateCategoryId}
                onChange={(e) => setNominateCategoryId(e.target.value)}
              />
            </label>
            <button type="submit" disabled={busy}>
              {busy ? t('commonSaving') : t('rdNominateBatchButton')}
            </button>
          </form>
        ) : null}
        {batches ? (
          batches.length === 0 ? (
            <p style={{ color: 'var(--ink-secondary)' }}>{t('rdNoBatches')}</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: '64rem' }}>
                <thead>
                  <tr>
                    <th style={head}>{t('rdColCategory')}</th>
                    <th style={head}>{t('rdColStatus')}</th>
                    <th style={head}>{t('rdColSlaDue')}</th>
                    <th style={head}>{t('rdColCertificate')}</th>
                    <th style={head}>{t('rdColAction')}</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => (
                    <tr key={b.id}>
                      <td style={cell}>
                        {b.retentionScheduleItemId ? b.retentionScheduleItemId.slice(0, 8) + '…' : '—'}
                      </td>
                      <td style={cell}>{b.status}</td>
                      <td style={cell}>{b.slaDueAt ? b.slaDueAt.slice(0, 10) : '—'}</td>
                      <td style={cell}>{b.hasCertificateOfDestruction ? t('rdAttached') : '—'}</td>
                      <td style={cell}>
                        {b.status === 'CLOSED' ? (
                          '—'
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', minWidth: '18rem' }}>
                            {canNominate && b.status === 'NOMINATED' ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void run(() => managerApproveDisposalBatch(b.id))}
                              >
                                {t('rdManagerApproveButton')}
                              </button>
                            ) : null}
                            {canApprove && b.status === 'MANAGER_APPROVED' ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void run(() => dpoApproveDisposalBatch(b.id))}
                              >
                                {t('rdDpoApproveButton')}
                              </button>
                            ) : null}
                            {canApprove && b.status === 'DPO_APPROVED' ? (
                              <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                                <select
                                  aria-label={`Destruction method for ${b.id}`}
                                  value={method}
                                  onChange={(e) => setMethod(e.target.value)}
                                >
                                  {DISPOSAL_METHODS.map((m) => (
                                    <option key={m} value={m}>
                                      {m}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void run(() => executeDisposalBatch(b.id, method))}
                                >
                                  {t('rdRecordExecutionButton')}
                                </button>
                              </div>
                            ) : null}
                            {canApprove && b.status === 'EXECUTED' && !b.hasCertificateOfDestruction ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void run(() => issueCertificateOfDestruction(b.id))}
                              >
                                {t('rdIssueCertificateButton')}
                              </button>
                            ) : null}
                            {canApprove && b.status === 'EXECUTED' && b.hasCertificateOfDestruction ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void run(() => closeDisposalBatch(b.id))}
                              >
                                {t('rdCloseButton')}
                              </button>
                            ) : null}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : loadError ? null : (
          <p>{t('rdLoading')}</p>
        )}
      </section>
    </main>
  );
}
