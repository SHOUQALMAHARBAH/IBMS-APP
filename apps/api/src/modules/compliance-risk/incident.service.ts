import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { UserRepository } from '../../repositories/user.repository';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { SlaTimerService } from '../sla/sla-timer.service';
import { WorkflowTransitionService } from '../workflow/workflow-transition.service';
import {
  IncidentRepository,
  type IncidentReportWithAct,
} from '../../repositories/incident.repository';
import {
  deriveIncidentReportView,
  type IncidentReportRow,
  incidentReportAuditSnapshot,
  requiresContainmentSla,
  INCIDENT_READ_LIMIT,
  type IncidentReportView,
} from './incident.config';
import type { CreateIncidentDto } from './dto/create-incident.dto';
import type { ClassifyIncidentDto } from './dto/classify-incident.dto';
import type { ContainIncidentDto } from './dto/contain-incident.dto';
import type { AssessIncidentImpactDto } from './dto/assess-incident-impact.dto';
import type { NotifyRegulatorsDto } from './dto/notify-regulators.dto';
import type { CloseIncidentDto } from './dto/close-incident.dto';
import type { ListIncidentsQueryDto } from './dto/list-incidents-query.dto';
import type { AuthenticatedUser } from '../auth/auth.types';
import { DutySegregationService } from '../duty-segregation/duty-segregation.service';

const INCIDENT_CONTAINMENT_WORKFLOW = 'incident_containment';
const INCIDENT_SENIOR_MANAGEMENT_WORKFLOW =
  'incident_senior_management_notification';

function sameRegulatorSet(a: string[], b: string[]): boolean {
  const sortedA = [...a].sort().join('|');
  const sortedB = [...b].sort().join('|');
  return sortedA === sortedB;
}

/**
 * Process 55/Part 6.2/Part 7.4 — the unified security + personal-data
 * breach workflow (backlog Part C #55). Four permissions gate the seven
 * status-changing actions plus two non-status stamps:
 * `incident.report` (deliberately broad — anyone may be first to notice),
 * `incident.contain` (ADMIN/COMPLIANCE — the operational response:
 * contain, assess impact, recover, close), `incident.classify`
 * (DPO **and** Executive Management — see `classify`/`coSign` below for why
 * this ONE permission covers two role-specific sub-actions), and
 * `incident.notify-regulator` (DPO/COMPLIANCE — the external filing).
 *
 * **Material classification maker/checker**: `classify()` (DPO-only, role-
 * checked beyond the coarse permission since `incident.classify` is ALSO
 * held by Executive Management) stamps `classifiedByDpoUserId`; for a
 * MATERIAL incident, `coSign()` (Executive-Management-only) must stamp a
 * DIFFERENT `seniorManagementCoSignUserId` before `notifyRegulators()` can
 * drive the workflow past CLASSIFIED — `assertDifferentActors` +
 * the `IncidentReport_classification_maker_checker_distinct` CHECK
 * (migration 20260906120000) both enforce this.
 *
 * **The "senior management notification (job)" backlog checkbox reuses the
 * pre-existing generic `SlaTimerScheduler`** (runs every 15 minutes,
 * backlog A.8) — no bespoke scheduler exists here. `classify()` starts the
 * `incident_senior_management_notification` SLA timer (1 hour) the moment
 * classification becomes MATERIAL; `notifySeniorManagement()` (a manual
 * stamp — this codebase has no real email/SMS channel anywhere, the
 * `CommunicationLog` "logs what happened, does not send" shape) resolves
 * it. If that manual duty is missed, the ALREADY-RUNNING generic escalation
 * sweep is the "job" that catches it and surfaces it on the #43 SLA
 * dashboard — building a second, bespoke scheduler here would duplicate
 * infrastructure that already exists and already includes `IncidentReport`
 * in `SLA_DASHBOARD_SENSITIVE_ENTITY_TYPES`.
 */
@Injectable()
export class IncidentService {
  private readonly logger = new Logger(IncidentService.name);

