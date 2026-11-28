import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 🔴 THE FULL WALK §A ITEM 11 — THE SCREEN'S RE-INVITE TEST AND THE ROUTE'S REFUSAL MUST BE THE
 * SAME PREDICATE, AND ONE OF THEM IS WRITTEN IN SQL.
 *
 * ## The defect this guards
 *
 * `/provider-offices` offered the first-administrator invite only while `users === 0`, and its own
 * comment called that «the honest test» because «the invite route itself refuses once the
 * organization has ANY account». That was true when it was written and stopped being true when
 * `resolveInvitationTarget` gained its REINVITE branch: the route now refuses once somebody has
 * ENTERED. So the one state the REINVITE branch exists for — an account created and never reached,
 * which is what a missing provider mailbox leaves — had no control on any screen.
 *
 * The screen reads `enteredUsers`, a count in the `ProviderOfficeState` view. So there are now TWO
 * copies of one predicate: `lastLoginAt IS NOT NULL OR passwordUpdatedAt IS NOT NULL`, once in
 * TypeScript and once in SQL.
 *
 * ## ⛔ Why the copy exists at all, and why this file is the answer rather than deleting it
 *
 * SQL cannot import a TypeScript predicate, and the view is the only route to another office's
 * rows: `User` is tenant-scoped, so a provider-scoped Prisma read cannot count accounts in an
 * office it does not belong to. That is the same reason the view exists (register entry 97).
 *
 * ⟶ So the copy is forced, and what is NOT forced is leaving it unchecked. This asserts that both
 *   sites name BOTH fields — which is the whole of the predicate — so a change to one that is not
 *   made to the other fails here rather than producing a control that 403s or a row that silently
 *   stops offering one.
 *
 * ⚠️ IT IS A SOURCE-TEXT CHECK AND IT SAYS SO. It cannot prove the two agree on every row; what it
 * can do is fail the moment either side's field set moves, which is the drift that actually
 * happened. The behaviour over real rows is asserted in `provider-office-state.e2e-spec.ts`, where
 * the count comes back from Postgres.
 */

const TARGET = join(__dirname, 'invitation-target.ts');
const MIGRATION = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'packages',
  'db',
  'prisma',
  'migrations',
  '20261228110000_provider_sees_who_entered',
  'migration.sql',
);

/** The two fields that together mean «this account has been used». Both sites must name both. */
const PREDICATE_FIELDS = ['lastLoginAt', 'passwordUpdatedAt'] as const;

describe('the invite predicate has one meaning in two languages', () => {
  const routeSource = readFileSync(TARGET, 'utf8');
  const viewSource = readFileSync(MIGRATION, 'utf8');

  /*
   * ⚠️ THE *LAST* FILTER BEFORE THE ALIAS, NOT THE FIRST. `lastIndexOf` rather than `indexOf`,
   * because the `activeUsers` count directly above it is also a `count(*) FILTER (…)` — and a slice
   * from the first one swallowed it, so `isActive` appeared inside what this file believed was the
   * enteredUsers predicate and the not-anything-else assertion failed on its own first run. A
   * window that is wider than its subject reports a finding about code it is not looking at.
   */
  const enteredFilter = viewSource.slice(
    viewSource.lastIndexOf(
      'count(*) FILTER (',
      viewSource.indexOf('AS "enteredUsers"'),
    ),
    viewSource.indexOf('AS "enteredUsers"'),
  );

  it('both files were found — this is not asserting over empty strings', () => {
    expect(routeSource.length).toBeGreaterThan(500);
    expect(viewSource.length).toBeGreaterThan(500);
    // And the route really is the one that decides, so the comparison below is about the right file.
    expect(routeSource).toContain('resolveInvitationTarget');
    expect(viewSource).toContain('enteredUsers');
  });

  it.each(PREDICATE_FIELDS)(
    'the ROUTE tests %s when deciding whether the organization has been entered',
    (field) => {
      /*
       * Scoped to the `entered` count rather than the whole file: `invitation-target.ts` also
       * explains the predicate in prose, and a comment mentioning a field is not a test of it.
       */
      const entered = routeSource.slice(
        routeSource.indexOf('const entered = await tx.user.count('),
        routeSource.indexOf('if (entered > 0)'),
      );
      expect(
        entered.length,
        'the `entered` count could not be located in invitation-target.ts — this check is stale',
      ).toBeGreaterThan(50);
      expect(entered).toContain(field);
    },
  );

  it.each(PREDICATE_FIELDS)('the VIEW counts %s into enteredUsers', (field) => {
    expect(
      enteredFilter.length,
      'the enteredUsers FILTER could not be located in the migration — this check is stale',
    ).toBeGreaterThan(20);
    expect(enteredFilter).toContain(field);
  });

  it('the view counts NOTHING ELSE into it — a wider predicate would hide a re-invitable office', () => {
    /*
     * THE OTHER DIRECTION, and it is the one that matters more. A predicate the VIEW widened —
     * counting a user row as «entered» on some third field — would make `enteredUsers > 0` where
     * the route still says REINVITE, and the control would disappear again with every test green.
     *
     * Asserted by naming the fields that must NOT appear in the filter: the two the route tests are
     * the whole predicate, and `isActive` / `createdAt` / `mustChangePassword` are the three a
     * later edit would most plausibly reach for.
     */
    for (const stranger of ['isActive', 'createdAt', 'mustChangePassword']) {
      expect(
        enteredFilter.includes(stranger),
        `the enteredUsers filter reads \`${stranger}\`, which is not part of the route's predicate — the screen and the route would disagree`,
      ).toBe(false);
    }
  });

  it('⛔ and the screen does not key the control on lastActivityAt, which is a DIFFERENT question', () => {
    /*
     * `lastActivityAt` is a MAX over `UserSession`, so it is null for somebody who set their
     * password through the invitation link and never completed a session — `passwordUpdatedAt` set,
     * no session row. A screen keyed on it would offer the control where the route answers 409.
     *
     * The screen is allowed to RENDER `lastActivityAt` (it has its own column), so this asserts the
     * narrow thing: the administrator cell's condition reads `enteredUsers`.
     */
    const screen = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        'web',
        'app',
        '(app)',
        'provider-offices',
        'page.tsx',
      ),
      'utf8',
    );
    expect(screen).toContain('office.enteredUsers === 0');
    /*
     * AND THE CONTROL MATCHES THE ROUTE'S BRANCH EXACTLY, not nearly. `resolveInvitationTarget`
     * returns REINVITE only for EXACTLY ONE never-entered account and refuses with two or more —
     * «choosing WHICH of several to keep is not a decision this route can make» — so a control
     * offered on `enteredUsers === 0` alone could 409 on an office with two unentered accounts.
     */
    expect(screen).toContain('office.users === 1');
    expect(routeSource).toContain('if (existing > 1)');
  });
});
