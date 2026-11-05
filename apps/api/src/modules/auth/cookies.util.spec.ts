import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CookieOptions, Response } from 'express';
import { hashToken } from '../../common/crypto.util';
import {
  REFRESH_TOKEN_COOKIE,
  clearRefreshTokenCookie,
  setRefreshTokenCookie,
} from './cookies.util';

/*
 * THE FOURTH CONDITION ON THIS REPOSITORY'S ONLY DISMISSED HIGH-SEVERITY ADVISORY.
 *
 * ## Why this file exists, and it is not coverage for its own sake
 *
 * Measured 2026-11-05 against the GitHub code-scanning API: exactly ONE alert has ever existed on the
 * default branch — `js/clear-text-storage-of-sensitive-data`, severity HIGH, at `cookies.util.ts:33`,
 * raised 2026-08-26 and DISMISSED sixteen minutes later as a false positive. The dismissal comment,
 * verbatim:
 *
 *     "Raw refresh token is only ever hashed (SHA-256) server-side; its one destination is an
 *      httpOnly+secure+sameSite=strict cookie -- the standard opaque-bearer-token pattern."
 *
 * That reasoning is correct. It was also, until this file, backed by NOTHING but prose — and this
 * repository's own rule is explicit: **an acknowledged advisory needs a test pinning its premise, not
 * prose; that is the fourth condition and it is not optional.** The advisory was dismissed on a claim
 * about the code, so the claim is what has to be asserted. Measured separately: this file was one of
 * four `*.util.ts` files in `apps/api/src` with no sibling spec at all.
 *
 * ## What the premise is, split into the two halves that can be pinned
 *
 * (a) THE COOKIE'S FLAGS. `httpOnly` (unreadable by page JS, so immune to XSS exfiltration),
 *     `sameSite: 'strict'`, `path: '/auth'` (never sent on ordinary API calls), and `secure` under
 *     production. Remove any one and the dismissal stops being true — and nothing failed.
 *
 * (b) THE SERVER PERSISTS ONLY THE HASH. Asserted here as the property the dismissal names: the value
 *     handed to the cookie is NOT the value a database leak would yield, because `hashToken` is not
 *     the identity function. The persistence call itself belongs to `TokenService` /
 *     `SessionService`; what is pinned here is the one-way step the whole argument rests on.
 *
 * ## `secure` IS FROZEN AT MODULE LOAD, which is why two tests re-import
 *
 * `baseOptions` is a module-level constant evaluating `process.env.NODE_ENV === 'production'` once.
 * Setting the variable after import changes nothing, so a naive test would assert the dev value in
 * both directions and pass while proving half as much. In production the environment is set before
 * the process starts, so the constant is correct there — but the only honest way to test both states
 * is `vi.resetModules()` plus a dynamic import, which is what the last block does.
 *
 * AND NOTE WHAT THAT MEANS HERE: `NODE_ENV` is assigned nowhere in this repository (not `.env`, not
 * `turbo.json`, not any workspace `package.json`), so `secure` is FALSE in local development and in
 * the test suite. That is correct — a `secure` cookie is never sent over plain http and local dev has
 * no TLS — and it is recorded because it looks like a defect to a first reader.
 */

interface Captured {
  name: string;
  value: string;
  options: CookieOptions;
}

function fakeResponse(): {
  res: Response;
  set: Captured[];
  cleared: Captured[];
} {
  const set: Captured[] = [];
  const cleared: Captured[] = [];
  // No `return this` for chaining: `this` is untyped inside an object literal, so returning it is an
  // `any` escaping into a file whose whole subject is a security property. Neither function under
  // test chains, so the fake does not need to either.
  const res = {
    cookie(name: string, value: string, options: CookieOptions): void {
      set.push({ name, value, options });
    },
    clearCookie(name: string, options: CookieOptions): void {
      cleared.push({ name, value: '', options });
    },
  } as unknown as Response;
  return { res, set, cleared };
}

