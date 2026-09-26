import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";
import { anchoredAttributes, anchoredCount, expectNone } from "./support/anchored";

/**
 * Office-scoped custom RBAC, PHASE 3 — the Role screen.
 *
 * The screen the whole rework exists for: an office defining its own roles and
 * deciding what each one can do. Everything asserted here is a decision that was
 * made deliberately and would be invisible in a snapshot:
 *
 *  - `role.read` shows the catalogue; `role.create`/`.update`/`.deactivate` turn the controls
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
 * Needed for exactly one case: `role.read` WITHOUT the write codes. No seeded role
 * holds that combination — every holder of `role.read` in the grid also holds
 * the write codes — so the read-only caller is a role an OFFICE would define, which
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
  // The reason the write codes were split out of it. A caller who may audit the
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
  const boxes = page.locator('[data-matrix-for] input[type="checkbox"][data-code]');
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

  // Grouped by module, and each module is now a collapsible section carrying its own count — the
  // matrix renders 186 permissions in the real catalogue, so it opens collapsed and nobody scrolls
  // 159 lines to see what a role holds. The module headings are `summary` elements now, not `h3`s.
  const matrix = page.locator("[data-matrix-for] [data-permission-matrix]");
  await expect(matrix.locator('details[data-module="claims"]')).toBeVisible();
  await expect(matrix.locator('details[data-module="compliance-risk"]')).toBeVisible();
  // The permanent summary answers "what can this role do?" without expanding anything.
  await expect(matrix.locator("[data-matrix-summary]")).toContainText("2 of 4");

  // Add one, remove one — then the PUT must carry the state the screen believes, not a delta. The
  // modules have to be opened first, which is the collapsed default working as intended.
  await matrix.locator('details[data-module="compliance-risk"] summary').click();
  await matrix.locator('details[data-module="claims"] summary').click();
  await matrix.locator('[data-code="incident.classify"]').check();
  await matrix.locator('[data-code="claim.register"]').uncheck();
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

  // Scoped to the edit panel and opened first: the page now has a matrix in the creation form too,
  // so an unscoped `[data-code]` matches twice, and modules start collapsed by design.
  await page
    .locator('[data-matrix-for] details[data-module="compliance-risk"] summary')
    .click();
  await page
    .locator('[data-matrix-for] [data-code="incident.classification.co-sign"]')
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
  // The machine name is no longer typed — it is generated from the English name and shown read-only.
  // Owner decision, 2026-09-24: an office administrator must not be asked to invent an immutable
  // identifier that lands in the audit log.
  await page.getByLabel("Name (English)").fill("Renewals Desk");
  await page.getByLabel("Name (Arabic)").fill("مكتب التجديدات");
  await page.getByRole("button", { name: "Create role" }).click();

  await expect.poll(() => created).not.toBeNull();
  expect(created).toMatchObject({
    // Generated from "Renewals Desk", not typed.
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

/**
 * The owner reported this screen rendering blank, and 454 green Playwright tests had not caught a
 * screen that renders nothing — because a navigation test that stops at the href shares the
 * assumption it should be checking.
 *
 * These two assert CONTENT. Neither asserts a status code and neither asserts an href.
 */
test("shows the office's roles as CONTENT — a heading and real rows, not just a reachable route", async ({
  page,
}) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockRoles(page);
  await page.goto("/settings/roles");

  // The heading alone is not evidence the screen works: it renders before any data arrives, which
  // is exactly how a blank-looking screen still passes a smoke test.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("tbody tr")).not.toHaveCount(0);
  await expect(page.locator(`[data-role="${CUSTOM_ROLE.name}"]`)).toBeVisible();
});

