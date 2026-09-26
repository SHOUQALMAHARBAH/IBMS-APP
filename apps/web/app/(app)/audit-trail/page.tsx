'use client';

import { type CSSProperties, useEffect, useState } from 'react';
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
import { useRouter } from 'next/navigation';
import { Pagination } from '../../../components/ui/Pagination';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  browseAuditTrail,
  getDocumentHistory,
  getWorkflowHistory,
  type AuditAction,
  type AuditLogEntry,
  type DocumentHistory,
} from '../../../lib/audit-trail/audit-trail-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';
import { useLanguage } from '../../../lib/i18n/language-context';
import { EntitySearch } from '../../../components/ui/EntitySearch';

/**
 * Every action, ordered as the label map declares them rather than alphabetically.
 *
 * That order is roughly "what happened to a record" before "what happened to a session", which is how
 * somebody scanning the list thinks about it; sorting it would interleave `LOGIN_FAILED` with `EXPORT`.
 */
const AUDIT_ACTION_OPTIONS = Object.keys(ENUM_LABEL.AuditAction) as AuditAction[];

interface BrowseFilters {
  userId?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  from?: string;
  to?: string;
}

/**
 * A `<input type="date">` gives `YYYY-MM-DD`; the API wants an instant.
 *
 * The END of the day matters and is easy to get wrong. A compliance officer asking for "March" types
 * 1 March to 31 March and means the whole of the 31st — but `2026-03-31` as an instant is midnight at the
 * START of it, which silently drops the last day of every range anybody enters. That is a wrong answer
 * that looks like a complete one, so `to` is stretched to the final millisecond and `from` is not.
 */
function startOfDayIso(day: string): string {
  return new Date(`${day}T00:00:00.000Z`).toISOString();
}

function endOfDayIso(day: string): string {
  return new Date(`${day}T23:59:59.999Z`).toISOString();
}

const cell: CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid var(--border-subtle)',
  textAlign: 'start',
  verticalAlign: 'top',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid var(--border-default)' };
const sectionStyle: CSSProperties = { margin: '1.75rem 0' };
const formStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', margin: '0.75rem 0' };

function messageFor(err: unknown, noPermission: string, fallback: string): string {
  return err instanceof ApiError && err.status === 403
    ? noPermission
    : err instanceof ApiError
      ? err.message
      : fallback;
}

