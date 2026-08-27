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

const OPP_OPEN = {
  id: "opp-1",
  customerId: "cust-1",
  gapLine: "Public Liability",
  status: "OPEN",
  detectedAt: "2026-03-01T00:00:00.000Z",
  detectedByUserId: null,
  resolvedByUserId: null,
  resolvedAt: null,
  dismissReason: null,
};

const DETECT_RESULT = {
  customerId: "cust-1",
  heldLines: ["Property All Risks"],
  gapLines: ["Business Interruption", "Public Liability", "Workers Compensation"],
  benchmarkLines: [
    "Property All Risks",
    "Business Interruption",
    "Public Liability",
    "Workers Compensation",
  ],
  newlyFlagged: [OPP_OPEN],
  openOpportunities: [OPP_OPEN],
};

async function mockCrossSell(
  page: Page,
  opts: { listStatus?: number; list?: unknown; onConvert?: () => void } = {},
) {
  await page.route("http://localhost:4000/cross-sell-opportunities**", (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (/\/cross-sell-opportunities\/detect/.test(url)) {
      return route.fulfill({ status: 201, json: DETECT_RESULT });
    }
    if (/\/cross-sell-opportunities\/opp-1\/convert/.test(url)) {
      opts.onConvert?.();
      return route.fulfill({ status: 201, json: { ...OPP_OPEN, status: "CONVERTED" } });
    }
    if (/\/cross-sell-opportunities\/opp-1\/dismiss/.test(url)) {
      return route.fulfill({
        status: 201,
        json: { ...OPP_OPEN, status: "DISMISSED", dismissReason: "Client declined" },
      });
    }
    if (/\/cross-sell-opportunities\/opp-1(\?|$)/.test(url)) {
      return route.fulfill({ status: 200, json: OPP_OPEN });
    }
    if (method === "GET") {
      return route.fulfill({
        status: opts.listStatus ?? 200,
        json:
          opts.listStatus === 403
            ? { message: "You do not hold a permission required to perform this action" }
            : (opts.list ?? [OPP_OPEN]),
      });
    }
    return route.fulfill({ status: 200, json: [] });
  });
}

test("lists a customer's cross-sell opportunities and converts one", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  let converted = false;
  await mockCrossSell(page, {
    onConvert: () => {
      converted = true;
    },
  });

  await page.goto("/cross-sell?customerId=cust-1");
  await expect(page.getByRole("heading", { name: "Cross-sell" })).toBeVisible();
  await expect(page.getByText("Public Liability")).toBeVisible();

  await page.getByRole("button", { name: "Convert" }).click();
  await expect.poll(() => converted).toBe(true);
  await expect(page.getByText("CONVERTED")).toBeVisible();
});

test("scans for gaps and shows the last-scan panel", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockCrossSell(page, { list: [] });

  await page.goto("/cross-sell?customerId=cust-1");
  await page.getByRole("button", { name: "Scan for gaps now" }).click();
  await expect(page.getByText("Last scan")).toBeVisible();
  await expect(page.getByText("In-force lines held: Property All Risks")).toBeVisible();
});

test("shows an empty state when the customer has no opportunities", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockCrossSell(page, { list: [] });

  await page.goto("/cross-sell?customerId=cust-1");
  await expect(page.getByText("No cross-sell opportunities for this customer")).toBeVisible();
});

test("prompts to pick a customer when none is in the URL", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockCrossSell(page);

  await page.goto("/cross-sell");
  await expect(page.locator('p[role="alert"]')).toContainText("No customer selected");
});

test("shows a friendly message when the user lacks read permission", async ({ page }) => {
  await mockAuth(page, ["CLAIMS_OFFICER"]);
  await mockCrossSell(page, { listStatus: 403 });

  await page.goto("/cross-sell?customerId=cust-1");
  await expect(page.locator('p[role="alert"]')).toContainText("don't hold the cross-sell.read");
});

test("cross-sell list screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockCrossSell(page);

  await page.goto("/cross-sell?customerId=cust-1");
  await expect(page.getByText("Public Liability")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
});

test("the Convert control is reachable via keyboard", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockCrossSell(page);

  await page.goto("/cross-sell?customerId=cust-1");
  const convert = page.getByRole("button", { name: "Convert" });
  await convert.focus();
  await expect(convert).toBeFocused();
});
