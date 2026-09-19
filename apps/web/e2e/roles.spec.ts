import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";

/**
 * Office-scoped custom RBAC, PHASE 3 — the Role screen.
 *
 * The screen the whole rework exists for: an office defining its own roles and
 * deciding what each one can do. Everything asserted here is a decision that was
 * made deliberately and would be invisible in a snapshot:
 *
 *  - `role.read` shows the catalogue; `role.manage` is what turns the controls
 *    on. Two names, split by the prep step precisely so a caller who may look
 *    but not edit gets a usable read-only screen rather than a 403.
 *  - A system role is read-only, and its retire button is ABSENT rather than
 *    present-and-refused.
 *  - The classify/co-sign pair WARNS and saves anyway. That was an explicit
 *    decision, not a half-built refusal.
 *  - The two MFA attributes are editable, behind a step-up challenge, because
 *    the alternative was every custom role demanding MFA forever.
 */

const ME_BASE = {
  id: "user-1",
  email: "office.admin@ibms.test",
  fullName: "Office Administrator",
  languagePreference: "EN",
  mfaEnabled: true,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

async function mockAuth(page: Page, roles: string[], language = "EN") {
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fake-access-token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      status: 200,
      json: {
        ...ME_BASE,
        languagePreference: language,
        roles,
        permissions: permissionsForRoles(roles),
      },
    }),
  );
}

/**
 * A caller whose permissions are named directly rather than derived from a
 * seeded role.
 *
 * Needed for exactly one case: `role.read` WITHOUT `role.manage`. No seeded role
 * holds that combination — every holder of `role.read` in the grid also holds
 * `role.manage` — so the read-only caller is a role an OFFICE would define, which
 * is the entire point of the phase. Deriving it from a legacy role name would be
 * asserting against a role that cannot exist.
 */
async function mockAuthWithPermissions(page: Page, permissions: string[]) {
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fake-access-token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      status: 200,
      json: { ...ME_BASE, roles: ["CLAIMS_AUDIT_VIEWER"], permissions },
    }),
  );
}

/** Two roles: one the office defined, one the platform did. The pair is the
 *  point — every protection assertion needs both to mean anything. */
const CUSTOM_ROLE = {
  id: "role-custom",
  name: "CLAIMS_TRIAGE_DESK",
  nameEn: "Claims Triage Desk",
  nameAr: "مكتب فرز المطالبات",
  description: "First look at every new claim before it reaches an adjuster.",
  status: "ACTIVE" as const,
  isSystem: false,
  requiresMfaAlways: true,
  requiresHardwareToken: true,
  holderCount: 3,
  permissionCount: 2,
};

const SYSTEM_ROLE = {
  id: "role-system",
  name: "OFFICE_ADMINISTRATOR",
  nameEn: "Office Administrator",
  nameAr: "مدير المكتب",
  description: "Provisions users and defines the office's own roles.",
  status: "ACTIVE" as const,
  isSystem: true,
  requiresMfaAlways: true,
  requiresHardwareToken: true,
  holderCount: 1,
  permissionCount: 22,
};

const CATALOGUE = [
  {
    code: "claim.read",
    module: "claims",
    description: "View a claim and its documents",
  },
  {
    code: "claim.register",
    module: "claims",
    description: "Register a notified claim",
  },
  {
    code: "incident.classify",
    module: "compliance-risk",
    description: "Classify a security incident",
  },
  {
    code: "incident.classification.co-sign",
    module: "compliance-risk",
    description: "Countersign an incident classification",
  },
];

async function mockRoles(
  page: Page,
  options: { grants?: string[]; roles?: unknown[] } = {},
) {
  const roles = options.roles ?? [CUSTOM_ROLE, SYSTEM_ROLE];
  await page.route("http://localhost:4000/rbac/roles", (route) =>
    route.fulfill({ status: 200, json: roles }),
  );
  await page.route("http://localhost:4000/rbac/permissions", (route) =>
    route.fulfill({ status: 200, json: CATALOGUE }),
  );
  await page.route(
    `http://localhost:4000/rbac/roles/${CUSTOM_ROLE.id}`,
    (route) =>
      route.fulfill({
        status: 200,
        json: {
          ...CUSTOM_ROLE,
          permissionCodes: options.grants ?? ["claim.read", "claim.register"],
        },
      }),
  );
  await page.route(
    `http://localhost:4000/rbac/roles/${SYSTEM_ROLE.id}`,
    (route) =>
      route.fulfill({
        status: 200,
        json: { ...SYSTEM_ROLE, permissionCodes: ["user.manage"] },
      }),
  );
}

