"use client";

import { type CSSProperties, useCallback, useEffect, useState } from "react";
import type { IncidentSeverity } from "../../../lib/compliance-risk/incident-api";
import { ENUM_LABEL } from "../../../lib/i18n/enum-labels";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/auth/auth-context";
import { Fragment } from "react";
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
import {
  ActionStatus,
  Badge,
  Button,
  Card,
  DetailPanel,
  DetailSection,
  EmptyState,
  ErrorState,
  Field,
  KeyValue,
  PageHeader,
  Select,
  SkeletonList,
  Table,
  Td,
  TextArea,
  TextInput,
  Th,
  Tile,
  Tiles,
  TimelineLog,
  Tr,
} from "../../../components/ui";
import { formatDateTime, formatNumber } from "../../../lib/i18n/format";
import { ApiError } from "../../../lib/auth/api-client";
import { pageStackStyle } from "../../../components/lead/lead.styles";
import { hasAnyPermission } from "../../../lib/auth/permissions";
import { useLanguage } from "../../../lib/i18n/language-context";
import { permissionRefusal } from '../../../lib/i18n/permission-refusal';

const REPORT_ROLES = ["incident.report"];
const CONTAIN_ROLES = ["incident.contain"];
const CLASSIFY_ROLES = ["incident.classify"];
const CO_SIGN_ROLES = ["incident.classification.co-sign"];
const NOTIFY_SENIOR_ROLES = ["incident.senior-management.notify"];
const NOTIFY_REGULATOR_ROLES = ["incident.notify-regulator"];

/*
 * THE SCREEN'S OWN LAYOUT CONSTANTS, and the hand-rolled table they replaced is the finding.
 *
 * `cell` and `head` were a table built by hand, and the `<table>` carried `min-width: 92rem` —
 * SEVEN columns, three of which held a whole log, a three-field assessment and the entire action
 * apparatus. That is why this screen could not be read without scrolling sideways past the
 * columns that matter, and it is the crowding the owner named: *«الشاشات الي معجقة و فيها اكثر من
 * قسم تتزبط و تتنسق عشان الموظف ما يضيع»*. The table is five narrow columns now and the record
 * opens in place underneath, which is the approved reference screen's own arrangement.
 *
 * Every value below is on the five-step spacing scale. Nothing here carries a colour literal.
 */
const incidentFormStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))",
  gap: "var(--space-3)",
  alignItems: "end",
};

const incidentTitleStyle: CSSProperties = {
  fontWeight: "var(--weight-medium)" as CSSProperties["fontWeight"],
  color: "var(--ink-primary)",
};

/** The severity bar + its word. The word is always present; the bar never carries it alone. */
const severityStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-2)",
  fontSize: "var(--text-sm)",
};

const severityBarStyle: CSSProperties = {
  width: "3px",
  height: "0.9375rem",
  borderRadius: "var(--radius-sm)",
  display: "inline-block",
  flex: "none",
};

/** The expanded record's own cell — the panel supplies its ground and its padding. */
const detailCellStyle: CSSProperties = {
  padding: 0,
};

const actionStackStyle: CSSProperties = {
  display: "grid",
  gap: "var(--space-2)",
  marginTop: "var(--space-3)",
};

const buttonRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-2)",
};

const checkboxRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  fontSize: "var(--text-sm)",
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

  /*
   * THE FOUR SUMMARY TILES — the thing the owner singled out on the reference screen, in her own
   * words *«أشيك للموظف في شغله و بكون عنده زي مختصر للمعلومات»*.
   *
   * EVERY FIGURE IS A COUNT OVER THE ROWS THIS SCREEN ALREADY READ. Nothing is invented and no
   * second request was added: `listIncidents()` returns the register and these four partition it
   * by the states a DPO working the queue actually acts on.
   *
   * AND EVERY LABEL IS A STRING ALREADY SHIPPING. Three are the status and classification labels
   * the table itself renders (`incStatusReported`, `incClassMaterial`, `incStatusClosed`), so a
   * tile and the cell it counts cannot disagree about what a state is called. The fourth is
   * `statusContainmentOverdueTile`, the parenthetical marker with its brackets dropped — the same
   * run of characters, asserted as a substring of its own source. No Arabic was written.
   */
  const tiles =
    incidents === null
      ? null
      : {
          reported: incidents.filter((i) => i.status === 'REPORTED').length,
          overdue: incidents.filter((i) => i.isContainmentOverdue).length,
          material: incidents.filter((i) => i.classification === 'MATERIAL').length,
          closed: incidents.filter((i) => i.status === 'CLOSED').length,
        };

  /*
   * THE SEVERITY BAR — a state read by its SHAPE before its colour, which is the reference
   * screen's own treatment and WCAG 1.4.1 besides: colour never carries the meaning alone, and the
   * word is right beside it in every case.
   */
  const SEVERITY_INK: Record<IncidentSeverity, string> = {
    critical: 'var(--danger-ink)',
    high: 'var(--warning-ink)',
    medium: 'var(--ink-brand)',
    low: 'var(--ink-muted)',
  };

  const statusTone = (status: string) =>
    status === 'CLOSED' ? 'success' : status === 'REPORTED' ? 'warning' : 'info';

  return (
    <main style={pageStackStyle}>
      <PageHeader title={t('incHeading')} description={t('incIntro')} />

      {actionError ? <ErrorState title={actionError} /> : null}

      {tiles && incidents && incidents.length > 0 ? (
        <Tiles>
          <Tile
            icon="clock"
            value={formatNumber(tiles.reported, language)}
            label={t('incStatusReported')}
          />
          <Tile
            icon="alert"
            tone={tiles.overdue > 0 ? 'alarm' : 'plain'}
            value={formatNumber(tiles.overdue, language)}
            label={t('statusContainmentOverdueTile')}
          />
          <Tile
            icon="check"
            value={formatNumber(tiles.material, language)}
            label={t('incClassMaterial')}
          />
          <Tile
            icon="calendar"
            value={formatNumber(tiles.closed, language)}
            label={t('incStatusClosed')}
          />
        </Tiles>
      ) : null}

      {canReport ? (
        <Card title={t('incReportButton')}>
          <form onSubmit={submit} style={incidentFormStyle}>
            {/*
              `incTitleLabel` IS THE VISIBLE LABEL NOW, and `incTitleFieldLabel` is withdrawn.
              This input carried `aria-label="Incident title"` over a visible label reading
              "Title" — and an `aria-label` REPLACES the accessible name, so the two readers were
              told different things and the ARIA one was the better of the two. The informative
              string is now what both of them get.
            */}
            <Field label={t('incTitleLabel')} required>
              {(p) => (
                <TextInput
                  {...p}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
              )}
            </Field>
            <Field label={t('incDescriptionLabel')} required>
              {(p) => (
                <TextInput
                  {...p}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                />
              )}
            </Field>
            <Field label={t('incColSeverity')}>
              {(p) => (
                <Select
                  {...p}
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value as IncidentSeverity)}
                >
                  {INCIDENT_SEVERITIES.map((s) => (
                    <option key={s} value={s}>
                      {t(ENUM_LABEL.IncidentSeverity[s])}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Button type="submit" variant="primary" loading={busy}>
              {busy ? t('incSavingButton') : t('incReportButton')}
            </Button>
          </form>
        </Card>
      ) : null}

      {loadError ? (
        <ErrorState title={loadError} />
      ) : incidents === null ? (
        <SkeletonList rows={3} label={t('incLoading')} />
      ) : incidents.length === 0 ? (
        /*
         * THE EMPTY STATE THIS SCREEN NEVER HAD — and `incNone` has shipped in both languages,
         * with ZERO consumers, since before this batch. With no incidents the screen rendered a
         * table header over nothing.
         *
         * `four-states.py` reports this screen as `y y y y`. It is wrong about the empty column,
         * and the cause is worth knowing: the detector counts a `.length === 0` branch, and this
         * file has one — `inc.containmentActions.length === 0`, which is a PER-ROW check inside a
         * cell, nothing to do with the screen having no incidents at all. Found by reading the
         * screen rather than the count, and recorded in the design register rather than fixed in
         * the gate, because distinguishing a screen-level empty branch from a per-row one needs
         * more than a text match.
         */
        <EmptyState title={t('incNone')} />
      ) : (
        <Card padded={false}>
          <Table>
            <thead>
              <Tr>
                <Th>{t('incColTitle')}</Th>
                <Th>{t('incColSeverity')}</Th>
                <Th>{t('incColStatus')}</Th>
                <Th>{t('incColClassification')}</Th>
                <Th>{t('incColAction')}</Th>
              </Tr>
            </thead>
            <tbody>
              {incidents.map((inc) => (
                <Fragment key={inc.id}>
                  <Tr>
                    <Td>
                      <span style={incidentTitleStyle}>{inc.title}</span>
                    </Td>
                    <Td>
                      {/*
                        Owner decision 55 — the LONGER marker form, because it sits beside the
                        incident's SEVERITY rather than beside a date, so a reader who is not told
                        WHICH clock expired cannot work it out from the row.
                      */}
                      <span style={severityStyle}>
                        <i
                          aria-hidden="true"
                          style={{ ...severityBarStyle, background: SEVERITY_INK[inc.severity] }}
                        />
                        {t(ENUM_LABEL.IncidentSeverity[inc.severity])}
                        {inc.isContainmentOverdue ? ` ${t('statusContainmentOverdue')}` : ''}
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={statusTone(inc.status)}>
                        {t(ENUM_LABEL.IncidentStatus[inc.status])}
                      </Badge>
                    </Td>
                    <Td>
                      <Badge
                        tone={
                          inc.classification === 'MATERIAL'
                            ? 'danger'
                            : inc.classification === 'NON_MATERIAL'
                              ? 'neutral'
                              : 'neutral'
                        }
                      >
                        {t(ENUM_LABEL.IncidentClassification[inc.classification])}
                      </Badge>
                      {/*
                        Part 4 step 5. The classification reads MATERIAL whether the DPO's judgement was
                        co-signed by somebody else or by the DPO herself, so without this the cell cannot
                        distinguish them — on the decision that starts the statutory notification clock.
                      */}
                      <CombinedDutyOnRecord
                        act={inc.classificationCombinedDutyAct}
                        testId={`combined-duty-incident-${inc.id}`}
                      />
                    </Td>
                    <Td>
                      {/* Owner decision 41 — this incident's state history, without a pasted uuid.
                          Renders nothing without `workflow-history.read`. */}
                      <WorkflowHistoryLink entityType="IncidentReport" entityId={inc.id} />
                    </Td>
                  </Tr>

                  {/*
                    THE RECORD, OPENED IN PLACE — the reference screen's own arrangement, and the
                    answer to this screen's real defect: the containment log, the impact
                    assessment and the whole action apparatus were crammed into table CELLS, which
                    is why the table carried `min-width: 92rem` and could not be read without
                    scrolling sideways past the columns that matter.

                    IT IS ALWAYS RENDERED, not expanded on a toggle, and that is a deliberate
                    departure from the reference. An expand/collapse is an INTERACTION change,
                    which this batch does not make — and every assertion in the 479-line spec that
                    reads a log or an assessment would otherwise have to learn to click first,
                    which is a design pass quietly weakening a suite. Proposed in the register.
                  */}
                  <tr>
                    <td colSpan={5} style={detailCellStyle}>
                      <DetailPanel>
                        {/*
                          OWNER DECISION 56 — «بس بغيّر الحالة إلى تم احتوائه».

                          WHO AND WHEN, PER ACTION. A joined string of descriptions would discard
                          exactly the two facts `PRIV-SRS-02` types the field with («Timestamped
                          containment actions»), which is why this is a child table and why the
                          section is a log rather than a line.

                          Newest first, as the api sends it — `takenAt desc` in `INCIDENT_INCLUDE`,
                          not re-sorted here, so there is one answer to what order the log is in.
                        */}
                        <DetailSection icon="check" title={t('incContainmentLogHeading')}>
                          <div data-testid={`inc-log-${inc.id}`}>
                            {inc.containmentActions.length === 0 ? (
                              '—'
                            ) : (
                              <TimelineLog
                                entries={inc.containmentActions.map((a) => ({
                                  when: formatDateTime(a.takenAt, language),
                                  what: <bdi>{a.description}</bdi>,
                                  /* NULL IS NO NAME, never the uuid beside it. The owner
                                     ruled on this site by name on 2026-10-29: the id is HELD and
                                     did not resolve, which is the third of her three cases, and
                                     «غير متوفّر» is her word for it. On a containment log that
                                     matters more than it looks — the log exists to say WHO acted,
                                     so a reader needs to know the name is gone rather than that
                                     the column is decorative. */
                                  who: (
                                    <bdi>{a.actionTakenByName ?? t('commonNameNotResolved')}</bdi>
                                  ),
                                }))}
                              />
                            )}
                          </div>

                          {/*
                            REACHABLE WHILE CONTAINED, not only while REPORTED.

                            Containment is PLURAL — `PRIV-SRS-02` types the field as a log and the
                            api APPENDS, proven by an e2e that contains twice and reads a two-entry
                            log back. Gating this on REPORTED alone would leave the second and every
                            later action unreachable from the product while the route accepted them:
                            a capability nobody can exercise, which is the class
                            `docs/unreachable-routes-triage.md` exists for.
                          */}
                          {canContain &&
                          (inc.status === 'REPORTED' || inc.status === 'CONTAINED') ? (
                            <div style={actionStackStyle}>
                              <Field label={t('incContainDescLabel')}>
                                {(p) => (
                                  <TextArea
                                    {...p}
                                    // HER OWN EXAMPLE, which is why this screen needs no invented
                                    // placeholder: «كعزل نظام أو تعطيل حساب» is the parenthetical
                                    // from PRIV-FRM-06 § III.
                                    placeholder={t('incContainDescHint')}
                                    rows={2}
                                    value={containDrafts[inc.id] ?? ''}
                                    onChange={(e) =>
                                      setContainDrafts((d) => ({ ...d, [inc.id]: e.target.value }))
                                    }
                                  />
                                )}
                              </Field>
                              <Button
                                type="button"
                                size="sm"
                                variant="primary"
                                disabled={
                                  busy ||
                                  (containDrafts[inc.id] ?? '').trim().length <
                                    CONTAINMENT_DESCRIPTION_MIN_LENGTH
                                }
                                onClick={() =>
                                  void run(
                                    () =>
                                      containIncident(inc.id, {
                                        description: (containDrafts[inc.id] ?? '').trim(),
                                      }),
                                    {
                                      id: inc.id,
                                      // THE FIGURE THE ACT PRODUCED, not the state it reached: a
                                      // second containment leaves the status at CONTAINED, so a
                                      // status line would print the same sentence before and after
                                      // and say nothing. The log length is what actually moved.
                                      describe: (updated) =>
                                        `${t('incContainmentLogHeading')}: ${formatNumber(
                                          updated.containmentActions.length,
                                          language,
                                        )}`,
                                    },
                                  ).then(() =>
                                    setContainDrafts((d) => ({ ...d, [inc.id]: '' })),
                                  )
                                }
                              >
                                {busy && actingId === inc.id
                                  ? t('commonWorking')
                                  : t('incContainButton')}
                              </Button>
                            </div>
                          ) : null}
                        </DetailSection>

                        {/*
                          PRIV-SOP-09 step 4's three outputs — «بس بظهرلي إنه تم تقييم أثره وأنا ما
                          قيّمت ولا عملت شي».

                          `false` AND `0` ARE ANSWERS. `touchesPersonalData === false` is the DPO's
                          finding that no personal data is involved, and an estimate of `0` is the
                          finding that nobody was affected — both are what a regulator asks for. So
                          the test is `=== null` and never `??` or `||`: React renders `false` as
                          NOTHING, and `0 || '—'` is an em dash, so either shortcut turns a recorded
                          finding into a blank cell.
                        */}
                        <DetailSection icon="search" title={t('incImpactAssessmentHeading')}>
                          <div data-testid={`inc-impact-${inc.id}`}>
                            {/* NEVER PERFORMED, said in words — owner decision 60's first
                                case, and the one her own complaint names: «بس بظهرلي إنه تم تقييم
                                أثره وأنا ما قيّمت ولا عملت شي». An em dash on a statutory impact
                                assessment is the worst place in the product for *was this
                                forgotten, or does it not apply?*, because the answer decides
                                whether somebody has to go and do it. */}
                            {inc.impactAssessedAt === null ? (
                              t('commonNotAssessedYet')
                            ) : (
                              <KeyValue
                                rows={[
                                  {
                                    term: t('incTouchesPersonalDataLabel'),
                                    value: (
                                      <span data-testid={`inc-touches-${inc.id}`}>
                                        {inc.touchesPersonalData === null
                                          ? '—'
                                          : t(
                                              inc.touchesPersonalData
                                                ? 'commonYes'
                                                : 'commonNo',
                                            )}
                                      </span>
                                    ),
                                  },
                                  {
                                    term: t('incDataCategoriesLabel'),
                                    value: (
                                      <span data-testid={`inc-categories-${inc.id}`}>
                                        <bdi>{inc.dataCategoriesAffected ?? '—'}</bdi>
                                      </span>
                                    ),
                                  },
                                  {
                                    term: t('incSubjectsEstimateLabel'),
                                    value: (
                                      <span data-testid={`inc-subjects-${inc.id}`}>
                                        {inc.subjectsAffectedEstimate === null
                                          ? '—'
                                          : formatNumber(inc.subjectsAffectedEstimate, language)}
                                      </span>
                                    ),
                                  },
                                ]}
                              />
                            )}
                          </div>

                          {/* PRIV-SOP-09 step 4, all three outputs or none — the server refuses a
                              partial assessment per field, so the button gates on the same three
                              rather than sending a request it knows will 400. `touches` must be
                              DECIDED: `null` is not `false`. */}
                          {canContain && inc.status === 'CONTAINED'
                            ? (() => {
                                const draft =
                                  impactDrafts[inc.id] ?? {
                                    touches: null,
                                    categories: '',
                                    subjects: '',
                                  };
                                const set = (next: Partial<typeof draft>) =>
                                  setImpactDrafts((d) => ({
                                    ...d,
                                    [inc.id]: { ...draft, ...next },
                                  }));
                                const estimate = Number(draft.subjects);
                                const ready =
                                  draft.touches !== null &&
                                  draft.categories.trim().length >=
                                    CONTAINMENT_DESCRIPTION_MIN_LENGTH &&
                                  draft.subjects.trim() !== '' &&
                                  Number.isInteger(estimate) &&
                                  estimate >= 0;
                                return (
                                  <div style={actionStackStyle}>
                                    <label style={checkboxRowStyle}>
                                      <input
                                        type="checkbox"
                                        aria-label={t('incTouchesPersonalDataLabel')}
                                        // `checked` is the DECIDED value; an undecided box is
                                        // unticked and the button stays disabled, so nobody can
                                        // submit `false` without having chosen it.
                                        checked={draft.touches === true}
                                        onChange={(e) => set({ touches: e.target.checked })}
                                      />
                                      {t('incTouchesPersonalDataLabel')}
                                    </label>
                                    <Field label={t('incDataCategoriesLabel')}>
                                      {(p) => (
                                        <TextInput
                                          {...p}
                                          placeholder={t('incDataCategoriesHint')}
                                          value={draft.categories}
                                          onChange={(e) => set({ categories: e.target.value })}
                                        />
                                      )}
                                    </Field>
                                    <Field label={t('incSubjectsEstimateLabel')}>
                                      {(p) => (
                                        <TextInput
                                          {...p}
                                          type="number"
                                          min={0}
                                          step={1}
                                          placeholder={t('incSubjectsEstimateHint')}
                                          value={draft.subjects}
                                          onChange={(e) => set({ subjects: e.target.value })}
                                        />
                                      )}
                                    </Field>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="primary"
                                      disabled={busy || !ready}
                                      onClick={() =>
                                        void run(
                                          () =>
                                            assessIncidentImpact(inc.id, {
                                              touchesPersonalData: draft.touches === true,
                                              dataCategoriesAffected: draft.categories.trim(),
                                              subjectsAffectedEstimate: estimate,
                                            }),
                                          {
                                            id: inc.id,
                                            // The state the record reached — `KycQueue`'s own
                                            // composition, from this table's status heading and
                                            // the status badge's own label.
                                            describe: (updated) =>
                                              `${t('incColStatus')}: ${t(
                                                ENUM_LABEL.IncidentStatus[updated.status],
                                              )}`,
                                          },
                                        )
                                      }
                                    >
                                      {busy && actingId === inc.id
                                        ? t('commonWorking')
                                        : t('incAssessButton')}
                                    </Button>
                                  </div>
                                );
                              })()
                            : null}
                        </DetailSection>

                        {/*
                          WHAT THIS RECORD IS WAITING FOR. Every remaining act in the chain —
                          classify, co-sign, the three notifications, recover, close — sits in one
                          section rather than stacked into the row's last cell, where they were
                          indistinguishable from the data beside them.
                        */}
                        {/*
                          THE SECTION IS NOT RENDERED WHEN THERE IS NOTHING IN IT, and the
                          screenshot is what found that. A reader whose grants do not reach any act
                          on this record — a DPO looking at an incident only `incident.contain` can
                          move — was shown a titled, empty card. A heading over nothing is the
                          emptiness this batch exists to remove, and it is also the frontend
                          directive's own rule one step up: a control a role cannot use does not
                          exist on their screen, so neither does the box it would have sat in.

                          `ActionStatus` is counted in the condition rather than assumed, because
                          an act that has just finished must still be able to report what it did
                          even when the control that started it has since disappeared from the row.
                        */}
                        {(() => {
                          const canAct =
                            (canClassify && inc.status === 'IMPACT_ASSESSED') ||
                            (canCoSign &&
                              inc.status === 'CLASSIFIED' &&
                              inc.classification === 'MATERIAL' &&
                              !inc.seniorManagementCoSignUserId) ||
                            (canNotifySenior &&
                              inc.classification === 'MATERIAL' &&
                              !inc.seniorManagementNotifiedAt) ||
                            (canNotifyRegulators && inc.status === 'CLASSIFIED') ||
                            (canNotifyRegulators &&
                              inc.classification !== 'NOT_YET_CLASSIFIED' &&
                              !inc.affectedDataSubjectsNotifiedAt) ||
                            (canContain && inc.status === 'NOTIFIED') ||
                            (canContain && inc.status === 'RECOVERED') ||
                            inc.status === 'CLOSED' ||
                            Boolean(outcomes[inc.id]) ||
                            (busy && actingId === inc.id);
                          if (!canAct) return null;
                          return (
                        <DetailSection icon="alert" title={t('incColAction')}>
                          <div style={actionStackStyle}>
                            {canClassify && inc.status === 'IMPACT_ASSESSED' ? (
                              <div style={buttonRowStyle}>
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={busy}
                                  onClick={() =>
                                    void run(() => classifyIncident(inc.id, 'MATERIAL'))
                                  }
                                >
                                  {t('incClassifyMaterialButton')}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={busy}
                                  onClick={() =>
                                    void run(() => classifyIncident(inc.id, 'NON_MATERIAL'))
                                  }
                                >
                                  {t('incClassifyNonMaterialButton')}
                                </Button>
                              </div>
                            ) : null}
                            {canCoSign &&
                            inc.status === 'CLASSIFIED' &&
                            inc.classification === 'MATERIAL' &&
                            !inc.seniorManagementCoSignUserId
                              ? (() => {
                                  // Part 4 — the DPO who classified it may also co-sign, in an office that has
                                  // declared COMBINED, only by saying why. Every other case is unchanged: no field,
                                  // no extra click.
                                  const needs = needsCombinedDutyDeclaration({
                                    mode: user.dutySegregationMode,
                                    makerUserId: inc.classifiedByDpoUserId,
                                    currentUserId: user.id,
                                    alreadyDecided: Boolean(inc.seniorManagementCoSignUserId),
                                  });
                                  const declaration = declarations[inc.id] ?? '';
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
                                      <Button
                                        type="button"
                                        size="sm"
                                        disabled={
                                          busy || (needs && combinedDutyTooShort(declaration))
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
                                        {t('incCoSignButton')}
                                      </Button>
                                    </>
                                  );
                                })()
                              : null}
                            {canNotifySenior &&
                            inc.classification === 'MATERIAL' &&
                            !inc.seniorManagementNotifiedAt ? (
                              <Button
                                type="button"
                                size="sm"
                                disabled={busy}
                                onClick={() =>
                                  void run(() => notifyIncidentSeniorManagement(inc.id))
                                }
                              >
                                {t('incNotifySeniorButton')}
                              </Button>
                            ) : null}
                            {canNotifyRegulators && inc.status === 'CLASSIFIED' ? (
                              <div style={actionStackStyle}>
                                {INCIDENT_REGULATORS.map((r) => (
                                  <label key={r} style={checkboxRowStyle}>
                                    <input
                                      type="checkbox"
                                      aria-label={t('incNotifyRoleAria', {
                                        role: r,
                                        id: inc.id,
                                      })}
                                      checked={(regulatorDrafts[inc.id] ?? []).includes(r)}
                                      onChange={() => toggleRegulator(inc.id, r)}
                                    />
                                    {r}
                                  </label>
                                ))}
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={busy || (regulatorDrafts[inc.id] ?? []).length === 0}
                                  onClick={() =>
                                    void run(() =>
                                      notifyIncidentRegulators(
                                        inc.id,
                                        regulatorDrafts[inc.id] ?? [],
                                      ),
                                    )
                                  }
                                >
                                  {t('incNotifyRegulatorsButton')}
                                </Button>
                              </div>
                            ) : null}
                            {canNotifyRegulators &&
                            inc.classification !== 'NOT_YET_CLASSIFIED' &&
                            !inc.affectedDataSubjectsNotifiedAt ? (
                              <Button
                                type="button"
                                size="sm"
                                disabled={busy}
                                onClick={() =>
                                  void run(() => notifyIncidentAffectedSubjects(inc.id))
                                }
                              >
                                {t('incNotifySubjectsButton')}
                              </Button>
                            ) : null}
                            {canContain && inc.status === 'NOTIFIED' ? (
                              <Button
                                type="button"
                                size="sm"
                                disabled={busy}
                                onClick={() => void run(() => recoverIncident(inc.id))}
                              >
                                {t('incRecoverButton')}
                              </Button>
                            ) : null}
                            {canContain && inc.status === 'RECOVERED' ? (
                              <div style={actionStackStyle}>
                                {/*
                                  `incRootCauseAria` IS THE VISIBLE LABEL NOW and
                                  `incRootCauseLabel` is withdrawn. This input had NO visible label
                                  at all — an `aria-label` and a placeholder carrying the same
                                  words, one capitalised and one not — so a sighted reader had
                                  nothing to read once they started typing and the placeholder
                                  vanished, which is the one thing a placeholder must never be
                                  asked to do.
                                */}
                                <Field label={t('incRootCauseAria')}>
                                  {(p) => (
                                    <TextInput
                                      {...p}
                                      value={rootCauseDrafts[inc.id] ?? ''}
                                      onChange={(e) =>
                                        setRootCauseDrafts((d) => ({
                                          ...d,
                                          [inc.id]: e.target.value,
                                        }))
                                      }
                                    />
                                  )}
                                </Field>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="primary"
                                  disabled={busy || !(rootCauseDrafts[inc.id] ?? '').trim()}
                                  onClick={() =>
                                    void run(() =>
                                      closeIncident(
                                        inc.id,
                                        (rootCauseDrafts[inc.id] ?? '').trim(),
                                      ),
                                    )
                                  }
                                >
                                  {t('incCloseButton')}
                                </Button>
                              </div>
                            ) : null}
                            {inc.status === 'CLOSED' ? '—' : null}
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
                                busy && actingId === inc.id ? t('commonWorking') : undefined
                              }
                              outcome={outcomes[inc.id] || undefined}
                              testId={`incident-${inc.id}`}
                            />
                          </div>
                        </DetailSection>
                          );
                        })()}
                      </DetailPanel>
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </main>
  );
}
