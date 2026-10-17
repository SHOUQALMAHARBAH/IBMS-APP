import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * EVERY WIDENED ROUTE IS SPECIFIED BY THE EXACT SET OF ROLES THAT MAY REACH IT — asserted by name.
 *
 * ## THE OWNER'S ACCEPTANCE CRITERION, MADE PERMANENT
 *
 * Her words, 2026-10-17: *"A widening is specified by the EXACT ROLE SET that may reach the route
 * afterwards, asserted BY NAME in a test. It is not specified by which code you add. Before you
 * commit any any-of, measure who else holds the code you are about to name, because the any-of
 * reaches every holder."*
 *
 * And the case she measured to show why: `audit-log.read` looks like the natural partner for a
 * compliance officer and is ALSO held by the security administrator, so naming it would have handed
 * RFQ customer data to a role this project already refused `insurer.create`. **The code can be wrong
 * while the decision is right**, and only the resulting SET can tell you.
 *
 * So this spec is not about codes. For each route below it computes who can actually reach it — the
 * union of the holders of every code the route names, because `PermissionsGuard` is `required.some`
 * — and compares that against a set written out by name. A code swapped for another with different
 * holders fails here even if the count is identical.
 *
 * ## IT READS THE REAL THREE SOURCES AND HOLDS NO COPY OF ANY OF THEM
 *
 *   the route's codes   <- the `@RequirePermissions` decorator in the controller
 *   an office role's codes <- `seed-data/permissions.ts`, the grid, which is the one home
 *   the two provider-side roles <- `PROVIDER_CODES` in the seed and
 *                                  `insurance-company-administrator-grants.ts`
 *
 * A hand-written copy of any of those would be a second home for one fact, and the copy is the one
 * that drifts — which is the argument this repository has made for the `AuditAction` parity guard,
 * the permission grid and the enum descriptions.
 *
 * ## WHY THE PROVIDER-SIDE ROLES ARE READ SEPARATELY, AND THE PROOF THAT MATTERS
 *
 * They are not in the office grid and cannot be: an OFFICE-scoped grid cannot express them. Reading
 * them is also what makes this spec able to state the finding that decided item 1 — the company
 * administrator's six codes are a strict SUBSET of the provider's eleven, so EVERY code shared
 * between the provider and an office role also reaches the company administrator, and only a
 * `provider.*` code can separate them. That is asserted below, because it is the fact a future
 * widening will otherwise rediscover the hard way.
 */

vi.setConfig({ testTimeout: 30_000 });

const API_SRC = join(__dirname, '..', '..');
const REPO = join(API_SRC, '..', '..', '..');
const GRID = join(
  REPO,
  'packages',
  'db',
  'prisma',
  'seed-data',
  'permissions.ts',
);
const SEED = join(REPO, 'packages', 'db', 'prisma', 'seed.ts');
const COMPANY_GRANTS = join(
  API_SRC,
  'modules',
  'provider',
  'insurance-company-administrator-grants.ts',
);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (entry.endsWith('.controller.ts')) out.push(p);
  }
  return out;
}

/** (VERB /path) -> the codes its `@RequirePermissions` names, read from the controller. */
function routeCodes(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const token =
    /@RequirePermissions\(([^)]*)\)|@(Get|Post|Patch|Put|Delete)\(\s*(?:'([^']*)')?\s*\)/g;
  for (const file of walk(API_SRC)) {
    const src = readFileSync(file, 'utf8');
    const prefix = /@Controller\(\s*'([^']*)'/.exec(src)?.[1] ?? '';
    let pending: string[] | null = null;
    let m: RegExpExecArray | null;
    token.lastIndex = 0;
    while ((m = token.exec(src)) !== null) {
      if (m[1] !== undefined) {
        pending = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
        continue;
      }
      const path = [prefix, m[3] ?? ''].filter(Boolean).join('/');
      out.set(`${m[2].toUpperCase()} /${path}`, pending ?? []);
      pending = null;
    }
  }
  return out;
}

