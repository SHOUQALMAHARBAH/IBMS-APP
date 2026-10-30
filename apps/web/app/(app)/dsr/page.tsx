'use client';

import { useCallback, useEffect, useState } from 'react';
import { EntitySearch } from '../../../components/ui/EntitySearch';
import { WorkflowHistoryLink } from '../../../components/ui/WorkflowHistoryLink';
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth/auth-context';
import {
  CombinedDutyReasonField,
  combinedDutyTooShort,
  needsCombinedDutyDeclaration,
} from '../../../components/ui/CombinedDutyReasonField';
import {
  applyDsrExtension,
  assignDsr,
  closeDsr,
  createDsr,
  DSR_INTAKE_CHANNELS,
  DSR_REQUEST_TEXT_MAX_LENGTH,
  DSR_REQUEST_TEXT_MIN_LENGTH,
  DSR_TYPES,
  fulfilDsr,
  listDsrs,
  partiallyFulfilDsr,
  rejectDsr,
  startDsr,
  verifyDsrIdentity,
  type DataSubjectRequest,
} from '../../../lib/pdpl/dsr-api';
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
import { DsrClockControl } from '../../../components/pdpl/DsrClockControl';
import { CombinedDutyOnRecord } from '../../../components/ui/CombinedDutyOnRecord';
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';

const LOG_ROLES = [
  'dsr.log',
];
const HANDLE_ROLES = [
  'dsr.handle',
];
const CLOSE_ROLES = [
  'dsr.close',
];


