import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { approvalCounts, approvedTypes } from './employee-cbj-approval.config';
import {
  looksLikeCbjApproval,
  CBJ_IN_LICENSED_ROLE_REFUSAL,
} from '../../common/is-not-cbj-approval.validator';

/**
 * MODULE 0 ITEM (g)'s TWO LOAD-BEARING PROPERTIES, GUARDED.
 *
 * ## 1. The approval marker is NOT an authorization input
 *
 * The owner's own framing: the marker "exists to support vacancy timers and the training counter
 * later, not to become a second role system". Item (h) is where scope enters the authorization path,
 * and it enters on the ROLE.
 *
 * That is easy to state and easy to erode: a permission check that also consulted a person's CBJ
 * standing would be a second authorization system with no catalogue, no matrix and no screen that
 * lists it — and it would fail in the worst direction, because a suspended approval would silently
 * remove capabilities an administrator can see granted on the Role screen and cannot see withdrawn
 * anywhere.
 *
 * So the test reads the AUTHORIZATION PATH ITSELF and requires the marker to be absent from it.
 *
 * ## 2. `licensedRole` cannot become a second home for the approval again
 *
 * Every DTO declaring `licensedRole` must carry `@IsNotCbjApproval()`. Measured rather than listed:
 * the check finds the declarations, so a third one added later is covered without anybody
 * remembering to extend a list.
 */

const API_SRC = join(__dirname, '../../..', 'src');

/**
 * The files that DECIDE whether a caller holds a permission.
 *
 * Deliberately a short, named list rather than "every file mentioning a permission code": a
 * controller naming a code in `@RequirePermissions` is a DECLARATION, and there are hundreds of
 * them. These are the places an answer is computed, which is where a second input would have to be
 * smuggled in. Each is asserted to EXIST, so a rename turns this into a failure rather than a guard
 * silently covering nothing.
 */
const AUTHORIZATION_PATH = [
  'modules/rbac/guards/permissions.guard.ts',
  'modules/rbac/services/permissions.service.ts',
  'repositories/permission.repository.ts',
  'modules/auth/services/session.service.ts',
  'modules/auth/auth.types.ts',
  'common/rbac-visibility.util.ts',
];

/** Every spelling of the marker a permission decision could reach for. */
const MARKER_NAMES = [
  'cbjApprovalStatus',
  'cbjApprovalDate',
  'cbjApproval',
  'EmployeeCbjApprovalBranch',
  'EmployeeCbjApprovalRepository',
  'EmployeeCbjApprovalService',
  'approvalCounts',
  'approvedTypes',
];

