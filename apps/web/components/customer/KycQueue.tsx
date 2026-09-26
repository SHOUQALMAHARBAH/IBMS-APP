"use client";

import { useCallback, useEffect, useState } from "react";
import {
  approveKyc,
  getScreeningHold,
  rejectKyc,
  runScreening,
  triggerEdd,
  type KycQueueRecord,
  type KycRecord,
  type KycStatus,
  type ScreeningHoldView,
} from "../../lib/kyc/kyc-api";
import { ApiError } from "../../lib/auth/api-client";
import { useAuth } from '../../lib/auth/auth-context';
import {
  CombinedDutyReasonField,
  combinedDutyTooShort,
  needsCombinedDutyDeclaration,
} from '../ui/CombinedDutyReasonField';
import { useLanguage } from "../../lib/i18n/language-context";
import type { TranslationKey } from "../../lib/i18n/translations";
import { errorStyle } from "../auth/auth-form.styles";
import { smallButtonStyle } from "../lead/lead.styles";
import { badgeStyle, queueCellStyle, queueTableStyle } from "./customer.styles";

interface KycQueueProps {
  items: KycQueueRecord[];
  onItemChanged: (updated: KycRecord) => void;
}

const STATUS_TONE: Record<
  KycRecord["status"],
  "neutral" | "warn" | "good" | "bad"
> = {
  DRAFT: "neutral",
  SUBMITTED: "neutral",
  SCREENING: "warn",
  EDD: "warn",
  COMPLIANCE_REVIEW: "warn",
  APPROVED: "good",
  REJECTED: "bad",
  PERIODIC_REVIEW_DUE: "warn",
};

const STATUS_LABEL_KEY: Record<KycStatus, TranslationKey> = {
  DRAFT: "kycStatusDraft",
  SUBMITTED: "kycStatusSubmitted",
  SCREENING: "kycStatusScreening",
  EDD: "kycStatusEdd",
  COMPLIANCE_REVIEW: "kycStatusComplianceReview",
  APPROVED: "kycStatusApproved",
  REJECTED: "kycStatusRejected",
  PERIODIC_REVIEW_DUE: "kycStatusPeriodicReviewDue",
};

const TYPE_LABEL_KEY: Record<"INDIVIDUAL" | "CORPORATE", TranslationKey> = {
  INDIVIDUAL: "customerTypeIndividual",
  CORPORATE: "customerTypeCorporate",
};

