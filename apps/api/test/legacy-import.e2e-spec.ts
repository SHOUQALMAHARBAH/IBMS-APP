import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { ensureRole, prisma } from './tenant-prisma';
import { type RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';

const PASSWORD = 'Correct-Horse-Battery-Staple-9';

function uniqueLabel(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function uniqueEmail(label: string): string {
  return `${uniqueLabel(label)}@ibms.test`;
}
function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}
function secretFromOtpAuthUri(uri: string): string {
  const match = /[?&]secret=([^&]+)/.exec(uri);
  if (!match) throw new Error('No secret in otpauth URI');
  return match[1];
}

interface ImportBody {
  fileName: string;
  totalDataRows: number;
  imported: number;
  rejected: number;
  screened: number;
  screeningFlagged: number;
  rejections: { lineNumber: number; reason: string }[];
  failures: { lineNumber: number; reason: string }[];
}

let sharedApp: INestApplication<App> | undefined;
async function boot(): Promise<INestApplication<App>> {
  if (!sharedApp) sharedApp = await createTestApp();
  return sharedApp;
}

async function makeUser(
  app: INestApplication<App>,
  label: string,
  ...roles: RoleName[]
): Promise<{ accessToken: string; userId: string }> {
  const email = uniqueEmail(label);
  await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: 'Legacy Import E2E', email, password: PASSWORD })
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

/**
 * Part III §7 — the legacy customer bulk import.
 *
 * The whole point of this endpoint is that a back-book loaded from a
 * spreadsheet is NEVER mistaken for customers who passed this system's own
 * KYC. That is what most of these assertions are about.
 */
