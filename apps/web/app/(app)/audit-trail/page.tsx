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
  type AuditLogEntry,
  type DocumentHistory,
} from '../../../lib/audit-trail/audit-trail-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';
import { useLanguage } from '../../../lib/i18n/language-context';
import { EntitySearch } from '../../../components/ui/EntitySearch';

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
  const [browseRows, setBrowseRows] = useState<AuditLogEntry[] | null>(null);
  // The filters that produced the rows currently on screen — NOT the live
  // input values. Paging has to re-send the query that produced the set being
  // paged, or typing a new filter and then clicking Next would ask for page 2
  // of a search that was never run.
  const [browseApplied, setBrowseApplied] = useState<{
    userId?: string;
    entityType?: string;
    entityId?: string;
    to?: string;
  }>({});
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
    const filters = {
      userId: browseUserId || undefined,
      entityType: browseEntityType || undefined,
      entityId: browseEntityId || undefined,
      // Pinned to the instant this browse was submitted, and reused for every
      // page of it.
      //
      // This is the one list whose own reads APPEND to the table they read:
      // each browse records a PDPL access row, which sorts to the top and
      // shifts every later page down by one. Without the pin, clicking Next
      // shows a row the previous page already showed, and hides one entirely.
      // An audit browse reading "as at the moment you searched" is also the
      // more honest thing for it to mean.
      to: new Date().toISOString(),
    };
    setBrowseApplied(filters);
    await browseTo(0, filters);
  }

  // The audit log is the fastest-growing table here, so it is read a page at a
  // time. A new search restarts at page 0 through the submit above; paging
  // re-sends the filters that produced the set, never the live inputs.
  async function browseTo(
    nextPage: number,
    filters: {
      userId?: string;
      entityType?: string;
      entityId?: string;
      to?: string;
    } = browseApplied,
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
