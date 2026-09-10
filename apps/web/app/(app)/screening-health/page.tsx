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
  const { language } = useLanguage();
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
          ? isArabic
            ? "لا تملك صلاحية sanctions-pep.screen."
            : "You don't hold the sanctions-pep.screen permission."
          : err instanceof ApiError
            ? err.message
            : isArabic
              ? "تعذّر تحميل حالة الفحص — حاول مرة أخرى."
              : "Could not load screening health — try again.",
      );
    } finally {
      setLoaded(true);
    }
  }, [isArabic]);

  useEffect(() => {
    if (!isLoading && !user) router.push("/login");
  }, [isLoading, user, router]);
  useEffect(() => {
    if (!user) return;
    // Async IIFE rather than a bare `void load()` — the same shape every other
    // screen in this app uses, and what `react-hooks/set-state-in-effect`
    // accepts.
    void (async () => {
      await load();
    })();
  }, [user, load]);

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
        {isArabic ? "حالة فحص العقوبات والأشخاص السياسيين" : "Screening health"}
      </h1>
      <p style={{ opacity: 0.75, maxWidth: "46rem" }}>
        {isArabic
          ? "يوضّح هذا الجدول أي مزوّد يُجري الفحص فعلياً، وما إذا كانت بياناته حديثة، وما الذي يغطيه. «غير مهيأ» أو «غير متاح» تعني أنّ الفحص لم يجرِ — وهي ليست نتيجة سلبية."
          : "Which provider actually performs screening, whether its data is current, and what it covers. NOT_CONFIGURED or UNAVAILABLE means screening did not happen — it is not a negative result."}
      </p>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {!loaded ? (
        <p style={{ opacity: 0.6 }}>
          {isArabic ? "جارٍ التحميل…" : "Loading…"}
        </p>
      ) : null}

      {health ? (
        <>
          <section style={card}>
            <h2 style={{ marginTop: 0 }}>
              {isArabic ? "المزوّد" : "Provider"}
            </h2>
            <div style={row}>
              <span>{isArabic ? "الحالة" : "Status"}</span>
              <span
                style={statusStyle(health.status)}
                data-status={health.status}
              >
                {statusLabel(health.status)}
              </span>
            </div>
            <div style={row}>
              <span>{isArabic ? "الحالة التفصيلية" : "State"}</span>
              <span data-state={health.state}>{health.state}</span>
            </div>
            <div style={row}>
              <span>{isArabic ? "النوع" : "Type"}</span>
              <span>{providerLabel(health.provider)}</span>
            </div>
            <div style={row}>
              <span>{isArabic ? "المصادقة" : "Authentication"}</span>
              <span data-auth={String(health.authenticationValid)}>
                {health.authenticationValid === true
                  ? isArabic
                    ? "مقبولة"
                    : "Accepted"
                  : health.authenticationValid === false
                    ? isArabic
                      ? "مرفوضة"
                      : "Rejected"
                    : isArabic
                      ? "لا تنطبق"
                      : "Not applicable"}
              </span>
            </div>
            <div style={row}>
              <span>{isArabic ? "الاسم" : "Name"}</span>
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
              {isArabic ? "القدرات والتغطية" : "Capabilities"}
            </h2>
            <p style={{ opacity: 0.75, marginTop: 0 }}>
              {isArabic
                ? "«مدعوم» يعني أنّ المحوّل ينفّذها، و«مهيّأ» يعني أنّ هذا النشر وفّر ما تحتاجه، و«فعّال» يعني أنّها تعمل الآن. الخلط بين الثلاثة هو ما يجعل نظاماً يدّعي تغطية لا يملكها."
                : "“Supported” means the adapter implements it; “Configured” means this deployment supplied what it needs; “Operational” means it works right now. Conflating the three is how a system claims coverage it does not have."}
            </p>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", minWidth: "34rem" }}>
                <thead>
                  <tr>
                    <th style={headCell}>
                      {isArabic ? "القدرة" : "Capability"}
                    </th>
                    <th style={headCell}>{isArabic ? "مدعوم" : "Supported"}</th>
                    <th style={headCell}>
                      {isArabic ? "مهيّأ" : "Configured"}
                    </th>
                    <th style={headCell}>
                      {isArabic ? "فعّال" : "Operational"}
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
                {isArabic
                  ? "فحص الأشخاص السياسيين (PEP) غير فعّال. لا يجوز اعتبار أي عميل «خالياً» من هذه الناحية."
                  : "PEP screening is NOT operational. No customer may be represented as clear of PEP status."}
              </p>
            ) : null}
          </section>

          <section style={card}>
            <h2 style={{ marginTop: 0 }}>
              {isArabic ? "البيانات" : "Dataset"}
            </h2>
            <div style={row}>
              <span>{isArabic ? "الإصدار" : "Version"}</span>
              <span>{health.datasetVersion ?? "—"}</span>
            </div>
            <div style={row}>
              <span>{isArabic ? "آخر تحديث" : "Last updated"}</span>
              <span>
                {health.datasetUpdatedAt
                  ? health.datasetUpdatedAt.slice(0, 16).replace("T", " ")
                  : "—"}
              </span>
            </div>
            <div style={row}>
              <span>{isArabic ? "وقت الفحص" : "Checked at"}</span>
              <span>{health.checkedAt.slice(0, 16).replace("T", " ")}</span>
            </div>
          </section>

          <section style={card}>
            <h2 style={{ marginTop: 0 }}>
              {isArabic ? "قواعد المطابقة" : "Matching rules"}
            </h2>
            <p style={{ opacity: 0.75, marginTop: 0 }}>
              {isArabic
                ? "هذه العتبات قابلة للتهيئة وتمثّل قرار مخاطر يخصّ الشركة — وليست قاعدة تنظيمية."
                : "These thresholds are configurable and represent the broker’s own risk appetite. They are not a regulatory rule."}
            </p>
            <div style={row}>
              <span>{isArabic ? "مرتفع" : "High"}</span>
              <span>{health.thresholds.high}</span>
            </div>
            <div style={row}>
              <span>{isArabic ? "مراجعة" : "Review"}</span>
              <span>{health.thresholds.review}</span>
            </div>
            <div style={row}>
              <span>{isArabic ? "تجاهل دون" : "Discard below"}</span>
              <span>{health.thresholds.low}</span>
            </div>
            <div style={row}>
              <span>
                {isArabic
                  ? "إرسال أرقام الهوية للمزوّد"
                  : "Send identifiers to provider"}
              </span>
              <span>
                {health.sendIdentifiers
                  ? isArabic
                    ? "نعم"
                    : "Yes"
                  : isArabic
                    ? "لا"
                    : "No"}
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
              {isArabic
                ? "فحص الاتصال يجيب: هل المزوّد متاح الآن؟ هذه الأرقام تجيب: كم عميلاً تم فحصه فعلاً؟"
                : "A health check answers whether the provider is reachable. These numbers answer how many customers were actually screened."}
            </p>
            {overview.attempts.total === 0 ? (
              <p data-testid="ops-attempts-empty" style={{ opacity: 0.7 }}>
                {isArabic
                  ? "لا توجد عمليات فحص مسجّلة في هذه الفترة."
                  : "No screening attempts recorded in this window."}
              </p>
            ) : (
              <>
                <div style={row}>
                  <span>{isArabic ? "الإجمالي" : "Total"}</span>
                  <span data-testid="ops-attempts-total">
                    {overview.attempts.total}
                  </span>
                </div>
                <div style={row}>
                  <strong>
                    {isArabic
                      ? "لم تُنتج نتيجة قابلة للاستخدام"
                      : "Did not produce a usable answer"}
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
                    {isArabic
                      ? "لم يتم فحص هؤلاء العملاء — ولم يُعتبروا خالين من المطابقة. راجع الأسباب أدناه."
                      : "These customers were NOT screened — and were not treated as clear. See the reasons below."}
                  </p>
                ) : null}
              </>
            )}
          </section>

          {/* ---------------- failures ---------------- */}
          {overview.attempts.recentUnresolved.length > 0 ? (
            <section style={card} data-testid="ops-failures">
              <h2 style={{ marginTop: 0 }}>
                {isArabic ? "أحدث الإخفاقات" : "Most recent failures"}
              </h2>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={headCell}>{isArabic ? "النتيجة" : "Outcome"}</th>
                    <th style={headCell}>
                      {isArabic ? "المزوّد" : "Provider"}
                    </th>
                    <th style={headCell}>{isArabic ? "السبب" : "Reason"}</th>
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
              {isArabic
                ? "الملفات الموقوفة وقائمة العمل"
                : "Holds and case workload"}
            </h2>
            <div style={row}>
              <span>
                {isArabic
                  ? "ملفات قابلة للقرار موقوفة حالياً"
                  : "Decidable files currently held"}
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
                {isArabic ? "مطابقات قيد الانتظار" : "Pending matches"}
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
                      {isArabic ? "حالة الحالة" : "Case state"}
                    </th>
                    <th style={headCell}>{isArabic ? "العدد" : "Count"}</th>
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
                {isArabic ? "لا توجد حالات مفتوحة." : "No open cases."}
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
              {isArabic
                ? "إصدارات قوائم العقوبات"
                : "Sanctions list generations"}
            </h2>
            <p style={{ opacity: 0.75, marginTop: 0 }}>
              {isArabic
                ? "يقرأ الفحص الإصدار المنشور فقط. الإصدار قيد التنزيل غير مرئي إطلاقاً."
                : "A screening reads only the PUBLISHED generation. One still downloading is invisible to it."}
            </p>
            {overview.datasets.length === 0 ? (
              <p
                role="alert"
                style={errorStyle}
                data-testid="ops-datasets-empty"
              >
                {isArabic
                  ? "لا يوجد أي إصدار — لم تكتمل أي مزامنة بعد، ولا يمكن اعتبار أي عميل خالياً من المطابقة."
                  : "No generation exists — no sync has completed, and no customer can be treated as clear."}
              </p>
            ) : (
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={headCell}>{isArabic ? "المصدر" : "Source"}</th>
                    <th style={headCell}>{isArabic ? "الحالة" : "Status"}</th>
                    <th style={headCell}>{isArabic ? "السجلات" : "Records"}</th>
                    <th style={headCell}>{isArabic ? "جديدة" : "Added"}</th>
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
                            {isArabic ? "تراجع: " : "Rolled back: "}
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
              {isArabic ? "المهام الدورية" : "Recurring work"}
            </h2>
            <div style={row}>
              <span>
                {isArabic ? "إعادة الفحص الدورية" : "Recurring re-screen"}
              </span>
              <span data-testid="ops-next-rescreen">
                {overview.schedules.rescreenBatch.nextRunAt ??
                  (isArabic ? "غير معروف" : "unknown")}
              </span>
            </div>
            <div style={row}>
              <span>{isArabic ? "مزامنة القوائم" : "List sync"}</span>
              <span data-testid="ops-next-sync">
                {overview.schedules.listSync.nextRunAt ??
                  (isArabic ? "غير معروف" : "unknown")}
              </span>
            </div>
            <div style={row}>
              <span>
                {isArabic ? "آخر مزامنة ناجحة" : "Last successful sync"}
              </span>
              <span data-testid="ops-last-sync-success">
                {overview.schedules.listSync.lastSuccessAt ??
                  (isArabic ? "لا يوجد" : "never")}
              </span>
            </div>
          </section>

          {/* ---------------- sync history ---------------- */}
          <section style={card} data-testid="ops-sync-history">
            <h2 style={{ marginTop: 0 }}>
              {isArabic ? "سجل المزامنة" : "Sync history"}
            </h2>
            {overview.listSync.length === 0 ? (
              <p style={{ opacity: 0.7 }} data-testid="ops-sync-empty">
                {isArabic
                  ? "لم تُشغَّل أي مزامنة بعد."
                  : "No sync has run yet."}
              </p>
            ) : (
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={headCell}>{isArabic ? "المصدر" : "Source"}</th>
                    <th style={headCell}>{isArabic ? "الحالة" : "Status"}</th>
                    <th style={headCell}>{isArabic ? "السجلات" : "Records"}</th>
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
