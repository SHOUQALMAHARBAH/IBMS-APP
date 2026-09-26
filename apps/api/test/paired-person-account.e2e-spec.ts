import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { ensureRole, prisma } from './tenant-prisma';
import type { RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';

/**
 * REGISTERING A PERSON WHO NEEDS A LOGIN, AS ONE ACT.
 *
 * Before this, it was two requests in a fixed order — create the HR record, then create the account
 * naming it by id — and the screen for the second listed existing employees in a picker, so the person
 * being registered was by definition never in it. The owner met that as "the button is broken".
 *
 * The property that needs a real database to prove is ATOMICITY. A mocked test can show a transaction
 * client being passed to both writes; only a real transaction and a real unique constraint can show
 * that a failed account leaves NO person behind. That is the second test here, and it is the one worth
 * reading: it drives the failure through the collision an administrator would actually hit — an email
 * already in use — rather than through an injected fault.
 */
const PASSWORD = 'Correct-Horse-Battery-Staple-9';
const PROVISIONED_PASSWORD = 'Another-Correct-Horse-7!';

/** One marker per run. db-test is CUMULATIVE, so every query below is scoped by it — a global count
 *  here would drift with every previous run of this file. */
const RUN = Math.random().toString(36).slice(2, 10);

interface IssuedSessionBody {
  accessToken: string;
  user: { id: string };
}
interface MfaEnrollBody {
  credentialId: string;
  otpAuthUri: string;
}
interface AdminUserBody {
  id: string;
  email: string;
  fullName: string;
}
interface OrgUnitBody {
  id: string;
}
interface ErrorBody {
  message: string | string[];
}

const createdRoleIds: string[] = [];
const createdUserIds: string[] = [];

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}
function uniqueEmail(label: string): string {
  return `${label}-${RUN}-${Math.random().toString(36).slice(2)}@ibms.test`;
}
function secretFromOtpAuthUri(uri: string): string {
  const match = /[?&]secret=([^&]+)/.exec(uri);
  if (!match) throw new Error('No secret in otpauth URI');
  return match[1];
}

async function makeActor(
  app: INestApplication<App>,
  label: string,
  role: { name?: RoleName; customRoleId?: string },
): Promise<{ accessToken: string; userId: string }> {
  const email = uniqueEmail(label);
  await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: `Paired ${label}`, email, password: PASSWORD })
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

  const roleId = role.customRoleId ?? (await ensureRole(role.name!)).id;
  await prisma.userRoleAssignment.create({ data: { userId: user.id, roleId } });
  createdUserIds.push(user.id);
  return { accessToken, userId: user.id };
}

/** A role holding EXACTLY the listed codes — the only way to construct "can issue a login, cannot
 *  create a person", which is a state the Role screen can produce and therefore a state to test. */
async function makeCustomRole(label: string, codes: string[]): Promise<string> {
  const name = `${label}-${RUN}`;
  const role = await prisma.role.create({
    data: {
      name,
      nameEn: name,
      nameAr: name,
      requiresMfaAlways: false,
      requiresHardwareToken: false,
    },
  });
  createdRoleIds.push(role.id);
  const permissions = await prisma.permission.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true },
  });
  // A typo in a code would grant nothing and make a negative test pass for the wrong reason.
  expect(permissions.map((p) => p.code).sort()).toEqual([...codes].sort());
  await prisma.rolePermission.createMany({
    data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
  });
  return role.id;
}

let app: INestApplication<App>;
let admin: { accessToken: string; userId: string };
let orgUnits: { departmentId: string; branchId: string };

function person(marker: string) {
  return {
    givenName: 'سلمى',
    fatherName: 'خالد',
    familyName: marker,
    nationalId: `99${Date.now().toString().slice(-8)}`,
    hireDate: '2026-02-01',
    position: 'مسؤولة إنتاج',
  };
}

function account(email: string) {
  return {
    email,
    password: PROVISIONED_PASSWORD,
    departmentId: orgUnits.departmentId,
    branchId: orgUnits.branchId,
    roleIds: [] as string[],
  };
}

