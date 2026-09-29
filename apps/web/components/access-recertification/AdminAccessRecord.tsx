"use client";

/*
 * Were the ADMINISTRATOR accounts reviewed in this cycle, and by whom?
 *
 * Part 5.1 is explicit that whoever can administer users is NOT exempt from recertification of
 * their own access. `GET /cycles/:id/admin-items` is the record proving they were covered, and
 * it had no web caller — so the one control in the system whose purpose is to show that the
 * administrators did not quietly exempt themselves could be read by nobody.
 *
 * ## Why there is a cycle picker rather than "the current cycle"
 *
 * The question is asked at audit time, about a cycle that closed months ago. Keying this to the
 * cycle the reader just started would answer only "are the administrators in the cycle I opened
 * a moment ago", which nobody needs to ask — they just opened it.
 *
 * ## Why "nobody" is rendered as a WARNING and not as an empty table
 *
 * Zero administrator items in a cycle is not "nothing to see". It means the cycle covered no
 * administrator account, which is the state Part 5.1 exists to prevent — so it reads as
 * something to act on, the same treatment the empty holiday calendar gets. An empty table would
 * say the opposite of what the absence means.
 *
 * ## The subject badge is not derived here
 *
 * `subjectIsUserAdministrator` is resolved server-side from `user.manage`. Comparing role names
 * would stop badging an office's own administrator role, which is exactly the account this
 * record exists to prove was reviewed — the same reason the review table does not derive it.
 */

import { useCallback, useEffect, useState } from "react";
import { CombinedDutyOnRecord } from "../ui/CombinedDutyOnRecord";
import { ApiError } from "../../lib/auth/api-client";
import { useLanguage } from "../../lib/i18n/language-context";
import { errorStyle } from "../auth/auth-form.styles";
import {
  listAdminRecertificationItems,
  listRecertificationCycles,
  type RecertificationCycle,
  type RecertificationDecision,
  type RecertificationItem,
} from "../../lib/access-recertification/access-recertification-api";
import type { TranslationKey } from "../../lib/i18n/translations";

/**
 * A TOTAL map, not a concatenated key.
 *
 * `t(`acrAdminDecision_${decision}` as never)` compiles and renders the raw word when the key is
 * missing in either language — § 1.45, where an `as never` on exactly this shape hid the fact
 * that a label existed in NEITHER dictionary. `satisfies` makes a new decision value a build
 * error instead.
 */
const DECISION_KEY = {
  confirmed: "acrAdminDecisionConfirmed",
  revoked: "acrAdminDecisionRevoked",
  changed: "acrAdminDecisionChanged",
} satisfies Record<RecertificationDecision, TranslationKey>;

export function AdminAccessRecord() {
  const { t } = useLanguage();

  const [cycles, setCycles] = useState<RecertificationCycle[] | null>(null);
  const [cycleId, setCycleId] = useState("");
  const [items, setItems] = useState<RecertificationItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const found = await listRecertificationCycles();
        if (!live) return;
        setCycles(found);
        // Newest first from the server, so the first row is the current cycle — the one a reader
        // opening this section is most likely asking about.
        if (found.length > 0) setCycleId(found[0]!.id);
      } catch (error) {
        if (live)
          setLoadError(
            error instanceof ApiError ? error.message : t("acrAdminLoadFailed"),
          );
      }
    })();
    return () => {
      live = false;
    };
  }, [t]);

  const loadItems = useCallback(
    async (id: string) => {
      try {
        setItems(await listAdminRecertificationItems(id));
        setLoadError(null);
      } catch (error) {
        setItems(null);
        setLoadError(
          error instanceof ApiError ? error.message : t("acrAdminLoadFailed"),
        );
      }
    },
    [t],
  );

  useEffect(() => {
    if (cycleId === "") return;
    let live = true;
    void (async () => {
      if (live) await loadItems(cycleId);
    })();
    return () => {
      live = false;
    };
  }, [cycleId, loadItems]);

  return (
    <section style={{ marginTop: "2rem" }} data-testid="admin-access-record">
      <h2>{t("acrAdminHeading")}</h2>
      <p style={{ color: "var(--ink-secondary)", fontSize: "0.85rem" }}>
        {t("acrAdminIntro")}
      </p>

      {loadError !== null && (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      )}

      {cycles !== null && cycles.length === 0 ? (
        <p style={{ color: "var(--ink-secondary)" }}>{t("acrAdminNoCycles")}</p>
      ) : (
        <>
          <label>
            {t("acrAdminCycleLabel")}
            <select
              value={cycleId}
              onChange={(event) => setCycleId(event.target.value)}
              data-testid="admin-record-cycle"
            >
              {(cycles ?? []).map((cycle) => (
                <option key={cycle.id} value={cycle.id}>
                  {cycle.cycleLabel}
                </option>
              ))}
            </select>
          </label>

          {items !== null && items.length === 0 ? (
            /* A warning, not an empty state: a cycle that covered no administrator account is
               the condition Part 5.1 exists to prevent, so it must not read as "nothing here". */
            <p role="alert" style={errorStyle} data-testid="admin-record-none">
              {t("acrAdminNoneCovered")}
            </p>
          ) : null}

          {items !== null && items.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "start" }}>
                      {t("acrAdminColSubject")}
                    </th>
                    <th style={{ textAlign: "start" }}>
                      {t("acrAdminColReviewer")}
                    </th>
                    <th style={{ textAlign: "start" }}>
                      {t("acrAdminColDecision")}
                    </th>
                    <th style={{ textAlign: "start" }}>
                      {t("acrAdminColReviewedAt")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} data-admin-item={item.subjectUserId}>
                      <td>
                        <bdi>{item.subjectFullName}</bdi>
                      </td>
                      <td>
                        {/* The reviewer by NAME. A uuid here cannot answer the half of the
                            question that matters at audit time. */}
                        <bdi>{item.reviewerFullName}</bdi>
                        {item.reviewerUserId === item.subjectUserId ? (
                          <>
                            {" "}
                            <strong data-testid={`self-review-${item.id}`}>
                              {t("acrAdminSelfReview")}
                            </strong>
                          </>
                        ) : null}
                      </td>
                      <td data-testid={`admin-decision-${item.id}`}>
                        {item.decision === null
                          ? t("acrAdminNotYetReviewed")
                          : t(DECISION_KEY[item.decision])}
                        {/*
                          Part 4 step 5, and this is the surface it matters most on: "was this
                          administrator's access reviewed" is only half a question, and an administrator who
                          reviewed her OWN access is the case the whole record exists to surface.
                        */}
                        <CombinedDutyOnRecord
                          act={item.arrangementCombinedDutyAct}
                          testId={`combined-duty-admin-arrangement-${item.id}`}
                        />
                        <CombinedDutyOnRecord
                          act={item.decisionCombinedDutyAct}
                          testId={`combined-duty-admin-decision-${item.id}`}
                        />
                      </td>
                      <td>{item.reviewedAt?.slice(0, 10) ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
