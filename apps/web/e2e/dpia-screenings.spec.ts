import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ME_BASE = {
  id: "user-1",
  email: "dpo@ibms.test",
  fullName: "Data Protection Officer",
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

const ROWS = [
  {
    id: "dpia-1",
    subjectDescription: "New biometric fraud-detection feature.",
    qSensitiveData: true,
    qLargeScaleProcessing: false,
    qCrossBorderTransfer: false,
    qNewTechnologyMonitoring: false,
    qNewDigitalChannel: false,
    outcome: "DPO_REVIEW_REQUIRED",
    dpoReviewDueAt: "2026-09-14T00:00:00.000Z",
    dpoReviewedAt: null,
    dpoSpotCheckedAt: null,
    escalatedToFullDpiaAt: null,
    createdAt: "2026-09-07T00:00:00.000Z",
  },
];

test("lists DPIA screenings with the submission form and review/escalate actions", async ({
  page,
}) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await page.route("http://localhost:4000/dpia-screenings**", (route) =>
    route.fulfill({ status: 200, json: ROWS }),
  );

  await page.goto("/dpia-screenings");
  await expect(page.getByRole("heading", { name: "DPIA Screening" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "New biometric fraud-detection feature." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Record review" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Escalate to Full DPIA" })).toBeVisible();
});

test("a user without the permission sees a friendly message", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/dpia-screenings**", (route) =>
    route.fulfill({
      status: 403,
      json: { message: "You do not hold a permission required to perform this action" },
    }),
  );

  await page.goto("/dpia-screenings");
  await expect(
    page.getByText("You do not hold a permission required", { exact: false }),
  ).toBeVisible();
});

test("dpia-screenings screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await page.route("http://localhost:4000/dpia-screenings**", (route) =>
    route.fulfill({ status: 200, json: ROWS }),
  );

  await page.goto("/dpia-screenings");
  await expect(page.getByRole("button", { name: "Record review" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
});
