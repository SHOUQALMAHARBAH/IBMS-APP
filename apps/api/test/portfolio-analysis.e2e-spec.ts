import { afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { ensureRole, prisma } from './tenant-prisma';
import { type RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';
import { makeInsurer } from './insurer-fixture';
import { PortfolioAnalysisRepository } from '../src/repositories/portfolio-analysis.repository';
import { OrgContextService } from '../src/common/org-context/org-context.service';

const PASSWORD = 'Correct-Horse-Battery-Staple-9';

function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@ibms.test`;
}
function uniqueLabel(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
interface PortfolioBreakdownRowBody {
  key: string;
  policyCount: number;
  totalIssuedPremiumJod: string;
}
interface PortfolioAnalysisSummaryBody {
  generatedAt: string;
  byLine: PortfolioBreakdownRowBody[];
  byInsurer: PortfolioBreakdownRowBody[];
  byClientSegment: PortfolioBreakdownRowBody[];
  byGeography: PortfolioBreakdownRowBody[];
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
    .send({
      fullName: 'Portfolio Analysis E2E User',
      email,
      password: PASSWORD,
    })
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
    const role = await ensureRole(roleName);
    // Partial UNIQUE `UserRoleAssignment_one_active_per_user_role` (migration
    // 20260920140000) means a revoked grant is HISTORY and a new grant is a
    // new row — so this creates one only when no active grant exists, rather
    // than resurrecting a revoked one and erasing its audit trail.
    const activeGrant = await prisma.userRoleAssignment.findFirst({
      where: { userId: user.id, roleId: role.id, revokedAt: null },
    });
    if (!activeGrant) {
      await prisma.userRoleAssignment.create({
        data: { userId: user.id, roleId: role.id },
      });
    }
  }
  return { accessToken, userId: user.id };
}

function findRow(
  rows: PortfolioBreakdownRowBody[],
  key: string,
): PortfolioBreakdownRowBody | undefined {
  return rows.find((r) => r.key === key);
}

describe('Portfolio Analysis (e2e) — backlog Part C #62', () => {
  afterAll(async () => {
    if (sharedApp) await sharedApp.close();
    sharedApp = undefined;
  });

  it('gates the summary behind portfolio-analysis.view', async () => {
    const app = await boot();
    const outsider = await makeUser(
      app,
      'pa-outsider',
      'SALES_RELATIONSHIP_OFFICER',
    );

    await request(app.getHttpServer())
      .get('/portfolio-analysis')
      .set(bearer(outsider.accessToken))
      .expect(403);
  });

  it('breaks the real portfolio down by line, insurer, client segment, and geography', async () => {
    const app = await boot();
    const manager = await makeUser(
      app,
      'pa-manager',
      'BRANCH_DEPARTMENT_MANAGER',
    );

    // Uniquely-named fixtures so byLine/byInsurer/byGeography can be
    // asserted EXACTLY, even against db-test's cumulative book — only
    // byClientSegment (CORPORATE/INDIVIDUAL, a closed 2-value set shared by
    // the whole book) needs a before/after delta instead.
    const insurer = await makeInsurer(uniqueLabel('Portfolio E2E Insurer'));
    const branch = await prisma.branch.create({
      data: { name: uniqueLabel('Portfolio E2E Branch') },
    });
    const line = uniqueLabel('portfolio-e2e-line');

    const officer = await prisma.user.create({
      data: {
        fullName: 'Portfolio E2E Officer',
        email: uniqueEmail('pa-officer'),
        passwordHash: 'unused-scored-user',
        branchId: branch.id,
      },
    });

    const corpCustomer = await prisma.customer.create({
      data: {
        customerType: 'CORPORATE',
        legalName: uniqueLabel('Portfolio E2E Corp Co'),
        ownerUserId: officer.id,
      },
    });
    const indivCustomer = await prisma.customer.create({
      data: {
        customerType: 'INDIVIDUAL',
        legalName: 'Portfolio E2E Individual',
        ownerUserId: officer.id,
      },
    });

    const before = (
      await request(app.getHttpServer())
        .get('/portfolio-analysis')
        .set(bearer(manager.accessToken))
        .expect(200)
    ).body as PortfolioAnalysisSummaryBody;
    const corpBefore =
      findRow(before.byClientSegment, 'CORPORATE')?.policyCount ?? 0;
    const indivBefore =
      findRow(before.byClientSegment, 'INDIVIDUAL')?.policyCount ?? 0;

    const opportunity1 = await prisma.opportunity.create({
      data: { customerId: corpCustomer.id },
    });
    await prisma.policy.create({
      data: {
        opportunityId: opportunity1.id,
        customerId: corpCustomer.id,
        insurerId: insurer.id,
        insuranceLine: line,
        requestedPremium: '1000.000',
        issuedPremium: '1000.000',
      },
    });
    const opportunity2 = await prisma.opportunity.create({
      data: { customerId: indivCustomer.id },
    });
    await prisma.policy.create({
      data: {
        opportunityId: opportunity2.id,
        customerId: indivCustomer.id,
        insurerId: insurer.id,
        insuranceLine: line,
        requestedPremium: '2000.000',
        issuedPremium: '2000.000',
      },
    });

    const after = (
      await request(app.getHttpServer())
        .get('/portfolio-analysis')
        .set(bearer(manager.accessToken))
        .expect(200)
    ).body as PortfolioAnalysisSummaryBody;

    const lineRow = findRow(after.byLine, line);
    expect(lineRow).toEqual({
      key: line,
      policyCount: 2,
      totalIssuedPremiumJod: '3000.000',
    });

    const insurerRow = findRow(after.byInsurer, insurer.name);
    expect(insurerRow).toEqual({
      key: insurer.name,
      policyCount: 2,
      totalIssuedPremiumJod: '3000.000',
    });

    const geographyRow = findRow(after.byGeography, branch.name);
    expect(geographyRow).toEqual({
      key: branch.name,
      policyCount: 2,
      totalIssuedPremiumJod: '3000.000',
    });

    const corpAfter = findRow(after.byClientSegment, 'CORPORATE');
    const indivAfter = findRow(after.byClientSegment, 'INDIVIDUAL');
    expect(corpAfter?.policyCount).toBe(corpBefore + 1);
    expect(indivAfter?.policyCount).toBe(indivBefore + 1);
  });
  /*
   * ROW 85 — THE CAPPED READ IS DETERMINISTIC NOW. Added 2026-11-06 (module 0-c batch 6).
   *
   * `findPoliciesForCrossTableGrouping` was `take: limit` with NO `orderBy`. SQL guarantees nothing
   * about the order of an unordered read, so once the book outgrew the cap, WHICH policies fed the
   * client-segment and geography breakdowns was the query plan's choice — and both figures could
   * change between two openings of the same screen with no data having changed.
   *
   * Exercised through the REPOSITORY rather than over HTTP, because the limit is a parameter and the
   * route always passes `PORTFOLIO_ANALYSIS_READ_LIMIT` (5,000) — a figure no fixture should try to
   * exceed. `app.get(...)` is the established way to reach one: `last-administrator-lock`,
   * `company-record-shape` and `brokerage-office-registration` all do it.
   *
   * WHY THIS FAILS ON THE OLD CODE rather than passing by luck: the three policies are inserted in
   * strictly ASCENDING premium order, and Postgres appends new rows to the end of the heap, so an
   * unordered sequential scan returns them ascending. A descending-monotonicity assertion over the
   * whole result therefore fails on the old behaviour by construction, not by chance.
   */
  it('row 85 — the capped cross-table read is ordered, so the breakdown cannot change between openings', async () => {
    const app = await boot();
    const repo = app.get(PortfolioAnalysisRepository);
    const orgContext = app.get(OrgContextService);
    const line = uniqueLabel('ordering-line');

    /*
     * `runAs` is REQUIRED, and finding that out is worth recording: calling the repository bare
     * raised `MissingOrgContextError` — *"Refusing to run Policy.findMany() with no Organization in
     * context"* — which is `tenantScopeExtension` doing exactly its job. A repository reached through
     * DI rather than through a request has no office established, and the extension refuses rather
     * than returning every office's rows. `runAs` is the same code path a request takes after
     * `JwtStrategy` has established the office, which `last-administrator-lock.e2e-spec.ts` sets as
     * the precedent.
     */
    const office = await prisma.organization.findFirstOrThrow({
      where: { type: 'BROKERAGE_OFFICE' },
    });
    const read = (limit: number) =>
      orgContext.runAs(office.id, () =>
        repo.findPoliciesForCrossTableGrouping(limit),
      );

    // Its own fixtures, like every other test in this file — db-test is cumulative and shared, so a
    // test that borrowed another one's rows would pass or fail on the order they happened to run in.
    const insurer = await makeInsurer(uniqueLabel('Ordering E2E Insurer'));
    const officer = await prisma.user.create({
      data: {
        fullName: 'Ordering E2E Officer',
        email: uniqueEmail('pa-ordering-officer'),
        passwordHash: 'unused-scored-user',
      },
    });
    const corpCustomer = await prisma.customer.create({
      data: {
        customerType: 'CORPORATE',
        legalName: uniqueLabel('Ordering E2E Corp Co'),
        ownerUserId: officer.id,
      },
    });

    // Premiums ascending AND above anything a sibling spec is likely to hold, so the top-1 case
    // below is unambiguous about which row it must return.
    const premiums = ['900001.000', '900002.000', '900003.000'];
    for (const issuedPremium of premiums) {
      const opportunity = await prisma.opportunity.create({
        data: { customerId: corpCustomer.id },
      });
      await prisma.policy.create({
        data: {
          opportunityId: opportunity.id,
          customerId: corpCustomer.id,
          insurerId: insurer.id,
          insuranceLine: line,
          requestedPremium: issuedPremium,
          issuedPremium,
        },
      });
    }

    // THE PROPERTY, asserted over the whole result rather than over a sample: premiums are
    // non-increasing. This is what `orderBy` guarantees and what nothing guaranteed before.
    const all = await read(100000);
    expect(all.length).toBeGreaterThan(premiums.length);
    for (let i = 1; i < all.length; i += 1) {
      expect(
        all[i - 1].issuedPremium.greaterThanOrEqualTo(all[i].issuedPremium),
        `row ${i - 1} (${all[i - 1].issuedPremium.toString()}) must not be smaller than row ${i} (${all[i].issuedPremium.toString()})`,
      ).toBe(true);
    }

    // And the cap keeps the premium-heaviest policies, which is the half that makes a TRUNCATED
    // breakdown the least distorted one available rather than merely a stable one.
    const topOne = await read(1);
    expect(topOne).toHaveLength(1);
    expect(topOne[0].issuedPremium.toFixed(3)).toBe('900003.000');
  });
});