function readIfPresent(relative: string): string | null {
  const path = join(API_SRC, relative);
  try {
    if (!statSync(path).isFile()) return null;
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

describe('item (g): the CBJ approval marker is not an authorization input', () => {
  it('every file in the named authorization path exists — the guard is not covering nothing', () => {
    // Without this, renaming `permissions.service.ts` would turn the check below into a loop over
    // zero files that passes. This repository has been bitten by a measurement that found nothing
    // and read exactly like a measurement that found no problem.
    for (const relative of AUTHORIZATION_PATH) {
      expect(
        readIfPresent(relative),
        `${relative} is named in AUTHORIZATION_PATH and does not exist — it was renamed or moved, and this guard is now checking one file fewer than it claims. Re-point it rather than deleting the row.`,
      ).not.toBeNull();
    }
  });

  it('NO permission decision reads the marker', () => {
    for (const relative of AUTHORIZATION_PATH) {
      const source = readIfPresent(relative);
      if (source === null) continue; // the test above is what fails for this
      for (const name of MARKER_NAMES) {
        expect(
          source.includes(name),
          `${relative} mentions \`${name}\`. Module 0 item (g)'s marker records a person's CBJ ` +
            `standing and must not take part in an authorization decision — item (h) puts scope on ` +
            `the ROLE. A capability that depended on this would be withdrawn by a CBJ suspension ` +
            `with nothing on the Role screen to show it. See employee-cbj-approval.config.ts.`,
        ).toBe(false);
      }
    }
  });

  it('and the permission guard really is the file that decides — not vacuous', () => {
    // The complement of the assertion above: proving the marker is absent is only meaningful if
    // these files are the ones making the decision. Asserted on what the guard DOES.
    const guard = readIfPresent('modules/rbac/guards/permissions.guard.ts');
    expect(guard).toContain('required');
    const service = readIfPresent(
      'modules/rbac/services/permissions.service.ts',
    );
    expect(service).toContain('findCodesForRoles');
  });
});

describe('item (g): licensedRole cannot become a second home for the approval', () => {
  /** Every `.ts` file under `src`, so a new DTO anywhere is covered without a list. */
  function allSources(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) allSources(full, out);
      else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts'))
        out.push(full);
    }
    return out;
  }

  it('every DTO declaring licensedRole carries the refusal', () => {
    const offenders: string[] = [];
    let declarations = 0;

    for (const file of allSources(API_SRC)) {
      const source = readFileSync(file, 'utf8');
      // The DECLARATION, not a mention: a service reading `dto.licensedRole` is not a place the
      // refusal belongs, and matching mentions would flag every consumer.
      const index = source.indexOf('licensedRole?: string;');
      if (index === -1) continue;
      // The decorators sit immediately above the property. 400 characters is comfortably more than
      // the five decorators on it and far less than the next member.
      const preceding = source.slice(Math.max(0, index - 400), index);

      // Only a VALIDATED property, which is what the first run of this guard taught: it flagged
      // `EmployeeRepository`'s own input interfaces, which declare the same field and are not a
      // request boundary — a class-validator decorator on a plain TypeScript interface does
      // nothing at all. The discriminator is "does this property carry a class-validator
      // decorator", measured from the source rather than from a list of filenames, so a DTO added
      // in a new directory is still covered.
      if (!/@Is\w+\(/.test(preceding)) continue;

      declarations += 1;
      if (!preceding.includes('@IsNotCbjApproval()')) {
        offenders.push(file.replace(API_SRC, 'src'));
      }
    }

    expect(
      declarations,
      'no DTO declares `licensedRole?: string;` — the match text changed and this guard is now checking nothing.',
    ).toBeGreaterThanOrEqual(2);

    expect(
      offenders,
      'a DTO declares `licensedRole` without `@IsNotCbjApproval()`. Since Module 0 item (g) the CBJ ' +
        'broker approval has a structured marker (status, date, approved branches); the free-text ' +
        'column is for OTHER certifications. Without the decorator the second home comes back one ' +
        'record at a time and item (f)’s staffing count reads a field that no longer holds every ' +
        'approval.',
    ).toEqual([]);
  });

  it('the refusal recognises both spellings that were in the data, and names where to go', () => {
    // Not invented examples: these are the two strings measured in the two databases before the
    // migration moved them (47 on dev, 7 on db-test).
    expect(looksLikeCbjApproval('CBJ Licensed Insurance Broker')).toBe(true);
    expect(looksLikeCbjApproval('CBJ-licensed Broker Representative')).toBe(
      true,
    );
    // And something that is genuinely another certification is left alone.
    expect(looksLikeCbjApproval('Chartered Insurance Institute, Dip CII')).toBe(
      false,
    );
    expect(looksLikeCbjApproval(null)).toBe(false);
    expect(looksLikeCbjApproval(undefined)).toBe(false);

    // A refusal that does not say where the fact belongs sends the writer back to the same field.
    expect(CBJ_IN_LICENSED_ROLE_REFUSAL).toContain('approved branches');
    expect(CBJ_IN_LICENSED_ROLE_REFUSAL).toContain('item (g)');
  });
});

describe('item (g): the derived type and the counted status', () => {
  it('a type is never approved without a branch behind it', () => {
    expect(approvedTypes([])).toEqual([]);
    expect(approvedTypes([{ category: 'LIFE' }])).toEqual(['LIFE']);
  });

  it('types come back in CATALOGUE order, not insertion order', () => {
    // The property that keeps two screens from listing one person's approval differently.
    expect(
      approvedTypes([{ category: 'LIFE' }, { category: 'GENERAL' }]),
    ).toEqual(['GENERAL', 'LIFE']);
    expect(
      approvedTypes([{ category: 'GENERAL' }, { category: 'LIFE' }]),
    ).toEqual(['GENERAL', 'LIFE']);
  });

  it('duplicates of one category collapse to one type', () => {
    expect(
      approvedTypes([
        { category: 'GENERAL' },
        { category: 'GENERAL' },
        { category: 'GENERAL' },
      ]),
    ).toEqual(['GENERAL']);
  });

  it('ONLY a CURRENT approval counts toward minimum staff', () => {
    // The two that must not count are the point of having a status at all: an office cannot meet a
    // staffing minimum with somebody the CBJ has stood down.
    expect(approvalCounts('CURRENT')).toBe(true);
    expect(approvalCounts('SUSPENDED')).toBe(false);
    expect(approvalCounts('CANCELLED')).toBe(false);
    expect(approvalCounts(null)).toBe(false);
    expect(approvalCounts(undefined)).toBe(false);
  });
});
