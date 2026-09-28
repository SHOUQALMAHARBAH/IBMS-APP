import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type { SlaHoliday, SlaPolicy, SlaPolicyStatus } from '@ibms/db';
import {
  consecutiveDays,
  fixedHolidaysForYear,
  JORDAN_FIXED_HOLIDAYS,
  JORDAN_MOVING_HOLIDAYS,
  utcDayKey,
} from './jordan-public-holidays.config';
import {
  SlaPolicyRepository,
  type SlaPolicyWithEscalations,
} from '../../repositories/sla-policy.repository';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type {
  CreateSlaPolicyDto,
  UpdateSlaPolicyDto,
} from './dto/sla-policy.dto';

export interface SlaPolicyView {
  id: string;
  policyCode: string;
  policyName: string;
  processType: string;
  workflowState: string | null;
  description: string | null;
  durationValue: number;
  durationUnit: string;
  calendarType: string;
  customWeekendDays: number[];
  workingHoursStart: string | null;
  workingHoursEnd: string | null;
  timezone: string;
  sourceType: string;
  sourceReference: string | null;
  sourceDocument: string | null;
  sourceSection: string | null;
  /** True ONLY for `sourceType === 'REGULATORY'`. The UI must not present any
   * other source as legally required, so the distinction is computed once
   * here rather than re-derived (and eventually got wrong) per screen. */
  isRegulatory: boolean;
  /** Ready-to-render provenance, e.g. "Regulatory — PRIV-STD-01 §6.4" or
   * "Internal policy". */
  sourceLabel: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  escalationEnabled: boolean;
  warningThreshold: number;
  status: SlaPolicyStatus;
  escalations: {
    stageOrder: number;
    offsetValue: number;
    offsetUnit: string;
    escalateTo: string | null;
  }[];
  createdByUserId: string;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Fields whose change alters what the system CLAIMS about an SLA's legal
 * force. Gated on a separate permission from ordinary edits, because
 * "shorten this deadline" and "assert this deadline is the law" are different
 * decisions with different consequences. */
const REGULATORY_METADATA_FIELDS = [
  'sourceType',
  'sourceReference',
  'sourceDocument',
  'sourceSection',
] as const;

/**
 * Configurable SLA policies — the runtime source of every SLA duration.
 *
 * ## What this replaces, and what it does not
 *
 * `SLA_REGISTRY` stays in code: it is where a workflow DECLARES itself, it is
 * the seed baseline, and its `workflowName` list is what makes a typo in a
 * process type a compile error. What it stops being is the thing the
 * application reads at runtime to answer "how long do we have?".
 *
 * ## Why provenance is first-class
 *
 * A duration alone cannot tell you whether missing it breaks the law or misses
 * an internal target. The registry recorded that only as free text inside
 * `citation`, mixing genuine PDPL rows with five whose own citation read
 * "DRAFT, UNSOURCED" — indistinguishable to any query, API or screen. So
 * `sourceType` is structured, REGULATORY requires a named instrument (enforced
 * here AND by a DB CHECK), and `isRegulatory` is computed server-side so no UI
 * has to decide what counts as law.
 */
@Injectable()
export class SlaPolicyService {
  private readonly logger = new Logger(SlaPolicyService.name);

  constructor(
    private readonly policies: SlaPolicyRepository,
    private readonly audit: AuditService,
  ) {}

  async list(filter: {
    processType?: string;
    status?: SlaPolicyStatus;
  }): Promise<SlaPolicyView[]> {
    return (await this.policies.findMany(filter)).map(toView);
  }

  async get(id: string): Promise<SlaPolicyView> {
    const policy = await this.policies.findById(id);
    if (!policy) throw new NotFoundException(`SLA policy ${id} not found.`);
    return toView(policy);
  }