/*
 * The re-imported module's own shape, loaded through `vi.importActual` rather than a bare
 * `await import()`.
 *
 * THAT IS NOT A STYLE CHOICE — `tsc` REFUSED THE BARE FORM, and vitest and eslint both passed it.
 * This package sets `module`/`moduleResolution` to `nodenext`, which applies ESM resolution rules to
 * a DYNAMIC import while leaving the static one alone. So `import('./cookies.util')` wants the
 * `./cookies.util.js` extension and fails with TS2307 — three times, in a file whose own static
 * `import ... from './cookies.util'` at the top resolves perfectly. Exactly the shape this
 * repository's register already records: vitest does not typecheck, lint does not typecheck, and
 * only `tsc` sees it.
 *
 * `vi.importActual` takes a plain string, so TypeScript performs no module resolution on it at all,
 * and its generic parameter gives the result a real type — which also removed the `any` the lint
 * rules had objected to in the bare form. It is the semantically correct call too: "load the real
 * module, bypassing mocks", which is what re-reading a frozen module-level constant needs.
 */
type CookiesModule = { setRefreshTokenCookie: typeof setRefreshTokenCookie };

const RAW_TOKEN = 'wQ1kP7vY2mB9nR4tL6sX8jC3hF5dG0aZ';
const EXPIRES = new Date('2026-12-31T23:59:59.000Z');

describe('setRefreshTokenCookie — the flags the advisory dismissal names', () => {
  it('is httpOnly, so page JavaScript cannot read it and XSS cannot exfiltrate it', () => {
    const { res, set } = fakeResponse();
    setRefreshTokenCookie(res, RAW_TOKEN, EXPIRES);
    expect(set).toHaveLength(1);
    expect(set[0].options.httpOnly).toBe(true);
  });

  it('is sameSite=strict, so no cross-site request carries it', () => {
    const { res, set } = fakeResponse();
    setRefreshTokenCookie(res, RAW_TOKEN, EXPIRES);
    expect(set[0].options.sameSite).toBe('strict');
  });

  /*
   * PATH-SCOPED TO /auth. This is the flag most easily lost to a "tidy-up", and losing it means the
   * refresh token rides along on every ordinary API call — widening its exposure from two routes
   * (refresh, logout) to the whole surface for no benefit at all.
   */
  it('is scoped to /auth, so it is not sent on ordinary API calls', () => {
    const { res, set } = fakeResponse();
    setRefreshTokenCookie(res, RAW_TOKEN, EXPIRES);
    expect(set[0].options.path).toBe('/auth');
  });

  it('is set under the expected name with the caller’s expiry', () => {
    const { res, set } = fakeResponse();
    setRefreshTokenCookie(res, RAW_TOKEN, EXPIRES);
    expect(set[0].name).toBe(REFRESH_TOKEN_COOKIE);
    expect(set[0].options.expires).toBe(EXPIRES);
  });

  /*
   * A SESSION COOKIE WOULD BE A DIFFERENT PRODUCT DECISION. Without `expires` the cookie dies with the
   * browser process, so "keep me signed in" stops working — and it would do so silently, because
   * every security flag above would still read as correct.
   */
  it('always carries an expiry, so the cookie is not browser-session-scoped by accident', () => {
    const { res, set } = fakeResponse();
    setRefreshTokenCookie(res, RAW_TOKEN, EXPIRES);
    expect(set[0].options.expires).toBeInstanceOf(Date);
  });
});