  constructor(
    private readonly repo: IncidentRepository,
    private readonly workflow: WorkflowTransitionService,
    private readonly slaTimer: SlaTimerService,
    private readonly audit: AuditService,
    private readonly dutySegregation: DutySegregationService,
    /** Decision 48 — the ONE place that answers *who did this*. Used only for the
     *  containment log's actor; never for an audit-trail row, which records what was
     *  STORED and must not change its answer when an HR record is corrected. */
    private readonly users: UserRepository,
  ) {}

  /**
   * ONE QUERY PER VIEW, and the log's actor resolved through decision 48.
   *
   * `deriveIncidentReportView` takes the name map as a REQUIRED argument, which is why
   * the compiler named all seventeen call sites when it was added rather than leaving one
   * of them projecting a nameless log. These two helpers are the only places that build
   * the map, so there is one answer to *who contained this* rather than seventeen.
   */
  private async view(row: IncidentReportRow): Promise<IncidentReportView> {
    return deriveIncidentReportView(
      row,
      new Date(),
      await this.actorNames([row]),
    );
  }

  /** The list form — ONE read for every action across every row, because per-row
   *  resolution on a register is one query per incident. */
  private async viewMany(
    rows: readonly IncidentReportRow[],
    now: Date,
  ): Promise<IncidentReportView[]> {
    const names = await this.actorNames(rows);
    return rows.map((r) => deriveIncidentReportView(r, now, names));
  }

  private actorNames(
    rows: readonly IncidentReportRow[],
  ): Promise<ReadonlyMap<string, string>> {
    return this.users.displayNamesForUserIds(
      rows.flatMap((r) =>
        r.containmentActions.map((a) => a.actionTakenByUserId),
      ),
    );
  }

  async create(
    dto: CreateIncidentDto,
    actorUserId: string,
  ): Promise<IncidentReportView> {
    const row = await this.repo.create({
      title: dto.title,
      description: dto.description,
      severity: dto.severity,
    });

    if (requiresContainmentSla(row.severity)) {
      await this.startSlaTimerBestEffort(
        row.id,
        INCIDENT_CONTAINMENT_WORKFLOW,
        await this.slaTimer.computeDueAt(
          INCIDENT_CONTAINMENT_WORKFLOW,
          row.reportedAt,
        ),
        actorUserId,
      );
    }

    await this.safeAudit({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'IncidentReport',
      entityId: row.id,
      afterValue: incidentReportAuditSnapshot(row),
      isSensitiveDataAccess: true,
    });

    return this.view(row);
  }

  // --- 2. contain (REPORTED -> CONTAINED) ------------------------------

  /**
   * OWNER DECISION 56. The owner pressed this and reported «بس بغيّر الحالة إلى تم
   * احتوائه» — the route took no body and wrote a bare timestamp.
   *
   * IT APPENDS, AND THE IDEMPOTENT SHORT-CIRCUIT IS GONE. The old first line was
   * `if (status === 'CONTAINED') return` — which made a SECOND press succeed having done
   * nothing, a third reading of her sentence that nobody had named. `PRIV-SRS-02` types
   * `containment_actions` as a timestamped LOG and `PRIV-SOP-09` step 3 is «عزل الأنظمة
   * أو الحسابات المتأثرة», which is routinely more than one action — isolate the server,
   * then disable the account. So a second containment action is a NEW ENTRY, not a repeat,
   * and the only thing that happens once is the STATUS TRANSITION.
   *
   * ORDER MATTERS AND IS NOT INCIDENTAL: the action is written FIRST, because
   * `IncidentReport_contained_needs_an_action` refuses to stamp `containedAt` with an
   * empty log. The trigger is what makes her sentence unrepresentable rather than merely
   * refused here.
   */
  async contain(
    id: string,
    dto: ContainIncidentDto,
    actorUserId: string,
  ): Promise<IncidentReportView> {
    const incident = await this.load(id);
    const alreadyContained = incident.status === 'CONTAINED';

    // The log entry, always — this is the act, and it is what the dictionary requires.
    await this.repo.appendContainmentAction({
      incidentReportId: id,
      description: dto.description,
      actionTakenByUserId: actorUserId,
    });

    if (!alreadyContained) {
      try {
        await this.workflow.transition({
          entityType: 'IncidentReport',
          entityId: id,
          toStatus: 'CONTAINED',
          actorUserId,
          data: { containedAt: new Date() },
          sideEffect: () =>
            this.resolveSlaTimerBestEffort(
              id,
              INCIDENT_CONTAINMENT_WORKFLOW,
              actorUserId,
            ),
        });
      } catch (err) {
        if (err instanceof ConflictException) {
          // Another request transitioned it between the load and here. The action above
          // still belongs on the log, which is why it is not rolled back.
          const now = await this.load(id);
          if (now.status === 'CONTAINED') {
            return this.reloadAndAuditUpdate(id, actorUserId);
          }
        }
        throw err;
      }
    }

    return this.reloadAndAuditUpdate(id, actorUserId);
  }