test("a caller who cannot read roles is TOLD so, rather than left on a near-empty screen", async ({
  page,
}) => {
  // Holding nothing relevant. The client knows this before it asks the API, so it never asks — and
  // the no-permission message lived only in the failed-request path, which therefore never ran.
  // Result: a heading, one sentence of intro, and nothing else: no table, no empty state, no
  // explanation. The requirement is explicit — no screen leaves a person facing a blank page.
  await mockAuthWithPermissions(page, ["claim.read"]);
  await page.goto("/settings/roles");

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Scoped to `main`, and to the sentence itself. The first version of this test asserted a
  // page-wide role=status|alert and PASSED on cb24c60 — satisfied by an empty-text live region
  // outside the content area, while `main` held 157 characters of heading and intro and nothing
  // else. A test that can be satisfied from outside the screen is not testing the screen.
  await expect(
    page.locator("main").getByText(/role\.read|صلاحية role\.read/),
  ).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(0);
});

test("says so when the API answers with something it cannot parse", async ({ page }) => {
  // The reported symptom shape: 200, a body that is not JSON (an HTML page document), nothing to
  // render. A screen that cannot parse a response must say so, not fall silent.
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await page.route("http://localhost:4000/rbac/roles", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html></html>" }),
  );
  await page.route("http://localhost:4000/rbac/permissions", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.goto("/settings/roles");

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(/تعذّر تحميل الأدوار|Could not load/i)).toBeVisible();
});

/**
 * Piece 2: permissions belong to CREATION, the machine name is generated, and delete is immediate.
 *
 * Every test here asserts what a person sees or what the API was asked to store — not a status code.
 */
test("creation carries the permissions with it, in ONE request", async ({ page }) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockRoles(page);

  let posted: Record<string, unknown> | null = null;
  await page.route("http://localhost:4000/rbac/roles", async (route) => {
    if (route.request().method() !== "POST") {
      return route.fulfill({ status: 200, json: [CUSTOM_ROLE, SYSTEM_ROLE] });
    }
    posted = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ status: 201, json: { ...CUSTOM_ROLE, id: "role-new" } });
  });

  await page.goto("/settings/roles");
  // Scoped to the creation form: the edit panel carries its own English/Arabic name fields, so an
  // unscoped label query matches twice once a role is open.
  await page.locator("[data-create-name-en]").fill("Claims Triage Desk");
  await page.locator("[data-create-name-ar]").fill("مكتب فرز المطالبات");

  // The matrix is INSIDE the creation form.
  const matrix = page.locator("form [data-permission-matrix]");
  await expect(matrix).toBeVisible();
  await matrix.locator('[data-module="claims"]').locator("summary").click();
  const firstCode = matrix.locator('[data-module="claims"] input[type=checkbox]').first();
  await firstCode.check();

  await page.getByRole("button", { name: /Create role|إنشاء الدور/ }).click();
  await expect.poll(() => posted !== null).toBe(true);

  const body = posted as unknown as { name: string; permissionCodes: string[] };
  // The machine name was GENERATED from the English name, not typed.
  expect(body.name).toBe("CLAIMS_TRIAGE_DESK");
  // And the permissions travelled with it.
  expect(body.permissionCodes.length).toBeGreaterThan(0);
});

test("shows the generated machine name before saving, and refuses an unreadable one", async ({
  page,
}) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockRoles(page);
  await page.goto("/settings/roles");

  const english = page.locator("[data-create-name-en]");
  const shown = page.locator("[data-generated-machine-name]");

  await english.fill("Senior Underwriter");
  await expect(shown).toHaveText("SENIOR_UNDERWRITER");

  // Arabic in the English-name field folds to nothing — the measured real-world failure. The form
  // must refuse rather than store an identifier nobody can read back to a role.
  await english.fill("دور جديد");
  await expect(page.locator("[data-machine-name-problem]")).toBeVisible();
  await expect(page.getByRole("button", { name: /Create role|إنشاء الدور/ })).toBeDisabled();

  // Digits alone say nothing about which role this is.
  await english.fill("2024");
  await expect(page.locator("[data-machine-name-problem]")).toBeVisible();

  await english.fill("HR");
  await expect(shown).toHaveText("HR");
  await expect(page.locator("[data-machine-name-problem]")).toHaveCount(0);
});

