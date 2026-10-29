'use client';

import { useCallback, useEffect, useState } from 'react';
import { CombinedDutyOnRecord } from '../../../components/ui/CombinedDutyOnRecord';
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  CombinedDutyReasonField,
  combinedDutyTooShort,
  needsCombinedDutyDeclaration,
} from '../../../components/ui/CombinedDutyReasonField';
import {
  DATA_CLASSIFICATIONS,
  DATA_SHARING_CHANNELS,
  approveDataSharingApproval,
  createDataSharingApproval,
  declineDataSharingApproval,
  listDataSharingApprovals,
  type DataSharingApproval,
  type DataSharingChannel,
} from '../../../lib/pdpl/data-sharing-approval-api';
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
import { permissionRefusalAnyOf } from '../../../lib/i18n/permission-refusal';

const REQUEST_ROLES = [
  'data-sharing.request',
];
const APPROVE_ROLES = [
  'data-sharing.approve',
];


export default function DataSharingApprovalsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();
  const canRequest = hasAnyPermission(user, REQUEST_ROLES);
  const canApprove = hasAnyPermission(user, APPROVE_ROLES);

  const [rows, setRows] = useState<DataSharingApproval[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Part 4 — the combined-duty reason, keyed by record so two rows cannot share one box.
  const [declarations, setDeclarations] = useState<Record<string, string>>({});

  const [description, setDescription] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [classification, setClassification] = useState<string>(DATA_CLASSIFICATIONS[0]);
  const [channel, setChannel] = useState<DataSharingChannel>(
    DATA_SHARING_CHANNELS[0],
  );
  const [isRegulatoryChannel, setIsRegulatoryChannel] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await listDataSharingApprovals());
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? permissionRefusalAnyOf(t, 'dsaRefusalAct', ['data-sharing.request', 'data-sharing.approve'])
          : err instanceof ApiError
            ? err.message
            : t('dsaLoadError'),
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
        err instanceof ApiError ? err.message : t('dsaActionError'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    await run(async () => {
      await createDataSharingApproval({
        description: description.trim(),
        vendorId: vendorId.trim() || undefined,
        classification,
        channel,
        isRegulatoryChannel,
      });
      setDescription('');
      setVendorId('');
      setIsRegulatoryChannel(false);
    });
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStackStyle}>
      <PageHeader
        title={t('dsaHeading')}
        description={t('dsaIntro')}
      />

      {actionError ? (
        <ErrorState title={actionError} />
      ) : null}
      {loadError ? (
        <ErrorState title={loadError} />
      ) : null}

      {canRequest ? (
        <form
          onSubmit={(ev) => void submit(ev)}
          style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', margin: '0.75rem 0' }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {t('dsaDescriptionFieldLabel')}
            <input
              aria-label={t('dsaDescriptionLabel')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              minLength={20}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {t('dsaVendorIdLabel')}
            <input
              aria-label={t('dsaVendorIdLabel')}
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {t('dsaClassificationFieldLabel')}
            <select
              aria-label={t('dsaClassificationLabel')}
              value={classification}
              onChange={(e) => setClassification(e.target.value)}
            >
              {DATA_CLASSIFICATIONS.map((c) => (
                <option key={c} value={c}>
                  {t(ENUM_LABEL.DataClassification[c])}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {t('dsaChannelFieldLabel')}
            <select
              aria-label={t('dsaChannelLabel')}
              value={channel}
              onChange={(e) =>
                setChannel(e.target.value as DataSharingChannel)
              }
            >
              {DATA_SHARING_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {t(ENUM_LABEL.DataSharingChannel[c])}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <input
              type="checkbox"
              checked={isRegulatoryChannel}
              onChange={(e) => setIsRegulatoryChannel(e.target.checked)}
            />
            {t('dsaRegulatoryChannelLabel')}
          </label>
          <button type="submit" disabled={busy}>
            {busy ? t('dsaSavingButton') : t('dsaRequestButton')}
          </button>
        </form>
      ) : null}

      {rows ? (
        rows.length === 0 ? (
          <EmptyState title={t('dsaNone')} />
        ) : (
          <Card padded={false}>
            <Table>
              <thead>
                <tr>
                  <Th>{t('dsaDescriptionLabel')}</Th>
                  <Th>{t('dsaClassificationLabel')}</Th>
                  <Th>{t('dsaChannelLabel')}</Th>
                  <Th>{t('dsaColSlaDue')}</Th>
                  <Th>{t('dsaColStatus')}</Th>
                  <Th>{t('dsaColAction')}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.id}>
                    <Td>{r.description}</Td>
                    <Td>{t(ENUM_LABEL.DataClassification[r.classification])}</Td>
                    <Td>{t(ENUM_LABEL.DataSharingChannel[r.channel])}</Td>
                    <Td>{r.slaDueAt.slice(0, 10)}</Td>
                    <Td>
                      {r.isApproved ? 'Approved' : r.isDeclined ? 'Declined' : 'Pending'}
                      {/* Part 4 step 5 — in the STATUS cell, because "Approved" is the claim being
                          made and it is only true of a TWO-person decision. Shared renderer. */}
                      <CombinedDutyOnRecord
                        act={r.combinedDutyAct}
                        testId={`combined-duty-sharing-${r.id}`}
                      />
                    </Td>
                    <Td>
                      {canApprove && r.isPending ? (
                        <div style={{ display: 'flex', gap: '0.35rem' }}>
                          {(() => {
                            // Part 4 — the person who performed the first half may complete it themselves in an office
                            // that has declared COMBINED, only by saying why. Every other case is unchanged.
                            const needs = needsCombinedDutyDeclaration({
                              mode: user.dutySegregationMode,
                              makerUserId: r.requestedByUserId,
                              currentUserId: user.id,
                              alreadyDecided: r.approvedByUserId != null,
                            });
                            const declaration = declarations[r.id] ?? '';
                            return (
                              <>
                                {needs ? (
                                  <CombinedDutyReasonField
                                    id={r.id}
                                    value={declaration}
                                    onChange={(next) =>
                                      setDeclarations((prev) => ({ ...prev, [r.id]: next }))
                                    }
                                  />
                                ) : null}
                                <button
                                  type="button"
                                  disabled={busy || (needs && combinedDutyTooShort(declaration))}
                                  onClick={() =>
                                    void run(() =>
                                      approveDataSharingApproval(r.id, needs ? declaration.trim() : undefined),
                                    )
                                  }
                                >
                                  {t('dsaApproveButton')}
                                </button>
                              </>
                            );
                          })()}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void run(() => declineDataSharingApproval(r.id))}
                          >
                            {t('dsaDeclineButton')}
                          </button>
                        </div>
                      ) : (
                        '—'
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        )
      ) : loadError ? null : (
        <SkeletonList rows={4} label={t('dsaLoading')} />
      )}
    </main>
  );
}
