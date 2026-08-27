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

const RP_1 = {
  id: "rp-1",
  customerId: "cust-1",
  siteLabel: "Head office",
  priorClaimsHistorySummary: null,
  createdAt: "2026-02-01T00:00:00.000Z",
  updatedAt: "2026-02-01T00:00:00.000Z",
};

const EMPTY_SUMMARY = {
  propertySumInsured: "0.000",
  businessInterruptionSumInsured: "0.000",
  totalSumInsured: "0.000",
  indemnityPeriodMonths: null,
  fleetVehicleCount: 0,
  assetCount: 0,
};

const SURVEY_EMPTY = { ...RP_1, assets: [], sumInsured: EMPTY_SUMMARY };

const SURVEY_WITH_ASSET = {
  ...RP_1,
  assets: [
    {
      id: "asset-1",
      riskProfileId: "rp-1",
      assetType: "building",
      description: "Main office",
      declaredValue: "500000",
      annualGrossProfit: null,
      indemnityPeriodMonths: null,
      fleetVehicleCount: null,
      createdAt: "2026-02-01T00:00:00.000Z",
    },
  ],
  sumInsured: {
    propertySumInsured: "500000.000",
    businessInterruptionSumInsured: "0.000",
    totalSumInsured: "500000.000",
    indemnityPeriodMonths: null,
    fleetVehicleCount: 0,
    assetCount: 1,
  },
};

const CONSOLIDATED = {
  customerId: "cust-1",
  sites: [{ riskProfileId: "rp-1", siteLabel: "Head office", summary: EMPTY_SUMMARY }],
  consolidated: {
    propertySumInsured: "500000.000",
    businessInterruptionSumInsured: "0.000",
    totalSumInsured: "500000.000",
    indemnityPeriodMonths: null,
    fleetVehicleCount: 0,
    siteCount: 1,
  },
};

/** One handler for every `/risk-profiles*` call, branching on method + path —
 * Playwright glob ordering is otherwise fiddly for list vs `:id` vs
 * `/consolidated`. `survey` picks which survey body the `:id` GET returns. */
async function mockRiskProfiles(
  page: Page,
  opts: {
    list?: unknown;
    listStatus?: number;
    survey?: unknown;
    onAssetPost?: () => void;
  } = {},
) {
  // Scope to the API host only — the page itself is served from
  // /risk-profiles on the web origin, and a bare `**/risk-profiles**` glob
  // would fulfil the document navigation with JSON. NEXT_PUBLIC_API_URL
  // defaults to http://localhost:4000 (see lib/auth/api-client.ts).
  await page.route("http://localhost:4000/risk-profiles**", (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (url.includes("/risk-profiles/consolidated")) {
      return route.fulfill({ status: 200, json: CONSOLIDATED });
    }
    if (/\/risk-profiles\/rp-1\/assets/.test(url)) {
      if (method === "POST") {
        opts.onAssetPost?.();
        return route.fulfill({ status: 201, json: SURVEY_WITH_ASSET.assets[0] });
      }
      return route.fulfill({ status: 204, body: "" });
    }
    if (/\/risk-profiles\/rp-1(\?|$)/.test(url)) {
      return route.fulfill({ status: 200, json: opts.survey ?? SURVEY_EMPTY });
    }
    return route.fulfill({
      status: opts.listStatus ?? 200,
      json:
        opts.listStatus === 403
          ? { message: "You do not hold a permission required to perform this action" }
          : (opts.list ?? [RP_1]),
    });
  });
}

test("lists a customer's sites with the consolidated Sum Insured, and opens a site's survey", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockRiskProfiles(page, { survey: SURVEY_WITH_ASSET });

  await page.goto("/risk-profiles?customerId=cust-1");
  await expect(page.getByRole("heading", { name: "Risk surveys" })).toBeVisible();
  await expect(page.getByText("Consolidated Sum Insured (1 site)")).toBeVisible();

  await page.getByRole("button", { name: "Open risk survey for Head office" }).click();
  await expect(page).toHaveURL("/risk-profiles/rp-1");
  await expect(page.getByRole("heading", { name: "Risk survey — Head office" })).toBeVisible();
  await expect(page.getByText("Derived Sum Insured")).toBeVisible();
  await expect(page.getByText("Main office")).toBeVisible();
});

test("shows an empty state when the customer has no risk profile yet", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockRiskProfiles(page, { list: [] });

  await page.goto("/risk-profiles?customerId=cust-1");
  await expect(
    page.getByText("No risk profile yet for this customer — add the first site below."),
  ).toBeVisible();
});

test("prompts to pick a customer when none is in the URL", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockRiskProfiles(page);

  await page.goto("/risk-profiles");
  await expect(page.locator('p[role="alert"]')).toContainText("No customer selected");
});

test("shows a friendly message when the user lacks read permission", async ({ page }) => {
  await mockAuth(page, ["CLAIMS_OFFICER"]);
  await mockRiskProfiles(page, { listStatus: 403 });

  await page.goto("/risk-profiles?customerId=cust-1");
  await expect(page.locator('p[role="alert"]')).toContainText(
    "don't hold the risk-profile.read",
  );
});

test("captures an asset from the survey screen", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  let posted = false;
  await mockRiskProfiles(page, {
    survey: SURVEY_EMPTY,
    onAssetPost: () => {
      posted = true;
    },
  });

  await page.goto("/risk-profiles/rp-1");
  await expect(page.getByText("No assets surveyed yet for this location.")).toBeVisible();

  await page.getByLabel("Declared value (JOD)").fill("500000");
  await page.getByRole("button", { name: "Add asset" }).click();
  await expect.poll(() => posted).toBe(true);
});

test("risk survey list and detail screens have no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockRiskProfiles(page, { survey: SURVEY_WITH_ASSET });

  await page.goto("/risk-profiles?customerId=cust-1");
  await expect(page.getByText("Consolidated Sum Insured (1 site)")).toBeVisible();
  const listResults = await new AxeBuilder({ page }).analyze();
  expect(
    listResults.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);

  await page.goto("/risk-profiles/rp-1");
  await expect(page.getByText("Derived Sum Insured")).toBeVisible();
  const detailResults = await new AxeBuilder({ page }).analyze();
  expect(
    detailResults.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
});

test("the asset-type control is reachable via keyboard", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockRiskProfiles(page, { survey: SURVEY_EMPTY });

  await page.goto("/risk-profiles/rp-1");
  const assetType = page.getByLabel("Asset type");
  await assetType.focus();
  await expect(assetType).toBeFocused();
});
