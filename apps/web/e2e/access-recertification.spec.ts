import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ME_BASE = {
  id: "user-1",
  email: "reviewer@ibms.test",
  fullName: "Compliance Reviewer",
  languagePreference: "EN",
  mfaEnabled: false,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

async function mockAuth(page: Page, roles: string[]) {
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fake-access-token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({ status: 200, json: { ...ME_BASE, roles } }),
  );
}

const ITEMS = [
  {
    id: "item-1",
    cycleId: "cycle-1",
    cycleLabel: "Q1-2026",
    subjectUserId: "subject-1",
    subjectFullName: "Sales Officer",
    subjectEmail: "sales@ibms.test",
    subjectRoles: ["SALES_RELATIONSHIP_OFFICER"],
    reviewerUserId: "user-1",
    decision: null,
    reviewedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "item-2",
    cycleId: "cycle-1",
    cycleLabel: "Q1-2026",
    subjectUserId: "subject-2",
    subjectFullName: "Admin Person",
    subjectEmail: "admin@ibms.test",
    subjectRoles: ["SYSTEM_SECURITY_ADMINISTRATOR"],
    reviewerUserId: "user-1",
    decision: null,
    reviewedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

test("renders the review queue with subject details and an admin badge", async ({ page }) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("**/access-recertification/items", (route) =>
    route.fulfill({ status: 200, json: ITEMS }),
  );

  await page.goto("/access-recertification");

  await expect(page.getByRole("heading", { name: "Access recertification" })).toBeVisible();
  await expect(page.getByText("Sales Officer")).toBeVisible();
  await expect(page.getByText("sales@ibms.test")).toBeVisible();
  await expect(page.getByText("Admin access — not exempt from review")).toBeVisible();
});

test("shows the start-cycle form for a Compliance Officer, but not for a Sales Officer", async ({ page }) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("**/access-recertification/items", (route) => route.fulfill({ status: 200, json: [] }));
  await page.goto("/access-recertification");
  await expect(page.getByRole("heading", { name: "Start a new recertification cycle" })).toBeVisible();

  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.goto("/access-recertification");
  await expect(page.getByRole("heading", { name: "Start a new recertification cycle" })).toHaveCount(0);
});

test("shows an empty state when nothing is assigned for review", async ({ page }) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("**/access-recertification/items", (route) => route.fulfill({ status: 200, json: [] }));

  await page.goto("/access-recertification");

  await expect(
    page.getByText("No access-recertification items are currently assigned to you for review."),
  ).toBeVisible();
});

test("shows a friendly message when the user lacks review permission", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("**/access-recertification/items", (route) =>
    route.fulfill({
      status: 403,
      json: { message: "You do not hold a permission required to perform this action" },
    }),
  );

  await page.goto("/access-recertification");

  await expect(page.locator('p[role="alert"]')).toContainText("don't hold the access-recertification.review");
});

test("lets a reviewer confirm an item, which then shows as decided", async ({ page }) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("**/access-recertification/items", (route) =>
    route.fulfill({ status: 200, json: [ITEMS[0]] }),
  );
  // The real endpoint returns the raw AccessRecertificationItem, not the
  // enriched shape GET .../items returns — no subjectFullName/subjectRoles/
  // cycleLabel. Mocking the full enriched item here previously masked a
  // real crash (the row read item.subjectRoles.includes(...) after this
  // response replaced the row wholesale) that only showed up against the
  // real backend.
  await page.route("**/access-recertification/items/item-1/decision", (route) =>
    route.fulfill({
      status: 201,
      json: {
        id: "item-1",
        cycleId: "cycle-1",
        subjectUserId: "subject-1",
        reviewerUserId: "user-1",
        decision: "confirmed",
        reviewedAt: "2026-01-02T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    }),
  );

  await page.goto("/access-recertification");
  await page.getByRole("button", { name: "Confirm access for Sales Officer" }).click();

  await expect(page.getByText("Confirmed")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm access for Sales Officer" })).toHaveCount(0);
  // The row must survive the update without crashing — its enriched fields
  // (only present in the original GET response) should still render.
  await expect(page.getByText("SALES RELATIONSHIP OFFICER")).toBeVisible();
});

test("access-recertification page has no serious/critical accessibility violations @a11y", async ({ page }) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("**/access-recertification/items", (route) =>
    route.fulfill({ status: 200, json: ITEMS }),
  );

  await page.goto("/access-recertification");
  await expect(page.getByText("Sales Officer")).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  const seriousOrCritical = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(seriousOrCritical).toEqual([]);
});

test("decision buttons for a row are reachable via keyboard", async ({ page }) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("**/access-recertification/items", (route) =>
    route.fulfill({ status: 200, json: [ITEMS[0]] }),
  );

  await page.goto("/access-recertification");
  const confirmButton = page.getByRole("button", { name: "Confirm access for Sales Officer" });
  await confirmButton.focus();
  await expect(confirmButton).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Revoke access for Sales Officer" })).toBeFocused();
});
