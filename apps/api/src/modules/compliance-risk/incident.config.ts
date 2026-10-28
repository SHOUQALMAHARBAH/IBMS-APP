import type { CombinedDutyAct } from '@ibms/db';
import {
  combinedDutyActView,
  type CombinedDutyActView,
} from '../../common/duty-segregation.view';
import type { IncidentClassification, IncidentStatus, Prisma } from '@ibms/db';

/**
 * Process 55/Part 6.2/Part 7.4 — the unified security + personal-data breach
 * workflow (backlog Part C #55's three checkboxes: the full state machine,
 * senior-management notification within 1 hour of Material classification,
 * and independent multi-regulator notification). The pure, deterministic
 * core: the severity/regulator domains, the containment-overdue check, and
 * the view/audit-snapshot builders.
 *
 * `IncidentReport` (Part 6.2/7.4 core schema), `IncidentStatus` /
 * `IncidentClassification`, and `WORKFLOW_TRANSITIONS.IncidentReport`
 * (a strictly linear `REPORTED -> CONTAINED -> IMPACT_ASSESSED -> CLASSIFIED
 * -> NOTIFIED -> RECOVERED -> CLOSED` chain, cited verbatim from
 * `workflow-state-transitions.md`) all pre-existed before this module — this
 * is their first real consumer. `SLA_REGISTRY`'s `incident_containment` (4
 * hours) and `incident_senior_management_notification` (1 hour) entries also
 * pre-existed. **No migration widens the model** — the maker/checker pair
 * (`classifiedByDpoUserId` / `seniorManagementCoSignUserId`) already had
 * both columns; the one migration this process adds
 * (`20260906120000_add_incident_maker_checker_check`) only adds the missing
 * DB-layer CHECK constraint backstop, the `Complaint`/`DataSubjectRequest`
 * shape. **No seed change** — `incident.report` / `incident.contain` /
 * `incident.classify` / `incident.notify-regulator` were all pre-seeded
 * ahead of time.
 *
 * This model is ALSO Part D's M09 (Incident & Breach Management) —
 * `pcms-privacy-modules.md`'s own one-line summary ("detection ->
 * containment -> notification -> RCA") and governing-document citation
 * (`Governing Policy §12`, `PRIV-SOP-09`) match this model's own doc comment
 * verbatim. Building backlog #55 is, in effect, also building M09 — see
 * `ibms-brain/meta/context/incident-management.md` for the full
 * cross-reference.
 *
 * `ibms-brain/meta/context/incident-management.md`.
 */

export const INCIDENT_SEVERITIES = [
  'low',
  'medium',
  'high',
  'critical',
] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

/** The three regulators named in the backlog's third checkbox — one incident
 * may trigger more than one, so this is a multi-select set, not a single
 * value (`IncidentReport.notifiedRegulators: String[]`). */
export const INCIDENT_REGULATORS = [
  'CBJ',
  'NCSC',
  'Personal_Data_Protection_Council',
] as const;
export type IncidentRegulator = (typeof INCIDENT_REGULATORS)[number];

/** Cap on a book-wide `IncidentReport` list. */
export const INCIDENT_READ_LIMIT = 5000;

/** Only `critical` severity carries the 4-hour containment target (the
 * backlog's own wording: "4-hour target for critical"). */
export function requiresContainmentSla(severity: string): boolean {
  return severity === 'critical';
}

/** Whether a critical-severity incident's containment is overdue **right
 * now** — pure, `now` injected so the view and its tests share one clock.
 * The generic `SlaTimer` (`incident_containment`) is the durable, dashboard-
 * visible record of this same fact; this is a cheap, live-recomputed
 * at-a-glance convenience on the incident's own read view, the
 * `BrokerLicense.isCurrentlyLapsed` / `ComplianceCalendarItem.isOverdue`
 * shape. */
export function isContainmentOverdue(
  incident: { severity: string; containedAt: Date | null; reportedAt: Date },
  now: Date,
): boolean {
  if (!requiresContainmentSla(incident.severity) || incident.containedAt) {
    return false;
  }
  const fourHoursMs = 4 * 60 * 60 * 1000;
  return now.getTime() - incident.reportedAt.getTime() > fourHoursMs;
}

