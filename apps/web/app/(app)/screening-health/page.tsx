"use client";

import {
  Card,
  ErrorState,
  Note,
  Table,
  Td,
  Th,
  Tr,
} from '../../../components/ui';
import { Fragment, type CSSProperties, useCallback, useEffect, useState } from "react";
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/auth/auth-context";
import { ApiError } from "../../../lib/auth/api-client";
import { pageStackStyle } from "../../../components/lead/lead.styles";
import { formatDate } from '../../../lib/i18n/format';
import { useLanguage } from "../../../lib/i18n/language-context";
import {
  loadIndependently,
  namedFailures,
} from '../../../lib/load-independently';
import {
  CAPABILITY_NOTE_LABEL_KEY,
  getScreeningHealth,
  getScreeningOverview,
  PROVIDER_CAPABILITY_LABEL_KEY,
  type ProviderHealthStatus,
  type ScreeningAttemptOutcome,
  type ScreeningHealth,
  type ScreeningOverview,
  type ScreeningProviderKind,
} from "../../../lib/screening/screening-config-api";
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';

/**
 * Screening provider + data health.
 *
 * The screen exists so that "no provider is configured" and "the dataset is
 * stale" are VISIBLE. Both otherwise look identical to a working system that
 * simply found nothing — which is the failure this whole part of the build is
 * about.
 */

const row: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 'var(--space-4)',
  padding: "0.3rem 0",
  borderBottom: "1px solid #f3f4f6",
};

function statusStyle(status: string): CSSProperties {
  return {
    display: "inline-block",
    padding: "0.15rem 0.5rem",
    borderRadius: 4,
    fontWeight: 700,
    border: "2px solid currentColor",
    // HEALTHY is the only understated one; everything else must draw the eye.
    opacity: status === "HEALTHY" ? 0.8 : 1,
  };
}