export function KycQueue({ items, onItemChanged }: KycQueueProps) {
  const { t } = useLanguage();
  // Part 4 — read here rather than taken as a prop: this component already renders its own controls from what
  // the caller passes, and threading the office's mode and the viewer's id through every caller of a shared
  // queue component is a wider change than reading the session the component is already inside.
  const { user } = useAuth();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});

  // Part B §17 — the screening hold, per decidable row.
  //
  // Fetched rather than derived from the row: the hold depends on
  // ScreeningResult attempt outcomes and on the match review queue, neither of
  // which the queue payload carries. A row whose hold has not loaded yet is
  // treated as HELD (the approve button stays disabled) — the opposite default
  // would let a mis-timed render offer the one action this whole feature
  // exists to gate.
  const [holds, setHolds] = useState<Record<string, ScreeningHoldView>>({});
  const [holdReason, setHoldReason] = useState<Record<string, string>>({});
  // Part 4 — the combined-duty reason, keyed by record like `holdReason` above it.
  const [dutyReason, setDutyReason] = useState<Record<string, string>>({});

  const decidableIds = items
    .filter(
      (item) =>
        (item.status === "SCREENING" && !item.isEdd) || item.status === "EDD",
    )
    .map((item) => item.id)
    .join(",");

  const loadHolds = useCallback(async () => {
    const ids = decidableIds ? decidableIds.split(",") : [];
    if (ids.length === 0) return;
    const loaded = await Promise.all(
      ids.map(async (id) => {
        try {
          return [id, await getScreeningHold(id)] as const;
        } catch {
          // A hold that cannot be read is not a hold that is absent. Leaving
          // it unset keeps the row disabled, which is the safe direction.
          return [id, null] as const;
        }
      }),
    );
    setHolds((prev) => {
      const next = { ...prev };
      for (const [id, view] of loaded) if (view) next[id] = view;
      return next;
    });
  }, [decidableIds]);

  useEffect(() => {
    // Async IIFE, not a bare `void loadHolds()`: the repo's
    // `react-hooks/set-state-in-effect` rule reads the direct call as a
    // synchronous setState in an effect. Same shape as `kyc-queue/page.tsx`.
    void (async () => {
      await loadHolds();
    })();
  }, [loadHolds]);

  async function run(id: string, action: () => Promise<KycRecord>) {
    setBusyId(id);
    setErrors((prev) => ({ ...prev, [id]: "" }));
    try {
      const updated = await action();
      onItemChanged(updated);
      // The hold can move as a side effect of the action (an approval records
      // a release; a re-screen changes the attempt outcome), so re-read it
      // rather than leaving a stale evaluation on screen.
      await loadHolds();
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : t("kycQueueActionFailed");
      setErrors((prev) => ({ ...prev, [id]: message }));
    } finally {
      setBusyId(null);
    }
  }

  if (items.length === 0) {
    return <p style={{ color: 'var(--ink-secondary)' }}>{t("kycQueueEmpty")}</p>;
  }

  return (
    <table style={queueTableStyle}>
      <thead>
        <tr>
          <th style={queueCellStyle}>{t("kycQueueColumnCustomer")}</th>
          <th style={queueCellStyle}>{t("commonStatus")}</th>
          <th style={queueCellStyle}>{t("commonActions")}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const isBusy = busyId === item.id;
          const hold = holds[item.id];
          // Part 4 — computed once here, like the other eleven approve controls: the field and the button
          // must agree, and two copies of the same condition are two places for them to stop agreeing.
          const needsDuty = needsCombinedDutyDeclaration({
            mode: user?.dutySegregationMode,
            makerUserId: item.createdByUserId,
            currentUserId: user?.id ?? '',
            alreadyDecided: false,
          });
          return (
            <tr key={item.id}>
              <td style={queueCellStyle}>
                <strong>
                  <bdi>{item.customer.legalName}</bdi>
                </strong>
                <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>
                  {t(TYPE_LABEL_KEY[item.customer.customerType])}
                </div>
              </td>
              <td style={queueCellStyle}>
                <span style={badgeStyle(STATUS_TONE[item.status])}>
                  {t(STATUS_LABEL_KEY[item.status])}
                </span>
                {item.isEdd ? (
                  <div style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>
                    {t("kycQueueHighRiskResult")}
                  </div>
                ) : null}
              </td>
              <td style={queueCellStyle}>
                {item.status === "SUBMITTED" ? (
                  <button
                    type="button"
                    style={smallButtonStyle}
                    disabled={isBusy}
                    onClick={() =>
                      void run(item.id, () => runScreening(item.id))
                    }
                  >
                    {t("kycQueueRunScreeningButton")}
                  </button>
                ) : null}
                {item.status === "SCREENING" && item.isEdd ? (
                  <button
                    type="button"
                    style={smallButtonStyle}
                    disabled={isBusy}
                    onClick={() => void run(item.id, () => triggerEdd(item.id))}
                  >
                    {t("kycQueueEnterEddButton")}
                  </button>
                ) : null}
                {(item.status === "SCREENING" && !item.isEdd) ||
                item.status === "EDD" ? (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.4rem",
                    }}
                  >
                    {hold === undefined ? (
                      <p
                        style={{ fontSize: "0.75rem", opacity: 0.7, margin: 0 }}
                      >
                        {t("kycHoldLoading")}
                      </p>
                    ) : null}
                    {hold && hold.level !== "NO_HOLD" ? (
                      <div
                        data-testid={`kyc-hold-${item.id}`}
                        data-hold-level={hold.level}
                        role={hold.level === "BLOCKED" ? "alert" : undefined}
                        style={{
                          ...badgeStyle(
                            hold.level === "BLOCKED" ? "bad" : "warn",
                          ),
                          display: "block",
                          fontSize: "0.75rem",
                          padding: "0.35rem 0.5rem",
                        }}
                      >
                        <strong>
                          {hold.level === "BLOCKED"
                            ? t("kycHoldBlocked")
                            : t("kycHoldReviewRequired")}
                        </strong>
                        <ul
                          style={{
                            margin: "0.3rem 0 0",
                            paddingInlineStart: "1rem",
                          }}
                        >
                          {hold.reasons.map((reason) => (
                            <li key={reason.condition}>{reason.detail}</li>
                          ))}
                        </ul>
                        {hold.level === "BLOCKED" ? (
                          <p style={{ margin: "0.3rem 0 0" }}>
                            {t("kycHoldBlockedExplainer")}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    {hold?.configurationProblems.length ? (
                      <p
                        role="alert"
                        style={{ ...errorStyle, fontSize: "0.7rem", margin: 0 }}
                      >
                        {t("kycHoldConfigProblems")}:{" "}
                        {hold.configurationProblems.join(" ")}
                      </p>
                    ) : null}
                    {hold?.level === "REVIEW_REQUIRED" ? (
                      <label
                        style={{
                          fontSize: "0.75rem",
                          display: "flex",
                          flexDirection: "column",
                          gap: "0.2rem",
                        }}
                      >
                        {t("kycHoldReasonLabel")}
                        <textarea
                          data-testid={`kyc-hold-reason-${item.id}`}
                          placeholder={t("kycHoldReasonPlaceholder")}
                          value={holdReason[item.id] ?? ""}
                          onChange={(e) =>
                            setHoldReason((prev) => ({
                              ...prev,
                              [item.id]: e.target.value,
                            }))
                          }
                          rows={2}
                          style={{ fontSize: "0.8rem", padding: "0.25rem" }}
                        />
                      </label>
                    ) : null}
                    {/*
                      Part 4 — the officer who captured the file may approve it in an office that has declared
                      COMBINED, only by saying why. Two reasons can be asked for on this one control and they
                      are different things: a screening-hold acceptance says why a sanctions finding is not
                      disqualifying, this says why one person is doing both halves.
                    */}
                    {needsDuty ? (
                      <CombinedDutyReasonField
                        id={item.id}
                        value={dutyReason[item.id] ?? ''}
                        onChange={(next) =>
                          setDutyReason((prev) => ({ ...prev, [item.id]: next }))
                        }
                      />
                    ) : null}
                    <button
                      type="button"
                      style={smallButtonStyle}
                      // Disabled while the hold is unknown, whenever it is
                      // BLOCKED, and until a REVIEW_REQUIRED hold has a stated
                      // acceptance. The API refuses all three independently —
                      // this only stops the request being sent to be refused.
                      disabled={
                        isBusy ||
                        hold === undefined ||
                        hold.level === "BLOCKED" ||
                        (hold.level === "REVIEW_REQUIRED" &&
                          !holdReason[item.id]?.trim()) ||
                        (needsDuty &&
                          combinedDutyTooShort(dutyReason[item.id] ?? ''))
                      }
                      onClick={() =>
                        void run(item.id, () =>
                          approveKyc(
                            item.id,
                            undefined,
                            holdReason[item.id]?.trim() || undefined,
                            needsDuty
                              ? dutyReason[item.id]?.trim()
                              : undefined,
                          ),
                        )
                      }
                    >
                      {t("kycQueueApproveButton")}
                    </button>
                    <input
                      placeholder={t("kycQueueRejectReasonPlaceholder")}
                      value={rejectReason[item.id] ?? ""}
                      onChange={(e) =>
                        setRejectReason((prev) => ({
                          ...prev,
                          [item.id]: e.target.value,
                        }))
                      }
                      style={{ fontSize: "0.8rem", padding: "0.25rem" }}
                    />
                    <button
                      type="button"
                      style={smallButtonStyle}
                      disabled={isBusy || !rejectReason[item.id]?.trim()}
                      onClick={() =>
                        void run(item.id, () =>
                          rejectKyc(item.id, rejectReason[item.id]),
                        )
                      }
                    >
                      {t("kycQueueRejectButton")}
                    </button>
                  </div>
                ) : null}
                {errors[item.id] ? (
                  <p
                    role="alert"
                    style={{
                      ...errorStyle,
                      fontSize: "0.75rem",
                      marginTop: "0.4rem",
                    }}
                  >
                    {errors[item.id]}
                  </p>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