  async create(
    dto: CreateSlaPolicyDto,
    actor: AuthenticatedUser,
  ): Promise<SlaPolicyView> {
    assertSourceTraceable(dto.sourceType, dto);

    let created: SlaPolicyWithEscalations;
    try {
      created = await this.policies.create(
        {
          policyCode: dto.policyCode,
          policyName: dto.policyName,
          processType: dto.processType,
          workflowState: dto.workflowState ?? null,
          description: dto.description ?? null,
          durationValue: dto.durationValue,
          durationUnit: dto.durationUnit,
          calendarType: dto.calendarType ?? 'JORDAN_STANDARD',
          customWeekendDays: dto.customWeekendDays ?? [],
          workingHoursStart: dto.workingHoursStart ?? null,
          workingHoursEnd: dto.workingHoursEnd ?? null,
          timezone: dto.timezone ?? 'Asia/Amman',
          sourceType: dto.sourceType,
          sourceReference: dto.sourceReference ?? null,
          sourceDocument: dto.sourceDocument ?? null,
          sourceSection: dto.sourceSection ?? null,
          effectiveFrom: dto.effectiveFrom
            ? new Date(dto.effectiveFrom)
            : new Date(),
          effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
          escalationEnabled: dto.escalationEnabled ?? true,
          warningThreshold: dto.warningThreshold ?? 0.8,
          // Never born ACTIVE: activation is its own audited decision, so a
          // new policy cannot silently displace the one in force.
          status: 'DRAFT',
          createdByUserId: actor.id,
        },
        (dto.escalations ?? []).map((e, i) => ({
          stageOrder: e.stageOrder ?? i,
          offsetValue: e.offsetValue,
          offsetUnit: e.offsetUnit,
          escalateTo: e.escalateTo ?? null,
        })),
      );
    } catch (err) {
      throw translateWriteError(err, dto.policyCode);
    }

    await this.safeAudit({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'SlaPolicy',
      entityId: created.id,
      afterValue: auditSnapshot(created),
    });
    return toView(created);
  }

  async update(
    id: string,
    dto: UpdateSlaPolicyDto,
    actor: AuthenticatedUser,
    canChangeRegulatoryMetadata: boolean,
  ): Promise<SlaPolicyView> {
    const existing = await this.policies.findById(id);
    if (!existing) throw new NotFoundException(`SLA policy ${id} not found.`);

    const touchesRegulatoryMetadata = REGULATORY_METADATA_FIELDS.some(
      (field) => dto[field] !== undefined && dto[field] !== existing[field],
    );
    if (touchesRegulatoryMetadata && !canChangeRegulatoryMetadata) {
      throw new UnprocessableEntityException(
        "Changing an SLA policy's source type or citation requires the sla.policy.regulatory permission. Asserting that a deadline is legally required is a different decision from changing its duration, and is controlled separately.",
      );
    }

    const nextSourceType = dto.sourceType ?? existing.sourceType;
    assertSourceTraceable(nextSourceType, {
      sourceReference: dto.sourceReference ?? existing.sourceReference,
      sourceDocument: dto.sourceDocument ?? existing.sourceDocument,
    });

    let updated: SlaPolicyWithEscalations;
    try {
      updated = await this.policies.update(id, {
        ...(dto.policyName !== undefined && { policyName: dto.policyName }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.durationValue !== undefined && {
          durationValue: dto.durationValue,
        }),
        ...(dto.durationUnit !== undefined && {
          durationUnit: dto.durationUnit,
        }),
        ...(dto.calendarType !== undefined && {
          calendarType: dto.calendarType,
        }),
        ...(dto.customWeekendDays !== undefined && {
          customWeekendDays: dto.customWeekendDays,
        }),
        ...(dto.workingHoursStart !== undefined && {
          workingHoursStart: dto.workingHoursStart,
        }),
        ...(dto.workingHoursEnd !== undefined && {
          workingHoursEnd: dto.workingHoursEnd,
        }),
        ...(dto.timezone !== undefined && { timezone: dto.timezone }),
        ...(dto.sourceType !== undefined && { sourceType: dto.sourceType }),
        ...(dto.sourceReference !== undefined && {
          sourceReference: dto.sourceReference,
        }),
        ...(dto.sourceDocument !== undefined && {
          sourceDocument: dto.sourceDocument,
        }),
        ...(dto.sourceSection !== undefined && {
          sourceSection: dto.sourceSection,
        }),
        ...(dto.effectiveTo !== undefined && {
          effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
        }),
        ...(dto.escalationEnabled !== undefined && {
          escalationEnabled: dto.escalationEnabled,
        }),
        ...(dto.warningThreshold !== undefined && {
          warningThreshold: dto.warningThreshold,
        }),
        updatedByUserId: actor.id,
      });
    } catch (err) {
      throw translateWriteError(err, existing.policyCode);
    }

    // before AND after: an SLA change must never be reconstructable only as
    // "somebody edited this", which is what a bare after-snapshot leaves.
    await this.safeAudit({
      userId: actor.id,
      action: 'UPDATE',
      entityType: 'SlaPolicy',
      entityId: id,
      beforeValue: auditSnapshot(existing),
      afterValue: auditSnapshot(updated),
    });

    if (touchesRegulatoryMetadata) {
      this.logger.warn(
        `SLA policy ${updated.policyCode}: REGULATORY METADATA CHANGED by ${actor.id} — sourceType ${existing.sourceType} -> ${updated.sourceType}. This alters what the system claims about the deadline's legal force.`,
      );
    }
    return toView(updated);
  }

