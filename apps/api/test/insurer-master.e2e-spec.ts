import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { type RoleName } from '@ibms/db';
import { prisma } from './tenant-prisma';
import { createTestApp } from './utils/test-app';

/**
 * Part I §5 (multi-tenancy Phase 3 step 10) — the GLOBAL insurer master
 * registry and the one-time form mapping hanging off it.
 *
 * The cross-Organization half of §5 — that a form mapped by one office is
 * immediately usable by another — is asserted in `tenant-isolation.e2e-spec.ts`
 * alongside the rest of the Part V checklist, because proving it needs a second
 * Organization. This file covers the module's own behaviour.
 */
let app: INestApplication<App> | null = null;
let mapper: { accessToken: string; id: string };
let reader: { accessToken: string; id: string };
let noAccess: { accessToken: string; id: string };
let masterId: string;

const tag = Math.random().toString(36).slice(2, 8);

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

interface TemplateBody {
  id: string;
  insuranceLine: string;
  version: number;
  sourceDocumentRef: string | null;
  fields: {
    fieldKey: string;
    labelEn: string;
    labelAr: string | null;
    dataType: string;
    isRequired: boolean;
    options: string[];
    displayOrder: number;
  }[];
}

const PASSWORD = 'Correct-Horse-Battery-Staple-9';

interface IssuedSessionBody {
  accessToken: string;
  user: { id: string };
}
interface MfaEnrollBody {
  credentialId: string;
  otpAuthUri: string;
}

