/**
 * CAN EVERY ROLE THAT NEEDS A PICKER ACTUALLY REACH ITS SEARCH ROUTE?
 *
 *     npx dotenv -e .env      -- node scripts/measurements/picker-route-reachability.mjs
 *     npx dotenv -e .env.test -- node scripts/measurements/picker-route-reachability.mjs
 *
 * This is the measurement behind the owner's rule that a picker's search route is gated on ANY OF the
 * permissions of the screens that use it. The rule exists because the opposite was shipped twice:
 *
 *   1. `GET /employees/search` was gated on `employee.national-id.reveal`, the narrowest code in the
 *      whole employee family, because that is the flow it was first built for. Measured: that code is
 *      held by COMPLIANCE_OFFICER alone, while both screens that type an `employeeId` are gated on
 *      codes held by BRANCH_DEPARTMENT_MANAGER and EXECUTIVE_MANAGEMENT. So an Executive could not
 *      find an employee — on a screen built for them.
 *   2. `GET /customers/search` was gated on `customer.read`, which is right for nine of the ten roles
 *      that need it and wrong for the DATA_PROTECTION_OFFICER: they hold `dsr.log` and NOT
 *      `customer.read`, and `/dsr` is the screen whose whole purpose is theirs. Found by this script,
 *      in a field shipped the day before it.
 *
 * ## Why this reads the DATABASE and the SCREENS, not the route decorators
 *
 * A decorator says which codes the guard accepts. It cannot say whether anybody who needs the route
 * holds one of them — that is a fact about the seeded grid, and it is the fact that decides whether a
 * person is stuck. `picker-route-permissions.py` reads the screens; this reads the grant rows and joins
 * the two by hand, because the join is the answer.
 *
 * ## What it CANNOT see
 *
 * An office's own custom roles. It reads `isSystem` roles only, which is the seeded grid — the same
 * choice the permission-fixture generator makes, and for the same reason: an office that unchecks a box
 * on the Role screen creates a state this script would otherwise report as a defect in the product.
 */
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CONFIG = 'apps/api/src/common/picker-search.config.ts';

/**
 * THE ROUTE SIDE IS PARSED, NEVER COPIED.
 *
 * A hand-kept copy of the gate lists here would be a second home for them, and this script's whole job
 * is to catch a route and its screens disagreeing — a copy that drifts would report a clean result for
 * a gate nobody actually ships. So the arrays are read out of the API's own config file.
 *
 * Deliberately a narrow parse of a declarative `export const X = [...] as const;` and nothing cleverer:
 * if somebody computes a list, this throws rather than guessing, which is the right failure.
 */
function routeCodes(constName) {
  const source = readFileSync(CONFIG, 'utf8');
  const match = new RegExp(
    `export const ${constName} = \\[([^\\]]*)\\] as const;`,
  ).exec(source);
  if (!match) {
    throw new Error(
      `${CONFIG} has no plain array export named ${constName}. If it was renamed, fix this script; ` +
        'if it became computed, this measurement cannot read it and must not pretend to.',
    );
  }
  const codes = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  if (codes.length === 0) throw new Error(`${constName} parsed to zero codes`);
  return codes;
}

/**
 * Each picker: the codes its ROUTE accepts (parsed above), and the codes the SCREENS that use it are
 * gated on.
 *
 * The screen lists come from `scripts/measurements/picker-route-permissions.py` — run that first if a
 * screen has been added, because a stale list here reports a clean result for a picker nobody can
 * reach.
 */
