/**
 * Every organization gets one default Branch and one default Department when it is created.
 *
 * ## WHY — MEASURED, NOT PREDICTED
 *
 * `provision-user.dto.ts` makes `departmentId` and `branchId` FLATLY REQUIRED. So a freshly created
 * organization cannot provision its first user until both lists hold at least one row — and the
 * owner's `seed:demo` run of 2026-10-17 created **1298 rows with ZERO Branch rows and ZERO Department
 * rows**, which is what turned this from a prediction into a measurement.
 *
 * It is not a permission problem and widening a route does not help: a newly registered office's
 * `OFFICE_ADMINISTRATOR` already holds `branch.read` and `department.read` and would still face two
 * empty required dropdowns. Item 1's route widening unblocks the provider's ability to READ the
 * lists; this is what puts something in them. Without both halves, neither works.
 *
 * ## ONE HOME, BECAUSE THERE ARE THREE CREATION PATHS
 *
 * A brokerage office and an insurance company are registered through module 0-ب's two provider
 * routes, and the provider organization itself is created by the seed. Three call sites in two
 * packages, so the names, the reason and the two inserts live here rather than being written out
 * three times — the third copy being where one of them silently stops matching the other two.
 *
 * The client parameter is structural rather than `PrismaClient`, so a `$transaction` client satisfies
 * it. That matters: both registration services create their organization inside a transaction, and a
 * default created outside it would survive a registration that rolled back.
 *
 * ## WHAT THESE ROWS ARE, AND WHAT THEY ARE NOT
 *
 * They are a STARTING POINT an office renames, not a structure imposed on it. `/settings/org-units`
 * can rename, add and retire both. They are deliberately named for what they are — "Head office" and
 * "General" — rather than after the organization, because an office that renames its head office
 * should not find the old organization name embedded in a row it did not choose.
 *
 * They are NOT a claim that the office has one branch. An office with three branches records the
 * other two; this one exists so the provisioning form has a value to offer on day one, which is the
 * whole of its purpose.
 */

/** The default Branch, in both languages. Renameable from `/settings/org-units`. */
export const DEFAULT_BRANCH = {
  name: "Head office",
  nameAr: "المركز الرئيسي",
} as const;

/** The default Department, in both languages. Renameable from `/settings/org-units`. */
export const DEFAULT_DEPARTMENT = {
  name: "General",
  nameAr: "عام",
} as const;

/** The minimum a client must offer. A `$transaction` client satisfies this; so does the full one. */
export interface OrgUnitWriter {
  branch: {
    create(args: {
      data: { organizationId: string; name: string; nameAr: string };
    }): Promise<unknown>;
    count(args: { where: { organizationId: string } }): Promise<number>;
  };
  department: {
    create(args: {
      data: { organizationId: string; name: string; nameAr: string };
    }): Promise<unknown>;
    count(args: { where: { organizationId: string } }): Promise<number>;
  };
}

/**
 * Create the two defaults for a newly created organization.
 *
 * IDEMPOTENT BY COUNT, not by upsert. There is no natural key to upsert on — a Branch is identified
 * by its id and an office may legitimately have two branches with the same name in different cities —
 * so "does this organization have any branch at all" is the only honest question, and it is also
 * exactly the condition the provisioning form cares about. The consequence is deliberate: an office
 * that RETIRES its last branch does not get a new one invented on the next call.
 *
 * `organizationId` is passed EXPLICITLY even though both models default it from the tenant context,
 * because the two registration paths run as the PROVIDER while creating a row that belongs to the new
 * organization — so the context's answer would be the wrong one.
 */
export async function ensureDefaultOrgUnits(
  client: OrgUnitWriter,
  organizationId: string,
): Promise<{ branchCreated: boolean; departmentCreated: boolean }> {
  const [branches, departments] = await Promise.all([
    client.branch.count({ where: { organizationId } }),
    client.department.count({ where: { organizationId } }),
  ]);

  const branchCreated = branches === 0;
  const departmentCreated = departments === 0;

  if (branchCreated) {
    await client.branch.create({
      data: { organizationId, ...DEFAULT_BRANCH },
    });
  }
  if (departmentCreated) {
    await client.department.create({
      data: { organizationId, ...DEFAULT_DEPARTMENT },
    });
  }

  return { branchCreated, departmentCreated };
}
