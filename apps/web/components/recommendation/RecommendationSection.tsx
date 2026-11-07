"use client";

import { useCallback, useEffect, useState } from "react";
import {
  approveRecommendation,
  discloseConflictOfInterest,
  downloadRecommendationDocument,
  draftRecommendation,
  listRecommendationsForOpportunity,
  sendRecommendation,
  RATIONALE_FACTOR_FIELDS,
  type RationaleFactors,
  type Recommendation,
} from "../../lib/recommendation/recommendation-api";
import {
  listQuotationsForOpportunity,
  type QuotationChain,
} from "../../lib/quotation/quotation-api";
import {
  setTargetPremiumThreshold,
  type OpportunityWithContext,
} from "../../lib/opportunity/opportunity-api";
import { ApiError } from "../../lib/auth/api-client";
import { DiscardControl, DiscardedNotice } from "../ui/DiscardControl";
import { useAuth } from "../../lib/auth/auth-context";
import { CombinedDutyOnRecord } from "../ui/CombinedDutyOnRecord";
import {
  CombinedDutyReasonField,
  combinedDutyTooShort,
  needsCombinedDutyDeclaration,
} from "../ui/CombinedDutyReasonField";
import { useLanguage } from "../../lib/i18n/language-context";
import { formatMoney } from "../../lib/i18n/format";
import type { TranslationKey } from "../../lib/i18n/translations";
import { buttonStyle, errorStyle } from "../auth/auth-form.styles";
import { rfqBadgeStyle } from "../rfq/rfq.styles";
import {
  quoteChainCardStyle,
  quoteFieldStyle,
} from "../quotation/quotation.styles";
import { DeactivatedInsurerBadge } from "../insurer/DeactivatedInsurerBadge";

const FACTOR_LABEL_KEY: Record<keyof RationaleFactors, TranslationKey> = {
  coverage: "recFactorCoverage",
  price: "recFactorPrice",
  financialStrength: "recFactorFinancialStrength",
  claimsService: "recFactorClaimsService",
  deductible: "recFactorDeductible",
  policyConditions: "recFactorPolicyConditions",
};

interface Props {
  opportunity: OpportunityWithContext;
  /**
   * THREE PROPS, NOT ONE — and `isPlacement` was gated on a FOURTH code that none of the three
   * controls uses. Split 2026-11-06 (module 0-c batch 6b), row 12.
   *
   * `isPlacement` arrived from `/opportunities/[id]` bound to **`quotation.capture`**, and gated
   * three controls whose routes enforce three different codes:
   *
   *   the DRAFT form   `POST /recommendations`           **`recommendation.draft`**
   *   the SEND button  `POST /recommendations/:id/send`  **`recommendation.send`**
   *   the CoI notice   the disclosure route              **`conflict-of-interest.disclose`**
   *
   * So a Placement Officer holding `quotation.capture` and not `recommendation.send` saw a Send
   * button and was refused by it, and a role holding `recommendation.draft` without
   * `quotation.capture` could not see the draft form at all.
   *
   * This is the SAME defect the `isManager` comment below records, in the SAME component, left
   * behind by that fix: the rule it states — *one permission per control, named after what the
   * endpoint behind that control actually enforces* — had been applied to two of the props and not
   * to this one. LATENT UNDER THE SEED, like the rest of row 12: all four codes are granted to
   * `[PLACEMENT]` alone, so no seeded role can tell them apart.
   *
   * The third control also needed no new prop: `canDiscloseCoi` IS what `isCompliance` already
   * carried, so the old `(isPlacement || isCompliance)` was offering the disclosure to a holder of
   * `quotation.capture` whom the route refuses. The `isPlacement ||` half was pure defect.
   */
  canDraft: boolean;
  canSend: boolean;
  /**
   * TWO PROPS, NOT ONE, BECAUSE TWO DIFFERENT ENDPOINTS GUARD THESE TWO CONTROLS.
   *
   * They were a single `isManager` bound to `quotation.negotiate`, and the grant table says what
   * that produced: `quotation.negotiate` is PLACEMENT's alone, while the two endpoints behind these
   * controls enforce `opportunity.set-target-threshold` (MANAGER, EXEC) and `recommendation.approve`
   * (MANAGER). So the placement officer saw both controls and was answered 403 by both, the manager
   * saw neither, and an over-threshold recommendation could be neither approved nor sent BY ANYBODY.
   *
   * `isManager` was also the wrong SHAPE as well as the wrong value: one boolean cannot carry two
   * permissions that are granted to different sets of roles — EXEC holds the threshold one and not
   * the approval — so widening the single flag could not have fixed this either.
   *
   * Named after the permission each endpoint actually enforces, which is this screen's own stated
   * rule ("one permission per control, named after what the endpoint behind that control actually
   * enforces") and the reason the role-name era was ended: a name like `isManager` invites the next
   * reader to bind it to whatever a manager happens to hold.
   */
  canSetThreshold: boolean;
  canApprove: boolean;
  /**
   * `conflict-of-interest.disclose`. Renamed from `isCompliance` 2026-11-06: the value was always
   * this code — `/opportunities/[id]` binds it as `canDiscloseCoi` — and a role-shaped name is
   * what the `isManager` note below says invites the next person to widen it.
   */
  canDiscloseCoi: boolean;
  /** `recommendation.discard` — its own code, not implied by the ability to draft one. */
  canDiscard: boolean;
  onOpportunityChanged: () => void;
}