describe('setRefreshTokenCookie — the hashing half of the premise', () => {
  /*
   * THE DISMISSAL'S ACTUAL CLAIM: the raw value's one home is this cookie, and what the server
   * persists is a SHA-256 hash, so a database leak cannot yield a usable token. The one-way step is
   * what makes that true, and it is asserted rather than described.
   */
  it('the value in the cookie is NOT what a database leak would yield', () => {
    const { res, set } = fakeResponse();
    setRefreshTokenCookie(res, RAW_TOKEN, EXPIRES);

    const persisted = hashToken(RAW_TOKEN);
    expect(set[0].value).toBe(RAW_TOKEN);
    expect(persisted).not.toBe(RAW_TOKEN);
    expect(set[0].value).not.toBe(persisted);
    // SHA-256 in hex. If `hashToken` were ever replaced by something reversible or by a passthrough,
    // the dismissal's premise would be gone and this is where that shows.
    expect(persisted).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the hash is deterministic, which is what makes a lookup by hash possible at all', () => {
    expect(hashToken(RAW_TOKEN)).toBe(hashToken(RAW_TOKEN));
    expect(hashToken(RAW_TOKEN)).not.toBe(hashToken(RAW_TOKEN + 'x'));
  });

  it('does not transform the token on its way to the cookie', () => {
    // The cookie must carry the raw secret: hashing it here would make the token the server stores
    // and the token the browser presents the same value, which is the defect the split exists to
    // avoid — a leak of either side would then be a usable credential.
    const { res, set } = fakeResponse();
    setRefreshTokenCookie(res, RAW_TOKEN, EXPIRES);
    expect(set[0].value).toBe(RAW_TOKEN);
  });
});

describe('clearRefreshTokenCookie', () => {
  /*
   * A BROWSER ONLY REMOVES A COOKIE WHEN THE ATTRIBUTES MATCH. A `clearCookie` with a different path
   * or sameSite leaves the original in place — so logout would return 200 and the refresh token would
   * still be in the jar, which is the quietest possible failure of a logout.
   */
  it('clears with the same name, path, httpOnly and sameSite the cookie was set with', () => {
    const { res, set, cleared } = fakeResponse();
    setRefreshTokenCookie(res, RAW_TOKEN, EXPIRES);
    clearRefreshTokenCookie(res);

    expect(cleared).toHaveLength(1);
    expect(cleared[0].name).toBe(set[0].name);
    for (const key of ['path', 'httpOnly', 'sameSite', 'secure'] as const) {
      expect(cleared[0].options[key], `${key} must match the set options`).toBe(
        set[0].options[key],
      );
    }
  });

  it('does not carry an expiry of its own', () => {
    const { res, cleared } = fakeResponse();
    clearRefreshTokenCookie(res);
    expect(cleared[0].options.expires).toBeUndefined();
  });
});

describe('the secure flag, which is decided once at module load', () => {
  const ORIGINAL = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = ORIGINAL;
    vi.resetModules();
  });

  it('is true under production', async () => {
    process.env.NODE_ENV = 'production';
    const mod = await vi.importActual<CookiesModule>('./cookies.util');
    const { res, set } = fakeResponse();
    mod.setRefreshTokenCookie(res, RAW_TOKEN, EXPIRES);
    expect(set[0].options.secure).toBe(true);
  });

  it('is false otherwise, because local development has no TLS', async () => {
    process.env.NODE_ENV = 'development';
    const mod = await vi.importActual<CookiesModule>('./cookies.util');
    const { res, set } = fakeResponse();
    mod.setRefreshTokenCookie(res, RAW_TOKEN, EXPIRES);
    expect(set[0].options.secure).toBe(false);
  });

  /*
   * AND THE FREEZING ITSELF, asserted — because it is the reason the two tests above re-import. A
   * future reader who "simplifies" them into one that flips the variable in place would get a test
   * that passes while proving nothing, and this is the test that explains why.
   */
  it('is frozen at import, so flipping the variable afterwards changes nothing', async () => {
    process.env.NODE_ENV = 'development';
    const mod = await vi.importActual<CookiesModule>('./cookies.util');

    process.env.NODE_ENV = 'production';
    const { res, set } = fakeResponse();
    mod.setRefreshTokenCookie(res, RAW_TOKEN, EXPIRES);

    expect(set[0].options.secure).toBe(false);
  });
});
