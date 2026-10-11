import { it, expect } from 'vitest';
import { PrismaClient, type Prisma } from '@ibms/db';

/**
 * Unlocks the `sample.*` accounts so a human can sign in.
 *
 * ## Why this exists SEPARATELY from `release-demo-logins.script.ts`
 *
 * Because that script cannot touch these accounts, and the belief that it could is what kept this
 * open. Its `where` clause is `email startsWith 'demo.' endsWith '.ibms.internal'`; every account
 * here is `sample.<role>@ibms.internal`. Run it against a database where only `sample.*` is locked
 * and it reports "No demo account is locked" and changes nothing — a clean result from a tool that
 * never looked at the rows in question.
 *
 * ## The state, measured on dev 2026-10-11 rather than assumed
 *
 * FOUR of eleven `sample.*` accounts carry `mfaEnabled = true` plus a live TOTP credential whose
 * secret nobody holds: `sample.compliance` (2 rows), `sample.manager` (5), `sample.sales` (4),
 * `sample.sysadmin` (1). The other seven hold none and sign in normally.
 *
 * The CONSEQUENCE is the same as the demo case and presents identically — the password works, the
 * login returns `mfaRequired: true`, and every code the person types is genuinely wrong
 * server-side while being perfectly correct in their authenticator app. It is not a TOTP bug.
 *
 * The CAUSE is NOT the same, and copying the demo script's explanation would have been wrong.
 * `packages/db/prisma/seed-data/sample-users.ts` sets no MFA at all — it carries only an email, a
 * role and a shared password. These credentials came from real enrolments during the build:
 * `UserSession` shows Chrome 151/152 sessions for compliance/manager/sales between 2026-08-26 and
 * 2026-09-09, alongside Playwright's HeadlessChrome and the api e2e suite's `node`. Nobody wrote
 * the secrets down because nobody expected to sign in as those accounts again.
 *
 * `sample.sysadmin` was checked separately before being included here, because unpairing an
 * account somebody actually uses locks them out. Its entire history is TWO sessions, both
 * `::1` / `curl/8.7.1`, both on 2026-09-23 — it has never been signed into from a browser, and
 * `docs/first-run.md` (written that same day) mentions `sample.` zero times and routes its reader
 * to `demo.sales`. So the pairing resolves to a loopback developer session driving the HTTP API,
 * not to the owner.
 *
 * ## What it does and does not touch
 *
 * Deletes the `MfaCredential` rows and sets `mfaEnabled = false`, so the next sign-in takes the
 * ordinary forced-enrolment path and the person pairs their own authenticator at
 * `/settings/security` — which is deliberately ungated precisely so every role can reach it.
 *
 * It does NOT touch passwords, and does NOT touch `mustChangePassword`: that is a legitimate state
 * an administrator may have set on purpose, and clearing it would quietly undo their decision.
 * Only the unanswerable prompt goes.
 *
 * It does NOT touch `demo.*`. Seven of those are locked by the same mechanism and are deliberately
 * out of scope here (owner's decision, 2026-10-11 — they block no work); `npm run demo:release -w api`
 * is their repair and this script must not grow into a second one.
 *
 * ## Safety
 *
 * Matches on the SHAPE `sample.*@ibms.internal` rather than a hand-listed four, so it is
 * repeatable and picks up any future account locked the same way; the seven unlocked ones are
 * untouched no-ops. Runs against whatever `.env` points at (the DEV database) and refuses if that
 * looks like the test database, because clearing MFA under a running e2e suite would make its
 * failures inexplicable.
 *
 * Usage:  npm run sample:release -w api
 */

const SAMPLE_EMAIL_PREFIX = 'sample.';
const SAMPLE_EMAIL_SUFFIX = '@ibms.internal';

/** "Locked" is either half being set — a credential with no flag, or a flag with no credential,
 *  both leave somebody facing a prompt they cannot answer.
 *
 *  A FUNCTION rather than a `const ... as const`: the readonly tuple that `as const` produces is
 *  not assignable to Prisma's mutable `UserWhereInput[]`, and the first version of this file
 *  typechecked nowhere while still passing under vitest, which strips types rather than checking
 *  them. A green script run is not evidence that the script compiles. */
function lockedWhere(): Prisma.UserWhereInput {
  return {
    email: { startsWith: SAMPLE_EMAIL_PREFIX, endsWith: SAMPLE_EMAIL_SUFFIX },
    OR: [{ mfaEnabled: true }, { mfaCredentials: { some: {} } }],
  };
}

it('releases every sample login from a prompt nobody can answer', async () => {
  const url = process.env.DATABASE_URL ?? '';
  // The dev database is the only correct target. `ibms_test` is where the e2e suite lives, and
  // clearing MFA mid-run there would produce failures nobody could explain.
  expect(
    url.includes('ibms_test'),
    `DATABASE_URL points at what looks like the TEST database (${url.replace(/:[^:@]*@/, ':***@')}). This script is for the dev database — run it through the api workspace script, which loads .env.`,
  ).toBe(false);
  expect(
    url.length,
    'DATABASE_URL is not set; run this through `npm run sample:release -w api`',
  ).toBeGreaterThan(0);

  const prisma = new PrismaClient();
  try {
    const locked = await prisma.user.findMany({
      where: lockedWhere(),
      select: { id: true, email: true, mfaEnabled: true },
      orderBy: { email: 'asc' },
    });

    if (locked.length === 0) {
      console.log(
        'No sample account is locked. Every sample.* login is already at the ordinary forced-enrolment step, which is where a human can pair their own authenticator.',
      );
      return;
    }

    const ids = locked.map((u) => u.id);

    // Counted separately rather than through `_count` inside the `select` above, which is not on
    // the generated payload type for this client version. Reported per account because "5
    // credentials" and "1" are different stories about how the account got here.
    const perUser = new Map(
      (
        await prisma.mfaCredential.groupBy({
          by: ['userId'],
          where: { userId: { in: ids } },
          _count: { _all: true },
        })
      ).map((g) => [g.userId, g._count._all]),
    );

    console.log(`Releasing ${locked.length} sample account(s):`);
    for (const u of locked) {
      console.log(
        `  ${u.email}  (mfaEnabled=${u.mfaEnabled}, credentials=${perUser.get(u.id) ?? 0})`,
      );
    }
    const removed = await prisma.mfaCredential.deleteMany({
      where: { userId: { in: ids } },
    });
    await prisma.user.updateMany({
      where: { id: { in: ids } },
      data: { mfaEnabled: false },
    });

    // Re-read rather than trust the writes. The demo script learned this the hard way: the damage
    // is otherwise silent, and "0 failures" is exactly what the run that caused it reported.
    const stillLocked = await prisma.user.findMany({
      where: lockedWhere(),
      select: { email: true },
    });
    expect(
      stillLocked.map((u) => u.email),
      'a sample account is still behind a prompt nobody can answer after the release ran',
    ).toEqual([]);

    console.log(
      `Done: ${removed.count} credential(s) deleted, ${ids.length} account(s) released. Sign in with the password from sample-users.ts, then pair an authenticator when the app asks.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}, 120_000);
