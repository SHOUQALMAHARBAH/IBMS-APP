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

const SCHEDULE_ROLES = ['COMPLIANCE_OFFICER', 'DATA_PROTECTION_OFFICER'];
const LEGAL_HOLD_ROLES = ['DATA_PROTECTION_OFFICER'];
const DISPOSE_NOMINATE_ROLES = ['BRANCH_DEPARTMENT_MANAGER'];
const DISPOSE_APPROVE_ROLES = ['DATA_PROTECTION_OFFICER'];

const cell: CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'left',
  verticalAlign: 'top',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid #d1d5db' };
const sectionStyle: CSSProperties = { margin: '2rem 0' };

function hasAny(roles: string[] | undefined, allowed: string[]): boolean {
  return !!roles && roles.some((r) => allowed.includes(r));
}

export default function RetentionDisposalPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const canManageSchedule = hasAny(user?.roles, SCHEDULE_ROLES);
  const canManageHolds = hasAny(user?.roles, LEGAL_HOLD_ROLES);
  const canNominate = hasAny(user?.roles, DISPOSE_NOMINATE_ROLES);
  const canApprove = hasAny(user?.roles, DISPOSE_APPROVE_ROLES);

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
        err instanceof ApiError
          ? err.message
          : 'Could not load the retention/disposal register — try again.',
      );
    }
  }, []);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);
  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : 'That action failed — try again.',
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
      <h1>Retention &amp; Disposal</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        The retention-period table per record category (pending Legal
        Counsel confirmation), Legal Holds that exclude a category from
        routine disposal, and the dual-control disposal workflow (Department
        Manager nominates, DPO approves, execution attested, a Certificate
        of Destruction required before closure — 30-day execution SLA).
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
        <h2>Retention schedule</h2>
        {canManageSchedule ? (
          <form
            onSubmit={submitSchedule}
            style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', margin: '0.75rem 0' }}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              Record category
              <input
                aria-label="Record category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                required
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              Retention period (months)
              <input
                aria-label="Retention period (months)"
                type="number"
                min={1}
                value={months}
                onChange={(e) => setMonths(e.target.value)}
                required
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              Legal basis (optional)
              <input
                aria-label="Legal basis"
                value={legalBasis}
                onChange={(e) => setLegalBasis(e.target.value)}
              />
            </label>
            <button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Add category'}
            </button>
          </form>
        ) : null}
        {schedule ? (
          schedule.length === 0 ? (
            <p style={{ opacity: 0.6 }}>No retention-schedule items yet.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: '56rem' }}>
                <thead>
                  <tr>
                    <th style={head}>Category</th>
                    <th style={head}>Months</th>
                    <th style={head}>Legal basis</th>
                    <th style={head}>Confirmed</th>
                    <th style={head}>Action</th>
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
                      <td style={cell}>{s.isConfirmed ? 'Yes' : 'DRAFT — pending'}</td>
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
                              Save
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
                              Confirm
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
          <p>Loading&hellip;</p>
        )}
      </section>

      {/* --- Legal holds --- */}
      <section style={sectionStyle}>
        <h2>Legal holds</h2>
        {canManageHolds ? (
          <form
            onSubmit={submitHold}
            style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', margin: '0.75rem 0' }}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              Scope
              <input
                aria-label="Legal hold scope"
                value={holdScope}
                onChange={(e) => setHoldScope(e.target.value)}
                required
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              Reason
              <input
                aria-label="Legal hold reason"
                value={holdReason}
                onChange={(e) => setHoldReason(e.target.value)}
                required
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              Record category ID (optional)
              <input
                aria-label="Legal hold record category ID"
                value={holdCategoryId}
                onChange={(e) => setHoldCategoryId(e.target.value)}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              Customer ID (optional)
              <input
                aria-label="Legal hold customer ID"
                value={holdCustomerId}
                onChange={(e) => setHoldCustomerId(e.target.value)}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              Insured person ID (optional)
              <input
                aria-label="Legal hold insured person ID"
                value={holdInsuredPersonId}
                onChange={(e) => setHoldInsuredPersonId(e.target.value)}
              />
            </label>
            <button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Place hold'}
            </button>
          </form>
        ) : null}
        {holds ? (
          holds.length === 0 ? (
            <p style={{ opacity: 0.6 }}>No Legal Holds.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: '56rem' }}>
                <thead>
                  <tr>
                    <th style={head}>Scope</th>
                    <th style={head}>Category</th>
                    <th style={head}>Subject</th>
                    <th style={head}>Next review due</th>
                    <th style={head}>Status</th>
                    <th style={head}>Action</th>
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
                      <td style={cell}>{h.isActive ? 'Active' : 'Released'}</td>
                      <td style={cell}>
                        {canManageHolds && h.isActive ? (
                          <div style={{ display: 'flex', gap: '0.35rem' }}>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void run(() => reviewLegalHold(h.id))}
                            >
                              Record review
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void run(() => releaseLegalHold(h.id))}
                            >
                              Release
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
          <p>Loading&hellip;</p>
        )}
      </section>

      {/* --- Disposal batches --- */}
      <section style={sectionStyle}>
        <h2>Disposal batches</h2>
        {canNominate ? (
          <form
            onSubmit={submitNominate}
            style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', margin: '0.75rem 0' }}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              Record category ID (optional)
              <input
                aria-label="Disposal batch record category ID"
                value={nominateCategoryId}
                onChange={(e) => setNominateCategoryId(e.target.value)}
              />
            </label>
            <button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Nominate batch'}
            </button>
          </form>
        ) : null}
        {batches ? (
          batches.length === 0 ? (
            <p style={{ opacity: 0.6 }}>No disposal batches.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: '64rem' }}>
                <thead>
                  <tr>
                    <th style={head}>Category</th>
                    <th style={head}>Status</th>
                    <th style={head}>SLA due</th>
                    <th style={head}>Certificate</th>
                    <th style={head}>Action</th>
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
                      <td style={cell}>{b.hasCertificateOfDestruction ? 'Attached' : '—'}</td>
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
                                Manager-approve
                              </button>
                            ) : null}
                            {canApprove && b.status === 'MANAGER_APPROVED' ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void run(() => dpoApproveDisposalBatch(b.id))}
                              >
                                DPO-approve
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
                                  Record execution
                                </button>
                              </div>
                            ) : null}
                            {canApprove && b.status === 'EXECUTED' && !b.hasCertificateOfDestruction ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void run(() => issueCertificateOfDestruction(b.id))}
                              >
                                Issue certificate
                              </button>
                            ) : null}
                            {canApprove && b.status === 'EXECUTED' && b.hasCertificateOfDestruction ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void run(() => closeDisposalBatch(b.id))}
                              >
                                Close
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
          <p>Loading&hellip;</p>
        )}
      </section>
    </main>
  );
}
