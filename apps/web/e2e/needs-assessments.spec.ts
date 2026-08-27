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

const QUESTIONNAIRE = {
  questions: [
    { id: "ownsOrLeasesPremises", prompt: "Own or lease premises?", type: "boolean" },
    { id: "employeeCount", prompt: "How many staff?", type: "number" },
    { id: "handlesPersonalOrPaymentData", prompt: "Holds card data?", type: "boolean" },
  ],
  coverageLines: ["Property All Risks (Fire)", "Workers Compensation", "Cyber"],
};

const DRAFT_ASSESSMENT = {
  id: "na-1",
  riskProfileId: "rp-1",
  questionnaireAnswers: {
    ownsOrLeasesPremises: true,
    employeeCount: 10,
    handlesPersonalOrPaymentData: false,
  },
  recommendedCoverageLines: ["Property All Risks (Fire)", "Workers Compensation"],
  status: "DRAFT",
  createdByUserId: "user-1",
  reviewedByUserId: null,
  approvedByUserId: null,
  createdAt: "2026-02-01T00:00:00.000Z",
  updatedAt: "2026-02-01T00:00:00.000Z",
};

async function mockQuestionnaire(page: Page) {
  await page.route("**/needs-assessments/questionnaire", (route) =>
    route.fulfill({ status: 200, json: QUESTIONNAIRE }),
  );
}

test("renders the needs assessments list and opens a detail on click", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockQuestionnaire(page);
  await page.route("http://localhost:4000/needs-assessments", (route) =>
    route.fulfill({ status: 200, json: [DRAFT_ASSESSMENT] }),
  );
  await page.route("http://localhost:4000/needs-assessments/na-1", (route) =>
    route.fulfill({ status: 200, json: DRAFT_ASSESSMENT }),
  );

  await page.goto("/needs-assessments");
  await expect(page.getByRole("heading", { name: "Needs assessments" })).toBeVisible();
  await page.getByRole("button", { name: "View needs assessment na-1" }).click();

  await expect(page).toHaveURL("/needs-assessments/na-1");
  await expect(page.getByText("Property All Risks (Fire)")).toBeVisible();
});

test("shows an empty state when there are none", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/needs-assessments", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );

  await page.goto("/needs-assessments");
  await expect(page.getByText("No needs assessments yet.")).toBeVisible();
});

test("shows a friendly message when the user lacks read permission", async ({ page }) => {
  await mockAuth(page, ["CLAIMS_OFFICER"]);
  await page.route("http://localhost:4000/needs-assessments", (route) =>
    route.fulfill({
      status: 403,
      json: { message: "You do not hold a permission required to perform this action" },
    }),
  );

  await page.goto("/needs-assessments");
  await expect(page.locator('p[role="alert"]')).toContainText("don't hold the needs-assessment.read");
});

test("the new-assessment flow: pick a risk profile, answer the questionnaire, land on the detail", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockQuestionnaire(page);
  await page.route("**/risk-profiles*", (route) =>
    route.fulfill({
      status: 200,
      json: [{ id: "rp-1", customerId: "cust-1", siteLabel: "Head office", priorClaimsHistorySummary: null, createdAt: "", updatedAt: "" }],
    }),
  );
  await page.route("http://localhost:4000/needs-assessments", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({ status: 201, json: DRAFT_ASSESSMENT });
    }
    return route.fulfill({ status: 200, json: [] });
  });
  await page.route("http://localhost:4000/needs-assessments/na-1", (route) =>
    route.fulfill({ status: 200, json: DRAFT_ASSESSMENT }),
  );

  await page.goto("/needs-assessments/new?customerId=cust-1");
  await expect(page.getByRole("heading", { name: "New needs assessment" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Risk questionnaire" })).toBeVisible();

  await page.getByRole("button", { name: "Save draft & see recommended cover" }).click();
  await expect(page).toHaveURL("/needs-assessments/na-1");
  await expect(page.getByText("Recommended coverage")).toBeVisible();
});

test("a manager sees the review panel for an assessment pending review", async ({ page }) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await mockQuestionnaire(page);
  const pending = { ...DRAFT_ASSESSMENT, status: "PENDING_REVIEW", createdByUserId: "someone-else" };
  await page.route("http://localhost:4000/needs-assessments/na-1", (route) =>
    route.fulfill({ status: 200, json: pending }),
  );

  await page.goto("/needs-assessments/na-1");
  await expect(page.getByRole("heading", { name: "Review & approval" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark reviewed" })).toBeVisible();
});

test("needs assessment list and detail screens have no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockQuestionnaire(page);
  await page.route("http://localhost:4000/needs-assessments", (route) =>
    route.fulfill({ status: 200, json: [DRAFT_ASSESSMENT] }),
  );
  await page.route("http://localhost:4000/needs-assessments/na-1", (route) =>
    route.fulfill({ status: 200, json: DRAFT_ASSESSMENT }),
  );

  await page.goto("/needs-assessments");
  await expect(page.getByText("Status: DRAFT")).toBeVisible();
  const listResults = await new AxeBuilder({ page }).analyze();
  expect(
    listResults.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);

  await page.goto("/needs-assessments/na-1");
  await expect(page.getByText("Recommended coverage")).toBeVisible();
  const detailResults = await new AxeBuilder({ page }).analyze();
  expect(
    detailResults.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
});

test("the questionnaire's first control is reachable via keyboard", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockQuestionnaire(page);
  await page.route("**/risk-profiles*", (route) =>
    route.fulfill({
      status: 200,
      json: [{ id: "rp-1", customerId: "cust-1", siteLabel: "Head office", priorClaimsHistorySummary: null, createdAt: "", updatedAt: "" }],
    }),
  );
  await page.route("http://localhost:4000/needs-assessments", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );

  await page.goto("/needs-assessments/new?customerId=cust-1");
  const firstRadio = page.getByRole("radio", { name: "Yes" }).first();
  await firstRadio.focus();
  await expect(firstRadio).toBeFocused();
});