  // --- 3. assess-impact (CONTAINED -> IMPACT_ASSESSED) -----------------

  /**
   * OWNER DECISION 56. «بس بظهرلي إنه تم تقييم أثره وأنا ما قيّمت ولا عملت شي» — the
   * route took no body and wrote a bare `impactAssessedAt`.
   *
   * The three fields are `PRIV-SOP-09` step 4's own outputs, not a design: whether
   * personal data is touched, the categories, and the approximate number of subjects.
   * They are written IN THE SAME TRANSITION as the timestamp, so
   * `IncidentReport_impact_assessment_complete` can never see a half-written row.
   *
   * THE SHORT-CIRCUIT IS KEPT HERE AND REMOVED FROM `contain`, which is a real asymmetry
   * rather than an oversight: an impact assessment is ONE conclusion about the incident's
   * scope, so a second call is a repeat; a containment ACTION is one of several things
   * somebody did, so a second call is a new entry. Correcting an assessment is a separate
   * act nobody has asked for, and inventing one here would be the cheap version.
   */
  async assessImpact(
    id: string,
    dto: AssessIncidentImpactDto,
    actorUserId: string,
  ): Promise<IncidentReportView> {
    const incident = await this.load(id);
    if (incident.status === 'IMPACT_ASSESSED') {
      return this.view(incident);
    }

    try {
      await this.workflow.transition({
        entityType: 'IncidentReport',
        entityId: id,
        toStatus: 'IMPACT_ASSESSED',
        actorUserId,
        data: {
          impactAssessedAt: new Date(),
          touchesPersonalData: dto.touchesPersonalData,
          dataCategoriesAffected: dto.dataCategoriesAffected,
          subjectsAffectedEstimate: dto.subjectsAffectedEstimate,
        },
      });
    } catch (err) {
      if (err instanceof ConflictException) {
        const now = await this.load(id);
        if (now.status === 'IMPACT_ASSESSED') {
          return this.view(now);
        }
      }
      throw err;
    }

    return this.reloadAndAuditUpdate(id, actorUserId);
  }

  // --- 4. classify (IMPACT_ASSESSED -> CLASSIFIED) ---------------------
  //
  // Who may do this is the guard's job now: `incident.classify` is granted to
  // the DPO alone. Until Phase 2 that code was ALSO the co-sign's gate, so this
  // method had to refuse a non-DPO caller by role NAME — which no custom role
  // could ever satisfy.

  async classify(
    id: string,
    dto: ClassifyIncidentDto,
    actor: AuthenticatedUser,
  ): Promise<IncidentReportView> {
    const incident = await this.load(id);
    if (incident.status === 'CLASSIFIED') {
      if (incident.classification === dto.classification) {
        return this.view(incident);
      }
      throw new ConflictException(
        `Incident ${id} is already classified ${incident.classification}, not ${dto.classification}.`,
      );
    }
    try {
      await this.workflow.transition({
        entityType: 'IncidentReport',
        entityId: id,
        toStatus: 'CLASSIFIED',
        actorUserId: actor.id,
        data: {
          classification: dto.classification,
          classifiedByDpoUserId: actor.id,
        },
        // async, because the deadline is now read from the configured SLA
        // policy rather than a compile-time constant.
        sideEffect: async () => {
          if (dto.classification !== 'MATERIAL') return;
          await this.startSlaTimerBestEffort(
            id,
            INCIDENT_SENIOR_MANAGEMENT_WORKFLOW,
            await this.slaTimer.computeDueAt(
              INCIDENT_SENIOR_MANAGEMENT_WORKFLOW,
              new Date(),
            ),
            actor.id,
          );
        },
      });
    } catch (err) {
      if (err instanceof ConflictException) {
        const now = await this.load(id);
        if (
          now.status === 'CLASSIFIED' &&
          now.classification === dto.classification
        ) {
          return this.view(now);
        }
      }
      throw err;
    }

    return this.reloadAndAuditUpdate(id, actor.id);
  }

