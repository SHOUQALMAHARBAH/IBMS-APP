"use client";

import { useCallback, useEffect, useState } from "react";
import { EntitySearch } from "../../../components/ui/EntitySearch";
import { WorkflowHistoryLink } from "../../../components/ui/WorkflowHistoryLink";
import { ENUM_LABEL } from "../../../lib/i18n/enum-labels";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/auth/auth-context";
import { CombinedDutyOnRecord } from "../../../components/ui/CombinedDutyOnRecord";
import {
  CombinedDutyReasonField,
  combinedDutyTooShort,
  needsCombinedDutyDeclaration,
} from "../../../components/ui/CombinedDutyReasonField";
import {
  addComplaintAction,
  assignComplaint,
  closeComplaint,
  COMPLAINT_CATEGORIES,
  createComplaint,
  downloadComplaintAcknowledgement,
  escalateComplaint,
  listComplaints,
  resolveComplaint,
  startComplaint,
  type Complaint,
} from "../../../lib/customer-service/complaint-api";
import { ApiError } from "../../../lib/auth/api-client";
import { actionErrorText } from '../../../lib/i18n/action-error';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Icon,
  PageHeader,
  Select,
  SkeletonList,
  Table,
  Td,
  TextArea,
  TextInput,
  Th,
  Tr,
} from "../../../components/ui";
import { pageStackStyle } from "../../../components/lead/lead.styles";
import { hasAnyPermission } from "../../../lib/auth/permissions";
import { formatNumber } from "../../../lib/i18n/format";
import { useLanguage } from "../../../lib/i18n/language-context";
import type { TranslationKey } from "../../../lib/i18n/translations";
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';

// A permission code, like the two below it — NOT the role list this used to
// hold. §10.4 converted `ESCALATE_ROLES`/`CLOSE_ROLES` and missed this one, so
// role NAMES were being compared against permission CODES: `hasAnyPermission`
// could never match, and the log form was hidden from everybody. `tsc` cannot
// catch it because both sides are `string[]`.
//
// `complaint.log` is seeded to exactly the five roles that were listed here
// (Sales, Claims, Finance, Compliance, Branch/Department Manager), so this
// restores the intended behaviour rather than changing who may log a complaint.
const LOG_PERMISSIONS = ["complaint.log"];
const ESCALATE_ROLES = ["complaint.escalate"];
const CLOSE_ROLES = ["complaint.close"];

/** ComplaintStatus -> label key. Typed against the union so a new status is
 * a compile error rather than a raw token on screen. */
const STATUS_LABEL_KEY: Record<Complaint["status"], TranslationKey> = {
  LOGGED: "complaintsStatusLogged",
  ASSIGNED: "complaintsStatusAssigned",
  IN_PROGRESS: "complaintsStatusInProgress",
  ESCALATED: "complaintsStatusEscalated",
  RESOLVED: "complaintsStatusResolved",
  CLOSED: "complaintsStatusClosed",
};

function slaLabel(
  c: Complaint,
  t: (k: TranslationKey, p?: Record<string, string | number>) => string,
): string {
  if (!c.sla) return t("complaintsSlaNone");
  if (c.sla.resolvedAt) return t("complaintsSlaResolved");
  const date = c.sla.dueAt.slice(0, 10);
  return c.sla.breached
    ? t("complaintsSlaBreached", { date })
    : t("complaintsSlaDue", { date });
}

