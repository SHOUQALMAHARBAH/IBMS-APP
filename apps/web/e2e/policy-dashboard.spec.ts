import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";

const ME_BASE = {
  id: "user-1",
  email: "manager@ibms.test",
  fullName: "Branch Manager",
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

const SUMMARY = {
  generatedAt: "2026-09-07T00:00:00.000Z",
  /*
   * OWNER DECISION 58 — and THIS is the screen where the two clauses differ.
   *
   * `policy-dashboard.config.ts` calls it «a deliberate asymmetry, not an oversight»:
   * the active and expiring counts read `Policy.status` / `Policy.expiryDate` as of
   * now REGARDLESS of the period filter, so a period printed beside either is a false
   * claim about a figure that does not obey it.
   */
  metricScope: {
    activePoliciesCount: "asOf",
    expiringPoliciesCount: "asOf",
    newPoliciesIssuedCount: "period",
    cancelledPolicies: "period",
  },
  periodLabel: "2026-08",
  periodStart: "2026-08-01T00:00:00.000Z",
  periodEnd: "2026-09-01T00:00:00.000Z",
  renewalWindowDays: 90,
  activePoliciesCount: 240,
  expiringPoliciesCount: 18,
  newPoliciesIssuedCount: 12,
  cancelledPolicies: [
    {
      policyId: "pol-1",
      policyNumber: "POL-2026-001",
      // Owner decision 50 — the name a policy with NO number is shown by instead of its uuid.
      customerName: "شركة اليرموك للتأمين",
      insuranceLine: "motor",
      reason: "Client sold the insured vehicle.",
      cancelledAt: "2026-08-15T00:00:00.000Z",
    },
  ],
};

test("renders every metric section with real figures", async ({ page }) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await page.route("http://localhost:4000/dashboards/policy**", (route) =>
    route.fulfill({ status: 200, json: SUMMARY }),
  );

  await page.goto("/dashboards/policy");
  await expect(page.getByRole("heading", { name: "Policy Dashboard" })).toBeVisible();
  await expect(page.getByText("240", { exact: true })).toBeVisible();
  await expect(page.getByText("18", { exact: true })).toBeVisible();
  await expect(page.getByText("12", { exact: true })).toBeVisible();
  await expect(page.getByText("POL-2026-001")).toBeVisible();
  await expect(page.getByText("Client sold the insured vehicle.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply filters" })).toBeVisible();

  /*
   * OWNER DECISION 50 — a policy with NO number yet is named by its CUSTOMER plus a state word,
   * never by its internal id. This is the one `?? <uuid>` fallback in the product whose condition
   * is genuinely REACHABLE: a policy has no number until issuance records one, which is why it was
   * the only one of the four the measurement did NOT record as structurally impossible.
   *
   * THE PAIR: the name present AND the uuid gone. A screen rendering both would pass a name-only
   * check, which is the realistic half-done state.
   */
  await page.route("http://localhost:4000/dashboards/policy**", (route) =>
    route.fulfill({
      status: 200,
      json: {
        ...SUMMARY,
        cancelledPolicies: [
          { ...SUMMARY.cancelledPolicies[0], policyNumber: null },
        ],
      },
    }),
  );
  await page.reload();
  await expect(
    page.getByText("شركة اليرموك للتأمين — before issuance"),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: /pol-1/ })).toHaveCount(0);
});

test("a user without the permission sees the underlying error message", async ({ page }) => {
  await mockAuth(page, ["CLAIMS_OFFICER"]);
  await page.route("http://localhost:4000/dashboards/policy**", (route) =>
    route.fulfill({
      status: 403,
      json: { message: "You do not hold a permission required to perform this action" },
    }),
  );

  await page.goto("/dashboards/policy");
  await expect(
    page.getByText("(dashboard.policy.view)", { exact: false }),
  ).toBeVisible();
});

test("policy dashboard screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await page.route("http://localhost:4000/dashboards/policy**", (route) =>
    route.fulfill({ status: 200, json: SUMMARY }),
  );

  await page.goto("/dashboards/policy");
  await expect(page.getByText("POL-2026-001")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
});

/*
 * ==========================================================================
 * OWNER DECISION 58 — AND THE SCREEN WHERE «beside EVERY figure» WOULD HAVE
 * PRINTED A FALSE SENTENCE.
 *
 * `policy-dashboard.config.ts` calls it «a deliberate asymmetry, not an
 * oversight»: "active policies" and "expiring policies" read `Policy.status`
 * and `Policy.expiryDate` as of NOW regardless of the period filter, because
 * they answer *what does the book look like right now*. "New policies issued"
 * names an EVENT and scopes to the window.
 *
 * So two clauses, and the api declares which. BOTH are asserted here, on ONE
 * screen, in ONE test: the period assertion alone would pass against a
 * component that prints it beside everything, and the as-of assertion alone
 * would pass against one that never prints a period at all.
 * ==========================================================================
 */

test("a live snapshot says «as of», a period-scoped figure says «during» — on the same screen", async ({
  page,
}) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await page.route("http://localhost:4000/dashboards/policy**", (route) =>
    route.fulfill({ status: 200, json: SUMMARY }),
  );

  await page.goto("/dashboards/policy");

  // The anchor: the figures themselves, from the same render.
  await expect(page.getByText("240", { exact: true })).toBeVisible();

  // THE TWO SNAPSHOTS. They ignore the window, so they must NOT name the month —
  // and the absence is asserted beside the presence, because a cell that printed
  // nothing at all would satisfy `not.toContainText` on its own.
  for (const id of ["dpol-active", "dpol-expiring"]) {
    const cell = page.getByTestId(id);
    await expect(cell).toHaveAttribute("data-figure-scope", "asOf");
    await expect(cell).toContainText("as of");
    await expect(cell).toContainText("2026-09-07");
    await expect(
      cell,
      "a live snapshot must not claim a period it does not obey",
    ).not.toContainText("August");
  }

  // THE PERIOD-SCOPED ONE, on the same screen and the same render.
  const issued = page.getByTestId("dpol-new-issued");
  await expect(issued).toHaveAttribute("data-figure-scope", "period");
  await expect(issued).toContainText("during");
  await expect(issued).toContainText("August 2026");
  await expect(
    issued,
    "a period-scoped figure must name its window, not the generation time",
  ).not.toContainText("as of");
});