export interface IncidentReportRow {
  id: string;
  title: string;
  description: string;
  severity: string;
  status: IncidentStatus;
  reportedAt: Date;
  containedAt: Date | null;
  impactAssessedAt: Date | null;
  classification: IncidentClassification;
  classifiedByDpoUserId: string | null;
  seniorManagementCoSignUserId: string | null;
  seniorManagementNotifiedAt: Date | null;
  notifiedRegulators: string[];
  notifiedAt: Date | null;
  affectedDataSubjectsNotifiedAt: Date | null;
  rootCauseAnalysis: string | null;
  recoveredAt: Date | null;
  closedAt: Date | null;
  classificationCombinedDutyAct: CombinedDutyAct | null;
  /** Owner decision 56 — PRIV-SRS-02's `containment_actions` log. REQUIRED on the
   *  row type rather than optional, which is what makes the compiler name every
   *  read path: an optional field would leave one of them projecting an empty log
   *  while the others carried it, and the screen could not tell that apart from an
   *  incident nobody has contained. */
  containmentActions: IncidentContainmentActionRow[];
  touchesPersonalData: boolean | null;
  dataCategoriesAffected: string | null;
  subjectsAffectedEstimate: number | null;
  occurredAt: Date | null;
  reportedByUserId: string | null;
}

/** One entry of PRIV-SRS-02's **Text (log)** — «Timestamped containment actions».
 *  WHO and WHEN are part of the entry because the dictionary says timestamped and the
 *  procedure assigns the step to a function; a plain string could carry neither. */
export interface IncidentContainmentActionRow {
  id: string;
  description: string;
  actionTakenByUserId: string;
  takenAt: Date;
}

export interface IncidentReportView {
  id: string;
  title: string;
  description: string;
  severity: string;
  status: string;
  reportedAt: string;
  containedAt: string | null;
  impactAssessedAt: string | null;
  classification: string;
  classifiedByDpoUserId: string | null;
  seniorManagementCoSignUserId: string | null;
  /**
   * Part 4 step 5 — present when ONE person both classified the incident and co-signed that
   * classification, in an office that declared COMBINED. The co-sign stamp reads as filled either way.
   */
  classificationCombinedDutyAct: CombinedDutyActView | null;
  seniorManagementNotifiedAt: string | null;
  notifiedRegulators: string[];
  notifiedAt: string | null;
  affectedDataSubjectsNotifiedAt: string | null;
  rootCauseAnalysis: string | null;
  recoveredAt: string | null;
  closedAt: string | null;
  /** Derived — see `isContainmentOverdue`. */
  isContainmentOverdue: boolean;
  /**
   * OWNER DECISION 56 — WHAT WAS ACTUALLY DONE, newest first.
   *
   * Her words were «بس بغيّر الحالة إلى تم احتوائه»: the status changed and nothing
   * else existed to show. This array is the answer, and the NAME is deliberately
   * absent — `actionTakenByUserId` is a uuid, resolved to a person by decision 48's
   * resolver where a screen needs one, and resolving it here would put a second
   * answer to *who did this* in a config file.
   */
  containmentActions: {
    id: string;
    description: string;
    actionTakenByUserId: string;
    /**
     * WHO, BY NAME — decision 48, through `UserRepository.displayNamesForUserIds`.
     *
     * REQUIRED on this shape rather than optional, which is what makes the compiler
     * name every projection path. NULL means NO NAME and must never be filled from
     * the uuid beside it: the id stays on the wire because the list is keyed on
     * `id`, and what may not reach a reader is the id in place of a person.
     *
     * A log that showed only descriptions would discard the two facts the dictionary
     * types — timestamped, and attributable — which is the whole reason this is a
     * child table rather than a text column.
     */
    actionTakenByName: string | null;
    takenAt: string;
  }[];
  /** PRIV-SOP-09 step 4's three outputs. All three or none — the row-level CHECK
   *  `IncidentReport_impact_assessment_complete` makes any other combination
   *  unrepresentable once `impactAssessedAt` is set. */
  touchesPersonalData: boolean | null;
  dataCategoriesAffected: string | null;
  subjectsAffectedEstimate: number | null;
  /** `occurred_date` — distinct from `reportedAt`, which is `detected_date`. */
  occurredAt: string | null;
  reportedByUserId: string | null;
}

