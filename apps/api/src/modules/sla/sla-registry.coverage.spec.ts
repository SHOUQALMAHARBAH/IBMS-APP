import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SLA_REGISTRY } from './sla-registry.config';

/*
 * Part G, checklist item 6 — "every SLA timer in the 14-row table has an
 * actual escalation job, not a text note".
 *
 * The registry is the easy half: a row there is a deadline definition. The
 * half that decays is whether anything ever STARTS a timer for it — a
 * registered workflow nobody calls is precisely the "text note" the checklist
 * item forbids, and it looks identical to a working one from the registry.
 *
 * This deliberately does NOT try to parse `startTimer(...)` call arguments.
 * An earlier attempt did, reported 2 of 20 covered, and was wrong: most call
 * sites pass a constant (`CONSENT_SLA_WORKFLOW`) or a computed name
 * (`dsrSlaWorkflowFor(...)`, `slaWorkflowName(isEdd)`), so the scan measured
 * its own regex rather than the code. Asserting that the workflow name appears
 * somewhere outside the registry is weaker per-row but it is TRUE, and a guard
 * that is honest about what it checks beats one that silently under-reports.
 */

const SRC = path.join(__dirname, '../..');

/**
 * Registered deadlines that are escalated by their own mechanism rather than
 * by `SlaTimerScheduler`.
 *
 * `claim_followup_insurer_response` — Process 27 owns a dedicated
 * `ClaimFollowUpAlert` model and a nightly `ClaimFollowUpScheduler` sweep that
 * raises and auto-resolves alerts against a per-line-family threshold
 * snapshotted onto the claim. That is an actual escalation job, which is what
 * item 6 asks for; it simply predates and sits outside the generic engine.
 */
const ESCALATED_ELSEWHERE: Record<string, string> = {
  claim_followup_insurer_response:
    'ClaimFollowUpAlert + ClaimFollowUpScheduler (Process 27)',
};

/**
 * The whole tree's source, read ONCE.
 *
 * This walked ~800 files and joined them into one multi-megabyte string on EVERY call, and two
 * tests below call it — so the work was done twice and the file timed out at 8198ms against
 * vitest's 5s default. A guard that fails as a TIMEOUT reports nothing about the rule it guards,
 * which is the worst way for one to fail (IMPROVEMENTS.md § 1.28, § 1.36 — this is the third
 * source-scanning inventory spec to hit it, so the pattern is the file shape, not one file).
 */
let cachedSourceText: string | null = null;
function sourceText(): string {
  cachedSourceText ??= readAllSource();
  return cachedSourceText;
}

function readAllSource(): string {
  const parts: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (
        e.name.endsWith('.ts') &&
        !e.name.includes('.spec.') &&
        !e.name.endsWith('sla-registry.config.ts')
      )
        parts.push(fs.readFileSync(full, 'utf8'));
    }
  };
  walk(SRC);
  return parts.join('\n');
}

describe('every registered SLA deadline is wired to something', () => {
  const names = SLA_REGISTRY.map((r) => r.workflowName);

  it('sanity: the registry is populated', () => {
    expect(names.length).toBeGreaterThan(10);
  });

  it('covers all fourteen deadlines the source document names', () => {
    // The backlog's own 14-row table (Part A.8). Named explicitly so that
    // dropping one from the registry fails here rather than going unnoticed.
    const required = [
      'consent_withdrawal',
      'dsr_access_deletion',
      'dsr_correction_objection',
      'termination_access_revocation',
      'quarterly_access_review',
      'disposal_batch_execution',
      'legal_hold_necessity_review',
      'vendor_annual_review',
      'data_sharing_decision',
      'incident_containment',
      'incident_senior_management_notification',
      'dpia_review',
      'renewal_workflow_start',
      'claim_followup_insurer_response',
    ];
    expect(required.filter((r) => !names.includes(r))).toEqual([]);
  });

  // 20s, not the 5s default, and measured rather than picked: this test carries the tree walk and
  // whole-tree read that both scanning tests share — 1985ms in isolation on this host, down from
  // 8198ms for the file before the read was memoized. The same work has been observed at ~3x under
  // a full-suite batch, which is how it came to fail as a timeout and report nothing about the
  // rule. If this figure grows, find out where the time goes before raising it again (§ 1.28).
  it('every registered workflow is referenced by real code, not just declared', () => {
    const src = sourceText();
    const orphans = names.filter(
      (n) => !ESCALATED_ELSEWHERE[n] && !src.includes(n),
    );
    expect(orphans).toEqual([]);
  }, 20_000);

  it('the escalated-elsewhere list has no stale entries', () => {
    expect(
      Object.keys(ESCALATED_ELSEWHERE).filter((n) => !names.includes(n)),
    ).toEqual([]);
  });
});
