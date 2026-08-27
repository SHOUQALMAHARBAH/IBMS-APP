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

const REC_OPEN = {
  id: "rec-1",
  customerId: "cust-1",
  currentSumInsured: "100000.000",
  currentAssetValue: "140000.000",
  status: "OPEN",
  detectedAt: "2026-03-01T00:00:00.000Z",
  detectedByUserId: null,
  resolvedByUserId: null,
  resolvedAt: null,
  dismissReason: null,
};

const DETECT_RESULT = {
  customerId: "cust-1",
  currentSumInsured: "100000.000",
  currentAssetValue: "140000.000",
  shortfall: "40000.000",
  thresholdAmount: "10000.000",
  thresholdPercent: "10",
  programLineCount: 1,
  assetCount: 2,
  isUnderinsured: true,
  suppressedByPriorResolution: false,
  flagged: REC_OPEN,
  openRecommendation: REC_OPEN,
};

async function mockUpSell(
  page: Page,
  opts: { listStatus?: number; list?: unknown; onConvert?: () => void } = {},
) {
  await page.route("http://localhost:4000/up-sell-recommendations**", (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (/\/up-sell-recommendations\/detect/.test(url)) {
      return route.fulfill({ status: 201, json: DETECT_RESULT });
    }
    if (/\/up-sell-recommendations\/rec-1\/convert/.test(url)) {
      opts.onConvert?.();
      return route.fulfill({ status: 201, json: { ...REC_OPEN, status: "CONVERTED" } });
    }
    if (/\/up-sell-recommendations\/rec-1\/dismiss/.test(url)) {
      return route.fulfill({
        status: 201,
        json: { ...REC_OPEN, status: "DISMISSED", dismissReason: "Client declined" },
      });
    }
    if (/\/up-sell-recommendations\/rec-1(\?|$)/.test(url)) {
      return route.fulfill({ status: 200, json: REC_OPEN });
    }
    if (method === "GET") {
      return route.fulfill({
        status: opts.listStatus ?? 200,
        json:
          opts.listStatus === 403
            ? { message: "You do not hold a permission required to perform this action" }
            : (opts.list ?? [REC_OPEN]),
      });
    }
    return route.fulfill({ status: 200, json: [] });
  });
}

test("lists a customer's up-sell recommendations and converts one", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  let converted = false;
  await mockUpSell(page, {
    onConvert: () => {
      converted = true;
    },
  });

  await page.goto("/up-sell?customerId=cust-1");
  await expect(page.getByRole("heading", { name: "Up-sell" })).toBeVisible();
  await expect(page.getByText("Under-insurance flagged")).toBeVisible();
  await expect(page.getByText("Current asset value (JOD): 140000.000")).toBeVisible();

  await page.getByRole("button", { name: "Convert" }).click();
  await expect.poll(() => converted).toBe(true);
  await expect(page.getByText("CONVERTED")).toBeVisible();
});

test("scans for under-insurance and shows the last-scan panel", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockUpSell(page, { list: [] });

  await page.goto("/up-sell?customerId=cust-1");
  await page.getByRole("button", { name: "Scan for under-insurance now" }).click();
  await expect(page.getByText("Last scan")).toBeVisible();
  await expect(page.getByText("Shortfall (JOD): 40000.000")).toBeVisible();
  await expect(page.getByText("Under-insured by more than 10%")).toBeVisible();
});

test("shows an empty state when the customer has no recommendations", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockUpSell(page, { list: [] });

  await page.goto("/up-sell?customerId=cust-1");
  await expect(page.getByText("No up-sell recommendations for this customer")).toBeVisible();
});

test("prompts to pick a customer when none is in the URL", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockUpSell(page);

  await page.goto("/up-sell");
  await expect(page.locator('p[role="alert"]')).toContainText("No customer selected");
});

test("shows a friendly message when the user lacks read permission", async ({ page }) => {
  await mockAuth(page, ["CLAIMS_OFFICER"]);
  await mockUpSell(page, { listStatus: 403 });

  await page.goto("/up-sell?customerId=cust-1");
  await expect(page.locator('p[role="alert"]')).toContainText("don't hold the up-sell.read");
});

test("up-sell list screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockUpSell(page);

  await page.goto("/up-sell?customerId=cust-1");
  await expect(page.getByText("Under-insurance flagged")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
});

test("the Convert control is reachable via keyboard", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockUpSell(page);

  await page.goto("/up-sell?customerId=cust-1");
  const convert = page.getByRole("button", { name: "Convert" });
  await convert.focus();
  await expect(convert).toBeFocused();
});