export function deriveIncidentReportView(
  row: IncidentReportRow,
  now: Date,
  /**
   * Decision 48's resolved names, keyed by user id. REQUIRED rather than optional:
   * an optional argument would leave one call path projecting a nameless log while
   * the others carried names — a name after a CONTAIN and none after a LIST, which is
   * the `IncidentReport.load()` defect and is invisible to a test that only reads.
   * The compiler names every site instead.
   */
  actorNames: ReadonlyMap<string, string>,
): IncidentReportView {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    severity: row.severity,
    status: row.status,
    reportedAt: row.reportedAt.toISOString(),
    containedAt: row.containedAt ? row.containedAt.toISOString() : null,
    impactAssessedAt: row.impactAssessedAt
      ? row.impactAssessedAt.toISOString()
      : null,
    classification: row.classification,
    classifiedByDpoUserId: row.classifiedByDpoUserId,
    seniorManagementCoSignUserId: row.seniorManagementCoSignUserId,
    classificationCombinedDutyAct: combinedDutyActView(
      row.classificationCombinedDutyAct,
    ),
    seniorManagementNotifiedAt: row.seniorManagementNotifiedAt
      ? row.seniorManagementNotifiedAt.toISOString()
      : null,
    notifiedRegulators: row.notifiedRegulators,
    notifiedAt: row.notifiedAt ? row.notifiedAt.toISOString() : null,
    affectedDataSubjectsNotifiedAt: row.affectedDataSubjectsNotifiedAt
      ? row.affectedDataSubjectsNotifiedAt.toISOString()
      : null,
    rootCauseAnalysis: row.rootCauseAnalysis,
    recoveredAt: row.recoveredAt ? row.recoveredAt.toISOString() : null,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    isContainmentOverdue: isContainmentOverdue(row, now),
    containmentActions: row.containmentActions.map((a) => ({
      id: a.id,
      description: a.description,
      actionTakenByUserId: a.actionTakenByUserId,
      // A MISSING KEY IS NO NAME, never the uuid — decision 48's rule in the one
      // place it can be broken quietly.
      actionTakenByName: actorNames.get(a.actionTakenByUserId) ?? null,
      takenAt: a.takenAt.toISOString(),
    })),
    touchesPersonalData: row.touchesPersonalData,
    dataCategoriesAffected: row.dataCategoriesAffected,
    subjectsAffectedEstimate: row.subjectsAffectedEstimate,
    occurredAt: row.occurredAt ? row.occurredAt.toISOString() : null,
    reportedByUserId: row.reportedByUserId,
  };
}

/** CREATE/UPDATE audit `afterValue`. `title`/`description`/
 * `rootCauseAnalysis` are internal incident narratives — a security/privacy
 * breach report is exactly the kind of content
 * `ibms-brain/meta/lex/sensitive-data-handling.md` has in mind, so
 * `NO_FULL_ACCOUNT_NUMBER` is applied at the DTO layer (not here) — included
 * verbatim in the audit row regardless, since Compliance/Security staff
 * author this content about the broker's own incident response, not a
 * customer's own free text. */
export function incidentReportAuditSnapshot(
  input: IncidentReportRow,
): Prisma.InputJsonObject {
  return {
    incidentReportId: input.id,
    title: input.title,
    description: input.description,
    severity: input.severity,
    status: input.status,
    reportedAt: input.reportedAt.toISOString(),
    containedAt: input.containedAt ? input.containedAt.toISOString() : null,
    impactAssessedAt: input.impactAssessedAt
      ? input.impactAssessedAt.toISOString()
      : null,
    classification: input.classification,
    classifiedByDpoUserId: input.classifiedByDpoUserId,
    seniorManagementCoSignUserId: input.seniorManagementCoSignUserId,
    seniorManagementNotifiedAt: input.seniorManagementNotifiedAt
      ? input.seniorManagementNotifiedAt.toISOString()
      : null,
    notifiedRegulators: input.notifiedRegulators,
    notifiedAt: input.notifiedAt ? input.notifiedAt.toISOString() : null,
    affectedDataSubjectsNotifiedAt: input.affectedDataSubjectsNotifiedAt
      ? input.affectedDataSubjectsNotifiedAt.toISOString()
      : null,
    rootCauseAnalysis: input.rootCauseAnalysis,
    recoveredAt: input.recoveredAt ? input.recoveredAt.toISOString() : null,
    closedAt: input.closedAt ? input.closedAt.toISOString() : null,
  };
}
