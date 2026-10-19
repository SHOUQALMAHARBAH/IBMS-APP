import { describe, expect, it } from 'vitest';
import {
  canReach,
  DESTINATION_GROUPS,
  type Destination,
} from '../components/app/destinations';
import { permissionsForRoles } from '../e2e/fixtures/role-permissions';

/**
 * ITEM 7 — the door to `/settings/roles` is closed to the provider, and this is the exact set
 * that may still open it.
 *
 * The gate could not be a permission. The provider holds `role.read`, `role.create`,
 * `role.update`, `role.deactivate` and `permission.read` deliberately — module 0 item (b) gave it
 * self-administration — so no code separates it from an office, and withdrawing one would remove
 * a capability rather than hide a screen. What makes the screen wrong for the provider is
 * `buildMatrix` skipping every PLATFORM-scoped code: right for an office, exactly inverted for the
 * one organization whose own role holds nothing else.
 *
 * So the assertions below are about the TYPE, and they are stated in BOTH directions. A test that
 * only proved the provider is refused would pass against a gate that had closed the screen to
 * everybody — which, on the office administrator's only route to role management, is the worse
 * failure of the two.
 */

function destination(href: string): Destination {
  for (const group of DESTINATION_GROUPS) {
    for (const item of group.items) if (item.href === href) return item;
  }
  throw new Error(`${href} is not in DESTINATION_GROUPS`);
}

const ROLE_ADMIN_CODES = [
  'role.read',
  'role.create',
  'role.update',
  'role.deactivate',
  'permission.read',
];

describe('item 7: who may reach /settings/roles', () => {
  const roles = destination('/settings/roles');

  it('names the two organization types it serves and no others', () => {
    expect(roles.organizationTypes).toEqual([
      'BROKERAGE_OFFICE',
      'INSURANCE_COMPANY',
    ]);
  });

  it('is CLOSED to the provider, which holds every code the screen is gated on', () => {
    // The whole point: the permission half passes and the destination is still hidden.
    expect(
      canReach(
        { permissions: ROLE_ADMIN_CODES, organizationType: 'PROVIDER' },
        roles,
      ),
    ).toBe(false);
  });

  it('is OPEN to a brokerage office and to an insurance company', () => {
    for (const type of ['BROKERAGE_OFFICE', 'INSURANCE_COMPANY'] as const) {
      expect(
        canReach(
          { permissions: ROLE_ADMIN_CODES, organizationType: type },
          roles,
        ),
      ).toBe(true);
    }
  });

  it('is hidden when the organization type is unknown — the gate fails closed', () => {
    expect(canReach({ permissions: ROLE_ADMIN_CODES }, roles)).toBe(false);
  });

  it('still refuses an office that does not hold role.read', () => {
    // The type gate must not have replaced the permission gate.
    expect(
      canReach(
        {
          permissions: ['customer.read'],
          organizationType: 'BROKERAGE_OFFICE',
        },
        roles,
      ),
    ).toBe(false);
  });
});

describe('decision 12: the /rfqs nav entry and the set it produces', () => {
  /**
   * THE EXACT ROLE SET, asserted by name — the acceptance criterion applied to a NAV entry rather
   * than to a route, because a destination is a gate too.
   *
   * `rfq.read`'s four holders, read from the seeded grid fixture rather than restated here. And the
   * two oversight roles are asserted ABSENT: `GET /rfqs` now admits them through door four, but
   * their route is the LINK from the work that anchors them, and a nav entry would offer them a
   * register they can only ever see one customer of.
   */
  const rfqs = destination('/rfqs');

  it('is gated on rfq.read alone — an existing code, no key added to any role', () => {
    expect(rfqs.permissions).toEqual(['rfq.read']);
    // No type gate: every organization type that holds the code may open it.
    expect(rfqs.organizationTypes).toBeUndefined();
  });

  it('is reachable by exactly the four placement-path roles, and by neither oversight role', () => {
    const REACHES = [
      'SALES_RELATIONSHIP_OFFICER',
      'PLACEMENT_TECHNICAL_OFFICER',
      'BRANCH_DEPARTMENT_MANAGER',
      'EXECUTIVE_MANAGEMENT',
    ];
    const DOES_NOT = [
      'COMPLIANCE_OFFICER',
      'DATA_PROTECTION_OFFICER',
      'CLAIMS_OFFICER',
      'SYSTEM_SECURITY_ADMINISTRATOR',
      'FINANCE_COLLECTIONS_OFFICER',
      'EXTERNAL_AUDITOR',
    ];
    for (const role of REACHES) {
      expect(
        canReach(
          {
            permissions: permissionsForRoles([role]),
            organizationType: 'BROKERAGE_OFFICE',
          },
          rfqs,
        ),
        `${role} should reach /rfqs`,
      ).toBe(true);
    }
    for (const role of DOES_NOT) {
      expect(
        canReach(
          {
            permissions: permissionsForRoles([role]),
            organizationType: 'BROKERAGE_OFFICE',
          },
          rfqs,
        ),
        `${role} must NOT reach /rfqs`,
      ).toBe(false);
    }
  });

  it('the opportunities entry no longer calls itself the RFQ screen', () => {
    // The defect was a label, not a gate: this entry was the only one a reader would take for the
    // RFQ screen and it opens somewhere else.
    expect(destination('/opportunities').labelKey).toBe(
      'navOpportunitiesMarket',
    );
  });
});

describe('item 7: the doors that deliberately stay OPEN to the provider', () => {
  /**
   * Measured rather than assumed, because the same argument does NOT extend here.
   *
   * `/settings/users` lists the provider's OWN users and sources its role dropdown from
   * `GET /rbac/roles`, and `Role` and `User` both carry `organizationId`, so
   * `tenantScopeExtension` bounds every list on that screen to the provider itself. Nothing is
   * inverted and nothing of another organization appears.
   *
   * There is no `/settings/permissions` screen at all: `permission.read` gates exactly one route,
   * `GET /rbac/permissions`, which returns the GLOBAL catalogue and whose only consumer is the
   * roles screen's matrix. So closing the roles door leaves that code reaching no screen for the
   * provider — which the roles screen's own grant-reachability warning already treats as a
   * legitimate state, not a defect.
   */
  it('/settings/users is reachable by the provider', () => {
    expect(
      canReach(
        { permissions: ['user.manage'], organizationType: 'PROVIDER' },
        destination('/settings/users'),
      ),
    ).toBe(true);
  });

  it('there is no /settings/permissions destination to close', () => {
    expect(() => destination('/settings/permissions')).toThrow();
  });
});