test("the matrix opens collapsed, counts each module, and searches across all of them", async ({
  page,
}) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockRoles(page);
  await page.goto("/settings/roles");

  const matrix = page.locator("form [data-permission-matrix]");
  // The answer to "what can this role do?" without expanding anything.
  await expect(matrix.locator("[data-matrix-summary]")).toBeVisible();
  const modules = matrix.locator("details[data-module]");
  await expect(modules).not.toHaveCount(0);
  // Collapsed on arrival: no module is open until someone opens it.
  expect((await anchoredAttributes(modules, "open")).filter((v) => v !== null)).toEqual([]);
  // Every module carries its own count.
  await expect(matrix.locator("[data-module-count]").first()).toBeVisible();

  // Search reaches a permission without knowing which module owns it, and opens what it matched.
  await matrix.locator("[data-matrix-search]").fill("incident.classify");
  await expect(matrix.locator('input[data-code="incident.classify"]')).toBeVisible();
  await matrix.locator("[data-matrix-search]").fill("zzz-nothing-matches");
  await expect(matrix.getByRole("status")).toBeVisible();
});

test("deleting a role withdraws it immediately, and says what that means first", async ({ page }) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockRoles(page);
  let deleted: string | null = null;
  await page.route(`http://localhost:4000/rbac/roles/${CUSTOM_ROLE.id}`, async (route) => {
    if (route.request().method() === "DELETE") {
      deleted = CUSTOM_ROLE.id;
      return route.fulfill({ status: 204, body: "" });
    }
    return route.fallback();
  });

  await page.goto("/settings/roles");
  await page.locator(`[data-delete-role="${CUSTOM_ROLE.name}"]`).click();

  // The confirmation states the two consequences the owner accepted, rather than asking to reassign.
  const confirm = page.locator(`[data-delete-confirm="${CUSTOM_ROLE.name}"]`);
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText(/no reassignment|بلا إعادة إسناد/);
  await confirm.locator("[data-confirm-delete]").click();
  await expect.poll(() => deleted).toBe(CUSTOM_ROLE.id);
});

test("a system role offers no delete control at all", async ({ page }) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockRoles(page);
  await page.goto("/settings/roles");

  // Positive anchor first, so the absence below means something.
  await expect(page.locator(`[data-delete-role="${CUSTOM_ROLE.name}"]`)).toBeVisible();
  await expect(page.locator(`[data-delete-role="${SYSTEM_ROLE.name}"]`)).toHaveCount(0);
});

/**
 * Part 1 — the four things the owner hit while using the screen. Every one of these asserts what she
 * would see, and each corresponds to a sentence in her feedback.
 */
test("puts the create form ABOVE the table, so adding a role needs no scrolling past it", async ({
  page,
}) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockRoles(page);
  await page.goto("/settings/roles");

  const createForm = page.locator("form:has([data-generated-machine-name])");
  const table = page.locator("table");
  await expect(createForm).toBeVisible();
  await expect(table).toBeVisible();

  // Position, not order in the DOM as a proxy for it: the form's top edge must be above the table's.
  const formBox = await createForm.boundingBox();
  const tableBox = await table.boundingBox();
  expect(formBox!.y).toBeLessThan(tableBox!.y);
});

test("the row's permissions button opens the editor and shows what that role holds", async ({
  page,
}) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockRoles(page, { grants: ["claim.read", "claim.register"] });
  await page.goto("/settings/roles");

  // It appeared to "do nothing" because the editor rendered below everything else. Anchored on the
  // row whose button is about to be pressed: otherwise "no editor yet" and "nothing rendered yet"
  // are the same observation.
  await expectNone(
    page.locator("[data-matrix-for]"),
    page.locator(`[data-role="${CUSTOM_ROLE.name}"]`),
  );
  await page
    .locator(`[data-role="${CUSTOM_ROLE.name}"]`)
    .getByRole("button", { name: "Permissions" })
    .click();

  const editor = page.locator("[data-matrix-for]");
  await expect(editor).toBeVisible();
  // And it shows what the role currently holds, not an empty matrix.
  await expect(editor.locator("[data-matrix-summary]")).toContainText("2 of 4");
  await editor.locator('details[data-module="claims"] summary').click();
  await expect(editor.locator('input[data-code="claim.read"]')).toBeChecked();

  // Above the table, so the click lands somewhere visible.
  const editorBox = await editor.boundingBox();
  const tableBox = await page.locator("table").boundingBox();
  expect(editorBox!.y).toBeLessThan(tableBox!.y);
});

