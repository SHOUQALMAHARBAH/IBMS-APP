import type { SlaDurationUnit } from '../../common/business-days.util';
import type { SlaRegistryEntry } from './sla-registry.config';
import type { SlaPolicySource } from './sla-policy-source.config';
import { slaPolicyCodeFor } from './sla-policy-source.config';

/** The DB enum spelling of a duration unit. */
export type SeedDurationUnit =
  'MINUTES' | 'HOURS' | 'BUSINESS_DAYS' | 'CALENDAR_DAYS' | 'MONTHS';

export interface SlaPolicySeedRow {
  policyCode: string;
  policyName: string;
  processType: string;
  description: string;
  durationValue: number;
  durationUnit: SeedDurationUnit;
  calendarType: 'JORDAN_STANDARD' | 'CONTINUOUS_24_7' | 'CUSTOM';
  sourceType: string;
  sourceReference: string | null;
  sourceDocument: string | null;
  sourceSection: string | null;
  escalations: {
    stageOrder: number;
    offsetValue: number;
    offsetUnit: SeedDurationUnit;
    escalateTo: string | null;
  }[];
}

const DB_UNIT: Readonly<Record<SlaDurationUnit, SeedDurationUnit>> = {
  minutes: 'MINUTES',
  hours: 'HOURS',
  businessDays: 'BUSINESS_DAYS',
  calendarDays: 'CALENDAR_DAYS',
  months: 'MONTHS',
};

/**
 * Projects the compile-time registry plus its provenance table into seedable
 * `SlaPolicy` rows.
 *
 * Extracted from the generator script so the SAME function can be re-run in a
 * test and compared against the committed output — which is what makes the
 * generated seed file safe to trust rather than merely convenient.
 *
 * An hours-denominated SLA is seeded on the CONTINUOUS_24_7 calendar: an
 * incident-containment clock measured in hours does not stop for Friday, and
 * quietly walking it across business days would move a statutory deadline by
 * days. Everything measured in days keeps the Jordan working calendar.
 */
export function buildSlaPolicySeed(
  registry: readonly SlaRegistryEntry[],
  sources: Readonly<Record<string, SlaPolicySource>>,
): SlaPolicySeedRow[] {
  return registry.map((entry) => {
    const source = sources[entry.workflowName];
    if (!source) {
      throw new Error(
        `SLA registry entry "${entry.workflowName}" has no provenance in SLA_POLICY_SOURCES. Every SLA must state where it comes from — add it (INTERNAL_POLICY is the honest classification when no authority exists) rather than defaulting it.`,
      );
    }
    if (
      source.sourceType === 'REGULATORY' &&
      (!source.sourceReference || !source.sourceDocument)
    ) {
      throw new Error(
        `SLA "${entry.workflowName}" is classified REGULATORY but names no instrument. A regulatory SLA must cite sourceReference and sourceDocument.`,
      );
    }

    return {
      policyCode: slaPolicyCodeFor(entry.workflowName),
      policyName: entry.label,
      processType: entry.workflowName,
      description: source.rationale,
      durationValue: entry.duration.value,
      durationUnit: DB_UNIT[entry.duration.unit],
      calendarType:
        entry.duration.unit === 'hours' || entry.duration.unit === 'minutes'
          ? 'CONTINUOUS_24_7'
          : 'JORDAN_STANDARD',
      sourceType: source.sourceType,
      sourceReference: source.sourceReference,
      sourceDocument: source.sourceDocument,
      sourceSection: source.sourceSection,
      escalations: entry.escalationStages.map((stage, index) => ({
        stageOrder: index,
        offsetValue: stage.offset.value,
        offsetUnit: DB_UNIT[stage.offset.unit],
        escalateTo: stage.escalateTo,
      })),
    };
  });
}