const PICKERS = {
  customer: {
    route: routeCodes('CUSTOMER_SEARCH_CODES'),
    screens: {
      communications: ['communication.send'],
      complaints: ['complaint.log'],
      dsr: ['dsr.log'],
      feedback: ['feedback.log'],
      'retention-cases': ['retention-case.manage'],
      'service-requests': ['service-request.manage'],
      'transaction-monitoring': ['aml.monitor'],
    },
  },
  employee: {
    route: routeCodes('EMPLOYEE_SEARCH_CODES'),
    screens: {
      'employee-performance': ['employee-performance.view'],
      'dashboards/insurer-employee-performance': ['insurer-performance.view'],
    },
  },
  insurer: {
    route: routeCodes('INSURER_SEARCH_CODES'),
    screens: {
      commission: ['commission-rate.manage'],
      'dashboards/claims': ['dashboard.claims.view'],
      'dashboards/financial': ['dashboard.financial.view'],
      'dashboards/insurer-employee-performance': ['insurer-performance.view'],
      'dashboards/policy': ['dashboard.policy.view'],
      'dashboards/sales': ['dashboard.sales.view'],
      'insurer-performance': ['insurer-performance.view'],
    },
  },
  policy: {
    route: routeCodes('POLICY_SEARCH_CODES'),
    screens: {
      documents: ['document.read'],
    },
  },
  user: {
    route: routeCodes('USER_SEARCH_CODES'),
    screens: {
      consent: ['consent.manage'],
      'information-assets': ['information-asset.manage'],
      'payment-channels': ['payment-channel.read'],
      'regulatory-compliance': ['compliance-calendar.manage', 'license.manage'],
      'sales-performance': ['dashboard.sales.view'],
    },
  },
  branch: {
    route: routeCodes('BRANCH_SEARCH_CODES'),
    screens: {
      'dashboards/claims': ['dashboard.claims.view'],
      'dashboards/compliance': ['dashboard.compliance.view'],
      'dashboards/executive': ['dashboard.executive.view'],
      'dashboards/financial': ['dashboard.financial.view'],
      'dashboards/insurer-employee-performance': ['insurer-performance.view'],
      'dashboards/policy': ['dashboard.policy.view'],
      'dashboards/sales': ['dashboard.sales.view'],
      employees: ['employee.read'],
      'employees/[id]': ['employee.read', 'user.manage'],
      'sales-performance': ['dashboard.sales.view'],
      'settings/users': ['user.manage'],
    },
  },
};

const cache = new Map();
async function holders(code) {
  if (cache.has(code)) return cache.get(code);
  const rows = await prisma.rolePermission.findMany({
    where: { permission: { code }, role: { isSystem: true } },
    select: { role: { select: { name: true } } },
  });
  const names = new Set(rows.map((r) => r.role.name));
  cache.set(code, names);
  return names;
}

async function unionOf(codes) {
  const all = new Set();
  for (const code of codes) for (const r of await holders(code)) all.add(r);
  return all;
}

async function main() {
  let stuck = 0;
  let unknownCodes = 0;
  let pairsChecked = 0;

  for (const [picker, { route, screens }] of Object.entries(PICKERS)) {
    const reach = await unionOf(route);
    console.log('='.repeat(96));
    console.log(`${picker.toUpperCase()} picker — route accepts ${route.length} code(s)`);

    // EVERY CODE MUST EXIST. A typo in either list reports zero holders, which is indistinguishable
    // from a code nobody holds — and "nobody holds it" is a legitimate state, so the two cannot be
    // told apart by the count. Checked against the catalogue instead.
    for (const code of [...route, ...Object.values(screens).flat()]) {
      const exists = await prisma.permission.findUnique({ where: { code } });
      if (!exists) {
        console.log(`  !! ${code} IS NOT A PERMISSION CODE — fix this list before reading anything below`);
        unknownCodes += 1;
      }
    }

    console.log(`  reachable by: ${[...reach].sort().join(', ') || '(nobody)'}`);
    for (const [screen, codes] of Object.entries(screens)) {
      const need = await unionOf(codes);
      const blocked = [...need].filter((r) => !reach.has(r)).sort();
      pairsChecked += 1;
      if (blocked.length) {
        stuck += 1;
        console.log(`  STUCK  ${screen.padEnd(42)} ${blocked.join(', ')}`);
      } else {
        console.log(`  ok     ${screen.padEnd(42)} every holder can reach the route`);
      }
    }
  }

  console.log('='.repeat(96));
  // NON-VACUITY. A clean result on an empty grid is what an unseeded database prints, and it looks
  // exactly like a correct product.
  if (pairsChecked === 0 || cache.size === 0) {
    console.log('ABORT: nothing was measured. Is this database seeded?');
    process.exitCode = 2;
    return;
  }
  const anyHolders = [...cache.values()].some((s) => s.size > 0);
  if (!anyHolders) {
    console.log(
      'ABORT: every code reports ZERO holders across ' +
        `${cache.size} codes. That is an unseeded database, not a product with no grants.`,
    );
    process.exitCode = 2;
    return;
  }

  console.log(`${pairsChecked} (picker, screen) pairs checked, ${stuck} stuck, ${unknownCodes} unknown code(s)`);
  if (stuck > 0 || unknownCodes > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