function AuditLogTable({ rows }: { rows: AuditLogEntry[] }) {
  const { t } = useLanguage();
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', minWidth: '60rem' }}>
        <thead>
          <tr>
            <th style={head}>{t('atColOccurred')}</th>
            <th style={head}>{t('atColAction')}</th>
            <th style={head}>{t('atColEntity')}</th>
            <th style={head}>{t('atColUser')}</th>
            <th style={head}>{t('atColSensitive')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td style={cell} colSpan={5}>
                {t('atNone')}
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.id}>
                <td style={cell}>{r.occurredAt.replace('T', ' ').slice(0, 19)}</td>
                <td style={cell}>{t(ENUM_LABEL.AuditAction[r.action])}</td>
                <td style={cell}>
                  {r.entityType} <span style={{ opacity: 0.7 }}>· {r.entityId}</span>
                </td>
                <td style={cell} data-audit-actor={r.userId}>
                  {/*
                    The name, falling back to the id.

                    This column is headed "User" and rendered a raw uuid — unreadable by the person the
                    audit trail exists for, who is being asked to review who did what. The name is
                    resolved per page by the API.

                    The fallback is defence, not a state reachable today: `userId` is NOT NULL and the
                    actor FK is ON DELETE RESTRICT, so an actor cannot be deleted out from under their
                    rows. If that ever changes, this cell shows the id rather than reading as "nobody".
                  */}
                  <bdi>{r.actorName ?? r.userId}</bdi>
                </td>
                <td style={cell}>{r.isSensitiveDataAccess ? 'Yes' : ''}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function AuditTrailPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();

  const [browseUserId, setBrowseUserId] = useState('');
  const [browseEntityType, setBrowseEntityType] = useState('');
  const [browseEntityId, setBrowseEntityId] = useState('');
  // IMPROVEMENTS § 1.52 — the API has accepted these three all along and no control offered them, so
  // "every DELETE last March" meant asking a developer to build a URL.
  const [browseAction, setBrowseAction] = useState('');
  const [browseFrom, setBrowseFrom] = useState('');
  const [browseToDate, setBrowseToDate] = useState('');
  const [browseRows, setBrowseRows] = useState<AuditLogEntry[] | null>(null);
  // The filters that produced the rows currently on screen — NOT the live
  // input values. Paging has to re-send the query that produced the set being
  // paged, or typing a new filter and then clicking Next would ask for page 2
  // of a search that was never run.
  const [browseApplied, setBrowseApplied] = useState<BrowseFilters>({});
  const [browsePage, setBrowsePage] = useState(0);
  const [browseTotal, setBrowseTotal] = useState(0);
  const [browsePageSize, setBrowsePageSize] = useState(0);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [browseBusy, setBrowseBusy] = useState(false);

  const [wfEntityType, setWfEntityType] = useState('');
  const [wfEntityId, setWfEntityId] = useState('');
  const [wfRows, setWfRows] = useState<AuditLogEntry[] | null>(null);
  const [wfError, setWfError] = useState<string | null>(null);
  const [wfBusy, setWfBusy] = useState(false);

  const [documentId, setDocumentId] = useState('');
  const [docHistory, setDocHistory] = useState<DocumentHistory | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const [docBusy, setDocBusy] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router, t]);

  async function runBrowse(ev: React.FormEvent) {
    ev.preventDefault();
    const filters: BrowseFilters = {
      userId: browseUserId || undefined,
      entityType: browseEntityType || undefined,
      entityId: browseEntityId || undefined,
      action: browseAction || undefined,
      from: browseFrom ? startOfDayIso(browseFrom) : undefined,
      // `to` DOES DOUBLE DUTY, and the two uses are compatible rather than in conflict.
      //
      // Its original job is the pagination pin: this is the one list whose own reads APPEND to the table
      // they read — each browse records a PDPL access row, which sorts to the top and shifts every later
      // page down by one. Without a pin, clicking Next shows a row the previous page already showed and
      // hides one entirely.
      //
      // A user-supplied upper bound serves that purpose at least as well, because a date in the past
      // cannot admit new rows at all. So an explicit `to` REPLACES the pin, and the pin remains the
      // default when the field is blank. An audit browse reading "as at the moment you searched" is also
      // the more honest thing for it to mean.
      to: browseToDate ? endOfDayIso(browseToDate) : new Date().toISOString(),
    };
    setBrowseApplied(filters);
    await browseTo(0, filters);
  }

  // The audit log is the fastest-growing table here, so it is read a page at a
  // time. A new search restarts at page 0 through the submit above; paging
  // re-sends the filters that produced the set, never the live inputs.
  async function browseTo(
    nextPage: number,
    filters: BrowseFilters = browseApplied,
  ) {
    setBrowseBusy(true);
    setBrowseError(null);
    try {
      const result = await browseAuditTrail({
        ...filters,
        ...(nextPage ? { page: nextPage } : {}),
      });
      setBrowseRows(result.items);
      setBrowseTotal(result.total);
      setBrowsePageSize(result.pageSize);
      setBrowsePage(result.page);
    } catch (err) {
      setBrowseRows(null);
      setBrowseError(messageFor(err, t('atNoPermissionFor', { permission: 'audit-log.read' }), t('atLogLoadError')));
    } finally {
      setBrowseBusy(false);
    }
  }

  async function runWorkflowHistory(ev: React.FormEvent) {
    ev.preventDefault();
    setWfBusy(true);
    setWfError(null);
    try {
      setWfRows(await getWorkflowHistory(wfEntityType, wfEntityId));
    } catch (err) {
      setWfRows(null);
      setWfError(messageFor(err, t('atNoPermissionFor', { permission: 'workflow-history.read' }), t('atWorkflowLoadError')));
    } finally {
      setWfBusy(false);
    }
  }

  async function runDocumentHistory(ev: React.FormEvent) {
    ev.preventDefault();
    setDocBusy(true);
    setDocError(null);
    try {
      setDocHistory(await getDocumentHistory(documentId));
    } catch (err) {
      setDocHistory(null);
      setDocError(messageFor(err, t('atNoPermissionFor', { permission: 'document-history.read' }), t('atDocumentLoadError')));
    } finally {
      setDocBusy(false);
    }
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('atHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('atIntro')}
      </p>

      <section style={sectionStyle}>
        <h2>{t('atAuditLogHeading')}</h2>
        <form onSubmit={runBrowse} style={formStyle}>
          {/*
            "What did this person do" is the question an audit trail is read for, and there was no
            control for it — while the API has accepted a `userId` filter all along. Nobody knows a
            uuid, so the filter existed and was unusable, which is the same defect as a form asking for
            an id whose source screen was never built.
          */}
          <EntitySearch
            kind="auditActor"
            value={browseUserId}
            onChange={setBrowseUserId}
            label={t('atActorLabel')}
          />
          <label>
            {t('atEntityTypeLabel')}{' '}
            <input
              aria-label={t('atEntityTypeLabel')}
              value={browseEntityType}
              onChange={(e) => setBrowseEntityType(e.target.value)}
            />
          </label>
          <label>
            {t('atEntityIdLabel')}{' '}
            <input
              aria-label={t('atEntityIdLabel')}
              value={browseEntityId}
              onChange={(e) => setBrowseEntityId(e.target.value)}
            />
          </label>
          {/*
            IMPROVEMENTS § 1.52 — the three filters the API accepted with nothing to drive them. A SELECT
            rather than a text box, because `action` is validated against a closed vocabulary server-side:
            typing it would make a 400 the normal way to discover the spelling. The options are built from
            `ENUM_LABEL.AuditAction`, which is a total map over the union, so a new action appears here
            without an edit — and `audit-action-parity.spec.ts` keeps that union equal to the database's.
          */}
          <label>
            {t('atActionLabel')}{' '}
            <select
              aria-label={t('atActionLabel')}
              value={browseAction}
              onChange={(e) => setBrowseAction(e.target.value)}
            >
              <option value="">{t('atActionAny')}</option>
              {AUDIT_ACTION_OPTIONS.map((action) => (
                <option key={action} value={action}>
                  {t(ENUM_LABEL.AuditAction[action])}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('atFromLabel')}{' '}
            <input
              type="date"
              aria-label={t('atFromLabel')}
              value={browseFrom}
              onChange={(e) => setBrowseFrom(e.target.value)}
            />
          </label>
          <label>
            {t('atToLabel')}{' '}
            <input
              type="date"
              aria-label={t('atToLabel')}
              value={browseToDate}
              onChange={(e) => setBrowseToDate(e.target.value)}
            />
          </label>
          <button type="submit" disabled={browseBusy}>
            {browseBusy ? t('atLoading') : t('atBrowseButton')}
          </button>
        </form>
        {browseError ? (
          <p role="alert" style={errorStyle}>
            {browseError}
          </p>
        ) : null}
        {browseRows ? (
          <>
            <AuditLogTable rows={browseRows} />
            <Pagination
              page={browsePage}
              pageSize={browsePageSize}
              total={browseTotal}
              busy={browseBusy}
              onPageChange={(next) => void browseTo(next)}
            />
          </>
        ) : null}
      </section>

      <section style={sectionStyle}>
        <h2>{t('atWorkflowHistoryHeading')}</h2>
        <form onSubmit={runWorkflowHistory} style={formStyle}>
          <label>
            {t('atWorkflowEntityTypeLabel')}{' '}
            <input
              aria-label={t('atWorkflowEntityTypeLabel')}
              value={wfEntityType}
              onChange={(e) => setWfEntityType(e.target.value)}
              required
            />
          </label>
          <label>
            {t('atWorkflowEntityIdLabel')}{' '}
            <input
              aria-label={t('atWorkflowEntityIdLabel')}
              value={wfEntityId}
              onChange={(e) => setWfEntityId(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={wfBusy}>
            {wfBusy ? t('atLoading') : t('atLookUpButton')}
          </button>
        </form>
        {wfError ? (
          <p role="alert" style={errorStyle}>
            {wfError}
          </p>
        ) : null}
        {wfRows ? <AuditLogTable rows={wfRows} /> : null}
      </section>

      <section style={sectionStyle}>
        <h2>{t('atDocumentHistoryHeading')}</h2>
        <form onSubmit={runDocumentHistory} style={formStyle}>
          <label>
            {t('atDocumentIdLabel')}{' '}
            <input
              aria-label={t('atDocumentIdLabel')}
              value={documentId}
              onChange={(e) => setDocumentId(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={docBusy}>
            {docBusy ? t('atLoading') : t('atLookUpButton')}
          </button>
        </form>
        {docError ? (
          <p role="alert" style={errorStyle}>
            {docError}
          </p>
        ) : null}
        {docHistory ? (
          <>
            <h3>{t('atColVersions')}</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: '48rem' }}>
                <thead>
                  <tr>
                    <th style={head}>{t('atColVersion')}</th>
                    <th style={head}>{t('atColFile')}</th>
                    <th style={head}>{t('atColCategory')}</th>
                    <th style={head}>{t('atColClassification')}</th>
                    <th style={head}>{t('atColUploadedBy')}</th>
                    <th style={head}>{t('atColCreated')}</th>
                  </tr>
                </thead>
                <tbody>
                  {docHistory.versions.map((v) => (
                    <tr key={v.id}>
                      <td style={cell}>
                        v{v.versionNumber}
                        {v.isRequestedVersion ? ' (requested)' : ''}
                      </td>
                      <td style={cell}>{v.fileName}</td>
                      <td style={cell}>{t(ENUM_LABEL.DocumentCategory[v.category])}</td>
                      <td style={cell}>{t(ENUM_LABEL.DataClassification[v.classification])}</td>
                      <td style={cell}>{v.uploadedByUserId}</td>
                      <td style={cell}>{v.createdAt.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3>{t('atHeading')}</h3>
            <AuditLogTable rows={docHistory.auditTrail} />
          </>
        ) : null}
      </section>
    </main>
  );
}
