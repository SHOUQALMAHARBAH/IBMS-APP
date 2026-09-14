'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  addComplaintAction,
  assignComplaint,
  closeComplaint,
  COMPLAINT_CATEGORIES,
  createComplaint,
  downloadComplaintAcknowledgement,
  escalateComplaint,
  listComplaints,
  resolveComplaint,
  startComplaint,
  type Complaint,
} from '../../../lib/customer-service/complaint-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';
import { hasAnyPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';
import type { TranslationKey } from '../../../lib/i18n/translations';

// A permission code, like the two below it — NOT the role list this used to
// hold. §10.4 converted `ESCALATE_ROLES`/`CLOSE_ROLES` and missed this one, so
// role NAMES were being compared against permission CODES: `hasAnyPermission`
// could never match, and the log form was hidden from everybody. `tsc` cannot
// catch it because both sides are `string[]`.
//
// `complaint.log` is seeded to exactly the five roles that were listed here
// (Sales, Claims, Finance, Compliance, Branch/Department Manager), so this
// restores the intended behaviour rather than changing who may log a complaint.
const LOG_PERMISSIONS = ['complaint.log'];
const ESCALATE_ROLES = [
  'complaint.escalate',
];
const CLOSE_ROLES = [
  'complaint.close',
];

const cell: CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'start',
  verticalAlign: 'top',
};
const head: CSSProperties = {
  ...cell,
  fontWeight: 600,
  borderBottom: '2px solid #d1d5db',
};

/** ComplaintStatus -> label key. Typed against the union so a new status is
 * a compile error rather than a raw token on screen. */
const STATUS_LABEL_KEY: Record<Complaint['status'], TranslationKey> = {
  LOGGED: 'complaintsStatusLogged',
  ASSIGNED: 'complaintsStatusAssigned',
  IN_PROGRESS: 'complaintsStatusInProgress',
  ESCALATED: 'complaintsStatusEscalated',
  RESOLVED: 'complaintsStatusResolved',
  CLOSED: 'complaintsStatusClosed',
};

function slaLabel(
  c: Complaint,
  t: (k: TranslationKey, p?: Record<string, string | number>) => string,
): string {
  if (!c.sla) return t('complaintsSlaNone');
  if (c.sla.resolvedAt) return t('complaintsSlaResolved');
  const date = c.sla.dueAt.slice(0, 10);
  return c.sla.breached
    ? t('complaintsSlaBreached', { date })
    : t('complaintsSlaDue', { date });
}


