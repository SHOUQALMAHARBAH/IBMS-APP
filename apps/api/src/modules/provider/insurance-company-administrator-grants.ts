/**
 * MODULE 0-ب ITEM (f), THE COMPANY HALF — what an insurance company's first administrator may do.
 *
 * ## EIGHT CODES SINCE 2026-10-17 — OWNER DECISION 11, AND IT CLOSED A HALF-BUILT ROLE
 *
 * The six below became eight: `branch.read` and `department.read` joined them. Her reasoning, and it
 * is worth keeping because it is the distinction between a decision and a workaround:
 *
 *   "The role was created for self-administration — its six codes are roles, users and
 *    `permission.read`, and this file says so in its own header. A role trusted to provision users
 *    that cannot fill the two fields `provision-user.dto.ts` makes mandatory is not a role that was
 *    decided against; it is a role that is half built."
 *
 * ## WHY THIS IS NOT THE FORBIDDEN MOVE
 *
 * The standing rule forbids granting a role a code TO MAKE A SCREEN WORK. This is not that. The
 * question put to the owner was a CAPABILITY question — what is this role for — and a keyring is the
 * answer to exactly that question. The grant is the expression of her answer, not a way around a
 * refusal. Register entry 49 holds the full exchange, including why it was raised rather than chosen.
 *
 * ## THE ENUMERATION THAT HAD TO COME FIRST
 *
 * Widening a ROUTE reaches every holder of the code named; widening a ROLE reaches every ROUTE that
 * names the code added. That second direction had never been applied here, so before the two codes
 * went in, `scripts/measurements/routes-gated-on.py branch.read department.read` enumerated every
 * route they gate — composite sets resolved, writes included. Three, all reads, all in
 * `org-structure.controller.ts`:
 *
 *   GET /admin/branches          branch.read + provider.office.administrator.invite
 *   GET /admin/departments       department.read + provider.office.administrator.invite
 *   GET /admin/branches/search   branch.read + nine others, INCLUDING `user.manage`
 *
 * The third is the one worth noticing: the company administrator ALREADY reached it, through
 * `user.manage`. So these two codes open exactly the two routes the decision is about and nothing
 * else. No write anywhere in the api is gated on either, and every model those routes reach carries
 * `organizationId`, so the company reads ITS OWN branches and departments.
 *
 * ## SIX CODES, AND THE SHORTNESS WAS THE FINDING RATHER THAN AN OMISSION
 *
 * Selected FROM THE CATALOGUE rather than copied from `OFFICE_ADMINISTRATOR_GRANTS`, which is the
 * owner's instruction and also the only defensible method: an office administrator's 47 codes cover
 * branches, departments, employees, insurers, vendors and the registers an office maintains, and an
 * insurance company has none of those things in this product.
 *
 * What is left when you select honestly is SELF-ADMINISTRATION and nothing else — the same six the
 * provider organization holds for itself:
 *
 *   permission.read · role.read · role.create · role.update · role.deactivate · user.manage
 *
 * So a company administrator can define roles inside the company and give its people accounts. It
 * can do nothing else, because there is nothing else here for a company to do yet. That was raised as
 * a stop condition before this was built (deferred register entry 26) and the answer was to ship the
 * honest six rather than invent capability to make the role look fuller.
 *
 * ## THERE IS DELIBERATELY NO CODE FOR READING ITS OWN REGISTRY RECORD
 *
 * `GET /company/registry-record` is gated on the caller's ORGANIZATION TYPE, not on a permission, and
 * that is a decision with two reasons.
 *
 * The first is that it asks an IDENTITY question — is the caller this company — rather than a
 * capability question. The second is what a code would mean in practice: a checkbox an administrator
 * could uncheck to blind their own company to its own registry record. Nobody administers that
 * separately, and this module has already refused to declare three codes on exactly that ground.
 *
 * It is also not expressible as the grid stands, which is worth recording so the next reader does not
 * re-derive it: `permissions.spec.ts` requires every OFFICE-scoped code to name at least one role,
 * `INSURANCE_COMPANY_ADMINISTRATOR` cannot enter that grid (the seeded `ROLES` are pinned to the
 * `RoleName` enum), and a PLATFORM-scoped code may be held only by the provider. An OFFICE code with
 * an empty role list fails the guard; a PLATFORM code the company holds breaks the provider
 * invariant. The route-level type check sidesteps both without weakening either.
 */
export const INSURANCE_COMPANY_ADMINISTRATOR_GRANTS: readonly string[] = [
  /*
   * OWNER DECISION 11, 2026-10-17. The two org-unit reads are what make `user.manage` usable: the
   * provisioning DTO requires a department and a branch, so a role that may provision and may not
   * read those two lists cannot provision anybody. `user.manage` STAYS — the owner was offered the
   * alternative of removing it instead and did not choose it.
   */
  'branch.read',
  'department.read',
  'permission.read',
  'role.create',
  'role.deactivate',
  'role.read',
  'role.update',
  'user.manage',
];

export const INSURANCE_COMPANY_ADMINISTRATOR_ROLE_NAME =
  'INSURANCE_COMPANY_ADMINISTRATOR';