test("the section-level control selects EVERY permission in that section", async ({ page }) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockRoles(page);
  await page.goto("/settings/roles");

  const matrix = page.locator("form [data-permission-matrix]");
  const claims = matrix.locator('details[data-module="claims"]');
  await claims.locator("summary").click();
  const boxes = claims.locator('input[type=checkbox][data-code]');
  const count = await anchoredCount(boxes);
  expect(count).toBeGreaterThan(1);

  await matrix.locator('[data-select-all="claims"]').check();
  // EVERY one, not the first, and not only the CRUD-shaped rows.
  for (let i = 0; i < count; i += 1) await expect(boxes.nth(i)).toBeChecked();
  await expect(matrix.locator('[data-module-count="claims"]')).toContainText(`${count} / ${count}`);

  // And it clears the whole section again.
  await matrix.locator('[data-select-all="claims"]').uncheck();
  for (let i = 0; i < count; i += 1) await expect(boxes.nth(i)).not.toBeChecked();
});

test("explains a permission in a line of prose beneath its name, not as the code repeated", async ({
  page,
}) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockRoles(page);
  await page.goto("/settings/roles");

  const matrix = page.locator("form [data-permission-matrix]");
  await matrix.locator('details[data-module="claims"] summary').click();

  // The slot exists and carries the stored description until the reviewed Arabic line arrives.
  const explanation = matrix.locator('[data-describes="claim.register"]');
  await expect(explanation).toBeVisible();
  const text = (await explanation.innerText()).trim();
  expect(text.length).toBeGreaterThan(0);
  // Not the code restated — that would look like an explanation and say nothing.
  expect(text).not.toBe("claim.register");
});

test("lists the operations that need two people, WORST first", async ({ page }) => {
  // Part 5's first honesty fix. The office found out which operations need two people by being refused
  // halfway through one; this is the list, on the screen where an office arranges exactly that.
  //
  // The ordering is the property. A row saying "nobody can complete this" is the reason the list exists,
  // and the API returns them in registry order — Refund (READY) first — so rendering that order would bury
  // the one row that matters.
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockRoles(page);
  await page.route("http://localhost:4000/rbac/duty-segregation-readiness", (route) =>
    route.fulfill({ status: 200, json: [
      {
        "entityType": "Refund",
        "pairLabel": "raisedByUserId / approvedByUserId",
        "constraint": "Refund_maker_checker_distinct",
        "checkerPermission": "refund.approve",
        "holderCount": 3,
        "status": "READY"
      },
      {
        "entityType": "DisposalBatch",
        "pairLabel": "nominatedByUserId / dpoApprovedByUserId",
        "constraint": "DisposalBatch_maker_checker_distinct",
        "checkerPermission": "retention.dispose.approve",
        "holderCount": 0,
        "status": "NOBODY"
      },
      {
        "entityType": "PolicyChecking",
        "pairLabel": "placedByUserId / checkedByUserId",
        "constraint": "PolicyChecking_maker_checker_distinct",
        "checkerPermission": "policy.check",
        "holderCount": 1,
        "status": "SINGLE_HOLDER"
      }
    ] }),
  );

  await page.goto("/settings/roles");
  const section = page.locator("[data-duty-segregation]");
  await expect(section.getByRole("heading", { name: "Operations that need two different people" })).toBeVisible();

  const statuses = await anchoredAttributes(
    section.locator("[data-duty-row]"),
    "data-duty-row",
    section,
  );
  expect(statuses).toEqual(["NOBODY", "SINGLE_HOLDER", "READY"]);

  // And each row says what to do about it: the permission a second person needs.
  await expect(section.getByText("retention.dispose.approve")).toBeVisible();
  await expect(section.getByText("Cannot be completed", { exact: false })).toBeVisible();
});
