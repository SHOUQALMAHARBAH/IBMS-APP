"use client";

import { type CSSProperties, useCallback, useEffect, useState } from "react";
import type { IncidentSeverity } from "../../../lib/compliance-risk/incident-api";
import { ENUM_LABEL } from "../../../lib/i18n/enum-labels";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/auth/auth-context";
import { CombinedDutyOnRecord } from "../../../components/ui/CombinedDutyOnRecord";
import { WorkflowHistoryLink } from "../../../components/ui/WorkflowHistoryLink";
import {
  CombinedDutyReasonField,
  combinedDutyTooShort,
  needsCombinedDutyDeclaration,
} from "../../../components/ui/CombinedDutyReasonField";
import {
  assessIncidentImpact,
  classifyIncident,
  closeIncident,
  containIncident,
  coSignIncident,
  createIncident,
  INCIDENT_REGULATORS,
  INCIDENT_SEVERITIES,
  listIncidents,
  notifyIncidentAffectedSubjects,
  notifyIncidentRegulators,
  notifyIncidentSeniorManagement,
  recoverIncident,
  CONTAINMENT_DESCRIPTION_MIN_LENGTH,
  type IncidentReport,
} from "../../../lib/compliance-risk/incident-api";
import { ActionStatus } from "../../../components/ui";
import { formatDateTime, formatNumber } from "../../../lib/i18n/format";
import { ApiError } from "../../../lib/auth/api-client";
import { errorStyle } from "../../../components/auth/auth-form.styles";
import { pageStyle } from "../../../components/lead/lead.styles";
import { hasAnyPermission } from "../../../lib/auth/permissions";
import { useLanguage } from "../../../lib/i18n/language-context";
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';

const REPORT_ROLES = ["incident.report"];
const CONTAIN_ROLES = ["incident.contain"];
const CLASSIFY_ROLES = ["incident.classify"];
const CO_SIGN_ROLES = ["incident.classification.co-sign"];
const NOTIFY_SENIOR_ROLES = ["incident.senior-management.notify"];
const NOTIFY_REGULATOR_ROLES = ["incident.notify-regulator"];

const cell: CSSProperties = {
  padding: "0.4rem 0.75rem",
  borderBottom: "1px solid var(--border-subtle)",
  textAlign: "start",
  verticalAlign: "top",
};
const head: CSSProperties = {
  ...cell,
  fontWeight: 600,
  borderBottom: "2px solid var(--border-default)",
};
const formStyle: CSSProperties = {
  margin: "1rem 0",
  display: "grid",
  gap: "0.4rem",
  maxWidth: "30rem",
};
const labelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.2rem",
};