describe('Legacy customer bulk import (e2e) — spec Part III §7', () => {
  afterAll(async () => {
    await sharedApp?.close();
    sharedApp = undefined;
  });

  it('imports a mapped file, marks every row LEGACY_IMPORT and un-approved, and screens each one', async () => {
    const app = await boot();
    const admin = await makeUser(
      app,
      'import-admin',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );

    const acme = uniqueLabel('Acme Trading');
    const ahmad = uniqueLabel('Ahmad Ali');
    const csv = [
      'Client Name,Kind,Country,Email',
      `${acme},CORPORATE,,ops@acme.test`,
      `${ahmad},individual,JO,`,
    ].join('\n');

    const res = await request(app.getHttpServer())
      .post('/imports/customers')
      .set(bearer(admin.accessToken))
      .field(
        'mapping',
        JSON.stringify({
          legalName: 'Client Name',
          customerType: 'Kind',
          nationality: 'Country',
          contactEmail: 'Email',
        }),
      )
      .attach('file', Buffer.from(csv, 'utf8'), 'legacy-book.csv')
      .expect(201);

    const body = res.body as ImportBody;
    expect(body.fileName).toBe('legacy-book.csv');
    expect(body.imported).toBe(2);
    expect(body.rejected).toBe(0);
    expect(body.screened).toBe(2);

    // §7.3 — the reason this endpoint is allowed to exist at all.
    const rows = await prisma.customer.findMany({
      where: { legalName: { in: [acme, ahmad] } },
    });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.source).toBe('LEGACY_IMPORT');
      // Never approved, and never even implicitly in progress.
      expect(row.status).toBe('PENDING_KYC');
      const kyc = await prisma.kYCRecord.findFirst({
        where: { customerId: row.id },
      });
      expect(kyc?.status).toBe('DRAFT');
    }

    // Screening actually ran against each imported file — §7.2. Asserted via
    // the ScreeningResult rows, not the response counter, so a counter that
    // incremented without screening anything would not pass.
    for (const row of rows) {
      const kyc = await prisma.kYCRecord.findFirstOrThrow({
        where: { customerId: row.id },
      });
      const results = await prisma.screeningResult.findMany({
        where: { kycRecordId: kyc.id },
      });
      expect(results.length).toBeGreaterThan(0);
    }

    // §7.4 — one audit row for the batch, carrying counts and never content.
    const audit = await prisma.auditLogEntry.findFirst({
      where: { entityType: 'LegacyCustomerImport' },
      orderBy: { occurredAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit?.afterValue)).toContain('legacy-book.csv');
    // The file's personal data must not be in the audit row.
    expect(JSON.stringify(audit?.afterValue)).not.toContain(acme);

    // A contact email supplied in the file is encrypted at rest like any
    // other, not stored raw because it arrived in bulk.
    const acmeRow = rows.find((r) => r.legalName === acme);
    expect(acmeRow?.contactEmailEnc).toBeTruthy();
    expect(acmeRow?.contactEmailEnc).not.toContain('ops@acme.test');
  });

  it('imports the good rows and names the bad ones, rather than failing the batch', async () => {
    const app = await boot();
    const admin = await makeUser(
      app,
      'import-partial',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );
    const good = uniqueLabel('Good Co');
    const csv = [
      'Client Name,Kind',
      `${good},CORPORATE`,
      ',CORPORATE',
      'Bad Kind,PARTNERSHIP',
    ].join('\n');

    const res = await request(app.getHttpServer())
      .post('/imports/customers')
      .set(bearer(admin.accessToken))
      .field(
        'mapping',
        JSON.stringify({ legalName: 'Client Name', customerType: 'Kind' }),
      )
      .attach('file', Buffer.from(csv, 'utf8'), 'partial.csv')
      .expect(201);

    const body = res.body as ImportBody;
    expect(body.imported).toBe(1);
    expect(body.rejected).toBe(2);
    expect(body.rejections.map((r) => r.lineNumber)).toEqual([3, 4]);
    expect(await prisma.customer.count({ where: { legalName: good } })).toBe(1);
  });

  it('refuses a mapping naming an unknown field or a column the file lacks', async () => {
    const app = await boot();
    const admin = await makeUser(
      app,
      'import-badmap',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );
    const csv = 'Client Name,Kind\nAcme,CORPORATE';

    await request(app.getHttpServer())
      .post('/imports/customers')
      .set(bearer(admin.accessToken))
      .field(
        'mapping',
        JSON.stringify({
          legalName: 'Client Name',
          customerType: 'Kind',
          favouriteColour: 'Kind',
        }),
      )
      .attach('file', Buffer.from(csv, 'utf8'), 'x.csv')
      .expect(422);

    await request(app.getHttpServer())
      .post('/imports/customers')
      .set(bearer(admin.accessToken))
      .field(
        'mapping',
        JSON.stringify({ legalName: 'Nope', customerType: 'Kind' }),
      )
      .attach('file', Buffer.from(csv, 'utf8'), 'x.csv')
      .expect(422);
  });

  it('refuses a request with no file at all', async () => {
    const app = await boot();
    const admin = await makeUser(
      app,
      'import-nofile',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );
    await request(app.getHttpServer())
      .post('/imports/customers')
      .set(bearer(admin.accessToken))
      .field(
        'mapping',
        JSON.stringify({ legalName: 'Client Name', customerType: 'Kind' }),
      )
      .expect(422);
  });

  it('is gated behind customer.bulk-import, which customer.create does not imply', async () => {
    const app = await boot();
    // A Sales Officer holds customer.create and creates customers all day.
    // Loading an office's entire back-book is a different act, and this is the
    // assertion that keeps the two from being conflated.
    const sales = await makeUser(
      app,
      'import-sales',
      'SALES_RELATIONSHIP_OFFICER',
    );
    await request(app.getHttpServer())
      .post('/imports/customers')
      .set(bearer(sales.accessToken))
      .field(
        'mapping',
        JSON.stringify({ legalName: 'Client Name', customerType: 'Kind' }),
      )
      .attach(
        'file',
        Buffer.from('Client Name,Kind\nAcme,CORPORATE', 'utf8'),
        'x.csv',
      )
      .expect(403);

    const me = (
      await request(app.getHttpServer())
        .get('/auth/me')
        .set(bearer(sales.accessToken))
        .expect(200)
    ).body as { permissions: string[] };
    expect(me.permissions).toContain('customer.create');
    expect(me.permissions).not.toContain('customer.bulk-import');
  });
});