  /** Put a policy in force. Stands down whatever it replaces, in one
   * transaction, so no process is ever left with no active SLA. */
  async activate(id: string, actor: AuthenticatedUser): Promise<SlaPolicyView> {
    const existing = await this.policies.findById(id);
    if (!existing) throw new NotFoundException(`SLA policy ${id} not found.`);
    if (existing.status === 'ACTIVE') {
      return toView(existing); // idempotent
    }

    const activated = await this.policies.activate(
      id,
      existing.processType,
      existing.workflowState,
      actor.id,
    );
    if (!activated) {
      throw new ConflictException(
        `SLA policy ${id} was activated concurrently by another request.`,
      );
    }

    await this.safeAudit({
      userId: actor.id,
      action: 'APPROVE',
      entityType: 'SlaPolicy',
      entityId: id,
      beforeValue: { status: existing.status },
      afterValue: {
        status: 'ACTIVE',
        processType: activated.processType,
        workflowState: activated.workflowState,
        durationValue: activated.durationValue,
        durationUnit: activated.durationUnit,
        sourceType: activated.sourceType,
      },
    });
    return toView(activated);
  }

  async deactivate(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<SlaPolicyView> {
    const existing = await this.policies.findById(id);
    if (!existing) throw new NotFoundException(`SLA policy ${id} not found.`);

    const { count } = await this.policies.deactivate(id, actor.id);
    if (count === 0 && existing.status !== 'ACTIVE') {
      return toView(existing); // already not in force — idempotent
    }

    await this.safeAudit({
      userId: actor.id,
      action: 'REJECT',
      entityType: 'SlaPolicy',
      entityId: id,
      beforeValue: { status: existing.status },
      afterValue: { status: 'INACTIVE' },
    });
    return this.get(id);
  }

  /**
   * Record a non-working day.
   *
   * WHY THIS IS NOW A SERVICE METHOD RATHER THAN A DIRECT REPOSITORY CALL
   * --------------------------------------------------------------------
   * `POST /sla/holidays` had no web caller (IMPROVEMENTS § 1.44), so its first
   * predictable user error had never been reached. The controller called the
   * repository directly, there is no global Prisma exception filter, and the
   * table carries two partial UNIQUE indexes on the date — so entering the same
   * day twice produced an unhandled P2002 and a **500**. Two people working from
   * the same published holiday list is not an edge case, and "the system is
   * broken" is the wrong thing to tell the second one.
   *
   * AND THE ACT IS NOW AUDITED, WHICH IT WAS NOT
   * -------------------------------------------
   * Editing one policy's duration was audited; adding a holiday was not — even
   * though a single holiday row moves EVERY business-day deadline in the office
   * at once, and a policy edit moves one. That is the same argument that makes
   * pausing a timer an audited act: what changed a compliance deadline has to be
   * answerable afterwards.
   */
  async createHoliday(
    input: {
      observedOn: Date;
      name: string;
      calendarType: SlaPolicy['calendarType'] | null;
    },
    actor: AuthenticatedUser,
  ): Promise<SlaHoliday> {
    // The stored form is the whole UTC day; this is the spelling used in the
    // refusal and the audit row so both name the day a reader typed.
    const day = input.observedOn.toISOString().slice(0, 10);

    let created: SlaHoliday;
    try {
      created = await this.policies.createHoliday({
        ...input,
        createdByUserId: actor.id,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          input.calendarType == null
            ? `${day} is already recorded as a non-working day for every calendar.`
            : `${day} is already recorded as a non-working day for the ${input.calendarType} calendar.`,
        );
      }
      throw err;
    }

    await this.safeAudit({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'SlaHoliday',
      entityId: created.id,
      afterValue: {
        observedOn: day,
        name: created.name,
        calendarType: created.calendarType,
      },
    });
    return created;
  }

  /**
   * One year of the non-working-day calendar, and what it still owes.
   *
   * The `missing` half is the point. Jordan's four fixed holidays can be generated; the
   * four Islamic occasions cannot — in Jordan the date is set by official announcement
   * and can differ by a day from any calendar conversion, so a computed Hijri calendar
   * would be wrong most years and nobody would know why. They are ENTERED from the
   * announcement, which means an office needs to be told which ones it has not entered
   * yet. A calendar that merely lists what is present cannot say that.
   *
   * An occasion counts as entered when at least one row names it. Deliberately not "all
   * `days` rows present": Eid runs are entered in one action, and a partial run means
   * somebody is mid-edit rather than that the occasion is absent.
   */
  async holidayCalendarForYear(year: number): Promise<{
    year: number;
    holidays: SlaHoliday[];
    missingFixed: { nameEn: string; nameAr: string; observedOn: string }[];
    missingOccasions: {
      key: string;
      nameEn: string;
      nameAr: string;
      days: number;
    }[];
  }> {
    const all = await this.policies.findHolidays();
    const inYear = all.filter((h) => h.observedOn.getUTCFullYear() === year);
    const keys = new Set(inYear.map((h) => utcDayKey(h.observedOn)));
    const names = inYear.map((h) => h.name.toLowerCase());

    const missingFixed = fixedHolidaysForYear(year)
      .filter((h) => !keys.has(utcDayKey(h.observedOn)))
      .map((h) => ({
        nameEn: h.nameEn,
        nameAr: h.nameAr,
        observedOn: utcDayKey(h.observedOn),
      }));

    // Matched on the NAME, because a moving occasion has no date to match on — that is
    // the whole reason it is entered rather than generated.
    const missingOccasions = JORDAN_MOVING_HOLIDAYS.filter(
      (o) =>
        !names.some(
          (n) =>
            n.includes(o.nameEn.toLowerCase()) ||
            n.includes(o.nameAr.toLowerCase()),
        ),
    ).map((o) => ({
      key: o.key,
      nameEn: o.nameEn,
      nameAr: o.nameAr,
      days: o.days,
    }));

    return { year, holidays: inYear, missingFixed, missingOccasions };
  }

  /**
   * Add the four fixed-date holidays for `year`, skipping any already present.
   *
   * Idempotent on purpose: two people opening the calendar for the same year is
   * ordinary, and the second one must not get a duplicate-date conflict for pressing a
   * button that describes itself as filling in what is missing.
   */
  async createFixedHolidaysForYear(
    year: number,
    actor: AuthenticatedUser,
  ): Promise<{ created: SlaHoliday[]; skipped: number }> {
    const { missingFixed } = await this.holidayCalendarForYear(year);
    const created: SlaHoliday[] = [];
    for (const h of missingFixed) {
      created.push(
        await this.createHoliday(
          {
            observedOn: new Date(`${h.observedOn}T00:00:00.000Z`),
            name: h.nameEn,
            calendarType: null,
          },
          actor,
        ),
      );
    }
    return { created, skipped: JORDAN_FIXED_HOLIDAYS.length - created.length };
  }

  /**
   * Enter a moving occasion from the year's announcement: a start date, expanded to the
   * occasion's own length.
   *
   * Eid al-Adha is five days and Eid al-Fitr is four, and an officer entering them one
   * row at a time has to remember which — so the length comes from the vocabulary rather
   * than from the request. The run is plain consecutive days INCLUDING a weekend,
   * because a public holiday falls on the day it falls on and skipping Friday would move
   * Eid.
   *
   * The whole run is created or the call fails partway with the earlier days present;
   * that is deliberate rather than transactional, because a half-entered Eid is visible
   * on the calendar as a short run and is fixable, while a rolled-back one looks like
   * nothing happened.
   */
  async createMovingOccasion(
    occasionKey: string,
    startDay: string,
    actor: AuthenticatedUser,
  ): Promise<SlaHoliday[]> {
    const occasion = JORDAN_MOVING_HOLIDAYS.find((o) => o.key === occasionKey);
    if (!occasion) {
      throw new UnprocessableEntityException(
        `Unknown occasion ${occasionKey}. Jordan's moving public holidays are: ${JORDAN_MOVING_HOLIDAYS.map((o) => o.key).join(', ')}.`,
      );
    }
    const start = new Date(`${startDay}T00:00:00.000Z`);
    const out: SlaHoliday[] = [];
    const run = consecutiveDays(start, occasion.days);
    for (let i = 0; i < run.length; i += 1) {
      out.push(
        await this.createHoliday(
          {
            observedOn: run[i],
            // The occasion's name carries the day number when it runs to more than one,
            // so a reader can see at a glance that a five-day Eid is complete.
            name:
              occasion.days === 1
                ? occasion.nameEn
                : `${occasion.nameEn} (day ${i + 1} of ${occasion.days})`,
            calendarType: null,
          },
          actor,
        ),
      );
    }
    return out;
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `SLA policy audit (${input.action} ${input.entityId}) failed after the write committed: ${(err as Error).message}`,
      );
    }
  }
}