export default function ScreeningHealthPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { language, t } = useLanguage();

  const [health, setHealth] = useState<ScreeningHealth | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [overview, setOverview] = useState<ScreeningOverview | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    // Both in one pass: the provider answers "can I reach it right now?",
    // the overview answers "how many customers were actually screened?".
    // A screen showing only the first is the one that reads green while a
    // third of screenings are failing.
    //
    // ITEM 8 — which is exactly why losing one must not blank the other. The old shape set BOTH to
    // null on either failure, so a refused overview produced a screen claiming nothing at all is
    // known about screening, including the provider status that had answered. Each panel renders
    // what arrived and the sentence names what did not.
    const { values, failures } = await loadIndependently([
      { key: 'health', label: t('shListHealth'), load: getScreeningHealth },
      {
        key: 'overview',
        label: t('shListOverview'),
        load: () => getScreeningOverview(30),
      },
    ]);
    setHealth((values.health as ScreeningHealth | undefined) ?? null);
    setOverview((values.overview as ScreeningOverview | undefined) ?? null);
    const refused = failures.find(
      (f) => f.error instanceof ApiError && f.error.status === 403,
    );
    setLoadError(
      failures.length === 0
        ? null
        : failures.length === 2 && refused
          ? permissionRefusal(t, 'shRefusalAct', 'sanctions-pep.screen')
          : `${t('commonListsMissing')} ${namedFailures(failures)}`,
    );
    setLoaded(true);
  }, [t]);

  useEffect(() => {
    if (!isLoading && !user) router.push("/login");
  }, [isLoading, user, router, t]);
  useEffect(() => {
    if (!user) return;
    // Async IIFE rather than a bare `void load()` — the same shape every other
    // screen in this app uses, and what `react-hooks/set-state-in-effect`
    // accepts.
    void (async () => {
      await load();
    })();
  }, [user, load, t]);

  if (isLoading || !user) return null;

  /*
   * BOTH OF THESE WERE LOCAL ARABIC MAPS THAT RETURNED THE RAW TOKEN TO AN ENGLISH READER.
   *
   * Each opened `if (!isArabic) return status`, so on a compliance screen an English reader saw
   * `HEALTHY` and `built_in` verbatim — and the four health words were a second, undiacriticised
   * copy of `ENUM_LABEL.ProviderHealthStatus`, which has shipped both languages the whole time.
   * The same dead-vocabulary shape owner answer 2 is about, two maps over, found by reading the
   * file for the two rows she named.
   *
   * AND THERE IS NO FALL-THROUGH LEFT, which is better than what replaced them first. My own
   * first version typed both parameters `string` and kept a `?? token` fallback, with a note
   * claiming the fields "arrive over HTTP as `string`". `tsc` refused it (TS7053) and was right:
   * this client has declared `ProviderHealthStatus` and `ScreeningProviderKind` all along, and
   * `health.status` / `health.provider` are already typed with them — only my two signatures said
   * `string`. Taking the unions makes each lookup TOTAL, so a fifth member is a compile error in
   * `ENUM_LABEL` rather than a raw token on a compliance screen. That is owner answer 2's own
   * mechanism, applied to the two maps she did not name.
   */
  const statusLabel = (status: ProviderHealthStatus): string =>
    t(ENUM_LABEL.ProviderHealthStatus[status]);

  const providerLabel = (kind: ScreeningProviderKind): string =>
    t(ENUM_LABEL.ScreeningProviderKind[kind]);

  return (
    <main style={pageStackStyle}>
      <h1>
        {t('shScreeningHealth')}
      </h1>
      <p style={{ color: 'var(--ink-secondary)', maxWidth: "46rem" }}>
        {t('shWhichProviderActuallyPerformsScreening')}
      </p>

      {loadError ? (
        <ErrorState title={loadError} />
      ) : null}

      {!loaded ? (
        <p style={{ color: 'var(--ink-secondary)' }}>
          {t('shLoading')}
        </p>
      ) : null}

      {health ? (
        <>
          <Card title={t('shProvider')}>
            <div style={row}>
              <span>{t('shStatus')}</span>
              <span
                style={statusStyle(health.status)}
                data-status={health.status}
              >
                {statusLabel(health.status)}
              </span>
            </div>
            <div style={row}>
              <span>{t('shState')}</span>
              <span data-state={health.state}>
                {t(ENUM_LABEL.ProviderHealthState[health.state])}
              </span>
            </div>
            <div style={row}>
              <span>{t('shType')}</span>
              <span>{providerLabel(health.provider)}</span>
            </div>
            <div style={row}>
              <span>{t('shAuthentication')}</span>
              <span data-auth={String(health.authenticationValid)}>
                {health.authenticationValid === true
                  ? t('shAccepted')
                  : health.authenticationValid === false
                    ? t('shRejected')
                    : t('shNotApplicable')}
              </span>
            </div>
            <div style={row}>
              <span>{t('shName')}</span>
              <span>{health.providerName}</span>
            </div>
            <p style={{ marginBottom: 0, color: 'var(--ink-secondary)' }}>{health.detail}</p>

            {health.missing.length > 0 ? (
              /*
                Was an `isArabic ? … : …` ternary. BOTH languages were present, so this was never a
                missing translation — it was three strings the i18n parity guard and the collision
                check could not see, because they bypassed the dictionary. Moved in so they are
                audited with the rest.
              */
              <ErrorState
                title={t('shMissingConfig', { missing: health.missing.join(', ') })}
              />
            ) : null}
          </Card>

          <Card title={t('shCapabilities')}>
            <p style={{ color: 'var(--ink-secondary)', marginTop: 0 }}>
              {t('shSupportedMeansTheAdapterImplements')}
            </p>
            {/*
              NO SECOND SCROLLER. This screen used to wrap the table in its own
              `overflow-x: auto` div, and `Table` has provided one since batch 3 — WITH
              `tabIndex={0}`, because a scroll container nothing can focus is a region a keyboard
              user cannot scroll at all. An unfocusable scroller around a focusable one is that
              same defect one level out, and axe is silent about it because the OUTER div rarely
              overflows. Measured: 17 sites across 10 files still do this.
            */}
            <Table>
                <thead>
                  <tr>
                    <Th>
                      {t('shCapability')}
                    </Th>
                    <Th>{t('shSupported')}</Th>
                    <Th>
                      {t('shConfigured')}
                    </Th>
                    <Th>
                      {t('shOperational')}
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {health.capabilities.map((c) => (
                    <Fragment key={c.capability}>
                    <Tr data-capability={c.capability}>
                      <Td>
                        <div
                          style={{ fontWeight: 600, marginBottom: 'var(--space-1)' }}
                        >
                          {t(PROVIDER_CAPABILITY_LABEL_KEY[c.capability])}
                        </div>
                        {c.note.kind === 'CAUTION' ? null : (
                          <div
                            style={{ fontSize: "0.8rem", color: 'var(--ink-secondary)' }}
                            data-note-kind={c.note.kind}
                          >
                            {t(
                              CAPABILITY_NOTE_LABEL_KEY[c.note.key],
                              c.note.params,
                            )}
                          </div>
                        )}
                      </Td>
                      <Td data-supported={String(c.supported)}>
                        {c.supported ? "✓" : "—"}
                      </Td>
                      <Td
                        data-configured={String(c.configured)}
                      >
                        {c.configured ? "✓" : "—"}
                      </Td>
                      <Td
                        data-operational={String(c.operational)}
                      >
                        {c.operational ? "✓" : "—"}
                      </Td>
                    </Tr>
                    {/*
                      A CAUTION IS NOT A FOOTNOTE, AND IT DOES NOT FIT ONE CELL.

                      Three of these sentences were named by the owner as WARNINGS rather than
                      descriptions, and the commercial one rides a row whose three columns all
                      tick — so grey text under the name would make a caution look like
                      decoration, which is the defect she named by hand.

                      It spans the row because MEASURED on a 390px phone the capability column is
                      111px, a `Note` spends ~47 of that on padding, icon and gap, and the text
                      then rendered at 62px wide and 299px TALL. Her own rule for the ring
                      caption: where a thing does not fit the space, change the SPACE.

                      NO `role`, deliberately. A live region is for content that UPDATES; these
                      are static from first render and are reached in document order. What tells
                      a reader who cannot see the box is the SENTENCE, which says the thing
                      explicitly — the icon is decorative and carries no label, so the colour is
                      redundant encoding rather than the only encoding.
                    */}
                    {c.note.kind === 'CAUTION' ? (
                      <Tr data-capability-caution={c.capability}>
                        <Td colSpan={4}>
                          <Note
                            tone="warning"
                            icon="alert"
                            data-note-kind={c.note.kind}
                          >
                            {t(
                              CAPABILITY_NOTE_LABEL_KEY[c.note.key],
                              c.note.params,
                            )}
                          </Note>
                        </Td>
                      </Tr>
                    ) : null}
                    </Fragment>
                  ))}
                </tbody>
            </Table>
            {!health.pepOperational ? (
              <ErrorState title={t('shPepScreeningIsNotOperational')} />
            ) : null}
          </Card>

          <Card title={t('shDataset')}>
            <div style={row}>
              <span>{t('shVersion')}</span>
              <span>{health.datasetVersion ?? "—"}</span>
            </div>
            <div style={row}>
              <span>{t('shLastUpdated')}</span>
              <span>
                {health.datasetUpdatedAt
                  ? formatDate(health.datasetUpdatedAt, language)
                  : "—"}
              </span>
            </div>
            <div style={row}>
              <span>{t('shCheckedAt')}</span>
              <span>{formatDate(health.checkedAt, language)}</span>
            </div>
          </Card>

          <Card title={t('shMatchingRules')}>
            <p style={{ color: 'var(--ink-secondary)', marginTop: 0 }}>
              {t('shTheseThresholdsAreConfigurableAnd')}
            </p>
            <div style={row}>
              <span>{t('shHigh')}</span>
              <span>{health.thresholds.high}</span>
            </div>
            <div style={row}>
              <span>{t('shReview')}</span>
              <span>{health.thresholds.review}</span>
            </div>
            <div style={row}>
              <span>{t('shDiscardBelow')}</span>
              <span>{health.thresholds.low}</span>
            </div>
            <div style={row}>
              <span>
                {t('shSendIdentifiersToProvider')}
              </span>
              <span>
                {health.sendIdentifiers
                  ? t('shYes')
                  : t('shNo')}
              </span>
            </div>
            {health.thresholdProblems.length > 0 ? (
              <ErrorState title={health.thresholdProblems.join("; ")} />
            ) : null}
          </Card>
        </>
      ) : null}
      {overview ? (
        <>
          {/* ---------------- screening volume ---------------- */}
          <Card title={t('shScreeningAttempts', { days: overview.windowDays })} data-testid="ops-attempts">
            <p style={{ color: 'var(--ink-secondary)', marginTop: 0 }}>
              {t('shAHealthCheckAnswersWhether')}
            </p>
            {overview.attempts.total === 0 ? (
              <p data-testid="ops-attempts-empty" style={{ color: 'var(--ink-secondary)' }}>
                {t('shNoScreeningAttemptsRecordedIn')}
              </p>
            ) : (
              <>
                <div style={row}>
                  <span>{t('shTotal')}</span>
                  <span data-testid="ops-attempts-total">
                    {overview.attempts.total}
                  </span>
                </div>
                <div style={row}>
                  <strong>
                    {t('shDidNotProduceAUsable')}
                  </strong>
                  <strong
                    data-testid="ops-unresolved-rate"
                    data-unresolved={overview.attempts.unresolved}
                    style={{
                      color:
                        overview.attempts.unresolved > 0
                          ? "#b91c1c"
                          : undefined,
                    }}
                  >
                    {overview.attempts.unresolved} (
                    {Math.round(overview.attempts.unresolvedRate * 100)}%)
                  </strong>
                </div>
                {/* OWNER ANSWER 3, AND IT NEEDED NO WORD. These keys are
                    `ScreeningAttemptOutcome` members — there is no `CLEAR` and no `ERROR` on
                    this wire — and `ENUM_LABEL.ScreeningAttemptOutcome` has mapped all five to
                    bilingual keys since before this screen rendered one raw. Her own `ERROR`
                    word, «تعذّر الفحص», IS `screenOutcomeUnableToScreen`. */}
                {(
                  Object.entries(overview.attempts.byOutcome) as [
                    ScreeningAttemptOutcome,
                    number,
                  ][]
                ).map(([outcome, count]) => (
                  <div key={outcome} style={row} data-outcome={outcome}>
                    <span>{t(ENUM_LABEL.ScreeningAttemptOutcome[outcome])}</span>
                    <span>{count}</span>
                  </div>
                ))}
                {overview.attempts.unresolved > 0 ? (
                  <ErrorState title={t('shTheseCustomersWereNotScreened')} />
                ) : null}
              </>
            )}
          </Card>

          {/* ---------------- failures ---------------- */}
          {overview.attempts.recentUnresolved.length > 0 ? (
            <Card title={t('shMostRecentFailures')} data-testid="ops-failures">
              <Table>
                <thead>
                  <tr>
                    <Th>{t('shOutcome')}</Th>
                    <Th>
                      {t('shProvider2')}
                    </Th>
                    <Th>{t('shReason')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {overview.attempts.recentUnresolved.map((row_) => (
                    <Tr key={row_.correlationId}>
                      <Td>{t(ENUM_LABEL.ScreeningAttemptOutcome[row_.outcome])}</Td>
                      <Td>{row_.providerName}</Td>
                      {/* The reason names the remedy, never the customer. */}
                      <Td>{row_.failureReason ?? "—"}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          ) : null}

          {/* ---------------- holds and case workload ---------------- */}
          <Card title={t('shHoldsAndCaseWorkload')} data-testid="ops-holds">
            <div style={row}>
              <span>
                {t('shDecidableFilesCurrentlyHeld')}
              </span>
              <strong data-testid="ops-active-holds">
                {overview.holds.activeHolds} / {overview.holds.decidableFiles}
              </strong>
            </div>
            <div style={row}>
              <span>
                {t('shHoldsReleased', { days: overview.windowDays })}
              </span>
              <span data-testid="ops-holds-released">
                {overview.holds.releasedInWindow}
              </span>
            </div>
            <div style={row}>
              <span>
                {t('shPendingMatches')}
              </span>
              <span data-testid="ops-pending-matches">
                {overview.matchQueue.pending}
              </span>
            </div>
            {Object.entries(overview.caseWorkload).length > 0 ? (
              <table
                style={{
                  borderCollapse: "collapse",
                  width: "100%",
                  marginTop: "0.75rem",
                }}
                data-testid="ops-case-workload"
              >
                <thead>
                  <tr>
                    <Th>
                      {t('shCaseState')}
                    </Th>
                    <Th>{t('shCount')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(overview.caseWorkload).map(
                    ([state, count]) => (
                      <Tr key={state} data-case-state={state}>
                        <Td>{state}</Td>
                        <Td>{count}</Td>
                      </Tr>
                    ),
                  )}
                </tbody>
              </table>
            ) : (
              <p style={{ color: 'var(--ink-secondary)' }} data-testid="ops-cases-empty">
                {t('shNoOpenCases')}
              </p>
            )}
            {overview.holds.configurationProblems.length > 0 ? (
              <ErrorState title={overview.holds.configurationProblems.join(" ")} />
            ) : null}
          </Card>

          {/* ---------------- dataset generations ---------------- */}
          <Card title={t('shSanctionsListGenerations')} data-testid="ops-datasets">
            <p style={{ color: 'var(--ink-secondary)', marginTop: 0 }}>
              {t('shAScreeningReadsOnlyThe')}
            </p>
            {overview.datasets.length === 0 ? (
              <ErrorState title={t('shNoGenerationExistsNoSync')} data-testid="ops-datasets-empty" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t('shSource')}</Th>
                    <Th>{t('shStatus2')}</Th>
                    <Th>{t('shRecords')}</Th>
                    <Th>{t('shAdded')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {overview.datasets.map((d) => (
                    <tr
                      key={d.id}
                      data-dataset-status={d.status}
                      data-dataset-source={d.source}
                    >
                      <Td>{t(ENUM_LABEL.WatchlistSource[d.source])}</Td>
                      <Td>
                        <span style={statusStyle(d.status)}>{t(ENUM_LABEL.DatasetVersionStatus[d.status])}</span>
                        {d.rejectionReason ? (
                          <div style={{ fontSize: "0.75rem", color: 'var(--ink-secondary)' }}>
                            {d.rejectionReason}
                          </div>
                        ) : null}
                        {d.rollbackReason ? (
                          <div style={{ fontSize: "0.75rem", color: 'var(--ink-secondary)' }}>
                            {t('shRolledBack')}
                            {d.rollbackReason}
                          </div>
                        ) : null}
                      </Td>
                      <Td>{d.recordCount ?? "—"}</Td>
                      <Td>{d.addedCount ?? "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          {/* ---------------- schedules ---------------- */}
          <Card title={t('shRecurringWork')} data-testid="ops-schedules">
            <div style={row}>
              <span>
                {t('shRecurringReScreen')}
              </span>
              <span data-testid="ops-next-rescreen">
                {overview.schedules.rescreenBatch.nextRunAt
                  ? formatDate(overview.schedules.rescreenBatch.nextRunAt, language)
                  : t('shUnknown')}
              </span>
            </div>
            <div style={row}>
              <span>{t('shListSync')}</span>
              <span data-testid="ops-next-sync">
                {overview.schedules.listSync.nextRunAt
                  ? formatDate(overview.schedules.listSync.nextRunAt, language)
                  : t('shUnknown2')}
              </span>
            </div>
            <div style={row}>
              <span>
                {t('shLastSuccessfulSync')}
              </span>
              <span data-testid="ops-last-sync-success">
                {overview.schedules.listSync.lastSuccessAt
                  ? formatDate(overview.schedules.listSync.lastSuccessAt, language)
                  : t('shNever')}
              </span>
            </div>
          </Card>

          {/* ---------------- sync history ---------------- */}
          <Card title={t('shSyncHistory')} data-testid="ops-sync-history">
            {overview.listSync.length === 0 ? (
              <p style={{ color: 'var(--ink-secondary)' }} data-testid="ops-sync-empty">
                {t('shNoSyncHasRunYet')}
              </p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t('shSource2')}</Th>
                    <Th>{t('shStatus3')}</Th>
                    <Th>{t('shRecords2')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {overview.listSync.map((r, i) => (
                    <Tr key={`${r.source}-${r.startedAt}-${i}`}>
                      <Td>{t(ENUM_LABEL.WatchlistSource[r.source])}</Td>
                      <Td>
                        {t(ENUM_LABEL.WatchlistSyncRunStatus[r.status])}
                        {r.errorMessage ? (
                          <div
                            style={{ fontSize: "0.75rem", color: "#b91c1c" }}
                          >
                            {r.errorMessage}
                          </div>
                        ) : null}
                      </Td>
                      <Td>{r.recordCount ?? "—"}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </>
      ) : null}
    </main>
  );
}
