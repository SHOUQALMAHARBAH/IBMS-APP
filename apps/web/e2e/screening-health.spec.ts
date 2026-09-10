import { expect, test, type Page } from "@playwright/test";

// Screening provider + data health.
//
// The behaviour worth pinning: NOT_CONFIGURED and UNAVAILABLE must READ as
// "screening did not happen", and the built-in provider must not imply PEP
// coverage it does not have. Both are the difference between a compliance
// control and a screen that looks reassuring.

const ME_BASE = {
  id: "user-1",
  email: "officer@ibms.test",
  fullName: "Compliance Officer",
  languagePreference: "EN",
  mfaEnabled: false,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

async function mockAuth(page: Page, languagePreference: "AR" | "EN" = "EN") {
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "t" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      status: 200,
      json: { ...ME_BASE, roles: ["COMPLIANCE_OFFICER"], languagePreference },
    }),
  );
}

function health(over: Record<string, unknown> = {}) {
  return {
    provider: "built_in",
    providerName: "Built-in watchlist cache (OFAC SDN + UN Consolidated)",
    status: "HEALTHY",
    detail: "Sanctions cache refreshed 2h ago.",
    datasetVersion: "local-2026-09-10T00:00:00.000Z",
    datasetUpdatedAt: "2026-09-10T00:00:00.000Z",
    checkedAt: "2026-09-10T12:00:00.000Z",
    thresholds: { high: 0.9, review: 0.7, low: 0.5 },
    missing: [],
    thresholdProblems: [],
    sendIdentifiers: false,
    coverage: {
      sanctions: true,
      pep: false,
      note: "OFAC SDN + UN Consolidated are SANCTIONS lists. No PEP source is configured.",
    },
    ...over,
  };
}

async function mockHealth(page: Page, body: Record<string, unknown>) {
  await page.route("**/screening/providers/health", (route) =>
    route.fulfill({ status: 200, json: body }),
  );
}

test("says NOT_CONFIGURED and names what is missing", async ({ page }) => {
  await mockAuth(page);
  await mockHealth(
    page,
    health({
      provider: "commercial",
      status: "NOT_CONFIGURED",
      missing: ["SCREENING_API_KEY"],
      detail: "Missing configuration: SCREENING_API_KEY.",
    }),
  );

  await page.goto("/screening-health");

  await expect(page.locator('[data-status="NOT_CONFIGURED"]')).toBeVisible();
  const alert = page
    .getByRole("alert")
    .filter({ hasText: "SCREENING_API_KEY" });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("Compliance review is required");
});

test("does NOT imply PEP coverage the built-in provider lacks", async ({
  page,
}) => {
  // The backlog asks for "sanctions/PEP/AML". Implying PEP coverage that does
  // not exist is worse than showing none.
  await mockAuth(page);
  await mockHealth(page, health());

  await page.goto("/screening-health");

  await expect(page.locator('[data-coverage-sanctions="true"]')).toBeVisible();
  await expect(page.locator('[data-coverage-pep="false"]')).toBeVisible();
  await expect(page.getByText("No PEP source is configured")).toBeVisible();
});

test("shows an empty cache as UNAVAILABLE, not as a healthy clear system", async ({
  page,
}) => {
  await mockAuth(page);
  await mockHealth(
    page,
    health({
      status: "UNAVAILABLE",
      datasetVersion: null,
      datasetUpdatedAt: null,
      detail:
        "The local sanctions cache is empty — the watchlist sync has never completed successfully.",
    }),
  );

  await page.goto("/screening-health");

  await expect(page.locator('[data-status="UNAVAILABLE"]')).toBeVisible();
  await expect(page.getByText("never completed successfully")).toBeVisible();
});

test("shows a stale dataset as DEGRADED", async ({ page }) => {
  await mockAuth(page);
  await mockHealth(
    page,
    health({
      status: "DEGRADED",
      detail:
        "The sanctions cache was last refreshed 100h ago, beyond the 48h staleness tolerance.",
    }),
  );

  await page.goto("/screening-health");

  await expect(page.locator('[data-status="DEGRADED"]')).toBeVisible();
  await expect(page.getByText("staleness tolerance")).toBeVisible();
});

test("presents thresholds as the broker's own risk appetite, not a rule", async ({
  page,
}) => {
  await mockAuth(page);
  await mockHealth(page, health());

  await page.goto("/screening-health");

  await expect(page.getByText("not a regulatory rule")).toBeVisible();
  await expect(page.getByText("0.9", { exact: true })).toBeVisible();
});

test("never renders an API key", async ({ page }) => {
  await mockAuth(page);
  await mockHealth(page, health({ provider: "commercial", status: "HEALTHY" }));

  await page.goto("/screening-health");
  await expect(page.locator('[data-status="HEALTHY"]')).toBeVisible();

  // Nothing on the page can leak a credential, because the API never sends one.
  const body = (await page.locator("body").textContent()) ?? "";
  expect(body.toLowerCase()).not.toContain("api key:");
  expect(body).not.toMatch(/Bearer\s+\S+/);
});

test("surfaces a permission failure rather than an empty page", async ({
  page,
}) => {
  await mockAuth(page);
  await page.route("**/screening/providers/health", (route) =>
    route.fulfill({ status: 403, json: { message: "Forbidden" } }),
  );

  await page.goto("/screening-health");

  await expect(
    page.getByRole("alert").filter({ hasText: "sanctions-pep.screen" }),
  ).toBeVisible();
});

test("renders in Arabic with RTL direction", async ({ page }) => {
  await mockAuth(page, "AR");
  await mockHealth(
    page,
    health({ status: "NOT_CONFIGURED", missing: ["SCREENING_API_KEY"] }),
  );

  await page.goto("/screening-health");

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByText("غير مهيأ", { exact: true })).toBeVisible();
  await expect(page.getByText("غير مُغطّى").first()).toBeVisible();
});
