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

const CUSTOMER = {
  id: "cust-1",
  prospectId: null,
  customerType: "INDIVIDUAL",
  legalName: "Ahmad Al-Fulani",
  registrationNumber: null,
  taxRegistrationNumber: null,
  registeredAddress: null,
  natureOfBusiness: null,
  languagePreference: "AR",
  status: "PENDING_KYC",
  classification: "CONFIDENTIAL",
  ownerUserId: "user-1",
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
  nationalId: "******2345",
  contactPhone: "***-7890",
  contactEmail: "***@example.test",
};

const KYC_RECORD = {
  id: "kyc-1",
  customerId: "cust-1",
  status: "DRAFT",
  isEdd: false,
  submittedAt: null,
  createdByUserId: "user-1",
  approvedByUserId: null,
  approvedAt: null,
  nextReviewDueAt: null,
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
};

test("renders the customer list and navigates to a profile on click", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/customers", (route) =>
    route.fulfill({ status: 200, json: [CUSTOMER] }),
  );
  await page.route("http://localhost:4000/customers/cust-1", (route) =>
    route.fulfill({ status: 200, json: CUSTOMER }),
  );
  await page.route("http://localhost:4000/customers/cust-1/ubos", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route("http://localhost:4000/customers/cust-1/documents", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );

  await page.goto("/customers");
  await expect(page.getByRole("heading", { name: "Customers" })).toBeVisible();
  await page.getByRole("button", { name: "View profile — Ahmad Al-Fulani" }).click();

  await expect(page).toHaveURL("/customers/cust-1");
  await expect(page.getByRole("heading", { name: "Ahmad Al-Fulani" })).toBeVisible();
  await expect(page.getByText("INDIVIDUAL — Status: PENDING_KYC")).toBeVisible();
});

test("shows an empty state when there are no customers yet", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/customers", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );

  await page.goto("/customers");

  await expect(page.getByText("No customers yet.")).toBeVisible();
});

test("shows a friendly message when the user lacks read permission", async ({ page }) => {
  await mockAuth(page, ["CLAIMS_OFFICER"]);
  await page.route("http://localhost:4000/customers", (route) =>
    route.fulfill({
      status: 403,
      json: { message: "You do not hold a permission required to perform this action" },
    }),
  );

  await page.goto("/customers");

  await expect(page.locator('p[role="alert"]')).toContainText("don't hold the customer.360-view.read");
});

test("the onboarding wizard walks an individual customer through profile -> documents -> submit", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/customers", (route) =>
    route.fulfill({ status: 201, json: CUSTOMER }),
  );
  await page.route("http://localhost:4000/customers/cust-1/kyc", (route) =>
    route.fulfill({ status: 201, json: KYC_RECORD }),
  );
  await page.route("http://localhost:4000/customers/cust-1/documents", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 201,
        json: { id: "doc-1", category: "APPLICATION_PROPOSAL", classification: "CONFIDENTIAL", fileName: "proposal.pdf", storageRef: "ref-1", createdAt: "2026-08-26T00:00:00.000Z" },
      });
    }
    return route.fulfill({ status: 200, json: [] });
  });
  await page.route("http://localhost:4000/kyc-records/kyc-1/submit", (route) =>
    route.fulfill({ status: 201, json: { ...KYC_RECORD, status: "SUBMITTED" } }),
  );
  await page.route("http://localhost:4000/customers/cust-1", (route) =>
    route.fulfill({ status: 200, json: CUSTOMER }),
  );
  await page.route("http://localhost:4000/customers/cust-1/ubos", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );

  await page.goto("/customers/new");
  await page.getByRole("button", { name: "Individual" }).click();

  await page.getByLabel("Full name").fill("Ahmad Al-Fulani");
  await page.getByLabel("National ID").fill("9901012345");
  await page.getByLabel("Contact phone").fill("+962-7-9000-0000");
  await page.getByLabel("Contact email").fill("ahmad@example.test");
  await page.getByRole("button", { name: "Create customer & start KYC" }).click();

  await expect(page.getByRole("heading", { name: "Supporting documents" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Review & submit" })).toBeVisible();
  // The review step must show the values the officer actually typed — not the
  // masked create() response (CUSTOMER.contactEmail is "***@example.test").
  await expect(page.getByText("+962-7-9000-0000")).toBeVisible();
  await expect(page.getByText("ahmad@example.test")).toBeVisible();
  await expect(page.getByText("***@example.test")).toHaveCount(0);
  await page.getByRole("button", { name: "Submit for compliance review" }).click();

  await expect(page).toHaveURL("/customers/cust-1");
});

test("customer list and profile screens have no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/customers", (route) =>
    route.fulfill({ status: 200, json: [CUSTOMER] }),
  );
  await page.route("http://localhost:4000/customers/cust-1", (route) =>
    route.fulfill({ status: 200, json: CUSTOMER }),
  );
  await page.route("http://localhost:4000/customers/cust-1/ubos", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route("http://localhost:4000/customers/cust-1/documents", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );

  await page.goto("/customers");
  await expect(page.getByText("Ahmad Al-Fulani")).toBeVisible();
  const listResults = await new AxeBuilder({ page }).analyze();
  expect(listResults.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);

  await page.goto("/customers/cust-1");
  await expect(page.getByRole("heading", { name: "Ahmad Al-Fulani" })).toBeVisible();
  const profileResults = await new AxeBuilder({ page }).analyze();
  expect(profileResults.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual(
    [],
  );
});
