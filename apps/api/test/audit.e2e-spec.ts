import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { prisma } from './tenant-prisma';
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

  /**
   * An EXPLICIT timeout, because this test has no headroom under its inherited one.
   *
   * Measured: 99.5 seconds in isolation, against the suite default of 180 s in
   * `vitest-e2e.config.ts` — 55% of budget before any other file has touched the database.
   * It boots the Nest app, signs a user up and logs them in (two bcrypt hashes at the
   * configured cost) and then attacks the row at the database layer, and every one of those
   * stretches when eight other spec files have run first.
   *
   * It duly failed once inside a batch and passed alone and on re-run, which reads exactly
   * like a flake and is not one — see IMPROVEMENTS.md § 1.22. A test that needs more than
   * half its budget when nothing else is running will fail when something else is.
   */
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
  }, 600_000);
});