/**
 * REGULATORY requires a named instrument. Checked here for a readable 422, and
 * again by the DB CHECK `SlaPolicy_regulatory_needs_citation` so no other
 * write path (a seed, a migration, a psql session) can assert legal force
 * without one.
 */
function assertSourceTraceable(
  sourceType: string,
  fields: { sourceReference?: string | null; sourceDocument?: string | null },
): void {
  if (sourceType !== 'REGULATORY') return;
  const missing: string[] = [];
  if (!fields.sourceReference?.trim()) missing.push('sourceReference');
  if (!fields.sourceDocument?.trim()) missing.push('sourceDocument');
  if (missing.length > 0) {
    throw new UnprocessableEntityException(
      `A REGULATORY SLA must name the instrument that requires it — missing ${missing.join(' and ')}. If no authoritative source exists, classify this as INTERNAL_POLICY (or CONTRACTUAL/OPERATIONAL) instead; do not record an internal target as a legal requirement.`,
    );
  }
}

function translateWriteError(err: unknown, policyCode: string): Error {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return new ConflictException(
        `An SLA policy with code "${policyCode}" already exists, or another policy is already ACTIVE for this process and state.`,
      );
    }
  }
  // The DB CHECK fired where the service-level guard did not — surface it as a
  // 422 rather than a 500, because it is a caller-fixable input problem.
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('SlaPolicy_regulatory_needs_citation')) {
    return new UnprocessableEntityException(
      'A REGULATORY SLA must name the instrument that requires it (sourceReference and sourceDocument).',
    );
  }
  if (message.includes('SlaPolicy_duration_non_negative')) {
    return new UnprocessableEntityException(
      'durationValue must be zero or positive.',
    );
  }
  if (message.includes('SlaPolicy_effective_window_ordered')) {
    return new UnprocessableEntityException(
      'effectiveTo must be after effectiveFrom.',
    );
  }
  return err as Error;
}

