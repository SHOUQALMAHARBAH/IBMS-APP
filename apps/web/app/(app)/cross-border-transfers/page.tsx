'use client';

import { useCallback, useEffect, useState } from 'react';
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  CROSS_BORDER_LEGAL_BASES,
  createCrossBorderTransfer,
  listCrossBorderTransfers,
  type CrossBorderTransferRecord,
} from '../../../lib/pdpl/cross-border-transfer-api';
import { ApiError } from '../../../lib/auth/api-client';
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
import { hasAnyPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';

const ROLES = [
  'cross-border-transfer.approve',
];


export default function CrossBorderTransfersPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();
  const canManage = hasAnyPermission(user, ROLES);

  const [records, setRecords] = useState<CrossBorderTransferRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [description, setDescription] = useState('');
  const [destinationCountry, setDestinationCountry] = useState('');
  const [legalBasis, setLegalBasis] = useState<string>(CROSS_BORDER_LEGAL_BASES[0]);
  const [evidenceRef, setEvidenceRef] = useState('');

  const load = useCallback(async () => {
    try {
      setRecords(await listCrossBorderTransfers());
      setLoadError(null);
    } catch (err) {
      setRecords(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? permissionRefusal(t, 'cbtRefusalAct', 'cross-border-transfer.approve')
          : err instanceof ApiError
            ? err.message
            : t('cbtLoadError'),
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
        err instanceof ApiError ? err.message : t('cbtActionError'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    await run(async () => {
      await createCrossBorderTransfer({
        description: description.trim(),
        destinationCountry: destinationCountry.trim(),
        legalBasis,
        legalBasisEvidenceRef: evidenceRef.trim() || undefined,
      });
      setDescription('');
      setDestinationCountry('');
      setEvidenceRef('');
    });
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStackStyle}>
      <PageHeader
        title={t('cbtHeading')}
        description={t('cbtIntro')}
      />

      {actionError ? (
        <ErrorState title={actionError} />
      ) : null}
      {loadError ? (
        <ErrorState title={loadError} />
      ) : null}

      {canManage ? (
        <form
          onSubmit={(ev) => void submit(ev)}
          style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', margin: '0.75rem 0' }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {t('cbtDescriptionLabel')}
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {t('cbtDestinationLabel')}
            <input
              aria-label={t('cbtDestinationLabel')}
              value={destinationCountry}
              onChange={(e) => setDestinationCountry(e.target.value)}
              required
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {t('cbtLegalBasisLabel')}
            <select
              aria-label={t('cbtLegalBasisLabel')}
              value={legalBasis}
              onChange={(e) => setLegalBasis(e.target.value)}
            >
              {CROSS_BORDER_LEGAL_BASES.map((b) => (
                <option key={b} value={b}>
                  {t(ENUM_LABEL.CrossBorderLegalBasis[b])}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {t('cbtEvidenceRefLabel')}
            <input
              aria-label={t('cbtEvidenceRefLabel')}
              value={evidenceRef}
              onChange={(e) => setEvidenceRef(e.target.value)}
            />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? t('cbtSavingButton') : t('cbtLogButton')}
          </button>
        </form>
      ) : null}

      {records ? (
        records.length === 0 ? (
          <EmptyState title={t('cbtNone')} />
        ) : (
          <Card padded={false}>
            <Table>
              <thead>
                <tr>
                  <Th>{t('cbtColDestination')}</Th>
                  <Th>{t('cbtLegalBasisLabel')}</Th>
                  <Th>{t('cbtDescriptionLabel')}</Th>
                  <Th>{t('cbtColApprovedBy')}</Th>
                  <Th>{t('cbtColTransferredAt')}</Th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <Tr key={r.id}>
                    <Td>{r.destinationCountry}</Td>
                    <Td>{r.legalBasis}</Td>
                    <Td>{r.description}</Td>
                    {/*
                      * RULE 2 — WHO approved this transfer, by name. It rendered eight characters
                      * of a uuid, which on the register evidencing that a named person authorised
                      * personal data leaving the country identifies nobody. The em dash is the real
                      * absent case: creation IS publishing in this module, so a record can exist
                      * before anybody approved it.
                      */}
                    <Td>
                      {r.approvedByName ? <bdi>{r.approvedByName}</bdi> : t('commonNameNotResolved')}
                    </Td>
                    <Td>{r.transferredAt.slice(0, 10)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        )
      ) : loadError ? null : (
        <SkeletonList rows={4} label={t('cbtLoading')} />
      )}
    </main>
  );
}
