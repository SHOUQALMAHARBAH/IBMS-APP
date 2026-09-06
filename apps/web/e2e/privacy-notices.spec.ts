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

const NOTICES = [
  {
    id: "pn-1",
    touchpoint: "onboarding_kyc",
    versionNumber: 1,
    textAr: "نص عربي",
    textEn: "We collect your data to perform KYC checks.",
    legallyReviewedAt: null,
    publishedAt: "2026-09-07T00:00:00.000Z",
  },
];

test("lists privacy notices with the publish form and legal-review action", async ({ page }) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await page.route("http://localhost:4000/privacy-notices**", (route) =>
    route.fulfill({ status: 200, json: NOTICES }),
  );

  await page.goto("/privacy-notices");
  await expect(page.getByRole("heading", { name: "Notices" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "onboarding_kyc" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish new version" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Record legal review" })).toBeVisible();
});

test("a user without the permission sees the underlying error message", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/privacy-notices**", (route) =>
    route.fulfill({
      status: 403,
      json: { message: "You do not hold a permission required to perform this action" },
    }),
  );

  await page.goto("/privacy-notices");
  await expect(
    page.getByText("You do not hold a permission required", { exact: false }),
  ).toBeVisible();
});

test("privacy-notices screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await page.route("http://localhost:4000/privacy-notices**", (route) =>
    route.fulfill({ status: 200, json: NOTICES }),
  );

  await page.goto("/privacy-notices");
  await expect(page.getByRole("button", { name: "Publish new version" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
});
