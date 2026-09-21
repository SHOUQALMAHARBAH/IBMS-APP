import { Test, type TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { rawPrisma } from '../tenant-prisma';
import { securityHeaders } from '../../src/common/security-headers.middleware';

/**
 * Mirrors src/main.ts's bootstrap (cookie parsing + global ValidationPipe) —
 * e2e/contract tests build the Nest app directly from AppModule and never
 * run main.ts, so anything registered there has to be repeated here or the
 * test environment silently diverges from production behavior.
 */
/**
 * Fails fast, and legibly, when a previous spec left an Organization behind.
 *
 * ## The failure this converts
 *
 * `POST /auth/signup` refuses once more than one Organization exists — it has no
 * subdomain to resolve against until Phase 4 — and it refuses by throwing a bare
 * `Error`, so the HTTP answer is a generic 500 (IMPROVEMENTS.md § 1.11). Every spec
 * that provisions a user therefore fails with `expected 201, got 500` and nothing
 * anywhere says why.
 *
 * Observed twice. The second time cost a real investigation: eleven tests in
 * `kyc-screening-hold.e2e-spec.ts` failed together and passed on re-run, which looks
 * like a flake and was not one. Four spec files create a second Organization in
 * `beforeAll` and remove it in `afterAll`; a run KILLED mid-flight — by a CI limit, a
 * tool timeout, Ctrl-C — never reaches `afterAll`, so the office survives into the next
 * run and poisons whichever file signs a user up first.
 *
 * Those four files each sweep in `beforeAll` as well, so they self-heal. The victim
 * cannot: it has no reason to know about an office it never created. So the check lives
 * HERE, where every spec passes through, and it names the cause instead of leaving eleven
 * 500s to be traced back to a process that was killed ten minutes earlier.
 *
 * Safe to run before the four legitimate creators: every one of them calls
 * `createTestApp()` BEFORE standing its second office up.
 *
 * ## It REFUSES. It does not clean up. Do not make it clean up.
 *
 * The convenience version of this function deletes the extra Organization and carries on —
 * "it is only a test database". Do not write it.
 *
 * A cleanup that runs automatically runs against the wrong database exactly once: a
 * mistyped `DATABASE_URL`, a `.env` copied from the wrong template, a CI job pointed at a
 * shared instance, a developer who ran the e2e suite with the dev env-file loaded. What it
 * deletes there is not a fixture — it is a real brokerage office, and every user, policy,
 * claim and invoice hanging off it. There is no version of that trade that is worth the
 * keystrokes it saves.
 *
 * Refusing costs one person one minute and tells them exactly which spec to re-run.
 * Deleting costs somebody an office. The guard is allowed to be inconvenient; that is the
 * feature, not a rough edge to be filed off.
 *
 * (`apps/api/test/tenant-prisma.ts` is pointed at `.env.test` by the e2e config, so the
 * accident is not likely here today. It does not need to be likely. It needs to be
 * impossible, and the way to make it impossible is to not write the delete.)
 */
async function assertOneOrganization(): Promise<void> {
  const orgs = await rawPrisma.organization.findMany({
    select: { id: true, legalName: true, subdomain: true },
    orderBy: { createdAt: 'asc' },
  });
  if (orgs.length <= 1) return;
  const extra = orgs
    .slice(1)
    .map((o) => `${o.legalName} (${o.subdomain}, ${o.id})`)
    .join('; ');
  throw new Error(
    `${orgs.length} Organizations exist in the test database, so POST /auth/signup ` +
      `will refuse with a bare 500 and every spec that provisions a user will fail for ` +
      `no visible reason. A previous spec leaked one, by one of TWO routes: its afterAll ` +
      `never ran (a killed run), or its afterAll ran and EXCEEDED ITS BUDGET — vitest ` +
      `aborts a hook at 10s by default and the sweep is then half-done, which is what ` +
      `actually happened the first time this message fired. Check the owning spec's ` +
      `teardown budget before assuming a crash. Leftover: ${extra}. Re-run the spec that ` +
      `owns that id — it sweeps on entry, BEFORE createTestApp, so it heals itself — or ` +
      `remove the row, then run again. See IMPROVEMENTS.md § 1.11, § 1.22 and § 1.31.`,
  );
}

export async function createTestApp(): Promise<INestApplication<App>> {
  await assertOneOrganization();
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.use(cookieParser());
  // No-ops here (NODE_ENV isn't 'production' under vitest) — registered
  // anyway so a test that sets NODE_ENV=production mid-run gets the real
  // behavior instead of a silent gap.
  app.use(securityHeaders());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  return app;
}
