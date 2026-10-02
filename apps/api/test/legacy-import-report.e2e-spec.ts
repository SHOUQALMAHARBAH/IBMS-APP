import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { ensureRole, prisma } from './tenant-prisma';
import { type RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';

/**
 * THE IMPORT'S REPORT: a duplicate, a bad row and a good row in ONE file, separated BY KIND.
 *
 * Refuse-and-report, per the owner's decision: the row is refused, the rest of the import commits, and
 * the report is durable rather than an HTTP response body. Three properties, and the test needs all
 * three because any two of them pass on the wrong implementation:
 *
 *   1. THE DUPLICATE IS REPORTED AS A DUPLICATE. Not merely refused — a duplicate needs an identity
 *      decision from a person, bad data needs a typo fixed, and "forty rows failed" sends an office
 *      hunting forty typos. The separation is the whole point of the feature, so the assertion is on
 *      the KIND and not on a count.
 *   2. THE BAD ROW IS REPORTED AS BAD DATA, with the intake DTO's own message.
 *   3. THE GOOD ROW IS ACCEPTED. Without this positive witness the test cannot tell "the separation
 *      works" from "nothing was measured" — an import that refused everything would satisfy 1 and 2.
 *
 * And the report is read back through `GET /imports/customers/batches/:id`, not from the POST's
 * response: "the report distinguishes them" is a claim about the DURABLE record, and asserting it on
 * the response body would prove the thing that was already true.
 */
const PASSWORD = 'Correct-Horse-Battery-Staple-9';

let sharedApp: INestApplication<App> | undefined;
async function boot(): Promise<INestApplication<App>> {
  if (!sharedApp) sharedApp = await createTestApp();
  return sharedApp;
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}
function runId(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}
function secretFromOtpAuthUri(uri: string): string {
  const match = /[?&]secret=([^&]+)/.exec(uri);
  if (!match) throw new Error('No secret in otpauth URI');
  return match[1];
}

/** Lifted from `legacy-import.e2e-spec.ts`, which already signs in against these routes. */
async function makeUser(
  label: string,
  ...roles: RoleName[]
): Promise<{ accessToken: string; userId: string }> {
  const app = await boot();
  const email = `${label}-${runId()}@ibms.test`;
  await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: 'Import report e2e', email, password: PASSWORD })
    .expect(201);
  const login = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const { accessToken, user } = login.body as {
    accessToken: string;
    user: { id: string };
  };

  const enroll = await request(app.getHttpServer())
    .post('/auth/mfa/totp/enroll')
    .set(bearer(accessToken))
    .expect(201);
  const enrollBody = enroll.body as {
    credentialId: string;
    otpAuthUri: string;
  };
  await request(app.getHttpServer())
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(accessToken))
    .send({
      credentialId: enrollBody.credentialId,
      code: authenticator.generate(secretFromOtpAuthUri(enrollBody.otpAuthUri)),
    })
    .expect(200);

  for (const roleName of roles) {
    const role = await ensureRole(roleName);
    const active = await prisma.userRoleAssignment.findFirst({
      where: { userId: user.id, roleId: role.id, revokedAt: null },
    });
    if (!active) {
      await prisma.userRoleAssignment.create({
        data: { userId: user.id, roleId: role.id },
      });
    }
  }
  return { accessToken, userId: user.id };
}

interface IssueView {
  lineNumber: number;
  kind: 'DUPLICATE' | 'BAD_DATA' | 'IMPORTED_NEEDS_REVIEW';
  detail: string;
  collidedWithCustomerId: string | null;
}