test("lists the office's own roles, retired ones included, with holder counts", async ({
  page,
}) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockRoles(page, {
    roles: [
      CUSTOM_ROLE,
      SYSTEM_ROLE,
      {
        ...CUSTOM_ROLE,
        id: "role-retired",
        name: "SEASONAL_TEMP",
        nameEn: "Seasonal Temp",
        status: "INACTIVE",
        holderCount: 0,
      },
    ],
  });

  await page.goto("/settings/roles");
  await expect(
    page.getByRole("heading", { name: "Roles and permissions" }),
  ).toBeVisible();

  // A retired role MUST be listed: deactivating is the only removal there is, and
  // a screen that hid retired roles would leave an office unable to reactivate
  // one — the only way back.
  await expect(page.locator('[data-role="SEASONAL_TEMP"]')).toHaveCount(1);
  await expect(
    page.locator('[data-role="SEASONAL_TEMP"] [data-status="INACTIVE"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('[data-role="SEASONAL_TEMP"]').getByRole("button", {
      name: "Reactivate",
    }),
  ).toHaveCount(1);

  // The holder count is what makes retiring a role an informed decision.
  await expect(
    page.locator('[data-role="CLAIMS_TRIAGE_DESK"]').getByText("3", {
      exact: true,
    }),
  ).toHaveCount(1);
});

test("role.read alone renders the catalogue with no editing controls", async ({
  page,
}) => {
  // The reason `role.manage` was split out of it. A caller who may audit the
  // office's roles but not change them is a real caller, and must get a usable
  // screen rather than a 403 or a row of buttons that fail.
  await mockAuthWithPermissions(page, ["role.read", "permission.read"]);
  await page.route("http://localhost:4000/rbac/roles", (route) =>
    route.fulfill({ status: 200, json: [CUSTOM_ROLE, SYSTEM_ROLE] }),
  );
  await page.route("http://localhost:4000/rbac/permissions", (route) =>
    route.fulfill({ status: 200, json: CATALOGUE }),
  );

  await page.goto("/settings/roles");
  await expect(page.locator('[data-role="CLAIMS_TRIAGE_DESK"]')).toHaveCount(1);

  await expect(
    page.getByRole("heading", { name: "Create a role" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Permissions" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retire role" })).toHaveCount(0);
});

test("a system role is read-only, and its retire button is absent rather than refused", async ({
  page,
}) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockRoles(page);

  await page.goto("/settings/roles");

  // The badge explains itself on hover — `isSystem` grants nothing, and saying
  // so where an administrator reads it is the only defence against the flag being
  // understood as a privilege.
  const systemRow = page.locator('[data-role="OFFICE_ADMINISTRATOR"]');
  await expect(systemRow.locator("[data-system-badge]")).toHaveCount(1);
  await expect(
    systemRow.getByRole("button", { name: "Retire role" }),
  ).toHaveCount(0);
  // The office's own role keeps its button.
  await expect(
    page
      .locator('[data-role="CLAIMS_TRIAGE_DESK"]')
      .getByRole("button", { name: "Retire role" }),
  ).toHaveCount(1);

  await systemRow.getByRole("button", { name: "Permissions" }).click();
  await expect(
    page.locator('[data-matrix-for="OFFICE_ADMINISTRATOR"]'),
  ).toHaveCount(1);
  await expect(page.getByText("This is a system role")).toBeVisible();
  // Every checkbox disabled, and no save control at all.
  const boxes = page.locator('[data-matrix-for] input[type="checkbox"]');
  await expect(boxes).toHaveCount(CATALOGUE.length);
  for (let i = 0; i < CATALOGUE.length; i += 1) {
    await expect(boxes.nth(i)).toBeDisabled();
  }
  await expect(
    page.getByRole("button", { name: "Save permissions" }),
  ).toHaveCount(0);
});

