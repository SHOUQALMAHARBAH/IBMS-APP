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
interface FeedbackBody {
  id: string;
  customerId: string;
  context: string;
  score: number | null;
  comments: string | null;
  submittedAt: string;
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
    .send({ fullName: 'Feedback E2E User', email, password: PASSWORD })
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

describe('Customer Feedback (e2e) — backlog Part C #45', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('logs post-issuance / post-claim / post-renewal feedback, keeps comments out of the audit row, and reads it back', async () => {
    const app = await boot();
    const sales = await makeUser(app, 'fb-sales', 'SALES_RELATIONSHIP_OFFICER');
    const claims = await makeUser(app, 'fb-claims', 'CLAIMS_OFFICER');

    const customer = await prisma.customer.create({
      data: {
        customerType: 'INDIVIDUAL',
        legalName: `Feedback E2E ${Math.random().toString(36).slice(2, 8)}`,
        ownerUserId: sales.userId,
      },
    });
    const otherCustomer = await prisma.customer.create({
      data: {
        customerType: 'INDIVIDUAL',
        legalName: 'Feedback E2E Other',
        ownerUserId: sales.userId,
      },
    });

    // a non-Sales actor cannot log OR read feedback
    await request(app.getHttpServer())
      .post('/feedback')
      .set(bearer(claims.accessToken))
      .send({ customerId: customer.id, context: 'post_claim' })
      .expect(403);
    await request(app.getHttpServer())
      .get('/feedback')
      .set(bearer(claims.accessToken))
      .expect(403);
    await request(app.getHttpServer())
      .get(`/feedback?customerId=${customer.id}`)
      .set(bearer(claims.accessToken))
      .expect(403);

    // unknown customer -> 404; an unknown context -> 400
    await request(app.getHttpServer())
      .post('/feedback')
      .set(bearer(sales.accessToken))
      .send({
        customerId: '11111111-1111-4111-8111-111111111111',
        context: 'post_claim',
      })
      .expect(404);
    await request(app.getHttpServer())
      .post('/feedback')
      .set(bearer(sales.accessToken))
      .send({ customerId: customer.id, context: 'post_complaint' })
      .expect(400);

    // a score outside 1-5 -> 400; the 1 and 5 boundaries themselves succeed
    await request(app.getHttpServer())
      .post('/feedback')
      .set(bearer(sales.accessToken))
      .send({ customerId: customer.id, context: 'post_claim', score: 0 })
      .expect(400);
    await request(app.getHttpServer())
      .post('/feedback')
      .set(bearer(sales.accessToken))
      .send({ customerId: customer.id, context: 'post_claim', score: 6 })
      .expect(400);
    const minScore = await request(app.getHttpServer())
      .post('/feedback')
      .set(bearer(sales.accessToken))
      .send({ customerId: customer.id, context: 'post_claim', score: 1 })
      .expect(201);
    expect((minScore.body as FeedbackBody).score).toBe(1);
    const maxScore = await request(app.getHttpServer())
      .post('/feedback')
      .set(bearer(sales.accessToken))
      .send({ customerId: customer.id, context: 'post_claim', score: 5 })
      .expect(201);
    expect((maxScore.body as FeedbackBody).score).toBe(5);

    // a full account number in comments -> 400 (the shared DTO guard)
    await request(app.getHttpServer())
      .post('/feedback')
      .set(bearer(sales.accessToken))
      .send({
        customerId: customer.id,
        context: 'post_claim',
        comments: 'Please refund my JOD to account 0123456789.',
      })
      .expect(400);

    // log post-claim feedback with a score + comments
    const COMMENTS = 'The adjuster was responsive throughout the process.';
    const created = await request(app.getHttpServer())
      .post('/feedback')
      .set(bearer(sales.accessToken))
      .send({
        customerId: customer.id,
        context: 'post_claim',
        score: 4,
        comments: COMMENTS,
      })
      .expect(201);
    const fb = created.body as FeedbackBody;
    expect(fb.customerId).toBe(customer.id);
    expect(fb.context).toBe('post_claim');
    expect(fb.score).toBe(4);
    expect(fb.comments).toBe(COMMENTS);
    expect(fb.submittedAt).toBeTruthy();

    // log post-issuance feedback with no score/comments (both optional); an
    // empty-string comments is treated the same as omitted
    const bare = await request(app.getHttpServer())
      .post('/feedback')
      .set(bearer(sales.accessToken))
      .send({ customerId: customer.id, context: 'post_issuance', comments: '' })
      .expect(201);
    expect((bare.body as FeedbackBody).score).toBeNull();
    expect((bare.body as FeedbackBody).comments).toBeNull();

    // feedback for another customer, so list filters actually filter
    await request(app.getHttpServer())
      .post('/feedback')
      .set(bearer(sales.accessToken))
      .send({ customerId: otherCustomer.id, context: 'post_renewal', score: 2 })
      .expect(201);

    // reads — this customer now has 4 rows: minScore, maxScore, fb (all
    // post_claim) + bare (post_issuance)
    const list = await request(app.getHttpServer())
      .get(`/feedback?customerId=${customer.id}`)
      .set(bearer(sales.accessToken))
      .expect(200);
    const ids = (list.body as FeedbackBody[]).map((r) => r.id);
    expect(ids).toContain(fb.id);
    expect(ids).toHaveLength(4);

    // context filter + newest-first order (submittedAt desc)
    const claimOnly = await request(app.getHttpServer())
      .get(`/feedback?customerId=${customer.id}&context=post_claim`)
      .set(bearer(sales.accessToken))
      .expect(200);
    expect((claimOnly.body as FeedbackBody[]).map((r) => r.id)).toEqual([
      fb.id,
      (maxScore.body as FeedbackBody).id,
      (minScore.body as FeedbackBody).id,
    ]);

    await request(app.getHttpServer())
      .get(`/feedback/${fb.id}`)
      .set(bearer(sales.accessToken))
      .expect(200);
    await request(app.getHttpServer())
      .get('/feedback/11111111-1111-4111-8111-111111111111')
      .set(bearer(sales.accessToken))
      .expect(404);

    // audit: a CREATE row exists but never carries the comments text
    const audit = await prisma.auditLogEntry.findMany({
      where: { entityType: 'CustomerFeedback', entityId: fb.id },
    });
    expect(audit.map((a) => a.action)).toContain('CREATE');
    expect(JSON.stringify(audit)).not.toContain(COMMENTS);
  });
});
