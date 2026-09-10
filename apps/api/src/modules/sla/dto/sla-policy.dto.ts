import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { emptyStringToUndefined, trimIfString } from '../../../common/dto.util';

export const SLA_DURATION_UNITS = [
  'MINUTES',
  'HOURS',
  'BUSINESS_DAYS',
  'CALENDAR_DAYS',
  'MONTHS',
] as const;

export const SLA_CALENDAR_TYPES = [
  'JORDAN_STANDARD',
  'CONTINUOUS_24_7',
  'CUSTOM',
] as const;

export const SLA_SOURCE_TYPES = [
  'REGULATORY',
  'INTERNAL_POLICY',
  'CONTRACTUAL',
  'OPERATIONAL',
  'OTHER',
] as const;

export const SLA_POLICY_STATUSES = ['DRAFT', 'ACTIVE', 'INACTIVE'] as const;

/** "HH:MM", 24-hour. */
const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

export class SlaEscalationStageDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  stageOrder?: number;

  /** SIGNED and relative to the due date: 0 is the deadline itself, negative
   * is an early-warning stage before it. */
  @IsInt()
  offsetValue!: number;

  @IsIn([...SLA_DURATION_UNITS])
  offsetUnit!: (typeof SLA_DURATION_UNITS)[number];

  /** Free text — several escalation targets named by the lex have no RBAC
   * role yet (General Manager, Legal Counsel). */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Length(1, 120)
  escalateTo?: string;
}

export class CreateSlaPolicyDto {
  /** Stable identifier quoted in governance documents. Must not change when
   * the duration does. */
  @Transform(trimIfString)
  @Matches(/^[A-Z0-9][A-Z0-9-]{2,63}$/, {
    message:
      'policyCode must be 3-64 characters of upper-case letters, digits and hyphens (e.g. SLA-DSR-ACCESS)',
  })
  policyCode!: string;

  @Transform(trimIfString)
  @Length(3, 200)
  policyName!: string;

  /** Matches `SlaTimer.workflowName` / `SlaRegistryEntry.workflowName`. */
  @Transform(trimIfString)
  @Length(2, 100)
  processType!: string;

  /** NULL/omitted = the whole process. */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Length(1, 100)
  workflowState?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Length(1, 2000)
  description?: string;

  /** 0 is valid and meaningful: an SLA whose deadline is the triggering event
   * itself (`termination_access_revocation` is 0 hours — revoke access
   * immediately). Negative is not. */
  @IsInt()
  @Min(0)
  @Max(100_000)
  durationValue!: number;

  @IsIn([...SLA_DURATION_UNITS])
  durationUnit!: (typeof SLA_DURATION_UNITS)[number];

  @IsOptional()
  @IsIn([...SLA_CALENDAR_TYPES])
  calendarType?: (typeof SLA_CALENDAR_TYPES)[number];

  /** `Date#getUTCDay()` numbering, 0=Sunday. `CUSTOM` calendars only. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  customWeekendDays?: number[];

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Matches(TIME_OF_DAY, { message: 'workingHoursStart must be HH:MM' })
  workingHoursStart?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Matches(TIME_OF_DAY, { message: 'workingHoursEnd must be HH:MM' })
  workingHoursEnd?: string;

  @IsOptional()
  @Transform(trimIfString)
  @Length(1, 60)
  timezone?: string;

  /**
   * WHERE THIS SLA COMES FROM.
   *
   * `REGULATORY` additionally requires `sourceReference` and `sourceDocument`
   * — enforced in `SlaPolicyService` for a readable error and by a DB CHECK so
   * no other write path can assert legal force without naming the instrument.
   * If no authoritative source exists, `INTERNAL_POLICY` is the honest
   * classification; recording an internal target as a legal requirement is the
   * failure this field exists to prevent.
   */
  @IsIn([...SLA_SOURCE_TYPES])
  sourceType!: (typeof SLA_SOURCE_TYPES)[number];

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Length(1, 300)
  sourceReference?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Length(1, 300)
  sourceDocument?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Length(1, 300)
  sourceSection?: string;

