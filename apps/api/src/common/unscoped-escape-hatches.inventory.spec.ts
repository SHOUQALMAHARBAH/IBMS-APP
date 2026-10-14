import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/*
 * AN EXPLICIT PER-FILE TIMEOUT, AND IT IS NOT A MITIGATION FOR A FLAKE.
 *
 * This spec READS THE API SOURCE TREE from disk. The measurement is already recorded, in
 * `common/role-scope.inventory.spec.ts`: 6915ms for one such pass under a parallel run, against
 * vitest's 5000ms default — so these guards pass alone every time and fail under load, which looks
 * exactly like flakiness and is I/O cost. Two DIFFERENT source-reading guards failed in two
 * consecutive full `vitest run` passes here, which is the signature of a shared budget problem
 * rather than of either spec.
 *
 * Normally raising a timeout is the wrong move and this repository has a recorded lesson saying so.
 * What makes this the exception is that nothing is hidden: the assertion is correct and the work is
 * genuinely file I/O over hundreds of files.
 *
 * FILE-SCOPED, NEVER GLOBAL. `apps/api` sets no `testTimeout`, and raising it there would also
 * raise the budget for 3,297 ordinary unit tests, where 5s IS a real signal — a hung mock or an
 * unawaited promise. That is precisely the "buys time and hides the next crossing" failure.
 */
vi.setConfig({ testTimeout: 30_000 });

/**
 * MODULE 0-ب ITEM (b)'s COROLLARY — the tenancy boundary is only as strong as the hatches.
 *
 * The owner's words, and they are exactly right:
 *
 *   > Nothing in any service says a provider may not touch an office's role; the boundary is
 *   > tenancy filtering, and the honest proof is a 404. But that means the boundary is only as
 *   > strong as the absence of unscoped paths. A guard that exists only as the absence of a hatch
 *   > needs the hatches counted.
 *
 * `runUnscoped()` is that hatch, and it is legitimate: resolving a session, a refresh token or a
 * login email is literally HOW the organization context gets established, so it cannot already
 * require one.
 *
 * `UnscopedReason` is a CLOSED union of TWO members — `auth-bootstrap` and `subdomain-resolution`.
 * It carried one until 2026-10-13, which meant subdomain resolution was wearing authentication's
 * label: a union reporting ONE reason while serving TWO. Splitting it costs nothing and restores
 * what the closed union is for — a new reason has to be a visible type edit rather than the quiet
 * reuse of a label that does not fit.
 *
 * ## WHY THIS IS A GUARD AND NOT A MEASUREMENT IN A REPORT
 *
 * A count in a report is true on the day it is written. This file is the same measurement made to
 * fail the build the day it stops holding. The properties it pins, measured across all ten call
 * sites at the time of writing:
 *
 *   * EVERY ONE IS A READ. There is not a single write inside a bypass.
 *   * NONE touches `Role`, `RolePermission` or `UserRoleAssignment` — the models that decide what
 *     a user may do. A bypass that read those would let an authentication path answer an
 *     authorization question with another organization's data.
 *   * Four DO read a `User` across organizations, by exact id or email, which is the authentication
 *     case itself and is why `findByEmailAcrossOrganizations` is named the way it is.
 *
 * ## WHAT IT DOES NOT PROVE, SAID PLAINLY
 *
 * It reads SOURCE. It cannot prove that a repository method named like a read does not write, nor
 * follow a call two levels deep. What it catches is the realistic regression: somebody adding a
 * bypass around a role lookup or a write because the scoped client refused them, which is how a
 * tenancy boundary quietly becomes decoration.
 */

const API_SRC = join(__dirname, '..');

/** The models that decide what a user may do. A bypass must never touch one. */
const AUTHORIZATION_MODELS = [
  'role',
  'rolePermission',
  'userRoleAssignment',
  'permission',
];

/** Prisma write operations. A bypass must never perform one. */
const WRITE_OPS = [
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
  '$executeRaw',
  '$executeRawUnsafe',
];

/**
 * Escape EVERY regex metacharacter, not just the one that happened to appear.
 *
 * This read `op.replace('$', '\\$')`, and CodeQL was right to fail the build on it: a STRING
 * pattern in `String.replace` substitutes only the FIRST occurrence, so an operation name carrying
 * two metacharacters would be half-escaped and the regex would quietly mean something other than
 * intended — on a guard whose whole job is to notice a write inside a bypass.
 *
 * It happened to work, because `$executeRaw` has exactly one `$`. "Happens to work for today's
 * inputs" is the same shape as the `|`-escaping defect this repository has already shipped once,
 * where escaping one metacharacter and not the backslash before it produced a live pipe in
 * generated markdown.
 */
function escapeForRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

interface Hatch {
  file: string;
  line: number;
  body: string;
}

/**
 * Every `runUnscoped(` CALL and the text of its callback.
 *
 * Brace-matched rather than line-sliced: two of the ten sites span several lines and a
 * fixed-window read would have truncated them — which on a guard like this means silently not
 * looking at the half that matters.
 */
function findHatches(): Hatch[] {
  const hatches: Hatch[] = [];
  for (const file of sourceFiles(API_SRC)) {
    const text = readFileSync(file, 'utf8');
    const rel = relative(API_SRC, file).split(sep).join('/');
    // The service that DEFINES the hatch is not a caller of it.
    if (rel.endsWith('org-context/org-context.service.ts')) continue;

    let from = 0;
    for (;;) {
      const at = text.indexOf('.runUnscoped(', from);
      if (at === -1) break;
      from = at + 1;

      // Walk from the opening paren to its match, so the whole callback is captured however many
      // lines it spans.
      let depth = 0;
      let end = text.indexOf('(', at);
      const start = end;
      for (; end < text.length; end += 1) {
        if (text[end] === '(') depth += 1;
        else if (text[end] === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      hatches.push({
        file: rel,
        line: text.slice(0, at).split('\n').length,
        body: text.slice(start, end + 1),
      });
    }
  }
  return hatches;
}

describe('runUnscoped — the tenancy escape hatches, counted', () => {
  const hatches = findHatches();

  it('finds the hatches at all — a matcher that stops matching proves nothing', () => {
    /*
     * The non-vacuity floor, and on a guard shaped as "none of the things I found does X" it is
     * the whole ballgame: if the matcher breaks, every assertion below passes over an empty set
     * and the build stays green while the boundary is unguarded.
     *
     * A FLOOR rather than a pin. Pinning the exact count would make this fail every time somebody
     * adds a legitimate auth path, which teaches people to edit the number rather than read it.
     */
    expect(
      hatches.length,
      'no runUnscoped call sites found — the matcher has stopped matching, not the hatches stopped existing',
    ).toBeGreaterThanOrEqual(8);
  });

  it('never reads or writes a model that decides AUTHORIZATION', () => {
    /*
     * The assertion item (b) rests on. The provider holds `role.read` and `user.manage`; what
     * keeps it out of an office is that every query is tenant-filtered. A bypass around a role or
     * grant lookup would hand an authentication path another organization's authorization data,
     * and no test of the 404 would notice.
     */
    const offenders = hatches.filter((h) =>
      AUTHORIZATION_MODELS.some((m) =>
        new RegExp(`\\b${m}\\.[a-zA-Z]`).test(h.body),
      ),
    );
    expect(
      offenders.map((o) => `${o.file}:${o.line}`),
      'a runUnscoped block touches Role/RolePermission/UserRoleAssignment/Permission — the models that decide what a user may do',
    ).toEqual([]);
  });

  it('never WRITES anything', () => {
    // Every one of the ten is a lookup. A write inside a bypass would be a write with no
    // organization at all, which `tenantScopeExtension` exists to make impossible.
    const offenders = hatches.filter((h) =>
      WRITE_OPS.some((op) =>
        new RegExp(`\\.${escapeForRegex(op)}\\s*\\(`).test(h.body),
      ),
    );
    expect(
      offenders.map((o) => `${o.file}:${o.line}`),
      'a runUnscoped block performs a WRITE — a bypass is for resolving who the caller is, never for changing anything',
    ).toEqual([]);
  });

  it('lives only in authentication and organization resolution', () => {
    /*
     * WHERE matters as much as what. These are the two places that genuinely cannot know the
     * organization yet: resolving a credential, and resolving a subdomain before login. A bypass
     * appearing in a business module would mean somebody met the tenant filter and went around it.
     */
    const allowed =
      /^(modules\/auth\/|modules\/organization\/organization-resolution\.service\.ts)/;
    const stray = hatches.filter((h) => !allowed.test(h.file));
    expect(
      stray.map((o) => `${o.file}:${o.line}`),
      'a runUnscoped block outside authentication/organization resolution — a tenant filter that was gone around rather than satisfied',
    ).toEqual([]);
  });
});
