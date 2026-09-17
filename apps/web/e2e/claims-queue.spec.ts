import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { permissionsForRoles } from "./fixtures/role-permissions";

/*
 * The claims queue — `/claims` and `/claims/[id]`.
 *
 * These screens exist because a CLAIMS_OFFICER could not reach the one set of
 * forms the role exists to operate. It holds `claim.read`, `claim.register`,
 * `claim.document`, `claim.assess`, `claim.settle.approve` and `claim.close`,
 * but every route to a claim went through `/opportunities/[id]`, a screen
 * behind an `opportunity.read` the role does NOT hold. The API accepted them;
 * no screen offered it. Structurally the same defect as the Policy Checking
 * Officer routing gap, and covered the same way here.
 *
 * The role assertions below are the point of this file: they pin that the
 * screens work for the role that was locked out, using that role's REAL
 * seeded permission set rather than a convenient superset.
 */

const ME_BASE = {
  id: "user-1",
  email: "claims@ibms.test",
  fullName: "Claims Officer",
  languagePreference: "EN",
  mfaEnabled: false,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

async function mockAuth(
  page: Page,
  roles: string[] = ["CLAIMS_OFFICER"],
  languagePreference: "AR" | "EN" = "EN",
) {
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fake-access-token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      status: 200,
      json: {
        ...ME_BASE,
        roles,
        languagePreference,
        permissions: permissionsForRoles(roles),
      },
    }),
  );
  await page.route("http://localhost:4000/notifications", (route) =>
    route.fulfill({ status: 200, json: { items: [], total: 0 } }),
  );
}

function paged<T>(items: T[], total = items.length) {
  return { items, total, page: 0, pageSize: 50 };
}

const CLAIM = {
  id: "clm-1",
  policyId: "pol-1",
  customerId: "cust-1",
  policyNumber: "POL-2026-0451",
  insuranceLine: "Property All Risks",
  claimNumber: "CLM-2026-0007",
  insurerClaimReference: "UN-77120",
  status: "UNDER_ASSESSMENT",
  lossDate: "2026-09-05",
  lossLocation: "Amman industrial zone",
  causeOfLoss: "Water damage following a burst riser",
  estimatedLoss: "48000.000",
  isThirdPartyInvolved: false,
  isLargeClaim: false,
  classification: "HIGHLY_CONFIDENTIAL",
  followUpAlertThresholdDays: 7,
  thirdParty: null,
  adjuster: {
    name: "Rami Haddad",
    firm: "Levant Loss Adjusters",
    assignedAt: "2026-09-06T08:00:00.000Z",
    surveyCompletedAt: null,
    investigationCompletedAt: null,
  },
  coverage: {
    scheduleId: "sch-1",
    effectiveFrom: "2026-10-01T00:00:00.000Z",
    effectiveTo: null,
  },
  coverageResolvedAtLossDate: true,
  documents: [],
  documentChecklist: [],
  documentationComplete: false,
  missingMandatoryDocuments: ["claim_form"],
  assessment: {
    surveyCompletedAt: null,
    investigationCompletedAt: null,
    adjusterWorkComplete: false,
    readyForAssessment: false,
    outcome: null,
  },
  followUp: {
    followUpAlerts: [
      {
        id: "alert-1",
        triggeredAt: "2026-09-14T08:00:00.000Z",
        resolvedAt: null,
      },
    ],
    followUpAlertOpen: true,
    followUpAlertThresholdDays: 7,
    awaitingInsurerResponse: true,
    awaitingInsurerSince: "2026-09-08T08:00:00.000Z",
  },
  settlement: null,
  closedAt: null,
  statusHistory: [],
  createdAt: "2026-09-05T10:00:00.000Z",
  updatedAt: "2026-09-08T10:00:00.000Z",
};

const QUEUE_URL = "http://localhost:4000/claims";
const DETAIL_URL = "http://localhost:4000/claims/clm-1";

test("a Claims Officer lands on the queue and sees the triage signals", async ({
  page,
}) => {
  await mockAuth(page);
  await page.route(QUEUE_URL, (route) =>
    route.fulfill({ status: 200, json: paged([CLAIM]) }),
  );

  await page.goto("/claims");
  await expect(page.getByRole("heading", { name: "Claims" })).toBeVisible();
  await expect(page.getByText("CLM-2026-0007")).toBeVisible();
  await expect(page.getByText("POL-2026-0451")).toBeVisible();

  // The row carries STATE, not just a link — this is a queue, not an index.
  await expect(page.locator('[data-claim-status="UNDER_ASSESSMENT"]')).toBeVisible();
  await expect(page.locator('[data-claim-alert="open"]')).toBeVisible();
  await expect(page.locator('[data-claim-docs="incomplete"]')).toBeVisible();

  // The badge shows the LABEL while `data-*` keeps the raw code.
  // Scoped to the badge: the same label is also an <option> in the status
  // filter, so an unscoped lookup is a strict-mode violation.
  await expect(
    page.locator('[data-claim-status="UNDER_ASSESSMENT"]'),
  ).toHaveText("Under assessment");
});