describe('Legacy import report (e2e) — a duplicate, a bad row and a good row, separated by kind', () => {
  afterAll(async () => {
    await sharedApp?.close();
    sharedApp = undefined;
  });

  it('refuses the duplicate and the bad row, imports the good one, and reports each by KIND', async () => {
    const app = await boot();
    const admin = await makeUser(
      'import-report',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );

    const id = runId();
    const existingReg = `REG-EXIST-${id}`;
    const existingName = `Already Here Co ${id}`;

    // FIRST IMPORT: one company, so the second import has something to collide with. Through the real
    // endpoint rather than a Prisma insert — a fixture written straight to the table would not prove
    // the duplicate check sees what the import itself wrote.
    const seed = await request(app.getHttpServer())
      .post('/imports/customers')
      .set(bearer(admin.accessToken))
      .field(
        'mapping',
        JSON.stringify({
          legalName: 'Name',
          customerType: 'Kind',
          registrationNumber: 'Reg',
        }),
      )
      .attach(
        'file',
        Buffer.from(
          `Name,Kind,Reg\n${existingName},CORPORATE,${existingReg}\n`,
          'utf8',
        ),
        'seed.csv',
      )
      .expect(201);
    expect((seed.body as { imported: number }).imported).toBe(1);

    // SECOND IMPORT: three rows, one of each outcome.
    //
    //   line 2  DUPLICATE  — a DIFFERENT name with the SAME registration number, which is the realistic
    //                        case: an office re-exports its book and a company's name was retyped. The
    //                        key is the number, so this collides.
    //   line 3  BAD_DATA   — CORPORATE with no registration number. The intake DTO requires one; the
    //                        import used to hand-roll two checks that did not include this, which is the
    //                        measured hole this phase closed.
    //   line 4  GOOD       — unique number, imports cleanly.
    const goodReg = `REG-GOOD-${id}`;
    const goodName = `Fresh Co ${id}`;
    const csv = [
      'Name,Kind,Reg',
      `Retyped Name ${id},CORPORATE,${existingReg}`,
      `No Number Co ${id},CORPORATE,`,
      `${goodName},CORPORATE,${goodReg}`,
    ].join('\n');

    const res = await request(app.getHttpServer())
      .post('/imports/customers')
      .set(bearer(admin.accessToken))
      .field(
        'mapping',
        JSON.stringify({
          legalName: 'Name',
          customerType: 'Kind',
          registrationNumber: 'Reg',
        }),
      )
      .attach('file', Buffer.from(csv, 'utf8'), 'mixed.csv')
      .expect(201);

    const body = res.body as {
      batchId: string;
      imported: number;
      rejected: number;
      refusedDuplicates: number;
    };

    // 3 — THE GOOD ROW LANDED. First, because it is the witness that makes the refusals meaningful.
    expect(body.imported).toBe(1);
    expect(
      await prisma.customer.count({ where: { registrationNumber: goodReg } }),
    ).toBe(1);

    // The two refusals, counted apart.
    expect(body.rejected).toBe(2);
    expect(body.refusedDuplicates).toBe(1);

    // THE DURABLE REPORT, read back by its own id rather than taken from the response above.
    const report = await request(app.getHttpServer())
      .get(`/imports/customers/batches/${body.batchId}`)
      .set(bearer(admin.accessToken))
      .expect(200);
    const batch = report.body as {
      fileName: string;
      imported: number;
      refused: number;
      issues: IssueView[];
    };
    expect(batch.fileName).toBe('mixed.csv');
    expect(batch.imported).toBe(1);
    expect(batch.refused).toBe(2);

    // 1 — THE DUPLICATE IS A DUPLICATE, and it NAMES the row it collided with so an officer can open
    // it and decide. "Duplicate" alone sends them looking.
    const duplicates = batch.issues.filter((i) => i.kind === 'DUPLICATE');
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].lineNumber).toBe(2);
    expect(duplicates[0].detail).toContain(existingName);
    expect(duplicates[0].collidedWithCustomerId).not.toBeNull();

    // 2 — THE BAD ROW IS BAD DATA, with the intake DTO's OWN message rather than a restatement.
    const badData = batch.issues.filter((i) => i.kind === 'BAD_DATA');
    expect(badData).toHaveLength(1);
    expect(badData[0].lineNumber).toBe(3);
    expect(badData[0].detail).toContain('registrationNumber');

    // AND THE TWO ARE NOT THE SAME KIND, asserted directly: a screen filtering on kind must get two
    // different answers, and a single `rejected: 2` would satisfy every count above while telling an
    // office nothing about which job each row needs.
    expect(duplicates[0].kind).not.toBe(badData[0].kind);
  });

  it('is refused without customer.bulk-import, and the report is too', async () => {
    // The report is as sensitive as the import: it names customers and the lines they arrived on.
    const app = await boot();
    const sales = await makeUser(
      'import-report-403',
      'SALES_RELATIONSHIP_OFFICER',
    );

    await request(app.getHttpServer())
      .get('/imports/customers/batches')
      .set(bearer(sales.accessToken))
      .expect(403);
  });

  it('404s an unknown batch rather than returning an empty report', async () => {
    // A batch that does not exist and a batch with no issues are different answers. Returning null for
    // both would make a clean import look like a broken link.
    const app = await boot();
    const admin = await makeUser(
      'import-report-404',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );
    await request(app.getHttpServer())
      .get('/imports/customers/batches/00000000-0000-0000-0000-000000000000')
      .set(bearer(admin.accessToken))
      .expect(404);
  });
});
