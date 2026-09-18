import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Office-scoped custom RBAC, PHASE 2 workstream B — an inventory guard.
 *
 * `@RequireRoles` and `RolesGuard` authorized by role NAME. A name is unique
 * only within one office, so the gate could not express "an administrator of
 * THIS office": it hard-blocked every custom role from the 19 routes that
 * carried it, whatever permissions that role had been granted. All 19 already
 * carried an equivalent `@RequirePermissions`, so removing the name gate
 * changed no effective access — and the permission gate is now the only one.
 *
 * ## Why an inventory spec and not just the deletion
 *
 * Deleting the files stops the mechanism existing, but nothing stops someone
 * re-adding a `roles.includes('...')` check inside a guard or writing a fresh
 * decorator that does the same thing. This is the cheap standing check, in the
 * house pattern of `float-money.inventory.spec.ts`: a property the build
 * asserts, so a reviewer does not have to notice.
 *
 * Comments are stripped before matching, so a comment explaining the removal
 * (there is one in `auth.module.ts`) does not trip it, and a future comment
 * about this history will not either.
 */

const API_SRC = join(__dirname, '..', '..', '..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      out.push(...sourceFiles(full));
      continue;
    }
    // This file itself names both identifiers — in its own regex literals,
    // which comment-stripping cannot hide. Scanning it would make the guard
    // permanently red at itself.
    if (entry.endsWith('.ts') && full !== __filename) out.push(full);
  }
  return out;
}

/** Drops block comments and line comments, leaving executable text. Not a
 *  parser: it does not try to respect a `//` inside a string literal, which is
 *  the conservative direction — it can only ever hide LESS than it should, and
 *  the identifiers below never appear inside string literals here. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

function offenders(pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const file of sourceFiles(API_SRC)) {
    const code = stripComments(readFileSync(file, 'utf8'));
    const lines = code.split('\n');
    lines.forEach((line, index) => {
      if (pattern.test(line)) {
        hits.push(
          `${relative(API_SRC, file).split(sep).join('/')}:${index + 1}: ${line.trim()}`,
        );
      }
    });
  }
  return hits;
}

describe('no route is gated on a role NAME', () => {
  it('has no @RequireRoles decorator anywhere', () => {
    // Reintroducing this means re-authoring the decorator, which is visible in
    // review. This is the second line of defence.
    expect(offenders(/@RequireRoles\b/)).toEqual([]);
  });

  it('has no RolesGuard, and no metadata key for one', () => {
    expect(offenders(/\bRolesGuard\b/)).toEqual([]);
    expect(offenders(/\bREQUIRE_ROLES_KEY\b/)).toEqual([]);
  });

  it('has no guard that reads request.user.roles', () => {
    // The shape a reimplementation would take. `AuthenticatedUser.roles` still
    // exists and is legitimate for display and diagnostics — what must not come
    // back is a GUARD deciding access from it.
    const guardFiles = sourceFiles(API_SRC).filter((f) =>
      f.endsWith('.guard.ts'),
    );
    const bad: string[] = [];
    for (const file of guardFiles) {
      const code = stripComments(readFileSync(file, 'utf8'));
      if (/\.roles\b/.test(code)) {
        bad.push(relative(API_SRC, file).split(sep).join('/'));
      }
    }
    expect(bad).toEqual([]);
  });
});
