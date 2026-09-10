"use client";

import { type CSSProperties, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/auth/auth-context";
import { ApiError } from "../../../lib/auth/api-client";
import { errorStyle } from "../../../components/auth/auth-form.styles";
import { pageStyle } from "../../../components/lead/lead.styles";
import { useLanguage } from "../../../lib/i18n/language-context";
import {
  activateSlaPolicy,
  deactivateSlaPolicy,
  listSlaPolicies,
  updateSlaPolicy,
  type SlaPolicy,
  type SlaPolicyStatus,
} from "../../../lib/sla/sla-policy-api";

const MANAGE_ROLES = [
  "COMPLIANCE_OFFICER",
  "BRANCH_DEPARTMENT_MANAGER",
  "EXECUTIVE_MANAGEMENT",
];
const STATUSES: (SlaPolicyStatus | "ALL")[] = [
  "ALL",
  "ACTIVE",
  "DRAFT",
  "INACTIVE",
];

const cell: CSSProperties = {
  padding: "0.45rem 0.75rem",
  borderBottom: "1px solid #e5e7eb",
  textAlign: "start",
  verticalAlign: "top",
};
const head: CSSProperties = {
  ...cell,
  fontWeight: 600,
  borderBottom: "2px solid #d1d5db",
};

/** Regulatory is visually distinct from every other source, deliberately. The
 * whole point of the feature is that a reader can tell at a glance whether
 * missing a deadline breaks the law or misses an internal target. */
function sourceBadgeStyle(isRegulatory: boolean): CSSProperties {
  return {
    display: "inline-block",
    padding: "0.1rem 0.45rem",
    borderRadius: 4,
    fontSize: "0.78rem",
    fontWeight: 600,
    border: "1px solid currentColor",
    opacity: isRegulatory ? 1 : 0.75,
  };
}

export default function SlaPoliciesPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { language } = useLanguage();
  const isArabic = language === "AR";
  const canManage = !!user && user.roles.some((r) => MANAGE_ROLES.includes(r));

  const [status, setStatus] = useState<SlaPolicyStatus | "ALL">("ACTIVE");
  const [rows, setRows] = useState<SlaPolicy[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = useCallback(
    async (next: SlaPolicyStatus | "ALL") => {
      try {
        setRows(
          await listSlaPolicies(next === "ALL" ? undefined : { status: next }),
        );
        setLoadError(null);
      } catch (err) {
        setRows(null);
        setLoadError(
          err instanceof ApiError && err.status === 403
            ? isArabic
              ? "لا تملك صلاحية sla.policy.read."
              : "You don't hold the sla.policy.read permission."
            : err instanceof ApiError
              ? err.message
              : isArabic
                ? "تعذّر تحميل سياسات مستوى الخدمة — حاول مرة أخرى."
                : "Could not load SLA policies — try again.",
        );
      }
    },
    [isArabic],
  );

  useEffect(() => {
    if (!isLoading && !user) router.push("/login");
  }, [isLoading, user, router]);
  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load(status);
    })();
  }, [user, status, load]);

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      await load(status);
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.message
          : isArabic
            ? "فشل تنفيذ الإجراء — حاول مرة أخرى."
            : "That action failed — try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (isLoading || !user) return null;

  const unitLabel = (unit: string): string => {
    const en: Record<string, string> = {
      MINUTES: "minutes",
      HOURS: "hours",
      BUSINESS_DAYS: "business days",
      CALENDAR_DAYS: "calendar days",
      MONTHS: "months",
    };
    const ar: Record<string, string> = {
      MINUTES: "دقيقة",
      HOURS: "ساعة",
      BUSINESS_DAYS: "يوم عمل",
      CALENDAR_DAYS: "يوم تقويمي",
      MONTHS: "شهر",
    };
    return (isArabic ? ar : en)[unit] ?? unit;
  };

  const sourceText = (policy: SlaPolicy): string => {
    if (!isArabic) return policy.sourceLabel;
    const ar: Record<string, string> = {
      REGULATORY: "تنظيمي",
      INTERNAL_POLICY: "سياسة داخلية",
      CONTRACTUAL: "تعاقدي",
      OPERATIONAL: "تشغيلي",
      OTHER: "أخرى",
    };
    const base = ar[policy.sourceType] ?? policy.sourceType;
    if (!policy.isRegulatory) return base;
    const cite = [policy.sourceDocument, policy.sourceSection]
      .filter(Boolean)
      .join(" ");
    return cite ? `${base} — ${cite}` : base;
  };

  return (
    <main style={pageStyle}>
      <h1>{isArabic ? "سياسات مستوى الخدمة" : "SLA policies"}</h1>
      <p style={{ opacity: 0.75, maxWidth: "50rem" }}>
        {isArabic
          ? "كل مهلة زمنية في النظام قابلة للتهيئة من هنا دون تغيير في الشيفرة. الأهم: يوضّح هذا الجدول مصدر كل مهلة — «تنظيمي» يعني أنّ هناك نصاً قانونياً يوجبها ويُذكر مرجعه، وأي تصنيف آخر يعني أنّها هدف داخلي وليست إلزاماً قانونياً."
          : "Every deadline in the system is configured here, with no code change. More importantly, this table states where each deadline COMES FROM: “Regulatory” means an instrument requires it and names that instrument; any other classification means it is an internal target, not a legal obligation."}
      </p>

      <div style={{ display: "flex", gap: "0.4rem", margin: "1rem 0" }}>
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            disabled={busy}
            style={{ fontWeight: s === status ? 700 : 400 }}
          >
            {s}
          </button>
        ))}
      </div>

      {actionError ? (
        <p role="alert" style={errorStyle}>
          {actionError}
        </p>
      ) : null}
      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {rows ? (
        rows.length === 0 ? (
          <p style={{ opacity: 0.6 }}>
            {isArabic ? "لا توجد سياسات." : "No policies."}
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", minWidth: "72rem" }}>
              <thead>
                <tr>
                  <th style={head}>{isArabic ? "العملية" : "Process"}</th>
                  <th style={head}>{isArabic ? "المهلة" : "Duration"}</th>
                  <th style={head}>{isArabic ? "المصدر" : "Source"}</th>
                  <th style={head}>{isArabic ? "التقويم" : "Calendar"}</th>
                  <th style={head}>{isArabic ? "الحالة" : "Status"}</th>
                  <th style={head}>{isArabic ? "إجراء" : "Action"}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td style={cell}>
                      <div style={{ fontWeight: 600 }}>{p.policyName}</div>
                      <div style={{ fontSize: "0.8rem", opacity: 0.7 }}>
                        {p.policyCode}
                      </div>
                      <div style={{ fontSize: "0.8rem", opacity: 0.7 }}>
                        {p.processType}
                        {p.workflowState ? ` · ${p.workflowState}` : ""}
                      </div>
                    </td>
                    <td style={cell}>
                      {canManage ? (
                        <div style={{ display: "flex", gap: "0.3rem" }}>
                          <input
                            aria-label={`Duration for ${p.policyName}`}
                            type="number"
                            min={0}
                            value={drafts[p.id] ?? String(p.durationValue)}
                            onChange={(e) =>
                              setDrafts((d) => ({
                                ...d,
                                [p.id]: e.target.value,
                              }))
                            }
                            style={{ width: "5rem" }}
                          />
                          <span>{unitLabel(p.durationUnit)}</span>
                        </div>
                      ) : (
                        <span>
                          {p.durationValue} {unitLabel(p.durationUnit)}
                        </span>
                      )}
                    </td>
                    <td style={cell}>
                      <span
                        style={sourceBadgeStyle(p.isRegulatory)}
                        data-regulatory={p.isRegulatory ? "true" : "false"}
                      >
                        {sourceText(p)}
                      </span>
                      {!p.isRegulatory ? (
                        <div style={{ fontSize: "0.78rem", opacity: 0.7 }}>
                          {isArabic
                            ? "ليست إلزاماً قانونياً"
                            : "Not a legal requirement"}
                        </div>
                      ) : null}
                    </td>
                    <td style={cell}>
                      {p.calendarType === "CONTINUOUS_24_7"
                        ? isArabic
                          ? "على مدار الساعة"
                          : "24/7"
                        : p.calendarType === "CUSTOM"
                          ? isArabic
                            ? "مخصّص"
                            : "Custom"
                          : isArabic
                            ? "أيام العمل (الأردن)"
                            : "Jordan working days"}
                    </td>
                    <td style={cell}>{p.status}</td>
                    <td style={cell}>
                      {canManage ? (
                        <div style={{ display: "flex", gap: "0.3rem" }}>
                          <button
                            type="button"
                            disabled={
                              busy ||
                              (drafts[p.id] ?? String(p.durationValue)) ===
                                String(p.durationValue)
                            }
                            onClick={() =>
                              void run(async () => {
                                await updateSlaPolicy(p.id, {
                                  durationValue: Number(drafts[p.id]),
                                });
                                setDrafts((d) => {
                                  const next = { ...d };
                                  delete next[p.id];
                                  return next;
                                });
                              })
                            }
                          >
                            {isArabic ? "حفظ" : "Save"}
                          </button>
                          {p.status === "ACTIVE" ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void run(() => deactivateSlaPolicy(p.id))
                              }
                            >
                              {isArabic ? "إيقاف" : "Deactivate"}
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void run(() => activateSlaPolicy(p.id))
                              }
                            >
                              {isArabic ? "تفعيل" : "Activate"}
                            </button>
                          )}
                        </div>
                      ) : (
                        <span style={{ opacity: 0.6 }}>
                          {isArabic ? "للاطلاع فقط" : "Read only"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </main>
  );
}