/** role name -> codes. Office roles from the grid; the two provider-side roles from the seed. */
function roleCodes(): Map<string, Set<string>> {
  /*
   * COMMENTS STRIPPED FIRST, and this is not hygiene — it was a real defect found by this very spec.
   *
   * The grid's entry for `provider.office-state.read` explains IN A COMMENT that the code used to
   * read `roles: [ADMIN]` before the PROVIDER organization type existed. The parser matched that
   * sentence instead of the real `roles: []` four lines below, and attributed a PLATFORM-scoped code
   * to the security administrator. A comment that QUOTES code is the window artefact this repository
   * keeps recording, and here it had reached a measurement's output.
   */
  const grid = readFileSync(GRID, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const aliases = new Map<string, string>();
  for (const m of grid.matchAll(
    /const\s+([A-Z][A-Z_0-9]*)\s*=\s*RoleName\.([A-Z_]+)\s*;/g,
  )) {
    aliases.set(m[1], m[2]);
  }
  for (const m of grid.matchAll(
    /const\s+([A-Z][A-Z_0-9]*)\s*=\s*["']([A-Z_]+)["']\s*;/g,
  )) {
    aliases.set(m[1], m[2]);
  }
  expect(
    aliases.size,
    'the grid alias parser resolved almost nothing — it has drifted',
  ).toBeGreaterThanOrEqual(10);

  const out = new Map<string, Set<string>>();
  // Split on the entry boundary first, so a `roles:` lookahead can never cross into the next code.
  for (const chunk of grid.split('code:').slice(1)) {
    const code = /^\s*["']([^"']+)["']/.exec(chunk)?.[1];
    const roles = /roles:\s*\[([^\]]*)\]/.exec(chunk)?.[1];
    if (!code || roles === undefined) continue;
    for (const tok of roles.matchAll(/[A-Za-z_]\w*/g)) {
      const name = aliases.get(tok[0]);
      if (!name) continue;
      if (!out.has(name)) out.set(name, new Set());
      out.get(name)!.add(code);
    }
  }

  const seed = readFileSync(SEED, 'utf8');
  const prov = /PROVIDER_CODES[^=]*=\s*\[([\s\S]*?)\]/.exec(seed)?.[1] ?? '';
  out.set(
    'PLATFORM_OPERATOR',
    new Set(
      [...prov.matchAll(/["']([a-z][a-z0-9.-]*\.[a-z0-9.-]+)["']/g)].map(
        (m) => m[1],
      ),
    ),
  );
  const company = readFileSync(COMPANY_GRANTS, 'utf8');
  out.set(
    'INSURANCE_COMPANY_ADMINISTRATOR',
    new Set(
      [...company.matchAll(/["']([a-z][a-z0-9.-]*\.[a-z0-9.-]+)["']/g)].map(
        (m) => m[1],
      ),
    ),
  );
  return out;
}

/**
 * THE DECIDED SETS. One row per route the owner has widened, each carrying her decision and the date.
 *
 * A row is added only with an owner decision, and the SET is what she decided — not the code, which
 * is an implementation detail chosen to produce the set.
 */
const DECIDED: {
  route: string;
  why: string;
  roles: string[];
}[] = [
  {
    route: 'GET /insurance-lines',
    why:
      'Owner, 2026-10-16/17. The 32 standard lines are a GLOBAL catalogue describing the software, ' +
      'and office additions stay tenant-scoped, so reading it discloses nothing about anybody. The ' +
      'provider needs it to register an office or a company; item 3 extends it to the two roles that ' +
      "set a role's line scope and to Finance reading a commission schedule.",
    roles: [
      'BRANCH_DEPARTMENT_MANAGER',
      'COMPLIANCE_OFFICER',
      'EXECUTIVE_MANAGEMENT',
      'EXTERNAL_AUDITOR',
      'FINANCE_COLLECTIONS_OFFICER',
      'INSURANCE_COMPANY_ADMINISTRATOR',
      'OFFICE_ADMINISTRATOR',
      'PLACEMENT_TECHNICAL_OFFICER',
      'PLATFORM_OPERATOR',
      'SALES_RELATIONSHIP_OFFICER',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    ],
  },
  {
    route: 'GET /admin/branches',
    why:
      'Owner, 2026-10-17, item 1 half A. Whoever is trusted to PROVISION a user is trusted to read ' +
      'the two lists the provisioning form makes mandatory. The code is NOT `user.manage`, which ' +
      'reaches a fifth role: `provider.office.administrator.invite` yields exactly this set and, ' +
      'being PLATFORM-scoped, cannot be granted to an office role later.',
    roles: [
      'BRANCH_DEPARTMENT_MANAGER',
      'OFFICE_ADMINISTRATOR',
      'PLATFORM_OPERATOR',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    ],
  },
  {
    route: 'GET /admin/departments',
    why: 'Owner, 2026-10-17, item 1 half A — the same decision as `GET /admin/branches`.',
    roles: [
      'BRANCH_DEPARTMENT_MANAGER',
      'OFFICE_ADMINISTRATOR',
      'PLATFORM_OPERATOR',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    ],
  },
];

describe('a widened route is specified by the exact role set that reaches it', () => {
  const routes = routeCodes();
  const roles = roleCodes();

  it('resolved the three sources, so an empty answer cannot read as a clean one', () => {
    // NON-VACUITY. Every assertion below is of the form "this set equals that set", and a parser
    // that resolved nothing makes every one of them compare empty to empty and pass.
    expect(routes.size).toBeGreaterThan(300);
    expect(roles.size).toBeGreaterThanOrEqual(13);
    expect(roles.get('PLATFORM_OPERATOR')?.size).toBe(11);
    expect(roles.get('INSURANCE_COMPANY_ADMINISTRATOR')?.size).toBe(6);
  });

  describe.each(DECIDED)('$route', ({ route, roles: decided }) => {
    it('names codes that exist and is actually declared on a route', () => {
      const codes = routes.get(route);
      expect(codes, `${route} is not a route in any controller`).toBeDefined();
      expect(
        codes!.length,
        `${route} names no permission at all, so this row proves nothing`,
      ).toBeGreaterThan(0);
    });

    it('is reachable by EXACTLY the decided roles, and by no others', () => {
      const codes = routes.get(route)!;
      // ANY-OF, because `PermissionsGuard` is `required.some`. The union, not the intersection.
      const reach = [...roles.entries()]
        .filter(([, held]) => codes.some((c) => held.has(c)))
        .map(([name]) => name)
        .sort();
      /*
       * AN EXACT SET. A count would survive a substitution — eleven roles could become eleven
       * different roles — which is the assertion class this project spent a module correcting, and
       * the owner restated it here as "a count is not a set".
       */
      expect(reach).toEqual([...decided].sort());
    });
  });

  it('PROVES the company administrator cannot be separated from the provider by any shared code', () => {
    /*
     * THE FACT THAT DECIDED ITEM 1's CODE, asserted so a future widening does not rediscover it.
     *
     * The company administrator's codes are a strict SUBSET of the provider's. So any code held by
     * the provider AND by some office role is necessarily held by the company administrator too, and
     * an any-of naming such a code reaches all three. Only one of the five `provider.*` codes — held
     * by `PLATFORM_OPERATOR` alone — can widen a route to the provider without the company
     * administrator coming with it.
     *
     * If this ever fails because the company administrator gained a code the provider lacks, then
     * item 1's reasoning no longer holds and the `GET /admin/branches` decision needs re-taking.
     */
    const prov = roles.get('PLATFORM_OPERATOR')!;
    const comp = roles.get('INSURANCE_COMPANY_ADMINISTRATOR')!;
    expect([...comp].filter((c) => !prov.has(c))).toEqual([]);

    const office = [...roles.entries()].filter(
      ([n]) =>
        n !== 'PLATFORM_OPERATOR' && n !== 'INSURANCE_COMPANY_ADMINISTRATOR',
    );
    const shared = [...prov].filter((c) =>
      office.some(([, held]) => held.has(c)),
    );
    expect(
      shared.length,
      'no code is shared at all — the parser drifted',
    ).toBeGreaterThan(0);
    for (const code of shared) {
      expect(
        comp.has(code),
        `${code} is shared with an office role but NOT held by the company administrator — the ` +
          "subset property has changed, so item 1's code choice needs re-taking",
      ).toBe(true);
    }
  });
});
