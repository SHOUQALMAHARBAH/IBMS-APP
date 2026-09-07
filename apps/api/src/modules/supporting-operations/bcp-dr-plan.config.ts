/**
 * Process 72-73 (backlog Part C #72-73, Domain H) — Business Continuity &
 * Disaster Recovery. Two checkboxes: a plan (with a linked plan document,
 * RTO/RPO) for every one of five named scenarios; a documented last-tested
 * date + next-test-due date per plan. `BcpDrPlan` (schema's own doc
 * comment: "Process 72-73 — continuity/DR plans and tests") pre-exists
 * with zero prior application code — this is its first real consumer, the
 * same "dormant model, first real writer" shape #58-71 repeatedly found.
 *
 * `meta/lex/backup-rpo-rto.md` already covers ONE narrow, already-tested
 * slice of scenario #1 (`system_outage`): the database backup/restore
 * drill (`.github/workflows/backup-drill.yml` +
 * `scripts/backup-restore-drill.sh`, weekly, real pass/fail on row-count
 * parity + a timed RTO check). That lex file's own RPO/RTO figures (24h /
 * 15min) are DRAFT, database-specific, and pre-date this process — this
 * module does not restate or duplicate them; a `BcpDrPlan` row for
 * `system_outage` may cite that drill as its evidence, but the other four
 * scenarios (office/site loss, cyberattack/ransomware, key-staff
 * unavailability, insurer-side service interruption) are organizational/
 * procedural plans with NO code-level automation anywhere in this repo —
 * `BcpDrPlan` is a plain record of the plan's existence and test history,
 * not a system that executes or verifies the plan itself.
 *
 * No new permission, no migration — `bcp-dr.manage`
 * (`[SYSTEM_SECURITY_ADMINISTRATOR, COMPLIANCE_OFFICER]`) was already
 * pre-seeded.
 *
 * No sourced test-cadence figure exists for BCP/DR plans generally (unlike
 * #71's Vendor annual review, which had an explicit "Annual" cadence
 * already in `pdpl-sla-timers.md`) — `nextTestDueAt` is therefore a plain
 * caller-supplied field on `recordTest()`, never auto-computed from a
 * fabricated interval. This is deliberately NOT wired into `SLA_REGISTRY`:
 * this process is a CBJ operational-resilience concern (Part 10.4/10.5),
 * not a PDPL-sourced SLA `pdpl-sla-timers.md` governs.
 */

export const BCP_DR_SCENARIOS = [
  'system_outage',
  'office_site_loss',
  'cyberattack_ransomware',
  'key_staff_unavailability',
  'insurer_service_interruption',
] as const;

export type BcpDrScenario = (typeof BCP_DR_SCENARIOS)[number];

/** Pure: a plan is overdue for testing once `nextTestDueAt` has passed —
 * `null` (never scheduled) is not itself "overdue," a distinct state a
 * caller should treat as its own gap. */
export function isTestOverdue(
  nextTestDueAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (!nextTestDueAt) return false;
  return nextTestDueAt.getTime() < now.getTime();
}

export interface BcpDrPlanRow {
  id: string;
  scenario: string;
  planDocumentId: string | null;
  rtoHours: number | null;
  rpoHours: number | null;
  lastTestedAt: Date | null;
  nextTestDueAt: Date | null;
}

export interface ScenarioCoverageView {
  scenario: BcpDrScenario;
  plans: BcpDrPlanRow[];
  hasPlan: boolean;
}

/** Pure: backlog #72-73 checkbox 1, "plans for every scenario the source
 * names explicitly" — a genuine coverage/gap check across all five named
 * scenarios, not just a CRUD that trusts a plan was recorded for each
 * one. `allPlans` may contain zero, one, or several rows per scenario
 * (this model carries no timestamp to resolve a single "current" row, so
 * none is invented). */
export function computeScenarioCoverage(
  allPlans: BcpDrPlanRow[],
): ScenarioCoverageView[] {
  return BCP_DR_SCENARIOS.map((scenario) => {
    const plans = allPlans.filter((p) => p.scenario === scenario);
    return { scenario, plans, hasPlan: plans.length > 0 };
  });
}
