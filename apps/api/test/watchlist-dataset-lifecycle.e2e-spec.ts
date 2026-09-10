import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { prisma, type RoleName } from '@ibms/db';
import { createTestApp } from './utils/test-app';

/**
 * Part B §6/§7 — the dataset generation lifecycle, against a real Postgres.
 *
 * The property under test, stated precisely:
 *
 *   A screening reads the OLD COMPLETE generation or the NEW COMPLETE
 *   generation. It never observes partially inserted rows, partially removed
 *   rows, or metadata that disagrees with the rows.
 *
 * That property is not provable by reading code — it depends on transaction
 * boundaries and on a partial unique index — so it is exercised here with real
 * concurrent writes and reads.
 */

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
function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}
function secretFromOtpAuthUri(uri: string): string {
  const match = /[?&]secret=([^&]+)/.exec(uri);
  if (!match) throw new Error('No secret in otpauth URI');
  return decodeURIComponent(match[1]);
}

let app: INestApplication<App> | null = null;
async function boot(): Promise<INestApplication<App>> {
  app ??= await createTestApp();
  return app;
}
afterAll(async () => {
  await app?.close();
  app = null;
});

async function makeUser(
  application: INestApplication<App>,
  label: string,
  role: RoleName,
): Promise<{ accessToken: string; id: string }> {
  const email = uniqueEmail(label);
  await request(application.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: `E2E ${label}`, email, password: PASSWORD })
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

  const roleRow = await prisma.role.upsert({
    where: { name: role },
    update: {},
    create: { name: role },
  });
  const existing = await prisma.userRoleAssignment.findFirst({
    where: { userId: body.user.id, roleId: roleRow.id, revokedAt: null },
  });
  if (!existing) {
    await prisma.userRoleAssignment.create({
      data: { userId: body.user.id, roleId: roleRow.id },
    });
  }
  return { accessToken: body.accessToken, id: body.user.id };
}

const SOURCE = 'OFAC_SDN' as const;

/** Remove every generation for this source, and (by cascade) its rows. */
async function resetSource(): Promise<void> {
  await prisma.screeningMatch.updateMany({
    where: { watchlistEntry: { source: SOURCE } },
    data: { watchlistEntryId: null },
  });
  await prisma.watchlistDatasetVersion.deleteMany({
    where: { source: SOURCE },
  });
  await prisma.watchlistEntry.deleteMany({ where: { source: SOURCE } });
}

let seq = 0;
/** Build a generation with `names`, left in `status`. */
async function makeGeneration(
  names: readonly string[],
  status: 'DOWNLOADED' | 'VALIDATED' | 'PUBLISHED',
): Promise<{ id: string; version: string }> {
  seq += 1;
  const now = new Date();
  const version = await prisma.watchlistDatasetVersion.create({
    data: {
      source: SOURCE,
      status,
      version: `${SOURCE}@lifecycle-${Date.now()}-${seq}-${Math.random().toString(36).slice(2)}`,
      recordCount: names.length,
      downloadedAt: now,
      validatedAt: status === 'DOWNLOADED' ? null : now,
      publishedAt: status === 'PUBLISHED' ? now : null,
    },
  });
  await prisma.watchlistEntry.createMany({
    data: names.map((name, i) => ({
      source: SOURCE,
      sourceRecordId: `rec-${i}`,
      fullName: name,
      normalizedName: name.toUpperCase(),
      canonicalTokens: name.toLowerCase().split(' ').sort(),
      syncRunId: 'lifecycle-test',
      datasetVersionId: version.id,
    })),
  });
  return { id: version.id, version: version.version };
}

/** What a screening can actually see: rows reachable through the PUBLISHED
 * generation, read exactly the way the matcher reads them. */
async function visibleNames(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ fullName: string }[]>`
    SELECT e."fullName"
    FROM "WatchlistEntry" e
    JOIN "WatchlistDatasetVersion" v
      ON v."id" = e."datasetVersionId" AND v."status" = 'PUBLISHED'
    WHERE e."source" = 'OFAC_SDN'::"WatchlistSource"
    ORDER BY e."fullName"
  `;
  return rows.map((r) => r.fullName);
}

const OLD = ['Old Alpha', 'Old Beta', 'Old Gamma'];
const NEW = ['New Delta', 'New Epsilon', 'New Zeta', 'New Eta'];

