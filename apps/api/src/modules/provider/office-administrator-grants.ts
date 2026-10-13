/**
 * MODULE 0-ب ITEM (d) — WHAT A NEWLY REGISTERED OFFICE'S ADMINISTRATOR HOLDS.
 *
 * ## IT IS COMPUTED FROM THE CATALOGUE AND COPIED FROM NO OFFICE — the owner's instruction, and the
 * ## reason is a defect this repository has already measured twice
 *
 * The obvious implementation of "give the new office an administrator like everyone else's" is to
 * read an existing office's `RolePermission` rows and replay them. That is exactly how drift
 * propagates, and the drift is real and recorded:
 *
 *   * `seed.ts` grants permissions to the DEFAULT office's roles only. Every code added after an
 *     office was created never reached that office — measured at the time: the demo office's
 *     administrator role was FOUR grants behind, across 25 missing grants in eight roles.
 *   * `ensureProviderOrganization` had to be written with its own code list for the same reason.
 *
 * Replay the default office's rows into a new office and you inherit whatever that office has
 * drifted to, forever, with nothing failing. The second office is then subtly different from the
 * first and nobody can say why.
 *
 * So the set is DECLARED here, and RESOLVED against the `Permission` table at registration. A code
 * in this list that the catalogue does not contain is a loud failure at registration rather than a
 * silently short grant set — which is the failure mode that matters, because a missing grant is
 * invisible until an administrator needs it.
 *
 * ## WHY A DECLARED LIST RATHER THAN A RULE OVER THE CATALOGUE
 *
 * Measured before writing it: the office administrator's set is not derivable from `module` or
 * `scope`. Every module it touches is PARTIAL — `admin` 18 of 22, `supporting-operations` 11 of 17,
 * `insurance-operations` 10 of 51, `commercial-front-office` 1 of 34. There is no predicate over the
 * catalogue that produces this set and no honest way to invent one.
 *
 * ## THE SECOND HOME, AND WHY IT IS GUARDED RATHER THAN COLLAPSED
 *
 * `packages/db/prisma/seed-data/permissions.ts` also names this role, per code, in its `roles`
 * array. Two homes for one fact — and the repository's own rule is that a hand-written mirror needs
 * a guard in BOTH directions, living where it can see both.
 *
 * It is a mirror rather than one home for a structural reason, not a preference: `prisma/seed-data/`
 * sits OUTSIDE `@ibms/db`'s export surface, so the api cannot import it (and `role-scope.inventory.
 * spec.ts` already reads it off disk by path for the same reason); and `packages/db/tsconfig.json`
 * sets `rootDir: "src"`, so moving the list into `src/` and importing it from the grid is the only
 * single-home shape available. That collapse is recorded in `docs/deferred-register.md` with the
 * order it has to happen in; what is NOT acceptable is two homes with nothing checking them, so
 * `packages/db/prisma/office-administrator-grants.parity.spec.ts` fails in both directions.
 */

/**
 * The grant set, grouped by the capability each group exists for. The grouping is not decoration:
 * adding a code means deciding which of these an office administrator is for, and a code that fits
 * none of them is a code that probably belongs to a different role.
 */
export const OFFICE_ADMINISTRATOR_GRANT_GROUPS = {
  /**
   * USER AND ROLE ADMINISTRATION — the capability without which an office cannot repair itself.
   * `user.manage` is the anchor of the last-administrator lockout guard, which is why that code has
   * deliberately never been split.
   */
  userAdministration: [
    'user.manage',
    'role.read',
    'role.create',
    'role.update',
    'role.deactivate',
    'permission.read',
  ],
  /** THE OFFICE'S OWN SHAPE — departments and branches. An office that cannot record its branches
   *  cannot record what it is licensed for, since a licence's scope hangs off them. */
  organizationalStructure: [
    'department.read',
    'department.create',
    'department.update',
    'department.deactivate',
    'branch.read',
    'branch.create',
    'branch.update',
    'branch.deactivate',
  ],
  /** PEOPLE. Recording a person and provisioning their login are one act at `/employees`, so an
   *  administrator holds both halves or the screen refuses half of itself. */
  people: [
    'employee.read',
    'employee.create',
    'employee.update',
    'training.record',
    'deprovisioning.execute',
  ],
  /**
   * SECURITY POSTURE AND ITS EVIDENCE. `encryption-key.read` is the key-rotation inventory;
   * `duty-segregation.mode.declare` is the office declaring how it separates duties.
   *
   * Note what is ABSENT and stays absent: `access-recertification.review`. The administrator STARTS
   * a recertification cycle and does not decide its items — whoever declares the control is not
   * whoever reviews the acts it permits, which is the same segregation one level up that keeps
   * `internal-controls.view` away from this role.
   */
  securityConfiguration: [
    'security-config.read',
    'security-config.manage',
    'encryption-key.read',
    'access-recertification.cycle.start',
    'duty-segregation.mode.declare',
    'audit-log.read',
  ],
  /** THE COUNTERPARTIES AND VOCABULARIES THE OFFICE CONFIGURES — insurers it deals with, the
   *  insurance lines it writes beyond the standard 32, and its vendors. Configuration, not trading:
   *  no code here places business, raises an invoice or reads a policy. */
  counterpartyRegisters: [
    'insurer.read',
    'insurer.create',
    'insurer.update',
    'insurer.deactivate',
    'insurer.directory.read',
    'insurer.office-form.map',
    'insurance-line.create',
    'insurance-line.update',
    'vendor.read',
    'vendor.create',
    'vendor.update',
    'vendor.deactivate',
  ],
  /** OFFICE-LEVEL REGISTERS AND THE FIRST MOVE ON AN INCIDENT. `incident.report` and
   *  `incident.contain` are deliberately NOT accompanied by `incident.classify` or
   *  `incident.classification.co-sign`: raising and containing an incident is operational, and
   *  classifying one is the maker/checker decision that must not sit with the same person. */
  officeRegisters: [
    'information-asset.manage',
    'bcp-dr.manage',
    'incident.report',
    'incident.contain',
  ],
  /**
   * DATA AND INTEGRATION. `customer.read` is the LIST, which an administrator running a bulk import
   * must be able to see the result of — the narrow read that module 0's `customer.read` split
   * created precisely so that holding it does NOT open the 360° view, the reveal or the UBO
   * register. `customer.360-view.read` is absent and must stay absent.
   */
  dataAndIntegration: [
    'email.integration.read',
    'email.integration.manage',
    'customer.bulk-import',
    'customer.read',
  ],
} as const satisfies Record<string, readonly string[]>;

/** The flat set, in a stable order. Resolved against `Permission` at registration — never trusted
 *  as a list of codes that exist. */
export const OFFICE_ADMINISTRATOR_GRANTS: readonly string[] = Object.values(
  OFFICE_ADMINISTRATOR_GRANT_GROUPS,
)
  .flat()
  .slice()
  .sort();

/** The machine name every office's first role carries. Not a `RoleName`: the office administrator
 *  is a seeded role deliberately outside the legacy enum. */
export const OFFICE_ADMINISTRATOR_ROLE_NAME = 'OFFICE_ADMINISTRATOR';
