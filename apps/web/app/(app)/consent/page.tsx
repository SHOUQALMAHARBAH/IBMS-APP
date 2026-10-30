'use client';

import { useCallback, useEffect, useState } from 'react';
import { EntitySearch } from '../../../components/ui/EntitySearch';
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  CONSENT_PURPOSES,
  type ConsentPurpose,
  confirmConsentWithdrawal,
  createConsentRecord,
  listConsentRecords,
  requestConsentWithdrawal,
  type ConsentRecord,
} from '../../../lib/pdpl/consent-api';
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
import { hasPermission } from '../../../lib/auth/permissions';
import { useLanguage } from '../../../lib/i18n/language-context';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';


export default function ConsentPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();
  const canManage = hasPermission(user, 'consent.manage');

  const [rows, setRows] = useState<ConsentRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [ownerKind, setOwnerKind] = useState<
    'customer' | 'insuredPerson' | 'lead'
  >('customer');
  const [ownerId, setOwnerId] = useState('');
  // `ConsentPurpose`, not `string`: `CONSENT_PURPOSES` is already `as const`, so the
  // union was available and the loose state was the only thing standing between the
  // label map and a total index.
  const [purpose, setPurpose] = useState<ConsentPurpose>(CONSENT_PURPOSES[2]); // MARKETING
  const [decision, setDecision] = useState<'grant' | 'decline'>('grant');
  const [consentTextVersion, setConsentTextVersion] = useState('');
  const [filterCustomerId, setFilterCustomerId] = useState('');

  const load = useCallback(async (customerId?: string) => {
    try {
      setRows(await listConsentRecords(customerId ? { customerId } : {}));
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? permissionRefusal(t, 'consRefusalAct', 'consent.manage')
          : err instanceof ApiError
            ? err.message
            : t('consLoadError'),
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

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setActionError(null);
    try {
      await createConsentRecord({
        ...(ownerKind === 'customer'
          ? { customerId: ownerId.trim() }
          : ownerKind === 'insuredPerson'
            ? { insuredPersonId: ownerId.trim() }
            : { leadId: ownerId.trim() }),
        purpose,
        granted: decision === 'grant',
        consentTextVersion: consentTextVersion.trim(),
      });
      setOwnerId('');
      setConsentTextVersion('');
      await load(filterCustomerId.trim() || undefined);
    } catch (err) {
      setActionError(
        actionErrorText(err, t, 'consSubmitError'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function onRequestWithdrawal(id: string) {
    setBusyId(id);
    setActionError(null);
    setNotice(null);
    try {
      const res = await requestConsentWithdrawal(id);
      setNotice(
        t('consWithdrawalLogged', {
          due: res.dueAt
            ? res.dueAt.slice(0, 10)
            : t('consWithdrawalSlaDeadline'),
        }),
      );
    } catch (err) {
      setActionError(
        actionErrorText(err, t, 'consRequestError'),
      );
    } finally {
      setBusyId(null);
    }
  }

  async function onConfirmWithdrawal(id: string) {
    setBusyId(id);
    setActionError(null);
    setNotice(null);
    try {
      await confirmConsentWithdrawal(id);
      await load(filterCustomerId.trim() || undefined);
    } catch (err) {
      setActionError(
        actionErrorText(err, t, 'consWithdrawError'),
      );
    } finally {
      setBusyId(null);
    }
  }

  async function onFilter(ev: React.FormEvent) {
    ev.preventDefault();
    await load(filterCustomerId.trim() || undefined);
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStackStyle}>
      <PageHeader
        title={t('consHeading')}
        description={t('consIntro')}
      />

      {canManage ? (
        <form
          onSubmit={submit}
          style={{
            margin: '1rem 0',
            display: 'grid',
            gap: 'var(--space-2)',
            maxWidth: '30rem',
          }}
        >
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}
          >
            {t('consDataSubjectKindLabel')}
            <select
              value={ownerKind}
              onChange={(e) =>
                setOwnerKind(
                  e.target.value as 'customer' | 'insuredPerson' | 'lead',
                )
              }
            >
              <option value="customer">{t('consKindCustomer')}</option>
              <option value="insuredPerson">{t('consKindInsuredPerson')}</option>
              <option value="lead">{t('consKindLead')}</option>
            </select>
          </label>
          {/* Only the customer branch gets a picker. An InsuredPerson has no
              list endpoint and a Lead's is a different search entirely, so
              those two keep the id field rather than get a picker that cannot
              search anything. */}
          {ownerKind === 'customer' ? (
            <EntitySearch
            kind="customer"
              value={ownerId}
              onChange={setOwnerId}
              label={t('consCustomerIdLabel')}
              required
            />
          ) : (
            <label
              style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}
            >
              {ownerKind === 'insuredPerson'
                ? t('consInsuredPersonIdLabel')
                : t('consLeadIdLabel')}
              <input
                aria-label={
                  ownerKind === 'insuredPerson'
                    ? t('consInsuredPersonIdLabel')
                    : t('consLeadIdLabel')
                }
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                required
              />
            </label>
          )}
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}
          >
            {t('consPurposeLabel')}
            {/* The cast below is this codebase's own convention for a `<select>`
                whose options are GENERATED from the union — `NewSlaPolicyForm`
                does the same — and it is sound because the option set IS the
                union: every value the handler can receive came from
                `CONSENT_PURPOSES`. */}
            <select
              aria-label={t('consPurposeLabel')}
              value={purpose}
              onChange={(e) => setPurpose(e.target.value as ConsentPurpose)}
            >
              {CONSENT_PURPOSES.map((p) => (
                <option key={p} value={p}>
                  {t(ENUM_LABEL.ConsentPurpose[p])}
                </option>
              ))}
            </select>
          </label>
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}
          >
            {t('consDecisionLabel')}
            <select
              aria-label={t('consDecisionLabel')}
              value={decision}
              onChange={(e) => setDecision(e.target.value as 'grant' | 'decline')}
            >
              <option value="grant">{t('consGrant')}</option>
              <option value="decline">{t('consDecline')}</option>
            </select>
          </label>
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}
          >
            {t('consTextVersionLabel')}
            <input
              aria-label={t('consTextVersionLabel')}
              placeholder={t('consTextVersionPlaceholder')}
              value={consentTextVersion}
              onChange={(e) => setConsentTextVersion(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={busy} style={{ marginTop: '0.3rem' }}>
            {busy ? t('consSavingButton') : t('consRecordButton')}
          </button>
        </form>
      ) : null}

      <form
        onSubmit={onFilter}
        style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', margin: '1rem 0' }}
      >
        <label
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}
        >
          {t('consFilterLabel')}
          <input
            aria-label={t('consFilterLabel')}
            value={filterCustomerId}
            onChange={(e) => setFilterCustomerId(e.target.value)}
          />
        </label>
        <button type="submit">{t('consFilterButton')}</button>
      </form>

      {notice ? <p style={{ opacity: 0.8 }}>{notice}</p> : null}
      {actionError ? (
        <ErrorState title={actionError} />
      ) : null}
      {loadError ? (
        <ErrorState title={loadError} />
      ) : null}

      {rows ? (
        rows.length === 0 ? (
          <EmptyState title={t('consNone')} />
        ) : (
          <Card padded={false}>
            <Table>
              <thead>
                <tr>
                  <Th>{t('consDataSubjectLabel')}</Th>
                  <Th>{t('consPurposeLabel')}</Th>
                  <Th>{t('consColMarketing')}</Th>
                  <Th>{t('consDecisionLabel')}</Th>
                  <Th>{t('consColStatus')}</Th>
                  <Th>{t('consColTextVersion')}</Th>
                  <Th>{t('consColActions')}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.id}>
                    <Td>
                      {/*
                        * RULE 2 — WHOSE consent, by name. This rendered `Lead <8 chars of a uuid>`
                        * or a bare sliced uuid on the one screen whose whole subject is who agreed
                        * to what.
                        *
                        * AND THE KIND MARKER IS BACK — OWNER DECISION 51, «عميل محتمل», the
                        * singular of the «العملاء المحتملون» that already ships in `leadsHeading`
                        * and `navLeads`. Removing the old `Lead ` prefix was right (it was
                        * hardcoded ENGLISH inside a template literal, so an Arabic reader saw it
                        * too) but it left the register unable to distinguish a lead from a
                        * customer, and that distinction is PDPL-significant: consent captured at
                        * lead capture pre-dates the customer record. The kind is derived from the
                        * id the api already sends, never from a second wire field.
                        */}
                      {r.subjectName ? (
                        r.leadId ? (
                          <>
                            <bdi>{r.subjectName}</bdi>{' '}
                            <span style={{ color: 'var(--ink-secondary)' }}>
                              ({t('consSubjectLead')})
                            </span>
                          </>
                        ) : (
                          <bdi>{r.subjectName}</bdi>
                        )
                      ) : (
                        '—'
                      )}
                    </Td>
                    {/*
                      Decision 59 — PURE OVERSIGHT, zero Arabic. `ConsentRecord.purpose`
                      is a `ConsentPurpose` ENUM and `ENUM_LABEL.ConsentPurpose` has
                      shipped all six members all along; this cell rendered the stored
                      value beside two cells that were already translated.

                      NOT the same field as `/ropa-entries`' `purpose`, which is a free
                      `String` a human typed and is CORRECT rendered raw. Same name, two
                      models, opposite answers — which is why `raw-stored-values.py` calls
                      this field AMBIGUOUS BY TYPE and why each site is read, not counted.
                    */}
                    <Td>
                      {t(ENUM_LABEL.ConsentPurpose[r.purpose])}
                    </Td>
                    <Td>{r.isMarketing ? t('commonYes') : t('commonNo')}</Td>
                    <Td>{r.granted ? t('consStatusGranted') : t('consStatusDeclined')}</Td>
                    <Td>
                      {r.withdrawnAt
                        ? `Withdrawn ${r.withdrawnAt.slice(0, 10)}`
                        : r.isActive
                          ? 'Active'
                          : t('consStatusNeverGranted')}
                    </Td>
                    <Td>{r.consentTextVersion}</Td>
                    <Td>
                      {canManage && r.isActive ? (
                        <div style={{ display: 'flex', gap: '0.35rem' }}>
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => void onRequestWithdrawal(r.id)}
                          >
                            {t('consRequestWithdrawal')}
                          </button>
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => void onConfirmWithdrawal(r.id)}
                          >
                            {t('consConfirmWithdrawal')}
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
        // This page previously rendered NOTHING while fetching — one of the
        // four states directive §2 requires. Guarded on loadError so the
        // error and a "Loading…" line cannot appear together.
        <SkeletonList rows={4} label={t('consLoading')} />
      )}
    </main>
  );
}
