import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { authenticator } from 'otplib';
import { ensureRole, prisma } from './tenant-prisma';
import { type RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';

/**
 * THE TWO FILES IN `docs/walkthrough/` DO WHAT THE WALKTHROUGH SAYS THEY DO.
 *
 * The walkthrough tells the owner, row by row, which defect each bad row carries and what the screen
 * will report. That is a claim about behaviour, and a claim about behaviour written from reading the
 * validator is a claim nobody checked. So the real files go through the real endpoint here, and the
 * assertions are the SENTENCES the walkthrough promises.
 *
 * It also guards the files against the code moving underneath them: if a future change stops refusing a
 * numberless company, this fails and the walkthrough stops being a document that lies to her.
 *
 * ## Why the duplicate row cannot be asserted here
 *
 * Row 4 collides with a registration number that exists in the OWNER's dev database, not in db-test.
 * Its outcome is office-dependent by nature — that is what a duplicate IS — so this file asserts the
 * four office-independent rows and the walkthrough states the duplicate's dependence explicitly. The
 * duplicate mechanism itself is proven by `legacy-import-report.e2e-spec.ts`, which creates its own
 * collision.
 */
const PASSWORD = 'Correct-Horse-Battery-Staple-9';
const WALKTHROUGH = join(__dirname, '..', '..', '..', 'docs', 'walkthrough');

const MAPPING = JSON.stringify({
  legalName: 'Client Name',
  customerType: 'Kind',
  registrationNumber: 'Reg',
  nationality: 'Nationality',
  contactEmail: 'Email',
  contactPhone: 'Phone',
  registeredAddress: 'Address',
});

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

async function makeUser(
  label: string,
  ...roles: RoleName[]
): Promise<{ accessToken: string }> {
  const app = await boot();
  const email = `${label}-${runId()}@ibms.test`;
  await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: 'Walkthrough fixture e2e', email, password: PASSWORD })
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
  return { accessToken };
}

interface IssueView {
  lineNumber: number;
  kind: 'DUPLICATE' | 'BAD_DATA' | 'IMPORTED_NEEDS_REVIEW';
  detail: string;
}

/**
 * THE SPEC SUBSTITUTES RUN-UNIQUE REGISTRATION NUMBERS. It does not clean up, and it must not try.
 *
 * The two files carry FIXED numbers on purpose — the owner reads them by hand and matches rows against
 * what the screen reports, which a `REG-1790947326518` would make impossible. But db-test is cumulative,
 * so a second run of this spec saw its own first-run rows: line 3 came back as a DUPLICATE and the
 * all-valid file imported 0 of 3.
 *
 * The obvious fix — delete the rows afterwards — is the WRONG one, and finding out why was worth the
 * three runs it took. An imported customer cannot be casually deleted:
 *
 *     Customer  <-RESTRICT-  KYCRecord  <-RESTRICT-  RiskRating
 *                                       <-          ScreeningResult (keyed on the KYC record, not the customer)
 *
 * Every one of those is `onDelete: Restrict` by design: a KYC file and its risk rating are the evidence
 * that a customer was checked, and they must not vanish because a test was tidying up. A cleanup that
 * bulldozed them would be teaching the suite to defeat a compliance control.
 *
 * So the numbers are rewritten in memory instead. The file's CONTENT and SHAPE are still what is tested —
 * every column, every defect, the unmapped column — and nothing is written that a later run trips over.
 */
function withUniqueRegistrationNumbers(csv: string, id: string): string {
  // Only the walkthrough's own `REG-WALK-####` placeholders. The duplicate row's number belongs to the
  // owner's dev database and is deliberately left alone — it has no counterpart here, which is exactly
  // why its outcome is office-dependent and is asserted nowhere in this file.
  return csv.replace(/REG-WALK-(\d+)/g, (_m, n) => `REG-WALK-${n}-${id}`);
}

