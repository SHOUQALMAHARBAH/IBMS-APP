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
import { useLanguage } from '../../../lib/i18n/language-context';

const cell: CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'start',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid #d1d5db' };
const formStyle: CSSProperties = { margin: '1rem 0', display: 'grid', gap: '0.4rem', maxWidth: '28rem' };
const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.2rem' };

export default function DocumentsPage() {
  const { t, tPlural } = useLanguage();
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
  }, [isLoading, user, router, t]);

  const load = useCallback(async (pid: string) => {
    try {
      setDocuments(await listDocuments({ policyId: pid }));
      setLoadError(null);
    } catch (err) {
      setDocuments(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? t('docNoPermission')
          : err instanceof ApiError
            ? err.message
            : t('docLoadError'),
      );
    }
  }, [t]);

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
      setActionError(err instanceof ApiError ? err.message : t('docVersionError'));
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
          : t('docUnlockError'),
      );
    }
  }

  async function onDelete(id: string) {
    setActionError(null);
    try {
      await deleteDocument(id);
      await load(policyId);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('docDeleteError'));
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
          ? t('docPolicyNotFound')
          : err instanceof ApiError
            ? err.message
            : t('docComputeError'),
      );
    }
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t('docHeading')}</h1>
      <p style={{ opacity: 0.75, maxWidth: '46rem' }}>
        {t('docIntro')}
      </p>

      <form onSubmit={onLookup} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
        <label style={labelStyle}>
          {t('docPolicyIdLabel')}
          <input value={policyId} onChange={(e) => setPolicyId(e.target.value)} required />
        </label>
        <button type="submit">{t('docLookUp')}</button>
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
          <p style={{ color: 'var(--ink-secondary)' }}>{t('docNone')}</p>
        ) : (
          <table style={{ borderCollapse: 'collapse', minWidth: '44rem' }}>
            <thead>
              <tr>
                <th style={head}>{t('docColFile')}</th>
                <th style={head}>{t('docColCategory')}</th>
                <th style={head}>{t('docColClassification')}</th>
                <th style={head}>{t('docColVersion')}</th>
                <th style={head}>{t('docColDeletion')}</th>
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
                  <td style={cell}>{doc.deletionLocked ? t('docLocked') : t('docUnlocked')}</td>
                  <td style={cell}>
                    {versioningId === doc.id ? null : (
                      <button type="button" onClick={() => startVersion(doc)}>
                        {t('docNewVersionButton')}
                      </button>
                    )}
                    {doc.deletionLocked ? (
                      <button type="button" onClick={() => onUnlock(doc.id)}>
                        {t('docUnlockButton')}
                      </button>
                    ) : (
                      <button type="button" onClick={() => onDelete(doc.id)}>
                        {t('commonDelete')}
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
          <h2>{t('docVersionHeading')}</h2>
          <label style={labelStyle}>
            {t('docFileName')}
            <input value={versionFileName} onChange={(e) => setVersionFileName(e.target.value)} required />
          </label>
          <label style={labelStyle}>
            {t('docStorageReference')}
            <input
              value={versionStorageRef}
              onChange={(e) => setVersionStorageRef(e.target.value)}
              required
            />
          </label>
          <label style={labelStyle}>
            {t('docColClassification')}
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
            <button type="submit">{t('docSaveVersionButton')}</button>
            <button type="button" onClick={() => setVersioningId(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      <form onSubmit={onLookupSummary} style={formStyle}>
        <h2>{t('docPolicyClassification')}</h2>
        <p style={{ opacity: 0.75 }}>
          {t('docClassificationSummaryIntro')}
        </p>
        <label style={labelStyle}>
          {t('docPolicyIdLabel')}
          <input value={summaryPolicyId} onChange={(e) => setSummaryPolicyId(e.target.value)} required />
        </label>
        <button type="submit">{t('docComputeButton')}</button>
        {summaryError ? (
          <p role="alert" style={errorStyle}>
            {summaryError}
          </p>
        ) : null}
        {summary ? (
          <p>
            {tPlural('docsDocumentCount', summary.documentCount)}{' '}
            {t('docsHighestClassification')}{' '}
            <strong>
              {summary.highestClassification ?? t('docsClassificationNone')}
            </strong>
          </p>
        ) : loadError ? null : (
        <p>{t('docLoading')}</p>
      )}
      </form>
    </main>
  );
}
