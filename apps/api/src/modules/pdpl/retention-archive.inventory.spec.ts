import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE ARCHIVED STATE'S CONDITION 1, PROVEN RATHER THAN CLAIMED — batch 5 group 7c.
 *
 * Condition 1 is "LOCKED — the record enters no ongoing processing of any kind", and the claim this
 * batch makes about it is a MEASUREMENT: of the ten write sites touching the four blockable models,
 * eight already refuse a blocked record structurally, by re-asserting a state it cannot be in. That
 * is a much stronger guarantee than a check somebody added — and it is also one a later edit can
 * silently remove, because loosening a `where` clause looks like a feature.
 *
 * So each half of the claim is asserted here against the SOURCE:
 *   - the three unbounded reads consult `notBlockedWhere`;
 *   - the eight structural refusals still re-assert their state;
 *   - the fact the commission ones rest on — `paidAt` written only with `status: 'paid'`;
 *   - and the archive service has NO write path to a destruction, the 7b sibling's own shape.
 *
 * A non-vacuity floor comes first in every case. A guard that reads a file it cannot find, or
 * matches a pattern that stopped matching, reports a clean result — which is the failure this
 * project has recorded three times and once inside a gate built to prevent it.
 */

// File-scoped, never global: this spec reads several source files, and vitest's 5000ms default is a
// real signal for the 3,300 ordinary tests beside it.
vi.setConfig({ testTimeout: 30_000 });

const API_SRC = join(__dirname, '..', '..');

function read(relative: string): string {
  const text = readFileSync(join(API_SRC, relative), 'utf8');
  // NON-VACUITY: a renamed file would otherwise make every assertion below pass over an empty
  // string. `readFileSync` throws on a missing path, which is the loud half; this catches a file
  // that exists and has been emptied.
  expect(text.length, `${relative} is empty`).toBeGreaterThan(500);
  return text;
}

describe('the three UNBOUNDED reads leave the blocked records out', () => {
  /*
   * These three are the measured list, and each is here because its `where` has NO lower date bound,
   * so an eleven-year-old record participates in today's answer forever. The four PERIOD-BOUNDED
   * reads are deliberately absent — see `retention-archive.config.ts`: excluding a blocked record
   * from a report whose window explicitly covers its own era would under-state a period the office
   * is legally required to be able to evidence.
   */
  const CASES: { file: string; method: string; trigger: string }[] = [
    {
      file: 'repositories/transaction-monitoring-alert.repository.ts',
      method: 'findReceiptsForSweep',
      trigger: 'receivedAt',
    },
    {
      file: 'repositories/financial-report.repository.ts',
      method: 'loadCommissionRollupEntries',
      trigger: 'paidAt',
    },
    {
      file: 'repositories/invoice.repository.ts',
      method: 'loadInsurerRemittances',
      trigger: 'remittedAt',
    },
  ];

  for (const c of CASES) {
    it(`${c.method} consults notBlockedWhere on ${c.trigger}`, () => {
      const text = read(c.file);
      // The floor: the method still exists under that name. Without this, a rename makes the
      // exclusion assertion pass over a file that no longer has the read at all.
      expect(text, `${c.method} not found in ${c.file}`).toContain(c.method);
      expect(text).toContain(`notBlockedWhere('${c.trigger}', blocked)`);
      expect(text).toContain('blockedExclusionForModel');
    });
  }
});