  @IsOptional()
  @IsISO8601()
  effectiveFrom?: string;

  @IsOptional()
  @IsISO8601()
  effectiveTo?: string;

  @IsOptional()
  @IsBoolean()
  escalationEnabled?: boolean;

  /** Fraction of the window elapsed at which the status becomes
   * APPROACHING_DUE. Configurable because "approaching" means something
   * different for a 1-hour containment clock and a 30-day DSR. */
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(1)
  warningThreshold?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => SlaEscalationStageDto)
  escalations?: SlaEscalationStageDto[];
}

/** Everything editable after creation. `policyCode`, `processType` and
 * `workflowState` are deliberately absent: they identify WHICH slot a policy
 * occupies, and changing them would silently move an in-force SLA onto a
 * different process. Create a new policy and activate it instead — which
 * leaves the previous one in the record rather than rewriting it. */
export class UpdateSlaPolicyDto {
  @IsOptional()
  @Transform(trimIfString)
  @Length(3, 200)
  policyName?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Length(1, 2000)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  durationValue?: number;

  @IsOptional()
  @IsIn([...SLA_DURATION_UNITS])
  durationUnit?: (typeof SLA_DURATION_UNITS)[number];

  @IsOptional()
  @IsIn([...SLA_CALENDAR_TYPES])
  calendarType?: (typeof SLA_CALENDAR_TYPES)[number];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  customWeekendDays?: number[];

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Matches(TIME_OF_DAY, { message: 'workingHoursStart must be HH:MM' })
  workingHoursStart?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Matches(TIME_OF_DAY, { message: 'workingHoursEnd must be HH:MM' })
  workingHoursEnd?: string;

  @IsOptional()
  @Transform(trimIfString)
  @Length(1, 60)
  timezone?: string;

  @IsOptional()
  @IsIn([...SLA_SOURCE_TYPES])
  sourceType?: (typeof SLA_SOURCE_TYPES)[number];

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Length(1, 300)
  sourceReference?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Length(1, 300)
  sourceDocument?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Length(1, 300)
  sourceSection?: string;

  @IsOptional()
  @IsISO8601()
  effectiveTo?: string;

  @IsOptional()
  @IsBoolean()
  escalationEnabled?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(1)
  warningThreshold?: number;
}

export class ListSlaPoliciesDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Length(2, 100)
  processType?: string;

  @IsOptional()
  @IsIn([...SLA_POLICY_STATUSES])
  status?: (typeof SLA_POLICY_STATUSES)[number];
}

export class CreateSlaHolidayDto {
  /** A whole non-working day, `YYYY-MM-DD`. Not a timestamp: a holiday is a
   * day in the policy's timezone, not an instant. */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'observedOn must be a YYYY-MM-DD date',
  })
  observedOn!: string;

  @Transform(trimIfString)
  @IsString()
  @Length(2, 200)
  name!: string;

  /** Omitted = applies to every calendar. */
  @IsOptional()
  @IsIn([...SLA_CALENDAR_TYPES])
  calendarType?: (typeof SLA_CALENDAR_TYPES)[number];
}

export class PauseSlaTimerDto {
  /** Mandatory: a stopped compliance clock with no stated basis is
   * indistinguishable from one somebody forgot to restart. */
  @Transform(trimIfString)
  @Length(10, 1000, {
    message: 'reason must explain why the SLA clock is being paused',
  })
  reason!: string;
}

/** The source/citation fields ONLY, behind `sla.policy.regulatory`. Split from
 * `UpdateSlaPolicyDto` so the authority to declare an SLA legally required is
 * a different route, not a different branch inside one handler. */
export class UpdateSlaPolicySourceDto {
  @IsIn([...SLA_SOURCE_TYPES])
  sourceType!: (typeof SLA_SOURCE_TYPES)[number];

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Length(1, 300)
  sourceReference?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Length(1, 300)
  sourceDocument?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Length(1, 300)
  sourceSection?: string;
}