export default function DsrPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();
  const canLog = hasAnyPermission(user, LOG_ROLES);
  const canHandle = hasAnyPermission(user, HANDLE_ROLES);
  const canClose = hasAnyPermission(user, CLOSE_ROLES);

  const [rows, setRows] = useState<DataSubjectRequest[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Part 4 — the combined-duty reason, keyed by record so two rows cannot share one box.
  const [declarations, setDeclarations] = useState<Record<string, string>>({});

  const [customerId, setCustomerId] = useState('');
  const [requestText, setRequestText] = useState('');
  // Defaults to the channel a request most often arrives through here. Not blank: a blank first
  // option in a REQUIRED select is a field somebody submits without reading.
  const [intakeChannel, setIntakeChannel] = useState<string>('WEBSITE_FORM');
  const [type, setType] = useState<string>(DSR_TYPES[0]!);
  const [text, setText] = useState<Record<string, string>>({});
  const [reference, setReference] = useState<Record<string, string>>({});
  const [confirmNoHold, setConfirmNoHold] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      setRows(await listDsrs());
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? permissionRefusal(t, 'dsrRefusalAct', 'dsr.log')
          : err instanceof ApiError
            ? err.message
            : t('dsrLoadError'),
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
        err instanceof ApiError ? err.message : t('dsrActionError'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    await run(async () => {
      await createDsr({
        customerId: customerId.trim(),
        type,
        requestText: requestText.trim(),
        intakeChannel,
      });
      setCustomerId('');
      setRequestText('');
    });
  }

  const val = (id: string) => (text[id] ?? '').trim();
  const setVal = (id: string, v: string) => setText((t) => ({ ...t, [id]: v }));
  const ref = (id: string) => (reference[id] ?? '').trim();
  const setRef = (id: string, v: string) =>
    setReference((t) => ({ ...t, [id]: v }));

  if (isLoading || !user) return null;

  return (
    <main style={pageStackStyle}>
      <PageHeader
        title={t('dsrHeading')}
        description={t('dsrIntro')}
      />

      {canLog ? (
        <form
          onSubmit={submit}
          style={{ margin: '1rem 0', display: 'grid', gap: 'var(--space-2)', maxWidth: '30rem' }}
        >
          <EntitySearch
            kind="customer"
            value={customerId}
            onChange={setCustomerId}
            label={t('dsrCustomerIdLabel')}
            required
          />
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {t('dsrTypeLabel')}
            <select
              aria-label={t('dsrTypeLabel')}
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              {DSR_TYPES.map((opt) => (
                <option key={opt} value={opt}>
                  {t(ENUM_LABEL.DsrType[opt])}
                </option>
              ))}
            </select>
          </label>
          {/*
            WHAT WAS ASKED FOR, and HOW IT ARRIVED — both REQUIRED by the api's DTO.

            These two inputs ship with the api rather than with the design batch, and that is a
            stated departure: a required field with no input is not a deferred screen, it is a
            create path that 400s on every submit. Their PLACEMENT, wording polish and the
            deadline-and-conditions line that belongs at intake are still the design batch's.
          */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {t('dsrRequestTextLabel')}
            <textarea
              aria-label={t('dsrRequestTextLabel')}
              value={requestText}
              onChange={(e) => setRequestText(e.target.value)}
              rows={3}
              required
              minLength={DSR_REQUEST_TEXT_MIN_LENGTH}
              maxLength={DSR_REQUEST_TEXT_MAX_LENGTH}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {t('dsrChannelLabel')}
            <select
              aria-label={t('dsrChannelLabel')}
              value={intakeChannel}
              onChange={(e) => setIntakeChannel(e.target.value)}
            >
              {DSR_INTAKE_CHANNELS.map((opt) => (
                <option key={opt} value={opt}>
                  {t(ENUM_LABEL.DsrIntakeChannel[opt])}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={busy} style={{ marginTop: '0.3rem' }}>
            {busy ? t('dsrSavingButton') : t('dsrLogButton')}
          </button>
        </form>
      ) : null}

      {actionError ? (
        <ErrorState title={actionError} />
      ) : null}
      {loadError ? (
        <ErrorState title={loadError} />
      ) : null}

      {rows ? (
        rows.length === 0 ? (
          <EmptyState title={t('dsrNone')} />
        ) : (
          <Card padded={false}>
            <Table>
              <thead>
                <tr>
                  <Th>{t('dsrColCustomer')}</Th>
                  <Th>{t('dsrTypeLabel')}</Th>
                  <Th>{t('dsrColStatus')}</Th>
                  <Th>{t('dsrColSlaDue')}</Th>
                  <Th>{t('dsrColAction')}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <Tr key={d.id}>
                    <Td>
                      {/*
                        DOOR FOUR'S WAY IN, for the DPO. An open DSR he is handling opens that
                        customer's RFQ chain, and until this link existed the system admitted him to
                        a record no screen told him the id of.
                        CONDITIONAL ON THERE BEING A CUSTOMER: `customerId` is nullable and an
                        insured-person request names none, so a request about nobody links nowhere.
                        And it goes to the customer-FILTERED list, never to `/customers/[id]` —
                        the customer page is not what the anchor opens, so linking it would answer
                        404 from the ownership layer about a record that exists.
                      */}
                      {d.customerId ? (
                        <a
                          href={`/rfqs?customerId=${encodeURIComponent(d.customerId)}`}
                          data-customer-rfqs={d.customerId}
                        >
                          {t('dsrViewCustomerRfqs')}
                        </a>
                      ) : (
                        `${(d.insuredPersonId ?? '—').slice(0, 8)}…`
                      )}
                    </Td>
                    <Td>{t(ENUM_LABEL.DsrType[d.type])}</Td>
                    <Td>{t(ENUM_LABEL.DsrStatus[d.status])}</Td>
                    <Td>
                      {d.slaDueAt.slice(0, 10)}
                      {d.isOverdue ? ` ${t('statusOverdue')}` : ''}
                    </Td>
                    <Td>
                      {/* Owner decision 41 — carries this request's id into `/audit-trail`'s
                          workflow-history fields. Renders nothing without `workflow-history.read`,
                          which the DPO does not hold, so on this screen it is for the compliance
                          officer and the external auditor. */}
                      <div style={{ marginBottom: '0.4rem' }}>
                        <WorkflowHistoryLink
                          entityType="DataSubjectRequest"
                          entityId={d.id}
                        />
                      </div>
                      {d.status === 'CLOSED' ? (
                        /* A closed request has no actions left, so this cell held a bare em-dash.
                           Part 4 step 5 — if ONE person both logged and closed it, that is the one
                           thing still worth saying here, and `closedByUserId` alone cannot say it.
                           Renders the em-dash when there is no act, which is every ordinary
                           closure. */
                        d.combinedDutyAct ? (
                          <CombinedDutyOnRecord
                            act={d.combinedDutyAct}
                            testId={`combined-duty-dsr-${d.id}`}
                          />
                        ) : (
                          '—'
                        )
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: '18rem' }}>
                          {canHandle ? (
                            <input
                              aria-label={t('dsrTextAria')}
                              placeholder={t('dsrTextPlaceholder')}
                              value={text[d.id] ?? ''}
                              onChange={(e) => setVal(d.id, e.target.value)}
                            />
                          ) : null}
                          {canHandle && d.status === 'IN_PROGRESS' ? (
                            <input
                              aria-label={t('dsrRetentionRefAria')}
                              placeholder={t('dsrRetentionRefPlaceholder')}
                              value={reference[d.id] ?? ''}
                              onChange={(e) => setRef(d.id, e.target.value)}
                            />
                          ) : null}
                          {canHandle && d.type === 'DELETION' && d.status === 'IN_PROGRESS' ? (
                            <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                              <input
                                type="checkbox"
                                aria-label={t('dsrNoRetentionHoldAria')}
                                checked={confirmNoHold[d.id] ?? false}
                                onChange={(e) =>
                                  setConfirmNoHold((c) => ({
                                    ...c,
                                    [d.id]: e.target.checked,
                                  }))
                                }
                              />
                              {t('dsrNoRetentionHold')}
                            </label>
                          ) : null}
                          {/* The statutory clock, controlled from the request itself —
                            * the DPO holds `sla.timer.pause` and cannot open the
                            * deadlines dashboard (IMPROVEMENTS § 1.61). Gated on that
                            * permission inside the component, not on `dsr.handle`:
                            * stopping a compliance clock is the same act here as
                            * anywhere else. */}
                          <DsrClockControl
                            requestId={d.id}
                            closed={d.closedAt !== null}
                          />
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                            {canHandle && d.status === 'RECEIVED' ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void run(() => verifyDsrIdentity(d.id))}
                              >
                                {t('dsrVerifyIdentity')}
                              </button>
                            ) : null}
                            {canHandle && d.status === 'IDENTITY_VERIFIED' ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void run(() => startDsr(d.id))}
                              >
                                {t('dsrStartButton')}
                              </button>
                            ) : null}
                            {canHandle &&
                            ['RECEIVED', 'IDENTITY_VERIFIED', 'IN_PROGRESS'].includes(
                              d.status,
                            ) ? (
                              <button
                                type="button"
                                disabled={busy || !val(d.id)}
                                onClick={() => void run(() => assignDsr(d.id, val(d.id)))}
                              >
                                {t('dsrAssignButton')}
                              </button>
                            ) : null}
                            {canHandle && d.type === 'ACCESS' && d.status === 'IN_PROGRESS' && !d.accessExtensionAppliedAt ? (
                              <button
                                type="button"
                                disabled={busy || !val(d.id)}
                                onClick={() =>
                                  void run(() => applyDsrExtension(d.id, val(d.id)))
                                }
                              >
                                {t('dsrExtendButton')}
                              </button>
                            ) : null}
                            {canHandle && d.status === 'IN_PROGRESS' ? (
                              <button
                                type="button"
                                disabled={busy || (d.type === 'DELETION' && !confirmNoHold[d.id])}
                                onClick={() =>
                                  void run(() => fulfilDsr(d.id, confirmNoHold[d.id]))
                                }
                              >
                                {t('dsrFulfilButton')}
                              </button>
                            ) : null}
                            {canHandle && d.status === 'IN_PROGRESS' ? (
                              <button
                                type="button"
                                disabled={busy || !ref(d.id) || !val(d.id)}
                                onClick={() =>
                                  void run(() =>
                                    partiallyFulfilDsr(d.id, {
                                      retentionScheduleReference: ref(d.id),
                                      partialFulfilmentJustification: val(d.id),
                                    }),
                                  )
                                }
                              >
                                {t('dsrPartiallyFulfilButton')}
                              </button>
                            ) : null}
                            {canHandle &&
                            ['RECEIVED', 'IDENTITY_VERIFIED', 'IN_PROGRESS'].includes(
                              d.status,
                            ) ? (
                              <button
                                type="button"
                                disabled={busy || !val(d.id)}
                                onClick={() => void run(() => rejectDsr(d.id, val(d.id)))}
                              >
                                {t('dsrRejectButton')}
                              </button>
                            ) : null}
                            {canClose &&
                            ['FULFILLED', 'PARTIALLY_FULFILLED', 'REJECTED'].includes(
                              d.status,
                            ) ? (
                              (() => {
                                // Part 4 — the person who performed the first half may complete it themselves in an office
                                // that has declared COMBINED, only by saying why. Every other case is unchanged.
                                const needs = needsCombinedDutyDeclaration({
                                  mode: user.dutySegregationMode,
                                  makerUserId: d.processedByUserId,
                                  currentUserId: user.id,
                                  alreadyDecided: d.closedByUserId != null,
                                });
                                const declaration = declarations[d.id] ?? '';
                                return (
                                  <>
                                    {needs ? (
                                      <CombinedDutyReasonField
                                        id={d.id}
                                        value={declaration}
                                        onChange={(next) =>
                                          setDeclarations((prev) => ({ ...prev, [d.id]: next }))
                                        }
                                      />
                                    ) : null}
                                    <button
                                      type="button"
                                      disabled={busy || (needs && combinedDutyTooShort(declaration))}
                                      onClick={() =>
                                        void run(() =>
                                          closeDsr(d.id, needs ? declaration.trim() : undefined),
                                        )
                                      }
                                    >
                                      {t('dsrCloseButton')}
                                    </button>
                                  </>
                                );
                              })()
                            ) : null}
                          </div>
                        </div>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        )
      ) : loadError ? null : (
        <SkeletonList rows={4} label={t('dsrLoading')} />
      )}
    </main>
  );
}
