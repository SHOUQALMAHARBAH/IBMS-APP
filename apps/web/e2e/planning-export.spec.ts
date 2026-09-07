import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ME_BASE = {
  id: "user-1",
  email: "exec@ibms.test",
  fullName: "Executive Manager",
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

const SUMMARY = {
  generatedAt: "2026-09-15T07:00:00.000Z",
  periodLabel: "2026-08",
  portfolio: {
    byLine: [
      { key: "Motor", policyCount: 3, totalIssuedPremiumJod: "9000.000" },
    ],
    byInsurer: [
      {
        key: "Jordan Insurance Co",
        policyCount: 3,
        totalIssuedPremiumJod: "9000.000",
      },
    ],
    byClientSegment: [
      { key: "CORPORATE", policyCount: 3, totalIssuedPremiumJod: "9000.000" },
    ],
    byGeography: [
      { key: "Amman Branch", policyCount: 3, totalIssuedPremiumJod: "9000.000" },
    ],
  },
  market: [
    {
      id: "score-1",
      insurerId: "insurer-1",
      periodLabel: "2026-08",
      quoteResponseScore: "90.00",
      claimsServiceScore: "80.00",
      priceScore: "70.00",
      serviceQualityScore: "60.00",
      computedAt: "2026-09-01T06:00:00.000Z",
    },
  ],
};

async function mockGenerate(page: Page, opts: { status?: number } = {}) {
  await page.route("http://localhost:4000/planning-export", (route) => {
    if (opts.status && opts.status !== 200) {
      return route.fulfill({ status: opts.status, json: { message: "no" } });
    }
    return route.fulfill({ status: 201, json: SUMMARY });
  });
}

test("generates and renders the portfolio + market export", async ({ page }) => {
  await mockAuth(page, ["EXECUTIVE_MANAGEMENT"]);
  await mockGenerate(page);

  await page.goto("/planning-export");
  await expect(
    page.getByRole("heading", { name: "Strategic Planning Inputs" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Generate export" }).click();
  await expect(page.getByRole("cell", { name: "Motor" })).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Jordan Insurance Co" }),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: "CORPORATE" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Amman Branch" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "insurer-1" })).toBeVisible();
});

test("a user without the permission sees a friendly message", async ({
  page,
}) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await mockGenerate(page, { status: 403 });

  await page.goto("/planning-export");
  await page.getByRole("button", { name: "Generate export" }).click();
  await expect(
    page.getByText("planning-export.generate permission", { exact: false }),
  ).toBeVisible();
});

test("planning export screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["EXECUTIVE_MANAGEMENT"]);
  await mockGenerate(page);

  await page.goto("/planning-export");
  await page.getByRole("button", { name: "Generate export" }).click();
  await expect(page.getByRole("cell", { name: "Motor" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
