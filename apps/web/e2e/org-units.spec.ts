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

// `retiredAt` is part of the endpoint's shape since the reactivate route landed. Carried here
// even though no control reads it yet: an absent `retiredAt` renders a retired unit as LIVE,
// which is silent, and a mock that approximates a view's shape is how that reaches a screen.
const CLAIMS = { id: "dept-1", name: "Claims", nameAr: "المطالبات", retiredAt: null };
const IRBID = { id: "branch-1", name: "Irbid", nameAr: "إربد", retiredAt: null };

async function mockUnits(page: Page) {
  await page.route("http://localhost:4000/admin/departments", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({ status: 201, json: { id: "dept-2", name: "Finance", nameAr: null, retiredAt: null } });
    }
    return route.fulfill({ status: 200, json: [CLAIMS] });
  });
  await page.route("http://localhost:4000/admin/branches", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({ status: 201, json: { id: "branch-2", name: "Zarqa", nameAr: null, retiredAt: null } });
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
      return route.fulfill({ status: 201, json: { id: "dept-2", name: "Finance", nameAr: "المالية", retiredAt: null } });
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

/*
 * MODULE 0-c ROW 54 — the Arabic name of a department or branch could not be corrected from
 * anywhere in this system.
 *
 * The rename control edited the ENGLISH name only and its save sent `{ name }`. Creation has
 * REQUIRED `nameAr` since 2026-10-28, so every office has an Arabic name for every unit and none
 * of them could fix a typo in it — on a platform whose default language is the one the name is
 * written in. The server was never the problem: `RenameOrgUnitDto` accepts `nameAr` alone and its
 * own comment names this control as the remedy.
 *
 * Reading the draft back off the SCREEN would pass with `nameAr` dropped from the payload, because
 * the input holds whatever was typed into it either way. These assert the REQUEST BODY.
 */
test("corrects the Arabic name of a department, and sends it", async ({ page }) => {
  await mockAuth(page, FOUR_ACTIONS);
  await mockUnits(page);
  const patched: Record<string, unknown>[] = [];
  await page.route(`http://localhost:4000/admin/departments/${CLAIMS.id}`, (route) => {
    patched.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({
      status: 200,
      json: { ...CLAIMS, nameAr: `${CLAIMS.nameAr} 2`, retiredAt: null },
    });
  });
  await page.goto("/settings/org-units");

  await page.locator(`[data-rename="${CLAIMS.id}"]`).click();

  // The draft opens on the value that is actually stored, so a correction starts from the wrong
  // word rather than from an empty box — otherwise every fix is a retype.
  await expect(page.locator(`[data-rename-input-ar="${CLAIMS.id}"]`)).toHaveValue(CLAIMS.nameAr);
  await expect(page.locator(`[data-rename-input="${CLAIMS.id}"]`)).toHaveValue(CLAIMS.name);

  await page.locator(`[data-rename-input-ar="${CLAIMS.id}"]`).fill(`${CLAIMS.nameAr} 2`);
  await page.locator(`[data-save-rename="${CLAIMS.id}"]`).click();

  // Polled on the COUNT rather than on "a body arrived", so two requests fail here instead of the
  // second one silently overwriting the first.
  await expect.poll(() => patched.length).toBe(1);
  // An EXACT key set, not a `toMatchObject`: this control's whole defect was a field missing from
  // the payload, and a partial match is satisfied by the body that caused it.
  expect(patched[0]).toEqual({ name: "Claims", nameAr: `${CLAIMS.nameAr} 2` });
});

test("a unit with no Arabic name opens an empty field and sends a diff", async ({ page }) => {
  await mockAuth(page, FOUR_ACTIONS);
  // The shape db-test holds for 11 of its 14 live branches, measured 2026-11-07: a row predating
  // the 2026-10-28 requirement, with no Arabic name at all. These are the rows the server's own
  // `nameAr`-alone rename was built for.
  const legacy = { id: "dept-7", name: "Motor", nameAr: null, retiredAt: null };
  await page.route("http://localhost:4000/admin/departments", (route) =>
    route.fulfill({ status: 200, json: [legacy] }),
  );
  await page.route("http://localhost:4000/admin/branches", (route) =>
    route.fulfill({ status: 200, json: [IRBID] }),
  );
  const patched: Record<string, unknown>[] = [];
  await page.route(`http://localhost:4000/admin/departments/${legacy.id}`, (route) => {
    patched.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ status: 200, json: { ...legacy, name: "Motor Lines" } });
  });
  await page.goto("/settings/org-units");

  await page.locator(`[data-rename="${legacy.id}"]`).click();
  // EMPTY, never the Latin name: a field pre-filled with "Motor" is one a person saves as though
  // it were the Arabic name, and the system would then hold a Latin string in an Arabic column.
  await expect(page.locator(`[data-rename-input-ar="${legacy.id}"]`)).toHaveValue("");

  await page.locator(`[data-rename-input="${legacy.id}"]`).fill("Motor Lines");
  await page.locator(`[data-save-rename="${legacy.id}"]`).click();

  await expect.poll(() => patched.length).toBe(1);
  // `nameAr` is ABSENT rather than `""`. The DTO validates every field it receives, so a blank one
  // is a 400 naming a field this person never touched — the insurer panel's recorded defect, and
  // these are precisely the rows it would have fired on.
  expect(patched[0]).toEqual({ name: "Motor Lines" });
});

test("says so plainly when the account holds neither read code", async ({ page }) => {
  await mockAuth(page, ["claim.read"]);
  await page.goto("/settings/org-units");

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("main").getByText(/department\.read/)).toBeVisible();
  await expect(page.locator('[data-org-unit-kind="department"]')).toHaveCount(0);
});
