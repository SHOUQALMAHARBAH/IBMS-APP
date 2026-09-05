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
interface InternalAuditFindingBody {
  id: string;
  status: string;
  remediationAction: string | null;
}
interface LeadBody {
  id: string;
}
interface AuditLogEntryBody {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
}
interface DocumentHistoryBody {
  requestedDocumentId: string;
  versions: Array<{ id: string; isRequestedVersion: boolean }>;
  auditTrail: AuditLogEntryBody[];
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
    .send({ fullName: 'Internal Audit E2E User', email, password: PASSWORD })
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

describe('Internal Audit (e2e) — backlog Part C #57', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('records, updates the remediation, and closes an internal audit finding — permission-gated per action', async () => {
    const app = await boot();
    const compliance = await makeUser(
      app,
      'ia-compliance',
      'COMPLIANCE_OFFICER',
    );
    const manager = await makeUser(
      app,
      'ia-manager',
      'BRANCH_DEPARTMENT_MANAGER',
    );
    const outsider = await makeUser(
      app,
      'ia-outsider',
      'SALES_RELATIONSHIP_OFFICER',
    );

    // only Compliance may record a finding
    await request(app.getHttpServer())
      .post('/internal-audit-findings')
      .set(bearer(manager.accessToken))
      .send({
        auditPeriodLabel: 'Q3 2026 Internal Audit',
        finding: 'A finding a Manager should not be able to record.',
      })
      .expect(403);
    await request(app.getHttpServer())
      .post('/internal-audit-findings')
      .set(bearer(outsider.accessToken))
      .send({
        auditPeriodLabel: 'Q3 2026 Internal Audit',
        finding: 'A finding an outsider should not be able to record.',
      })
      .expect(403);

    const created = await request(app.getHttpServer())
      .post('/internal-audit-findings')
      .set(bearer(compliance.accessToken))
      .send({
        auditPeriodLabel: 'Q3 2026 Internal Audit',
        finding:
          'Two officers shared a login credential during a system outage.',
      })
      .expect(201);
    const findingId = (created.body as InternalAuditFindingBody).id;

    // a Manager CAN read (internal-audit.close also grants list/get)
    await request(app.getHttpServer())
      .get(`/internal-audit-findings/${findingId}`)
      .set(bearer(manager.accessToken))
      .expect(200);
    // an outsider cannot
    await request(app.getHttpServer())
      .get(`/internal-audit-findings/${findingId}`)
      .set(bearer(outsider.accessToken))
      .expect(403);

    // only Compliance may record the remediation plan
    await request(app.getHttpServer())
      .post(`/internal-audit-findings/${findingId}/remediation`)
      .set(bearer(manager.accessToken))
      .send({ remediationAction: 'A Manager should not be able to do this.' })
      .expect(403);
    const remediated = await request(app.getHttpServer())
      .post(`/internal-audit-findings/${findingId}/remediation`)
      .set(bearer(compliance.accessToken))
      .send({
        remediationAction:
          'Rotated the shared credential and retrained both officers.',
      })
      .expect(201);
    expect(
      (remediated.body as InternalAuditFindingBody).remediationAction,
    ).toBe('Rotated the shared credential and retrained both officers.');

    // Compliance cannot close — that needs internal-audit.close
    await request(app.getHttpServer())
      .post(`/internal-audit-findings/${findingId}/close`)
      .set(bearer(outsider.accessToken))
      .expect(403);
    const closed = await request(app.getHttpServer())
      .post(`/internal-audit-findings/${findingId}/close`)
      .set(bearer(manager.accessToken))
      .expect(201);
    expect((closed.body as InternalAuditFindingBody).status).toBe('closed');

    // a byte-identical re-close is idempotent
    await request(app.getHttpServer())
      .post(`/internal-audit-findings/${findingId}/close`)
      .set(bearer(compliance.accessToken))
      .expect(201);
  });

  it('gates and serves the External Auditor read-only lens — audit-log browse, workflow history, and document history', async () => {
    const app = await boot();
    const auditor = await makeUser(app, 'ia-auditor', 'EXTERNAL_AUDITOR');
    const admin = await makeUser(
      app,
      'ia-admin',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    );
    const outsider = await makeUser(
      app,
      'ia-outsider2',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const sales = await makeUser(
      app,
      'ia-lead-owner',
      'SALES_RELATIONSHIP_OFFICER',
    );

    // --- workflow-history: a real Lead driven through a real TRANSITION ---
    const lead = await request(app.getHttpServer())
      .post('/leads')
      .set(bearer(sales.accessToken))
      .send({
        fullName: 'Internal Audit E2E Lead',
        source: 'referral',
        marketingConsentGranted: false,
      })
      .expect(201);
    const leadId = (lead.body as LeadBody).id;
    await request(app.getHttpServer())
      .post(`/leads/${leadId}/transition`)
      .set(bearer(sales.accessToken))
      .send({ toStatus: 'CONTACTED' })
      .expect(201);

    const outsiderWorkflow = await request(app.getHttpServer())
      .get(`/audit-trail/workflow-history?entityType=Lead&entityId=${leadId}`)
      .set(bearer(outsider.accessToken))
      .expect(403);
    expect(outsiderWorkflow.status).toBe(403);

    const workflowHistory = await request(app.getHttpServer())
      .get(`/audit-trail/workflow-history?entityType=Lead&entityId=${leadId}`)
      .set(bearer(auditor.accessToken))
      .expect(200);
    const transitions = workflowHistory.body as AuditLogEntryBody[];
    expect(transitions.length).toBeGreaterThanOrEqual(1);
    expect(transitions.every((t) => t.action === 'TRANSITION')).toBe(true);
    expect(transitions.every((t) => t.entityId === leadId)).toBe(true);

    // System/Security Administrator does NOT hold workflow-history.read
    await request(app.getHttpServer())
      .get(`/audit-trail/workflow-history?entityType=Lead&entityId=${leadId}`)
      .set(bearer(admin.accessToken))
      .expect(403);

    // --- audit-log browse: the same TRANSITION row(s), filtered ---
    const browsed = await request(app.getHttpServer())
      .get(`/audit-trail?entityType=Lead&entityId=${leadId}&action=TRANSITION`)
      .set(bearer(auditor.accessToken))
      .expect(200);
    expect((browsed.body as AuditLogEntryBody[]).length).toBeGreaterThanOrEqual(
      1,
    );

    // Admin DOES hold audit-log.read
    await request(app.getHttpServer())
      .get(`/audit-trail?entityType=Lead&entityId=${leadId}`)
      .set(bearer(admin.accessToken))
      .expect(200);

    // --- document-history: a Document + its CREATE audit row, seeded directly ---
    const doc = await prisma.document.create({
      data: {
        category: 'CORRESPONDENCE',
        classification: 'CONFIDENTIAL',
        fileName: 'internal-audit-e2e.pdf',
        storageRef: `obj/internal-audit-e2e/${Date.now()}.pdf`,
        uploadedByUserId: sales.userId,
      },
    });
    await prisma.auditLogEntry.create({
      data: {
        userId: sales.userId,
        action: 'CREATE',
        entityType: 'Document',
        entityId: doc.id,
        afterValue: { fileName: doc.fileName, category: doc.category },
      },
    });

    await request(app.getHttpServer())
      .get(`/audit-trail/documents/${doc.id}/history`)
      .set(bearer(outsider.accessToken))
      .expect(403);
    // Admin does NOT hold document-history.read either
    await request(app.getHttpServer())
      .get(`/audit-trail/documents/${doc.id}/history`)
      .set(bearer(admin.accessToken))
      .expect(403);

    const history = await request(app.getHttpServer())
      .get(`/audit-trail/documents/${doc.id}/history`)
      .set(bearer(auditor.accessToken))
      .expect(200);
    const historyBody = history.body as DocumentHistoryBody;
    expect(historyBody.requestedDocumentId).toBe(doc.id);
    // a document with no application code writing a second version yet
    // (the dormant version-chain shape) is its own whole chain
    expect(historyBody.versions).toEqual([
      expect.objectContaining({ id: doc.id, isRequestedVersion: true }),
    ]);
    expect(
      historyBody.auditTrail.some(
        (e) => e.action === 'CREATE' && e.entityId === doc.id,
      ),
    ).toBe(true);

    await request(app.getHttpServer())
      .get(`/audit-trail/documents/does-not-exist/history`)
      .set(bearer(auditor.accessToken))
      .expect(404);
  });
});
