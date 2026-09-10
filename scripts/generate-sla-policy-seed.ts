/**
 * Generates `packages/db/prisma/seed-data/sla-policies.ts` from the two places
 * an SLA is AUTHORED:
 *
 *   - `apps/api/.../sla-registry.config.ts`  — durations + escalation stages
 *   - `apps/api/.../sla-policy-source.config.ts` — provenance
 *
 * ## Why generate rather than hand-write
 *
 * `packages/db` cannot import from `apps/api`, so the seed needs its own copy
 * of the table. Hand-copying twenty entries with signed escalation offsets is
 * exactly the kind of transcription nobody re-checks, and a wrong duration
 * here would seed a wrong DEADLINE. Generating it means the durations are
 * still written once, and `sla-policy-seed-drift.spec.ts` fails the build if
 * the committed file ever stops matching its sources.
 *
 * Run: npx tsx scripts/generate-sla-policy-seed.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { SLA_REGISTRY } from "../apps/api/src/modules/sla/sla-registry.config";
import {
  SLA_POLICY_SOURCES,
  slaPolicyCodeFor,
} from "../apps/api/src/modules/sla/sla-policy-source.config";
import { buildSlaPolicySeed } from "../apps/api/src/modules/sla/sla-policy-seed.builder";

const rows = buildSlaPolicySeed(SLA_REGISTRY, SLA_POLICY_SOURCES);

const header = `// GENERATED FILE — do not edit by hand.
//
// Source of truth:
//   apps/api/src/modules/sla/sla-registry.config.ts      (durations, stages)
//   apps/api/src/modules/sla/sla-policy-source.config.ts (provenance)
//
// Regenerate: npx tsx scripts/generate-sla-policy-seed.ts
// Guarded by: apps/api/src/modules/sla/sla-policy-seed-drift.spec.ts
//
// \`packages/db\` cannot import from \`apps/api\`, which is why this copy
// exists. The drift spec is what stops it becoming a second, wrong source.

export interface SlaPolicySeed {
  policyCode: string;
  policyName: string;
  processType: string;
  description: string;
  durationValue: number;
  durationUnit: 'MINUTES' | 'HOURS' | 'BUSINESS_DAYS' | 'CALENDAR_DAYS' | 'MONTHS';
  calendarType: 'JORDAN_STANDARD' | 'CONTINUOUS_24_7' | 'CUSTOM';
  sourceType: 'REGULATORY' | 'INTERNAL_POLICY' | 'CONTRACTUAL' | 'OPERATIONAL' | 'OTHER';
  sourceReference: string | null;
  sourceDocument: string | null;
  sourceSection: string | null;
  escalations: {
    stageOrder: number;
    offsetValue: number;
    offsetUnit: 'MINUTES' | 'HOURS' | 'BUSINESS_DAYS' | 'CALENDAR_DAYS' | 'MONTHS';
    escalateTo: string | null;
  }[];
}

export const SLA_POLICY_SEEDS: SlaPolicySeed[] = ${JSON.stringify(rows, null, 2)};
`;

const target = join(
  __dirname,
  "..",
  "packages",
  "db",
  "prisma",
  "seed-data",
  "sla-policies.ts",
);
writeFileSync(target, header, "utf8");
console.log(
  `Wrote ${rows.length} SLA policy seeds to ${target}\n` +
    `  REGULATORY:      ${rows.filter((r) => r.sourceType === "REGULATORY").length}\n` +
    `  OPERATIONAL:     ${rows.filter((r) => r.sourceType === "OPERATIONAL").length}\n` +
    `  INTERNAL_POLICY: ${rows.filter((r) => r.sourceType === "INTERNAL_POLICY").length}`,
);
void slaPolicyCodeFor;
