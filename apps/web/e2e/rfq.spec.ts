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

const OPPORTUNITY = {
  id: "opp-1",
  customerId: "cust-1",
  insuranceProgramId: "prog-1",
  isRenewal: false,
  status: "NEEDS_CONFIRMED",
  createdByUserId: "user-1",
  createdAt: "2026-03-01T00:00:00.000Z",
  updatedAt: "2026-03-01T00:00:00.000Z",
  context: { insuranceProgramId: "prog-1", customerId: "cust-1" },
};

const INSURERS = [
  { id: "ins-1", name: "Jordan Insurance Co", nameAr: null, financialStrengthRating: "A-" },
  { id: "ins-2", name: "Middle East Assurance", nameAr: null, financialStrengthRating: null },
];

const RFQ = {
  id: "rfq-1",
  opportunityId: "opp-1",
  insuranceLine: "Property All Risks",
  issuedAt: "2026-03-02T00:00:00.000Z",
  followUpThresholdDays: 9,
  issuedByUserId: "user-1",
  insurerSubmissions: [
    {
      id: "sub-1",
      rfqId: "rfq-1",
      insurerId: "ins-1",
      status: "SENT",
      sentAt: "2026-03-02T00:00:00.000Z",
      respondedAt: null,
      followUpAlertSentAt: null,
      insurer: INSURERS[0],
    },
  ],
};

async function mockRfqApi(
  page: Page,
  opts: { onCreateRfq?: () => void; onTransition?: (status: string) => void } = {},
) {
  await page.route("http://localhost:4000/opportunities**", (route) => {
    const url = route.request().url();
    if (/\/opportunities\/opp-1(\?|$)/.test(url)) {
      return route.fulfill({ status: 200, json: OPPORTUNITY });
    }
    return route.fulfill({ status: 200, json: [OPPORTUNITY] });
  });

  // One route for the whole /rfqs prefix — the last-registered route wins in
  // Playwright, so a separate /rfqs/selectable-insurers route would be
  // shadowed by this one. Branch internally instead.
  await page.route("http://localhost:4000/rfqs**", (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (/\/rfqs\/selectable-insurers(\?|$)/.test(url)) {
      return route.fulfill({ status: 200, json: INSURERS });
    }
    if (method === "POST" && /\/rfqs$/.test(url.split("?")[0])) {
      opts.onCreateRfq?.();
      return route.fulfill({ status: 201, json: RFQ });
    }
    if (/\/rfqs\/rfq-1(\/|\?|$)/.test(url)) {
      return route.fulfill({ status: 200, json: RFQ });
    }
    return route.fulfill({ status: 200, json: [RFQ] });
  });

  await page.route("http://localhost:4000/rfq-insurers/**", (route) => {
    const body = route.request().postDataJSON() as { toStatus: string };
    opts.onTransition?.(body.toStatus);
    return route.fulfill({
      status: 201,
      json: { ...RFQ.insurerSubmissions[0], status: body.toStatus, respondedAt: "2026-03-05T00:00:00.000Z" },
    });
  });
}

test("opens an opportunity and lists its RFQs", async ({ page }) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockRfqApi(page);

  await page.goto("/opportunities?customerId=cust-1");
  await expect(page.getByRole("heading", { name: "RFQ / market" })).toBeVisible();
  await page.getByRole("button", { name: /Opportunity opp-1/ }).click();

  await expect(page).toHaveURL("/opportunities/opp-1");
  await expect(page.getByText("Status: NEEDS_CONFIRMED")).toBeVisible();
  await expect(page.getByRole("button", { name: /Property All Risks/ })).toBeVisible();
});

test("creates an RFQ with an insurer shortlist", async ({ page }) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  let created = false;
  await mockRfqApi(page, { onCreateRfq: () => { created = true; } });

  await page.goto("/rfqs/new?opportunityId=opp-1");
  await expect(page.getByRole("heading", { name: "New RFQ" })).toBeVisible();
  await page.getByLabel("Insurance line").fill("Property All Risks");
  await page.getByLabel("Jordan Insurance Co · A-").check();
  await page.getByRole("button", { name: "Create RFQ" }).click();

  await expect.poll(() => created).toBe(true);
  await expect(page).toHaveURL("/rfqs/rfq-1");
  await expect(page.getByRole("heading", { name: "RFQ — Property All Risks" })).toBeVisible();
});

test("records an insurer response status from the RFQ detail screen", async ({ page }) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  let transitionedTo: string | null = null;
  await mockRfqApi(page, { onTransition: (s) => { transitionedTo = s; } });

  await page.goto("/rfqs/rfq-1");
  await expect(page.getByRole("cell", { name: "Jordan Insurance Co" })).toBeVisible();
  await page
    .getByLabel("Set status for Jordan Insurance Co")
    .selectOption("QUOTED");

  await expect.poll(() => transitionedTo).toBe("QUOTED");
});

test("a non-Placement user sees the list but no create controls", async ({ page }) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await mockRfqApi(page);

  await page.goto("/opportunities/opp-1");
  await expect(page.getByText("Status: NEEDS_CONFIRMED")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create RFQ for a line" })).toHaveCount(0);
});

test("RFQ screens have no serious/critical accessibility violations @a11y", async ({ page }) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockRfqApi(page);

  await page.goto("/opportunities/opp-1");
  await expect(page.getByRole("heading", { name: /Opportunity opp-1/ })).toBeVisible();
  const oppResults = await new AxeBuilder({ page }).analyze();
  expect(
    oppResults.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);

  await page.goto("/rfqs/rfq-1");
  await expect(page.getByText("Insurer submissions")).toBeVisible();
  const rfqResults = await new AxeBuilder({ page }).analyze();
  expect(
    rfqResults.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
});
