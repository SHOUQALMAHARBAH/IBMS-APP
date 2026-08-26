import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { prisma } from '@ibms/db';
import { createTestApp } from './utils/test-app';

const PASSWORD = 'Correct-Horse-Battery-Staple-9';

function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@ibms.test`;
}

describe('AuditLogEntry immutability (e2e) — Part 10.3', () => {
  let app: INestApplication<App>;

  async function boot(): Promise<INestApplication<App>> {
    if (!app) app = await createTestApp();
    return app;
  }

  afterAll(async () => {
    if (app) await app.close();
  });

  it('rejects UPDATE and DELETE against AuditLogEntry at the database layer', async () => {
    const app = await boot();
    const email = uniqueEmail('audit-immutable');
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        fullName: 'Audit Immutability Test User',
        email,
        password: PASSWORD,
      })
      .expect(201);
    // signup() itself writes no AuditLogEntry (see auth.service.ts) — login
    // does (action LOGIN), which is what gives this test a real row to
    // attack.
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);

    const entry = await prisma.auditLogEntry.findFirst({
      where: { user: { email } },
      orderBy: { occurredAt: 'asc' },
    });
    expect(entry).not.toBeNull();

    await expect(
      prisma.$executeRaw`UPDATE "AuditLogEntry" SET "action" = 'DELETE' WHERE id = ${entry!.id}`,
    ).rejects.toThrow(/immutable/i);

    await expect(
      prisma.$executeRaw`DELETE FROM "AuditLogEntry" WHERE id = ${entry!.id}`,
    ).rejects.toThrow(/immutable/i);

    // Confirm the row genuinely survived both attempts.
    const stillThere = await prisma.auditLogEntry.findUnique({
      where: { id: entry!.id },
    });
    expect(stillThere).not.toBeNull();
  });
});
