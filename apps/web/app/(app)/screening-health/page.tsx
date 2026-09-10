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
  type ScreeningHealth,
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
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      setHealth(await getScreeningHealth());
      setLoadError(null);
    } catch (err) {
      setHealth(null);
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
              <span>{isArabic ? "النوع" : "Type"}</span>
              <span>{providerLabel(health.provider)}</span>
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
              {isArabic ? "التغطية" : "Coverage"}
            </h2>
            <div style={row}>
              <span>{isArabic ? "العقوبات" : "Sanctions"}</span>
              <span data-coverage-sanctions={String(health.coverage.sanctions)}>
                {health.coverage.sanctions
                  ? isArabic
                    ? "مُغطّى"
                    : "Covered"
                  : isArabic
                    ? "غير مُغطّى"
                    : "Not covered"}
              </span>
            </div>
            <div style={row}>
              <span>{isArabic ? "الأشخاص السياسيون (PEP)" : "PEP"}</span>
              <span data-coverage-pep={String(health.coverage.pep)}>
                {health.coverage.pep
                  ? isArabic
                    ? "مُغطّى"
                    : "Covered"
                  : isArabic
                    ? "غير مُغطّى"
                    : "Not covered"}
              </span>
            </div>
            <p style={{ marginBottom: 0, opacity: 0.85 }}>
              {health.coverage.note}
            </p>
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
    </main>
  );
}
