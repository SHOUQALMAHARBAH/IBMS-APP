import { describe, expect, it } from "vitest";
import { ROLES } from "./roles";

/**
 * Office-scoped custom RBAC, PHASE 2 workstream A.
 *
 * `Role.requiresMfaAlways` and `Role.requiresHardwareToken` default to the
 * STRICT value, so the seed has to state every legacy role's value explicitly
 * or eleven roles come out demanding MFA on every login. That makes the seed a
 * second, independent copy of Part II §4.4 and Part 10.1 — and a copy nobody
 * checks is a copy that drifts.
 *
 * This is that check. Migration 20261004100000 holds the same two lists in SQL;
 * `apps/api/test/role-security-attributes.e2e-spec.ts` asserts the migrated
 * database agrees. Here we assert the SEED agrees, so a database built by
 * seeding from empty and one built by migrating are indistinguishable — the
 * property CI broke last phase, on the one step no local gate covered.
 */

/** Part II §4.4 — exactly these three roles never skip the MFA prompt. */
const ALWAYS_MFA = [
  "SYSTEM_SECURITY_ADMINISTRATOR",
  "COMPLIANCE_OFFICER",
  "DATA_PROTECTION_OFFICER",
];

/** Part 10.1 — the privileged set, deliberately WIDER than §4.4's. */
const PRIVILEGED = [
  "SYSTEM_SECURITY_ADMINISTRATOR",
  "EXECUTIVE_MANAGEMENT",
  "BRANCH_DEPARTMENT_MANAGER",
  "COMPLIANCE_OFFICER",
  "DATA_PROTECTION_OFFICER",
];

describe("role seed — security attributes", () => {
  it("sets requiresMfaAlways for exactly the three §4.4 roles", () => {
    const strict = ROLES.filter((r) => r.requiresMfaAlways).map((r) => r.name);
    expect([...strict].sort()).toEqual([...ALWAYS_MFA].sort());
  });

  it("sets requiresHardwareToken for exactly the five Part 10.1 roles", () => {
    const privileged = ROLES.filter((r) => r.requiresHardwareToken).map(
      (r) => r.name,
    );
    expect([...privileged].sort()).toEqual([...PRIVILEGED].sort());
  });

  it("keeps the two sets different — Executive and Manager are privileged but keep trusted devices", () => {
    // The two lists look like one list with a longer tail, and reusing the
    // wider one would read as stricter. It is not: it would take the
    // trusted-device convenience away from two roles the spec deliberately
    // leaves standard for this purpose.
    for (const name of ["EXECUTIVE_MANAGEMENT", "BRANCH_DEPARTMENT_MANAGER"]) {
      const role = ROLES.find((r) => r.name === name);
      expect(role, name).toBeDefined();
      expect(role!.requiresMfaAlways, `${name}.requiresMfaAlways`).toBe(false);
      expect(role!.requiresHardwareToken, `${name}.requiresHardwareToken`).toBe(
        true,
      );
    }
  });

  it("states both flags on every role rather than relying on the column default", () => {
    // `undefined` would fall through to `@default(true)` and silently make that
    // role strict. The seed must be explicit, which is why the fields are
    // required on `RoleSeed` — this asserts the runtime data, not just the type.
    for (const role of ROLES) {
      expect(typeof role.requiresMfaAlways, role.name).toBe("boolean");
      expect(typeof role.requiresHardwareToken, role.name).toBe("boolean");
    }
  });
});
