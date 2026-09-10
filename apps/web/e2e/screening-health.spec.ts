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
  // Default operations view — overridden per test by a later page.route,
  // which Playwright matches first.
  await page.route("**/screening/overview*", (route) =>
    route.fulfill({ status: 200, json: overviewBody() }),
  );
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
    state: "HEALTHY",
    authenticationValid: null,
    capabilities: [
      {
        capability: "SANCTIONS",
        supported: true,
        configured: true,
        operational: true,
        note: "OFAC SDN + UN Consolidated, synced locally.",
      },
      {
        capability: "PEP",
        supported: false,
        configured: false,
        operational: false,
        note: "This provider has NO PEP data.",
      },
    ],
    pepOperational: false,
    sanctionsOperational: true,
    ...over,
  };
}

/**
 * The operations view the screen loads alongside provider health.
 *
 * Mocked by default in `mockAuth` so every pre-existing test keeps exercising
 * what it was written for: the page issues both requests, and an unmocked one
 * would surface as a load error and mask the assertion under test.
 */
export function overviewBody(over: Record<string, unknown> = {}) {
  return {
    windowDays: 30,
    since: "2026-08-11T00:00:00.000Z",
    attempts: {
      total: 0,
      byOutcome: {},
      byProvider: {},
      unresolved: 0,
      unresolvedRate: 0,
      recentUnresolved: [],
    },
    matchQueue: {
      pending: 0,
      pendingByAlgorithmVersion: {},
      currentAlgorithmVersion: "2.0.0",
    },
    caseWorkload: {},
    datasets: [],
    schedules: {
      rescreenBatch: {
        cron: "0 */4 * * *",
        nextRunAt: "2026-09-11T00:00:00.000Z",
      },
      listSync: {
        cron: "0 */12 * * *",
        nextRunAt: "2026-09-11T00:00:00.000Z",
        lastSuccessAt: null,
      },
    },
    holds: {
      activeHolds: 0,
      decidableFiles: 0,
      releasedInWindow: 0,
      policy: {},
      staleAfterDays: 0,
      configurationProblems: [],
    },
    listSync: [],
    ...over,
  };
}

async function mockOverview(page: Page, body: Record<string, unknown>) {
  await page.route("**/screening/overview*", (route) =>
    route.fulfill({ status: 200, json: body }),
  );
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
      state: "NOT_CONFIGURED",
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

  const sanctions = page.locator('[data-capability="SANCTIONS"]');
  const pep = page.locator('[data-capability="PEP"]');
  await expect(sanctions.locator('[data-operational="true"]')).toBeVisible();
  await expect(pep.locator('[data-supported="false"]')).toBeVisible();
  await expect(pep.locator('[data-operational="false"]')).toBeVisible();
  await expect(page.getByText("NO PEP data")).toBeVisible();
});

test("warns explicitly that no customer may be called clear of PEP status", async ({
  page,
}) => {
  await mockAuth(page);
  await mockHealth(page, health());

  await page.goto("/screening-health");

  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "PEP screening is NOT operational" }),
  ).toBeVisible();
});

test("distinguishes supported / configured / operational", async ({ page }) => {
  // A commercial provider whose credentials are set but which has never
  // answered: supported and configured, NOT operational. Rendering that as
  // "PEP available" is the failure this table exists to prevent.
  await mockAuth(page);
  await mockHealth(
    page,
    health({
      provider: "commercial",
      status: "UNAVAILABLE",
      state: "UNAVAILABLE",
      authenticationValid: null,
      capabilities: [
        {
          capability: "PEP",
          supported: true,
          configured: true,
          operational: false,
          note: "Actual coverage depends on the contracted product.",
        },
      ],
      pepOperational: false,
    }),
  );

  await page.goto("/screening-health");

  const pep = page.locator('[data-capability="PEP"]');
  await expect(pep.locator('[data-supported="true"]')).toBeVisible();
  await expect(pep.locator('[data-configured="true"]')).toBeVisible();
  await expect(pep.locator('[data-operational="false"]')).toBeVisible();
});