export default function ComplaintsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { language, t } = useLanguage();
  const canLog = hasAnyPermission(user, LOG_PERMISSIONS);
  const canEscalate = hasAnyPermission(user, ESCALATE_ROLES);
  const canClose = hasAnyPermission(user, CLOSE_ROLES);

  const [rows, setRows] = useState<Complaint[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Part 4 — the combined-duty reason, keyed by record so two rows cannot share one box.
  const [declarations, setDeclarations] = useState<Record<string, string>>({});

  const [customerId, setCustomerId] = useState("");
  const [issue, setIssue] = useState("");
  const [category, setCategory] = useState("");
  const [claimId, setClaimId] = useState("");
  const [text, setText] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setRows(await listComplaints());
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? permissionRefusal(t, 'complaintsRefusalAct', 'complaint.log')
          : err instanceof ApiError
            ? err.message
            : t("complaintsLoadError"),
      );
    }
  }, [t]);

  useEffect(() => {
    if (!isLoading && !user) router.push("/login");
  }, [isLoading, user, router, t]);
  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load();
    })();
  }, [user, load, t]);

  // Part F item #7 — the customer's own languagePreference decides the
  // document's language server-side; no picker here for a first pass
  // (DUAL is reachable via the api directly, e.g. for a front-desk
  // handout in both languages, but this list view keeps one button).
  async function downloadAcknowledgement(id: string) {
    setActionError(null);
    try {
      const blob = await downloadComplaintAcknowledgement(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `complaint-acknowledgement-${id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setActionError(
        actionErrorText(err, t, "complaintsAckError"),
      );
    }
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setActionError(
        actionErrorText(err, t, "complaintsActionError"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    await run(async () => {
      await createComplaint({
        customerId: customerId.trim(),
        issue: issue.trim(),
        ...(category ? { category } : {}),
        ...(claimId.trim() ? { claimId: claimId.trim() } : {}),
      });
      setCustomerId("");
      setIssue("");
      setCategory("");
      setClaimId("");
    });
  }

  const val = (id: string) => (text[id] ?? "").trim();
  const setVal = (id: string, v: string) => setText((t) => ({ ...t, [id]: v }));

  if (isLoading || !user) return null;

  return (
    <main style={pageStackStyle}>
      <PageHeader
        title={t("complaintsHeading")}
        description={t("complaintsIntro")}
      />

      {/* THE FORM COMES FIRST AND IT IS A CARD, which is this product's own rule (B.7 rule 1:
          a create form sits above the list it adds to) — what changed is that it now reads as
          one piece of work rather than four loose controls floating under a heading.

          FOUR `aria-label`s WERE WITHDRAWN HERE and two of them were actively WRONG, which is
          the commonest defect this pass keeps finding: an `aria-label` REPLACES the accessible
          name, so where it disagrees with the visible label the two readers are told different
          things and nobody proof-reads the invisible one. `complaintsCategoryAria` said
          «التصنيف» where the visible label says «التصنيف (اختياري)», so a screen-reader user was
          NOT told the field is optional; the issue and claim fields duplicated their own visible
          labels verbatim, which buys nothing and is one more string to drift. `Field` associates
          the visible label with its control, which is what the attribute was standing in for. */}
      {canLog ? (
        <Card title={t("complaintsLogButton")}>
          <form
            onSubmit={submit}
            style={{ display: "grid", gap: "var(--space-3)", maxWidth: "34rem" }}
          >
            <EntitySearch
              kind="customer"
              value={customerId}
              onChange={setCustomerId}
              label={t("complaintsCustomerIdLabel")}
              required
            />

            <Field label={t("complaintsIssueLabel")} required>
              {(props) => (
                <TextArea
                  {...props}
                  dir="auto"
                  value={issue}
                  onChange={(e) => setIssue(e.target.value)}
                  required
                  rows={2}
                />
              )}
            </Field>

            <Field label={t("complaintsCategoryLabel")}>
              {(props) => (
                <Select
                  {...props}
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {/* THE EM DASH STAYS, and that is decision 60's classify-then-convert rather
                      than a site missed. It is a CHOICE PLACEHOLDER — *no category selected* —
                      and none of her three words is that: it has not failed to be done, it is
                      not inapplicable, and nothing is held and unresolvable. The nearest shipping
                      phrase, `commChannelDefaultOption` («التفضيل المسجّل»), is about a recorded
                      channel preference and would be a false statement here. Recorded in the
                      register rather than cleared by stretching a word onto it. */}
                  <option value="">—</option>
                  {COMPLAINT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(ENUM_LABEL.ComplaintCategory[c])}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label={t("complaintsClaimIdLabel")}>
              {(props) => (
                <TextInput
                  {...props}
                  value={claimId}
                  onChange={(e) => setClaimId(e.target.value)}
                />
              )}
            </Field>

            <div>
              <Button type="submit" loading={busy}>
                <Icon name="plus" size={14} />
                {busy ? t("complaintsSavingButton") : t("complaintsLogButton")}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {/* THE TWO ERRORS ARE KEPT APART, deliberately. An ACTION error belongs beside the thing
          that failed and a LOAD error replaces the list; collapsing them would put a failed
          button press where the register should be. */}
      {actionError ? <ErrorState title={actionError} /> : null}
      {loadError ? <ErrorState title={loadError} /> : null}

      {rows ? (
        rows.length === 0 ? (
          <EmptyState title={t("complaintsNone")} />
        ) : (
          <Card padded={false}>
            <Table>
              <thead>
                <tr>
                  <Th>{t("complaintsColCustomer")}</Th>
                  <Th>{t("complaintsColIssue")}</Th>
                  <Th>{t("complaintsColStatus")}</Th>
                  <Th>{t("complaintsColSla")}</Th>
                  <Th numeric>{t("complaintsColEscalations")}</Th>
                  <Th>{t("complaintsColAction")}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <Tr key={c.id}>
                    {/* RULE 2 — the name, never the id. `bdi` because a legal name may be in
                        the other script from the page it is rendered on. */}
                    <Td>
                      <bdi>{c.customerName}</bdi>
                    </Td>
                    <Td>
                      <bdi>{c.issue}</bdi>
                    </Td>
                    <Td>
                      <Badge
                        tone={c.isClosed ? "success" : "neutral"}
                        data-complaint-status={c.status}
                      >
                        {t(STATUS_LABEL_KEY[c.status])}
                      </Badge>
                      {/*
                        Part 4 step 5. CLOSED is what the status reads whether one person or two signed the
                        closure off, so without this the cell cannot distinguish them.
                      */}
                      <CombinedDutyOnRecord
                        act={c.closureCombinedDutyAct}
                        testId={`combined-duty-complaint-${c.id}`}
                      />
                    </Td>
                    <Td>{slaLabel(c, t)}</Td>
                    {/* ZERO IS AN ANSWER — and this read `c.escalations.length || "—"`, so a
                        complaint that was never escalated rendered the SAME CELL as one whose
                        escalation count nobody knows. `0 || x` is `x` in JavaScript, which is
                        the recorded defect this product has already paid for twice (`?? ` passing
                        `false` through to React, and `0 || '—'` on an incident's affected-subject
                        estimate). *Never escalated* is a fact about a complaint, and on a
                        register a regulator reads it is the fact that matters most. */}
                    <Td numeric>{formatNumber(c.escalations.length, language)}</Td>
                    <Td>
                      {/* Owner decision 41 — fills `/audit-trail`'s workflow-history fields from
                          here, so reading this complaint's state history no longer needs a uuid
                          pasted by hand. Renders nothing without `workflow-history.read`. */}
                      <div style={{ marginBottom: "var(--space-2)" }}>
                        <WorkflowHistoryLink entityType="Complaint" entityId={c.id} />
                      </div>
                      {canLog ? (
                        <button
                          type="button"
                          onClick={() => void downloadAcknowledgement(c.id)}
                          style={{ marginBottom: "var(--space-2)" }}
                        >
                          {t("complaintsDownloadAckButton")}
                        </button>
                      ) : null}
                      {c.isClosed ? (
                        <bdi>{c.resolution ?? "—"}</bdi>
                      ) : (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "var(--space-2)",
                            minWidth: "16rem",
                          }}
                        >
                          <input
                            aria-label={t("complaintsTextAria")}
                            placeholder={t("complaintsTextPlaceholder")}
                            dir="auto"
                            value={text[c.id] ?? ""}
                            onChange={(e) => setVal(c.id, e.target.value)}
                          />
                          <div
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              gap: "var(--space-2)",
                            }}
                          >
                            {canLog && c.status === "LOGGED" ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void run(() =>
                                    assignComplaint(c.id, val(c.id)),
                                  )
                                }
                              >
                                {t("complaintsAssignButton")}
                              </button>
                            ) : null}
                            {canLog &&
                            (c.status === "ASSIGNED" ||
                              c.status === "ESCALATED") ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void run(() => startComplaint(c.id))
                                }
                              >
                                {t("complaintsStartButton")}
                              </button>
                            ) : null}
                            {canLog && c.status === "IN_PROGRESS" ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void run(() =>
                                    addComplaintAction(c.id, val(c.id)),
                                  )
                                }
                              >
                                {t("complaintsAddActionButton")}
                              </button>
                            ) : null}
                            {canLog &&
                            (c.status === "IN_PROGRESS" ||
                              c.status === "ESCALATED") ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void run(() =>
                                    resolveComplaint(c.id, val(c.id)),
                                  )
                                }
                              >
                                {t("complaintsResolveButton")}
                              </button>
                            ) : null}
                            {canEscalate && c.status === "IN_PROGRESS" ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void run(() =>
                                    escalateComplaint(c.id, {
                                      reason: val(c.id) || undefined,
                                    }),
                                  )
                                }
                              >
                                {t("complaintsEscalateButton")}
                              </button>
                            ) : null}
                            {canClose && c.status === "RESOLVED"
                              ? (() => {
                                  // Part 4 — the person who performed the first half may complete it themselves in an office
                                  // that has declared COMBINED, only by saying why. Every other case is unchanged.
                                  const needs = needsCombinedDutyDeclaration({
                                    mode: user.dutySegregationMode,
                                    makerUserId: c.resolvedByUserId,
                                    currentUserId: user.id,
                                    // `c.status === 'CLOSED'` is provably false here — this branch already
                                    // narrowed it to RESOLVED, and TypeScript said so. The column the write
                                    // sets is the honest test.
                                    alreadyDecided:
                                      c.closureApprovedByUserId != null,
                                  });
                                  const declaration = declarations[c.id] ?? "";
                                  return (
                                    <>
                                      {needs ? (
                                        <CombinedDutyReasonField
                                          id={c.id}
                                          value={declaration}
                                          onChange={(next) =>
                                            setDeclarations((prev) => ({
                                              ...prev,
                                              [c.id]: next,
                                            }))
                                          }
                                        />
                                      ) : null}
                                      <button
                                        type="button"
                                        disabled={
                                          busy ||
                                          (needs &&
                                            combinedDutyTooShort(declaration))
                                        }
                                        onClick={() =>
                                          void run(() =>
                                            closeComplaint(
                                              c.id,
                                              needs
                                                ? declaration.trim()
                                                : undefined,
                                            ),
                                          )
                                        }
                                      >
                                        {t("complaintsCloseButton")}
                                      </button>
                                    </>
                                  );
                                })()
                              : null}
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
        <SkeletonList rows={4} label={t("complaintsLoading")} />
      )}
    </main>
  );
}