  // --- co-sign (Material only) -----------------------------------------
  // NOT an engine transition — status stays CLASSIFIED.
  //
  // Gated by its own `incident.classification.co-sign`, so the role name no
  // longer has to distinguish this from classification. `assertDifferentActors`
  // below is the control that does NOT depend on how the permissions were
  // granted: even a caller holding both halves cannot co-sign a classification
  // they recorded themselves.

  async coSign(
    id: string,
    actor: AuthenticatedUser,
    /** Part 4 — present only when the checker is also the maker in an office that declared COMBINED. */
    combinedDutyReason?: string,
  ): Promise<IncidentReportView> {
    const incident = await this.load(id);
    if (incident.classification !== 'MATERIAL') {
      throw new UnprocessableEntityException(
        `Incident ${id} is ${incident.classification} — only a MATERIAL incident needs the Senior Management co-sign.`,
      );
    }
    if (incident.seniorManagementCoSignUserId) {
      return this.view(incident); // idempotent
    }
    // Fail CLOSED, not open — the same #42/M04 "processed but no recorded
    // processor" guard: if somehow classified without a recorded classifier,
    // the segregation check has nothing to compare against.
    if (!incident.classifiedByDpoUserId) {
      throw new UnprocessableEntityException(
        `Incident ${id} is classified but has no recorded classifier — co-sign segregation cannot be verified.`,
      );
    }
    const combinedDutyActId = await this.dutySegregation.resolve({
      constraint: 'IncidentReport_classification_maker_checker_distinct',
      makerId: incident.classifiedByDpoUserId,
      checkerId: actor.id,
      entityId: id,
      context: 'IncidentReport.co-sign',
      actorUserId: actor.id,
      reason: combinedDutyReason,
    });

    const res = await this.repo.recordCoSign(id, actor.id, combinedDutyActId);
    if (res.count === 0) {
      throw new ConflictException(
        `Incident ${id} changed concurrently — reload and retry.`,
      );
    }

    return this.reloadAndAuditUpdate(id, actor.id);
  }

  // --- notify-senior-management (Material only) — a manual stamp; this
  // codebase has no real notification channel anywhere (the CommunicationLog
  // "logs what happened" shape) — resolves the SLA timer classify() started.

  async notifySeniorManagement(
    id: string,
    actorUserId: string,
  ): Promise<IncidentReportView> {
    const incident = await this.load(id);
    if (incident.classification !== 'MATERIAL') {
      throw new UnprocessableEntityException(
        `Incident ${id} is ${incident.classification} — only a MATERIAL incident requires Senior Management notification.`,
      );
    }
    if (incident.seniorManagementNotifiedAt) {
      return this.view(incident); // idempotent
    }

    const res = await this.repo.recordSeniorManagementNotified(id, new Date());
    if (res.count === 0) {
      throw new ConflictException(
        `Incident ${id} changed concurrently — reload and retry.`,
      );
    }
    await this.resolveSlaTimerBestEffort(
      id,
      INCIDENT_SENIOR_MANAGEMENT_WORKFLOW,
      actorUserId,
    );

    return this.reloadAndAuditUpdate(id, actorUserId);
  }

  // --- 6. notify-regulators (CLASSIFIED -> NOTIFIED) -------------------

