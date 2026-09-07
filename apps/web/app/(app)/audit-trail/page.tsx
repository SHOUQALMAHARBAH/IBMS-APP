'use client';

import { type CSSProperties, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
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

const cell: CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'left',
  verticalAlign: 'top',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid #d1d5db' };
const sectionStyle: CSSProperties = { margin: '1.75rem 0' };
const formStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', margin: '0.75rem 0' };

function messageFor(err: unknown, permission: string, fallback: string): string {
  return err instanceof ApiError && err.status === 403
    ? `You don't hold the ${permission} permission.`
    : err instanceof ApiError
      ? err.message
      : fallback;
}

function AuditLogTable({ rows }: { rows: AuditLogEntry[] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', minWidth: '60rem' }}>
        <thead>
          <tr>
            <th style={head}>Occurred</th>
            <th style={head}>Action</th>
            <th style={head}>Entity</th>
            <th style={head}>User</th>
            <th style={head}>Sensitive</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td style={cell} colSpan={5}>
                No entries.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.id}>
                <td style={cell}>{r.occurredAt.replace('T', ' ').slice(0, 19)}</td>
                <td style={cell}>{r.action}</td>
                <td style={cell}>
                  {r.entityType} <span style={{ opacity: 0.7 }}>· {r.entityId}</span>
                </td>
                <td style={cell}>{r.userId}</td>
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

  const [browseEntityType, setBrowseEntityType] = useState('');
  const [browseEntityId, setBrowseEntityId] = useState('');
  const [browseRows, setBrowseRows] = useState<AuditLogEntry[] | null>(null);
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
  }, [isLoading, user, router]);

  async function runBrowse(ev: React.FormEvent) {
    ev.preventDefault();
    setBrowseBusy(true);
    setBrowseError(null);
    try {
      setBrowseRows(
        await browseAuditTrail({
          entityType: browseEntityType || undefined,
          entityId: browseEntityId || undefined,
        }),
      );
    } catch (err) {
      setBrowseRows(null);
      setBrowseError(messageFor(err, 'audit-log.read', 'Could not browse the audit log — try again.'));
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
      setWfError(messageFor(err, 'workflow-history.read', 'Could not load workflow history — try again.'));
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
      setDocError(messageFor(err, 'document-history.read', 'Could not load document history — try again.'));
    } finally {
      setDocBusy(false);
    }
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>Audit Trail</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        The External Auditor&rsquo;s read-only lens (Part 5.1): logs,
        document history, and workflow-state transition history for a
        defined engagement period. Access itself is time-boxed via each
        user&rsquo;s own account settings, not configured here.
      </p>

      <section style={sectionStyle}>
        <h2>Audit log</h2>
        <form onSubmit={runBrowse} style={formStyle}>
          <label>
            Entity type{' '}
            <input
              aria-label="Entity type"
              value={browseEntityType}
              onChange={(e) => setBrowseEntityType(e.target.value)}
            />
          </label>
          <label>
            Entity id{' '}
            <input
              aria-label="Entity id"
              value={browseEntityId}
              onChange={(e) => setBrowseEntityId(e.target.value)}
            />
          </label>
          <button type="submit" disabled={browseBusy}>
            {browseBusy ? 'Loading…' : 'Browse'}
          </button>
        </form>
        {browseError ? (
          <p role="alert" style={errorStyle}>
            {browseError}
          </p>
        ) : null}
        {browseRows ? <AuditLogTable rows={browseRows} /> : null}
      </section>

      <section style={sectionStyle}>
        <h2>Workflow history</h2>
        <form onSubmit={runWorkflowHistory} style={formStyle}>
          <label>
            Entity type{' '}
            <input
              aria-label="Workflow entity type"
              value={wfEntityType}
              onChange={(e) => setWfEntityType(e.target.value)}
              required
            />
          </label>
          <label>
            Entity id{' '}
            <input
              aria-label="Workflow entity id"
              value={wfEntityId}
              onChange={(e) => setWfEntityId(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={wfBusy}>
            {wfBusy ? 'Loading…' : 'Look up'}
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
        <h2>Document history</h2>
        <form onSubmit={runDocumentHistory} style={formStyle}>
          <label>
            Document id{' '}
            <input
              aria-label="Document id"
              value={documentId}
              onChange={(e) => setDocumentId(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={docBusy}>
            {docBusy ? 'Loading…' : 'Look up'}
          </button>
        </form>
        {docError ? (
          <p role="alert" style={errorStyle}>
            {docError}
          </p>
        ) : null}
        {docHistory ? (
          <>
            <h3>Versions</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: '48rem' }}>
                <thead>
                  <tr>
                    <th style={head}>Version</th>
                    <th style={head}>File</th>
                    <th style={head}>Category</th>
                    <th style={head}>Classification</th>
                    <th style={head}>Uploaded by</th>
                    <th style={head}>Created</th>
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
                      <td style={cell}>{v.category}</td>
                      <td style={cell}>{v.classification}</td>
                      <td style={cell}>{v.uploadedByUserId}</td>
                      <td style={cell}>{v.createdAt.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3>Audit trail</h3>
            <AuditLogTable rows={docHistory.auditTrail} />
          </>
        ) : null}
      </section>
    </main>
  );
}
