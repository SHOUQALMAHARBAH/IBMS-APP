import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";

/**
 * Office-scoped custom RBAC, PHASE 3 — the unified User/Employee screen.
 *
 * `/settings/users` had NO web e2e coverage at all before this file, which is how
 * a real defect survived the move to id-addressed role assignment: the grant
 * dropdown's options carried the role NAME while `grantRole` posts that value as
 * `roleId`, and the API validates it as a UUID. Every grant an administrator made
 * from that dropdown was a 400. The last test here is the one that would have
 * caught it.
 *
 * The screen is one row per PERSON. `User.employeeId` is unique, and once linked
 * the HR record's four-part official name becomes the display name everywhere —
 * so the link is the organising idea rather than a field on a form, and the state
 * of the link is visible when only one half exists.
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

const ROLE_CATALOGUE = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "SALES_RELATIONSHIP_OFFICER",
    nameEn: "Sales / Relationship Officer",
    nameAr: "موظف المبيعات وعلاقات العملاء",
    description: null,
    status: "ACTIVE",
  },
  {
    // A role the OFFICE defined. It has no translation key and never will, so its
    // own display names are the only thing standing between an Arabic page and a
    // Latin-script name mid-sentence.
    id: "22222222-2222-4222-8222-222222222222",
    name: "CLAIMS_TRIAGE_DESK",
    nameEn: "Claims Triage Desk",
    nameAr: "مكتب فرز المطالبات",
    description: "First look at every new claim.",
    status: "ACTIVE",
  },
  {
    // RETIRED. The endpoint returns it (an office must be able to reactivate one), and this screen
    // must not OFFER it: permission resolution filters on `role.status = 'ACTIVE'`, so granting it
    // would hand someone a row that reads as access and confers none.
    id: "33333333-3333-4333-8333-333333333333",
    name: "OLD_DESK",
    nameEn: "Old Desk",
    nameAr: "مكتب قديم",
    description: "Retired last year.",
    status: "INACTIVE",
  },
];

/** Three people, covering the three states the unified screen exists to show:
 *  linked with roles, linked with none, and an account with no HR record. */
const USERS = [
  {
    id: "u-linked",
    fullName: "Nadia Haddad",
    email: "nadia@ibms.test",
    isActive: true,
    mfaEnabled: true,
    languagePreference: "AR",
    lastLoginAt: "2026-09-18T08:00:00.000Z",
    accessValidFrom: null,
    accessValidUntil: null,
    createdAt: "2026-01-05T09:00:00.000Z",
    roles: [{ id: ROLE_CATALOGUE[1].id, name: "CLAIMS_TRIAGE_DESK" }],
    employeeId: "emp-1",
  },
  {
    id: "u-no-roles",
    fullName: "Omar Saleh",
    email: "omar@ibms.test",
    isActive: true,
    mfaEnabled: false,
    languagePreference: "AR",
    lastLoginAt: null,
    accessValidFrom: null,
    accessValidUntil: null,
    createdAt: "2026-02-02T09:00:00.000Z",
    roles: [],
    employeeId: "emp-2",
  },
  {
    id: "u-unlinked",
    fullName: "Layla Mansour",
    email: "layla@ibms.test",
    isActive: false,
    mfaEnabled: false,
    languagePreference: "EN",
    lastLoginAt: null,
    accessValidFrom: null,
    accessValidUntil: null,
    createdAt: "2026-03-03T09:00:00.000Z",
    roles: [{ id: ROLE_CATALOGUE[0].id, name: "SALES_RELATIONSHIP_OFFICER" }],
    employeeId: null,
  },
];

const EMPLOYEES = [
  {
    id: "emp-1",
    fullName: "Nadia Ahmad Khalil Haddad",
    givenName: "Nadia",
    fatherName: "Ahmad",
    grandfatherName: "Khalil",
    familyName: "Haddad",
    position: "Claims Officer",
    hireDate: "2020-06-01T00:00:00.000Z",
    terminationDate: null,
    licensedRole: null,
  },
];