export default function IncidentsPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { t, language } = useLanguage();
  const canReport = hasAnyPermission(user, REPORT_ROLES);
  const canContain = hasAnyPermission(user, CONTAIN_ROLES);
  const canClassify = hasAnyPermission(user, CLASSIFY_ROLES);
  // §10.4's one documented exception in this app USED to be here: classify and
  // co-sign both required `incident.classify`, so the permission could not tell
  // them apart and these were role-name checks deliberately — the role really
  // was the finer-grained fact.
  //
  // Phase 2 split the code in two, so the premise is gone and so is the
  // exception. Every control on this screen is back to being gated by the same
  // permission the server enforces, which is what §10.4 asks for — and a role an
  // office defines now gets the buttons its grants entitle it to, instead of
  // none.
  const canCoSign = hasAnyPermission(user, CO_SIGN_ROLES);
  const canNotifySenior = hasAnyPermission(user, NOTIFY_SENIOR_ROLES);
  const canNotifyRegulators = hasAnyPermission(user, NOTIFY_REGULATOR_ROLES);

  const [incidents, setIncidents] = useState<IncidentReport[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Part 4 — the combined-duty reason, keyed by incident so two rows cannot share one box.
  const [declarations, setDeclarations] = useState<Record<string, string>>({});

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<IncidentSeverity>(
    INCIDENT_SEVERITIES[2],
  );

  // OWNER DECISION 56 — the containment description, per incident, so two rows
  // cannot share one box. Same shape as `rootCauseDrafts` below, which is the
  // established pattern on this screen for a mandatory free-text act.
  const [containDrafts, setContainDrafts] = useState<Record<string, string>>({});
  // PRIV-SOP-09 step 4's three outputs, per incident. `touches` starts UNDECIDED
  // rather than `false`: a pre-ticked box is an answer nobody gave, and the whole
  // point of this form is that the record stops claiming work that was not done.
  const [impactDrafts, setImpactDrafts] = useState<
    Record<string, { touches: boolean | null; categories: string; subjects: string }>
  >({});
  // What the act DID, per row — the silent-act defect, which her walk reported on
  // this very screen. `KycQueue` is the precedent and the composition rule is its:
  // build the sentence from strings ALREADY on the screen, so the outcome names a
  // real state and not one word of it is newly written.
  const [outcomes, setOutcomes] = useState<Record<string, string>>({});
  // Which row is in flight. `busy` is screen-level here (twelve `disabled={busy}`
  // sites) and a screen-level pending line would claim every row is working.
  const [actingId, setActingId] = useState<string | null>(null);

  const [rootCauseDrafts, setRootCauseDrafts] = useState<
    Record<string, string>
  >({});
  const [regulatorDrafts, setRegulatorDrafts] = useState<
    Record<string, string[]>
  >({});

  const load = useCallback(async () => {
    try {
      setIncidents(await listIncidents());
      setLoadError(null);
    } catch (err) {
      setIncidents(null);
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? permissionRefusal(t, 'incRefusalAct', 'incident.report')
          : err instanceof ApiError
            ? err.message
            : t("incLoadError"),
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

  /**
   * `opts.id` names the row in flight and `opts.describe` says what the act DID.
   *
   * Both are OPTIONAL and every pre-existing call site passes neither, so nothing
   * else on this screen changes behaviour. The acts that still say nothing when they
   * finish — classify, co-sign, the three notifications, recover, close — are left
   * as they are and REPORTED rather than quietly fixed here: `incident.classify` and
   * the notifications do not necessarily move the status, so the state-label outcome
   * below would print the same sentence before and after, which is the silence it is
   * meant to replace wearing a confirmation's clothes.
   */
  async function run<T>(
    fn: () => Promise<T>,
    opts?: { id?: string; describe?: (result: T) => string },
  ) {
    setBusy(true);
    setActingId(opts?.id ?? null);
    setActionError(null);
    if (opts?.id) setOutcomes((prev) => ({ ...prev, [opts.id as string]: "" }));
    try {
      const result = await fn();
      await load();
      if (opts?.id && opts.describe) {
        const said = opts.describe(result);
        setOutcomes((prev) => ({ ...prev, [opts.id as string]: said }));
      }
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : t("incActionError"),
      );
    } finally {
      setBusy(false);
      setActingId(null);
    }
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    await run(async () => {
      await createIncident({ title, description, severity });
      setTitle("");
      setDescription("");
    });
  }

  function toggleRegulator(incidentId: string, regulator: string) {
    setRegulatorDrafts((d) => {
      const current = d[incidentId] ?? [];
      const next = current.includes(regulator)
        ? current.filter((r) => r !== regulator)
        : [...current, regulator];
      return { ...d, [incidentId]: next };
    });
  }

  if (isLoading || !user) return null;

  return (
    <main style={pageStyle}>
      <h1>{t("incHeading")}</h1>
      <p style={{ opacity: 0.75, maxWidth: "46rem" }}>{t("incIntro")}</p>

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

      {canReport ? (
        <form onSubmit={submit} style={formStyle}>
          <label style={labelStyle}>
            {t("incTitleFieldLabel")}
            <input
              aria-label={t("incTitleLabel")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </label>
          <label style={labelStyle}>
            {t("incDescriptionLabel")}
            <input
              aria-label={t("incDescriptionLabel")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </label>
          <label style={labelStyle}>
            {t("incColSeverity")}
            <select
              aria-label={t("incColSeverity")}
              value={severity}
              onChange={(e) => setSeverity(e.target.value as IncidentSeverity)}
            >
              {INCIDENT_SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {t(ENUM_LABEL.IncidentSeverity[s])}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={busy}>
            {busy ? t("incSavingButton") : t("incReportButton")}
          </button>
        </form>
      ) : null}

      {incidents ? (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", minWidth: "92rem" }}>
            <thead>
              <tr>
                <th style={head}>{t("incColTitle")}</th>
                <th style={head}>{t("incColSeverity")}</th>
                <th style={head}>{t("incColStatus")}</th>
                <th style={head}>{t("incColClassification")}</th>
                {/* PRIV-FRM-06 § III and § IV — her form's own two section titles,
                    because what the two acts collect is what the form collects. */}
                <th style={head}>{t("incContainmentLogHeading")}</th>
                <th style={head}>{t("incImpactAssessmentHeading")}</th>
                <th style={head}>{t("incColAction")}</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((inc) => (
                <tr key={inc.id}>
                  <td style={cell}>{inc.title}</td>
                  <td style={cell}>
                    {t(ENUM_LABEL.IncidentSeverity[inc.severity])}
                    {/* Owner decision 55 — the LONGER form, because this marker sits beside the
                        incident's SEVERITY rather than beside a date, so a reader who is not told
                        WHICH clock expired cannot work it out from the row. */}
                    {inc.isContainmentOverdue
                      ? ` ${t("statusContainmentOverdue")}`
                      : ""}
                  </td>
                  <td style={cell}>
                    {t(ENUM_LABEL.IncidentStatus[inc.status])}
                  </td>
                  <td style={cell}>
                    {t(ENUM_LABEL.IncidentClassification[inc.classification])}
                    {/*
                      Part 4 step 5. The classification reads MATERIAL whether the DPO's judgement was
                      co-signed by somebody else or by the DPO herself, so without this the cell cannot
                      distinguish them — on the decision that starts the statutory notification clock.
                    */}
                    <CombinedDutyOnRecord
                      act={inc.classificationCombinedDutyAct}
                      testId={`combined-duty-incident-${inc.id}`}
                    />
                  </td>
                  {/*
                    OWNER DECISION 56 — «بس بغيّر الحالة إلى تم احتوائه».

                    WHO AND WHEN, PER ACTION. A joined string of descriptions would
                    discard exactly the two facts `PRIV-SRS-02` types the field with
                    («Timestamped containment actions»), which is why this is a child
                    table and why the cell is a list rather than a line.

                    Newest first, as the api sends it — `takenAt desc` in
                    `INCIDENT_INCLUDE`, not re-sorted here, so there is one answer to
                    what order the log is in.
                  */}
                  <td style={cell} data-testid={`inc-log-${inc.id}`}>
                    {inc.containmentActions.length === 0 ? (
                      "—"
                    ) : (
                      <ul
                        style={{
                          margin: 0,
                          paddingInlineStart: "1.1rem",
                          display: "flex",
                          flexDirection: "column",
                          gap: "0.35rem",
                          minWidth: "18rem",
                        }}
                      >
                        {inc.containmentActions.map((a) => (
                          <li key={a.id}>
                            <bdi>{a.description}</bdi>
                            <br />
                            <span style={{ opacity: 0.75, fontSize: "0.8rem" }}>
                              {/* NULL IS NO NAME, never the uuid beside it. The em dash
                                  here is one of the sites owner decision 60 classifies;
                                  its class is already known — the id is HELD and did not
                                  resolve — and the word is hers to choose, so this stays
                                  as its eleven siblings render it until she has ruled. */}
                              <bdi>{a.actionTakenByName ?? "—"}</bdi>
                              {" · "}
                              {formatDateTime(a.takenAt, language)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  {/*
                    PRIV-SOP-09 step 4's three outputs — «بس بظهرلي إنه تم تقييم أثره
                    وأنا ما قيّمت ولا عملت شي».

                    `false` AND `0` ARE ANSWERS. `touchesPersonalData === false` is the
                    DPO's finding that no personal data is involved, and an estimate of
                    `0` is the finding that nobody was affected — both are what a
                    regulator asks for. So the test is `=== null` and never `??` or
                    `||`: React renders `false` as NOTHING, and `0 || '—'` is an em dash,
                    so either shortcut turns a recorded finding into a blank cell.
                  */}
                  <td style={cell} data-testid={`inc-impact-${inc.id}`}>
                    {inc.impactAssessedAt === null ? (
                      "—"
                    ) : (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "0.2rem",
                          minWidth: "14rem",
                        }}
                      >
                        <span data-testid={`inc-touches-${inc.id}`}>
                          {t("incTouchesPersonalDataLabel")}:{" "}
                          {inc.touchesPersonalData === null
                            ? "—"
                            : t(inc.touchesPersonalData ? "commonYes" : "commonNo")}
                        </span>
                        <span data-testid={`inc-categories-${inc.id}`}>
                          {t("incDataCategoriesLabel")}:{" "}
                          <bdi>{inc.dataCategoriesAffected ?? "—"}</bdi>
                        </span>
                        <span data-testid={`inc-subjects-${inc.id}`}>
                          {t("incSubjectsEstimateLabel")}:{" "}
                          {inc.subjectsAffectedEstimate === null
                            ? "—"
                            : formatNumber(inc.subjectsAffectedEstimate, language)}
                        </span>
                      </div>
                    )}
                  </td>
                  <td style={cell}>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.3rem",
                        minWidth: "20rem",
                      }}
                    >
                      {/* Owner decision 41 — this incident's state history, without a pasted uuid.
                          Renders nothing without `workflow-history.read`. */}
                      <WorkflowHistoryLink
                        entityType="IncidentReport"
                        entityId={inc.id}
                      />
                      {/*
                        REACHABLE WHILE CONTAINED, not only while REPORTED.

                        Containment is PLURAL — `PRIV-SRS-02` types the field as a log
                        and the api APPENDS, proven by an e2e that contains twice and
                        reads a two-entry log back. Gating this on REPORTED alone would
                        leave the second and every later action unreachable from the
                        product while the route accepted them: a capability nobody can
                        exercise, which is the class `docs/unreachable-routes-triage.md`
                        exists for.
                      */}
                      {canContain &&
                      (inc.status === "REPORTED" || inc.status === "CONTAINED") ? (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "0.2rem",
                          }}
                        >
                          <label style={labelStyle}>
                            {t("incContainDescLabel")}
                            <textarea
                              aria-label={t("incContainDescLabel")}
                              // HER OWN EXAMPLE, which is why this screen needs no
                              // invented placeholder: «كعزل نظام أو تعطيل حساب» is the
                              // parenthetical from PRIV-FRM-06 § III.
                              placeholder={t("incContainDescHint")}
                              rows={2}
                              value={containDrafts[inc.id] ?? ""}
                              onChange={(e) =>
                                setContainDrafts((d) => ({
                                  ...d,
                                  [inc.id]: e.target.value,
                                }))
                              }
                            />
                          </label>
                          <button
                            type="button"
                            disabled={
                              busy ||
                              (containDrafts[inc.id] ?? "").trim().length <
                                CONTAINMENT_DESCRIPTION_MIN_LENGTH
                            }
                            onClick={() =>
                              void run(
                                () =>
                                  containIncident(inc.id, {
                                    description: (
                                      containDrafts[inc.id] ?? ""
                                    ).trim(),
                                  }),
                                {
                                  id: inc.id,
                                  // THE FIGURE THE ACT PRODUCED, not the state it
                                  // reached: a second containment leaves the status at
                                  // CONTAINED, so a status line would print the same
                                  // sentence before and after and say nothing. The log
                                  // length is what actually moved.
                                  describe: (updated) =>
                                    `${t("incContainmentLogHeading")}: ${formatNumber(
                                      updated.containmentActions.length,
                                      language,
                                    )}`,
                                },
                              ).then(() =>
                                setContainDrafts((d) => ({ ...d, [inc.id]: "" })),
                              )
                            }
                          >
                            {busy && actingId === inc.id
                              ? t("commonWorking")
                              : t("incContainButton")}
                          </button>
                        </div>
                      ) : null}
                      {/* PRIV-SOP-09 step 4, all three outputs or none — the server
                          refuses a partial assessment per field, so the button gates on
                          the same three rather than sending a request it knows will
                          400. `touches` must be DECIDED: `null` is not `false`. */}
                      {canContain && inc.status === "CONTAINED" ? (
                        (() => {
                          const draft =
                            impactDrafts[inc.id] ?? {
                              touches: null,
                              categories: "",
                              subjects: "",
                            };
                          const set = (
                            next: Partial<typeof draft>,
                          ) =>
                            setImpactDrafts((d) => ({
                              ...d,
                              [inc.id]: { ...draft, ...next },
                            }));
                          const estimate = Number(draft.subjects);
                          const ready =
                            draft.touches !== null &&
                            draft.categories.trim().length >=
                              CONTAINMENT_DESCRIPTION_MIN_LENGTH &&
                            draft.subjects.trim() !== "" &&
                            Number.isInteger(estimate) &&
                            estimate >= 0;
                          return (
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "0.2rem",
                              }}
                            >
                              <label
                                style={{
                                  display: "flex",
                                  gap: "0.3rem",
                                  alignItems: "center",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  aria-label={t("incTouchesPersonalDataLabel")}
                                  // `checked` is the DECIDED value; an undecided box is
                                  // unticked and the button stays disabled, so nobody
                                  // can submit `false` without having chosen it.
                                  checked={draft.touches === true}
                                  onChange={(e) =>
                                    set({ touches: e.target.checked })
                                  }
                                />
                                {t("incTouchesPersonalDataLabel")}
                              </label>
                              <label style={labelStyle}>
                                {t("incDataCategoriesLabel")}
                                <input
                                  aria-label={t("incDataCategoriesLabel")}
                                  placeholder={t("incDataCategoriesHint")}
                                  value={draft.categories}
                                  onChange={(e) =>
                                    set({ categories: e.target.value })
                                  }
                                />
                              </label>
                              <label style={labelStyle}>
                                {t("incSubjectsEstimateLabel")}
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  aria-label={t("incSubjectsEstimateLabel")}
                                  placeholder={t("incSubjectsEstimateHint")}
                                  value={draft.subjects}
                                  onChange={(e) =>
                                    set({ subjects: e.target.value })
                                  }
                                />
                              </label>
                              <button
                                type="button"
                                disabled={busy || !ready}
                                onClick={() =>
                                  void run(
                                    () =>
                                      assessIncidentImpact(inc.id, {
                                        touchesPersonalData:
                                          draft.touches === true,
                                        dataCategoriesAffected:
                                          draft.categories.trim(),
                                        subjectsAffectedEstimate: estimate,
                                      }),
                                    {
                                      id: inc.id,
                                      // The state the record reached — `KycQueue`'s own
                                      // composition, from this table's status heading
                                      // and the status badge's own label.
                                      describe: (updated) =>
                                        `${t("incColStatus")}: ${t(
                                          ENUM_LABEL.IncidentStatus[updated.status],
                                        )}`,
                                    },
                                  )
                                }
                              >
                                {busy && actingId === inc.id
                                  ? t("commonWorking")
                                  : t("incAssessButton")}
                              </button>
                            </div>
                          );
                        })()
                      ) : null}
                      {canClassify && inc.status === "IMPACT_ASSESSED" ? (
                        <div style={{ display: "flex", gap: "0.3rem" }}>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void run(() =>
                                classifyIncident(inc.id, "MATERIAL"),
                              )
                            }
                          >
                            {t("incClassifyMaterialButton")}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void run(() =>
                                classifyIncident(inc.id, "NON_MATERIAL"),
                              )
                            }
                          >
                            {t("incClassifyNonMaterialButton")}
                          </button>
                        </div>
                      ) : null}
                      {canCoSign &&
                      inc.status === "CLASSIFIED" &&
                      inc.classification === "MATERIAL" &&
                      !inc.seniorManagementCoSignUserId
                        ? (() => {
                            // Part 4 — the DPO who classified it may also co-sign, in an office that has
                            // declared COMBINED, only by saying why. Every other case is unchanged: no field,
                            // no extra click.
                            const needs = needsCombinedDutyDeclaration({
                              mode: user.dutySegregationMode,
                              makerUserId: inc.classifiedByDpoUserId,
                              currentUserId: user.id,
                              alreadyDecided: Boolean(
                                inc.seniorManagementCoSignUserId,
                              ),
                            });
                            const declaration = declarations[inc.id] ?? "";
                            return (
                              <>
                                {needs ? (
                                  <CombinedDutyReasonField
                                    id={inc.id}
                                    value={declaration}
                                    onChange={(next) =>
                                      setDeclarations((prev) => ({
                                        ...prev,
                                        [inc.id]: next,
                                      }))
                                    }
                                  />
                                ) : null}
                                <button
                                  type="button"
                                  disabled={
                                    busy ||
                                    (needs && combinedDutyTooShort(declaration))
                                  }
                                  onClick={() =>
                                    void run(() =>
                                      coSignIncident(
                                        inc.id,
                                        needs ? declaration.trim() : undefined,
                                      ),
                                    )
                                  }
                                >
                                  {t("incCoSignButton")}
                                </button>
                              </>
                            );
                          })()
                        : null}
                      {canNotifySenior &&
                      inc.classification === "MATERIAL" &&
                      !inc.seniorManagementNotifiedAt ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              notifyIncidentSeniorManagement(inc.id),
                            )
                          }
                        >
                          {t("incNotifySeniorButton")}
                        </button>
                      ) : null}
                      {canNotifyRegulators && inc.status === "CLASSIFIED" ? (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "0.2rem",
                          }}
                        >
                          {INCIDENT_REGULATORS.map((r) => (
                            <label
                              key={r}
                              style={{
                                display: "flex",
                                gap: "0.3rem",
                                alignItems: "center",
                              }}
                            >
                              <input
                                type="checkbox"
                                aria-label={t("incNotifyRoleAria", {
                                  role: r,
                                  id: inc.id,
                                })}
                                checked={(
                                  regulatorDrafts[inc.id] ?? []
                                ).includes(r)}
                                onChange={() => toggleRegulator(inc.id, r)}
                              />
                              {r}
                            </label>
                          ))}
                          <button
                            type="button"
                            disabled={
                              busy ||
                              (regulatorDrafts[inc.id] ?? []).length === 0
                            }
                            onClick={() =>
                              void run(() =>
                                notifyIncidentRegulators(
                                  inc.id,
                                  regulatorDrafts[inc.id] ?? [],
                                ),
                              )
                            }
                          >
                            {t("incNotifyRegulatorsButton")}
                          </button>
                        </div>
                      ) : null}
                      {canNotifyRegulators &&
                      inc.classification !== "NOT_YET_CLASSIFIED" &&
                      !inc.affectedDataSubjectsNotifiedAt ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              notifyIncidentAffectedSubjects(inc.id),
                            )
                          }
                        >
                          {t("incNotifySubjectsButton")}
                        </button>
                      ) : null}
                      {canContain && inc.status === "NOTIFIED" ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void run(() => recoverIncident(inc.id))
                          }
                        >
                          {t("incRecoverButton")}
                        </button>
                      ) : null}
                      {canContain && inc.status === "RECOVERED" ? (
                        <div style={{ display: "flex", gap: "0.3rem" }}>
                          <input
                            aria-label={t("incRootCauseAria")}
                            placeholder={t("incRootCauseLabel")}
                            value={rootCauseDrafts[inc.id] ?? ""}
                            onChange={(e) =>
                              setRootCauseDrafts((d) => ({
                                ...d,
                                [inc.id]: e.target.value,
                              }))
                            }
                          />
                          <button
                            type="button"
                            disabled={
                              busy || !(rootCauseDrafts[inc.id] ?? "").trim()
                            }
                            onClick={() =>
                              void run(() =>
                                closeIncident(
                                  inc.id,
                                  (rootCauseDrafts[inc.id] ?? "").trim(),
                                ),
                              )
                            }
                          >
                            {t("incCloseButton")}
                          </button>
                        </div>
                      ) : null}
                      {inc.status === "CLOSED" ? "—" : null}
                      {/*
                        The silent-act defect, on one of the six screens the measurement
                        named. `pending` is keyed on the ROW so a screen-level busy flag
                        cannot claim every incident is working; `outcome` is what the act
                        DID and never the word "done"; `error` stays screen-level because
                        that is where this page already holds it, and the component's own
                        precedence keeps a previous error off a running act.
                      */}
                      <ActionStatus
                        pending={
                          busy && actingId === inc.id
                            ? t("commonWorking")
                            : undefined
                        }
                        outcome={outcomes[inc.id] || undefined}
                        testId={`incident-${inc.id}`}
                        style={{ fontSize: "0.75rem" }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : loadError ? null : (
        // The loading state directive §2 requires; this page rendered
        // nothing at all while fetching. Guarded on loadError so an error
        // and a "Loading…" line never appear together.
        <p>{t("incLoading")}</p>
      )}
    </main>
  );
}
