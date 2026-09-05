import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ME_BASE = {
  id: "user-1",
  email: "officer@ibms.test",
  fullName: "Sales Officer",
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

const LEADS = [
  {
    id: "lead-1",
    fullName: "Ahmad Al-Test",
    source: "referral",
    ownerUserId: "user-1",
    status: "NEW",
    contactPhone: "+962-7-0000-0000",
    contactEmail: null,
    marketingConsentGranted: false,
    firstContactAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "lead-2",
    fullName: "Not Mine",
    source: "website",
    ownerUserId: "some-other-officer",
    status: "CONTACTED",
    contactPhone: null,
    contactEmail: "notmine@ibms.test",
    marketingConsentGranted: true,
    firstContactAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

test("renders the pipeline board grouped by status", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/leads", (route) =>
    route.fulfill({ status: 200, json: LEADS }),
  );

  await page.goto("/leads");

  await expect(page.getByRole("heading", { name: "Leads" })).toBeVisible();
  await expect(page.getByText("Ahmad Al-Test")).toBeVisible();
  await expect(page.getByText("Not Mine")).toBeVisible();
});

test("shows the intake form for a Sales Officer, but not for a Claims Officer", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/leads", (route) => route.fulfill({ status: 200, json: [] }));
  await page.goto("/leads");
  await expect(page.getByRole("heading", { name: "New lead" })).toBeVisible();

  await mockAuth(page, ["CLAIMS_OFFICER"]);
  await page.goto("/leads");
  await expect(page.getByRole("heading", { name: "New lead" })).toHaveCount(0);
});

test("shows an empty state when there are no leads yet", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/leads", (route) => route.fulfill({ status: 200, json: [] }));

  await page.goto("/leads");

  await expect(page.getByText("No leads yet — add one above to start your pipeline.")).toBeVisible();
});

test("shows a friendly message when the user lacks list permission", async ({ page }) => {
  await mockAuth(page, ["CLAIMS_OFFICER"]);
  await page.route("http://localhost:4000/leads", (route) =>
    route.fulfill({
      status: 403,
      json: { message: "You do not hold a permission required to perform this action" },
    }),
  );

  await page.goto("/leads");

  await expect(page.locator('p[role="alert"]')).toContainText("don't hold the lead.list.read");
});

test("only offers a transition action on the officer's own lead, and moving it updates the board", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/leads", (route) => route.fulfill({ status: 200, json: LEADS }));
  // The real endpoint returns WorkflowTransitionService's generic
  // { id, status } shape, not the full Lead — mocking the full Lead here
  // would mask a crash the same way access-recertification's decide()
  // response mismatch once did (see that spec's comment).
  await page.route("**/leads/lead-1/transition", (route) =>
    route.fulfill({ status: 201, json: { id: "lead-1", status: "CONTACTED" } }),
  );

  await page.goto("/leads");

  await expect(page.getByRole("button", { name: /Not Mine/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Mark contacted — Ahmad Al-Test" }).click();

  await expect(page.getByRole("button", { name: "Mark contacted — Ahmad Al-Test" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Mark qualified — Ahmad Al-Test" })).toBeVisible();
});

test("leads page has no serious/critical accessibility violations @a11y", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/leads", (route) => route.fulfill({ status: 200, json: LEADS }));

  await page.goto("/leads");
  await expect(page.getByText("Ahmad Al-Test")).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  const seriousOrCritical = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(seriousOrCritical).toEqual([]);
});

test("the intake form's fields are reachable via keyboard", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/leads", (route) => route.fulfill({ status: 200, json: [] }));

  await page.goto("/leads");
  const fullNameInput = page.getByLabel("Full name");
  await fullNameInput.focus();
  await expect(fullNameInput).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Source")).toBeFocused();
});
