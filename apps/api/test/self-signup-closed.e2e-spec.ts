import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp } from './utils/test-app';
import { prisma } from './tenant-prisma';
import {
  selfSignupOpen,
  SELF_SIGNUP_CLOSED_MESSAGE,
} from '../src/modules/auth/self-signup.config';

/**
 * 🔴 OWNER DECISION 140 — THE SELF-SIGNUP DOOR IS CLOSED. «لا ينشئ أحدٌ حساباً في مكتب بلا دعوة.»
 *
 * ## THE FAULT
 *
 * `POST /auth/signup` is `@Public()`, and its only protection was arithmetic:
 * `soleOrganizationIdOrThrow` refuses while the platform holds more than one brokerage office.
 * Dev holds four, so it refuses there — which is exactly why this went unnoticed. **On a platform
 * with one real office, which is the shape this product is sold in, anyone on the internet gets
 * an account inside it.**
 *
 * ## WHY EVERY TEST BELOW SETS AN ENVIRONMENT VARIABLE RATHER THAN `NODE_ENV`
 *
 * Setting `NODE_ENV=production` would ALSO switch on TLS assertions, secure cookies and the rate
 * limiter — the suite would be measuring four things and reporting one, and the rate limiter in
 * particular makes the auth suite unrunnable (its own comment records `429` on the sixth call).
 * `CLOSE_SELF_SIGNUP=true` closes the same door by the same predicate, which is why the predicate
 * has that second arm at all.
 *
 * ⛔ AND IT IS RESTORED IN `afterEach`, not at the end. db-test is shared and cumulative, and a
 * leftover `CLOSE_SELF_SIGNUP` would refuse the user factory of every later spec in the run —
 * surfacing as a fault that looks like each of their own, which is the failure
 * `license-gate.e2e-spec.ts` records paying for once.
 */
describe('OWNER DECISION 140 — self-service signup is closed', () => {
  let app: INestApplication<App> | null = null;

  afterEach(() => {
    delete process.env.CLOSE_SELF_SIGNUP;
  });

  afterAll(async () => {
    delete process.env.CLOSE_SELF_SIGNUP;
    await app?.close();
  });

  async function appInstance(): Promise<INestApplication<App>> {
    app ??= await createTestApp();
    return app;
  }

  /**
   * CRITERION 1 — an unauthenticated request in the production configuration is refused, **and
   * the platform really does hold exactly one brokerage office while it happens.**
   *
   * That second half is the whole test. The pre-existing refusal fires when there is MORE than
   * one office, so a test that merely asserted "signup is refused" would pass on a platform with
   * four and prove nothing about the one case the decision is about. The office count is measured
   * and asserted FIRST, so the assertion below cannot be satisfied by the old behaviour.
   */
  it('CRITERION 1 — refused in the production configuration, with exactly ONE office on the platform', async () => {
    const offices = await prisma.organization.count({
      where: { type: 'BROKERAGE_OFFICE' },
    });
    expect(
      offices,
      'this suite depends on db-test holding exactly one brokerage office: with more than one, ' +
        '`soleOrganizationIdOrThrow` refuses on its own and this test would pass without the ' +
        'decision-140 closure existing at all',
    ).toBe(1);

    process.env.CLOSE_SELF_SIGNUP = 'true';
    const res = await request((await appInstance()).getHttpServer())
      .post('/auth/signup')
      .send({
        fullName: 'Decision 140 Probe',
        email: `d140.closed.${Date.now()}@ibms.test`,
        password: 'Str0ng!Passphrase#2026',
      })
      .expect(403);

    expect((res.body as { message: string }).message).toBe(
      SELF_SIGNUP_CLOSED_MESSAGE,
    );
  });

  /**
   * CRITERION 1, the other half — **no account was created.** A 403 with a row written behind it
   * is the same fault wearing a status code, and the refusal happens before the password policy
   * runs precisely so an anonymous caller cannot probe through a shut door.
   */
  it('CRITERION 1 — and no user row is created by the refused request', async () => {
    const email = `d140.norow.${Date.now()}@ibms.test`;
    process.env.CLOSE_SELF_SIGNUP = 'true';
    await request((await appInstance()).getHttpServer())
      .post('/auth/signup')
      .send({
        fullName: 'Decision 140 Probe',
        email,
        password: 'Str0ng!Passphrase#2026',
      })
      .expect(403);

    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });

  /**
   * CRITERION 2 — the PLANT, as a property rather than as a comment.
   *
   * Production is a HARD override: no environment variable reopens the door. This is what stops
   * somebody "fixing" a deployment by setting a flag, and it is the inversion of
   * `ENABLE_DEV_RESET_TOKEN`'s own rule that a misconfigured flag must never leak in production.
   */
  it('CRITERION 2 — production closes it and NO variable reopens it', () => {
    const realEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.CLOSE_SELF_SIGNUP;
      expect(selfSignupOpen()).toBe(false);

      process.env.CLOSE_SELF_SIGNUP = 'false';
      expect(
        selfSignupOpen(),
        'CLOSE_SELF_SIGNUP=false must NOT reopen the door in production — the flag closes, it ' +
          'never opens',
      ).toBe(false);
    } finally {
      // Restored in a `finally`: a thrown assertion must not leave the whole suite believing it
      // is production, which would switch on the rate limiter for every later file.
      if (realEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = realEnv;
    }
  });

  /**
   * CRITERION 3 — the suite's user factory still works, and **not one test was deleted.**
   *
   * 117 spec files create their users through this route. The decision's third criterion is that
   * they keep working; this asserts the property they all depend on, once, in the file that
   * closed the door.
   */
  it('CRITERION 3 — outside production and unflagged, the door is open for the test suite', async () => {
    expect(selfSignupOpen()).toBe(true);

    const email = `d140.open.${Date.now()}@ibms.test`;
    await request((await appInstance()).getHttpServer())
      .post('/auth/signup')
      .send({
        fullName: 'Decision 140 Factory',
        email,
        password: 'Str0ng!Passphrase#2026',
      })
      .expect(201);

    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });
});
