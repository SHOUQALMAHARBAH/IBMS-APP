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
      `no visible reason. A previous spec leaked one — almost certainly a run killed ` +
      `before its afterAll. Leftover: ${extra}. Re-run the spec that owns that id ` +
      `(each sweeps in beforeAll), or remove it, then run again. See IMPROVEMENTS.md ` +
      `§ 1.11 and § 1.22.`,
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
