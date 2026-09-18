-- Office-scoped custom RBAC, PHASE 2 — the two MFA controls stop being
-- hard-coded lists of role NAMES and become security attributes of the role.
--
-- WHY A COLUMN AND NOT A PERMISSION
-- ---------------------------------
-- `ALWAYS_MFA_ROLES` and `PRIVILEGED_ROLES` matched on role name, so a role an
-- office invents appeared in neither and silently qualified for the exemption
-- the list existed to deny. Both controls failed OPEN — the only two in this
-- codebase that did.
--
-- The fix is not a permission. A permission can be granted away from the Role
-- screen, which would mean the control could be switched off from the very UI
-- this project is adding. A column with a strict default cannot.
--
-- WHY THE BACKFILL SETS FALSE AND NEVER TRUE
-- ------------------------------------------
-- `DEFAULT true` is the safe value, and ADD COLUMN applies it to every
-- existing row. Leaving it there would hand every Sales Officer a permanent
-- MFA prompt and take away the trusted-device convenience — a behaviour
-- change, in a phase whose whole gate is that behaviour does not change.
--
-- So the backfill lists only the legacy roles that must be RELAXED, by name,
-- across every organization (Phase 1 adopted or copied these rows per office,
-- so a name matches once per office that uses it). Anything this migration does
-- not recognise keeps `true` and therefore fails CLOSED. That asymmetry is the
-- point: a name nobody enumerated here is a name we cannot vouch for.

ALTER TABLE "Role"
  ADD COLUMN "requiresMfaAlways" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "requiresHardwareToken" BOOLEAN NOT NULL DEFAULT true;

-- Part II §4.4 names exactly three roles whose MFA guarantee must never be
-- softened by the trusted-device convenience: the administrator, Compliance and
-- the DPO. The other eight legacy roles keep the convenience they have today.
UPDATE "Role" SET "requiresMfaAlways" = false
WHERE "name" IN (
  'SALES_RELATIONSHIP_OFFICER',
  'PLACEMENT_TECHNICAL_OFFICER',
  'POLICY_CHECKING_OFFICER',
  'CLAIMS_OFFICER',
  'FINANCE_COLLECTIONS_OFFICER',
  'BRANCH_DEPARTMENT_MANAGER',
  'EXECUTIVE_MANAGEMENT',
  'EXTERNAL_AUDITOR'
);

-- Part 10.1's privileged set is deliberately WIDER than §4.4's, and the
-- difference is load-bearing: Executive Management and Branch/Department
-- Managers are in the hardware-token set but NOT the always-MFA set, so they
-- keep the trusted-device convenience while still being flagged for WebAuthn.
-- Collapsing the two lists would look stricter and would quietly take that
-- convenience away from both roles.
UPDATE "Role" SET "requiresHardwareToken" = false
WHERE "name" IN (
  'SALES_RELATIONSHIP_OFFICER',
  'PLACEMENT_TECHNICAL_OFFICER',
  'POLICY_CHECKING_OFFICER',
  'CLAIMS_OFFICER',
  'FINANCE_COLLECTIONS_OFFICER',
  'EXTERNAL_AUDITOR'
);
