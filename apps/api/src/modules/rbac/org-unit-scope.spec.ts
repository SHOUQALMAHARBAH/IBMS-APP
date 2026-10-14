import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

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
 * THE SCOPE LINE, AS A TEST.
 *
 * Departments and branches were built as the smallest thing that makes the person form honest:
 * named, office-scoped units and nothing else. No hierarchy, no manager, no cost centre — and,
 * critically, **nothing that decides access**. The full org model is still Phase 4.
 *
 * "Minimal" is the kind of scope that grows quietly. The day something reads `departmentId` to
 * decide what a person may see, this work has become org-structure authorization without anyone
 * choosing that, and it will be discovered by a person who cannot see a record they should.
 *
 * So the line is asserted rather than documented: no guard, no policy, and no permission resolution
 * may read a department or a branch. The scan is deliberately over-broad — it covers every guard and
 * the permission/visibility layer — because a narrow scan is how this kind of rule rots.
 *
 * If this test fails, the question is not "how do I silence it". It is: has the owner decided that
 * departments now govern access? That is a Phase 4 decision with migration and audit consequences.
 */
const AUTHORIZATION_SURFACES = [
  'src/modules/rbac/guards',
  'src/modules/auth/guards',
  'src/modules/rbac/services/permissions.service.ts',
  'src/repositories/permission.repository.ts',
];

/** Reading a unit to DISPLAY or to ASSIGN is fine; these are the shapes that would decide access. */
const FORBIDDEN = [
  /departmentId/,
  /branchId/,
  /\bdepartment\b/i,
  /\bbranch\b/i,
];

function filesUnder(relative: string): string[] {
  const root = join(__dirname, '..', '..', '..');
  const target = join(root, relative);
  const stat = statSync(target, { throwIfNoEntry: false });
  if (!stat) return [];
  if (stat.isFile()) return [target];
  return readdirSync(target)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
    .map((f) => join(target, f));
}

describe('departments and branches decide nothing about access', () => {
  it('appears in no guard and in no permission resolution', () => {
    const offenders: string[] = [];
    for (const surface of AUTHORIZATION_SURFACES) {
      for (const file of filesUnder(surface)) {
        const text = readFileSync(file, 'utf8');
        // Comments are allowed to MENTION them — this file's own reasoning has to be sayable.
        const code = text
          .split('\n')
          .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
          .join('\n');
        for (const pattern of FORBIDDEN) {
          if (pattern.test(code)) {
            offenders.push(
              `${file.replace(/\\/g, '/').split('/apps/api/')[1]} matches ${pattern}`,
            );
          }
        }
      }
    }
    expect(
      offenders,
      'A department or branch reached an authorization surface. That is the Phase 4 decision, not a lint failure — take it to the owner before changing this test.',
    ).toEqual([]);
  });

  it('scans a surface that actually exists, so the guarantee is not vacuous', () => {
    // A path typo would make the test above pass by scanning nothing at all — the exact failure
    // mode of every "we assert the absence of X" test.
    for (const surface of AUTHORIZATION_SURFACES) {
      expect(
        filesUnder(surface).length,
        `${surface} matched no files`,
      ).toBeGreaterThan(0);
    }
  });
});