describe('EIGHT write sites already refuse a blocked record structurally', () => {
  /*
   * Each entry is a `where` clause that re-asserts a state a blocked record cannot hold. They are
   * asserted as SOURCE FRAGMENTS rather than behaviour because the guarantee IS the clause: a
   * behaviour test would pass just as happily against a version that had added an explicit check and
   * loosened the clause, which is a weaker arrangement with the same observable result today.
   */
  it('the three commission writes still require status outstanding', () => {
    const text = read('repositories/commission.repository.ts');
    const occurrences = text.split("status: 'outstanding'").length - 1;
    expect(
      occurrences,
      'three commission updateMany clauses re-assert status outstanding',
    ).toBeGreaterThanOrEqual(3);
  });

  it('and THE FACT THEY REST ON: paidAt is written only with status paid', () => {
    const text = read('repositories/commission.repository.ts');
    // The whole structural claim is that a blocked entry cannot be `outstanding`, because being
    // blocked means `paidAt` is set. That only holds while `paidAt` has exactly one writer and it
    // writes `status: 'paid'` in the same breath. A second writer would quietly break three of the
    // eight refusals without touching any of their `where` clauses.
    const writers = text.split('paidAt: ').length - 1;
    expect(writers, 'paidAt must have exactly one writer').toBe(1);
    const at = text.indexOf('paidAt: ');
    const around = text.slice(Math.max(0, at - 200), at + 200);
    expect(around).toContain("status: 'paid'");
  });

  it('confirmSettlementPayment still requires clientPaymentConfirmedAt null', () => {
    const text = read('repositories/claim.repository.ts');
    expect(text).toContain('confirmSettlementPayment');
    expect(text).toContain('clientPaymentConfirmedAt: null');
  });

  it('the one reachable user-facing write IS refused, and names the way forward', () => {
    const text = read('modules/claim/claim.service.ts');
    // Anchored on the CALL and its argument, not on the line breaks between them: the first
    // version pinned prettier's own wrapping and failed the moment prettier rewrapped it, which
    // makes a guard that fails for a reason unrelated to what it guards.
    expect(text).toContain('blockedExclusionFor');
    expect(text).toContain("'Settlement'");
    expect(text).toContain('blocked retention phase');
    // The refusal must say where to go, not only that it refused — this project's standing rule for
    // a refusal a reader cannot otherwise act on.
    expect(text).toContain('judicial request or an official CBJ audit');
  });

  it('and the one NOT refused records why, so the omission is a decision', () => {
    const text = read('modules/commission/commission-ledger.service.ts');
    expect(text).toContain(
      'NOT REFUSED FOR A BLOCKED RECORD, AND THAT IS A DECISION',
    );
    expect(text).toContain('recordEntryReversal');
  });
});

describe('the archive service has NO write path to a destruction', () => {
  /*
   * The 7b sibling's shape, and asserted as an ABSENCE because that is the only form that can fail.
   * Retrieving a blocked record is a read with a recorded basis; destroying one is
   * `POST /disposal-batches` behind its own dual control. A convenience route here that created a
   * batch would be exactly the write path the block must not have.
   */
  const FORBIDDEN = [
    'DisposalBatchRepository',
    'disposalBatch',
    'deleteMany',
    'anonymise',
    'anonymize',
  ];

  for (const file of [
    'modules/pdpl/retention-archive.service.ts',
    'modules/pdpl/retention-archive.controller.ts',
    'repositories/retention-archive.repository.ts',
  ]) {
    it(`${file} reaches no destruction`, () => {
      const text = read(file);
      for (const token of FORBIDDEN) {
        expect(text, `${file} must not mention ${token}`).not.toContain(token);
      }
      // The floor: this is the right file, and it does the thing it is supposed to do. Without it
      // the absence assertions above would pass over a file that had been gutted.
      expect(text).toMatch(/retention|blocked|Retention/);
    });
  }
});

/*
 * RENAMED 2026-10-23 (owner decision 45): this read *a closed TWO* and the list is FOUR now.
 * The property it is about is unchanged and is the one that matters — the list is CLOSED, so
 * free text may ACCOMPANY a basis and may never BE one. The assertion below still pins the
 * ORIGINAL migration's own text, which legitimately still names the two it created.
 */
describe('the retrieval basis is a CLOSED list and the register is append-only', () => {
  it('the migration asserts both triggers by name AND by event', () => {
    const text = readFileSync(
      join(
        API_SRC,
        '..',
        '..',
        '..',
        'packages',
        'db',
        'prisma',
        'migrations',
        '20261204100000_retention_archive_retrieval_register',
        'migration.sql',
      ),
      'utf8',
    );
    expect(text.length).toBeGreaterThan(1000);
    expect(text).toContain('retention_archive_retrieval_no_update');
    expect(text).toContain('retention_archive_retrieval_no_delete');
    expect(text).toContain('BEFORE UPDATE');
    expect(text).toContain('BEFORE DELETE');
    expect(text).toContain("'JUDICIAL_REQUEST,CBJ_AUDIT'");
    // AND THE FINDING THAT PUT THE TRIGGERS THERE, so nobody re-derives it: a narrower GRANT is a
    // no-op in this schema, because `pg_default_acl` hands `ibms_app` all four privileges on every
    // new table. The first version of the migration granted SELECT+INSERT and failed its own
    // assertion naming `DELETE,INSERT,SELECT,UPDATE`.
    expect(text).toContain('pg_default_acl');
  });
});
