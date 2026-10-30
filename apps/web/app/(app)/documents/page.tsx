'use client';

import { type CSSProperties, type FormEvent, useCallback, useEffect, useState } from 'react';
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
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
import { actionErrorText } from '../../../lib/i18n/action-error';
import {
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonList,
  Table,
  Td,
  Th,
  Tr,
} from '../../../components/ui';
import { pageStackStyle } from '../../../components/lead/lead.styles';
import { useLanguage } from '../../../lib/i18n/language-context';
import { permissionMayBeMissing, permissionRefusal } from '../../../lib/i18n/permission-refusal';
import { EntitySearch } from '../../../components/ui/EntitySearch';

const cell: CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid var(--border-subtle)',
  textAlign: 'start',
};
const head: CSSProperties = { ...cell, fontWeight: 600, borderBottom: '2px solid var(--border-default)' };
const formStyle: CSSProperties = { margin: '1rem 0', display: 'grid', gap: 'var(--space-2)', maxWidth: '28rem' };
const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' };

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
  // IN FLIGHT, as its own fact. The block below used to render its loading line
  // whenever `summary` was null — which is the state before anybody has looked a
  // policy up at all — so «جارٍ التحميل…» stood under an empty field from the
  // moment the screen opened and never cleared. Her walk reported exactly that.
  const [summaryBusy, setSummaryBusy] = useState(false);

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
          ? permissionRefusal(t, 'docRefusalAct', 'document.read')
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
      setActionError(actionErrorText(err, t, 'docVersionError'));
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
          : permissionMayBeMissing(t, 'docUnlockAct', 'document.delete-override'),
      );
    }
  }

  async function onDelete(id: string) {
    setActionError(null);
    try {
      await deleteDocument(id);
      await load(policyId);
    } catch (err) {
      setActionError(actionErrorText(err, t, 'docDeleteError'));
    }
  }

  async function onLookupSummary(e: FormEvent) {
    e.preventDefault();
    if (!summaryPolicyId) return;
    setSummaryError(null);
    setSummary(null);
    setSummaryBusy(true);
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
    } finally {
      setSummaryBusy(false);
    }
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStackStyle}>
      <PageHeader
        title={t('docHeading')}
        description={t('docIntro')}
      />

      <form onSubmit={onLookup} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
        <EntitySearch
          kind="policy"
          value={policyId}
          onChange={setPolicyId}
          label={t('docPolicyIdLabel')}
          required
        />
        <button type="submit">{t('docLookUp')}</button>
      </form>

      {loadError ? (
        <ErrorState title={loadError} />
      ) : null}
      {actionError ? (
        <ErrorState title={actionError} />
      ) : null}

      {documents ? (
        documents.length === 0 ? (
          <EmptyState title={t('docNone')} />
        ) : (
          <Card padded={false}>
            <Table>
            <thead>
              <tr>
                <Th>{t('docColFile')}</Th>
                <Th>{t('docColCategory')}</Th>
                <Th>{t('docColClassification')}</Th>
                <Th>{t('docColVersion')}</Th>
                <Th>{t('docColDeletion')}</Th>
                <th style={head} />
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <Tr key={doc.id}>
                  <Td>{doc.fileName}</Td>
                  <Td>{t(ENUM_LABEL.DocumentCategory[doc.category])}</Td>
                  <Td>{t(ENUM_LABEL.DataClassification[doc.classification])}</Td>
                  <Td>{doc.versionNumber}</Td>
                  <Td>{doc.deletionLocked ? t('docLocked') : t('docUnlocked')}</Td>
                  <Td>
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
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          </Card>
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
                  {t(ENUM_LABEL.DataClassification[c])}
                </option>
              ))}
            </select>
          </label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit">{t('docSaveVersionButton')}</button>
            <button type="button" onClick={() => setVersioningId(null)}>
              {t('commonCancel')}
            </button>
          </div>
        </form>
      ) : null}

      <form onSubmit={onLookupSummary} style={formStyle}>
        <h2>{t('docPolicyClassification')}</h2>
        <p style={{ opacity: 0.75 }}>
          {t('docClassificationSummaryIntro')}
        </p>
        <EntitySearch
          kind="policy"
          value={summaryPolicyId}
          onChange={setSummaryPolicyId}
          label={t('docPolicyIdLabel')}
          required
        />
        <button type="submit">{t('docComputeButton')}</button>
        {summaryError ? (
          <ErrorState title={summaryError} />
        ) : null}
        {summary ? (
          <p>
            {tPlural('docsDocumentCount', summary.documentCount)}{' '}
            {t('docsHighestClassification')}{' '}
            <strong>
              {summary.highestClassification ?? t('docsClassificationNone')}
            </strong>
          </p>
        ) : null}
        {/* ONLY while a lookup is actually running.

            This was `) : loadError ? null : (<Loading/>)`, which is wrong twice:
            it rendered whenever `summary` was null — including before anybody had
            looked anything up — and it guarded on `loadError`, which belongs to
            the DOCUMENT LIST above and not to this lookup, whose error is
            `summaryError`. So the screen said it was loading from the moment it
            opened, for ever. Nothing is rendered before a lookup: the field's own
            label and the paragraph above it already say what to do, and an
            invented prompt would be a sentence nobody decided. */}
        {summaryBusy ? <SkeletonList rows={4} label={t('docLoading')} /> : null}
      </form>
    </main>
  );
}
