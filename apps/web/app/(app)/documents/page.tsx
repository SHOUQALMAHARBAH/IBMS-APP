'use client';

import { type CSSProperties, type FormEvent, useCallback, useEffect, useState } from 'react';
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  createDocumentVersion,
  DATA_CLASSIFICATIONS,
  deleteDocument,
  downloadStoredDocument,
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
import { hasPermission } from '../../../lib/auth/permissions';
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
/* OWNER DECISION 128's stamp beside a file name. A NAMED style: `check:screen-pass`'s inline
 * budget may only FALL, so a new site moves the declaration out rather than the number up.
 *
 * ⚠️ `--surface-card`, NOT `--surface-raised`. `globals.css:126` records that three sites
 * referenced an undefined surface for months and rendered with no background at all, and the
 * same mistake was made again in message 42 inside the comment warning about it.
 * `check:css-properties` is what catches it; run it by name, it is in no chain. */
/**
 * 🔴 OWNER DECISION 142 — DOES THIS SYSTEM HOLD THE FILE ITSELF?
 *
 * ⛔ `storageRef`, NOT the category. That prefix is what the repository actually writes when it
 * stores bytes (`db:documentContent/<id>`), so the screen and the server cannot disagree; a
 * category test would claim a stored file for a certificate row whose bytes failed to write.
 *
 * ONE home, because two sites ask it: the download button offers the stored file, and the
 * deletion controls are withheld from it — ⛔ no route may delete a stored certificate
 * (criterion 5), so a control that proposes to is a control whose press can only fail.
 */
const isStoredHere = (doc: DocumentRecord): boolean =>
  doc.storageRef.startsWith('db:documentContent/');

const stampStyle: CSSProperties = {
  marginInlineStart: 'var(--space-2)',
  padding: '0 var(--space-1)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--surface-card)',
  border: '1px solid var(--border-default)',
  fontSize: '0.75rem',
};

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

  const canOverrideDeletion = hasPermission(user, 'document.delete-override');

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

  /**
   * 🔴 OWNER DECISION 142 criterion 1 — read the stored file back and hand it over.
   *
   * The blob route carries the auth headers an `<a href>` cannot, which is why this is a fetch
   * and an object URL rather than a link — the same shape the certificate download on the policy
   * screen already uses. The URL is revoked immediately: it is a handle to memory, and leaking
   * one per click on a screen that lists a whole office's documents is a real leak.
   */
  async function onDownloadStored(doc: DocumentRecord) {
    const blob = await downloadStoredDocument(doc.id);
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = doc.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
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
                  <Td>
                    {doc.fileName}
                    {/*
                      🔴 OWNER DECISION 128 + 136 §6 + 142 criterion 2 — THE STAMP, ON THE SCREEN
                      THAT DISPLAYS THE CERTIFICATE.

                      ⛔ It is NOT printed on the file. Decision 136(أ) rules the phrase never
                      appears on paper the customer receives; it is a column on the row, and this
                      is the row's screen.

                      AND IT SURVIVES THE NEW CERTIFICATE ARRIVING (criterion 2). Nothing here
                      consults the licence's CURRENT state — the column was stamped at creation
                      and no permission removes it, so a record issued in the gap still says so a
                      year later, which is the question an inspector actually asks.
                    */}
                    {doc.issuedUnderStudyLicenseId ? (
                      <span style={stampStyle} data-renewal-stamp="">
                        {t('rcRenewalStamp')}
                      </span>
                    ) : null}
                  </Td>
                  <Td>{t(ENUM_LABEL.DocumentCategory[doc.category])}</Td>
                  <Td>{t(ENUM_LABEL.DataClassification[doc.classification])}</Td>
                  <Td>{doc.versionNumber}</Td>
                  <Td>{doc.deletionLocked ? t('docLocked') : t('docUnlocked')}</Td>
                  <Td>
                    {/*
                      🔴 OWNER DECISION 142 criterion 1 + OWNER DECISION 148 — «تنزيل الملف».

                      The route shipped on 2026-11-16 built, enforced on `document.read` and
                      e2e-proven to return the certificate byte-for-byte as issued — and with NO
                      control, because the label did not exist: «تنزيل» ships on seven sibling
                      buttons and «الملف» on this very screen, and decision 125 forbids joining
                      two shipped words into a third. It was declared unreached with the creditor
                      named — one ratified word — and she ruled it the same day.

                      ⛔ OFFERED ONLY WHERE THIS SYSTEM ACTUALLY STORED THE BYTES, and the
                      discriminator is `storageRef` rather than the category. That is what the
                      repository really writes when it stores a file, so the two cannot disagree;
                      a category test would offer the button on a certificate row whose bytes
                      failed to write — which the transaction makes impossible today and which a
                      later uploader could reintroduce.
                    */}
                    {isStoredHere(doc) ? (
                      <button
                        type="button"
                        data-stored-download=""
                        onClick={() => void onDownloadStored(doc)}
                      >
                        {t('docDownloadStoredButton')}
                      </button>
                    ) : null}
                    {versioningId === doc.id ? null : (
                      <button type="button" onClick={() => startVersion(doc)}>
                        {t('docNewVersionButton')}
                      </button>
                    )}
                    {/*
                      🔴 TWO REASONS THIS PAIR MAY NOT RENDER, AND THEY ARE DIFFERENT REASONS.

                      (a) THE CALLER. Both `POST /documents/:id/deletion-override` and
                      `DELETE /documents/:id` carry `document.delete-override`, held by ADMIN and
                      the DPO and by nobody else — measured in `permissions.ts`. Until now the
                      pair was gated on NOTHING at all, so the owner's second walk saw «إلغاء
                      القفل للحذف» offered to a Placement officer, whose press could only 403.
                      `frontend-ux-directive.md`: a control a role cannot use does not exist on
                      their screen.

                      (b) THE ROW. A document whose file this system stores can never be
                      unlocked (decision 142 §٥ criterion 5), so the unlock is refused for every
                      caller and the delete below it is unreachable — measured, because the
                      service now refuses before it writes and before it audits.

                      ⛔ Neither test substitutes for the other: (a) hidden alone would still
                      offer an administrator a button that cannot work, and (b) alone would go
                      on offering the Placement officer a 403 on every other row.
                    */}
                    {canOverrideDeletion && !isStoredHere(doc) ? (
                      doc.deletionLocked ? (
                        <button type="button" onClick={() => onUnlock(doc.id)}>
                          {t('docUnlockButton')}
                        </button>
                      ) : (
                        <button type="button" onClick={() => onDelete(doc.id)}>
                          {t('commonDelete')}
                        </button>
                      )
                    ) : null}
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
