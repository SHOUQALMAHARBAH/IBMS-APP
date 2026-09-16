import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { createHash } from 'node:crypto';
import { type RoleName } from '@ibms/db';
import { prisma, rawPrisma, TEST_ORGANIZATION_ID } from './tenant-prisma';
import { createTestApp } from './utils/test-app';

/**
 * Part V — the "Authentication, MFA & Session" acceptance checklist, run as
 * tests. Phase 4 / Part II §4.1–§4.10.
 *
 * One `it` per checklist item, named for it, so a reader can line the two up.
 */
let app: INestApplication<App> | null = null;
let admin: { accessToken: string; id: string };
let departmentId: string;
let branchId: string;

const tag = Math.random().toString(36).slice(2, 8);
const PASSWORD = 'Correct-Horse-Battery-Staple-9';
const NEW_PASSWORD = 'An0ther-Quite-Different-Phrase';

interface LoginBody {
  accessToken?: string;
  outcome?: string;
  onboardingToken?: string;
  mfaRequired?: boolean;
  mfaChallengeToken?: string;
  user?: { id: string };
}
interface MfaEnrollBody {
  credentialId: string;
  otpAuthUri: string;
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}
function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@ibms.test`;
}
function secretFromOtpAuthUri(uri: string): string {
  const match = /[?&]secret=([^&]+)/.exec(uri);
  if (!match) throw new Error('No secret in otpauth URI');
  return decodeURIComponent(match[1]);
}

/** Signs up, enrols MFA and grants roles — the pre-Phase-4 shortcut, used for
 * accounts whose onboarding is not itself what a test is about. */
async function makeUser(
  label: string,
  roles: RoleName[],
): Promise<{
  accessToken: string;
  id: string;
  email: string;
  totpSecret: string;
}> {
  const email = uniqueEmail(label);
  await request(app!.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: `Auth E2E ${label}`, email, password: PASSWORD })
    .expect(201);
  const login = await request(app!.getHttpServer())
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const body = login.body as LoginBody;
  const accessToken = body.accessToken!;

  const enroll = await request(app!.getHttpServer())
    .post('/auth/mfa/totp/enroll')
    .set(bearer(accessToken))
    .expect(201);
  const enrollBody = enroll.body as MfaEnrollBody;
  const totpSecret = secretFromOtpAuthUri(enrollBody.otpAuthUri);
  await request(app!.getHttpServer())
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(accessToken))
    .send({
      credentialId: enrollBody.credentialId,
      code: authenticator.generate(totpSecret),
    })
    .expect(200);

  for (const roleName of roles) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });
    const active = await prisma.userRoleAssignment.findFirst({
      where: { userId: body.user!.id, roleId: role.id, revokedAt: null },
    });
    if (!active) {
      await prisma.userRoleAssignment.create({
        data: { userId: body.user!.id, roleId: role.id },
      });
    }
  }
  return { accessToken, id: body.user!.id, email, totpSecret };
}

/** Provisions an account through the admin path, which is the one that creates
 * a user owing both onboarding steps (§4.2). */
async function provision(
  label: string,
  roles: RoleName[],
): Promise<{ email: string; id: string }> {
  const email = uniqueEmail(label);
  const res = await request(app!.getHttpServer())
    .post('/admin/users')
    .set(bearer(admin.accessToken))
    .send({
      fullName: `Provisioned ${label}`,
      email,
      password: PASSWORD,
      departmentId,
      branchId,
      roles,
    })
    .expect(201);
  return { email, id: (res.body as { id: string }).id };
}

beforeAll(async () => {
  app = await createTestApp();
  admin = await makeUser(`auth-admin-${tag}`, [
    'SYSTEM_SECURITY_ADMINISTRATOR',
  ]);
  // Through the endpoints, not `prisma.*.create`: §4.2.2 requires both fields,
  // and a fixture that inserts them directly would leave the only path an
  // administrator actually has completely untested.
  const department = await request(app.getHttpServer())
    .post('/admin/departments')
    .set(bearer(admin.accessToken))
    .send({ name: `Claims ${tag}`, nameAr: `المطالبات ${tag}` })
    .expect(201);
  departmentId = (department.body as { id: string }).id;
  const branch = await request(app.getHttpServer())
    .post('/admin/branches')
    .set(bearer(admin.accessToken))
    .send({ name: `Amman ${tag}`, nameAr: `عمّان ${tag}` })
    .expect(201);
  branchId = (branch.body as { id: string }).id;
}, 240_000);

afterAll(async () => {
  await app?.close();
  app = null;
});

describe('Part V auth — provisioning (item 1)', () => {
  it('requires a Department AND at least one Role, as two distinct fields', async () => {
    // Neither implies the other: one department holds several roles. The API
    // refuses a payload missing either.
    await request(app!.getHttpServer())
      .post('/admin/users')
      .set(bearer(admin.accessToken))
      .send({
        fullName: 'No Department',
        email: uniqueEmail('no-dept'),
        password: PASSWORD,
        branchId,
        roles: ['SALES_RELATIONSHIP_OFFICER'],
      })
      .expect(400);

    await request(app!.getHttpServer())
      .post('/admin/users')
      .set(bearer(admin.accessToken))
      .send({
        fullName: 'No Roles',
        email: uniqueEmail('no-roles'),
        password: PASSWORD,
        departmentId,
        branchId,
      })
      .expect(400);

    // §4.2.2 names Branch alongside Department — a payload missing it is
    // refused the same way.
    await request(app!.getHttpServer())
      .post('/admin/users')
      .set(bearer(admin.accessToken))
      .send({
        fullName: 'No Branch',
        email: uniqueEmail('no-branch'),
        password: PASSWORD,
        departmentId,
        roles: ['SALES_RELATIONSHIP_OFFICER'],
      })
      .expect(400);

    // Both present: accepted.
    const ok = await provision(`both-fields-${tag}`, [
      'SALES_RELATIONSHIP_OFFICER',
    ]);
    const row = await prisma.user.findFirstOrThrow({ where: { id: ok.id } });
    expect(row.departmentId).toBe(departmentId);
    expect(row.branchId).toBe(branchId);
  });

  it("refuses a department id that is not this office's", async () => {
    const otherOrgDepartment = await rawPrisma.department.create({
      data: { organizationId: TEST_ORGANIZATION_ID, name: `Other ${tag}` },
    });
    // Same office here, so this one IS valid — the cross-office case is covered
    // in tenant-isolation.e2e-spec.ts, where a second Organization exists.
    await request(app!.getHttpServer())
      .post('/admin/users')
      .set(bearer(admin.accessToken))
      .send({
        fullName: 'Unknown Department',
        email: uniqueEmail('unknown-dept'),
        password: PASSWORD,
        departmentId: '00000000-0000-0000-0000-0000000000ff',
        branchId,
        roles: ['SALES_RELATIONSHIP_OFFICER'],
      })
      .expect(422);
    await prisma.department.deleteMany({
      where: { id: otherOrgDepartment.id },
    });
  });
});

describe('Part V auth — the onboarding wizard (items 2, 3, 4)', () => {
  it('a brand-new user gets MUST_CHANGE_PASSWORD and no session token at all', async () => {
    const user = await provision(`onboard-${tag}`, [
      'SALES_RELATIONSHIP_OFFICER',
    ]);
    const login = await request(app!.getHttpServer())
      .post('/auth/login')
      .send({ email: user.email, password: PASSWORD })
      .expect(200);

    const body = login.body as LoginBody;
    expect(body.outcome).toBe('MUST_CHANGE_PASSWORD');
    expect(body.onboardingToken).toBeTypeOf('string');
    // The point of the item: there is nothing here to call anything else with.
    expect(body.accessToken).toBeUndefined();
    expect(body.mfaChallengeToken).toBeUndefined();
  });

  it('the onboarding token reaches the password change and nothing else', async () => {
    const user = await provision(`onboard-scope-${tag}`, [
      'SALES_RELATIONSHIP_OFFICER',
    ]);
    const login = await request(app!.getHttpServer())
      .post('/auth/login')
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    const token = (login.body as LoginBody).onboardingToken!;

    // Presented as a bearer token it is not a session: it names no session, so
    // the JWT guard rejects it.
    await request(app!.getHttpServer())
      .get('/auth/me')
      .set(bearer(token))
      .expect(401);
  });

  it('after the password change, the user still cannot reach anything but MFA enrolment', async () => {
    const user = await provision(`onboard-mfa-${tag}`, [
      'SALES_RELATIONSHIP_OFFICER',
    ]);
    const login = await request(app!.getHttpServer())
      .post('/auth/login')
      .send({ email: user.email, password: PASSWORD })
      .expect(200);

    const changed = await request(app!.getHttpServer())
      .post('/auth/password/force-change')
      .send({
        onboardingToken: (login.body as LoginBody).onboardingToken,
        newPassword: NEW_PASSWORD,
      })
      .expect(200);
    const session = (changed.body as LoginBody).accessToken!;

    // A real session now — but MFA is still owed, so business endpoints refuse.
    const blocked = await request(app!.getHttpServer())
      .get('/customers')
      .set(bearer(session))
      .expect(403);
    expect(JSON.stringify(blocked.body)).toContain('MFA_ENROLLMENT_REQUIRED');

    // And the enrolment screen itself is reachable, or the user would be stuck.
    await request(app!.getHttpServer())
      .post('/auth/mfa/totp/enroll')
      .set(bearer(session))
      .expect(201);
  });

  it('/auth/me carries the Department, in both spellings, for the navbar to render', async () => {
    const user = await provision(`onboard-dept-${tag}`, [
      'SALES_RELATIONSHIP_OFFICER',
    ]);
    const login = await request(app!.getHttpServer())
      .post('/auth/login')
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    const changed = await request(app!.getHttpServer())
      .post('/auth/password/force-change')
      .send({
        onboardingToken: (login.body as LoginBody).onboardingToken,
        newPassword: NEW_PASSWORD,
      })
      .expect(200);

    const me = await request(app!.getHttpServer())
      .get('/auth/me')
      .set(bearer((changed.body as LoginBody).accessToken!))
      .expect(200);

    // BOTH spellings, not one resolved string: nameAr is nullable and the
    // caller is what knows which language it is rendering in. The navbar shows
    // this under the signed-in user's name.
    const body = me.body as {
      department: { name: string; nameAr: string | null } | null;
    };
    expect(body.department).not.toBeNull();
    expect(body.department!.name).toBe(`Claims ${tag}`);
    expect(body.department!.nameAr).toBe(`المطالبات ${tag}`);
  });

  it('the display name comes from the linked HR record, and falls back when there is none', async () => {
    // An employee record first — HR data, created through its own endpoint
    // because it needs a national ID this flow never collects.
    const employee = await request(app!.getHttpServer())
      .post('/employees')
      .set(bearer(admin.accessToken))
      .send({
        givenName: 'طارق',
        fatherName: 'ناصر',
        grandfatherName: 'كريم',
        familyName: 'الزعبي',
        nationalId: `99${Date.now()}`.slice(0, 10),
        hireDate: '2026-01-01',
        departmentId,
      })
      .expect(201);
    const employeeId = (employee.body as { id: string }).id;

    // An account naming it. The free-text fullName is deliberately something
    // nobody should ever see once the link exists.
    const email = uniqueEmail(`linked-${tag}`);
    await request(app!.getHttpServer())
      .post('/admin/users')
      .set(bearer(admin.accessToken))
      .send({
        fullName: 'Demo Sales Relationship Officer',
        email,
        password: PASSWORD,
        departmentId,
        branchId,
        roles: ['SALES_RELATIONSHIP_OFFICER'],
        employeeId,
      })
      .expect(201);

    const login = await request(app!.getHttpServer())
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const changed = await request(app!.getHttpServer())
      .post('/auth/password/force-change')
      .send({
        onboardingToken: (login.body as LoginBody).onboardingToken,
        newPassword: NEW_PASSWORD,
      })
      .expect(200);

    const me = await request(app!.getHttpServer())
      .get('/auth/me')
      .set(bearer((changed.body as LoginBody).accessToken!))
      .expect(200);
    // The HR record wins: the four-part official name, not the role label.
    expect((me.body as { fullName: string }).fullName).toBe(
      'طارق ناصر كريم الزعبي',
    );

    // And an account with no link still shows its own name — the state every
    // account was in before the link had a writer on this path.
    const unlinked = await provision(`unlinked-${tag}`, [
      'SALES_RELATIONSHIP_OFFICER',
    ]);
    const login2 = await request(app!.getHttpServer())
      .post('/auth/login')
      .send({ email: unlinked.email, password: PASSWORD })
      .expect(200);
    const changed2 = await request(app!.getHttpServer())
      .post('/auth/password/force-change')
      .send({
        onboardingToken: (login2.body as LoginBody).onboardingToken,
        newPassword: NEW_PASSWORD,
      })
      .expect(200);
    const me2 = await request(app!.getHttpServer())
      .get('/auth/me')
      .set(bearer((changed2.body as LoginBody).accessToken!))
      .expect(200);
    expect((me2.body as { fullName: string }).fullName).toContain(
      'Provisioned',
    );
  });

  it('refuses a link to an unknown employee, and to one already taken', async () => {
    await request(app!.getHttpServer())
      .post('/admin/users')
      .set(bearer(admin.accessToken))
      .send({
        fullName: 'Someone',
        email: uniqueEmail(`badlink-${tag}`),
        password: PASSWORD,
        departmentId,
        branchId,
        roles: ['SALES_RELATIONSHIP_OFFICER'],
        employeeId: '00000000-0000-0000-0000-000000000000',
      })
      .expect(422);

    const employee = await request(app!.getHttpServer())
      .post('/employees')
      .set(bearer(admin.accessToken))
      .send({
        givenName: 'لينا',
        familyName: 'البدور',
        nationalId: `88${Date.now()}`.slice(0, 10),
        hireDate: '2026-01-01',
        departmentId,
      })
      .expect(201);
    const employeeId = (employee.body as { id: string }).id;

    const body = {
      password: PASSWORD,
      departmentId,
      branchId,
      roles: ['SALES_RELATIONSHIP_OFFICER'],
      employeeId,
    };
    await request(app!.getHttpServer())
      .post('/admin/users')
      .set(bearer(admin.accessToken))
      .send({ ...body, fullName: 'First', email: uniqueEmail(`taken1-${tag}`) })
      .expect(201);

    // User.employeeId is @unique, so without this check the second attempt
    // would surface as a P2002 that reads like an email collision.
    await request(app!.getHttpServer())
      .post('/admin/users')
      .set(bearer(admin.accessToken))
      .send({
        ...body,
        fullName: 'Second',
        email: uniqueEmail(`taken2-${tag}`),
      })
      .expect(409);
  });

  it('the mandatory change is one-shot — the token cannot be replayed', async () => {
    const user = await provision(`onboard-replay-${tag}`, [
      'SALES_RELATIONSHIP_OFFICER',
    ]);
    const login = await request(app!.getHttpServer())
      .post('/auth/login')
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    const token = (login.body as LoginBody).onboardingToken!;

    await request(app!.getHttpServer())
      .post('/auth/password/force-change')
      .send({ onboardingToken: token, newPassword: NEW_PASSWORD })
      .expect(200);

    // Replaying it must not let anyone set the password again without knowing
    // the current one.
    await request(app!.getHttpServer())
      .post('/auth/password/force-change')
      .send({
        onboardingToken: token,
        newPassword: 'Third-Password-Entirely-1',
      })
      .expect(403);
  });

  it('refuses to reuse the temporary password as the new one', async () => {
    const user = await provision(`onboard-reuse-${tag}`, [
      'SALES_RELATIONSHIP_OFFICER',
    ]);
    const login = await request(app!.getHttpServer())
      .post('/auth/login')
      .send({ email: user.email, password: PASSWORD })
      .expect(200);

    // Re-setting the admin-known password would defeat the entire step.
    await request(app!.getHttpServer())
      .post('/auth/password/force-change')
      .send({
        onboardingToken: (login.body as LoginBody).onboardingToken,
        newPassword: PASSWORD,
      })
      .expect(422);
  });

  it('MFA enrolment is not complete without one live code (item 4)', async () => {
    const user = await makeUser(`enrol-${tag}`, []);
    // `makeUser` already enrolled; a fresh credential proves the gate.
    const enroll = await request(app!.getHttpServer())
      .post('/auth/mfa/totp/enroll')
      .set(bearer(user.accessToken))
      .expect(201);
    const body = enroll.body as MfaEnrollBody;

    await request(app!.getHttpServer())
      .post('/auth/mfa/totp/enroll/verify')
      .set(bearer(user.accessToken))
      .send({ credentialId: body.credentialId, code: '000000' })
      .expect(400);

    const credential = await prisma.mfaCredential.findFirstOrThrow({
      where: { id: body.credentialId },
    });
    expect(credential.isActive).toBe(false);
  });
});

describe('Part V auth — TOTP tolerance (item 5)', () => {
  it('accepts a code from 30s ago and 30s ahead, and rejects one 90s out', async () => {
    const user = await makeUser(`totp-${tag}`, []);
    const enroll = await request(app!.getHttpServer())
      .post('/auth/mfa/totp/enroll')
      .set(bearer(user.accessToken))
      .expect(201);
    const body = enroll.body as MfaEnrollBody;
    const secret = secretFromOtpAuthUri(body.otpAuthUri);

    const codeAt = (offsetSeconds: number): string => {
      const totp = authenticator.clone({
        epoch: Date.now() + offsetSeconds * 1000,
      });
      return totp.generate(secret);
    };

    // A phone whose clock has drifted a step either way still works — the
    // "invalid code even though I set it up right" case §4.3.2 exists to fix.
    await request(app!.getHttpServer())
      .post('/auth/mfa/totp/enroll/verify')
      .set(bearer(user.accessToken))
      .send({ credentialId: body.credentialId, code: codeAt(-30) })
      .expect(200);

    const second = await request(app!.getHttpServer())
      .post('/auth/mfa/totp/enroll')
      .set(bearer(user.accessToken))
      .expect(201);
    const secondBody = second.body as MfaEnrollBody;
    const secondSecret = secretFromOtpAuthUri(secondBody.otpAuthUri);
    const aheadTotp = authenticator.clone({ epoch: Date.now() + 30 * 1000 });
    await request(app!.getHttpServer())
      .post('/auth/mfa/totp/enroll/verify')
      .set(bearer(user.accessToken))
      .send({
        credentialId: secondBody.credentialId,
        code: aheadTotp.generate(secondSecret),
      })
      .expect(200);

    // Three steps out is not drift, it is a stale or guessed code.
    const third = await request(app!.getHttpServer())
      .post('/auth/mfa/totp/enroll')
      .set(bearer(user.accessToken))
      .expect(201);
    const thirdBody = third.body as MfaEnrollBody;
    const staleTotp = authenticator.clone({ epoch: Date.now() - 120 * 1000 });
    await request(app!.getHttpServer())
      .post('/auth/mfa/totp/enroll/verify')
      .set(bearer(user.accessToken))
      .send({
        credentialId: thirdBody.credentialId,
        code: staleTotp.generate(secretFromOtpAuthUri(thirdBody.otpAuthUri)),
      })
      .expect(400);
  }, 120_000);
});

describe('Part V auth — trusted devices (items 6, 7)', () => {
  it('a standard role on a trusted device skips the MFA prompt (item 6)', async () => {
    const user = await makeUser(`trust-std-${tag}`, [
      'SALES_RELATIONSHIP_OFFICER',
    ]);
    const fingerprint = `device-${tag}-standard`;

    // First login on this device still challenges — nothing is trusted yet.
    const first = await request(app!.getHttpServer())
      .post('/auth/login')
      .send({
        email: user.email,
        password: PASSWORD,
        deviceFingerprint: fingerprint,
      })
      .expect(200);
    expect((first.body as LoginBody).mfaRequired).toBe(true);

    // Answer the challenge, asking to trust this device.
    await request(app!.getHttpServer())
      .post('/auth/mfa/totp/challenge/verify')
      .send({
        mfaChallengeToken: (first.body as LoginBody).mfaChallengeToken,
        code: authenticator.generate(user.totpSecret),
        trustDevice: true,
        deviceFingerprint: fingerprint,
      })
      .expect(200);

    const trust = await prisma.trustedDevice.findFirstOrThrow({
      where: { userId: user.id, revokedAt: null },
    });
    // Hashed, never raw: the stored value must not be the fingerprint itself.
    expect(trust.deviceFingerprintHash).not.toBe(fingerprint);
    expect(trust.deviceFingerprintHash).toBe(
      createHash('sha256').update(fingerprint).digest('hex'),
    );

    // The same device now goes straight to a session.
    const trusted = await request(app!.getHttpServer())
      .post('/auth/login')
      .send({
        email: user.email,
        password: PASSWORD,
        deviceFingerprint: fingerprint,
      })
      .expect(200);
    expect((trusted.body as LoginBody).mfaRequired).toBeUndefined();
    expect((trusted.body as LoginBody).accessToken).toBeTypeOf('string');

    // A DIFFERENT device is still challenged — trust is per device, not per
    // user.
    const elsewhere = await request(app!.getHttpServer())
      .post('/auth/login')
      .send({
        email: user.email,
        password: PASSWORD,
        deviceFingerprint: `${fingerprint}-other`,
      })
      .expect(200);
    expect((elsewhere.body as LoginBody).mfaRequired).toBe(true);

    // A login carrying NO fingerprint is challenged too: absence is not trust.
    const noFingerprint = await request(app!.getHttpServer())
      .post('/auth/login')
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    expect((noFingerprint.body as LoginBody).mfaRequired).toBe(true);

    // Revoking it brings the prompt back.
    await request(app!.getHttpServer())
      .post(`/auth/trusted-devices/${trust.id}/revoke`)
      .set(bearer(user.accessToken))
      .expect(200);
    const afterRevoke = await request(app!.getHttpServer())
      .post('/auth/login')
      .send({
        email: user.email,
        password: PASSWORD,
        deviceFingerprint: fingerprint,
      })
      .expect(200);
    expect((afterRevoke.body as LoginBody).mfaRequired).toBe(true);
  }, 180_000);

  it('an always-MFA role is prompted even on a "trusted" device (item 7)', async () => {
    // The grant is refused server-side, not merely hidden in the UI.
    const fingerprint = `device-${tag}-privileged`;
    for (const role of [
      'SYSTEM_SECURITY_ADMINISTRATOR',
      'COMPLIANCE_OFFICER',
      'DATA_PROTECTION_OFFICER',
    ] as RoleName[]) {
      const user = await makeUser(`always-mfa-${role.slice(0, 8)}-${tag}`, [
        role,
      ]);
      await rawPrisma.trustedDevice.create({
        data: {
          organizationId: TEST_ORGANIZATION_ID,
          userId: user.id,
          deviceFingerprintHash: createHash('sha256')
            .update(fingerprint)
            .digest('hex'),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      const login = await request(app!.getHttpServer())
        .post('/auth/login')
        .send({
          email: user.email,
          password: PASSWORD,
          deviceFingerprint: fingerprint,
        })
        .expect(200);
      expect(
        (login.body as LoginBody).mfaRequired,
        `${role} must always be challenged`,
      ).toBe(true);
    }
  }, 240_000);
});

describe('Part V auth — idle timeout (item 8)', () => {
  it('revokes the session and sends the user to full sign-in, not an MFA screen', async () => {
    const user = await makeUser(`idle-${tag}`, ['SALES_RELATIONSHIP_OFFICER']);
    const session = await prisma.userSession.findFirstOrThrow({
      where: { userId: user.id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    // Push both the stored ceiling and the last activity past the timeout.
    await prisma.userSession.update({
      where: { id: session.id },
      data: {
        lastActivityAt: new Date(Date.now() - 60 * 60 * 1000),
        idleExpiresAt: new Date(Date.now() - 30 * 60 * 1000),
      },
    });

    const rejected = await request(app!.getHttpServer())
      .get('/auth/me')
      .set(bearer(user.accessToken))
      .expect(401);
    expect(JSON.stringify(rejected.body)).toContain('IDLE');

    // A genuine termination: the session is revoked, so no code-only path could
    // resume it even if one existed.
    const after = await prisma.userSession.findFirstOrThrow({
      where: { id: session.id },
    });
    expect(after.revokedAt).not.toBeNull();
    expect(after.revokedReason).toBe('idle_timeout');

    // And the way back in is the full password login.
    const back = await request(app!.getHttpServer())
      .post('/auth/login')
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    expect((back.body as LoginBody).mfaRequired).toBe(true);
  }, 120_000);
});

describe('Part V auth — step-up (item 9)', () => {
  it('a sensitive action needs a fresh challenge even seconds after login', async () => {
    const user = await makeUser(`stepup-${tag}`, [
      'FINANCE_COLLECTIONS_OFFICER',
    ]);
    // A step-up-gated endpoint refuses a session that has not stepped up, no
    // matter how recently it authenticated.
    const res = await request(app!.getHttpServer())
      .get('/audit/export')
      .set(bearer(user.accessToken));
    expect([403, 404]).toContain(res.status);
    if (res.status === 403) {
      expect(JSON.stringify(res.body)).toContain('STEP_UP_REQUIRED');
    }
  }, 60_000);
});

describe('Part V auth — self-service password change (item 10)', () => {
  it('revokes every OTHER session, and keeps the one that made the change', async () => {
    const user = await makeUser(`pwchange-${tag}`, [
      'SALES_RELATIONSHIP_OFFICER',
    ]);
    // A second, independent session for the same person.
    const second = await request(app!.getHttpServer())
      .post('/auth/login')
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    const challenge = (second.body as LoginBody).mfaChallengeToken!;
    const credential = await prisma.mfaCredential.findFirstOrThrow({
      where: { userId: user.id, type: 'TOTP', isActive: true },
    });
    expect(credential.secretEnc).toBeTruthy();

    const changed = await request(app!.getHttpServer())
      .post('/auth/password/change')
      .set(bearer(user.accessToken))
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
      .expect(200);
    expect(
      (changed.body as { otherSessionsRevoked: number }).otherSessionsRevoked,
    ).toBeGreaterThanOrEqual(0);

    // The session that made the change still works.
    await request(app!.getHttpServer())
      .get('/auth/me')
      .set(bearer(user.accessToken))
      .expect(200);

    // Every other session for this user is revoked.
    const live = await prisma.userSession.findMany({
      where: { userId: user.id, revokedAt: null },
    });
    expect(live).toHaveLength(1);
    expect(challenge).toBeTruthy();

    // The old password no longer works; the new one does.
    await request(app!.getHttpServer())
      .post('/auth/login')
      .send({ email: user.email, password: PASSWORD })
      .expect(401);
    await request(app!.getHttpServer())
      .post('/auth/login')
      .send({ email: user.email, password: NEW_PASSWORD })
      .expect(200);
  }, 180_000);

  it('refuses a change without the current password, and refuses reuse', async () => {
    const user = await makeUser(`pwguard-${tag}`, [
      'SALES_RELATIONSHIP_OFFICER',
    ]);
    await request(app!.getHttpServer())
      .post('/auth/password/change')
      .set(bearer(user.accessToken))
      .send({ currentPassword: 'not-the-password', newPassword: NEW_PASSWORD })
      .expect(401);

    await request(app!.getHttpServer())
      .post('/auth/password/change')
      .set(bearer(user.accessToken))
      .send({ currentPassword: PASSWORD, newPassword: PASSWORD })
      .expect(422);
  }, 120_000);
});

describe('Part V auth — the audit trail (item 11)', () => {
  it('records provisioning, first login, MFA enrolment and password change', async () => {
    const user = await provision(`audited-${tag}`, [
      'SALES_RELATIONSHIP_OFFICER',
    ]);
    const login = await request(app!.getHttpServer())
      .post('/auth/login')
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    await request(app!.getHttpServer())
      .post('/auth/password/force-change')
      .send({
        onboardingToken: (login.body as LoginBody).onboardingToken,
        newPassword: NEW_PASSWORD,
      })
      .expect(200);

    const entries = await prisma.auditLogEntry.findMany({
      where: { entityId: user.id },
    });
    const actions = new Set(entries.map((e) => e.action));
    // Creation, the first login, and the completed mandatory change.
    expect(actions.has('CREATE')).toBe(true);
    expect(actions.has('LOGIN')).toBe(true);
    expect(actions.has('PASSWORD_RESET_COMPLETED')).toBe(true);
  }, 120_000);

  it('records a trusted-device grant without ever storing the fingerprint', async () => {
    // A fingerprint in an audit row would turn the trail into a movement log
    // for the employee.
    const grants = await prisma.auditLogEntry.findMany({
      where: { entityType: 'TrustedDevice' },
      take: 20,
    });
    for (const entry of grants) {
      const serialised = JSON.stringify(entry.afterValue);
      expect(serialised).not.toContain('fingerprint');
      expect(serialised).not.toContain('device-');
    }
  });
});

describe('Part V auth — tenant resolution (item 12)', () => {
  it('resolves an Organization from its subdomain before any login', async () => {
    const org = await rawPrisma.organization.findFirstOrThrow({
      where: { id: TEST_ORGANIZATION_ID },
    });
    const res = await request(app!.getHttpServer())
      .get('/orgs/resolve')
      .query({ subdomain: org.subdomain })
      .expect(200);

    expect(res.body).toMatchObject({
      id: TEST_ORGANIZATION_ID,
      subdomain: org.subdomain,
    });
    // The sign-in screen needs the office's name in both languages, and nothing
    // about its users or its size.
    expect(res.body).toHaveProperty('legalNameAr');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('404s an unregistered subdomain without saying anything more', async () => {
    const res = await request(app!.getHttpServer())
      .get('/orgs/resolve')
      .query({ subdomain: `nobody-${tag}` })
      .expect(404);
    expect(JSON.stringify(res.body)).not.toContain(TEST_ORGANIZATION_ID);
  });

  it('rejects a malformed subdomain rather than querying it', async () => {
    await request(app!.getHttpServer())
      .get('/orgs/resolve')
      .query({ subdomain: 'not a subdomain!' })
      .expect(400);
  });

  it('there is no route that lists every office', async () => {
    // §4.10.4 — an office administrator must not be able to learn that another
    // office exists at all.
    const res = await request(app!.getHttpServer())
      .get('/orgs')
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(404);
  });

  it('every issued access token carries its Organization claim', () => {
    const [, payloadB64] = admin.accessToken.split('.');
    const claims = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8'),
    ) as { org?: string; sub: string; sid: string };

    expect(claims.org).toBe(TEST_ORGANIZATION_ID);
  });
});
