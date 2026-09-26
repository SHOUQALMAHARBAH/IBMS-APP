import { expect, test, type Page } from "@playwright/test";

/**
 * Departments and branches — the screen, and the four-action scheme made visible on it.
 *
 * Every test asserts what a person can see or do. The one that matters most is the third: a role
 * holding only the read codes sees the lists and NO controls, which is the difference between the
 * scheme being implemented and the scheme being usable.
 */
const ME_BASE = {
  id: "user-1",
  email: "admin@ibms.test",
  fullName: "Office Administrator",
  languagePreference: "EN",
  mfaEnabled: true,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

const FOUR_ACTIONS = [
  "department.read",
  "department.create",
  "department.update",
  "department.deactivate",
  "branch.read",
  "branch.create",
  "branch.update",
  "branch.deactivate",
];

async function mockAuth(page: Page, permissions: string[]) {
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fake-access-token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      status: 200,
      json: { ...ME_BASE, roles: ["OFFICE_ADMINISTRATOR"], permissions },
    }),
  );
}

const CLAIMS = { id: "dept-1", name: "Claims", nameAr: "المطالبات" };
const IRBID = { id: "branch-1", name: "Irbid", nameAr: "إربد" };

async function mockUnits(page: Page) {
  await page.route("http://localhost:4000/admin/departments", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({ status: 201, json: { id: "dept-2", name: "Finance", nameAr: null } });
    }
    return route.fulfill({ status: 200, json: [CLAIMS] });
  });
  await page.route("http://localhost:4000/admin/branches", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({ status: 201, json: { id: "branch-2", name: "Zarqa", nameAr: null } });
    }
    return route.fulfill({ status: 200, json: [IRBID] });
  });
}

test("lists both departments and branches with their names", async ({ page }) => {
  await mockAuth(page, FOUR_ACTIONS);
  await mockUnits(page);
  await page.goto("/settings/org-units");

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator('[data-org-unit-kind="department"]')).toBeVisible();
  await expect(page.locator('[data-org-unit-kind="branch"]')).toBeVisible();
  await expect(page.locator(`[data-org-unit="${CLAIMS.id}"]`)).toContainText("Claims");
  await expect(page.locator(`[data-org-unit="${IRBID.id}"]`)).toContainText("Irbid");
});

test("creates a department, sending the name the person typed", async ({ page }) => {
  await mockAuth(page, FOUR_ACTIONS);
  await mockUnits(page);
  let posted: Record<string, unknown> | null = null;
  await page.route("http://localhost:4000/admin/departments", (route) => {
    if (route.request().method() === "POST") {
      posted = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({ status: 201, json: { id: "dept-2", name: "Finance", nameAr: "المالية" } });
    }
    return route.fulfill({ status: 200, json: [CLAIMS] });
  });

  await page.goto("/settings/org-units");
  await page.locator('[data-new-name="department"]').fill("Finance");
  await page.locator('[data-new-name-ar="department"]').fill("المالية");
  await page.locator('[data-create="department"]').click();

  await expect.poll(() => posted !== null).toBe(true);
  expect(posted as unknown as { name: string; nameAr: string }).toEqual({
    name: "Finance",
    nameAr: "المالية",
  });
});

test("VIEW WITHOUT EDIT: the read codes alone show the lists and no controls", async ({ page }) => {
  // The point of four codes rather than one `.manage`. If this passes with the umbrella restored,
  // the scheme is decoration.
  await mockAuth(page, ["department.read", "branch.read"]);
  await mockUnits(page);
  await page.goto("/settings/org-units");

  // Positive anchor first, so the absences below mean something.
  await expect(page.locator(`[data-org-unit="${CLAIMS.id}"]`)).toContainText("Claims");
  await expect(page.locator('[data-create="department"]')).toHaveCount(0);
  await expect(page.locator('[data-create="branch"]')).toHaveCount(0);
  await expect(page.locator(`[data-rename="${CLAIMS.id}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-retire="${CLAIMS.id}"]`)).toHaveCount(0);
});

test("renames one row without touching another's draft", async ({ page }) => {
  await mockAuth(page, FOUR_ACTIONS);
  const second = { id: "dept-9", name: "Underwriting", nameAr: null };
  await page.route("http://localhost:4000/admin/departments", (route) =>
    route.fulfill({ status: 200, json: [CLAIMS, second] }),
  );
  await page.route("http://localhost:4000/admin/branches", (route) =>
    route.fulfill({ status: 200, json: [IRBID] }),
  );
  await page.goto("/settings/org-units");

  await page.locator(`[data-rename="${CLAIMS.id}"]`).click();
  await page.locator(`[data-rename-input="${CLAIMS.id}"]`).fill("Claims and Recoveries");

  // The other row is untouched — per-row state, not one shared value. This is the same defect the
  // users screen's grant dropdown had, and it is worth one assertion wherever rows carry drafts.
  await expect(page.locator(`[data-rename-input="${second.id}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-org-unit="${second.id}"]`)).toContainText("Underwriting");
});

test("says so plainly when the account holds neither read code", async ({ page }) => {
  await mockAuth(page, ["claim.read"]);
  await page.goto("/settings/org-units");

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("main").getByText(/department\.read/)).toBeVisible();
  await expect(page.locator('[data-org-unit-kind="department"]')).toHaveCount(0);
});
