import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";

const ME_BASE = {
  id: "user-1",
  email: "compliance@ibms.test",
  fullName: "Compliance Officer",
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

const ALERTS = [
  {
    id: "tma-1",
    customerId: "11111111-1111-1111-1111-111111111111",
    patternType: "large_premium_payment",
    detailText: "Premium payment of 20000.000 JOD on invoice inv-1 meets or exceeds the threshold.",
    sourceEntityType: "Receipt",
    sourceEntityId: "receipt-1",
    detectedAt: "2026-09-04T09:00:00.000Z",
    escalatedToSuspiciousActivity: false,
    escalatedAt: null,
    reportedToAuthorityAt: null,
    status: "open",
    isClosed: false,
    classification: "HIGHLY_CONFIDENTIAL",
    // Batch six item 2 — the api resolves the customer by name, so the Customer column renders
    // this rather than eight characters of a uuid.
    customerName: "مؤسسة النور للتجارة",
  },
  {
    id: "tma-2",
    customerId: "11111111-1111-1111-1111-111111111111",
    patternType: "frequent_cancellations",
    detailText: "3 cancellation(s) in the trailing 90 calendar days.",
    sourceEntityType: null,
    sourceEntityId: null,
    detectedAt: "2026-08-01T09:00:00.000Z",
    escalatedToSuspiciousActivity: true,
    escalatedAt: "2026-08-02T09:00:00.000Z",
    reportedToAuthorityAt: "2026-08-03T09:00:00.000Z",
    status: "closed",
    isClosed: true,
    classification: "HIGHLY_CONFIDENTIAL",
    // Batch six item 2 — the api resolves the customer by name, so the Customer column renders
    // this rather than eight characters of a uuid.
    customerName: "مؤسسة النور للتجارة",
  },
];

async function mockAlerts(page: Page, opts: { status?: number } = {}) {
  await page.route(
    "http://localhost:4000/transaction-monitoring-alerts**",
    (route) => {
      if (opts.status && opts.status !== 200) {
        return route.fulfill({ status: opts.status, json: { message: "no" } });
      }
      return route.fulfill({ status: 200, json: ALERTS });
    },
  );
}

test("lists transaction-monitoring alerts with the log form and sweep button", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockAlerts(page);

  await page.goto("/transaction-monitoring");
  await expect(
    page.getByRole("heading", { name: "AML/CFT transaction monitoring" }),
  ).toBeVisible();
  // RE-POINTED, decision 59, and the reversal is real: both lines asserted the raw
  // ENUM MEMBER in the Pattern column, which was correct until the labels arrived - all
  // five had in fact shipped in both languages for months and this cell simply never
  // reached for them. Asserted as a PAIR (the label present AND the member name gone),
  // because the label contains no underscore so the stale form would have failed loudly
  // while the sibling `MARKETING` assertion on `/consent` went on passing against
  // "Marketing" - substring matching hides exactly half of this class.
  await expect(
    page.getByRole("cell", { name: "Large premium payment" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "large_premium_payment" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("cell", { name: "Frequent cancellations" }),
  ).toBeVisible();
  await expect(page.getByLabel("Pattern")).toBeVisible();
  await expect(page.getByRole("button", { name: "Log alert" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run detection sweep now" }),
  ).toBeVisible();
  // the open, unescalated alert shows Escalate + Close; the closed one shows neither.
  await expect(page.getByRole("button", { name: "Escalate" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Close" })).toHaveCount(1);

  /*
   * RULE 2 (batch six item 2) — WHOSE transactions tripped the pattern, by name. This column
   * rendered the first eight characters of a uuid, which on an AML queue identifies nobody: an
   * officer working a list of alerts could not tell two of them apart.
   *
   * THE PAIR IS WHAT MAKES IT AN ASSERTION: the name present AND the uuid gone. A screen rendering
   * both would pass a name-only check, and that is the realistic half-done state.
   */
  await expect(
    page.getByRole("cell", { name: "مؤسسة النور للتجارة", exact: true }).first(),
  ).toBeVisible();
  // Asserted on the CELL, never page-wide: `check:absence` bans a page-wide `getByText` absence
  // because it matches any text anywhere, and my first version of this pair pushed that class from
  // 42 to 44. `exact: true` is also stronger — it fails on anything prefixed to the name.
  await expect(page.getByRole("cell", { name: /11111111/ })).toHaveCount(0);
});

test("a user without the permission sees a friendly message", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockAlerts(page, { status: 403 });

  await page.goto("/transaction-monitoring");
  await expect(
    page.getByText("(aml.monitor)", { exact: false }),
  ).toBeVisible();
});

test("transaction-monitoring screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockAlerts(page);

  await page.goto("/transaction-monitoring");
  // Re-pointed with the cell above, decision 59. This is the a11y test's READY ANCHOR
  // rather than an assertion about wording - a different job, and said so.
  await expect(
    page.getByRole("cell", { name: "Large premium payment" }),
  ).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