describe('Part B §6 — a generation is invisible until it is published', () => {
  beforeEach(resetSource);

  it('rows written against an unpublished generation are not readable', async () => {
    await boot();
    await makeGeneration(OLD, 'PUBLISHED');
    expect(await visibleNames()).toEqual([...OLD].sort());

    // A sync is now writing the next generation. Every row lands, and NONE of
    // it is visible: this is the window that previously exposed a half-written
    // list to a live screening.
    await makeGeneration(NEW, 'DOWNLOADED');
    expect(await visibleNames()).toEqual([...OLD].sort());

    // Validation passes — still invisible. Validated is not published.
    const staged = await prisma.watchlistDatasetVersion.findFirstOrThrow({
      where: { source: SOURCE, status: 'DOWNLOADED' },
    });
    await prisma.watchlistDatasetVersion.update({
      where: { id: staged.id },
      data: { status: 'VALIDATED', validatedAt: new Date() },
    });
    expect(await visibleNames()).toEqual([...OLD].sort());
  });

  it('the flip is all-or-nothing: never a mixture, never empty', async () => {
    await boot();
    const oldGen = await makeGeneration(OLD, 'PUBLISHED');
    const newGen = await makeGeneration(NEW, 'VALIDATED');

    // Read continuously while the publish transaction runs. Every observation
    // must be one complete generation — the assertion that would have failed
    // against the old upsert-then-prune sync.
    const observations: string[][] = [];
    let reading = true;
    const reader = (async () => {
      while (reading) {
        observations.push(await visibleNames());
      }
      observations.push(await visibleNames());
    })();

    await prisma.$transaction(async (tx) => {
      await tx.watchlistDatasetVersion.update({
        where: { id: oldGen.id },
        data: { status: 'SUPERSEDED', supersededAt: new Date() },
      });
      await tx.watchlistDatasetVersion.update({
        where: { id: newGen.id },
        data: { status: 'PUBLISHED', publishedAt: new Date() },
      });
    });

    reading = false;
    await reader;

    expect(observations.length).toBeGreaterThan(1);
    const oldSorted = [...OLD].sort();
    const newSorted = [...NEW].sort();
    for (const seen of observations) {
      const isOld = JSON.stringify(seen) === JSON.stringify(oldSorted);
      const isNew = JSON.stringify(seen) === JSON.stringify(newSorted);
      expect(
        isOld || isNew,
        `a reader observed an intermediate list: ${JSON.stringify(seen)}`,
      ).toBe(true);
    }
    // And it really did change over: the last read is the new generation.
    expect(observations[observations.length - 1]).toEqual(newSorted);
  });

  it('metadata never disagrees with the rows a reader can see', async () => {
    await boot();
    await makeGeneration(OLD, 'PUBLISHED');
    await makeGeneration(NEW, 'VALIDATED');

    const published = await prisma.watchlistDatasetVersion.findFirstOrThrow({
      where: { source: SOURCE, status: 'PUBLISHED' },
    });
    const visible = await visibleNames();
    expect(visible).toHaveLength(published.recordCount ?? -1);
  });

  it('TWO generations can never be published at once', async () => {
    // The invariant the whole design rests on. If it were representable, a
    // screening would read the union of both and atomicity would be silently
    // gone — so it is a partial UNIQUE index, not a service-layer check.
    await boot();
    await makeGeneration(OLD, 'PUBLISHED');
    const second = await makeGeneration(NEW, 'VALIDATED');

    await expect(
      prisma.watchlistDatasetVersion.update({
        where: { id: second.id },
        data: { status: 'PUBLISHED', publishedAt: new Date() },
      }),
    ).rejects.toThrow();

    expect(await visibleNames()).toEqual([...OLD].sort());
  });

  it('concurrent publishes of the same source: exactly one wins', async () => {
    await boot();
    await makeGeneration(OLD, 'PUBLISHED');
    const a = await makeGeneration(['A One', 'A Two'], 'VALIDATED');
    const b = await makeGeneration(['B One', 'B Two'], 'VALIDATED');

    const flip = (id: string) =>
      prisma.$transaction(async (tx) => {
        const current = await tx.watchlistDatasetVersion.findFirst({
          where: { source: SOURCE, status: 'PUBLISHED' },
        });
        if (current) {
          await tx.watchlistDatasetVersion.update({
            where: { id: current.id },
            data: { status: 'SUPERSEDED', supersededAt: new Date() },
          });
        }
        return tx.watchlistDatasetVersion.update({
          where: { id },
          data: { status: 'PUBLISHED', publishedAt: new Date() },
        });
      });

    const results = await Promise.allSettled([flip(a.id), flip(b.id)]);
    const succeeded = results.filter((r) => r.status === 'fulfilled');
    // At least one must fail or serialise; what matters is the end state.
    expect(succeeded.length).toBeGreaterThanOrEqual(1);

    const publishedNow = await prisma.watchlistDatasetVersion.findMany({
      where: { source: SOURCE, status: 'PUBLISHED' },
    });
    expect(publishedNow).toHaveLength(1);

    const seen = await visibleNames();
    const okA = JSON.stringify(seen) === JSON.stringify(['A One', 'A Two']);
    const okB = JSON.stringify(seen) === JSON.stringify(['B One', 'B Two']);
    expect(okA || okB, `mixed list observed: ${JSON.stringify(seen)}`).toBe(
      true,
    );
  });
});