const SOURCE_LABELS: Readonly<Record<string, string>> = {
  REGULATORY: 'Regulatory',
  INTERNAL_POLICY: 'Internal policy',
  CONTRACTUAL: 'Contractual',
  OPERATIONAL: 'Operational',
  OTHER: 'Other',
};

export function sourceLabelFor(policy: {
  sourceType: string;
  sourceDocument: string | null;
  sourceSection: string | null;
}): string {
  const base = SOURCE_LABELS[policy.sourceType] ?? policy.sourceType;
  if (policy.sourceType !== 'REGULATORY') return base;
  const cite = [policy.sourceDocument, policy.sourceSection]
    .filter((part): part is string => !!part?.trim())
    .join(' ');
  return cite ? `${base} — ${cite}` : base;
}

function auditSnapshot(policy: SlaPolicyWithEscalations) {
  return {
    policyCode: policy.policyCode,
    processType: policy.processType,
    workflowState: policy.workflowState,
    durationValue: policy.durationValue,
    durationUnit: policy.durationUnit,
    calendarType: policy.calendarType,
    sourceType: policy.sourceType,
    sourceReference: policy.sourceReference,
    sourceDocument: policy.sourceDocument,
    sourceSection: policy.sourceSection,
    effectiveFrom: policy.effectiveFrom.toISOString(),
    effectiveTo: policy.effectiveTo?.toISOString() ?? null,
    escalationEnabled: policy.escalationEnabled,
    warningThreshold: policy.warningThreshold,
    status: policy.status,
  };
}

