import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { rawPrisma, TEST_ORGANIZATION_ID } from './tenant-prisma';
import { createTestApp } from './utils/test-app';
import { MAKER_CHECKER_REGISTRY } from '../src/common/maker-checker-pairs.config';

/**
 * PART 4 STEP 2 — the four database guarantees the declared-mode design rests on.
 *
 * Every test here writes with the OWNER connection and raw model calls, never through a service, because the
 * claim is about the database. The whole design was chosen over two alternatives (see
 * `docs/duty-segregation-mode.md`) on the strength of this pair of properties:
 *
 *   1. The database refuses a SILENT self-approval — the 15 CHECK constraints, exactly as before.
 *   2. The database refuses a DECLARED one in a SEGREGATED office — the trigger on `CombinedDutyAct`.
 *
 * Deleting every line of application code cannot produce either. That is the difference between a control and
 * a convention, and it is why the escape is a column plus one trigger rather than fifteen triggers or a
 * denormalised mode column.
 *
 * ## Why the COMBINED-mode test runs inside a transaction it always rolls back
 *
 * db-test is cumulative and shared by every api e2e spec. An office left in COMBINED mode would make a
 * declared self-approval legitimate for every later spec in the run — so the one test that needs the mode
 * changes it inside `$transaction` and throws, and no other test can observe the office as anything but
 * SEGREGATED. Creating a second Organization was the alternative and is worse: a second live office makes
 * `signup` refuse, which has already cost one run 17 unrelated failures.
 */

let app: INestApplication<App> | null = null;

/** A sentinel the rollback makes unnecessary — and which proves the rollback if it ever does not. */
const ROLLBACK =
  'rollback: the mode change and the act must not outlive this test';

/** Distinctive, so the absence assertion below is about THIS attempt and not about the office's history. */
const FORGED_REASON =
  'A forged declaration in an office that never declared the mode.';

beforeAll(async () => {
  app = await createTestApp();
}, 300_000);

afterAll(async () => {
  await app?.close();
});