test("the sidebar offers Claims to a Claims Officer and hides it without claim.read", async ({
  page,
}) => {
  await mockAuth(page);
  await page.route(QUEUE_URL, (route) =>
    route.fulfill({ status: 200, json: paged([]) }),
  );
  await page.goto("/claims");
  await expect(
    page.getByRole("link", { name: "Claims", exact: true }),
  ).toBeVisible();

  // A role with no claim.read never sees the entry — the control does not
  // exist on their screen rather than being rendered and then refused.
  await page.unroute("**/auth/me");
  await mockAuth(page, ["FINANCE_COLLECTIONS_OFFICER"]);
  await page.goto("/policies");
  await expect(
    page.getByRole("link", { name: "Claims", exact: true }),
  ).toHaveCount(0);
});

test("the queue filters by status and by needs-follow-up, and both travel with the page", async ({
  page,
}) => {
  await mockAuth(page);
  const seen: string[] = [];
  await page.route(`${QUEUE_URL}**`, (route) => {
    seen.push(route.request().url());
    return route.fulfill({ status: 200, json: paged([CLAIM], 1) });
  });

  await page.goto("/claims");
  await expect(page.getByText("CLM-2026-0007")).toBeVisible();

  await page.getByLabel("Status").selectOption("SETTLED");
  await expect.poll(() => seen.some((u) => u.includes("status=SETTLED"))).toBe(true);

  await page.getByLabel("Needs follow-up only").check();
  await expect
    .poll(() =>
      seen.some((u) => u.includes("alertOpen=true") && u.includes("status=SETTLED")),
    )
    .toBe(true);
});

test("opening a claim from the queue reaches the work surface with its forms", async ({
  page,
}) => {
  await mockAuth(page);
  await page.route(QUEUE_URL, (route) =>
    route.fulfill({ status: 200, json: paged([CLAIM]) }),
  );
  await page.route(DETAIL_URL, (route) =>
    route.fulfill({ status: 200, json: CLAIM }),
  );

  await page.goto("/claims");
  await page.getByRole("button", { name: "Open claim CLM-2026-0007" }).click();

  await expect(page).toHaveURL(/\/claims\/clm-1$/);
  // The forms the role exists to operate, on a route that needs no
  // `opportunity.read` — the whole point of this screen.
  await expect(
    page.getByRole("heading", { name: "Claim CLM-2026-0007" }),
  ).toBeVisible();
  await expect(page.getByText("Documentation", { exact: false })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "File document" }),
  ).toBeVisible();
});

test("the queue shows a friendly message when the caller lacks claim.read", async ({
  page,
}) => {
  await mockAuth(page);
  await page.route(QUEUE_URL, (route) =>
    route.fulfill({
      status: 403,
      json: { message: "forbidden" },
    }),
  );
  await page.goto("/claims");
  await expect(page.locator('p[role="alert"]')).toContainText("claim.read");
});

test("an empty queue explains what belongs there", async ({ page }) => {
  await mockAuth(page);
  await page.route(QUEUE_URL, (route) =>
    route.fulfill({ status: 200, json: paged([]) }),
  );
  await page.goto("/claims");
  await expect(
    page.getByText("No claims yet", { exact: false }),
  ).toBeVisible();
});

test("a claim outside the caller's book reads as not found, not as an empty screen", async ({
  page,
}) => {
  await mockAuth(page);
  await page.route(DETAIL_URL, (route) =>
    route.fulfill({ status: 404, json: { message: "Claim not found" } }),
  );
  await page.goto("/claims/clm-1");
  await expect(page.locator('p[role="alert"]')).toContainText("your book");
});

test("the queue renders in Arabic with translated status labels", async ({
  page,
}) => {
  await mockAuth(page, ["CLAIMS_OFFICER"], "AR");
  await page.route(QUEUE_URL, (route) =>
    route.fulfill({ status: 200, json: paged([CLAIM]) }),
  );
  await page.goto("/claims");
  await expect(page.getByRole("heading", { name: "المطالبات" })).toBeVisible();
  // The status badge reads an Arabic label while `data-*` keeps the code.
  await expect(page.locator('[data-claim-status="UNDER_ASSESSMENT"]')).toBeVisible();
  await expect(
    page.locator('[data-claim-status="UNDER_ASSESSMENT"]'),
  ).toHaveText("قيد التقييم");
});

test("claims queue screens have no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page);
  await page.route(QUEUE_URL, (route) =>
    route.fulfill({ status: 200, json: paged([CLAIM]) }),
  );
  await page.route(DETAIL_URL, (route) =>
    route.fulfill({ status: 200, json: CLAIM }),
  );

  await page.goto("/claims");
  await expect(page.getByText("CLM-2026-0007")).toBeVisible();
  const queue = await new AxeBuilder({ page }).analyze();
  expect(
    queue.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact ?? ""),
    ),
  ).toEqual([]);

  await page.goto("/claims/clm-1");
  await expect(
    page.getByRole("heading", { name: "Claim CLM-2026-0007" }),
  ).toBeVisible();
  const detail = await new AxeBuilder({ page }).analyze();
  expect(
    detail.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact ?? ""),
    ),
  ).toEqual([]);
});
