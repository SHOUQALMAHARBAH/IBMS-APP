'use client';

import { type CSSProperties, type FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  createDocumentVersion,
  DATA_CLASSIFICATIONS,
  deleteDocument,
  getPolicyFileClassification,
  listDocuments,
  overrideDeletionLock,
  type DataClassification,
  type DocumentRecord,
  type PolicyFileClassificationSummary,
} from '../../../lib/supporting-operations/document-api';
import { ApiError } from '../../../lib/auth/api-client';
import { errorStyle } from '../../../components/auth/auth-form.styles';
import { pageStyle } from '../../../components/lead/lead.styles';

const cell: CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'start',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid #d1d5db' };
const formStyle: CSSProperties = { margin: '1rem 0', display: 'grid', gap: '0.4rem', maxWidth: '28rem' };
const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.2rem' };

export default function DocumentsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [policyId, setPolicyId] = useState('');
  const [documents, setDocuments] = useState<DocumentRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [versioningId, setVersioningId] = useState<string | null>(null);
  const [versionClassification, setVersionClassification] = useState<DataClassification>('CONFIDENTIAL');
  const [versionFileName, setVersionFileName] = useState('');
  const [versionStorageRef, setVersionStorageRef] = useState('');

  const [summaryPolicyId, setSummaryPolicyId] = useState('');
  const [summary, setSummary] = useState<PolicyFileClassificationSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, user, router]);

  const load = useCallback(async (pid: string) => {
    try {
      setDocuments(await listDocuments({ policyId: pid }));
      setLoadError(null);
    } catch (err) {
      setDocuments(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? "You don't hold the document.manage permission."
          : err instanceof ApiError
            ? err.message
            : 'Could not load documents — try again.',
      );
    }
  }, []);

  async function onLookup(e: FormEvent) {
    e.preventDefault();
    if (!policyId) return;
    await load(policyId);
  }

  function startVersion(doc: DocumentRecord) {
    setVersioningId(doc.id);
    setVersionClassification(doc.classification);
    setVersionFileName('');
    setVersionStorageRef('');
  }

  async function submitVersion(id: string) {
    setActionError(null);
    try {
      await createDocumentVersion(id, {
        classification: versionClassification,
        fileName: versionFileName,
        storageRef: versionStorageRef,
      });
      setVersioningId(null);
      await load(policyId);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not create a new version.');
    }
  }

  async function onUnlock(id: string) {
    setActionError(null);
    try {
      await overrideDeletionLock(id);
      await load(policyId);
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.message
          : "Could not unlock — you may not hold document.delete-override.",
      );
    }
  }

  async function onDelete(id: string) {
    setActionError(null);
    try {
      await deleteDocument(id);
      await load(policyId);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not delete the document.');
    }
  }

  async function onLookupSummary(e: FormEvent) {
    e.preventDefault();
    if (!summaryPolicyId) return;
    setSummaryError(null);
    setSummary(null);
    try {
      setSummary(await getPolicyFileClassification(summaryPolicyId));
    } catch (err) {
      setSummaryError(
        err instanceof ApiError && err.status === 404
          ? 'Policy not found.'
          : err instanceof ApiError
            ? err.message
            : 'Could not compute the classification summary.',
      );
    }
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>Documents</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        The Part 4.2 electronic Insurance File — version control and the
        deletion lock override for one policy&apos;s documents.
      </p>

      <form onSubmit={onLookup} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
        <label style={labelStyle}>
          Policy ID
          <input value={policyId} onChange={(e) => setPolicyId(e.target.value)} required />
        </label>
        <button type="submit">Look up documents</button>
      </form>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}
      {actionError ? (
        <p role="alert" style={errorStyle}>
          {actionError}
        </p>
      ) : null}

      {documents ? (
        documents.length === 0 ? (
          <p style={{ opacity: 0.6 }}>No documents recorded for this policy.</p>
        ) : (
          <table style={{ borderCollapse: 'collapse', minWidth: '44rem' }}>
            <thead>
              <tr>
                <th style={head}>File</th>
                <th style={head}>Category</th>
                <th style={head}>Classification</th>
                <th style={head}>Version</th>
                <th style={head}>Deletion</th>
                <th style={head} />
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id}>
                  <td style={cell}>{doc.fileName}</td>
                  <td style={cell}>{doc.category}</td>
                  <td style={cell}>{doc.classification}</td>
                  <td style={cell}>{doc.versionNumber}</td>
                  <td style={cell}>{doc.deletionLocked ? 'Locked' : 'Unlocked'}</td>
                  <td style={cell}>
                    {versioningId === doc.id ? null : (
                      <button type="button" onClick={() => startVersion(doc)}>
                        New version
                      </button>
                    )}
                    {doc.deletionLocked ? (
                      <button type="button" onClick={() => onUnlock(doc.id)}>
                        Unlock for deletion
                      </button>
                    ) : (
                      <button type="button" onClick={() => onDelete(doc.id)}>
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}

      {versioningId ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitVersion(versioningId);
          }}
          style={formStyle}
        >
          <h2>Record a new version</h2>
          <label style={labelStyle}>
            File name
            <input value={versionFileName} onChange={(e) => setVersionFileName(e.target.value)} required />
          </label>
          <label style={labelStyle}>
            Storage reference
            <input
              value={versionStorageRef}
              onChange={(e) => setVersionStorageRef(e.target.value)}
              required
            />
          </label>
          <label style={labelStyle}>
            Classification
            <select
              value={versionClassification}
              onChange={(e) => setVersionClassification(e.target.value as DataClassification)}
            >
              {DATA_CLASSIFICATIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit">Save version</button>
            <button type="button" onClick={() => setVersioningId(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      <form onSubmit={onLookupSummary} style={formStyle}>
        <h2>Policy file classification</h2>
        <p style={{ opacity: 0.75 }}>
          The highest classification present across a policy&apos;s electronic
          file — never averaged.
        </p>
        <label style={labelStyle}>
          Policy ID
          <input value={summaryPolicyId} onChange={(e) => setSummaryPolicyId(e.target.value)} required />
        </label>
        <button type="submit">Compute</button>
        {summaryError ? (
          <p role="alert" style={errorStyle}>
            {summaryError}
          </p>
        ) : null}
        {summary ? (
          <p>
            {summary.documentCount} document(s) — highest classification:{' '}
            <strong>{summary.highestClassification ?? 'none'}</strong>
          </p>
        ) : null}
      </form>
    </main>
  );
}
