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
 * them is also what let this spec state the finding that decided item 1 — that the company
 * administrator's codes were a strict SUBSET of the provider's, so no shared code could separate the
 * two and only a `provider.*` code could.
 *
 * THE SUBSET NO LONGER HOLDS, by owner decision 11 of 2026-10-17: the company administrator was
 * granted `branch.read` and `department.read`, which the provider does not hold. The assertion is
 * RE-STATED rather than deleted — it now pins the direction of the break (exactly those two codes and
 * no others) and asserts the property item 1 actually rests on, which is that every `provider.*` code
 * is PLATFORM-scoped and reaches the provider alone. That is still true, so item 1's code choice
 * stands.
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
      'INSURANCE_COMPANY_ADMINISTRATOR',
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
      'INSURANCE_COMPANY_ADMINISTRATOR',
      'OFFICE_ADMINISTRATOR',
      'PLATFORM_OPERATOR',
      'SYSTEM_SECURITY_ADMINISTRATOR',
    ],
  },
  {
    route: 'GET /rfqs',
    why:
      'Owner, 2026-10-19, door four completed. The customer-filtered LIST is inside the chain the ' +
      'anchor opens. Safe because this route has NO unfiltered mode — it refuses unless exactly ' +
      'one of opportunityId or customerId is given — so an anchored reader can be handed one ' +
      "customer's chain and never the book. SAME six roles as the detail, because a reader who " +
      'may see an RFQ and not the list it sits in would be a second answer to one question.',
    roles: [
      'BRANCH_DEPARTMENT_MANAGER',
      'COMPLIANCE_OFFICER',
      'DATA_PROTECTION_OFFICER',
      'EXECUTIVE_MANAGEMENT',
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
    ],
  },
  {
    route: 'GET /rfqs/:id',
    why:
      'Owner, 2026-10-19, door four. An oversight role may read one customer RFQ chain while an ' +
      'OPEN piece of work on that customer is assigned to them — not through a blanket ' +
      '`customer-file.all-owners.read`, which was measured to reach 8 services and 46 routes. This ' +
      'gate is only the FIRST layer: `CustomerFileAnchorService` decides WHOSE file, and neither ' +
      'works alone. SIX roles, not the seven first decided: CLAIMS_OFFICER is deliberately absent ' +
      'because its anchor (a claim ASSIGNED to him) is not expressible — `Claim` has no staff user ' +
      'field — so admitting it would swap an honest 403 for a false 404.',
    roles: [
      'BRANCH_DEPARTMENT_MANAGER',
      'COMPLIANCE_OFFICER',
      'DATA_PROTECTION_OFFICER',
      'EXECUTIVE_MANAGEMENT',
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
    ],
  },
  {
    route: 'GET /rfqs/:id/communications',
    why:
      'Owner, 2026-10-19, door four — THE SAME gate as the RFQ itself, deliberately. A reader who ' +
      'may see the RFQ and not its correspondence, or the reverse, would be a second answer to one ' +
      'question. The write (`POST`) keeps `rfq.communication.log` and is untouched.',
    roles: [
      'BRANCH_DEPARTMENT_MANAGER',
      'COMPLIANCE_OFFICER',
      'DATA_PROTECTION_OFFICER',
      'EXECUTIVE_MANAGEMENT',
      'PLACEMENT_TECHNICAL_OFFICER',
      'SALES_RELATIONSHIP_OFFICER',
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
    /*
     * THIRTEEN SINCE THE AUTHORISED MAILBOX WIDENING (decision 25, 2026-10-20) — re-stated
     * deliberately, not relaxed. `PROVIDER_CODES` gained `email.integration.read` and
     * `email.integration.manage` because the invitation that is the only door into a brand-new
     * organization leaves from the PROVIDER's own connected mailbox, and the provider held neither
     * code, so the channel was real in tests and unreachable in life.
     *
     * It is a PIN rather than a floor on purpose: a fourteenth code reaching the provider is a
     * capability decision and must fail here until somebody records it.
     */
    expect(roles.get('PLATFORM_OPERATOR')?.size).toBe(13);
    /*
     * EIGHT SINCE OWNER DECISION 11, 2026-10-17 — re-stated deliberately, not relaxed.
     *
     * It was six. `branch.read` and `department.read` were added because a role trusted to provision
     * users must be able to read the two lists the provisioning form makes mandatory. A pinned SIZE
     * is the point: it is the thing that refuses a NINTH code arriving without a decision, which is
     * the failure mode a tolerant assertion exists to prevent. If this fails, read entry 49 and the
     * grants file's header before changing the number.
     */
    expect(roles.get('INSURANCE_COMPANY_ADMINISTRATOR')?.size).toBe(8);
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

  it("RE-STATED: the subset no longer holds, and item 1's code choice survives anyway", () => {
    /*
     * OWNER DECISION 11, 2026-10-17 — AND THIS TEST BREAKING IS WHAT IT WAS BUILT FOR.
     *
     * The previous assertion was that the company administrator's codes are a strict SUBSET of the
     * provider's, which is what proved that no shared code could separate the two and therefore why
     * item 1 named `provider.office.administrator.invite` rather than `user.manage`. The owner then
     * granted the company administrator `branch.read` and `department.read`, which the provider does
     * NOT hold — so the subset is gone, by decision.
     *
     * Her instruction was explicit: "RE-STATE it, deliberately and in writing; do not delete it and
     * do not relax it." So the replacement says what is now true and why item 1 is unaffected:
     *
     *   1. The subset is BROKEN, and this test asserts the direction of the break — exactly the two
     *      org-unit reads and nothing else. A third code appearing on the company administrator that
     *      the provider lacks fails here, because that would be a capability decision nobody recorded.
     *
     *   2. Item 1's choice survives, and the reason is that it never depended on the subset. It
     *      depended on `provider.*` codes being PLATFORM-scoped and held by `PLATFORM_OPERATOR`
     *      alone, which is still true and is asserted below. A PLATFORM-scoped code still separates
     *      the provider from every office role.
     *
     * What DID change is the asserted role SET for the two widened routes, which is now five — and
     * that is pinned by name in `DECIDED` above rather than inferred here.
     */
    const prov = roles.get('PLATFORM_OPERATOR')!;
    const comp = roles.get('INSURANCE_COMPANY_ADMINISTRATOR')!;

    // The break, by name and in one direction only.
    expect([...comp].filter((c) => !prov.has(c)).sort()).toEqual([
      'branch.read',
      'department.read',
    ]);

    // Still true, and this is the half item 1 actually rests on: every `provider.*` code is held by
    // the provider alone, so naming one in an any-of reaches no office role and no company.
    const providerOnly = [...prov].filter((c) => c.startsWith('provider.'));
    expect(providerOnly.length).toBeGreaterThan(0);
    for (const code of providerOnly) {
      for (const [name, held] of roles) {
        if (name === 'PLATFORM_OPERATOR') continue;
        expect(
          held.has(code),
          `${name} holds ${code}, which is PLATFORM-scoped and should reach the provider alone — ` +
            "item 1's code choice rests on this and would need re-taking",
        ).toBe(false);
      }
    }
  });

  it('the shared-code asymmetry is EXACTLY these codes, in both directions, by name', () => {
    /*
     * THE SECOND BREAK OF ONE PROPERTY, RE-STATED RATHER THAN RELAXED — the same instruction the
     * sibling test above carries, applied to the other direction.
     *
     * ## What this used to assert, and why it was true
     *
     * The company administrator's codes were a strict SUBSET of the provider's. So any code the
     * provider shared with an office role was necessarily on the company administrator too, and an
     * any-of naming such a code reached all three. Only a `provider.*` code — PLATFORM-scoped and
     * held by `PLATFORM_OPERATOR` alone — could widen a route to the provider without the company
     * administrator coming with it. That is the fact item 1's `GET /admin/branches` choice was
     * made on.
     *
     * ## It is broken in BOTH directions now, and this test is the record of exactly how
     *
     *   * company-but-not-provider: `branch.read`, `department.read` — owner decision 11,
     *     2026-10-17, asserted by name in the sibling test above.
     *   * provider-and-offices-but-not-company: `email.integration.read`,
     *     `email.integration.manage` — the authorised mailbox widening, decision 25, 2026-10-20.
     *
     * ## ITEM 1's CHOICE SURVIVES, and the reason is NOT this property
     *
     * It never rested on the subset. It rested on `provider.*` codes being PLATFORM-scoped and
     * held by `PLATFORM_OPERATOR` alone — still true, and still asserted in the sibling test. What
     * the widening adds is a SECOND class of code that reaches the provider and the offices but not
     * the company. That is a new option nobody has chosen, not a contradiction of a choice already
     * made.
     *
     * So the assertion is now the asymmetry ITSELF, by name and in both directions. A THIRD code
     * appearing in either direction fails here, because that would be a capability change nobody
     * recorded — which is the property this test was built to defend, unchanged in strength.
     */
    const prov = roles.get('PLATFORM_OPERATOR')!;
    const comp = roles.get('INSURANCE_COMPANY_ADMINISTRATOR')!;

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

    // Direction one: shared with an office role, and NOT on the company administrator.
    expect(
      shared.filter((c) => !comp.has(c)).sort(),
      'the provider/office-but-not-company set has changed. Two codes are expected and recorded ' +
        '(the mailbox widening, decision 25); a third means a capability moved without a decision',
    ).toEqual(['email.integration.manage', 'email.integration.read']);

    // Direction two: on the company administrator and NOT on the provider. Asserted here as well
    // as in the sibling test on purpose — this file is where a reader comes to ask "what is the
    // relationship between these three role sets", and half an answer sends them to the wrong place.
    expect(
      [...comp].filter((c) => !prov.has(c)).sort(),
      'the company-but-not-provider set has changed (owner decision 11)',
    ).toEqual(['branch.read', 'department.read']);
  });
});
