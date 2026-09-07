import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { prisma, type RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';

const PASSWORD = 'Correct-Horse-Battery-Staple-9';

function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@ibms.test`;
}
function uniqueLabel(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
/** Part F item #4 — an Employee's `fullName` is now computed server-side
 * from 4 national-ID-convention parts, not accepted directly. Splits a
 * single display-name string on the first space into givenName/familyName
 * — none of this file's assertions depend on the exact resulting string. */
function splitName(name: string): { givenName: string; familyName: string } {
  const [givenName, ...rest] = name.split(' ');
  return { givenName, familyName: rest.join(' ') || givenName };
}
function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}
function secretFromOtpAuthUri(uri: string): string {
  const match = /[?&]secret=([^&]+)/.exec(uri);
  if (!match) throw new Error('No secret in otpauth URI');
  return match[1];
}

interface IssuedSessionBody {
  accessToken: string;
  user: { id: string };
}
interface MfaEnrollBody {
  credentialId: string;
  otpAuthUri: string;
}
interface EmployeeDetailBody {
  id: string;
  nationalId: string;
  trainings: { id: string; completedAt: string | null }[];
  deprovisioningChecklist: {
    id: string;
    systemAccessRevokedAt: string | null;
    physicalAccessRevokedAt: string | null;
    deviceReturnedAt: string | null;
    knowledgeTransferDoneAt: string | null;
    completedAt: string | null;
  } | null;
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
    .send({ fullName: 'Employee E2E User', email, password: PASSWORD })
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
  const enrollBody = enroll.body as MfaEnrollBody;
  await request(app.getHttpServer())
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(accessToken))
    .send({
      credentialId: enrollBody.credentialId,
      code: authenticator.generate(secretFromOtpAuthUri(enrollBody.otpAuthUri)),
    })
    .expect(200);

  for (const roleName of roles) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });
    await prisma.userRoleAssignment.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: { revokedAt: null },
      create: { userId: user.id, roleId: role.id },
    });
  }
  return { accessToken, userId: user.id };
}

describe('Human Resources (e2e) — backlog Part C #66', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  // Part F item #4 — Jordanian national-ID-convention name splitting. An
  // Employee is always a real individual, so all 4 parts always apply.
  it('computes fullName from the 4 Jordanian national-ID-convention name parts', async () => {
    const app = await boot();
    const admin = await makeUser(
      app,
      'hr-admin-name-parts',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );
    const res = await request(app.getHttpServer())
      .post('/employees')
      .set(bearer(admin.accessToken))
      .send({
        givenName: 'Rania',
        fatherName: 'Samir',
        grandfatherName: 'Fouad',
        familyName: 'Hijazi',
        nationalId: '9911223344',
        hireDate: '2022-03-01',
      })
      .expect(201);
    const employee = res.body as EmployeeDetailBody & {
      fullName: string;
      givenName: string;
      fatherName: string;
      grandfatherName: string;
      familyName: string;
    };
    expect(employee.fullName).toBe('Rania Samir Fouad Hijazi');
    expect(employee.givenName).toBe('Rania');
    expect(employee.fatherName).toBe('Samir');
    expect(employee.grandfatherName).toBe('Fouad');
    expect(employee.familyName).toBe('Hijazi');
  });

  it("omits father's/grandfather's name from the computed fullName when they are not supplied", async () => {
    const app = await boot();
    const admin = await makeUser(
      app,
      'hr-admin-name-parts-min',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );
    const res = await request(app.getHttpServer())
      .post('/employees')
      .set(bearer(admin.accessToken))
      .send({
        givenName: 'Tariq',
        familyName: 'Odeh',
        nationalId: '9922334455',
        hireDate: '2022-03-01',
      })
      .expect(201);
    const employee = res.body as { fullName: string };
    expect(employee.fullName).toBe('Tariq Odeh');
  });

  it('rejects a create with no familyName (required, not just givenName)', async () => {
    const app = await boot();
    const admin = await makeUser(
      app,
      'hr-admin-name-parts-invalid',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );
    await request(app.getHttpServer())
      .post('/employees')
      .set(bearer(admin.accessToken))
      .send({
        givenName: 'NoFamilyName',
        nationalId: '9933445566',
        hireDate: '2022-03-01',
      })
      .expect(400);
  });

  it('gates create behind employee.manage and terminate behind deprovisioning.execute', async () => {
    const app = await boot();
    const outsider = await makeUser(
      app,
      'hr-outsider',
      'SALES_RELATIONSHIP_OFFICER',
    );
    await request(app.getHttpServer())
      .post('/employees')
      .set(bearer(outsider.accessToken))
      .send({
        ...splitName('Nobody'),
        nationalId: '1111111111',
        hireDate: '2024-01-01',
      })
      .expect(403);

    // A Manager holds employee.manage but NOT deprovisioning.execute —
    // termination sits behind the narrower ADMIN-only permission.
    const manager = await makeUser(
      app,
      'hr-manager',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    const created = (
      await request(app.getHttpServer())
        .post('/employees')
        .set(bearer(manager.accessToken))
        .send({
          ...splitName(uniqueLabel('Perm Test Employee')),
          nationalId: '2222222222',
          hireDate: '2024-01-01',
        })
        .expect(201)
    ).body as EmployeeDetailBody;
    await request(app.getHttpServer())
      .post(`/employees/${created.id}/terminate`)
      .set(bearer(manager.accessToken))
      .expect(403);
  });

  it('walks the full lifecycle: create -> reveal -> train -> terminate -> de-provision -> complete', async () => {
    const app = await boot();
    const admin = await makeUser(
      app,
      'hr-admin',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );

    // A real linked User account, to prove system-access revocation has a
    // genuine effect (deactivation + session kill), not just a timestamp.
    const linkedUser = await makeUser(app, 'hr-linked');

    const created = (
      await request(app.getHttpServer())
        .post('/employees')
        .set(bearer(admin.accessToken))
        .send({
          ...splitName(uniqueLabel('Jane Employee')),
          nationalId: '9988776655',
          hireDate: '2020-06-01',
          position: 'Placement Officer',
          licensedRole: 'CBJ-licensed Broker Representative',
          userId: linkedUser.userId,
        })
        .expect(201)
    ).body as EmployeeDetailBody;
    expect(created.nationalId).not.toBe('9988776655'); // masked, not raw

    const linkedDbUser = await prisma.user.findUnique({
      where: { id: linkedUser.userId },
    });
    expect(linkedDbUser?.employeeId).toBe(created.id);

    // Reveal — a real justification returns the true plaintext.
    const revealed = (
      await request(app.getHttpServer())
        .post(`/employees/${created.id}/reveal-field`)
        .set(bearer(admin.accessToken))
        .send({
          field: 'nationalId',
          reason: 'KYC audit cross-check requested by Compliance',
        })
        .expect(201)
    ).body as { field: string; value: string };
    expect(revealed.value).toBe('9988776655');

    // Training: assign, then complete.
    const training = (
      await request(app.getHttpServer())
        .post(`/employees/${created.id}/trainings`)
        .set(bearer(admin.accessToken))
        .send({ trainingName: 'Phishing awareness 2026' })
        .expect(201)
    ).body as { id: string };
    await request(app.getHttpServer())
      .patch(`/employees/${created.id}/trainings/${training.id}/complete`)
      .set(bearer(admin.accessToken))
      .expect(200);
    // A second completion is a 409 (race-safe-invariants.md).
    await request(app.getHttpServer())
      .patch(`/employees/${created.id}/trainings/${training.id}/complete`)
      .set(bearer(admin.accessToken))
      .expect(409);

    // Terminate — opens the checklist and starts the SLA timer.
    const checklist = (
      await request(app.getHttpServer())
        .post(`/employees/${created.id}/terminate`)
        .set(bearer(admin.accessToken))
        .expect(201)
    ).body as EmployeeDetailBody['deprovisioningChecklist'];
    expect(checklist).not.toBeNull();

    const slaTimer = await prisma.slaTimer.findFirst({
      where: {
        entityType: 'AccessDeprovisioningChecklist',
        entityId: checklist!.id,
        workflowName: 'termination_access_revocation',
      },
    });
    expect(slaTimer).not.toBeNull();
    expect(slaTimer?.escalatedTo).toBe('IT_MANAGEMENT');

    // A second termination attempt is a 409.
    await request(app.getHttpServer())
      .post(`/employees/${created.id}/terminate`)
      .set(bearer(admin.accessToken))
      .expect(409);

    // Completing the checklist before every sub-item is done is a 400.
    await request(app.getHttpServer())
      .post(`/employees/${created.id}/deprovisioning-checklist/complete`)
      .set(bearer(admin.accessToken))
      .expect(400);

    // Ticking systemAccessRevoked has a REAL effect: the linked user is
    // deactivated and their session is killed.
    await request(app.getHttpServer())
      .patch(`/employees/${created.id}/deprovisioning-checklist`)
      .set(bearer(admin.accessToken))
      .send({ systemAccessRevoked: true })
      .expect(200);
    const deactivatedUser = await prisma.user.findUnique({
      where: { id: linkedUser.userId },
    });
    expect(deactivatedUser?.isActive).toBe(false);
    // The linked user's own session is now revoked — a call with their old
    // access token fails.
    await request(app.getHttpServer())
      .get('/auth/me')
      .set(bearer(linkedUser.accessToken))
      .expect(401);

    // Tick the remaining three items, then complete.
    await request(app.getHttpServer())
      .patch(`/employees/${created.id}/deprovisioning-checklist`)
      .set(bearer(admin.accessToken))
      .send({
        physicalAccessRevoked: true,
        deviceReturned: true,
        knowledgeTransferDone: true,
      })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/employees/${created.id}/deprovisioning-checklist/complete`)
      .set(bearer(admin.accessToken))
      .expect(201);

    const resolvedTimer = await prisma.slaTimer.findUnique({
      where: { id: slaTimer!.id },
    });
    expect(resolvedTimer?.resolvedAt).not.toBeNull();

    // The full detail view now shows everything.
    const detail = (
      await request(app.getHttpServer())
        .get(`/employees/${created.id}`)
        .set(bearer(admin.accessToken))
        .expect(200)
    ).body as EmployeeDetailBody;
    expect(detail.trainings).toHaveLength(1);
    expect(detail.trainings[0].completedAt).not.toBeNull();
    expect(detail.deprovisioningChecklist?.completedAt).not.toBeNull();
  });

  it('rejects linking a userId that is already linked to another employee', async () => {
    const app = await boot();
    const admin = await makeUser(
      app,
      'hr-admin2',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );
    const target = await makeUser(app, 'hr-target');

    await request(app.getHttpServer())
      .post('/employees')
      .set(bearer(admin.accessToken))
      .send({
        ...splitName(uniqueLabel('First Link')),
        nationalId: '3333333333',
        hireDate: '2024-01-01',
        userId: target.userId,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/employees')
      .set(bearer(admin.accessToken))
      .send({
        ...splitName(uniqueLabel('Second Link')),
        nationalId: '4444444444',
        hireDate: '2024-01-01',
        userId: target.userId,
      })
      .expect(409);
  });
});