export default function ComplaintsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();
  const canLog = hasAnyPermission(user, LOG_PERMISSIONS);
  const canEscalate = hasAnyPermission(user, ESCALATE_ROLES);
  const canClose = hasAnyPermission(user, CLOSE_ROLES);

  const [rows, setRows] = useState<Complaint[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [customerId, setCustomerId] = useState('');
  const [issue, setIssue] = useState('');
  const [category, setCategory] = useState('');
  const [claimId, setClaimId] = useState('');
  const [text, setText] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setRows(await listComplaints());
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? t('complaintsNoPermission')
          : err instanceof ApiError
            ? err.message
            : t('complaintsLoadError'),
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

  // Part F item #7 — the customer's own languagePreference decides the
  // document's language server-side; no picker here for a first pass
  // (DUAL is reachable via the api directly, e.g. for a front-desk
  // handout in both languages, but this list view keeps one button).
  async function downloadAcknowledgement(id: string) {
    setActionError(null);
    try {
      const blob = await downloadComplaintAcknowledgement(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `complaint-acknowledgement-${id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.message
          : t('complaintsAckError'),
      );
    }
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : t('complaintsActionError'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    await run(async () => {
      await createComplaint({
        customerId: customerId.trim(),
        issue: issue.trim(),
        ...(category ? { category } : {}),
        ...(claimId.trim() ? { claimId: claimId.trim() } : {}),
      });
      setCustomerId('');
      setIssue('');
      setCategory('');
      setClaimId('');
    });
  }

  const val = (id: string) => (text[id] ?? '').trim();
  const setVal = (id: string, v: string) =>
    setText((t) => ({ ...t, [id]: v }));

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('complaintsHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('complaintsIntro')}
      </p>

      {canLog ? (
        <form
          onSubmit={submit}
          style={{ margin: '1rem 0', display: 'grid', gap: '0.4rem', maxWidth: '32rem' }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            {t('complaintsCustomerIdLabel')}
            <input
              aria-label={t('complaintsCustomerIdLabel')}
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              required
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            {t('complaintsIssueLabel')}
            <textarea
              aria-label={t('complaintsIssueLabel')}
              dir="auto"
              value={issue}
              onChange={(e) => setIssue(e.target.value)}
              required
              rows={2}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            {t('complaintsCategoryLabel')}
            <select
              aria-label={t('complaintsCategoryAria')}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">—</option>
              {COMPLAINT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            {t('complaintsClaimIdLabel')}
            <input
              aria-label={t('complaintsClaimIdLabel')}
              value={claimId}
              onChange={(e) => setClaimId(e.target.value)}
            />
          </label>
          <button type="submit" disabled={busy} style={{ marginTop: '0.3rem' }}>
            {busy ? t('complaintsSavingButton') : t('complaintsLogButton')}
          </button>
        </form>
      ) : null}

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

      {rows ? (
        rows.length === 0 ? (
          <p style={{ opacity: 0.6 }}>{t('complaintsNone')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '52rem' }}>
              <thead>
                <tr>
                  <th style={head}>{t('complaintsColCustomer')}</th>
                  <th style={head}>{t('complaintsColIssue')}</th>
                  <th style={head}>{t('complaintsColStatus')}</th>
                  <th style={head}>{t('complaintsColSla')}</th>
                  <th style={head}>{t('complaintsColEscalations')}</th>
                  <th style={head}>{t('complaintsColAction')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td style={cell}>{c.customerId.slice(0, 8)}…</td>
                    <td style={cell}>
                      <bdi>{c.issue}</bdi>
                    </td>
                    <td style={cell}>{t(STATUS_LABEL_KEY[c.status])}</td>
                    <td style={cell}>{slaLabel(c, t)}</td>
                    <td style={cell}>{c.escalations.length || '—'}</td>
                    <td style={cell}>
                      {canLog ? (
                        <button
                          type="button"
                          onClick={() => void downloadAcknowledgement(c.id)}
                          style={{ marginBottom: '0.4rem' }}
                        >
                          {t('complaintsDownloadAckButton')}
                        </button>
                      ) : null}
                      {c.isClosed ? (
                        <bdi>{c.resolution ?? '—'}</bdi>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', minWidth: '16rem' }}>
                          <input
                            aria-label={t('complaintsTextAria', { id: c.id })}
                            placeholder={t('complaintsTextPlaceholder')}
                            dir="auto"
                            value={text[c.id] ?? ''}
                            onChange={(e) => setVal(c.id, e.target.value)}
                          />
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                            {canLog && c.status === 'LOGGED' ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void run(() => assignComplaint(c.id, val(c.id)))
                                }
                              >
                                {t('complaintsAssignButton')}
                              </button>
                            ) : null}
                            {canLog &&
                            (c.status === 'ASSIGNED' ||
                              c.status === 'ESCALATED') ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void run(() => startComplaint(c.id))}
                              >
                                {t('complaintsStartButton')}
                              </button>
                            ) : null}
                            {canLog && c.status === 'IN_PROGRESS' ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void run(() =>
                                    addComplaintAction(c.id, val(c.id)),
                                  )
                                }
                              >
                                {t('complaintsAddActionButton')}
                              </button>
                            ) : null}
                            {canLog &&
                            (c.status === 'IN_PROGRESS' ||
                              c.status === 'ESCALATED') ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void run(() => resolveComplaint(c.id, val(c.id)))
                                }
                              >
                                {t('complaintsResolveButton')}
                              </button>
                            ) : null}
                            {canEscalate && c.status === 'IN_PROGRESS' ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void run(() =>
                                    escalateComplaint(c.id, {
                                      reason: val(c.id) || undefined,
                                    }),
                                  )
                                }
                              >
                                {t('complaintsEscalateButton')}
                              </button>
                            ) : null}
                            {canClose && c.status === 'RESOLVED' ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void run(() => closeComplaint(c.id))}
                              >
                                {t('complaintsCloseButton')}
                              </button>
                            ) : null}
                          </div>
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
        <p>{t('complaintsLoading')}</p>
      )}
    </main>
  );
}
