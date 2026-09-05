import { describe, expect, it } from 'vitest';
import { RoleName } from '@prisma/client';
import { PERMISSIONS } from './permissions';
import { ROLES } from './roles';

function codesGrantedTo(role: RoleName): string[] {
  return PERMISSIONS.filter((p) => p.roles.includes(role)).map((p) => p.code);
}

describe('permission grid — role catalogue', () => {
  it('has exactly the 11 RoleName enum values, each with a description', () => {
    const enumValues = Object.values(RoleName);
    expect(ROLES.map((r) => r.name).sort()).toEqual([...enumValues].sort());
    for (const role of ROLES) {
      expect(role.description.length).toBeGreaterThan(0);
    }
  });
});

describe('permission grid — every code is independent and traceable', () => {
  it('has no duplicate permission codes', () => {
    const codes = PERMISSIONS.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('grants every permission to at least one role', () => {
    for (const permission of PERMISSIONS) {
      expect(permission.roles.length).toBeGreaterThan(0);
    }
  });

  it('only references the 11 seeded roles', () => {
    const validRoles = new Set(ROLES.map((r) => r.name));
    for (const permission of PERMISSIONS) {
      for (const role of permission.roles) {
        expect(validRoles.has(role)).toBe(true);
      }
    }
  });
});

// Part 5.1's "Cannot" column, translated to the role-permission-grid level
// (a role simply doesn't hold the code). Instance-level self-check — e.g.
// one dual-hatted user placing *and* checking the *same* policy — is
// A.5's assertDifferentActors, not this grid's job.
describe('permission grid — Part 5.1 "Cannot" constraints', () => {
  it('Sales/Relationship Officer cannot approve refunds, delete claims, check policies, or manage commission rate tables', () => {
    const granted = codesGrantedTo(RoleName.SALES_RELATIONSHIP_OFFICER);
    expect(granted).not.toContain('refund.approve');
    expect(granted).not.toContain('claim.delete');
    expect(granted).not.toContain('policy.check');
    expect(granted).not.toContain('commission-rate.manage');
  });

  it('Placement/Technical Officer cannot check a policy (that is the Policy Checking Officer role alone)', () => {
    const granted = codesGrantedTo(RoleName.PLACEMENT_TECHNICAL_OFFICER);
    expect(granted).not.toContain('policy.check');
    expect(codesGrantedTo(RoleName.POLICY_CHECKING_OFFICER)).toContain(
      'policy.check',
    );
  });

  it('Policy Checking Officer cannot place a policy — cannot have been the one who placed the policy under review', () => {
    const granted = codesGrantedTo(RoleName.POLICY_CHECKING_OFFICER);
    // Part 5.1's actual constraint ("have not placed THIS policy") is
    // instance-level — A.5's job. This is the closest role-level proxy:
    // the role structurally can't originate a policy in the first place.
    expect(granted).not.toContain('policy.create');
    expect(granted).not.toContain('policy.issue');
    expect(granted).not.toContain('rfq.create');
  });

  it('Branch/Department Manager cannot manage security config or RBAC, and is not the DPO', () => {
    const granted = codesGrantedTo(RoleName.BRANCH_DEPARTMENT_MANAGER);
    // Part 5.1's actual constraint ("bypass maker/checker above their
    // delegated authority; self-approve their own escalations") is
    // instance-level — A.5's job. This is the closest role-level proxy:
    // their authority is bounded, not unlimited — they can't escalate
    // their own access (not ADMIN) or act as the DPO's final sign-off.
    expect(granted).not.toContain('security-config.manage');
    expect(granted).not.toContain('role.manage');
    expect(granted).not.toContain('permission.manage');
    expect(granted).not.toContain('dsr.close');
    expect(granted).not.toContain('retention.dispose.approve');
  });

  it('Claims Officer cannot be the second approver on a large-claim settlement', () => {
    const granted = codesGrantedTo(RoleName.CLAIMS_OFFICER);
    expect(granted).not.toContain('claim.settle.second-approve');
    // They CAN be the first approver — Part 5.1's constraint is "not alone",
    // not "never".
    expect(granted).toContain('claim.settle.approve');
  });

  it('Finance/Collections Officer can raise and approve refunds (but never its own), and cannot alter commission rate tables', () => {
    const granted = codesGrantedTo(RoleName.FINANCE_COLLECTIONS_OFFICER);
    // roles-and-segregation-of-duties.md: Finance "Cannot approve OWN
    // refunds/write-offs" — that constraint is instance-level ("own"), the
    // same shape as the Claims Officer first-approver case above, not a
    // role-level "never holds the code". maker-checker-segregation.md maps
    // the refund *checker* to a "Finance approver above the value threshold",
    // so the role legitimately holds BOTH sides; raiser != approver on a
    // given Refund is enforced by assertDifferentActors + the
    // Refund_maker_checker_distinct CHECK (endorsement.service.ts
    // approveRefund), never by withholding the permission.
    expect(granted).toContain('refund.raise');
    expect(granted).toContain('refund.approve');
    // "alter commission rate tables without approval" IS a role-level
    // exclusion — commission-rate.manage goes to Compliance / Manager only.
    expect(granted).not.toContain('commission-rate.manage');
    // Finance DOES reconcile the commission ledger against insurer statements
    // (Process 36) — applying/settling the governed figure, not altering it.
    expect(granted).toContain('commission.reconcile');
    // Finance maintains the approved payment-channel list (Process 38).
    expect(granted).toContain('payment-channel.manage');
  });

  it('Compliance Officer cannot originate sales transactions or close a DSR (DPO-only)', () => {
    const granted = codesGrantedTo(RoleName.COMPLIANCE_OFFICER);
    expect(granted).not.toContain('lead.create');
    expect(granted).not.toContain('dsr.close');
  });

  it('Data Protection Officer cannot originate commercial/sales transactions', () => {
    const granted = codesGrantedTo(RoleName.DATA_PROTECTION_OFFICER);
    expect(granted).not.toContain('lead.create');
    expect(granted).not.toContain('rfq.create');
  });

  it('System/Security Administrator cannot access transactional business data beyond administration', () => {
    const granted = codesGrantedTo(RoleName.SYSTEM_SECURITY_ADMINISTRATOR);
    expect(granted).not.toContain('kyc.approve');
    expect(granted).not.toContain('refund.approve');
    expect(granted).not.toContain('claim.settle.approve');
  });

  it('Executive Management cannot perform transactional maker/checker actions', () => {
    const granted = codesGrantedTo(RoleName.EXECUTIVE_MANAGEMENT);
    expect(granted).not.toContain('refund.approve');
    expect(granted).not.toContain('policy.check');
    expect(granted).not.toContain('kyc.approve');
  });

  it('External Auditor is read-only by construction — every granted code ends in .read or .view', () => {
    const granted = codesGrantedTo(RoleName.EXTERNAL_AUDITOR);
    expect(granted.length).toBeGreaterThan(0); // the role must grant something, or this test proves nothing
    for (const code of granted) {
      expect(
        code.endsWith('.read') || code.endsWith('.view'),
        `${code} was granted to EXTERNAL_AUDITOR but is not a read-only code`,
      ).toBe(true);
    }
  });
});