async function mockAdmin(page: Page, users: unknown[] = USERS) {
  await page.route("http://localhost:4000/admin/users**", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({ status: 200, json: { users, total: users.length } });
  });
  await page.route("http://localhost:4000/admin/departments", (route) =>
    route.fulfill({
      status: 200,
      json: [{ id: "dept-1", name: "Claims", nameAr: "المطالبات" }],
    }),
  );
  await page.route("http://localhost:4000/admin/branches", (route) =>
    route.fulfill({
      status: 200,
      json: [{ id: "branch-1", name: "Amman", nameAr: "عمّان" }],
    }),
  );
  await page.route("http://localhost:4000/employees", (route) =>
    route.fulfill({ status: 200, json: EMPLOYEES }),
  );
  await page.route("http://localhost:4000/rbac/roles", (route) =>
    route.fulfill({ status: 200, json: ROLE_CATALOGUE }),
  );
}

test("shows one row per person, with the state of the HR link on each", async ({
  page,
}) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockAdmin(page);

  await page.goto("/settings/users");
  await expect(page.getByText("nadia@ibms.test")).toBeVisible();

  // Linked: a way into the HR record. Not linked: said plainly, because somebody
  // still owes this person an employee record — and an HR record is where the
  // official four-part name, licensing and training live.
  const linked = page.locator('[data-hr-link="linked"]');
  const unlinked = page.locator('[data-hr-link="none"]');
  await expect(linked).toHaveCount(2);
  await expect(unlinked).toHaveCount(1);
  await expect(linked.first().getByRole("link", { name: "Open record" })).toHaveAttribute(
    "href",
    "/employees/emp-1",
  );
  await expect(page.getByText("No linked employee record")).toBeVisible();
});

test("badges an account with no roles instead of writing 'none'", async ({
  page,
}) => {
  // This stops being a rare state in Phase 3: a new office starts with ONE role,
  // and `POST /auth/signup` has always created accounts with zero. An account with
  // no roles can sign in and reach nothing, which reads as a broken system rather
  // than an unfinished setup.
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockAdmin(page);

  await page.goto("/settings/users");
  await expect(page.locator("[data-no-roles]")).toHaveCount(1);
  await expect(page.getByText("No roles assigned")).toBeVisible();
  // And only the one account: a row WITH roles must not carry the badge.
  await expect(page.locator("[data-no-roles]")).toHaveText("No roles assigned");
});

test("labels a custom role from the role's own display names, in Arabic", async ({
  page,
}) => {
  // The legacy roles keep their translated labels — real Arabic copy the office
  // did not write. A role an office DEFINES has no translation key, so it falls
  // back to its own `nameAr`, then the machine name. Both are on screen here.
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"], "AR");
  await mockAdmin(page);

  await page.goto("/settings/users");
  // Scoped to the TABLE. Each role label also appears in the provisioning
  // fieldset's checkbox list and in every row's grant dropdown, so an unscoped
  // `getByText` resolves to five elements and says nothing about the cell.
  const nadia = page.locator("tr", { hasText: "nadia@ibms.test" });
  const layla = page.locator("tr", { hasText: "layla@ibms.test" });
  await expect(nadia.getByText("مكتب فرز المطالبات").first()).toBeVisible();
  await expect(
    layla.getByText("موظف المبيعات وعلاقات العملاء").first(),
  ).toBeVisible();
  // The machine name is the LAST resort and must not leak when display names
  // exist — nowhere on the page, dropdowns included.
  await expect(page.getByText("CLAIMS_TRIAGE_DESK")).toHaveCount(0);
});

test("grants a role by ID, not by name", async ({ page }) => {
  // The defect this file exists for. `grantRole` posts the dropdown's value as
  // `roleId`, and the API validates it with `@IsUUID()` — so an option carrying
  // the role NAME made every grant a 400, and the dropdown's default (set from
  // the catalogue's first id) matched no option at all.
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockAdmin(page);
  let granted: unknown = null;
  await page.route(
    "http://localhost:4000/admin/users/u-no-roles/roles",
    async (route) => {
      granted = route.request().postDataJSON();
      return route.fulfill({
        status: 201,
        json: { userId: "u-no-roles", roles: [] },
      });
    },
  );

  await page.goto("/settings/users");
  const row = page.locator("tr", { hasText: "omar@ibms.test" });
  await row
    .getByLabel("Role to grant to omar@ibms.test")
    .selectOption({ label: "Claims Triage Desk" });
  await row.getByRole("button", { name: "Grant", exact: true }).click();

  await expect.poll(() => granted).not.toBeNull();
  // A UUID, and specifically the one whose label was chosen.
  expect(granted).toEqual({ roleId: ROLE_CATALOGUE[1].id });
});