describe('a person and their login, created together (e2e)', () => {
  beforeAll(async () => {
    app = await createTestApp();
    admin = await makeActor(app, 'admin', {
      name: 'SYSTEM_SECURITY_ADMINISTRATOR',
    });
    // Through the API, not a raw insert: a fixture that reaches past the API tests a path no
    // administrator can take.
    const department = await request(app.getHttpServer())
      .post('/admin/departments')
      .set(bearer(admin.accessToken))
      .send({ name: `Paired Dept ${RUN}`, nameAr: `قسم ${RUN}` })
      .expect(201);
    const branch = await request(app.getHttpServer())
      .post('/admin/branches')
      .set(bearer(admin.accessToken))
      .send({ name: `Paired Branch ${RUN}`, nameAr: `فرع ${RUN}` })
      .expect(201);
    orgUnits = {
      departmentId: (department.body as OrgUnitBody).id,
      branchId: (branch.body as OrgUnitBody).id,
    };
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    // db-test is cumulative. Roles especially: one left behind per run moves any count of the
    // catalogue, which is how an earlier Phase 2 test broke rbac.e2e-spec.ts.
    if (createdRoleIds.length > 0) {
      await prisma.userRoleAssignment.deleteMany({
        where: { roleId: { in: createdRoleIds } },
      });
      await prisma.rolePermission.deleteMany({
        where: { roleId: { in: createdRoleIds } },
      });
      await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
    }
  });

  it('creates the HR record and the account in one request, linked', async () => {
    const marker = `Atomic${RUN}A`;
    const sales = await ensureRole('SALES_RELATIONSHIP_OFFICER');
    const submitted = person(marker);
    const res = await request(app.getHttpServer())
      .post('/admin/users')
      .set(bearer(admin.accessToken))
      .send({
        ...account(uniqueEmail('paired-ok')),
        roleIds: [sales.id],
        registrationType: 'WINDOWS',
        employee: {
          ...submitted,
          givenNameEn: 'Salma',
          familyNameEn: 'Almaharbah',
        },
      })
      .expect(201);

    // Read BOTH rows back. The response body is what the API chose to say; the rows are what happened.
    const created = res.body as AdminUserBody;
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: created.id },
      select: {
        fullName: true,
        employeeId: true,
        departmentId: true,
        branchId: true,
        registrationType: true,
      },
    });
    expect(
      user.employeeId,
      'the account must point at the person',
    ).toBeTruthy();

    const employee = await prisma.employee.findUniqueOrThrow({
      where: { id: user.employeeId! },
      select: {
        fullName: true,
        fullNameEn: true,
        givenName: true,
        familyName: true,
        givenNameEn: true,
        fatherNameEn: true,
        departmentId: true,
        branchId: true,
        nationalIdEnc: true,
      },
    });

    // The name is composed once and shared, not typed twice.
    expect(employee.fullName).toBe(`سلمى خالد ${marker}`);
    expect(user.fullName).toBe(employee.fullName);
    // Composed from the English parts that WERE given; the father's name was not, and nothing was
    // invented for it.
    expect(employee.fullNameEn).toBe('Salma Almaharbah');
    expect(employee.fatherNameEn).toBeNull();
    // One department field on the screen, used for both rows — the disagreement the two link paths
    // each raise a 409 for cannot arise here.
    expect(employee.departmentId).toBe(orgUnits.departmentId);
    expect(user.departmentId).toBe(orgUnits.departmentId);
    expect(employee.branchId).toBe(orgUnits.branchId);
    expect(user.branchId).toBe(orgUnits.branchId);
    // `Employee.branchId` had no writer at all until this route; this is the assertion that it does.
    expect(user.registrationType).toBe('WINDOWS');
    // Part 10.2 — at rest it is the encryption envelope, not the number that was typed.
    //
    // The first version of this asserted `not.toContain('99')`, the prefix of the generated id, and
    // failed on a ciphertext that happened to read `v1:J992Z4...`. A two-character needle in base64
    // is a coin toss: it would have gone green or red for reasons having nothing to do with
    // encryption. The whole number is the only honest needle, and the envelope prefix is the positive
    // half — together they say "encrypted", where the negative alone says only "not exactly that".
    expect(employee.nationalIdEnc).not.toContain(submitted.nationalId);
    expect(employee.nationalIdEnc).toMatch(/^v1:/);
  });

  it('LEAVES NO PERSON BEHIND when the account cannot be created', async () => {
    const marker = `Rollback${RUN}`;
    const taken = uniqueEmail('paired-collision');
    const sales = await ensureRole('SALES_RELATIONSHIP_OFFICER');

    // Take the email first, with an ordinary account.
    await request(app.getHttpServer())
      .post('/admin/users')
      .set(bearer(admin.accessToken))
      .send({
        ...account(taken),
        roleIds: [sales.id],
        fullName: 'First Claim On This Email',
      })
      .expect(201);

    // Now the paired create collides on `User.email @unique` — the failure an administrator actually
    // meets, not an injected one. The person write has already happened at this point INSIDE the
    // transaction, which is precisely what the rollback has to undo.
    await request(app.getHttpServer())
      .post('/admin/users')
      .set(bearer(admin.accessToken))
      .send({
        ...account(taken),
        roleIds: [sales.id],
        employee: person(marker),
      })
      .expect(409);

    const orphans = await prisma.employee.findMany({
      where: { familyName: marker },
      select: { id: true, fullName: true },
    });
    expect(
      orphans,
      'the account failed, so the person must not exist: a half-created person is one nobody can find and nobody can finish',
    ).toEqual([]);
  });

  it('refuses the pair to a role that can issue logins but cannot create people', async () => {
    // Constructible on the Role screen, and it must not get a person record as a side effect of
    // provisioning an account. The route's own guard cannot express this: PermissionsGuard ORs its
    // codes, so declaring both would let either one through alone.
    const roleId = await makeCustomRole('paired-login-only', ['user.manage']);
    const actor = await makeActor(app, 'login-only', { customRoleId: roleId });
    const marker = `Refused${RUN}`;
    const sales = await ensureRole('SALES_RELATIONSHIP_OFFICER');

    const res = await request(app.getHttpServer())
      .post('/admin/users')
      .set(bearer(actor.accessToken))
      .send({
        ...account(uniqueEmail('paired-refused')),
        roleIds: [sales.id],
        employee: person(marker),
      })
      .expect(403);

    // The refusal has to say which permission is missing and what the caller CAN still do — a bare
    // "forbidden" on a screen that just showed the person form reads as a broken button.
    const body = res.body as ErrorBody;
    expect(JSON.stringify(body.message)).toContain('employee.create');

    const orphans = await prisma.employee.findMany({
      where: { familyName: marker },
      select: { id: true },
    });
    expect(
      orphans,
      'a refusal must not leave the person behind either',
    ).toEqual([]);
  });

  it('still lets that role provision an account on its own', async () => {
    // The other half of the previous test: `user.manage` alone is not broken, it is narrower. Without
    // this, "refuses the pair" would also be satisfied by a role that can do nothing at all.
    const roleId = await makeCustomRole('paired-login-only-ok', [
      'user.manage',
    ]);
    const actor = await makeActor(app, 'login-only-ok', {
      customRoleId: roleId,
    });
    const sales = await ensureRole('SALES_RELATIONSHIP_OFFICER');

    await request(app.getHttpServer())
      .post('/admin/users')
      .set(bearer(actor.accessToken))
      .send({
        ...account(uniqueEmail('paired-account-only')),
        roleIds: [sales.id],
        fullName: 'Account Without A Person',
      })
      .expect(201);
  });

  it('refuses a person block sent together with employeeId, naming both', async () => {
    const marker = `Both${RUN}`;
    const sales = await ensureRole('SALES_RELATIONSHIP_OFFICER');
    const existing = await request(app.getHttpServer())
      .post('/employees')
      .set(bearer(admin.accessToken))
      .send(person(`Existing${RUN}`))
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/admin/users')
      .set(bearer(admin.accessToken))
      .send({
        ...account(uniqueEmail('paired-both')),
        roleIds: [sales.id],
        employeeId: (existing.body as { id: string }).id,
        employee: person(marker),
      })
      .expect(422);
    expect(JSON.stringify((res.body as ErrorBody).message)).toContain(
      'employeeId',
    );

    const orphans = await prisma.employee.findMany({
      where: { familyName: marker },
      select: { id: true },
    });
    expect(orphans).toEqual([]);
  });

  it('records the person and the account as two audit entries for one act', async () => {
    const marker = `Audited${RUN}`;
    const sales = await ensureRole('SALES_RELATIONSHIP_OFFICER');
    const res = await request(app.getHttpServer())
      .post('/admin/users')
      .set(bearer(admin.accessToken))
      .send({
        ...account(uniqueEmail('paired-audit')),
        roleIds: [sales.id],
        employee: person(marker),
      })
      .expect(201);
    const created = res.body as AdminUserBody;
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: created.id },
      select: { employeeId: true },
    });

    // Two entities under two permissions, so two rows — scoped to these ids, never a count.
    const entries = await prisma.auditLogEntry.findMany({
      where: {
        action: 'CREATE',
        entityId: { in: [created.id, user.employeeId!] },
      },
      select: { entityType: true, entityId: true, afterValue: true },
    });
    expect(entries.map((e) => e.entityType).sort()).toEqual([
      'Employee',
      'User',
    ]);
    const employeeRow = entries.find((e) => e.entityType === 'Employee');
    expect(
      JSON.stringify(employeeRow?.afterValue),
      'each row must name the other, so the pair is recoverable from either side',
    ).toContain(created.id);
    // Part 10.2 — the national ID is in neither row, in neither form.
    expect(JSON.stringify(entries)).not.toContain('nationalId');
  });
});