const EMPTY_FACTORS: RationaleFactors = {
  coverage: "",
  price: "",
  financialStrength: "",
  claimsService: "",
  deductible: "",
  policyConditions: "",
};

export function RecommendationSection({
  opportunity,
  canDraft,
  canSend,
  canSetThreshold,
  canApprove,
  canDiscard,
  canDiscloseCoi,
  onOpportunityChanged,
}: Props) {
  const { language, t } = useLanguage();
  const { user } = useAuth();
  const [rec, setRec] = useState<Recommendation | null | undefined>(undefined);
  // Part 4 — computed once here rather than inside the action row: `rec` is this component's own state, and
  // the condition is about the office and the viewer, neither of which changes per render branch.
  const needsDeclaration = needsCombinedDutyDeclaration({
    mode: user?.dutySegregationMode,
    makerUserId: rec?.draftedByUserId,
    currentUserId: user?.id ?? "",
    alreadyDecided: rec?.approvedByUserId != null,
  });
  const [chains, setChains] = useState<QuotationChain[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dutyReason, setDutyReason] = useState("");

  const [quotationId, setQuotationId] = useState("");
  const [rationale, setRationale] = useState("");
  const [factors, setFactors] = useState<RationaleFactors>(EMPTY_FACTORS);
  const [thresholdInput, setThresholdInput] = useState("");
  const [disclosureText, setDisclosureText] = useState("");

  const load = useCallback(async () => {
    try {
      const [recs, qs] = await Promise.all([
        listRecommendationsForOpportunity(opportunity.id),
        listQuotationsForOpportunity(opportunity.id).catch(() => []),
      ]);
      setRec(recs[0] ?? null);
      setChains(qs);
      setLoadError(null);
    } catch (err) {
      setRec(null);
      setLoadError(err instanceof ApiError ? err.message : t("recLoadError"));
    }
  }, [opportunity.id, t]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  // Part F item #7 — the customer's own languagePreference decides the
  // document's language server-side; no picker here for a first pass.
  // The button is only rendered once blockedFromSend is empty (see
  // below), so this call should never actually hit the api's own 422 —
  // the try/catch here is a safety net for a race (e.g. a threshold
  // changing between render and click), not the expected path.
  async function downloadDocument(id: string) {
    setFormError(null);
    try {
      const blob = await downloadRecommendationDocument(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `recommendation-report-${id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : t("recDownloadError"),
      );
    }
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setFormError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("recActionError"));
    } finally {
      setBusy(false);
    }
  }

  const currentQuotes = chains.map((c) => c.current);

  return (
    <section>
      <h2 style={{ marginTop: "2.5rem" }}>{t("recSectionHeading")}</h2>
      <p style={{ opacity: 0.7, margin: "0.25rem 0 0" }}>
        {t("recSectionIntro")}
      </p>

      {loadError ? (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      ) : null}

      {canSetThreshold ? (
        <div
          style={{ ...quoteFieldStyle, maxWidth: "22rem", marginTop: "1rem" }}
        >
          <label htmlFor="rec-threshold">
            {t("recThresholdLabel")}{" "}
            <span style={{ color: "var(--ink-secondary)" }}>
              {t("recThresholdCurrent", {
                amount: formatMoney(
                  opportunity.targetPremiumThreshold,
                  language,
                ),
              })}
            </span>
          </label>
          <input
            id="rec-threshold"
            value={thresholdInput}
            inputMode="decimal"
            placeholder="250000.000"
            onChange={(e) => setThresholdInput(e.target.value)}
          />
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.4rem" }}>
            <button
              type="button"
              disabled={busy || thresholdInput.trim().length === 0}
              style={{ ...buttonStyle, width: "auto" }}
              onClick={() =>
                void run(async () => {
                  await setTargetPremiumThreshold(
                    opportunity.id,
                    thresholdInput.trim(),
                  );
                  setThresholdInput("");
                  onOpportunityChanged();
                })
              }
            >
              {t("recSetButton")}
            </button>
            <button
              type="button"
              disabled={busy}
              style={{ ...buttonStyle, width: "auto" }}
              onClick={() =>
                void run(async () => {
                  await setTargetPremiumThreshold(opportunity.id, null);
                  onOpportunityChanged();
                })
              }
            >
              {t("recClearButton")}
            </button>
          </div>
        </div>
      ) : null}

      {formError ? (
        <p role="alert" style={errorStyle}>
          {formError}
        </p>
      ) : null}

      {rec === undefined ? (
        <p>{t("commonLoading")}</p>
      ) : rec === null ? (
        canDraft ? (
          <div style={{ marginTop: "1rem", maxWidth: "40rem" }}>
            <strong>{t("recDraftHeading")}</strong>
            <div style={quoteFieldStyle}>
              <label htmlFor="rec-quote">{t("recQuoteLabel")}</label>
              <select
                id="rec-quote"
                value={quotationId}
                onChange={(e) => setQuotationId(e.target.value)}
              >
                <option value="">{t("recSelectQuoteOption")}</option>
                {currentQuotes.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.insurer.name} —{" "}
                    {formatMoney(q.premium, language, q.currency)}
                    {q.commissionRatePercent
                      ? t("recCommissionSuffix", {
                          percent: q.commissionRatePercent,
                        })
                      : ""}
                  </option>
                ))}
              </select>
              {currentQuotes.length === 0 ? (
                <span
                  style={{ color: "var(--ink-secondary)", fontSize: "0.85rem" }}
                >
                  {t("recNoCurrentQuotes")}
                </span>
              ) : null}
            </div>
            <div style={quoteFieldStyle}>
              <label htmlFor="rec-rationale">{t("recRationaleLabel")}</label>
              <textarea
                id="rec-rationale"
                value={rationale}
                rows={3}
                maxLength={8000}
                onChange={(e) => setRationale(e.target.value)}
              />
            </div>
            {RATIONALE_FACTOR_FIELDS.map(({ key }) => (
              <div key={key} style={quoteFieldStyle}>
                <label htmlFor={`rec-f-${key}`}>
                  {t(FACTOR_LABEL_KEY[key])}
                </label>
                <textarea
                  id={`rec-f-${key}`}
                  value={factors[key]}
                  rows={2}
                  maxLength={2000}
                  onChange={(e) =>
                    setFactors((prev) => ({ ...prev, [key]: e.target.value }))
                  }
                />
              </div>
            ))}
            <button
              type="button"
              disabled={busy || !quotationId || rationale.trim().length < 10}
              style={{ ...buttonStyle, width: "auto" }}
              onClick={() =>
                void run(() =>
                  draftRecommendation({
                    opportunityId: opportunity.id,
                    recommendedQuotationId: quotationId,
                    rationale: rationale.trim(),
                    rationaleFactors: factors,
                  }),
                )
              }
            >
              {busy ? t("recDraftingButton") : t("recDraftButton")}
            </button>
          </div>
        ) : (
          <p style={{ color: "var(--ink-secondary)", marginTop: "1rem" }}>
            {t("recNoneYet")}
          </p>
        )
      ) : (
        <div style={{ ...quoteChainCardStyle, marginTop: "1rem" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "1rem",
              flexWrap: "wrap",
            }}
          >
            <strong>{rec.recommendedQuotation.insurer.name}</strong>
            <DeactivatedInsurerBadge
              isActive={rec.recommendedQuotation.insurer.isActive}
            />
            <span style={rfqBadgeStyle}>
              {rec.discard
                ? t("discardedBadge")
                : rec.sentToClientAt
                  ? t("recSentToClientBadge")
                  : rec.blockedFromSend.length === 0
                    ? t("recReadyToSendBadge")
                    : t("recBlockedBadge")}
            </span>
          </div>
          <p style={{ margin: "0.4rem 0" }}>
            {rec.recommendedQuotation.insuranceLine} ·{" "}
            {formatMoney(
              rec.recommendedQuotation.premium,
              language,
              rec.recommendedQuotation.currency,
            )}
            {rec.recommendedQuotation.commissionRatePercent
              ? t("recCommissionSuffix", {
                  percent: rec.recommendedQuotation.commissionRatePercent,
                })
              : ""}
          </p>
          <p style={{ whiteSpace: "pre-wrap", margin: "0.4rem 0" }}>
            {rec.rationale}
          </p>
          <dl style={{ margin: "0.4rem 0" }}>
            {RATIONALE_FACTOR_FIELDS.map(({ key }) => (
              <div key={key} style={{ marginBottom: "0.3rem" }}>
                <dt
                  style={{ fontWeight: 600, fontSize: "0.8rem", opacity: 0.7 }}
                >
                  {t(FACTOR_LABEL_KEY[key])}
                </dt>
                <dd style={{ margin: 0 }}>{rec.rationaleFactors[key]}</dd>
              </div>
            ))}
          </dl>

          <p style={{ margin: "0.4rem 0" }}>
            {t("recApprovalLabel")}{" "}
            {!rec.approvalRequired
              ? t("recApprovalNotRequired")
              : rec.approvedByUserId
                ? t("recApprovalApproved")
                : t("recApprovalRequiredAwaiting")}
            {/*
              Part 4 step 5. The line reads "Approved" whether a second person agreed with the advice or
              the drafter approved her own, so without this it cannot distinguish them — on the advice the
              client acts on, which is where this product's professional-indemnity exposure sits.
            */}
            <CombinedDutyOnRecord
              act={rec.combinedDutyAct}
              testId={`combined-duty-recommendation-${rec.id}`}
            />
          </p>
          <p style={{ margin: "0.4rem 0" }}>
            {t("recCoiLabel")}{" "}
            {!rec.conflictOfInterestFlagged
              ? t("recCoiNone")
              : rec.conflictOfInterestDisclosure
                ? t("recCoiDisclosed")
                : t("recCoiFlagged", {
                    percent: rec.coiCommissionDiffPercent ?? "",
                  })}
          </p>

          {rec.blockedFromSend.length > 0 ? (
            <ul style={{ color: "var(--danger-ink)", margin: "0.4rem 0" }}>
              {rec.blockedFromSend.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : null}

          <div
            style={{
              display: "flex",
              gap: "0.6rem",
              flexWrap: "wrap",
              marginTop: "0.6rem",
            }}
          >
            {canApprove &&
            rec.approvalRequired &&
            !rec.approvedByUserId &&
            !rec.sentToClientAt &&
            !rec.discard ? (
              <>
                {/*
                  Part 4 — the officer who drafted the recommendation may approve it in an office that has
                  declared COMBINED, only by saying why. The approval exists because this recommendation is
                  above the client's target premium, so it is the case a second reader most wants explained.
                */}
                {needsDeclaration ? (
                  <CombinedDutyReasonField
                    id={rec.id}
                    value={dutyReason}
                    onChange={setDutyReason}
                  />
                ) : null}
                <button
                  type="button"
                  disabled={
                    busy ||
                    (needsDeclaration && combinedDutyTooShort(dutyReason))
                  }
                  style={{ ...buttonStyle, width: "auto" }}
                  onClick={() =>
                    void run(() =>
                      approveRecommendation(
                        rec.id,
                        needsDeclaration ? dutyReason.trim() : undefined,
                      ),
                    )
                  }
                >
                  {t("recApproveButton")}
                </button>
              </>
            ) : null}
            {/* SEND — `recommendation.send`, not `quotation.capture`. */}
            {canSend &&
            !rec.sentToClientAt &&
            rec.blockedFromSend.length === 0 &&
            !rec.discard ? (
              <button
                type="button"
                disabled={busy}
                style={{ ...buttonStyle, width: "auto" }}
                onClick={() =>
                  void run(async () => {
                    await sendRecommendation(rec.id);
                    onOpportunityChanged();
                  })
                }
              >
                {t("recSendButton")}
              </button>
            ) : null}
            {rec.blockedFromSend.length === 0 ? (
              <button
                type="button"
                onClick={() => void downloadDocument(rec.id)}
                style={{ ...buttonStyle, width: "auto" }}
              >
                {t("recDownloadReportButton")}
              </button>
            ) : null}
            <DiscardControl
              collection="recommendations"
              id={rec.id}
              canDiscard={canDiscard}
              // Sent to the client IS the commitment — after that the client decision records what happened
              // to it, and a different recommendation is a new one.
              discardable={!rec.discard && !rec.sentToClientAt}
              onDiscarded={load}
            />
          </div>
          <DiscardedNotice discard={rec.discard} />

          {/* The `isPlacement ||` half is GONE: it offered the disclosure to a holder of
               `quotation.capture`, which the route does not accept. */}
          {canDiscloseCoi &&
          rec.conflictOfInterestFlagged &&
          !rec.conflictOfInterestDisclosure &&
          !rec.sentToClientAt &&
          !rec.discard ? (
            <div style={{ ...quoteFieldStyle, marginTop: "0.8rem" }}>
              <label htmlFor="rec-coi">{t("recCoiDisclosureLabel")}</label>
              <textarea
                id="rec-coi"
                value={disclosureText}
                rows={3}
                maxLength={8000}
                placeholder={t("recCoiDisclosurePlaceholder")}
                onChange={(e) => setDisclosureText(e.target.value)}
              />
              <button
                type="button"
                disabled={busy || disclosureText.trim().length < 20}
                style={{ ...buttonStyle, width: "auto", marginTop: "0.4rem" }}
                onClick={() =>
                  void run(() =>
                    discloseConflictOfInterest(rec.id, disclosureText.trim()),
                  )
                }
              >
                {t("recRecordDisclosureButton")}
              </button>
            </div>
          ) : null}

          {rec.conflictOfInterestDisclosure ? (
            <p
              style={{
                whiteSpace: "pre-wrap",
                marginTop: "0.6rem",
                opacity: 0.8,
                fontSize: "0.9rem",
              }}
            >
              <strong>{t("recDisclosedLabel")}</strong>{" "}
              {rec.conflictOfInterestDisclosure.disclosureText}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
