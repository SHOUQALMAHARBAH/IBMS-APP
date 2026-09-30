import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { ensureRole, prisma } from './tenant-prisma';
import type { RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';

/**
 * "WHAT DID THIS PERSON DO" — the question an audit trail is read for.
 *
 * The API has accepted a `userId` filter since the module was built, and the screen offered no control
 * for it: a reader could filter by `entityType` and a raw `entityId` and nothing else. Nobody knows a
 * uuid, so the filter existed and was unusable — the same defect as a form asking for an id whose source
 * screen was never built.
 *
 * The load-bearing test here is the permission one. `audit-log.read` is held by COMPLIANCE,
 * EXTERNAL_AUDITOR and the two administrator roles; `user.manage` by only the administrators. Sourcing
 * the actor picker from `GET /admin/users` would have 403'd for the compliance officer and the external
 * auditor, who are the audit trail's primary readers — so the endpoint is gated by the log's own
 * permission, and this file is what keeps that true.
 */
const PASSWORD = 'Correct-Horse-Battery-Staple-9';
const RUN = Math.random().toString(36).slice(2, 10);

interface IssuedSessionBody {
  accessToken: string;
  user: { id: string };
}
interface MfaEnrollBody {
  credentialId: string;
  otpAuthUri: string;
}
interface ActorBody {
  id: string;
  fullName: string;
}
interface AuditRow {
  id: string;
  userId: string;
  actorName: string | null;
  entityType: string;
}

const createdUserIds: string[] = [];

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function makeActor(
  app: INestApplication<App>,
  fullName: string,
  role: RoleName,
): Promise<{ accessToken: string; userId: string }> {
  const email = `actor-${RUN}-${Math.random().toString(36).slice(2)}@ibms.test`;
  await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ fullName, email, password: PASSWORD })
    .expect(201);
  const login = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const { accessToken, user } = login.body as IssuedSessionBody;

  const enroll = await request(app.getHttpServer())
    .post('/auth/mfa/totp/enroll')
    .set(bearer(accessToken))
    .expect(201);
  const eb = enroll.body as MfaEnrollBody;
  const secret = /[?&]secret=([^&]+)/.exec(eb.otpAuthUri)![1];
  await request(app.getHttpServer())
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(accessToken))
    .send({
      credentialId: eb.credentialId,
      code: authenticator.generate(secret),
    })
    .expect(200);

  const resolved = await ensureRole(role);
  await prisma.userRoleAssignment.create({
    data: { userId: user.id, roleId: resolved.id },
  });
  createdUserIds.push(user.id);
  return { accessToken, userId: user.id };
}

let app: INestApplication<App>;
/** The compliance officer: holds `audit-log.read`, holds NO user-administration permission. */
let compliance: { accessToken: string; userId: string };
const COMPLIANCE_NAME = `Zzcompliance ${RUN}`;

