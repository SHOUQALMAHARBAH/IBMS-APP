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

const QUALIFIED_LEAD = {
  id: "lead-1",
  fullName: "Ready Trading Co. Contact",
  source: "referral",
  ownerUserId: "user-1",
  status: "QUALIFIED",
  contactPhone: null,
  contactEmail: null,
  marketingConsentGranted: false,
  firstContactAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const PROSPECT = {
  id: "prospect-1",
  leadId: "lead-1",
  companyName: "Ready Trading Co.",
  sector: "Manufacturing",
  activity: "Steel fabrication",
  employeeCount: 42,
  businessSize: "SME",
  location: "Amman",
  contactPerson: "Ready Trading Co. Contact",
  productsOfInterest: ["Medical", "Motor"],
  expectedPremium: "1250.5",
  salesOwnerUserId: "user-1",
  status: "qualifying",
  createdAt: "2026-01-02T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

test("clicking Convert to prospect on a QUALIFIED lead navigates to the qualification form, prefilled with the lead's name", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/leads", (route) =>
    route.fulfill({ status: 200, json: [QUALIFIED_LEAD] }),
  );

  await page.goto("/leads");
  await page
    .getByRole("button", { name: `Convert to prospect — ${QUALIFIED_LEAD.fullName}` })
    .click();

  await expect(page).toHaveURL(/\/prospects\/new\?leadId=lead-1&leadFullName=/);
  await expect(page.getByLabel("Company name")).toHaveValue(QUALIFIED_LEAD.fullName);
});

test("submitting the qualification form creates the prospect and redirects to its profile", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/prospects", (route) =>
    route.fulfill({ status: 201, json: PROSPECT }),
  );
  await page.route("http://localhost:4000/prospects/prospect-1", (route) =>
    route.fulfill({ status: 200, json: PROSPECT }),
  );

  await page.goto("/prospects/new?leadId=lead-1&leadFullName=Ready%20Trading%20Co.%20Contact");
  await expect(page.getByRole("heading", { name: "Qualify prospect" })).toBeVisible();
  await page.getByLabel("Company name").fill("Ready Trading Co.");
  await page.getByRole("button", { name: "Convert to prospect" }).click();

  await expect(page).toHaveURL("/prospects/prospect-1");
  await expect(page.getByRole("heading", { name: "Ready Trading Co." })).toBeVisible();
});

test("renders the prospects list and navigates to a profile on click", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/prospects", (route) =>
    route.fulfill({ status: 200, json: [PROSPECT] }),
  );
  await page.route("http://localhost:4000/prospects/prospect-1", (route) =>
    route.fulfill({ status: 200, json: PROSPECT }),
  );

  await page.goto("/prospects");
  await expect(page.getByRole("heading", { name: "Prospects" })).toBeVisible();
  await page.getByRole("button", { name: "View profile — Ready Trading Co." }).click();

  await expect(page).toHaveURL("/prospects/prospect-1");
  await expect(page.getByText("Manufacturing")).toBeVisible();
  await expect(page.getByText("Medical, Motor")).toBeVisible();
});

test("shows an empty state when there are no prospects yet", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/prospects", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );

  await page.goto("/prospects");

  await expect(page.getByText("No prospects yet.")).toBeVisible();
});

test("shows a friendly message when the user lacks list permission", async ({ page }) => {
  await mockAuth(page, ["CLAIMS_OFFICER"]);
  await page.route("http://localhost:4000/prospects", (route) =>
    route.fulfill({
      status: 403,
      json: { message: "You do not hold a permission required to perform this action" },
    }),
  );

  await page.goto("/prospects");

  await expect(page.locator('p[role="alert"]')).toContainText("don't hold the prospect.read");
});

test("prospects list and profile screens have no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/prospects", (route) =>
    route.fulfill({ status: 200, json: [PROSPECT] }),
  );
  await page.route("http://localhost:4000/prospects/prospect-1", (route) =>
    route.fulfill({ status: 200, json: PROSPECT }),
  );

  await page.goto("/prospects");
  await expect(page.getByText("Ready Trading Co.")).toBeVisible();
  const listResults = await new AxeBuilder({ page }).analyze();
  expect(listResults.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);

  await page.goto("/prospects/prospect-1");
  await expect(page.getByRole("heading", { name: "Ready Trading Co." })).toBeVisible();
  const profileResults = await new AxeBuilder({ page }).analyze();
  expect(profileResults.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual(
    [],
  );
});

test("the qualification form's fields are reachable via keyboard", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);

  await page.goto("/prospects/new?leadId=lead-1&leadFullName=Test%20Lead");
  const companyNameInput = page.getByLabel("Company name");
  await companyNameInput.focus();
  await expect(companyNameInput).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Sector (optional)")).toBeFocused();
});
