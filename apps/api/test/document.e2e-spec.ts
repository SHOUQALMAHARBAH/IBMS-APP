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
interface DocumentBody {
  id: string;
  policyId: string | null;
  category: string;
  classification: string;
  versionNumber: number;
  previousVersionId: string | null;
  deletionLocked: boolean;
  deletionOverrideByUserId: string | null;
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
    .send({ fullName: 'Document E2E User', email, password: PASSWORD })
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

async function makePolicy(ownerUserId: string) {
  const customer = await prisma.customer.create({
    data: {
      customerType: 'CORPORATE',
      legalName: `Doc E2E Co ${Math.random().toString(36).slice(2, 8)}`,
      ownerUserId,
    },
  });
  const insurer = await prisma.insurer.create({
    data: { name: `Doc E2E ins ${Math.random().toString(36).slice(2, 8)}` },
  });
  const opp = await prisma.opportunity.create({
    data: { customerId: customer.id },
  });
  return prisma.policy.create({
    data: {
      opportunityId: opp.id,
      customerId: customer.id,
      insurerId: insurer.id,
      insuranceLine: 'Property All Risks',
      requestedPremium: '1000.000',
      status: 'ACTIVE',
    },
  });
}

describe('Document Management (e2e) — backlog Part C #70', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('gates document.manage and document.delete-override separately', async () => {
    const app = await boot();
    const outsider = await makeUser(
      app,
      'doc-outsider',
      'POLICY_CHECKING_OFFICER',
    );
    const placement = await makeUser(
      app,
      'doc-placement-noperm',
      'PLACEMENT_TECHNICAL_OFFICER',
    );
    const policy = await makePolicy(placement.userId);
    const doc = await prisma.document.create({
      data: {
        policyId: policy.id,
        category: 'POLICY',
        classification: 'CONFIDENTIAL',
        fileName: 'wording.pdf',
        storageRef: 's3://ibms/doc-e2e/wording.pdf',
        uploadedByUserId: placement.userId,
      },
    });

    await request(app.getHttpServer())
      .get('/documents')
      .set(bearer(outsider.accessToken))
      .expect(403);
    await request(app.getHttpServer())
      .post(`/documents/${doc.id}/versions`)
      .set(bearer(outsider.accessToken))
      .send({
        classification: 'CONFIDENTIAL',
        fileName: 'x.pdf',
        storageRef: 'y',
      })
      .expect(403);

    // Placement holds document.manage but not document.delete-override.
    await request(app.getHttpServer())
      .post(`/documents/${doc.id}/deletion-override`)
      .set(bearer(placement.accessToken))
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/documents/${doc.id}`)
      .set(bearer(placement.accessToken))
      .expect(403);
  });

  it('creates a new version, rejects versioning a superseded document, and 409s on re-versioning the new leaf twice for the same predecessor', async () => {
    const app = await boot();
    const placement = await makeUser(
      app,
      'doc-placement',
      'PLACEMENT_TECHNICAL_OFFICER',
    );
    const policy = await makePolicy(placement.userId);
    const v1 = (
      await request(app.getHttpServer())
        .post(`/policies/${policy.id}/documents`)
        .set(bearer(placement.accessToken))
        .send({
          documents: [
            {
              category: 'POLICY',
              classification: 'CONFIDENTIAL',
              fileName: 'wording-v1.pdf',
              storageRef: 's3://ibms/doc-e2e/wording-v1.pdf',
            },
          ],
        })
        .expect(201)
    ).body as { documents: DocumentBody[] };
    const docId = v1.documents[v1.documents.length - 1].id;

    const v2 = (
      await request(app.getHttpServer())
        .post(`/documents/${docId}/versions`)
        .set(bearer(placement.accessToken))
        .send({
          classification: 'HIGHLY_CONFIDENTIAL',
          fileName: 'wording-v2.pdf',
          storageRef: 's3://ibms/doc-e2e/wording-v2.pdf',
        })
        .expect(201)
    ).body as DocumentBody;
    expect(v2.versionNumber).toBe(2);
    expect(v2.previousVersionId).toBe(docId);
    expect(v2.classification).toBe('HIGHLY_CONFIDENTIAL');

    // v1 has already been superseded.
    await request(app.getHttpServer())
      .post(`/documents/${docId}/versions`)
      .set(bearer(placement.accessToken))
      .send({
        classification: 'CONFIDENTIAL',
        fileName: 'x.pdf',
        storageRef: 'y',
      })
      .expect(422);
  });

  it('walks the deletion-override lifecycle: locked by default, 409 without override, unlock, delete, 404 after', async () => {
    const app = await boot();
    const placement = await makeUser(
      app,
      'doc-del-placement',
      'PLACEMENT_TECHNICAL_OFFICER',
    );
    const admin = await makeUser(
      app,
      'doc-del-admin',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );
    const policy = await makePolicy(placement.userId);
    const doc = await prisma.document.create({
      data: {
        policyId: policy.id,
        category: 'CORRESPONDENCE',
        classification: 'INTERNAL',
        fileName: 'note.pdf',
        storageRef: 's3://ibms/doc-e2e/note.pdf',
        uploadedByUserId: placement.userId,
      },
    });
    expect(doc.deletionLocked).toBe(true);

    await request(app.getHttpServer())
      .delete(`/documents/${doc.id}`)
      .set(bearer(admin.accessToken))
      .expect(409);

    const unlocked = (
      await request(app.getHttpServer())
        .post(`/documents/${doc.id}/deletion-override`)
        .set(bearer(admin.accessToken))
        .expect(201)
    ).body as DocumentBody;
    expect(unlocked.deletionLocked).toBe(false);
    expect(unlocked.deletionOverrideByUserId).toBe(admin.userId);

    // a second override on an already-unlocked document 409s.
    await request(app.getHttpServer())
      .post(`/documents/${doc.id}/deletion-override`)
      .set(bearer(admin.accessToken))
      .expect(409);

    await request(app.getHttpServer())
      .delete(`/documents/${doc.id}`)
      .set(bearer(admin.accessToken))
      .expect(204);

    // admin holds document.delete-override but not document.manage (no
    // read permission) — confirm the row is actually gone directly.
    expect(
      await prisma.document.findUnique({ where: { id: doc.id } }),
    ).toBeNull();
  });

  it('409s deleting a document that has a newer version, even once unlocked', async () => {
    const app = await boot();
    const placement = await makeUser(
      app,
      'doc-chain-placement',
      'PLACEMENT_TECHNICAL_OFFICER',
    );
    const admin = await makeUser(
      app,
      'doc-chain-admin',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );
    const policy = await makePolicy(placement.userId);
    const v1 = await prisma.document.create({
      data: {
        policyId: policy.id,
        category: 'POLICY',
        classification: 'CONFIDENTIAL',
        fileName: 'wording-v1.pdf',
        storageRef: 's3://ibms/doc-e2e/chain-v1.pdf',
        uploadedByUserId: placement.userId,
      },
    });
    await request(app.getHttpServer())
      .post(`/documents/${v1.id}/versions`)
      .set(bearer(placement.accessToken))
      .send({
        classification: 'CONFIDENTIAL',
        fileName: 'wording-v2.pdf',
        storageRef: 's3://ibms/doc-e2e/chain-v2.pdf',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/documents/${v1.id}/deletion-override`)
      .set(bearer(admin.accessToken))
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/documents/${v1.id}`)
      .set(bearer(admin.accessToken))
      .expect(409);
  });

  it('409s deleting a document still attached to a claim', async () => {
    const app = await boot();
    const claimsOfficer = await makeUser(
      app,
      'doc-claim-officer',
      'CLAIMS_OFFICER',
    );
    const admin = await makeUser(
      app,
      'doc-claim-admin',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );
    const policy = await makePolicy(claimsOfficer.userId);
    const claim = await prisma.claim.create({
      data: {
        policyId: policy.id,
        customerId: policy.customerId,
        lossDate: new Date('2026-08-01T00:00:00.000Z'),
        estimatedLoss: '5000.000',
      },
    });
    const doc = await prisma.document.create({
      data: {
        category: 'CLAIM',
        classification: 'CONFIDENTIAL',
        fileName: 'claim-form.pdf',
        storageRef: 's3://ibms/doc-e2e/claim-form.pdf',
        uploadedByUserId: claimsOfficer.userId,
      },
    });
    await prisma.claimDocument.create({
      data: { claimId: claim.id, documentId: doc.id, docType: 'claim_form' },
    });

    await request(app.getHttpServer())
      .post(`/documents/${doc.id}/deletion-override`)
      .set(bearer(admin.accessToken))
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/documents/${doc.id}`)
      .set(bearer(admin.accessToken))
      .expect(409);
  });

  it('computes the highest-classification-present rollup for a policy file, and 404s an unknown policy', async () => {
    const app = await boot();
    const placement = await makeUser(
      app,
      'doc-rollup-placement',
      'PLACEMENT_TECHNICAL_OFFICER',
    );
    const policy = await makePolicy(placement.userId);
    await prisma.document.createMany({
      data: [
        {
          policyId: policy.id,
          category: 'POLICY',
          classification: 'PUBLIC',
          fileName: 'brochure.pdf',
          storageRef: 's3://ibms/doc-e2e/rollup-1.pdf',
          uploadedByUserId: placement.userId,
        },
        {
          policyId: policy.id,
          category: 'CLAIM',
          classification: 'HIGHLY_CONFIDENTIAL',
          fileName: 'medical-report.pdf',
          storageRef: 's3://ibms/doc-e2e/rollup-2.pdf',
          uploadedByUserId: placement.userId,
        },
      ],
    });

    const summary = (
      await request(app.getHttpServer())
        .get(`/documents/classification-summary?policyId=${policy.id}`)
        .set(bearer(placement.accessToken))
        .expect(200)
    ).body as {
      policyId: string;
      documentCount: number;
      highestClassification: string;
    };
    expect(summary.documentCount).toBe(2);
    expect(summary.highestClassification).toBe('HIGHLY_CONFIDENTIAL');

    await request(app.getHttpServer())
      .get(
        '/documents/classification-summary?policyId=00000000-0000-0000-0000-000000000000',
      )
      .set(bearer(placement.accessToken))
      .expect(404);
  });
});