  async notifyRegulators(
    id: string,
    dto: NotifyRegulatorsDto,
    actorUserId: string,
  ): Promise<IncidentReportView> {
    const incident = await this.load(id);
    if (incident.status === 'NOTIFIED') {
      if (sameRegulatorSet(incident.notifiedRegulators, dto.regulators)) {
        return this.view(incident);
      }
      throw new ConflictException(
        `Incident ${id} was already notified to a different set of regulators.`,
      );
    }
    // Live-recompute before the irreversible step — the #16/#51 pattern: a
    // Material incident cannot proceed past CLASSIFIED without the
    // Senior Management co-sign, re-checked here rather than trusted from
    // whenever classify() ran.
    if (
      incident.classification === 'MATERIAL' &&
      !incident.seniorManagementCoSignUserId
    ) {
      throw new UnprocessableEntityException(
        `Incident ${id} is classified MATERIAL — the Senior Management co-sign must be recorded before regulators can be notified.`,
      );
    }

    // Safe to rely on the engine's own status-conditional `updateMany`
    // (`WHERE id, status: 'CLASSIFIED'`) here without ALSO re-asserting
    // `seniorManagementCoSignUserId` in that same write: classification and
    // the co-sign are both write-once/monotonic fields on this entity (once
    // set, `IncidentRepository.recordCoSign`'s own write-once guard means
    // neither can be UN-set), so the live-recompute guard immediately above
    // is not exposed to a TOCTOU window a concurrent write could exploit —
    // unlike `applyExtension` (#52/M04) or `findCurrent` (#53-54), nothing
    // here can change between this check and the transition call in a way
    // that would make an already-passed guard wrong in retrospect.
    try {
      await this.workflow.transition({
        entityType: 'IncidentReport',
        entityId: id,
        toStatus: 'NOTIFIED',
        actorUserId,
        data: {
          notifiedRegulators: dto.regulators,
          notifiedAt: new Date(),
        },
      });
    } catch (err) {
      if (err instanceof ConflictException) {
        const now = await this.load(id);
        if (
          now.status === 'NOTIFIED' &&
          sameRegulatorSet(now.notifiedRegulators, dto.regulators)
        ) {
          return this.view(now);
        }
      }
      throw err;
    }

    return this.reloadAndAuditUpdate(id, actorUserId);
  }

  // --- notify-affected-subjects (PDPL breach-notification obligation;
  // M09's own scope, not one of #55's three named checkboxes, but the
  // model's own field) — legal once classification is decided, and subject
  // to the SAME live-recomputed Material co-sign gate as notifyRegulators
  // (a @code-reviewer MINOR: this and the regulator filing are equally
  // consequential, irreversible external actions for a Material incident —
  // there is no reason the co-sign requirement should protect one and not
  // the other).

  async notifyAffectedSubjects(
    id: string,
    actorUserId: string,
  ): Promise<IncidentReportView> {
    const incident = await this.load(id);
    if (incident.classification === 'NOT_YET_CLASSIFIED') {
      throw new UnprocessableEntityException(
        `Incident ${id} has not been classified yet — classify it before notifying affected data subjects.`,
      );
    }
    if (
      incident.classification === 'MATERIAL' &&
      !incident.seniorManagementCoSignUserId
    ) {
      throw new UnprocessableEntityException(
        `Incident ${id} is classified MATERIAL — the Senior Management co-sign must be recorded before affected data subjects can be notified.`,
      );
    }
    if (incident.affectedDataSubjectsNotifiedAt) {
      return this.view(incident); // idempotent
    }

    const res = await this.repo.recordAffectedSubjectsNotified(id, new Date());
    if (res.count === 0) {
      throw new ConflictException(
        `Incident ${id} changed concurrently — reload and retry.`,
      );
    }

    return this.reloadAndAuditUpdate(id, actorUserId);
  }

  // --- 6/7. recover (NOTIFIED -> RECOVERED) ----------------------------

  async recover(id: string, actorUserId: string): Promise<IncidentReportView> {
    const incident = await this.load(id);
    if (incident.status === 'RECOVERED') {
      return this.view(incident);
    }

    try {
      await this.workflow.transition({
        entityType: 'IncidentReport',
        entityId: id,
        toStatus: 'RECOVERED',
        actorUserId,
        data: { recoveredAt: new Date() },
      });
    } catch (err) {
      if (err instanceof ConflictException) {
        const now = await this.load(id);
        if (now.status === 'RECOVERED') return this.view(now);
      }
      throw err;
    }

    return this.reloadAndAuditUpdate(id, actorUserId);
  }

