import type { AuthenticatedUser } from '../../src/modules/auth/auth.types';
import {
  CLAIM_ALL_OWNERS_READ,
  CUSTOMER_ALL_OWNERS_READ,
  CUSTOMER_FILE_ALL_OWNERS_READ,
  ENDORSEMENT_ALL_OWNERS_READ,
  LEAD_ALL_OWNERS_READ,
  POLICY_ALL_OWNERS_READ,
  RECOMMENDATION_ALL_OWNERS_READ,
} from '../../src/common/rbac-visibility.util';

/**
 * Test-only. Builds the `permissions` set a unit-test actor would really have,
 * from the role names the fixture already names.
 *
 * ## Why this exists rather than an explicit set in each fixture
 *
 * Phase 2 made cross-owner visibility a permission. `AuthenticatedUser` gained
 * a required `permissions` field, and around sixty unit-test fixtures across
 * thirty files supply that actor. The compiler found every fixture DEFINITION —
 * but not the dozens of call sites that override just the roles, like
 * `makeUser({ roles: ['BRANCH_DEPARTMENT_MANAGER'] })` to exercise a cross-owner
 * branch. Those compile fine either way, and an override that set roles without
 * permissions would have turned a cross-owner test into a same-owner test,
 * silently, while still passing for the wrong reason.
 *
 * Deriving from the roles keeps every one of those overrides meaning what it
 * meant before, which is the property this whole phase is gated on.
 *
 * ## This is a copy of the seed's grants, and it is checked
 *
 * The table below must agree with `packages/db/prisma/seed-data/permissions.ts`.
 * `cross-owner-permissions.spec.ts` asserts exactly that, so the two cannot
 * drift.
 */
const ALL_OWNERS_BY_ROLE: Readonly<Record<string, readonly string[]>> = {
  SALES_RELATIONSHIP_OFFICER: [],
  PLACEMENT_TECHNICAL_OFFICER: [
    CUSTOMER_FILE_ALL_OWNERS_READ,
    POLICY_ALL_OWNERS_READ,
    ENDORSEMENT_ALL_OWNERS_READ,
    RECOMMENDATION_ALL_OWNERS_READ,
  ],
  POLICY_CHECKING_OFFICER: [POLICY_ALL_OWNERS_READ],
  CLAIMS_OFFICER: [CLAIM_ALL_OWNERS_READ],
  FINANCE_COLLECTIONS_OFFICER: [ENDORSEMENT_ALL_OWNERS_READ],
  COMPLIANCE_OFFICER: [
    CUSTOMER_ALL_OWNERS_READ,
    RECOMMENDATION_ALL_OWNERS_READ,
  ],
  BRANCH_DEPARTMENT_MANAGER: [
    LEAD_ALL_OWNERS_READ,
    CUSTOMER_ALL_OWNERS_READ,
    CUSTOMER_FILE_ALL_OWNERS_READ,
    POLICY_ALL_OWNERS_READ,
    CLAIM_ALL_OWNERS_READ,
    ENDORSEMENT_ALL_OWNERS_READ,
    RECOMMENDATION_ALL_OWNERS_READ,
  ],
  DATA_PROTECTION_OFFICER: [],
  SYSTEM_SECURITY_ADMINISTRATOR: [],
  EXECUTIVE_MANAGEMENT: [
    LEAD_ALL_OWNERS_READ,
    CUSTOMER_ALL_OWNERS_READ,
    CUSTOMER_FILE_ALL_OWNERS_READ,
    POLICY_ALL_OWNERS_READ,
    CLAIM_ALL_OWNERS_READ,
    ENDORSEMENT_ALL_OWNERS_READ,
    RECOMMENDATION_ALL_OWNERS_READ,
  ],
  EXTERNAL_AUDITOR: [CUSTOMER_ALL_OWNERS_READ],
};

/** The cross-owner codes the seed grants to these roles. A role name this table
 *  does not know contributes nothing — which is the fail-closed direction, and
 *  matches what a genuinely custom role gets until an office grants it
 *  something. */
export function crossOwnerPermissionsFor(
  roles: readonly string[],
): ReadonlySet<string> {
  const codes = new Set<string>();
  for (const role of roles) {
    for (const code of ALL_OWNERS_BY_ROLE[role] ?? []) codes.add(code);
  }
  return codes;
}

/**
 * Fills in `permissions` from `roles` unless the fixture set it explicitly.
 *
 * Wraps a fixture's object literal so that `{ ...overrides }` inside it is
 * applied BEFORE the derivation — an override that changes the roles therefore
 * changes the permissions with them.
 */
export function withCrossOwnerPermissions(
  user: Omit<AuthenticatedUser, 'permissions'> & {
    permissions?: ReadonlySet<string>;
  },
): AuthenticatedUser {
  return {
    ...user,
    permissions: user.permissions ?? crossOwnerPermissionsFor(user.roles),
  };
}

/** Everything a cross-owner test needs, when the point is "this actor reaches
 *  the whole book" rather than which role does so. */
export const ALL_CROSS_OWNER_PERMISSIONS: ReadonlySet<string> =
  crossOwnerPermissionsFor(['BRANCH_DEPARTMENT_MANAGER']);
