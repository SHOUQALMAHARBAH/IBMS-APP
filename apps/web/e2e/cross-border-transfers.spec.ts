import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";

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
    route.fulfill({ status: 200, json: { ...ME_BASE, roles, permissions: permissionsForRoles(roles) } }),
  );
}

const RECORDS = [
  {
    id: "cbt-1",
    description: "Reinsurance claim file shared with a UK reinsurer.",
    destinationCountry: "United Kingdom",
    legalBasis: "standard_contractual_clauses",
    legalBasisEvidenceRef: "scc-doc-1",
    approvedByUserId: "user-1",
    transferredAt: "2026-09-01T00:00:00.000Z",
  },
];

test("lists cross-border transfers with the log form", async ({ page }) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await page.route("http://localhost:4000/cross-border-transfers**", (route) =>
    route.fulfill({ status: 200, json: RECORDS }),
  );

  await page.goto("/cross-border-transfers");
  await expect(page.getByRole("heading", { name: "Cross-Border Transfer" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "United Kingdom" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Log transfer" })).toBeVisible();
});

test("a user without the permission sees the translated 403 message", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/cross-border-transfers**", (route) =>
    route.fulfill({
      status: 403,
      json: { message: "You do not hold a permission required to perform this action" },
    }),
  );

  await page.goto("/cross-border-transfers");
  // The screen's own translated 403 copy, not the API's English message.
  // This page used to pass `err.message` straight through, so the raw
  // server string reached the user in both languages — and this test
  // asserted exactly that. The absence check is what makes it a proof:
  // without it the old behaviour satisfies the new assertion too.
  await expect(
    page.getByText("cross-border-transfer.approve permission", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("You do not hold a permission required", { exact: false }),
  ).toHaveCount(0);
});

test("cross-border-transfers screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await page.route("http://localhost:4000/cross-border-transfers**", (route) =>
    route.fulfill({ status: 200, json: RECORDS }),
  );

  await page.goto("/cross-border-transfers");
  await expect(page.getByRole("cell", { name: "United Kingdom" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
});