test("saves the whole grant set at once, grouped by module", async ({ page }) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockRoles(page);
  let saved: string[] | null = null;
  await page.route(
    `http://localhost:4000/rbac/roles/${CUSTOM_ROLE.id}/permissions`,
    async (route) => {
      saved = (route.request().postDataJSON() as { permissionCodes: string[] })
        .permissionCodes;
      return route.fulfill({ status: 200, json: { ok: true } });
    },
  );

  await page.goto("/settings/roles");
  await page
    .locator('[data-role="CLAIMS_TRIAGE_DESK"]')
    .getByRole("button", { name: "Permissions" })
    .click();

  // Grouped by module, and the two modules in the fixture are both headings.
  // `exact: true` — the matrix's own heading is "Permissions for Claims Triage
  // Desk", and `getByRole(name)` matches case-insensitive substrings.
  await expect(
    page.getByRole("heading", { name: "claims", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "compliance-risk", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Selected: 2 of 4")).toBeVisible();

  // Add one, remove one — then the PUT must carry the state the screen believes,
  // not a delta.
  await page.locator('[data-code="incident.classify"]').check();
  await page.locator('[data-code="claim.register"]').uncheck();
  await page.getByRole("button", { name: "Save permissions" }).click();
  await expect(page.getByText("Permissions saved.")).toBeVisible();

  expect(saved).not.toBeNull();
  expect([...(saved as unknown as string[])].sort()).toEqual([
    "claim.read",
    "incident.classify",
  ]);
});

test("warns — and still saves — when one role both classifies and co-signs", async ({
  page,
}) => {
  // The decision this test exists to pin down. A small office may legitimately
  // want one role for both, and `assertDifferentActors` still refuses a co-sign
  // by whoever recorded the classification, so instance-level independence holds
  // however the roles are arranged. The warning exists because role-level
  // independence becomes a configuration choice in this phase, and a choice
  // nobody was told about is not a choice.
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockRoles(page, { grants: ["incident.classify"] });
  let saved: string[] | null = null;
  await page.route(
    `http://localhost:4000/rbac/roles/${CUSTOM_ROLE.id}/permissions`,
    async (route) => {
      saved = (route.request().postDataJSON() as { permissionCodes: string[] })
        .permissionCodes;
      return route.fulfill({ status: 200, json: { ok: true } });
    },
  );

  await page.goto("/settings/roles");
  await page
    .locator('[data-role="CLAIMS_TRIAGE_DESK"]')
    .getByRole("button", { name: "Permissions" })
    .click();

  // One half checked: no warning yet.
  await expect(page.locator("[data-segregation-warning]")).toHaveCount(0);

  await page
    .locator('[data-code="incident.classification.co-sign"]')
    .check();
  await expect(page.locator("[data-segregation-warning]")).toHaveCount(1);
  await expect(page.getByText("classifies an incident and co-signs")).toBeVisible();

  // And it saves anyway — a warning, never a refusal.
  await page.getByRole("button", { name: "Save permissions" }).click();
  await expect(page.getByText("Permissions saved.")).toBeVisible();
  expect([...(saved as unknown as string[])].sort()).toEqual([
    "incident.classification.co-sign",
    "incident.classify",
  ]);
});

test("the MFA attributes are editable, and only after a step-up challenge", async ({
  page,
}) => {
  // Finding F5. Not exposing these would leave every custom role demanding MFA on
  // every login forever, pushing offices back onto the legacy roles and defeating
  // the point of the phase. Exposing them lets an administrator RELAX a security
  // control from a screen — so the endpoint carries `@RequireStepUp()`, and this
  // screen is its first consumer anywhere in the app.
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockRoles(page);
  let stepUpBody: unknown = null;
  let attributes: unknown = null;
  await page.route("http://localhost:4000/auth/step-up", async (route) => {
    stepUpBody = route.request().postDataJSON();
    return route.fulfill({ status: 201, json: {} });
  });
  await page.route(
    `http://localhost:4000/rbac/roles/${CUSTOM_ROLE.id}/security-attributes`,
    async (route) => {
      attributes = route.request().postDataJSON();
      return route.fulfill({
        status: 200,
        json: { ...CUSTOM_ROLE, requiresMfaAlways: false },
      });
    },
  );

  await page.goto("/settings/roles");
  await page
    .locator('[data-role="CLAIMS_TRIAGE_DESK"]')
    .getByRole("button", { name: "Permissions" })
    .click();

  // Relax the strict default, then save: the challenge appears BEFORE the write.
  await page.getByLabel("Always require MFA").uncheck();
  await page.getByRole("button", { name: "Save security attributes" }).click();
  await expect(page.locator("[data-step-up]")).toHaveCount(1);
  expect(attributes, "nothing may be written before the challenge").toBeNull();

  await page.getByLabel("Password").fill("Correct-Horse-Battery-Staple-9");
  await page.getByRole("button", { name: "Confirm and continue" }).click();

  await expect.poll(() => attributes).not.toBeNull();
  expect(stepUpBody).toMatchObject({
    password: "Correct-Horse-Battery-Staple-9",
  });
  expect(attributes).toEqual({
    requiresMfaAlways: false,
    requiresHardwareToken: true,
  });
  // The challenge closes on success.
  await expect(page.locator("[data-step-up]")).toHaveCount(0);
});

test("surfaces the last-administrator refusal verbatim instead of a generic error", async ({
  page,
}) => {
  // The API refuses to retire the last role granting user administration, under an
  // advisory lock, and its message says what to do instead. Replacing that with
  // "could not load roles" would leave an administrator with no idea why the
  // button did nothing.
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockRoles(page);
  const refusal =
    "Refusing to retire the last role that grants user administration — grant user.manage to another role first.";
  await page.route(
    `http://localhost:4000/rbac/roles/${CUSTOM_ROLE.id}/retire`,
    (route) =>
      route.fulfill({
        status: 422,
        json: { statusCode: 422, message: refusal },
      }),
  );

  await page.goto("/settings/roles");
  await page
    .locator('[data-role="CLAIMS_TRIAGE_DESK"]')
    .getByRole("button", { name: "Retire role" })
    .click();
  await expect(page.getByText("last role that grants user administration")).toBeVisible();
});

test("surfaces the refusal when a permission save would remove the last administrator", async ({
  page,
}) => {
  // The FOURTH route to the administrator lockout, and the one this screen opens:
  // unchecking `user.manage` does not look like an access action, but it takes the
  // capability away exactly as a revoke does. A different handler from the retire
  // button above, so its own test — and the API's message, not a generic one,
  // because it says what to do instead.
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockRoles(page);
  const refusal =
    "Refusing to remove user administration from the last role whose holders have it — nobody would be able to grant it back. Give another role that permission, and somebody that role, first.";
  await page.route(
    `http://localhost:4000/rbac/roles/${CUSTOM_ROLE.id}/permissions`,
    (route) =>
      route.fulfill({ status: 422, json: { statusCode: 422, message: refusal } }),
  );

  await page.goto("/settings/roles");
  await page
    .locator('[data-role="CLAIMS_TRIAGE_DESK"]')
    .getByRole("button", { name: "Permissions" })
    .click();
  await page.getByRole("button", { name: "Save permissions" }).click();

  await expect(
    page.getByText("last role whose holders have it"),
  ).toBeVisible();
  // And the save is NOT reported as having succeeded.
  await expect(page.getByText("Permissions saved.")).toHaveCount(0);
});

test("creates a role the office named itself", async ({ page }) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockRoles(page);
  let created: unknown = null;
  await page.route("http://localhost:4000/rbac/roles", async (route) => {
    if (route.request().method() === "POST") {
      created = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: CUSTOM_ROLE });
    }
    return route.fulfill({ status: 200, json: [CUSTOM_ROLE, SYSTEM_ROLE] });
  });

  await page.goto("/settings/roles");
  await page.getByLabel("Machine name").fill("RENEWALS_DESK");
  await page.getByLabel("Name (English)").fill("Renewals Desk");
  await page.getByLabel("Name (Arabic)").fill("مكتب التجديدات");
  await page.getByRole("button", { name: "Create role" }).click();

  await expect.poll(() => created).not.toBeNull();
  expect(created).toMatchObject({
    name: "RENEWALS_DESK",
    nameEn: "Renewals Desk",
    nameAr: "مكتب التجديدات",
  });
});

test("renders a custom role's Arabic display name on an Arabic page", async ({
  page,
}) => {
  // A role an office defines has no translation key and never will, so the
  // bilingual display names stored ON the role are the only thing standing
  // between an Arabic page and a Latin-script name mid-sentence. The legacy roles
  // keep their translated labels, which is why both are checked here.
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"], "AR");
  await mockRoles(page);

  await page.goto("/settings/roles");
  await expect(page.getByText("مكتب فرز المطالبات")).toBeVisible();
  await expect(page.getByText("Claims Triage Desk")).toHaveCount(0);
});

test("roles screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockRoles(page);

  await page.goto("/settings/roles");
  await expect(
    page.getByRole("heading", { name: "Roles and permissions" }),
  ).toBeVisible();
  const list = await new AxeBuilder({ page }).analyze();
  expect(
    list.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);

  await page
    .locator('[data-role="CLAIMS_TRIAGE_DESK"]')
    .getByRole("button", { name: "Permissions" })
    .click();
  await expect(page.locator("[data-matrix-for]")).toHaveCount(1);
  const matrix = await new AxeBuilder({ page }).analyze();
  expect(
    matrix.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