test("revokes by the role's id, so a rename between requests cannot mislabel it", async ({
  page,
}) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockAdmin(page);
  let revoked: unknown = null;
  await page.route(
    "http://localhost:4000/admin/users/u-linked/roles/revoke",
    async (route) => {
      revoked = route.request().postDataJSON();
      return route.fulfill({
        status: 201,
        json: { userId: "u-linked", roles: [] },
      });
    },
  );

  await page.goto("/settings/users");
  const row = page.locator("tr", { hasText: "nadia@ibms.test" });
  await row.getByRole("button", { name: "Revoke" }).click();

  await expect.poll(() => revoked).not.toBeNull();
  expect(revoked).toEqual({ roleId: ROLE_CATALOGUE[1].id });
});

test("a caller without user.manage sees the list read-only, not a 403 page", async ({
  page,
}) => {
  // `user.manage` is what turns the controls on. The screen itself is reachable by
  // anyone the nav shows it to, and a caller who cannot provision must still get a
  // readable page rather than a wall.
  await mockAuth(page, ["EXTERNAL_AUDITOR"]);
  await page.route("http://localhost:4000/admin/users**", (route) =>
    route.fulfill({
      status: 403,
      json: { statusCode: 403, message: "forbidden" },
    }),
  );

  await page.goto("/settings/users");
  await expect(page.getByText("user.manage", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Grant", exact: true })).toHaveCount(
    0,
  );
});

test("users screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockAdmin(page);

  await page.goto("/settings/users");
  await expect(page.getByText("nadia@ibms.test")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});

/**
 * The two defects the owner hit on this screen, and the scope line for the new org units.
 */
test("does not offer a RETIRED role to grant, and does not offer one when provisioning", async ({
  page,
}) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockAdmin(page);
  await page.goto("/settings/users");

  // Positive anchor: the active roles ARE offered, so the absence below is a filter and not an
  // empty screen.
  const grant = page.locator("[data-grant-select]").first();
  await expect(grant).toBeVisible();
  const options = await grant.locator("option").allInnerTexts();
  expect(options.length).toBeGreaterThan(0);
  expect(options.join(" | ")).not.toContain("Old Desk");

  // The provisioning fieldset too: a new account created with a retired role would have no access
  // on its first sign-in.
  await expect(page.getByText("Old Desk")).toHaveCount(0);
});

test("a role picked in one row does NOT appear selected in every other row", async ({ page }) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockAdmin(page);
  await page.goto("/settings/users");

  const selects = page.locator("[data-grant-select]");
  // Anchor before counting. Reading `count()` straight after `goto` measures "React has not
  // hydrated yet" and returns 0 — which would fail this test for the wrong reason, and would pass
  // an absence assertion for the wrong reason. Fourth time this session.
  await expect(selects.first()).toBeVisible();
  const count = await selects.count();
  expect(count, "this test needs at least two rows to mean anything").toBeGreaterThan(1);

  const first = selects.nth(0);
  const second = selects.nth(1);
  const before = await second.inputValue();
  // Pick the OTHER role in the first row.
  const options = await first.locator("option").evaluateAll((els) =>
    els.map((e) => (e as HTMLOptionElement).value),
  );
  const firstValue = await first.inputValue();
  const other = options.find((v) => v !== firstValue);
  expect(other, "the fixture must offer at least two ACTIVE roles").toBeTruthy();
  await first.selectOption(other!);

  // The grant always went to the right user; the screen was the only thing lying. So this asserts
  // the DISPLAY, which is what was wrong.
  expect(await first.inputValue()).toBe(other);
  expect(await second.inputValue()).toBe(before);
});