  // --- 7. close (RECOVERED -> CLOSED, root cause mandatory) ------------

  async close(
    id: string,
    dto: CloseIncidentDto,
    actorUserId: string,
  ): Promise<IncidentReportView> {
    const incident = await this.load(id);
    if (incident.status === 'CLOSED') {
      if (incident.rootCauseAnalysis === dto.rootCauseAnalysis) {
        return this.view(incident);
      }
      throw new ConflictException(
        `Incident ${id} is already closed with a different root cause analysis on record.`,
      );
    }

    try {
      await this.workflow.transition({
        entityType: 'IncidentReport',
        entityId: id,
        toStatus: 'CLOSED',
        actorUserId,
        data: {
          rootCauseAnalysis: dto.rootCauseAnalysis,
          closedAt: new Date(),
        },
      });
    } catch (err) {
      if (err instanceof ConflictException) {
        const now = await this.load(id);
        if (
          now.status === 'CLOSED' &&
          now.rootCauseAnalysis === dto.rootCauseAnalysis
        ) {
          return this.view(now);
        }
      }
      throw err;
    }

    return this.reloadAndAuditUpdate(id, actorUserId);
  }

  // --- reads -----------------------------------------------------

  async get(id: string, actorUserId: string): Promise<IncidentReportView> {
    const incident = await this.load(id);
    await this.safeAudit({
      userId: actorUserId,
      action: 'READ',
      entityType: 'IncidentReport',
      entityId: id,
      afterValue: { incidentReportId: id },
      isSensitiveDataAccess: true,
    });
    return this.view(incident);
  }

  async list(
    query: ListIncidentsQueryDto,
    actorUserId: string,
  ): Promise<IncidentReportView[]> {
    const now = new Date();
    const rows = await this.repo.findMany(
      {
        status: query.status,
        severity: query.severity,
        classification: query.classification,
      },
      INCIDENT_READ_LIMIT,
    );
    if (rows.length >= INCIDENT_READ_LIMIT) {
      this.logger.warn(
        `Incident list truncated at ${INCIDENT_READ_LIMIT} rows — narrow with status / severity / classification.`,
      );
    }
    await this.safeAudit({
      userId: actorUserId,
      action: 'READ',
      entityType: 'IncidentReport',
      entityId: 'list',
      afterValue: { count: rows.length },
      isSensitiveDataAccess: rows.length > 0,
    });
    return this.viewMany(rows, now);
  }

  // --- helpers -------------------------------------------------

  private async load(id: string): Promise<IncidentReportWithAct> {
    const incident = await this.repo.findById(id);
    if (!incident) {
      throw new NotFoundException(`Incident report ${id} not found.`);
    }
    return incident;
  }

  private async reloadAndAuditUpdate(
    id: string,
    actorUserId: string,
  ): Promise<IncidentReportView> {
    const after = await this.load(id);
    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'IncidentReport',
      entityId: after.id,
      afterValue: incidentReportAuditSnapshot(after),
      isSensitiveDataAccess: true,
    });
    return this.view(after);
  }

  private async startSlaTimerBestEffort(
    id: string,
    workflowName: string,
    dueAt: Date,
    actorUserId: string,
  ): Promise<void> {
    try {
      await this.slaTimer.startTimer({
        entityType: 'IncidentReport',
        entityId: id,
        workflowName,
        dueAt,
        actorUserId,
      });
    } catch (err) {
      this.logger.warn(
        `IncidentReport ${id}: failed to start its ${workflowName} SLA timer: ${(err as Error).message}`,
      );
    }
  }

  private async resolveSlaTimerBestEffort(
    id: string,
    workflowName: string,
    actorUserId: string,
  ): Promise<void> {
    try {
      await this.slaTimer.resolve({
        entityType: 'IncidentReport',
        entityId: id,
        workflowName,
        actorUserId,
      });
    } catch (err) {
      this.logger.warn(
        `IncidentReport ${id}: failed to resolve its ${workflowName} SLA timer (non-fatal): ${(err as Error).message}`,
      );
    }
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `Incident audit (${input.action} ${input.entityId}) failed after the write committed: ${(err as Error).message}`,
      );
    }
  }
}