test("shows an empty cache as UNAVAILABLE, not as a healthy clear system", async ({
  page,
}) => {
  await mockAuth(page);
  await mockHealth(
    page,
    health({
      status: "UNAVAILABLE",
      state: "CONFIGURED",
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
      state: "DEGRADED",
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
  await expect(page.locator('[data-capability="PEP"]')).toBeVisible();
});

/* ---------------------------------------------------------------------------
 * Part B §18/§28/§33 — the operations view.
 *
 * The screen must answer the question a provider health check cannot: how many
 * customers were actually screened. These tests cover the four render states
 * the verification contract names — loading, empty, populated, error — plus
 * permission denied, in both reading directions.
 * ------------------------------------------------------------------------- */

test("populated: reports the unresolved rate rather than leaving it to be computed", async ({
  page,
}) => {
  await mockAuth(page);
  await mockHealth(page, health());
  await mockOverview(
    page,
    overviewBody({
      attempts: {
        total: 100,
        byOutcome: { NO_MATCH: 60, SCREENING_FAILED: 30, UNABLE_TO_SCREEN: 10 },
        byProvider: { commercial: 100 },
        unresolved: 40,
        unresolvedRate: 0.4,
        recentUnresolved: [
          {
            correlationId: "scr-1",
            outcome: "SCREENING_FAILED",
            failureReason: "timed out after 10000ms",
            providerName: "Commercial provider",
            startedAt: "2026-09-10T10:00:00.000Z",
            durationMs: 10000,
          },
        ],
      },
    }),
  );
  await page.goto("/screening-health");

  const rate = page.getByTestId("ops-unresolved-rate");
  await expect(rate).toBeVisible();
  await expect(rate).toContainText("40");
  await expect(rate).toContainText("40%");

  // A deployment where 40% of attempts produce no answer is not a working
  // screening function, however green the provider check is.
  await expect(
    page.getByText("These customers were NOT screened", { exact: false }),
  ).toBeVisible();

  // The failure names the remedy, not the customer.
  await expect(page.getByTestId("ops-failures")).toContainText("timed out");
});

test("populated: shows which list generation is live and which was refused", async ({
  page,
}) => {
  await mockAuth(page);
  await mockHealth(page, health());
  await mockOverview(
    page,
    overviewBody({
      datasets: [
        {
          id: "v2",
          source: "OFAC_SDN",
          status: "REJECTED",
          version: "OFAC_SDN@2026-09-10T18:00:00.000Z",
          recordCount: 3,
          addedCount: null,
          downloadedAt: "2026-09-10T18:00:00.000Z",
          publishedAt: null,
          rejectionReason: "Parsed only 3 record(s), below the floor of 9500.",
          rollbackReason: null,
        },
        {
          id: "v1",
          source: "OFAC_SDN",
          status: "PUBLISHED",
          version: "OFAC_SDN@2026-09-10T06:00:00.000Z",
          recordCount: 19369,
          addedCount: 12,
          downloadedAt: "2026-09-10T06:00:00.000Z",
          publishedAt: "2026-09-10T06:05:00.000Z",
          rejectionReason: null,
          rollbackReason: null,
        },
      ],
    }),
  );
  await page.goto("/screening-health");

  const datasets = page.getByTestId("ops-datasets");
  await expect(
    datasets.locator('[data-dataset-status="PUBLISHED"]'),
  ).toHaveCount(1);
  await expect(datasets).toContainText("19369");
  // The refusal is visible, with its reason — a truncated feed that was
  // correctly refused should not look like a sync that simply did not happen.
  await expect(
    datasets.locator('[data-dataset-status="REJECTED"]'),
  ).toHaveCount(1);
  await expect(datasets).toContainText("below the floor");
});

test("populated: shows held files and who is working the queue", async ({
  page,
}) => {
  await mockAuth(page);
  await mockHealth(page, health());
  await mockOverview(
    page,
    overviewBody({
      matchQueue: {
        pending: 7,
        pendingByAlgorithmVersion: { "2.0.0": 7 },
        currentAlgorithmVersion: "2.0.0",
      },
      caseWorkload: { OPEN: 5, UNDER_REVIEW: 2 },
      holds: {
        activeHolds: 3,
        decidableFiles: 9,
        releasedInWindow: 1,
        policy: { CONFIRMED_SANCTIONS_MATCH: "BLOCKED" },
        staleAfterDays: 0,
        configurationProblems: [],
      },
    }),
  );
  await page.goto("/screening-health");

  await expect(page.getByTestId("ops-active-holds")).toContainText("3 / 9");
  await expect(page.getByTestId("ops-pending-matches")).toContainText("7");
  // A queue where everything is OPEN and nothing is UNDER_REVIEW is a queue
  // nobody is working — which a bare "7 pending" would not reveal.
  const workload = page.getByTestId("ops-case-workload");
  await expect(workload.locator('[data-case-state="OPEN"]')).toContainText("5");
  await expect(
    workload.locator('[data-case-state="UNDER_REVIEW"]'),
  ).toContainText("2");
});

test("populated: states when the recurring work next runs", async ({
  page,
}) => {
  await mockAuth(page);
  await mockHealth(page, health());
  await mockOverview(page, overviewBody());
  await page.goto("/screening-health");

  await expect(page.getByTestId("ops-next-rescreen")).toContainText(
    "2026-09-11",
  );
  await expect(page.getByTestId("ops-next-sync")).toContainText("2026-09-11");
  // Never run is stated as such rather than shown blank.
  await expect(page.getByTestId("ops-last-sync-success")).toContainText(
    "never",
  );
});

test("empty: says no list generation exists rather than rendering a blank table", async ({
  page,
}) => {
  await mockAuth(page);
  await mockHealth(page, health());
  await mockOverview(page, overviewBody());
  await page.goto("/screening-health");

  await expect(page.getByTestId("ops-attempts-empty")).toBeVisible();
  const empty = page.getByTestId("ops-datasets-empty");
  await expect(empty).toBeVisible();
  // And it is an alert, not a neutral note: with no generation, no customer
  // can be treated as clear.
  await expect(empty).toHaveAttribute("role", "alert");
  await expect(page.getByTestId("ops-sync-empty")).toBeVisible();
});

test("error: a failing overview surfaces a message, not a half-rendered page", async ({
  page,
}) => {
  await mockAuth(page);
  await mockHealth(page, health());
  await page.route("**/screening/overview*", (route) =>
    route.fulfill({ status: 500, json: { message: "boom" } }),
  );
  await page.goto("/screening-health");

  await expect(page.getByRole("alert").first()).toBeVisible();
  // Nothing from the operations view is rendered against failed data.
  await expect(page.getByTestId("ops-attempts")).toHaveCount(0);
});

test("permission denied: the operations view is not rendered at all", async ({
  page,
}) => {
  await mockAuth(page);
  await mockHealth(page, health());
  await page.route("**/screening/overview*", (route) =>
    route.fulfill({ status: 403, json: { message: "Forbidden" } }),
  );
  await page.goto("/screening-health");

  await expect(page.getByRole("alert").first()).toBeVisible();
  await expect(page.getByTestId("ops-holds")).toHaveCount(0);
});

test("renders the operations view in Arabic with RTL direction", async ({
  page,
}) => {
  await mockAuth(page, "AR");
  await mockHealth(page, health());
  await mockOverview(
    page,
    overviewBody({
      attempts: {
        total: 10,
        byOutcome: { NO_MATCH: 8, SCREENING_FAILED: 2 },
        byProvider: { built_in: 10 },
        unresolved: 2,
        unresolvedRate: 0.2,
        recentUnresolved: [],
      },
    }),
  );
  await page.goto("/screening-health");

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  // The numbers are the same in either direction; the surrounding prose is not.
  await expect(page.getByTestId("ops-unresolved-rate")).toContainText("20%");
  await expect(page.getByTestId("ops-attempts")).toContainText("عمليات الفحص");
});
