/**
 * MODULE 0-ب ITEM (f), THE COMPANY HALF — what an insurance company's first administrator may do.
 *
 * ## SIX CODES, AND THE SHORTNESS IS THE FINDING RATHER THAN AN OMISSION
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
  'permission.read',
  'role.create',
  'role.deactivate',
  'role.read',
  'role.update',
  'user.manage',
];

export const INSURANCE_COMPANY_ADMINISTRATOR_ROLE_NAME =
  'INSURANCE_COMPANY_ADMINISTRATOR';
