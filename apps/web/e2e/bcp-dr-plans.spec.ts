import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ME_BASE = {
  id: "user-1",
  email: "admin@ibms.test",
  fullName: "Security Administrator",
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

const PLAN = {
  id: "plan-1",
  scenario: "system_outage",
  planDocumentId: null as string | null,
  rtoHours: 4,
  rpoHours: 24,
  lastTestedAt: null as string | null,
  nextTestDueAt: null as string | null,
};

const COVERAGE = [
  { scenario: "system_outage", hasPlan: true, plans: [PLAN] },
  { scenario: "office_site_loss", hasPlan: false, plans: [] },
  { scenario: "cyberattack_ransomware", hasPlan: false, plans: [] },
  { scenario: "key_staff_unavailability", hasPlan: false, plans: [] },
  { scenario: "insurer_service_interruption", hasPlan: false, plans: [] },
];

test("shows scenario coverage, including gaps for scenarios with no plan", async ({ page }) => {
  await mockAuth(page, ["SYSTEM_SECURITY_ADMINISTRATOR"]);
  await page.route("http://localhost:4000/bcp-dr-plans/coverage", (route) =>
    route.fulfill({ status: 200, json: COVERAGE }),
  );

  await page.goto("/bcp-dr-plans");
  await expect(
    page.getByRole("heading", { name: "Business Continuity & Disaster Recovery" }),
  ).toBeVisible();
  await expect(page.getByText("no plan on file").first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "4", exact: true })).toBeVisible();
});

test("a user without the permission sees a friendly message", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/bcp-dr-plans/coverage", (route) =>
    route.fulfill({ status: 403, json: { message: "no" } }),
  );

  await page.goto("/bcp-dr-plans");
  await expect(
    page.getByText("bcp-dr.manage permission", { exact: false }),
  ).toBeVisible();
});

test("records a plan test and shows the new due date", async ({ page }) => {
  await mockAuth(page, ["SYSTEM_SECURITY_ADMINISTRATOR"]);
  let current = { ...PLAN };
  await page.route("http://localhost:4000/bcp-dr-plans/coverage", (route) =>
    route.fulfill({
      status: 200,
      json: [
        { scenario: "system_outage", hasPlan: true, plans: [current] },
        ...COVERAGE.slice(1),
      ],
    }),
  );
  await page.route("http://localhost:4000/bcp-dr-plans/plan-1/record-test", (route) => {
    current = { ...current, lastTestedAt: "2026-09-06T09:00:00.000Z", nextTestDueAt: "2027-09-06T00:00:00.000Z" };
    return route.fulfill({ status: 201, json: current });
  });

  await page.goto("/bcp-dr-plans");
  await page.getByRole("button", { name: "Record test" }).click();
  await page.locator('input[type="date"]').fill("2027-09-06");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("cell", { name: "2027-09-06" })).toBeVisible();
});

test("creates a new plan for a scenario", async ({ page }) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("http://localhost:4000/bcp-dr-plans/coverage", (route) =>
    route.fulfill({ status: 200, json: COVERAGE }),
  );
  await page.route("http://localhost:4000/bcp-dr-plans", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 201,
        json: { ...PLAN, id: "plan-2", scenario: "office_site_loss", rtoHours: 12, rpoHours: 48 },
      });
    }
    return route.fallback();
  });

  await page.goto("/bcp-dr-plans");
  await page.getByLabel("Scenario").selectOption("office_site_loss");
  await page.getByLabel("RTO (hours)").fill("12");
  await page.getByLabel("RPO (hours)").fill("48");
  await page.getByRole("button", { name: "Record plan" }).click();
  await expect(page.getByText("Could not create the plan.")).not.toBeVisible();
});

test("bcp-dr-plans screen has no serious/critical accessibility violations @a11y", async ({ page }) => {
  await mockAuth(page, ["SYSTEM_SECURITY_ADMINISTRATOR"]);
  await page.route("http://localhost:4000/bcp-dr-plans/coverage", (route) =>
    route.fulfill({ status: 200, json: COVERAGE }),
  );

  await page.goto("/bcp-dr-plans");
  await expect(page.getByText("no plan on file").first()).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
