/**
 * WHO MAY REACH A PICKER'S SEARCH ROUTE — one list per picker, and nowhere else.
 *
 * The owner's rule: **a picker's search route is gated on ANY OF the permissions of the screens that
 * use it.** It is a rule rather than a preference because the opposite was shipped twice, and both
 * times the symptom was a person stuck on a screen built for them:
 *
 *   1. `GET /employees/search` was gated on `employee.national-id.reveal` — the narrowest code in the
 *      whole employee family, because revealing a national ID is the flow it was first built for.
 *      Measured on the seeded grid: that code is held by COMPLIANCE_OFFICER alone, while both screens
 *      that type an `employeeId` are gated on codes held by BRANCH_DEPARTMENT_MANAGER and
 *      EXECUTIVE_MANAGEMENT. **So an Executive could not find an employee**, on the employee
 *      performance screen, which is one of the two screens that exist for them.
 *   2. `GET /customers/search` was gated on `customer.read`. Right for nine of the ten roles that need
 *      it and wrong for the DATA_PROTECTION_OFFICER, who holds `dsr.log` and NOT `customer.read` —
 *      and `/dsr` is the screen whose whole purpose is theirs. Found by
 *      `scripts/measurements/picker-route-reachability.mjs` the day after that field shipped.
 *
 * ## Why a list and not a single code
 *
 * `PermissionsGuard` ORs its codes (`required.some`), so `@RequirePermissions(...CODES)` is exactly
 * "any one of these is enough" — which is what the rule says and what a route guard already means
 * here. That is the one place in this codebase where the guard's OR semantics are the behaviour wanted
 * rather than a trap: a screen loading several endpoints with `Promise.all` needs ALL of them and must
 * use `permissionRefusalAllOf`, but a route admitting a caller needs only one reason to admit them.
 *
 * ## Why the entity's OWN read code is in every list
 *
 * Each list opens with the obvious code (`insurer.read`, `policy.read`, `branch.read`, `user.manage`)
 * even where no screen's gate names it. A role that may read the register may obviously search it, and
 * leaving it out would create the inverse defect: a picker a register's own reader cannot use.
 *
 * ## Keeping this honest
 *
 * These arrays are the ROUTE side of a join, and the SCREEN side lives in
 * `scripts/measurements/picker-route-permissions.py` (read off all 102 screens). The reachability
 * script parses THIS file rather than carrying a copy, so a route widened here is reflected there and a
 * second copy cannot drift. Re-run both after adding a screen that types an entity id:
 *
 *     python scripts/measurements/picker-route-permissions.py
 *     npx dotenv -e .env -- node scripts/measurements/picker-route-reachability.mjs
 *
 * A code added here that no screen needs is not caught by anything, deliberately — widening a picker is
 * a judgement about who may search a register, and a guard that refused it would refuse the entity's
 * own read code above.
 */

/** `GET /customers/search` — `/dsr` is why `dsr.log` is here. See the header. */
export const CUSTOMER_SEARCH_CODES = ['customer.read', 'dsr.log'] as const;

/**
 * `GET /employees/search` — the route that could not be reached by either screen that needs it.
 *
 * Widening this discloses nothing new: the result carries five fields (id, both name forms, job title,
 * still-employed) and no national ID, and `employee-search-narrowness.inventory.spec.ts` fails if a
 * sixth arrives. The reveal itself stays on `employee.national-id.reveal` at its own route.
 */
export const EMPLOYEE_SEARCH_CODES = [
  'employee.national-id.reveal',
  'employee-performance.view',
  'insurer-performance.view',
] as const;

/** `GET /insurers/search` — six dashboard/report screens type an `insurerId`. */
export const INSURER_SEARCH_CODES = [
  'insurer.read',
  'commission-rate.manage',
  'dashboard.claims.view',
  'dashboard.financial.view',
  'dashboard.policy.view',
  'dashboard.sales.view',
  'insurer-performance.view',
] as const;

/**
 * `GET /policies/search` — `/documents` types TWO required `policyId` fields, so that screen cannot be
 * used at all without pasting a uuid.
 */
export const POLICY_SEARCH_CODES = ['policy.read', 'document.read'] as const;

/**
 * `GET /admin/users/search` — the five screens that name an OWNER of something (an information asset, a
 * licence, a payment channel, a consent record, a sales target).
 *
 * Narrower in CONTENT than `GET /admin/users`, not merely in filtering: a name and an id, no email and
 * no role list. The precedent is `GET /audit-trail/actors`, whose own comment explains why an email
 * beside every actor would put a contact list in front of a read-only auditor for no gain. Here the
 * same reasoning applies to five screens' worth of readers.
 */
export const USER_SEARCH_CODES = [
  'user.manage',
  'consent.manage',
  'information-asset.manage',
  'payment-channel.read',
  'compliance-calendar.manage',
  'license.manage',
  'dashboard.sales.view',
] as const;

/**
 * `GET /admin/branches/search` — eleven screens filter by branch, which is the widest of the six.
 *
 * `GET /admin/branches` already exists and returns the office's whole branch list, gated on
 * `branch.read`. This route exists anyway rather than widening that one, because the two answer
 * different questions: the list is an administrative register of every branch including deactivated
 * ones, and a filter control wants the active ones by name. Widening the register's gate to ten codes
 * would hand nine roles an administrative screen's data to serve a dropdown.
 */
export const BRANCH_SEARCH_CODES = [
  'branch.read',
  'dashboard.claims.view',
  'dashboard.compliance.view',
  'dashboard.executive.view',
  'dashboard.financial.view',
  'dashboard.policy.view',
  'dashboard.sales.view',
  'employee.read',
  'insurer-performance.view',
  'user.manage',
] as const;

/**
 * The floors, per picker, because the floor is a judgement about how much of THAT set one keystroke may
 * return and not a constant to be shared.
 *
 * Customers are three (the book is the whole business). Employees are two (tens of people). The four
 * added here are ONE, and the reason is the same one the audit-actor picker gives: a branch list is a
 * handful of rows, an insurer list is the market the office already works with, and a floor on a set
 * that small refuses a short name for no gain. The POLICY floor is three — a policy book is the one set
 * among these that is as large as the customer book, and for the same reason.
 */
export const PICKER_MIN_CHARS = {
  customer: 3,
  employee: 2,
  insurer: 1,
  policy: 3,
  user: 1,
  branch: 1,
} as const;

/**
 * How many rows each picker returns. Bounded with no unfiltered mode anywhere — the owner's condition 2.
 *
 * Ten for a customer, because that list is read at a glance and a scrollable one is a page of the book.
 * Twenty-five for the four small sets, where the bound is a backstop rather than the control: an office
 * has tens of branches and tens of insurers, so a search that matched most of them is still a short
 * list and the number exists to stop a pathological term returning everything.
 */
export const PICKER_MAX_RESULTS = {
  customer: 10,
  employee: 25,
  insurer: 25,
  policy: 25,
  user: 25,
  branch: 25,
} as const;
