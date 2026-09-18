import { describe, expect, it } from 'vitest';
import {
  CHECKER_PERMISSIONS,
  checkerPermissionsIn,
  segregationSignal,
  type GrantedRole,
} from './checker-roles.config';

/**
 * Office-scoped custom RBAC, PHASE 2 workstream D.
 *
 * The segregation signal used to fire when the granted role's NAME was one of
 * six. It now fires when the granted role HOLDS a checker permission. Two things
 * have to be true about that change, and neither is obvious by reading it.
 *
 * 1. The scope is unchanged for the eleven legacy roles — the same grants fire,
 *    and no new ones do. This is a detective control on a regulated surface, so
 *    widening it by accident would bury Compliance in noise and narrowing it
 *    would hide the thing it exists to see.
 * 2. It still does not BLOCK. Re-keying a detective control is the moment
 *    somebody "improves" it into a preventive one, which would invent a
 *    dual-control policy for provisioning that the business has not agreed to.
 */

/** What each legacy role actually holds among the checker codes, per the seeded
 *  grid. Read off the seeded database, not the seed source. */
const LEGACY_CHECKER_CODES: Readonly<Record<string, readonly string[]>> = {
  SALES_RELATIONSHIP_OFFICER: [],
  PLACEMENT_TECHNICAL_OFFICER: [],
  POLICY_CHECKING_OFFICER: ['policy.check'],
  CLAIMS_OFFICER: [],
  FINANCE_COLLECTIONS_OFFICER: [
    'refund.approve',
    'claim.settle.second-approve',
  ],
  COMPLIANCE_OFFICER: ['kyc.approve', 'access-recertification.review'],
  BRANCH_DEPARTMENT_MANAGER: [
    'refund.approve',
    'claim.settle.second-approve',
    'commission-override.approve',
    'recommendation.approve',
    'complaint.close',
    'access-recertification.review',
  ],
  DATA_PROTECTION_OFFICER: [
    'retention.dispose.approve',
    'data-sharing.approve',
    'dpa.approve',
    'dsr.close',
  ],
  SYSTEM_SECURITY_ADMINISTRATOR: [],
  EXECUTIVE_MANAGEMENT: [
    'incident.classification.co-sign',
    'access-recertification.review',
  ],
  EXTERNAL_AUDITOR: [],
};

/** The six names the old `CHECKER_ROLES` array held. */
const ROLES_THAT_USED_TO_TRIGGER = [
  'POLICY_CHECKING_OFFICER',
  'COMPLIANCE_OFFICER',
  'FINANCE_COLLECTIONS_OFFICER',
  'DATA_PROTECTION_OFFICER',
  'EXECUTIVE_MANAGEMENT',
  'BRANCH_DEPARTMENT_MANAGER',
];

function role(name: string): GrantedRole {
  return {
    name,
    permissions: new Set(LEGACY_CHECKER_CODES[name] ?? []),
  };
}

describe('the segregation signal fires for the same grants it always did', () => {
  it('fires for every one of the six roles that used to trigger', () => {
    for (const name of ROLES_THAT_USED_TO_TRIGGER) {
      const signal = segregationSignal({
        roles: [role(name)],
        subjectUserId: 'u-subject',
        actorUserId: 'u-admin',
      });
      expect(signal, `${name} must still raise a signal`).not.toBeNull();
      expect(signal!.checkerRoles).toEqual([name]);
      expect(
        signal!.checkerPermissions.length,
        `${name} must name why it triggered`,
      ).toBeGreaterThan(0);
    }
  });

  it('stays silent for the five that never triggered', () => {
    for (const name of Object.keys(LEGACY_CHECKER_CODES).filter(
      (n) => !ROLES_THAT_USED_TO_TRIGGER.includes(n),
    )) {
      expect(
        segregationSignal({
          roles: [role(name)],
          subjectUserId: 'u-subject',
          actorUserId: 'u-admin',
        }),
        `${name} must NOT raise a signal`,
      ).toBeNull();
    }
  });

  it('fires for a CUSTOM role holding a checker permission — the case that used to be silent', () => {
    // A role named nothing in particular, granted `policy.check`. Under the old
    // name list this grant produced no signal at all, which is how the detective
    // control would have gone quiet the moment offices started defining roles.
    const signal = segregationSignal({
      roles: [
        { name: 'Quality Reviewer', permissions: new Set(['policy.check']) },
      ],
      subjectUserId: 'u-subject',
      actorUserId: 'u-admin',
    });
    expect(signal).not.toBeNull();
    expect(signal!.checkerRoles).toEqual(['Quality Reviewer']);
    expect(signal!.checkerPermissions).toEqual(['policy.check']);
  });

  it('names WHICH role carried the permission when several are granted at once', () => {
    // Provisioning grants a set. Reporting the union would flag the grant
    // without saying what caused it, which is the difference between an alert
    // Compliance can act on and one they have to investigate from scratch.
    const signal = segregationSignal({
      roles: [
        role('SALES_RELATIONSHIP_OFFICER'),
        role('POLICY_CHECKING_OFFICER'),
      ],
      subjectUserId: 'u-subject',
      actorUserId: 'u-admin',
    });
    expect(signal!.checkerRoles).toEqual(['POLICY_CHECKING_OFFICER']);
    expect(signal!.checkerPermissions).toEqual(['policy.check']);
  });

  it('flags a self-grant distinctly', () => {
    const signal = segregationSignal({
      roles: [role('POLICY_CHECKING_OFFICER')],
      subjectUserId: 'u-admin',
      actorUserId: 'u-admin',
    });
    expect(signal!.selfGrant).toBe(true);
  });

  it('returns the checker permissions in catalogue order, not set order', () => {
    // Stable output, so an audit row diffed against another is comparable.
    const shuffled = new Set(['dsr.close', 'policy.check', 'kyc.approve']);
    expect(checkerPermissionsIn(shuffled)).toEqual([
      'policy.check',
      'kyc.approve',
      'dsr.close',
    ]);
  });

  it('covers every maker/checker pair this system enforces', () => {
    // A pair added to `common/maker-checker.util.ts` without a code here is a
    // pair whose checker half can be handed out silently.
    expect(CHECKER_PERMISSIONS).toHaveLength(13);
    expect(new Set(CHECKER_PERMISSIONS).size).toBe(CHECKER_PERMISSIONS.length);
  });
});
