import { it, expect } from 'vitest';
import { PrismaClient } from '@ibms/db';

/**
 * Unlocks the demo accounts so a human can sign in.
 *
 * ## The problem this exists for, measured on the dev database
 *
 * `seed-demo.script.ts` enrols each demo actor in TOTP because it needs MFA to call the real API.
 * The secret it generates lives in that process and is never shown to anyone, so an account left
 * in that state is **permanently unusable by a person**: the password works, the login returns
 * `mfaRequired: true`, and every code the human types is genuinely wrong server-side while being
 * perfectly correct in their authenticator app.
 *
 * That presents as *"I set up MFA, it showed a code, I entered it, and it says the code is
 * wrong."* It is not a TOTP bug. It is this.
 *
 * The seed already ends by releasing every actor and then FAILS if any is still locked — but both
 * guardrails were written after a run that had already stranded sixteen accounts, so a database
 * seeded before them keeps the damage, and the only repair was to re-run the whole multi-minute
 * seed. Measured on dev 2026-09-23: **ten** `demo.*` accounts still locked, each holding one
 * credential nobody has the secret for.
 *
 * This is that repair on its own, in seconds.
 *
 * ## What it does and does not touch
 *
 * Deletes the `MfaCredential` rows and sets `mfaEnabled = false` for demo accounts, so the next
 * sign-in takes the ordinary forced-enrolment path and the person pairs their own authenticator.
 *
 * It does **not** touch passwords — deliberately. A password is credential material and this
 * script has no business inventing one; if you do not know the demo password, re-run
 * `npm run seed:demo` with `DEMO_PASSWORD` set, which re-hashes every reused account.
 *
 * ## Safety
 *
 * Runs against whatever `.env` points at (the DEV database) and refuses if that looks like the
 * test database, because clearing MFA under a running e2e suite would make its failures
 * inexplicable. It only ever matches emails of the form `demo.*@*.ibms.internal`, which is the
 * shape `seed-demo.script.ts` mints and nothing else uses.
 *
 * Usage:  npm run demo:release -w api
 */

const DEMO_EMAIL_PREFIX = 'demo.';
const DEMO_EMAIL_SUFFIX = '.ibms.internal';

it('releases every demo login from a prompt nobody can answer', async () => {
  const url = process.env.DATABASE_URL ?? '';
  // The dev database is the only correct target. `ibms_test` is where the e2e suite lives, and
  // clearing MFA mid-run there would produce failures nobody could explain.
  expect(
    url.includes('ibms_test'),
    `DATABASE_URL points at what looks like the TEST database (${url.replace(/:[^:@]*@/, ':***@')}). This script is for the dev database — run it through the api workspace script, which loads .env.`,
  ).toBe(false);
  expect(url.length, 'DATABASE_URL is not set; run this through `npm run demo:release -w api`').toBeGreaterThan(0);

  const prisma = new PrismaClient();
  try {
    const locked = await prisma.user.findMany({
      where: {
        email: { startsWith: DEMO_EMAIL_PREFIX, endsWith: DEMO_EMAIL_SUFFIX },
        OR: [{ mfaEnabled: true }, { mfaCredentials: { some: {} } }],
      },
      select: { id: true, email: true, mfaEnabled: true },
    });

    if (locked.length === 0) {
      console.log(
        'No demo account is locked. Every demo.* login is already at the ordinary forced-enrolment step, which is where a human can pair their own authenticator.',
      );
      return;
    }

    console.log(`Releasing ${locked.length} demo account(s):`);
    for (const u of locked) console.log(`  ${u.email}  (mfaEnabled=${u.mfaEnabled})`);

    const ids = locked.map((u) => u.id);
    const removed = await prisma.mfaCredential.deleteMany({
      where: { userId: { in: ids } },
    });
    await prisma.user.updateMany({
      where: { id: { in: ids } },
      // `mustChangePassword` is left ALONE: it is a legitimate state an administrator may have set
      // deliberately, and clearing it would quietly undo that. Only the unanswerable prompt goes.
      data: { mfaEnabled: false },
    });

    // Re-read rather than trust the writes, which is the same post-condition the seed learned to
    // add: the damage is otherwise silent, and "0 failures" is exactly what it reported last time.
    const stillLocked = await prisma.user.findMany({
      where: {
        email: { startsWith: DEMO_EMAIL_PREFIX, endsWith: DEMO_EMAIL_SUFFIX },
        OR: [{ mfaEnabled: true }, { mfaCredentials: { some: {} } }],
      },
      select: { email: true },
    });
    expect(
      stillLocked.map((u) => u.email),
      'a demo account is still behind a prompt nobody can answer after the release ran',
    ).toEqual([]);

    console.log(
      `Done: ${removed.count} credential(s) deleted, ${ids.length} account(s) released. Sign in with the password, then pair an authenticator when the app asks.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}, 120_000);