describe('Part B §7 — an invalid generation cannot become the live one', () => {
  beforeEach(resetSource);

  it('a REJECTED generation is never visible and states why', async () => {
    await boot();
    await makeGeneration(OLD, 'PUBLISHED');
    const bad = await makeGeneration(['Truncated Feed'], 'DOWNLOADED');
    await prisma.watchlistDatasetVersion.update({
      where: { id: bad.id },
      data: {
        status: 'REJECTED',
        rejectedAt: new Date(),
        rejectionReason: 'Parsed only 1 record(s), below the floor of 10.',
      },
    });

    // Last known good remains live.
    expect(await visibleNames()).toEqual([...OLD].sort());
    const row = await prisma.watchlistDatasetVersion.findUniqueOrThrow({
      where: { id: bad.id },
    });
    expect(row.rejectionReason).toContain('below the floor');
    expect(row.publishedAt).toBeNull();
  });

  it('the database refuses a REJECTED generation with no stated reason', async () => {
    await boot();
    const bad = await makeGeneration(['x'], 'DOWNLOADED');
    await expect(
      prisma.watchlistDatasetVersion.update({
        where: { id: bad.id },
        data: { status: 'REJECTED', rejectedAt: new Date() },
      }),
    ).rejects.toThrow();
  });

  it('the database refuses a published generation with no publish timestamp', async () => {
    await boot();
    const gen = await makeGeneration(['x'], 'VALIDATED');
    await expect(
      prisma.watchlistDatasetVersion.update({
        where: { id: gen.id },
        data: { status: 'PUBLISHED' },
      }),
    ).rejects.toThrow();
  });
});

describe('Part B §6 — rollback', () => {
  beforeEach(resetSource);

  it('restores the previous generation, and requires a written reason', async () => {
    await boot();
    const good = await makeGeneration(OLD, 'PUBLISHED');
    const bad = await makeGeneration(NEW, 'VALIDATED');

    await prisma.$transaction(async (tx) => {
      await tx.watchlistDatasetVersion.update({
        where: { id: good.id },
        data: { status: 'SUPERSEDED', supersededAt: new Date() },
      });
      await tx.watchlistDatasetVersion.update({
        where: { id: bad.id },
        data: { status: 'PUBLISHED', publishedAt: new Date() },
      });
    });
    expect(await visibleNames()).toEqual([...NEW].sort());

    // A rollback with no reason is refused by the database.
    await expect(
      prisma.watchlistDatasetVersion.update({
        where: { id: good.id },
        data: { rolledBackFromId: bad.id },
      }),
    ).rejects.toThrow();

    // With a reason, the previous generation becomes live again — complete.
    await prisma.$transaction(async (tx) => {
      await tx.watchlistDatasetVersion.update({
        where: { id: bad.id },
        data: { status: 'SUPERSEDED', supersededAt: new Date() },
      });
      await tx.watchlistDatasetVersion.update({
        where: { id: good.id },
        data: {
          status: 'PUBLISHED',
          publishedAt: new Date(),
          supersededAt: null,
          rolledBackFromId: bad.id,
          rollbackReason: 'The 18:00 feed was truncated; reverting.',
        },
      });
    });

    expect(await visibleNames()).toEqual([...OLD].sort());
    const restored = await prisma.watchlistDatasetVersion.findUniqueOrThrow({
      where: { id: good.id },
    });
    expect(restored.rolledBackFromId).toBe(bad.id);
    expect(restored.rollbackReason).toContain('truncated');
  });
});

