import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ME_BASE = {
  id: "user-1",
  email: "officer@ibms.test",
  fullName: "Placement Officer",
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

const PROGRAM_LIST = [
  {
    id: "prog-1",
    riskProfileId: "rp-1",
    needsAssessmentId: "na-1",
    assembledByUserId: "user-1",
    status: "DRAFT",
    createdAt: "2026-03-01T00:00:00.000Z",
    lines: [
      { id: "l1", insuranceProgramId: "prog-1", insuranceLine: "Property All Risks", sumInsuredBasis: "500000.000" },
      { id: "l2", insuranceProgramId: "prog-1", insuranceLine: "Public Liability", sumInsuredBasis: null },
    ],
  },
];

const PROGRAM_DETAIL = {
  ...PROGRAM_LIST[0],
  context: {
    needsAssessmentId: "na-1",
    needsAssessmentStatus: "APPROVED",
    recommendedCoverageLines: ["Property All Risks (Fire)", "Public Liability"],
    riskProfileId: "rp-1",
    customerId: "cust-1",
    siteLabel: "Head office",
    sumInsured: {
      propertySumInsured: "500000.000",
      businessInterruptionSumInsured: "0.000",
      totalSumInsured: "500000.000",
      indemnityPeriodMonths: null,
      fleetVehicleCount: 0,
      assetCount: 1,
    },
    surveyComplete: true,
  },
};

const APPROVED_NA = {
  id: "na-1",
  riskProfileId: "rp-1",
  questionnaireAnswers: {},
  recommendedCoverageLines: ["Property All Risks (Fire)", "Public Liability"],
  status: "APPROVED",
  createdByUserId: "sales-1",
  reviewedByUserId: "mgr-1",
  approvedByUserId: "mgr-1",
  createdAt: "2026-02-01T00:00:00.000Z",
  updatedAt: "2026-02-15T00:00:00.000Z",
};

async function mockPrograms(
  page: Page,
  opts: { listStatus?: number; list?: unknown; onFinalize?: () => void } = {},
) {
  await page.route("http://localhost:4000/insurance-programs**", (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (/\/insurance-programs\/prog-1\/finalize/.test(url)) {
      opts.onFinalize?.();
      return route.fulfill({ status: 201, json: { ...PROGRAM_DETAIL, status: "FINALIZED" } });
    }
    if (/\/insurance-programs\/prog-1(\?|$)/.test(url)) {
      return route.fulfill({ status: 200, json: PROGRAM_DETAIL });
    }
    if (method === "POST") {
      return route.fulfill({ status: 201, json: PROGRAM_DETAIL });
    }
    return route.fulfill({
      status: opts.listStatus ?? 200,
      json:
        opts.listStatus === 403
          ? { message: "You do not hold a permission required to perform this action" }
          : (opts.list ?? PROGRAM_LIST),
    });
  });
  await page.route("http://localhost:4000/needs-assessments/na-1**", (route) =>
    route.fulfill({ status: 200, json: APPROVED_NA }),
  );
}

test("lists a customer's programs and opens one", async ({ page }) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockPrograms(page);

  await page.goto("/insurance-programs?customerId=cust-1");
  await expect(page.getByRole("heading", { name: "Insurance programs" })).toBeVisible();
  await page.getByRole("button", { name: "Open insurance program prog-1" }).click();

  await expect(page).toHaveURL("/insurance-programs/prog-1");
  await expect(page.getByRole("heading", { name: "Insurance program — Head office" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Property All Risks" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "set at quotation" })).toBeVisible();
});

test("shows an empty state when the customer has no program yet", async ({ page }) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockPrograms(page, { list: [] });

  await page.goto("/insurance-programs?customerId=cust-1");
  await expect(page.getByText("No insurance program yet for this customer")).toBeVisible();
});

test("prompts to pick a customer when none is in the URL", async ({ page }) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockPrograms(page);

  await page.goto("/insurance-programs");
  await expect(page.locator('p[role="alert"]')).toContainText("No customer selected");
});

test("shows a friendly message when the user lacks read permission", async ({ page }) => {
  await mockAuth(page, ["CLAIMS_OFFICER"]);
  await mockPrograms(page, { listStatus: 403 });

  await page.goto("/insurance-programs?customerId=cust-1");
  await expect(page.locator('p[role="alert"]')).toContainText("don't hold the program.read");
});

test("a Placement Officer can finalize a DRAFT program", async ({ page }) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  let finalized = false;
  await mockPrograms(page, {
    onFinalize: () => {
      finalized = true;
    },
  });

  await page.goto("/insurance-programs/prog-1");
  await page.getByRole("button", { name: "Finalize" }).click();
  await expect.poll(() => finalized).toBe(true);
  await expect(page.getByText("Status: FINALIZED")).toBeVisible();
});

test("assembles a program from an approved needs assessment", async ({ page }) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockPrograms(page);

  await page.goto("/insurance-programs/new?needsAssessmentId=na-1");
  await expect(page.getByRole("heading", { name: "Assemble an insurance program" })).toBeVisible();
  await expect(page.getByText("Property All Risks (Fire)")).toBeVisible();
  await page.getByRole("button", { name: "Assemble insurance program" }).click();
  await expect(page).toHaveURL("/insurance-programs/prog-1");
});

test("program list and detail screens have no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockPrograms(page);

  await page.goto("/insurance-programs?customerId=cust-1");
  await expect(page.getByRole("button", { name: "Open insurance program prog-1" })).toBeVisible();
  const listResults = await new AxeBuilder({ page }).analyze();
  expect(
    listResults.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);

  await page.goto("/insurance-programs/prog-1");
  await expect(page.getByText("Program lines")).toBeVisible();
  const detailResults = await new AxeBuilder({ page }).analyze();
  expect(
    detailResults.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
});

test("the finalize control is reachable via keyboard", async ({ page }) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockPrograms(page);

  await page.goto("/insurance-programs/prog-1");
  const finalize = page.getByRole("button", { name: "Finalize" });
  await finalize.focus();
  await expect(finalize).toBeFocused();
});
