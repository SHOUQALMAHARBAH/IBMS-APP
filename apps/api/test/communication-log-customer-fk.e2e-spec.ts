import { describe, expect, it } from 'vitest';
import { rawPrisma, TEST_ORGANIZATION_ID } from './tenant-prisma';

/*
 * `CommunicationLog.customerId` IS ANCHORED NOW — batch six item 4, register entry 125.
 *
 * The column was a bare `String?` with no `@relation` and no foreign key, so a row could name a
 * customer that does not exist and the database had nothing to refuse it with. Batch five then made
 * that column the source of a NAME ON SCREEN, which is when an unanchored id stops being untidy and
 * starts lying to a reader.
 *
 * WHY RAW PRISMA AND NOT A SERVICE: the claim is about what the DATABASE enforces. Driving it
 * through `POST /communications` would prove the SERVICE validates its input, which is a different
 * (and weaker) statement — delete the service's check and the guarantee has to survive. There is no
 * service in this path at all.
 *
 * WHY EVERY WRITE IS ROLLED BACK: db-test is cumulative, and `CommunicationLog` rows are read by
 * the sibling `communication.e2e-spec.ts` list assertions. A leaked row here would change a count
 * there, which is the cross-spec coupling this repository has already paid for twice.
 */

/** A sentinel the rollback makes unnecessary — and which proves the rollback if it ever does not. */
const ROLLBACK =
  'rollback: the fixture customer and its log must not outlive this test';

async function anyUserId(): Promise<string> {
  const user = await rawPrisma.user.findFirstOrThrow({
    where: { organizationId: TEST_ORGANIZATION_ID },
    select: { id: true },
  });
  return user.id;
}

describe('CommunicationLog.customerId — the foreign key (batch six item 4)', () => {
  it('REFUSES a log naming a customer that does not exist', async () => {
    await expect(
      rawPrisma.communicationLog.create({
        data: {
          organizationId: TEST_ORGANIZATION_ID,
          customerId: 'no-such-customer-00000000-0000-0000-0000-000000000000',
          channel: 'EMAIL',
          direction: 'OUTBOUND',
          subject: 'a send against a customer that was never there',
        },
      }),
    ).rejects.toThrow(
      /CommunicationLog_customerId_fkey|foreign key constraint/i,
    );

    /*
     * THE NON-VACUITY FLOOR. Without it this test passes against a model that refuses EVERY insert
     * — a required column added later, a tenancy default that stopped working — and would report
     * the foreign key as working while nothing could be written at all.
     */
    let created = '';
    await expect(
      rawPrisma.$transaction(async (tx) => {
        const row = await tx.communicationLog.create({
          data: {
            organizationId: TEST_ORGANIZATION_ID,
            customerId: null,
            channel: 'EMAIL',
            direction: 'OUTBOUND',
            subject: 'the same insert with no customer at all — must succeed',
          },
        });
        created = row.id;
        throw new Error(ROLLBACK);
      }),
    ).rejects.toThrow(ROLLBACK);
    expect(created).not.toBe('');
    expect(
      await rawPrisma.communicationLog.count({ where: { id: created } }),
    ).toBe(0);
  }, 120_000);

  it('ON DELETE SET NULL — deleting the customer keeps the log and nulls the pointer', async () => {
    const owner = await anyUserId();
    /*
     * The two halves this proves are the whole reason the delete rule is SET NULL rather than
     * CASCADE or RESTRICT: the log row SURVIVES (it is PDPL evidence that a message was sent) and
     * the customer still DELETES (so a DSR erasure is not blocked by send history).
     */
    let logId = '';
    let survivedWithNullCustomer = false;
    let logCountAfterDelete = -1;

    await expect(
      rawPrisma.$transaction(async (tx) => {
        const customer = await tx.customer.create({
          data: {
            organizationId: TEST_ORGANIZATION_ID,
            customerType: 'CORPORATE',
            legalName: `FK-FIXTURE-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            registrationNumber: `FK-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            registeredAddress: 'عمّان، الأردن',
            natureOfBusiness: 'تجارة عامة',
            languagePreference: 'AR',
            ownerUserId: owner,
          },
        });
        const log = await tx.communicationLog.create({
          data: {
            organizationId: TEST_ORGANIZATION_ID,
            customerId: customer.id,
            channel: 'EMAIL',
            direction: 'OUTBOUND',
            subject: 'a send that must outlive the customer it named',
          },
        });
        logId = log.id;

        await tx.customer.delete({ where: { id: customer.id } });

        const after = await tx.communicationLog.findUniqueOrThrow({
          where: { id: log.id },
          select: { id: true, customerId: true, subject: true },
        });
        logCountAfterDelete = await tx.communicationLog.count({
          where: { id: log.id },
        });
        survivedWithNullCustomer = after.customerId === null;

        throw new Error(ROLLBACK);
      }),
    ).rejects.toThrow(ROLLBACK);

    // The log row was still there after the customer went...
    expect(logCountAfterDelete).toBe(1);
    // ...and its pointer had been nulled rather than left dangling.
    expect(survivedWithNullCustomer).toBe(true);
    // And nothing leaked: the rollback took the fixture with it.
    expect(logId).not.toBe('');
    expect(
      await rawPrisma.communicationLog.count({ where: { id: logId } }),
    ).toBe(0);
  }, 120_000);

  it('the key exists and its delete rule is SET NULL, not CASCADE and not RESTRICT', async () => {
    /*
     * Asserted BY ITS DELETE RULE rather than by its existence. A constraint recreated as CASCADE
     * keeps this name and silently starts destroying send evidence; one recreated as RESTRICT keeps
     * this name and silently starts blocking erasures. Either would satisfy a check that only asked
     * whether the key was there.
     */
    const rows = await rawPrisma.$queryRaw<{ delete_rule: string }[]>`
      SELECT rc.delete_rule
      FROM information_schema.referential_constraints rc
      WHERE rc.constraint_name = 'CommunicationLog_customerId_fkey'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].delete_rule).toBe('SET NULL');
  }, 120_000);
});