describe('Part B §6 — a historical screening stays tied to its generation', () => {
  beforeEach(resetSource);

  it('the recorded dataset version outlives the generation itself', async () => {
    // `ScreeningResult.datasetVersion` is a STRING label, deliberately, not a
    // foreign key: retention reclaims old generations, and a compliance record
    // saying which list a decision was made against must not go null when that
    // happens.
    await boot();
    const gen = await makeGeneration(OLD, 'PUBLISHED');

    const customer = await prisma.customer.create({
      data: {
        customerType: 'INDIVIDUAL',
        legalName: 'Dataset Link E2E Subject',
        ownerUserId: 'lifecycle-test',
      },
    });
    const kyc = await prisma.kYCRecord.create({
      data: { customerId: customer.id, createdByUserId: 'lifecycle-test' },
    });
    const result = await prisma.screeningResult.create({
      data: {
        kycRecordId: kyc.id,
        screeningType: 'SANCTIONS',
        result: 'CLEAR',
        attemptOutcome: 'NO_MATCH',
        datasetVersion: gen.version,
      },
    });

    // Retention reclaims the generation and, by cascade, its rows.
    await prisma.watchlistDatasetVersion.delete({ where: { id: gen.id } });
    expect(
      await prisma.watchlistEntry.count({
        where: { datasetVersionId: gen.id },
      }),
    ).toBe(0);

    const after = await prisma.screeningResult.findUniqueOrThrow({
      where: { id: result.id },
    });
    expect(after.datasetVersion).toBe(gen.version);
  });
});

describe('Part B — dataset operations are permission-gated', () => {
  it('a Sales Officer cannot read or roll back generations', async () => {
    const application = await boot();
    const sales = await makeUser(
      application,
      'dataset-sales',
      'SALES_RELATIONSHIP_OFFICER',
    );
    const compliance = await makeUser(
      application,
      'dataset-compliance',
      'COMPLIANCE_OFFICER',
    );

    await request(application.getHttpServer())
      .get('/watchlist-sync/datasets')
      .set(bearer(sales.accessToken))
      .expect(403);

    await request(application.getHttpServer())
      .post('/watchlist-sync/datasets/some-id/rollback')
      .set(bearer(sales.accessToken))
      .send({ reason: 'attempting without permission' })
      .expect(403);

    await request(application.getHttpServer())
      .get('/watchlist-sync/datasets')
      .set(bearer(compliance.accessToken))
      .expect(200);
  });

  it('a rollback with no stated reason is refused', async () => {
    const application = await boot();
    const compliance = await makeUser(
      application,
      'dataset-rollback',
      'COMPLIANCE_OFFICER',
    );
    await resetSource();
    const good = await makeGeneration(OLD, 'PUBLISHED');
    const next = await makeGeneration(NEW, 'VALIDATED');
    await prisma.$transaction(async (tx) => {
      await tx.watchlistDatasetVersion.update({
        where: { id: good.id },
        data: { status: 'SUPERSEDED', supersededAt: new Date() },
      });
      await tx.watchlistDatasetVersion.update({
        where: { id: next.id },
        data: { status: 'PUBLISHED', publishedAt: new Date() },
      });
    });

    await request(application.getHttpServer())
      .post(`/watchlist-sync/datasets/${good.id}/rollback`)
      .set(bearer(compliance.accessToken))
      .send({})
      .expect(400);

    const res = await request(application.getHttpServer())
      .post(`/watchlist-sync/datasets/${good.id}/rollback`)
      .set(bearer(compliance.accessToken))
      .send({ reason: 'The newer feed was truncated; reverting to 18:00.' })
      .expect(201);
    expect((res.body as { status: string }).status).toBe('PUBLISHED');
    expect(await visibleNames()).toEqual([...OLD].sort());
  });
});
