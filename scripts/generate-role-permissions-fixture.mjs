#!/usr/bin/env node
/**
 * Regenerates `apps/web/e2e/fixtures/role-permissions.ts` from the SEEDED DATABASE.
 *
 * ## Why this script exists
 *
 * That fixture is the THIRD copy of the role -> permission grid (the seed is the source, the
 * API resolves the second at runtime, and Playwright mocks `/auth/me` with this one). Its own
 * header has said "GENERATED from permissions.ts — regenerate rather than hand-edit" since it
 * was written, and **no generator existed**: the instruction named a tool nobody had built, so
 * the only way to follow it was to hand-edit and hope. A stale copy has already broken four
 * Playwright tests across three files, because a mock missing a permission renders an empty
 * nav and the sidebar helpers fail CLOSED by design.
 *
 * ## Why the database and not `permissions.ts`
 *
 * Because the database is what `/auth/me` actually answers from, and this fixture exists to
 * imitate `/auth/me`. `permissions.ts` is the seed's INPUT; reading it would reproduce the
 * grid as declared rather than as granted, and those differ precisely when something has gone
 * wrong — a code added after an office was created, a grant the seed upserts but never
 * removes. Reading the database makes this a measurement of the deployed grid.
 *
 * Roles are per-office since RBAC Phase 1, so this reads the DEFAULT organization's roles —
 * the ones the seed grants to, and the ones the fixture's legacy machine names refer to.
 *
 * ## A GENERATOR'S OUTPUT IS NOT EVIDENCE ABOUT THE GENERATOR
 *
 * The rule this script exists to illustrate as much as to serve. Its first run produced a file
 * that looked right, was valid TypeScript, passed `tsc`, and had **silently dropped
 * `permissionsForRoles()` — an export 86 Playwright spec files import.** Every gate a generated
 * file normally passes would have passed. The whole web suite would have failed on the next run,
 * in files with no connection to the change.
 *
 * It was caught by reading `git diff` on the generated file, and nothing else could have caught
 * it: a green typecheck says the output is well-formed, never that it is complete. **Read the
 * first diff of anything you generate, line by line, before you trust the tool that made it** —
 * and read it again the first time the template changes.
 *
 * So `permissionsForRoles()` is part of the emitted template rather than something a human
 * re-adds afterwards. If the fixture grows another export, it belongs HERE.
 *
 * ## And why the instruction now names something real
 *
 * The fixture's header said "GENERATED from permissions.ts — regenerate rather than hand-edit"
 * while no generator existed. That is an instruction pointing at a tool nobody built, the same
 * shape as a refusal message naming an endpoint that was never implemented: the only way to
 * follow it was to do the opposite and hope. An instruction that cannot be followed is worse
 * than none, because it reads as a process that is being observed. `--check` is what makes this
 * one enforceable rather than aspirational — `verify.sh` runs it, so a stale copy is a named red
 * gate instead of four confusing Playwright failures somewhere else.
 *
 * Usage:  node scripts/generate-role-permissions-fixture.mjs [--check]
 *         npm run db:fixture:permissions
 *
 * `--check` writes nothing and exits non-zero if the file is out of date, so CI or
 * `verify.sh` can gate on it rather than trusting a developer to remember.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const OUT = 'apps/web/e2e/fixtures/role-permissions.ts';
const CHECK_ONLY = process.argv.includes('--check');

const prisma = new PrismaClient();

/** The office whose roles the seed grants to. Matches `seed.ts`'s own default. */
const DEFAULT_SUBDOMAIN = 'default';

async function main() {
  const org = await prisma.organization.findFirst({
    where: { subdomain: DEFAULT_SUBDOMAIN },
    select: { id: true },
  });
  if (org === null) {
    throw new Error(
      `No Organization with subdomain "${DEFAULT_SUBDOMAIN}". Run \`npm run db:seed\` first — this script reads the granted grid, not the declared one, so it needs a seeded database.`,
    );
  }

  const roles = await prisma.role.findMany({
    where: { organizationId: org.id },
    select: {
      name: true,
      permissions: { select: { permission: { select: { code: true } } } },
    },
    orderBy: { name: 'asc' },
  });
  if (roles.length === 0) {
    throw new Error(
      `The default office has no roles. Run \`npm run db:seed\`; an empty grid here would generate a fixture that makes every Playwright nav assertion fail closed.`,
    );
  }

  const body = roles
    .map((role) => {
      const codes = role.permissions
        .map((grant) => grant.permission.code)
        .sort((a, b) => a.localeCompare(b, 'en'));
      const lines = codes.map((code) => `    '${code}',`).join('\n');
      return `  ${role.name}: [\n${lines}\n  ],`;
    })
    .join('\n');

  const total = roles.reduce((n, r) => n + r.permissions.length, 0);
  const generated = `/*
 * The seeded role -> permission grid, mirrored for Playwright.
 *
 * These specs mock \`/auth/me\` rather than signing in for real, so the mock
 * has to return the same \`permissions\` array the live endpoint would — the
 * sidebar and every §10.4 control render from that field, and a mock without
 * it silently renders an empty nav (the helpers fail CLOSED by design).
 *
 * DO NOT HAND-EDIT. Regenerate with:
 *
 *     npm run db:fixture:permissions
 *
 * which reads the SEEDED DATABASE — what \`/auth/me\` actually answers from —
 * rather than \`permissions.ts\`, which is the seed's input and would reproduce
 * the grid as declared instead of as granted. \`--check\` fails without writing,
 * so a stale copy is a red gate rather than four confusing Playwright failures.
 *
 * ${roles.length} roles, ${total} grants, from the default office.
 */
export const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
${body}
};

/** The union of every given role's codes, sorted — the shape \`/auth/me\`
 *  returns. */
export function permissionsForRoles(roles: readonly string[]): string[] {
  const set = new Set<string>();
  for (const role of roles) {
    for (const code of ROLE_PERMISSIONS[role] ?? []) set.add(code);
  }
  return [...set].sort();
}
`;

  if (CHECK_ONLY) {
    const current = readFileSync(OUT, 'utf8');
    if (current === generated) {
      console.log(
        `role-permissions fixture: up to date (${roles.length} roles, ${total} grants).`,
      );
      return;
    }
    console.error(
      `role-permissions fixture: STALE. ${OUT} does not match the seeded grid (${roles.length} roles, ${total} grants).\n\nRegenerate it:  npm run db:fixture:permissions\n\nThis is the third copy of the grid; a stale one makes Playwright render an empty nav and fail in files that have nothing to do with the change.`,
    );
    process.exitCode = 1;
    return;
  }

  writeFileSync(OUT, generated);
  console.log(
    `role-permissions fixture: wrote ${OUT} (${roles.length} roles, ${total} grants).`,
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