describe('the audit trail can be asked about a PERSON (e2e)', () => {
  beforeAll(async () => {
    app = await createTestApp();
    compliance = await makeActor(app, COMPLIANCE_NAME, 'COMPLIANCE_OFFICER');
    // One browse, so this person definitely appears as an actor: the browse records its own READ.
    await request(app.getHttpServer())
      .get('/audit-trail')
      .set(bearer(compliance.accessToken))
      .expect(200);
  }, 300_000);

  afterAll(async () => {
    await app?.close();
  });

  it('lets a COMPLIANCE officer — who cannot list users — search actors by name', async () => {
    // The property the endpoint exists for. If this ever 403s, the actor picker is unusable by the
    // people who read the audit trail, and the screen is back to asking for a uuid.
    const res = await request(app.getHttpServer())
      .get(
        `/audit-trail/actors?search=${encodeURIComponent(`Zzcompliance ${RUN}`)}`,
      )
      .set(bearer(compliance.accessToken))
      .expect(200);
    const actors = res.body as ActorBody[];
    expect(actors.map((a) => a.fullName)).toContain(COMPLIANCE_NAME);
    // Identifiers and a name. No email, no roles: this backs a filter control, and an email beside every
    // actor would hand a read-only external auditor a contact list.
    for (const actor of actors) {
      expect(Object.keys(actor).sort()).toEqual(['fullName', 'id']);
    }

    // And the same account is refused the admin user list, which is what makes the separate endpoint
    // necessary rather than tidy.
    await request(app.getHttpServer())
      .get('/admin/users')
      .set(bearer(compliance.accessToken))
      .expect(403);
  });

  it('refuses the actor search to someone who cannot read the audit log', async () => {
    const sales = await makeActor(
      app,
      `Sales ${RUN}`,
      'SALES_RELATIONSHIP_OFFICER',
    );
    await request(app.getHttpServer())
      .get('/audit-trail/actors')
      .set(bearer(sales.accessToken))
      .expect(403);
  });

  it('returns only people who actually appear in the log', async () => {
    // Created directly, never through the API: no request was made on this account's behalf, so no
    // audit row can name it. A picker listing people who have done nothing would be a staff directory
    // wearing a filter control's clothes.
    const org = await prisma.organization.findFirstOrThrow({
      orderBy: { id: 'asc' },
    });
    const silent = await prisma.user.create({
      data: {
        organizationId: org.id,
        fullName: `Zzsilent ${RUN}`,
        email: `silent-${RUN}@ibms.test`,
        passwordHash: 'not-a-real-hash',
      },
      select: { id: true, fullName: true },
    });
    createdUserIds.push(silent.id);

    const auditRowsForSilent = await prisma.auditLogEntry.count({
      where: { userId: silent.id },
    });
    expect(auditRowsForSilent, 'the fixture must have no audit rows').toBe(0);

    const res = await request(app.getHttpServer())
      .get(`/audit-trail/actors?search=Zzsilent ${RUN}`)
      .set(bearer(compliance.accessToken))
      .expect(200);
    expect(res.body).toEqual([]);

    // The positive half, so "returns []" cannot pass because the search is broken: the same query shape
    // finds the person who HAS acted.
    const present = await request(app.getHttpServer())
      .get(`/audit-trail/actors?search=Zzcompliance ${RUN}`)
      .set(bearer(compliance.accessToken))
      .expect(200);
    expect((present.body as ActorBody[]).length).toBeGreaterThan(0);
  });

  it('puts the actor NAME on each row, beside the id', async () => {
    const res = await request(app.getHttpServer())
      .get(`/audit-trail?userId=${compliance.userId}`)
      .set(bearer(compliance.accessToken))
      .expect(200);
    const body = res.body as { items: AuditRow[]; total: number };
    expect(
      body.items.length,
      'this actor browsed once in beforeAll',
    ).toBeGreaterThan(0);

    for (const row of body.items) {
      // Every row is this actor's, because that is what was asked for — the filter the screen could not
      // reach until now.
      expect(row.userId).toBe(compliance.userId);
      // And it carries the name, which is what makes the column readable.
      expect(row.actorName).toBe(COMPLIANCE_NAME);
    }
  });

  it('REFUSES to delete an actor who has audit rows, which is why a name can always be resolved', async () => {
    // The first draft of this test tried to CREATE an unresolvable actor — write an audit row, delete the
    // account, read the row back and expect a null name. The delete was refused, which is the finding:
    // `AuditLogEntry_userId_fkey` is ON DELETE RESTRICT and `userId` is NOT NULL, so the state the
    // nullable type allows for cannot be reached. The honest test is the invariant itself — and it is the
    // reason the screen can promise a name rather than a uuid.
    const org = await prisma.organization.findFirstOrThrow({
      orderBy: { id: 'asc' },
    });
    const ghost = await prisma.user.create({
      data: {
        organizationId: org.id,
        fullName: `Zzghost ${RUN}`,
        email: `ghost-${RUN}@ibms.test`,
        passwordHash: 'not-a-real-hash',
      },
      select: { id: true },
    });
    const row = await prisma.auditLogEntry.create({
      data: {
        organizationId: org.id,
        userId: ghost.id,
        action: 'READ',
        entityType: `GhostEntity${RUN}`,
        entityId: 'ghost-1',
        isSensitiveDataAccess: false,
      },
      select: { id: true },
    });
    // The database refuses, and that refusal is the guarantee.
    await expect(
      prisma.user.delete({ where: { id: ghost.id } }),
    ).rejects.toThrow();

    // And the row reads back WITH a name, because the actor still exists.
    const res = await request(app.getHttpServer())
      .get(`/audit-trail?entityType=GhostEntity${RUN}`)
      .set(bearer(compliance.accessToken))
      .expect(200);
    const body = res.body as { items: AuditRow[] };
    const found = body.items.find((r) => r.id === row.id);
    expect(found, 'the planted row must be readable').toBeDefined();
    expect(found?.actorName).toBe(`Zzghost ${RUN}`);
    createdUserIds.push(ghost.id);
  });
});