export function toView(policy: SlaPolicyWithEscalations): SlaPolicyView {
  return {
    id: policy.id,
    policyCode: policy.policyCode,
    policyName: policy.policyName,
    processType: policy.processType,
    workflowState: policy.workflowState,
    description: policy.description,
    durationValue: policy.durationValue,
    durationUnit: policy.durationUnit,
    calendarType: policy.calendarType,
    customWeekendDays: policy.customWeekendDays,
    workingHoursStart: policy.workingHoursStart,
    workingHoursEnd: policy.workingHoursEnd,
    timezone: policy.timezone,
    sourceType: policy.sourceType,
    sourceReference: policy.sourceReference,
    sourceDocument: policy.sourceDocument,
    sourceSection: policy.sourceSection,
    isRegulatory: policy.sourceType === 'REGULATORY',
    sourceLabel: sourceLabelFor(policy),
    effectiveFrom: policy.effectiveFrom.toISOString(),
    effectiveTo: policy.effectiveTo?.toISOString() ?? null,
    escalationEnabled: policy.escalationEnabled,
    warningThreshold: policy.warningThreshold,
    status: policy.status,
    escalations: policy.escalations.map((e) => ({
      stageOrder: e.stageOrder,
      offsetValue: e.offsetValue,
      offsetUnit: e.offsetUnit,
      escalateTo: e.escalateTo,
    })),
    createdByUserId: policy.createdByUserId,
    updatedByUserId: policy.updatedByUserId,
    createdAt: policy.createdAt.toISOString(),
    updatedAt: policy.updatedAt.toISOString(),
  };
}
