"use client";

import { type CSSProperties, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/auth/auth-context";
import { ApiError } from "../../../lib/auth/api-client";
import { errorStyle } from "../../../components/auth/auth-form.styles";
import { pageStyle } from "../../../components/lead/lead.styles";
import { useLanguage } from "../../../lib/i18n/language-context";
import {
  getScreeningHealth,
  getScreeningOverview,
  type ScreeningHealth,
  type ScreeningOverview,
} from "../../../lib/screening/screening-config-api";

/**
 * Screening provider + data health.
 *
 * The screen exists so that "no provider is configured" and "the dataset is
 * stale" are VISIBLE. Both otherwise look identical to a working system that
 * simply found nothing — which is the failure this whole part of the build is
 * about.
 */

const card: CSSProperties = {
  border: "1px solid #d1d5db",
  borderRadius: 6,
  padding: "1rem",
  marginBottom: "1rem",
  maxWidth: "46rem",
};

const headCell: CSSProperties = {
  padding: "0.35rem 0.7rem",
  textAlign: "start",
  fontWeight: 600,
  borderBottom: "2px solid #d1d5db",
};

const bodyCell: CSSProperties = {
  padding: "0.35rem 0.7rem",
  textAlign: "start",
  verticalAlign: "top",
  borderBottom: "1px solid #f3f4f6",
};

const row: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "1rem",
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
  const isArabic = language === "AR";

  const [health, setHealth] = useState<ScreeningHealth | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [overview, setOverview] = useState<ScreeningOverview | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      // Both in one pass: the provider answers "can I reach it right now?",
      // the overview answers "how many customers were actually screened?".
      // A screen showing only the first is the one that reads green while a
      // third of screenings are failing.
      const [nextHealth, nextOverview] = await Promise.all([
        getScreeningHealth(),
        getScreeningOverview(30),
      ]);
      setHealth(nextHealth);
      setOverview(nextOverview);
      setLoadError(null);
    } catch (err) {
      setHealth(null);
      setOverview(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? t('shYouDonTHoldThe')
          : err instanceof ApiError
            ? err.message
            : t('shCouldNotLoadScreeningHealth'),
      );
    } finally {
      setLoaded(true);
    }
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

  const statusLabel = (status: string): string => {
    if (!isArabic) return status;
    const ar: Record<string, string> = {
      HEALTHY: "سليم",
      DEGRADED: "متدهور",
      UNAVAILABLE: "غير متاح",
      NOT_CONFIGURED: "غير مهيأ",
    };
    return ar[status] ?? status;
  };

  const providerLabel = (kind: string): string => {
    if (!isArabic) return kind;
    const ar: Record<string, string> = {
      built_in: "القائمة المحلية المزامنة",
      on_premise: "محرك فحص محلي",
      commercial: "مزوّد تجاري",
    };
    return ar[kind] ?? kind;
  };

  return (
    <main style={pageStyle}>
      <h1>
        {t('shScreeningHealth')}
      </h1>
      <p style={{ opacity: 0.75, maxWidth: "46rem" }}>
        {t('shWhichProviderActuallyPerformsScreening')}
      </p>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {!loaded ? (
        <p style={{ color: 'var(--ink-secondary)' }}>
          {t('shLoading')}
        </p>
      ) : null}

      {health ? (
        <>
          <section style={card}>
            <h2 style={{ marginTop: 0 }}>
              {t('shProvider')}
            </h2>
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
              <span data-state={health.state}>{health.state}</span>
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
            <p style={{ marginBottom: 0, opacity: 0.85 }}>{health.detail}</p>

            {health.missing.length > 0 ? (
              <p role="alert" style={{ ...errorStyle, marginTop: "0.75rem" }}>
                {isArabic
                  ? `إعدادات ناقصة: ${health.missing.join(", ")}. الفحص الآلي غير مهيأ، ومراجعة الامتثال مطلوبة قبل متابعة سير العمل.`
                  : `Missing configuration: ${health.missing.join(", ")}. Automated screening provider is not configured. Compliance review is required before the applicable workflow can proceed.`}
              </p>
            ) : null}
          </section>

          <section style={card}>
            <h2 style={{ marginTop: 0 }}>
              {t('shCapabilities')}
            </h2>
            <p style={{ opacity: 0.75, marginTop: 0 }}>
              {t('shSupportedMeansTheAdapterImplements')}
            </p>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", minWidth: "34rem" }}>
                <thead>
                  <tr>
                    <th style={headCell}>
                      {t('shCapability')}
                    </th>
                    <th style={headCell}>{t('shSupported')}</th>
                    <th style={headCell}>
                      {t('shConfigured')}
                    </th>
                    <th style={headCell}>
                      {t('shOperational')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {health.capabilities.map((c) => (
                    <tr key={c.capability} data-capability={c.capability}>
                      <td style={bodyCell}>
                        <div style={{ fontWeight: 600 }}>{c.capability}</div>
                        <div style={{ fontSize: "0.8rem", opacity: 0.7 }}>
                          {c.note}
                        </div>
                      </td>
                      <td style={bodyCell} data-supported={String(c.supported)}>
                        {c.supported ? "✓" : "—"}
                      </td>
                      <td
                        style={bodyCell}
                        data-configured={String(c.configured)}
                      >
                        {c.configured ? "✓" : "—"}
                      </td>
                      <td
                        style={bodyCell}
                        data-operational={String(c.operational)}
                      >
                        {c.operational ? "✓" : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!health.pepOperational ? (
              <p role="alert" style={{ ...errorStyle, marginTop: "0.75rem" }}>
                {t('shPepScreeningIsNotOperational')}
              </p>
            ) : null}
          </section>

          <section style={card}>
            <h2 style={{ marginTop: 0 }}>
              {t('shDataset')}
            </h2>
            <div style={row}>
              <span>{t('shVersion')}</span>
              <span>{health.datasetVersion ?? "—"}</span>
            </div>
            <div style={row}>
              <span>{t('shLastUpdated')}</span>
              <span>
                {health.datasetUpdatedAt
                  ? health.datasetUpdatedAt.slice(0, 16).replace("T", " ")
                  : "—"}
              </span>
            </div>
            <div style={row}>
              <span>{t('shCheckedAt')}</span>
              <span>{health.checkedAt.slice(0, 16).replace("T", " ")}</span>
            </div>
          </section>

          <section style={card}>
            <h2 style={{ marginTop: 0 }}>
              {t('shMatchingRules')}
            </h2>
            <p style={{ opacity: 0.75, marginTop: 0 }}>
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
              <p role="alert" style={{ ...errorStyle, marginTop: "0.75rem" }}>
                {health.thresholdProblems.join("; ")}
              </p>
            ) : null}
          </section>
        </>
      ) : null}
      {overview ? (
        <>
          {/* ---------------- screening volume ---------------- */}
          <section style={card} data-testid="ops-attempts">
            <h2 style={{ marginTop: 0 }}>
              {isArabic
                ? `عمليات الفحص (آخر ${overview.windowDays} يوماً)`
                : `Screening attempts (last ${overview.windowDays} days)`}
            </h2>
            <p style={{ opacity: 0.75, marginTop: 0 }}>
              {t('shAHealthCheckAnswersWhether')}
            </p>
            {overview.attempts.total === 0 ? (
              <p data-testid="ops-attempts-empty" style={{ opacity: 0.7 }}>
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
                {Object.entries(overview.attempts.byOutcome).map(
                  ([outcome, count]) => (
                    <div key={outcome} style={row} data-outcome={outcome}>
                      <span>{outcome}</span>
                      <span>{count}</span>
                    </div>
                  ),
                )}
                {overview.attempts.unresolved > 0 ? (
                  <p
                    role="alert"
                    style={{ ...errorStyle, marginTop: "0.75rem" }}
                  >
                    {t('shTheseCustomersWereNotScreened')}
                  </p>
                ) : null}
              </>
            )}
          </section>

          {/* ---------------- failures ---------------- */}
          {overview.attempts.recentUnresolved.length > 0 ? (
            <section style={card} data-testid="ops-failures">
              <h2 style={{ marginTop: 0 }}>
                {t('shMostRecentFailures')}
              </h2>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={headCell}>{t('shOutcome')}</th>
                    <th style={headCell}>
                      {t('shProvider2')}
                    </th>
                    <th style={headCell}>{t('shReason')}</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.attempts.recentUnresolved.map((row_) => (
                    <tr key={row_.correlationId}>
                      <td style={bodyCell}>{row_.outcome}</td>
                      <td style={bodyCell}>{row_.providerName}</td>
                      {/* The reason names the remedy, never the customer. */}
                      <td style={bodyCell}>{row_.failureReason ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          {/* ---------------- holds and case workload ---------------- */}
          <section style={card} data-testid="ops-holds">
            <h2 style={{ marginTop: 0 }}>
              {t('shHoldsAndCaseWorkload')}
            </h2>
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
                {isArabic
                  ? `حالات رفع الإيقاف (آخر ${overview.windowDays} يوماً)`
                  : `Holds released (last ${overview.windowDays} days)`}
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
                    <th style={headCell}>
                      {t('shCaseState')}
                    </th>
                    <th style={headCell}>{t('shCount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(overview.caseWorkload).map(
                    ([state, count]) => (
                      <tr key={state} data-case-state={state}>
                        <td style={bodyCell}>{state}</td>
                        <td style={bodyCell}>{count}</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            ) : (
              <p style={{ opacity: 0.7 }} data-testid="ops-cases-empty">
                {t('shNoOpenCases')}
              </p>
            )}
            {overview.holds.configurationProblems.length > 0 ? (
              <p role="alert" style={{ ...errorStyle, marginTop: "0.75rem" }}>
                {overview.holds.configurationProblems.join(" ")}
              </p>
            ) : null}
          </section>

          {/* ---------------- dataset generations ---------------- */}
          <section style={card} data-testid="ops-datasets">
            <h2 style={{ marginTop: 0 }}>
              {t('shSanctionsListGenerations')}
            </h2>
            <p style={{ opacity: 0.75, marginTop: 0 }}>
              {t('shAScreeningReadsOnlyThe')}
            </p>
            {overview.datasets.length === 0 ? (
              <p
                role="alert"
                style={errorStyle}
                data-testid="ops-datasets-empty"
              >
                {t('shNoGenerationExistsNoSync')}
              </p>
            ) : (
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={headCell}>{t('shSource')}</th>
                    <th style={headCell}>{t('shStatus2')}</th>
                    <th style={headCell}>{t('shRecords')}</th>
                    <th style={headCell}>{t('shAdded')}</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.datasets.map((d) => (
                    <tr
                      key={d.id}
                      data-dataset-status={d.status}
                      data-dataset-source={d.source}
                    >
                      <td style={bodyCell}>{d.source}</td>
                      <td style={bodyCell}>
                        <span style={statusStyle(d.status)}>{d.status}</span>
                        {d.rejectionReason ? (
                          <div style={{ fontSize: "0.75rem", opacity: 0.8 }}>
                            {d.rejectionReason}
                          </div>
                        ) : null}
                        {d.rollbackReason ? (
                          <div style={{ fontSize: "0.75rem", opacity: 0.8 }}>
                            {t('shRolledBack')}
                            {d.rollbackReason}
                          </div>
                        ) : null}
                      </td>
                      <td style={bodyCell}>{d.recordCount ?? "—"}</td>
                      <td style={bodyCell}>{d.addedCount ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* ---------------- schedules ---------------- */}
          <section style={card} data-testid="ops-schedules">
            <h2 style={{ marginTop: 0 }}>
              {t('shRecurringWork')}
            </h2>
            <div style={row}>
              <span>
                {t('shRecurringReScreen')}
              </span>
              <span data-testid="ops-next-rescreen">
                {overview.schedules.rescreenBatch.nextRunAt ??
                  (t('shUnknown'))}
              </span>
            </div>
            <div style={row}>
              <span>{t('shListSync')}</span>
              <span data-testid="ops-next-sync">
                {overview.schedules.listSync.nextRunAt ??
                  (t('shUnknown2'))}
              </span>
            </div>
            <div style={row}>
              <span>
                {t('shLastSuccessfulSync')}
              </span>
              <span data-testid="ops-last-sync-success">
                {overview.schedules.listSync.lastSuccessAt ??
                  (t('shNever'))}
              </span>
            </div>
          </section>

          {/* ---------------- sync history ---------------- */}
          <section style={card} data-testid="ops-sync-history">
            <h2 style={{ marginTop: 0 }}>
              {t('shSyncHistory')}
            </h2>
            {overview.listSync.length === 0 ? (
              <p style={{ opacity: 0.7 }} data-testid="ops-sync-empty">
                {t('shNoSyncHasRunYet')}
              </p>
            ) : (
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={headCell}>{t('shSource2')}</th>
                    <th style={headCell}>{t('shStatus3')}</th>
                    <th style={headCell}>{t('shRecords2')}</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.listSync.map((r, i) => (
                    <tr key={`${r.source}-${r.startedAt}-${i}`}>
                      <td style={bodyCell}>{r.source}</td>
                      <td style={bodyCell}>
                        {r.status}
                        {r.errorMessage ? (
                          <div
                            style={{ fontSize: "0.75rem", color: "#b91c1c" }}
                          >
                            {r.errorMessage}
                          </div>
                        ) : null}
                      </td>
                      <td style={bodyCell}>{r.recordCount ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