describe('the walkthrough import files (e2e) — each bad row carries the defect the document names', () => {
  afterAll(async () => {
    await sharedApp?.close();
    sharedApp = undefined;
  });

  it('each row behaves as the walkthrough says — including the three that surprised me', async () => {
    const app = await boot();
    const admin = await makeUser(
      'walkthrough-bad',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );

    const csv = withUniqueRegistrationNumbers(
      readFileSync(join(WALKTHROUGH, 'import-with-known-defects.csv'), 'utf8'),
      runId(),
    );
    const res = await request(app.getHttpServer())
      .post('/imports/customers')
      .set(bearer(admin.accessToken))
      .field('mapping', MAPPING)
      .attach('file', Buffer.from(csv, 'utf8'), 'import-with-known-defects.csv')
      .expect(201);

    const body = res.body as { batchId: string };
    const report = await request(app.getHttpServer())
      .get(`/imports/customers/batches/${body.batchId}`)
      .set(bearer(admin.accessToken))
      .expect(200);
    const batch = report.body as { issues: IssueView[] };
    const at = (line: number) =>
      batch.issues.find((i) => i.lineNumber === line);

    // The file has SIX data rows and each one is here for a different reason. Three of the six behave in
    // a way I did NOT predict, and every one of those was found by running this spec rather than by
    // reading the validator — which is the whole argument for the spec existing.

    // LINE 2 — a company with NO registration number. REFUSED. The measured hole the import's DTO
    // validation closed: it used to import cleanly and the new unique index then tolerated it as unkeyed.
    expect(at(2), 'line 2 should be reported').toBeDefined();
    expect(at(2)!.kind).toBe('BAD_DATA');
    expect(at(2)!.detail).toContain('registrationNumber');

    // LINE 3 — a PERSON whose nationality is "Jordan" rather than "JO". REFUSED, with the ISO rule's own
    // words. This is a rule the import could not reach at all before it validated against the intake
    // DTO: the hand-rolled check knew about two fields and the DTO knows about a dozen.
    expect(at(3), 'line 3 should be reported').toBeDefined();
    expect(at(3)!.kind).toBe('BAD_DATA');
    expect(at(3)!.detail).toContain('ISO 3166-1');

    // LINE 4 — a company carrying NATIONALITY, which is a person's field. **IGNORED, not refused.**
    //
    // I expected a refusal, because sending `nationality` on a CORPORATE body to `POST /customers` IS
    // refused by `CustomerTypeFieldCoherence`. The import never reaches that rule: `legacyRowAsDto`
    // builds a corporate DTO from the corporate fields only, so the value is DROPPED before validation
    // rather than rejected by it. Defensible — the import's mapping decides which columns reach the DTO
    // — but it IS an asymmetry with the single-customer route.
    expect(at(4), 'line 4 is IGNORED, not refused').toBeUndefined();

    // LINE 5 — a malformed EMAIL. **IMPORTED.** `contactEmail` is in
    // `LEGACY_IMPORT_UNVALIDATABLE_FIELDS`, so the import does not check it and `not-an-email` lands in
    // the customer record. Also not what I expected, and a narrower gap than it looks: the single
    // customer route DOES validate the email, so the import is the one way a malformed address gets in.
    expect(
      at(5),
      'line 5 is IMPORTED — the email is not validated',
    ).toBeUndefined();

    // LINE 6 — a DUPLICATE registration number. Asserted NOWHERE in this file, deliberately: it
    // collides with a number that exists in the owner's dev database and not in db-test, so its outcome
    // is office-dependent — which is what a duplicate IS. The mechanism is proven by
    // `legacy-import-report.e2e-spec.ts`, which creates its own collision.

    // LINE 7 — the GOOD row. The positive witness: without it every assertion above would pass on an
    // import that refused the whole file.
    expect(at(7), 'line 7 is valid and must NOT be reported').toBeUndefined();

    // The UNMAPPED column (`Legacy Ref`) is IGNORED, not refused — the mapping decides what is read.
    // Asserted because the walkthrough says so, and "ignored" is a claim as much as "refused" is.
    expect(
      batch.issues.some((i) => i.detail.includes('Legacy Ref')),
      'an unmapped column must be ignored, never reported',
    ).toBe(false);
  });

  it('imports the all-valid file with nothing reported', async () => {
    const app = await boot();
    const admin = await makeUser(
      'walkthrough-good',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );
    const csv = withUniqueRegistrationNumbers(
      readFileSync(join(WALKTHROUGH, 'import-all-valid.csv'), 'utf8'),
      runId(),
    );
    const res = await request(app.getHttpServer())
      .post('/imports/customers')
      .set(bearer(admin.accessToken))
      .field('mapping', MAPPING)
      .attach('file', Buffer.from(csv, 'utf8'), 'import-all-valid.csv')
      .expect(201);

    const body = res.body as {
      batchId: string;
      imported: number;
      rejected: number;
      refusedDuplicates: number;
    };
    expect(body.imported).toBe(3);
    expect(body.rejected).toBe(0);
    expect(body.refusedDuplicates).toBe(0);

    const report = await request(app.getHttpServer())
      .get(`/imports/customers/batches/${body.batchId}`)
      .set(bearer(admin.accessToken))
      .expect(200);
    expect((report.body as { issues: IssueView[] }).issues).toEqual([]);
  });
});
