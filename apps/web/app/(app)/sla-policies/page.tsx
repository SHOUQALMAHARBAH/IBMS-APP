"use client";

import { type CSSProperties, useCallback, useEffect, useState } from "react";
import { ENUM_LABEL } from '../../../lib/i18n/enum-labels';
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
import { hasPermission } from '../../../lib/auth/permissions';

const STATUSES: (SlaPolicyStatus | "ALL")[] = [
  "ALL",
  "ACTIVE",
  "DRAFT",
  "INACTIVE",
];

const cell: CSSProperties = {
  padding: "0.45rem 0.75rem",
  borderBottom: "1px solid var(--border-subtle)",
  textAlign: "start",
  verticalAlign: "top",
};
const head: CSSProperties = {
  ...cell,
  fontWeight: 600,
  borderBottom: "2px solid var(--border-default)",
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
  const { language, t } = useLanguage();
  const isArabic = language === "AR";
  const canManage = hasPermission(user, 'sla.policy.manage');

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
            ? t('slapYouDonTHoldThe')
            : err instanceof ApiError
              ? err.message
              : t('slapCouldNotLoadSlaPolicies'),
        );
      }
    },
    [t],
  );

  useEffect(() => {
    if (!isLoading && !user) router.push("/login");
  }, [isLoading, user, router, t]);
  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load(status);
    })();
  }, [user, status, load, t]);

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
          : t('slapThatActionFailedTryAgain'),
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
      <h1>{t('slapSlaPolicies')}</h1>
      <p style={{ opacity: 0.75, maxWidth: "50rem" }}>
        {t('slapEveryDeadlineInTheSystem')}
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
          <p style={{ color: 'var(--ink-secondary)' }}>
            {t('slapNoPolicies')}
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", minWidth: "72rem" }}>
              <thead>
                <tr>
                  <th style={head}>{t('slapProcess')}</th>
                  <th style={head}>{t('slapDuration')}</th>
                  <th style={head}>{t('slapSource')}</th>
                  <th style={head}>{t('slapCalendar')}</th>
                  <th style={head}>{t('slapStatus')}</th>
                  <th style={head}>{t('slapAction')}</th>
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
                            aria-label={t('slapDurationAria', { name: p.policyName })}
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
                          {t('slapNotALegalRequirement')}
                        </div>
                      ) : null}
                    </td>
                    <td style={cell}>
                      {p.calendarType === "CONTINUOUS_24_7"
                        ? t('slap247')
                        : p.calendarType === "CUSTOM"
                          ? t('slapCustom')
                          : t('slapJordanWorkingDays')}
                    </td>
                    <td style={cell}>{t(ENUM_LABEL.SlaPolicyStatus[p.status])}</td>
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
                            {t('slapSave')}
                          </button>
                          {p.status === "ACTIVE" ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void run(() => deactivateSlaPolicy(p.id))
                              }
                            >
                              {t('slapDeactivate')}
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void run(() => activateSlaPolicy(p.id))
                              }
                            >
                              {t('slapActivate')}
                            </button>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--ink-secondary)' }}>
                          {t('slapReadOnly')}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : loadError ? null : (
        // The loading state directive §2 requires; this page rendered
        // nothing at all while fetching. Guarded on loadError so an error
        // and a "Loading…" line never appear together.
        <p>{t('slapLoading')}</p>
      )}
    </main>
  );
}
