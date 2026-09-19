import { describe, expect, it } from "vitest";
import { RoleName } from "@prisma/client";
import { PERMISSIONS } from "./permissions";
import { OFFICE_ADMINISTRATOR_ROLE, ROLES } from "./roles";

function codesGrantedTo(role: string): string[] {
  return PERMISSIONS.filter((p) => p.roles.includes(role)).map((p) => p.code);
}

describe("permission grid — role catalogue", () => {
  it("has exactly the 11 RoleName enum values, each with a description", () => {
    const enumValues = Object.values(RoleName);
    expect(ROLES.map((r) => r.name).sort()).toEqual([...enumValues].sort());
    for (const role of ROLES) {
      expect(role.description.length).toBeGreaterThan(0);
    }
  });
});

describe("permission grid — every code is independent and traceable", () => {
  it("has no duplicate permission codes", () => {
    const codes = PERMISSIONS.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("grants every permission to at least one role", () => {
    for (const permission of PERMISSIONS) {
      expect(permission.roles.length).toBeGreaterThan(0);
    }
  });

  it("only references roles the seed actually installs", () => {
    // `PermissionSeed.roles` is `string[]`, not `RoleName[]`, because the office
    // administrator is a seeded role deliberately outside the legacy enum. This
    // check — not the enum — is what catches a typo now, so it has to know about
    // every role the seed installs, and only those.
    const validRoles = new Set([
      ...ROLES.map((r) => r.name),
      OFFICE_ADMINISTRATOR_ROLE.name,
    ]);
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
  it("Sales/Relationship Officer cannot approve refunds, delete claims, check policies, or manage commission rate tables", () => {
    const granted = codesGrantedTo(RoleName.SALES_RELATIONSHIP_OFFICER);
    expect(granted).not.toContain("refund.approve");
    expect(granted).not.toContain("claim.delete");
    expect(granted).not.toContain("policy.check");
    expect(granted).not.toContain("commission-rate.manage");
  });

  it("Placement/Technical Officer cannot check a policy (that is the Policy Checking Officer role alone)", () => {
    const granted = codesGrantedTo(RoleName.PLACEMENT_TECHNICAL_OFFICER);
    expect(granted).not.toContain("policy.check");
    expect(codesGrantedTo(RoleName.POLICY_CHECKING_OFFICER)).toContain(
      "policy.check",
    );
  });

  it("Policy Checking Officer cannot place a policy — cannot have been the one who placed the policy under review", () => {
    const granted = codesGrantedTo(RoleName.POLICY_CHECKING_OFFICER);
    // Part 5.1's actual constraint ("have not placed THIS policy") is
    // instance-level — A.5's job. This is the closest role-level proxy:
    // the role structurally can't originate a policy in the first place.
    expect(granted).not.toContain("policy.create");
    expect(granted).not.toContain("policy.issue");
    expect(granted).not.toContain("rfq.create");
  });

  it("Branch/Department Manager cannot manage security config or RBAC, and is not the DPO", () => {
    const granted = codesGrantedTo(RoleName.BRANCH_DEPARTMENT_MANAGER);
    // Part 5.1's actual constraint ("bypass maker/checker above their
    // delegated authority; self-approve their own escalations") is
    // instance-level — A.5's job. This is the closest role-level proxy:
    // their authority is bounded, not unlimited — they can't escalate
    // their own access (not ADMIN) or act as the DPO's final sign-off.
    expect(granted).not.toContain("security-config.manage");
    expect(granted).not.toContain("role.manage");
    expect(granted).not.toContain("permission.manage");
    expect(granted).not.toContain("dsr.close");
    expect(granted).not.toContain("retention.dispose.approve");
  });

  it("Claims Officer cannot be the second approver on a large-claim settlement", () => {
    const granted = codesGrantedTo(RoleName.CLAIMS_OFFICER);
    expect(granted).not.toContain("claim.settle.second-approve");
    // They CAN be the first approver — Part 5.1's constraint is "not alone",
    // not "never".
    expect(granted).toContain("claim.settle.approve");
  });

  it("Finance/Collections Officer can raise and approve refunds (but never its own), and cannot alter commission rate tables", () => {
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
    expect(granted).toContain("refund.raise");
    expect(granted).toContain("refund.approve");
    // "alter commission rate tables without approval" IS a role-level
    // exclusion — commission-rate.manage goes to Compliance / Manager only.
    expect(granted).not.toContain("commission-rate.manage");
    // Finance DOES reconcile the commission ledger against insurer statements
    // (Process 36) — applying/settling the governed figure, not altering it.
    expect(granted).toContain("commission.reconcile");
    // Finance maintains the approved payment-channel list (Process 38).
    expect(granted).toContain("payment-channel.manage");
  });

  it("Compliance Officer cannot originate sales transactions or close a DSR (DPO-only)", () => {
    const granted = codesGrantedTo(RoleName.COMPLIANCE_OFFICER);
    expect(granted).not.toContain("lead.create");
    expect(granted).not.toContain("dsr.close");
  });

  it("Data Protection Officer cannot originate commercial/sales transactions", () => {
    const granted = codesGrantedTo(RoleName.DATA_PROTECTION_OFFICER);
    expect(granted).not.toContain("lead.create");
    expect(granted).not.toContain("rfq.create");
  });

  it("System/Security Administrator cannot access transactional business data beyond administration", () => {
    const granted = codesGrantedTo(RoleName.SYSTEM_SECURITY_ADMINISTRATOR);
    expect(granted).not.toContain("kyc.approve");
    expect(granted).not.toContain("refund.approve");
    expect(granted).not.toContain("claim.settle.approve");
  });

  it("Executive Management cannot perform transactional maker/checker actions", () => {
    const granted = codesGrantedTo(RoleName.EXECUTIVE_MANAGEMENT);
    expect(granted).not.toContain("refund.approve");
    expect(granted).not.toContain("policy.check");
    expect(granted).not.toContain("kyc.approve");
  });

  it("External Auditor is read-only by construction — every granted code ends in .read or .view", () => {
    const granted = codesGrantedTo(RoleName.EXTERNAL_AUDITOR);
    expect(granted.length).toBeGreaterThan(0); // the role must grant something, or this test proves nothing
    for (const code of granted) {
      expect(
        code.endsWith(".read") || code.endsWith(".view"),
        `${code} was granted to EXTERNAL_AUDITOR but is not a read-only code`,
      ).toBe(true);
    }
  });
});

// Office-scoped custom RBAC, PHASE 3 workstream E. `employee.manage` gated four
// routes — create, list, get, and reveal an employee's unmasked national ID —
// and `customer.360-view.read` gated both reading a customer and revealing
// theirs. These are the grid-level invariants of splitting the reveals out.
describe("permission grid — a national-ID reveal is its own permission", () => {
  const REVEAL_CODES = [
    "employee.national-id.reveal",
    "customer.national-id.reveal",
  ];

  it("no longer has the employee.manage bridge, and employee.read replaced it", () => {
    const codes = PERMISSIONS.map((p) => p.code);
    expect(codes).not.toContain("employee.manage");
    for (const code of [
      "employee.read",
      "employee.create",
      "employee.update",
    ]) {
      expect(codes).toContain(code);
    }
  });

  it("gives every former employee.manage holder employee.read — nobody lost the ability to read an employee", () => {
    // Migration 20261007100000 renames the row IN PLACE so its grants follow it.
    // The two holders were the administrator and the Branch/Department Manager;
    // they must also hold create and update, or the rename would have narrowed
    // access rather than split a sensitive field off it.
    const formerHolders = [
      RoleName.SYSTEM_SECURITY_ADMINISTRATOR,
      RoleName.BRANCH_DEPARTMENT_MANAGER,
    ];
    for (const role of formerHolders) {
      const granted = codesGrantedTo(role);
      expect(granted, `${role} must still read employees`).toContain(
        "employee.read",
      );
      expect(granted).toContain("employee.create");
      expect(granted).toContain("employee.update");
    }
  });

  it("gives the reveal codes to the Compliance Officer and to nobody else", () => {
    // THE reduction. Both former `employee.manage` holders held the reveal
    // through it, and all five `customer.360-view.read` holders held the customer
    // one; after the split only the function whose job is verifying an identity
    // document does. A new holder here is a deliberate decision, so it must break
    // this test and be argued for, not arrive as a side effect of a grid edit.
    for (const code of REVEAL_CODES) {
      const entry = PERMISSIONS.find((p) => p.code === code);
      expect(entry, `${code} must exist in the grid`).toBeDefined();
      expect(entry!.roles).toEqual([RoleName.COMPLIANCE_OFFICER]);
    }
  });

  it("keeps the reveal separable from the read it was split out of", () => {
    // The point of the split is that holding the reading permission never implies
    // the reveal. Expressed as a grid property: at least one role holds the read
    // WITHOUT the reveal, in both families. If that ever became false the codes
    // would be distinct in name only.
    const pairs: [string, string][] = [
      ["employee.read", "employee.national-id.reveal"],
      ["customer.360-view.read", "customer.national-id.reveal"],
    ];
    for (const [readCode, revealCode] of pairs) {
      const readers = PERMISSIONS.find((p) => p.code === readCode)!.roles;
      const revealers = PERMISSIONS.find((p) => p.code === revealCode)!.roles;
      const readOnly = readers.filter((r) => !revealers.includes(r));
      expect(
        readOnly.length,
        `every holder of ${readCode} also holds ${revealCode} — the split is nominal`,
      ).toBeGreaterThan(0);
    }
  });
});

// Office-scoped custom RBAC, PHASE 3 workstream D — the office administrator.
describe("permission grid — the office administrator", () => {
  const OFFICE_ADMIN = OFFICE_ADMINISTRATOR_ROLE.name;

  it("holds exactly 24 codes", () => {
    // The count is asserted as well as the membership so that adding a code
    // without deciding about it is impossible: both this number and the list in
    // `office-administrator.e2e-spec.ts` (an independent copy, deliberately) have
    // to move together.
    //
    // 22 at the Phase 3 migration, 24 with insurer management. The two codes that
    // moved the number are declared in ADDED_AFTER_THE_MIGRATION below, so the
    // facts cannot drift apart.
    expect(codesGrantedTo(OFFICE_ADMIN).sort()).toEqual(
      [
        "access-recertification.cycle.start",
        "audit-log.read",
        "bcp-dr.manage",
        "customer.bulk-import",
        "deprovisioning.execute",
        "email.integration.manage",
        "email.integration.read",
        "employee.create",
        "employee.read",
        "employee.update",
        "encryption-key.read",
        "incident.contain",
        "incident.report",
        "information-asset.manage",
        "insurer.read",
        "insurer.relationship.manage",
        "permission.read",
        "role.manage",
        "role.read",
        "security-config.manage",
        "security-config.read",
        "training.record",
        "user.manage",
        "vendor.manage",
      ].sort(),
    );
  });

  it("was a strict subset of the legacy administrator AT THE MIGRATION — a historical property, now stated as one", () => {
    // ## Why this assertion changed shape rather than being deleted
    //
    // Migration 20261008100000 granted `OFFICE_ADMINISTRATOR` to every existing
    // holder of `user.manage`. That was safe to do blind because its 22 codes were
    // a strict subset of what the legacy `SYSTEM_SECURITY_ADMINISTRATOR` already
    // held, so nobody's effective permissions changed — measured as a
    // byte-identical per-user diff on both databases, 36,688 users and 31.
    //
    // The subset was never meant to hold FOREVER. It was the precondition for one
    // migration, and that migration has run. Insurer management then adds
    // `insurer.relationship.manage` to the office administrator, which the legacy
    // role does not hold — deferred from Phase 3 precisely so it would land after
    // the migration rather than invalidate it.
    //
    // So the assertion is restated as the historical fact it is: every code the
    // office administrator held AT THAT POINT is still one the legacy
    // administrator holds. Codes added afterwards are listed explicitly, which
    // means a new one cannot slip in without a decision — the protection the
    // original assertion actually provided.
    const ADDED_AFTER_THE_MIGRATION = [
      // Insurer management, both halves. Office-scoped: registering and
      // maintaining this office's own insurer records, and reading the list those
      // writes act on. The legacy administrator has no insurer capability at all,
      // which is why these are not subset violations but a deliberate divergence.
      //
      // The pair is deliberate and mirrors `role.read` + `role.manage`: an
      // administrator holding only the write would get the controls on a screen
      // that renders nothing, because you cannot manage records you cannot list.
      "insurer.read",
      "insurer.relationship.manage",
    ];

    const legacy = new Set(
      codesGrantedTo(RoleName.SYSTEM_SECURITY_ADMINISTRATOR),
    );
    const atMigration = codesGrantedTo(OFFICE_ADMIN).filter(
      (code) => !ADDED_AFTER_THE_MIGRATION.includes(code),
    );
    const exclusive = atMigration.filter((code) => !legacy.has(code));
    expect(
      exclusive,
      "a code was added to the office administrator without being declared as post-migration — if it is deliberate, add it to ADDED_AFTER_THE_MIGRATION with the reason; if not, the 20261008100000 empty diff is no longer reproducible from this grid",
    ).toEqual([]);

    // Still STRICT, not merely equal: the legacy role holds destructive and
    // platform-level codes this one is deliberately denied, and that has not
    // changed.
    expect(atMigration.length).toBeLessThan(legacy.size);

    // And the declared additions are real codes the role actually holds — so this
    // list cannot rot into an exemption for something that was later removed.
    for (const code of ADDED_AFTER_THE_MIGRATION) {
      expect(
        codesGrantedTo(OFFICE_ADMIN),
        `${code} is declared post-migration but is not granted to the office administrator`,
      ).toContain(code);
    }
  });

  it("is denied the eight codes withheld from it on purpose", () => {
    // Each of these is a decision with a reason, recorded in `roles.ts` and in
    // the migration. Moving one onto the role has to break a test rather than
    // arrive as a side effect of a grid edit.
    const granted = codesGrantedTo(OFFICE_ADMIN);
    for (const withheld of [
      // destructive business actions
      "claim.delete",
      "document.delete-override",
      // `insurer.form.map`'s effect CROSSES offices — the grid's own description
      // says the mapping becomes the form every other office submits against.
      // (`insurer.master.manage` is deliberately absent from this list: no such
      // code exists in the catalogue, so asserting it is not granted asserts
      // nothing. `insurer.master.read` is the only master-registry code today.)
      "insurer.form.map",
      // reviewing your own access is the control this system exists to enforce
      "access-recertification.review",
      "access-recertification.review.routine",
      // Part 10.2 Highly Confidential
      "employee.national-id.reveal",
      "customer.national-id.reveal",
    ]) {
      expect(granted, `${withheld} must not be granted`).not.toContain(withheld);
    }
  });

  it("never grants the administrator a business-transaction code", () => {
    // A broader net than the eight above: an administrator provisions accounts
    // and configures the office. It does not sell, underwrite, settle or pay.
    const granted = codesGrantedTo(OFFICE_ADMIN);
    for (const code of [
      "lead.create",
      "rfq.create",
      "policy.check",
      "kyc.approve",
      "refund.approve",
      "claim.settle.approve",
      "customer.360-view.read",
    ]) {
      expect(granted, `${code} is business data, not administration`).not.toContain(
        code,
      );
    }
  });
});