/** An Endorsement with no Refund yet — `Refund.endorsementId` is unique, so a used one cannot be reused. */
async function freeEndorsementId(): Promise<string> {
  const endorsement = await rawPrisma.endorsement.findFirst({
    where: { organizationId: TEST_ORGANIZATION_ID, refund: null },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  // Loud rather than skipped: a test that quietly does nothing is the failure mode this suite has been
  // bitten by, and a database with no spare endorsement is a fixture problem, not a pass.
  if (!endorsement) {
    throw new Error(
      'no Endorsement without a Refund on this database — the proof below would be vacuous',
    );
  }
  return endorsement.id;
}

async function anyUserId(): Promise<string> {
  const user = await rawPrisma.user.findFirstOrThrow({
    where: { organizationId: TEST_ORGANIZATION_ID },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  return user.id;
}

describe('duty segregation mode — the database half (e2e)', () => {
  it('every office reads SEGREGATED: the migration granted nothing', async () => {
    const offices = await rawPrisma.organization.findMany({
      select: { id: true, dutySegregationMode: true },
    });
    expect(offices.length).toBeGreaterThan(0);
    for (const office of offices) {
      expect(office.dutySegregationMode).toBe('SEGREGATED');
    }
    // NOT asserted here: that no office has ever declared a mode. That is true only until step 4 ships a way
    // to declare one, and an assertion which a later step must delete is a liability rather than a guard —
    // the useful property is the one above, that every office reads SEGREGATED right now.
  }, 120_000);

  it('an UNDECLARED self-approval is still refused by the CHECK', async () => {
    const actor = await anyUserId();
    const endorsementId = await freeEndorsementId();

    await expect(
      rawPrisma.refund.create({
        data: {
          organizationId: TEST_ORGANIZATION_ID,
          endorsementId,
          amount: '10.000',
          reason: 'overpayment',
          raisedByUserId: actor,
          approvedByUserId: actor,
        },
      }),
      // 23514 — the constraint, not a DTO and not a service. This is the assertion that would catch the
      // migration having loosened a predicate while recreating it.
    ).rejects.toThrow(/Refund_maker_checker_distinct|check constraint/i);
  }, 120_000);

  it('a combined-duty act cannot be DECLARED while the office is SEGREGATED — the trigger', async () => {
    const actor = await anyUserId();

    await expect(
      rawPrisma.combinedDutyAct.create({
        data: {
          organizationId: TEST_ORGANIZATION_ID,
          entity: 'Refund',
          entityId: 'no-such-refund',
          constraintName: 'Refund_maker_checker_distinct',
          actorUserId: actor,
          reason: FORGED_REASON,
        },
      }),
      // Without this the escape column is a universal bypass and the mode is a value nobody reads.
    ).rejects.toThrow(/SEGREGATED mode/);

    // Scoped to THIS test's own attempt, never a count of the office's acts. db-test is cumulative, and a
    // spec that exercises a COMBINED office legitimately leaves acts behind — a global zero here would be a
    // cross-spec coupling that breaks on run ORDER, which is a trap this suite has been bitten by before.
    expect(
      await rawPrisma.combinedDutyAct.count({
        where: { reason: FORGED_REASON },
      }),
    ).toBe(0);
  }, 120_000);

  it('a reason of a few characters is refused: the act has to say why', async () => {
    const actor = await anyUserId();
    // Inside the transaction because the office has to be COMBINED for the trigger to let us reach the
    // reason CHECK at all — otherwise this would pass for the wrong reason (the trigger, not the floor).
    await expect(
      rawPrisma.$transaction(async (tx) => {
        await tx.organization.update({
          where: { id: TEST_ORGANIZATION_ID },
          data: { dutySegregationMode: 'COMBINED' },
        });
        await tx.combinedDutyAct.create({
          data: {
            organizationId: TEST_ORGANIZATION_ID,
            entity: 'Refund',
            entityId: 'no-such-refund',
            constraintName: 'Refund_maker_checker_distinct',
            actorUserId: actor,
            reason: 'oops',
          },
        });
      }),
    ).rejects.toThrow(/CombinedDutyAct_reason_not_empty|check constraint/i);
  }, 120_000);

  it('in a COMBINED office the act inserts and the declared self-approval is ACCEPTED — then rolled back', async () => {
    const actor = await anyUserId();
    const endorsementId = await freeEndorsementId();
    // `let` + a widened type, because these are assigned inside the transaction callback and read after it.
    let acceptedRefundId = '';
    let actId = '';

    await expect(
      rawPrisma.$transaction(async (tx) => {
        await tx.organization.update({
          where: { id: TEST_ORGANIZATION_ID },
          data: {
            dutySegregationMode: 'COMBINED',
            dutySegregationModeDeclaredAt: new Date(),
            dutySegregationModeDeclaredByUserId: actor,
          },
        });

        const act = await tx.combinedDutyAct.create({
          data: {
            organizationId: TEST_ORGANIZATION_ID,
            entity: 'Refund',
            entityId: 'pending',
            constraintName: 'Refund_maker_checker_distinct',
            actorUserId: actor,
            reason:
              'One-person office: the owner raised and approved this refund herself.',
            actorRoleIds: ['role-a'],
            grantingRoleIds: ['role-a'],
            grantingRoleNames: ['OFFICE_ADMINISTRATOR'],
          },
        });
        actId = act.id;

        // THE POINT OF THE WHOLE DESIGN: the same write the previous test proved is refused, now accepted,
        // because it declares itself. Same table, same constraint, same two equal user ids.
        const refund = await tx.refund.create({
          data: {
            organizationId: TEST_ORGANIZATION_ID,
            endorsementId,
            amount: '10.000',
            reason: 'overpayment',
            raisedByUserId: actor,
            approvedByUserId: actor,
            combinedDutyActId: act.id,
          },
        });
        acceptedRefundId = refund.id;

        // Read it BACK inside the transaction rather than trusting the create's return value.
        const stored = await tx.refund.findUniqueOrThrow({
          where: { id: refund.id },
          select: {
            raisedByUserId: true,
            approvedByUserId: true,
            combinedDutyActId: true,
          },
        });
        expect(stored.raisedByUserId).toBe(actor);
        expect(stored.approvedByUserId).toBe(actor);
        expect(stored.combinedDutyActId).toBe(act.id);

        throw new Error(ROLLBACK);
      }),
    ).rejects.toThrow(ROLLBACK);

    // Nothing survived. If either of these is non-zero the rollback did not happen, and every later spec in
    // this run would be asserting against an office that permits self-approval.
    expect(
      acceptedRefundId,
      'the accepted write must have happened before the rollback',
    ).not.toBe('');
    expect(
      await rawPrisma.refund.count({ where: { id: acceptedRefundId } }),
    ).toBe(0);
    expect(
      await rawPrisma.combinedDutyAct.count({ where: { id: actId } }),
    ).toBe(0);
    const office = await rawPrisma.organization.findUniqueOrThrow({
      where: { id: TEST_ORGANIZATION_ID },
      select: {
        dutySegregationMode: true,
        dutySegregationModeDeclaredAt: true,
      },
    });
    expect(office.dutySegregationMode).toBe('SEGREGATED');
    expect(office.dutySegregationModeDeclaredAt).toBeNull();
  }, 180_000);

  it("one pair's escape column does not excuse the other pair on the same table", async () => {
    // THE REASON THERE ARE 15 COLUMNS AND NOT 14. `NeedsAssessment` carries two pairs, and a declared
    // combined REVIEW must not excuse a self-APPROVAL — a different act under a different permission that
    // happens to live on the same row.
    const actor = await anyUserId();
    const riskProfile = await rawPrisma.riskProfile.findFirstOrThrow({
      where: { organizationId: TEST_ORGANIZATION_ID },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    await expect(
      rawPrisma.$transaction(async (tx) => {
        await tx.organization.update({
          where: { id: TEST_ORGANIZATION_ID },
          data: { dutySegregationMode: 'COMBINED' },
        });
        const act = await tx.combinedDutyAct.create({
          data: {
            organizationId: TEST_ORGANIZATION_ID,
            entity: 'NeedsAssessment',
            entityId: 'pending',
            // Declared for the REVIEWER pair.
            constraintName: 'NeedsAssessment_reviewer_maker_checker_distinct',
            actorUserId: actor,
            reason:
              'Declared for the review, deliberately not for the approval.',
          },
        });

        // Filed against the REVIEWER column, while the row self-approves. The approver constraint must
        // still refuse, because its own escape column is null.
        await tx.needsAssessment.create({
          data: {
            organizationId: TEST_ORGANIZATION_ID,
            riskProfileId: riskProfile.id,
            questionnaireAnswers: {},
            createdByUserId: actor,
            approvedByUserId: actor,
            reviewerCombinedDutyActId: act.id,
          },
        });
      }),
    ).rejects.toThrow(
      /NeedsAssessment_approver_maker_checker_distinct|check constraint/i,
    );
  }, 180_000);

  it('every registered pair has an escape column, and the registry names a real constraint', async () => {
    // The registry is what the application layer will read to know which column to fill. If a pair's
    // constraint name were wrong, step 3 would fill nothing and the write would be refused with a message
    // about segregation — which reads as the control working.
    const rows = await rawPrisma.$queryRaw<{ conname: string }[]>`
      SELECT c.conname FROM pg_constraint c
       WHERE c.contype = 'c' AND c.conname LIKE '%maker_checker%'`;
    const live = new Set(rows.map((r) => r.conname));
    expect(live.size).toBe(MAKER_CHECKER_REGISTRY.length);
    for (const pair of MAKER_CHECKER_REGISTRY) {
      expect(
        live.has(pair.dbCheckConstraint),
        `${pair.entityType}: the registry names ${pair.dbCheckConstraint}, which no CHECK constraint carries`,
      ).toBe(true);
    }

    const columns = await rawPrisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name LIKE '%ombinedDutyActId'`;
    expect(Number(columns[0].count)).toBe(MAKER_CHECKER_REGISTRY.length);
  }, 120_000);
});