function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@ibms.test`;
}

function secretFromOtpAuthUri(uri: string): string {
  const match = /[?&]secret=([^&]+)/.exec(uri);
  if (!match) throw new Error('No secret in otpauth URI');
  return decodeURIComponent(match[1]);
}

async function makeUser(
  application: INestApplication<App>,
  label: string,
  roles: RoleName[],
): Promise<{ accessToken: string; id: string }> {
  const email = uniqueEmail(label);
  await request(application.getHttpServer())
    .post('/auth/signup')
    .send({
      fullName: `Insurer Master E2E ${label}`,
      email,
      password: PASSWORD,
    })
    .expect(201);
  const login = await request(application.getHttpServer())
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const body = login.body as IssuedSessionBody;

  const enroll = await request(application.getHttpServer())
    .post('/auth/mfa/totp/enroll')
    .set(bearer(body.accessToken))
    .expect(201);
  const enrollBody = enroll.body as MfaEnrollBody;
  await request(application.getHttpServer())
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(body.accessToken))
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
    const activeGrant = await prisma.userRoleAssignment.findFirst({
      where: { userId: body.user.id, roleId: role.id, revokedAt: null },
    });
    if (!activeGrant) {
      await prisma.userRoleAssignment.create({
        data: { userId: body.user.id, roleId: role.id },
      });
    }
  }
  return { accessToken: body.accessToken, id: body.user.id };
}

beforeAll(async () => {
  app = await createTestApp();

  mapper = await makeUser(app, `ins-master-mapper-${tag}`, [
    'PLACEMENT_TECHNICAL_OFFICER',
  ]);
  reader = await makeUser(app, `ins-master-reader-${tag}`, [
    'SALES_RELATIONSHIP_OFFICER',
  ]);
  noAccess = await makeUser(app, `ins-master-none-${tag}`, ['CLAIMS_OFFICER']);

  const master = await prisma.insurerMaster.create({
    data: {
      legalName: `Master Registry E2E Insurer ${tag}`,
      legalNameAr: `شركة تأمين اختبارية ${tag}`,
      linesOffered: ['MOTOR', 'MARINE'],
    },
  });
  masterId = master.id;
}, 120_000);

afterAll(async () => {
  await app?.close();
  app = null;
  await prisma.insurerFormTemplate.deleteMany({
    where: { insurerMasterId: masterId },
  });
  await prisma.insurer.deleteMany({ where: { insurerMasterId: masterId } });
  await prisma.insurerMaster.deleteMany({ where: { id: masterId } });
});

describe('the global insurer master registry', () => {
  it('lists masters with both legal names', async () => {
    const res = await request(app!.getHttpServer())
      .get('/insurer-masters')
      .set(bearer(reader.accessToken))
      .expect(200);

    const found = (
      res.body as { id: string; legalNameAr: string | null }[]
    ).find((m) => m.id === masterId);
    expect(found).toBeDefined();
    expect(found!.legalNameAr).toBe(`شركة تأمين اختبارية ${tag}`);
  });

  it('404s an unknown master rather than returning an empty shape', async () => {
    await request(app!.getHttpServer())
      .get('/insurer-masters/00000000-0000-0000-0000-0000000000ff')
      .set(bearer(reader.accessToken))
      .expect(404);
  });

  it('refuses a caller holding neither insurer permission', async () => {
    await request(app!.getHttpServer())
      .get('/insurer-masters')
      .set(bearer(noAccess.accessToken))
      .expect(403);
  });
});

describe('mapping an insurer form (§5, one-time)', () => {
  it('reports no mapped form before anyone maps one — null, not 404', async () => {
    // §5 is explicit that an unmapped insurer+line falls back to the generic
    // structured fields already collected at Needs Assessment/RFQ, so "nobody
    // has mapped this yet" is a real answer the caller acts on.
    const res = await request(app!.getHttpServer())
      .get(`/insurer-masters/${masterId}/form-templates/current`)
      .query({ insuranceLine: 'MOTOR' })
      .set(bearer(reader.accessToken))
      .expect(200);

    expect(res.body).toEqual({});
  });

  it('refuses to map without the mapping permission, even holding read', async () => {
    await request(app!.getHttpServer())
      .post(`/insurer-masters/${masterId}/form-templates`)
      .set(bearer(reader.accessToken))
      .send({
        insuranceLine: 'MOTOR',
        fields: [
          {
            fieldKey: 'insured_full_name',
            labelEn: 'Insured full name',
            dataType: 'TEXT',
            displayOrder: 0,
          },
        ],
      })
      .expect(403);
  });

  it('maps a form once, keeping the Arabic labels', async () => {
    const res = await request(app!.getHttpServer())
      .post(`/insurer-masters/${masterId}/form-templates`)
      .set(bearer(mapper.accessToken))
      .send({
        insuranceLine: 'MOTOR',
        sourceDocumentRef: 'motor-proposal-2026.pdf',
        fields: [
          {
            fieldKey: 'insured_full_name',
            labelEn: 'Insured full name',
            labelAr: 'اسم المؤمن له',
            dataType: 'TEXT',
            isRequired: true,
            displayOrder: 0,
          },
          {
            fieldKey: 'cover_type',
            labelEn: 'Cover type',
            labelAr: 'نوع التغطية',
            dataType: 'ENUM',
            options: ['COMPREHENSIVE', 'THIRD_PARTY'],
            displayOrder: 1,
          },
        ],
      })
      .expect(201);

    const body = res.body as TemplateBody;
    expect(body.version).toBe(1);
    expect(body.sourceDocumentRef).toBe('motor-proposal-2026.pdf');
    expect(body.fields.map((f) => f.fieldKey)).toEqual([
      'insured_full_name',
      'cover_type',
    ]);
    expect(body.fields[0].labelAr).toBe('اسم المؤمن له');
    expect(body.fields[1].options).toEqual(['COMPREHENSIVE', 'THIRD_PARTY']);
  });

  it('writes an attributable audit row for the mapping', async () => {
    // A mapping every office will submit against needs a named author, even
    // though the row itself belongs to no single office.
    const entries = await prisma.auditLogEntry.findMany({
      where: { entityType: 'InsurerFormTemplate', userId: mapper.id },
    });
    expect(entries.length).toBeGreaterThan(0);
  });

  it('serves the mapped form as the current one', async () => {
    const res = await request(app!.getHttpServer())
      .get(`/insurer-masters/${masterId}/form-templates/current`)
      .query({ insuranceLine: 'MOTOR' })
      .set(bearer(reader.accessToken))
      .expect(200);

    expect((res.body as TemplateBody).version).toBe(1);
  });

  it('matches the line case-insensitively — "motor" is the same form', async () => {
    const res = await request(app!.getHttpServer())
      .get(`/insurer-masters/${masterId}/form-templates/current`)
      .query({ insuranceLine: 'motor' })
      .set(bearer(reader.accessToken))
      .expect(200);

    expect((res.body as TemplateBody).version).toBe(1);
  });

  it('re-mapping creates a NEW version, never edits the one in use', async () => {
    // The old version has to survive: other offices may already have submitted
    // against it, and §5 treats a re-map as a new version by design.
    const res = await request(app!.getHttpServer())
      .post(`/insurer-masters/${masterId}/form-templates`)
      .set(bearer(mapper.accessToken))
      .send({
        insuranceLine: 'MOTOR',
        fields: [
          {
            fieldKey: 'insured_full_name',
            labelEn: 'Insured full name',
            dataType: 'TEXT',
            displayOrder: 0,
          },
        ],
      })
      .expect(201);

    expect((res.body as TemplateBody).version).toBe(2);

    const all = await request(app!.getHttpServer())
      .get(`/insurer-masters/${masterId}/form-templates`)
      .query({ insuranceLine: 'MOTOR' })
      .set(bearer(reader.accessToken))
      .expect(200);

    const versions = (all.body as TemplateBody[]).map((t) => t.version);
    expect(versions).toEqual([2, 1]);

    const current = await request(app!.getHttpServer())
      .get(`/insurer-masters/${masterId}/form-templates/current`)
      .query({ insuranceLine: 'MOTOR' })
      .set(bearer(reader.accessToken))
      .expect(200);
    expect((current.body as TemplateBody).version).toBe(2);
  });

  it('keeps each product line on its own version track', async () => {
    const res = await request(app!.getHttpServer())
      .post(`/insurer-masters/${masterId}/form-templates`)
      .set(bearer(mapper.accessToken))
      .send({
        insuranceLine: 'MARINE',
        fields: [
          {
            fieldKey: 'vessel_name',
            labelEn: 'Vessel name',
            dataType: 'TEXT',
            displayOrder: 0,
          },
        ],
      })
      .expect(201);

    expect((res.body as TemplateBody).version).toBe(1);
  });

  it('rejects a mapping with two fields claiming the same key', async () => {
    const res = await request(app!.getHttpServer())
      .post(`/insurer-masters/${masterId}/form-templates`)
      .set(bearer(mapper.accessToken))
      .send({
        insuranceLine: 'MOTOR',
        fields: [
          {
            fieldKey: 'sum_insured',
            labelEn: 'Sum insured',
            dataType: 'NUMBER',
            displayOrder: 0,
          },
          {
            fieldKey: 'Sum_Insured',
            labelEn: 'Sum insured (again)',
            dataType: 'NUMBER',
            displayOrder: 1,
          },
        ],
      })
      .expect(422);

    expect(JSON.stringify(res.body)).toContain('sum_insured');
  });

  it('rejects an ENUM field with nothing to pick from', async () => {
    await request(app!.getHttpServer())
      .post(`/insurer-masters/${masterId}/form-templates`)
      .set(bearer(mapper.accessToken))
      .send({
        insuranceLine: 'MOTOR',
        fields: [
          {
            fieldKey: 'cover_type',
            labelEn: 'Cover type',
            dataType: 'ENUM',
            options: [],
            displayOrder: 0,
          },
        ],
      })
      .expect(422);
  });

  it('rejects an unknown field data type', async () => {
    await request(app!.getHttpServer())
      .post(`/insurer-masters/${masterId}/form-templates`)
      .set(bearer(mapper.accessToken))
      .send({
        insuranceLine: 'MOTOR',
        fields: [
          {
            fieldKey: 'x',
            labelEn: 'X',
            dataType: 'SIGNATURE',
            displayOrder: 0,
          },
        ],
      })
      .expect(400);
  });

  it('rejects a mapping with no fields at all', async () => {
    await request(app!.getHttpServer())
      .post(`/insurer-masters/${masterId}/form-templates`)
      .set(bearer(mapper.accessToken))
      .send({ insuranceLine: 'MOTOR', fields: [] })
      .expect(400);
  });

  it('404s a mapping against an insurer that does not exist', async () => {
    await request(app!.getHttpServer())
      .post(
        '/insurer-masters/00000000-0000-0000-0000-0000000000ff/form-templates',
      )
      .set(bearer(mapper.accessToken))
      .send({
        insuranceLine: 'MOTOR',
        fields: [
          {
            fieldKey: 'x',
            labelEn: 'X',
            dataType: 'TEXT',
            displayOrder: 0,
          },
        ],
      })
      .expect(404);
  });
});
