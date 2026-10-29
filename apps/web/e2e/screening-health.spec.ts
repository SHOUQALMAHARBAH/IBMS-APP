import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { permissionsForRoles } from "./fixtures/role-permissions";

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
      json: { ...ME_BASE, roles: ["COMPLIANCE_OFFICER"], permissions: permissionsForRoles(["COMPLIANCE_OFFICER"]), languagePreference },
    }),
  );
}

function health(over: Record<string, unknown> = {}) {
  return {
    provider: "built_in",
    providerName: "Built-in watchlist cache (OFAC SDN + UN Consolidated)",
    status: "HEALTHY",
    // The producer's own string. This was truncated to its first sentence and dropped
    // *no PEP source is configured*, which is the clause that matters on this screen.
    detail:
      "Sanctions cache refreshed 2h ago. Covers SANCTIONS only (OFAC SDN + UN Consolidated) — no PEP source is configured.",
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
        note: { key: "BUILT_IN_SANCTIONS_SYNCED", kind: "DESCRIPTION" },
      },
      {
        capability: "PEP",
        supported: false,
        configured: false,
        operational: false,
        // THE OWNER'S OWN CAUTION, and the most important row in this table: a deployment running
        // only the built-in cache has NO PEP coverage, so these three dashes must not read as an
        // absence of risk.
        note: { key: "BUILT_IN_NO_PEP_DATA", kind: "CAUTION" },
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
          note: { key: "COMMERCIAL_CONTRACT_COVERAGE", kind: "CAUTION" },
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
  // ITEM 8 — BOTH reads. `GET /screening/providers/health` and `GET /screening/overview` are both
  // gated on `sanctions-pep.screen` (verified in their controllers), so a reader who lacks it is
  // refused both; refusing only one was indistinguishable from refusing both while `Promise.all`
  // collapsed them, and is not any more.
  for (const path of [
    "**/screening/providers/health",
    "**/screening/overview**",
  ]) {
    await page.route(path, (route) =>
      route.fulfill({ status: 403, json: { message: "Forbidden" } }),
    );
  }

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
  /*
   * «غير مُهيّأ», WITH THE SHADDA — and this assertion failing is the proof of the defect it was
   * pinning. It read «غير مهيأ» exactly, which was the LOCAL map this screen hand-wrote; the
   * screen reads `ENUM_LABEL.ProviderHealthStatus` now, which has shipped
   * `provHealthNotConfigured` in both languages the whole time. Two spellings of one word, the
   * undiacriticised one live only because a screen kept its own copy — and an exact-match
   * assertion on the copy is what held it in place.
   *
   * The test's own property is untouched: this screen must say NOT CONFIGURED in Arabic, and it
   * does. What changed is which of the two spellings is the product's.
   */
  await expect(page.getByText("غير مُهيّأ", { exact: true })).toBeVisible();
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

  // RE-POINTED: these asserted the RAW ISO string `2026-09-11`, which is what the screen was
  // printing — a machine string on a compliance screen, four centimetres below a panel that
  // formatted its own dates a third way. Both now go through `formatDate`, the product's one
  // answer, which renders DD/MM/YYYY for an English reader. The property this test is about —
  // that the screen STATES when the recurring work next runs — is unchanged.
  await expect(page.getByTestId("ops-next-rescreen")).toContainText("11/09/2026");
  await expect(page.getByTestId("ops-next-sync")).toContainText("11/09/2026");
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

test("loading: shows a loading state before the data arrives", async ({
  page,
}) => {
  // The fourth render state named by the verification contract. Held open with
  // a deliberate delay rather than raced against a fast local response: a test
  // that asserts a loading indicator without controlling the timing passes or
  // fails on machine speed, which is not a property of the code.
  await mockAuth(page);
  await mockHealth(page, health());
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/screening/overview*", async (route) => {
    await held;
    await route.fulfill({ status: 200, json: overviewBody() });
  });

  await page.goto("/screening-health");
  await expect(page.getByText("Loading…")).toBeVisible();
  // Nothing from the operations view is on screen yet.
  await expect(page.getByTestId("ops-attempts")).toHaveCount(0);

  release();
  // And once it lands, the loading state is gone and the view renders.
  await expect(page.getByText("Loading…")).toHaveCount(0);
  await expect(page.getByTestId("ops-attempts")).toBeVisible();
});

/*
 * ===========================================================================================
 * THE NINE CAPABILITY WORDS AND THE THREE WARNINGS -- all of them the owner's, all of them
 * asserted BY CONTENT.
 *
 * Her reason for refusing a presence check: a key that resolved to the English half would pass
 * one. So each assertion below names the Arabic run it expects, and the warning tests go further
 * and prove the caution is not a grey footnote -- *"a caution that renders as decoration is worse
 * than one nobody can read, because the first one looks like it was considered."*
 * ===========================================================================================
 */

/** The built-in adapter's real nine rows, in the order it builds them. */
function builtInNine() {
  return [
    { capability: "SANCTIONS", supported: true, configured: true, operational: true, note: { key: "BUILT_IN_SANCTIONS_SYNCED", kind: "DESCRIPTION" } },
    { capability: "PEP", supported: false, configured: false, operational: false, note: { key: "BUILT_IN_NO_PEP_DATA", kind: "CAUTION" } },
    { capability: "WATCHLIST", supported: false, configured: false, operational: false, note: { key: "BUILT_IN_SANCTIONS_ONLY", kind: "DESCRIPTION" } },
    { capability: "ADVERSE_MEDIA", supported: false, configured: false, operational: false, note: { key: "BUILT_IN_ADVERSE_MEDIA_UNAVAILABLE", kind: "DESCRIPTION" } },
    { capability: "INDIVIDUAL", supported: true, configured: true, operational: true, note: { key: "BUILT_IN_INDIVIDUAL_NAMES", kind: "DESCRIPTION" } },
    { capability: "ENTITY", supported: true, configured: true, operational: true, note: { key: "BUILT_IN_ENTITY_LEGAL_NAMES", kind: "DESCRIPTION" } },
    { capability: "BATCH", supported: true, configured: true, operational: true, note: { key: "BUILT_IN_BATCH_LOCAL", kind: "DESCRIPTION" } },
    { capability: "ONGOING_MONITORING", supported: true, configured: true, operational: true, note: { key: "BUILT_IN_MONITORING_SCHEDULE", kind: "DESCRIPTION" } },
    { capability: "WEBHOOKS", supported: false, configured: false, operational: false, note: { key: "BUILT_IN_WEBHOOKS_NOT_APPLICABLE", kind: "DESCRIPTION" } },
  ];
}

test("names all nine capabilities in Arabic, not one of them as a raw token", async ({
  page,
}) => {
  await mockAuth(page, "AR");
  await mockHealth(page, health({ capabilities: builtInNine() }));
  await page.goto("/screening-health");

  // Her nine words. `PROVIDER_CAPABILITY_LABEL_KEY` is total with no `null` left, so a tenth
  // member cannot ship unworded and none of these can fall through to its member name.
  const words: [string, string][] = [
    ["SANCTIONS", "العقوبات"],
    ["PEP", "الأشخاص السياسيون (PEP)"],
    ["WATCHLIST", "قوائم المراقبة"],
    ["ADVERSE_MEDIA", "التغطية الإعلامية السلبية"],
    ["INDIVIDUAL", "فحص الأفراد"],
    ["ENTITY", "فحص الكيانات"],
    ["BATCH", "الفحص بالدفعات"],
    ["ONGOING_MONITORING", "المراقبة المستمرة"],
    ["WEBHOOKS", "إشعارات فورية"],
  ];
  for (const [member, word] of words) {
    const row = page.locator(`[data-capability="${member}"]`);
    await expect(row).toContainText(word);
    // AND THE TOKEN IS GONE. Without this half the test passes against a cell that renders the
    // word AND the member name, which is what a fall-through left beside a label would look like.
    //
    // DERIVED, NOT EXEMPTED: `PEP` is a substring of the owner's own «الأشخاص السياسيون (PEP)» --
    // she put the Latin acronym in the label deliberately -- so the absence can never hold for
    // that row. A hand-kept exemption list would go stale the day she rewords it; this condition
    // cannot. (The recorded class: a needle that is a prefix of something legitimate is not a
    // needle. It has cost this repository a base64 `'99'` and «لا» inside «للاختبار».)
    if (!word.includes(member)) {
      await expect(row).not.toContainText(member);
    }
  }

  // AND THE CAUTION IS NOT IN THE CAPABILITY ROW. It spans its own row beneath, so a version that
  // put it back in the cell — where measured it renders 62px wide on a phone — fails here.
  await expect(
    page.locator('[data-capability="PEP"] [data-note-kind="CAUTION"]'),
  ).toHaveCount(0);
  await expect(page.locator('[data-capability-caution="PEP"]')).toBeVisible();
});

test("renders every note in Arabic, with no English sentence left under any row", async ({
  page,
}) => {
  await mockAuth(page, "AR");
  await mockHealth(page, health({ capabilities: builtInNine() }));
  await page.goto("/screening-health");

  const table = page.locator('[data-capability="SANCTIONS"]');
  await expect(table).toBeVisible();

  // Four of the nine sentences, by content. Every one of them was English prose the api sent and
  // this screen rendered verbatim until this batch.
  await expect(page.locator('[data-capability="INDIVIDUAL"]')).toContainText(
    "تُطابَق أسماء الأشخاص.",
  );
  await expect(page.locator('[data-capability="ENTITY"]')).toContainText(
    "تُطابَق الأسماء القانونية للشركات.",
  );
  await expect(page.locator('[data-capability="WEBHOOKS"]')).toContainText(
    "لا تنطبق على قوائم محفوظة داخل النظام.",
  );
  await expect(page.locator('[data-capability="BATCH"]')).toContainText(
    "يجري الفحص داخلياً على دفعات، ولا يوجد حدّ خارجي لعدد الطلبات.",
  );

  // AND THE ENGLISH IS GONE. Anchored on the four positives above, which is what makes this an
  // absence rather than an assertion about a page that never rendered.
  const main = page.locator("main");
  for (const english of [
    "Names are matched.",
    "Legal names are matched.",
    "Not applicable to a local cache.",
    "Batched locally",
  ]) {
    await expect(main).not.toContainText(english);
  }
});

/*
 * THE THREE WARNINGS SHE NAMED, one per provider, each asserted twice: the Arabic run is on the
 * screen, AND it renders as a warning region rather than as grey text under the name.
 *
 * The second half is the one that cannot be read off the content. A caution carries
 * `--warning-bg`, so its computed background is NOT transparent; a description has no background
 * at all. Asserting the description's transparency as well is what stops this passing against an
 * implementation that gave every note a box -- at which point nothing would distinguish a caution
 * again.
 */
const TRANSPARENT = "rgba(0, 0, 0, 0)";

test("the built-in cache's missing PEP data is a WARNING, in Arabic", async ({
  page,
}) => {
  await mockAuth(page, "AR");
  await mockHealth(page, health({ capabilities: builtInNine() }));
  await page.goto("/screening-health");

  // THE CAUTION IS ITS OWN ROW, spanning all four columns beneath the capability it is about.
  // It used to sit inside the first cell; measured on a 390px phone that cell gave its text 62px
  // of width and 299px of height, so by the owner's own rule the SPACE changed and not the
  // sentence.
  const pep = page.locator('[data-capability-caution="PEP"]');
  await expect(pep).toContainText(
    "لا تتوفّر لدى هذا المزوّد أي بيانات عن الأشخاص السياسيين.",
  );
  // «فحصهم يحتاج مزوّداً تجارياً» — the second clause, asserted separately: a reword that dropped
  // what to DO about it would still satisfy the first assertion.
  await expect(pep).toContainText("فحصهم يحتاج مزوّداً تجارياً");

  const caution = pep.locator('[data-note-kind="CAUTION"]');
  await expect(caution).toBeVisible();
  await expect(caution).not.toHaveCSS("background-color", TRANSPARENT);
  // THE MEANING IS IN THE WORDS, NOT IN THE COLOUR, and that is the half that matters for a
  // reader who cannot see the box: the icon is decorative and carries no label, so the sentence
  // above is what tells a screen-reader user this is a caution. It says so explicitly, which is
  // why the colour is redundant encoding rather than the only encoding.
  //
  // There is deliberately NO `role` here. A live region is for content that UPDATES; these notes
  // are static from first render and are reached in document order.
  await expect(caution).not.toHaveAttribute("role", "status");
  await expect(caution).not.toHaveAttribute("role", "alert");

  // The other half of the claim: an ordinary note has no box, so a caution's box MEANS something.
  const description = page
    .locator('[data-capability="INDIVIDUAL"] [data-note-kind="DESCRIPTION"]');
  await expect(description).toBeVisible();
  await expect(description).toHaveCSS("background-color", TRANSPARENT);
});

test("a commercial provider's contract caveat is a WARNING on a row of three ticks", async ({
  page,
}) => {
  await mockAuth(page, "AR");
  await mockHealth(
    page,
    health({
      provider: "commercial",
      capabilities: [
        {
          capability: "PEP",
          // SUPPORTED, CONFIGURED **AND** OPERATIONAL — the exact row she described: three green
          // marks with a caveat under them saying the vendor may not cover what the row claims.
          supported: true,
          configured: true,
          operational: true,
          note: { key: "COMMERCIAL_CONTRACT_COVERAGE", kind: "CAUTION" },
        },
      ],
      pepOperational: true,
    }),
  );
  await page.goto("/screening-health");

  // THE ROW STILL TICKS ALL THREE — that is the point of this one — and the caution beneath it
  // says the vendor may not cover what the row appears to claim.
  const row = page.locator('[data-capability="PEP"]');
  await expect(row.locator('[data-operational="true"]')).toBeVisible();

  const pep = page.locator('[data-capability-caution="PEP"]');
  await expect(pep).toContainText(
    "التغطية الفعلية تعتمد على المنتج المتعاقَد عليه",
  );
  await expect(pep).toContainText("راجع اتفاقية المزوّد قبل الاعتماد عليها.");

  const caution = pep.locator('[data-note-kind="CAUTION"]');
  await expect(caution).toBeVisible();
  await expect(caution).not.toHaveCSS("background-color", TRANSPARENT);
});

test("a sanctions-scoped engine says in Arabic that no PEP data is searched", async ({
  page,
}) => {
  await mockAuth(page, "AR");
  await mockHealth(
    page,
    health({
      provider: "on_premise",
      capabilities: [
        {
          capability: "PEP",
          supported: true,
          configured: false,
          operational: false,
          note: {
            key: "ON_PREMISE_PEP_SANCTIONS_ONLY",
            params: { name: "sanctions_only" },
            kind: "CAUTION",
          },
        },
      ],
      pepOperational: false,
    }),
  );
  await page.goto("/screening-health");

  const pep = page.locator('[data-capability-caution="PEP"]');
  await expect(pep).toContainText("مقتصرة على العقوبات");
  await expect(pep).toContainText("لا تُفحَص بيانات الأشخاص السياسيين.");
  const caution = pep.locator('[data-note-kind="CAUTION"]');
  await expect(caution).toBeVisible();
  await expect(caution).not.toHaveCSS("background-color", TRANSPARENT);

  // THE PARAMETER IS INTERPOLATED, NOT PRINTED. Three notes name the configured dataset, and a
  // placeholder reaching the screen is the one failure the content assertions above cannot see:
  // «مجموعة البيانات «{name}»» reads perfectly well as a sentence.
  await expect(pep).toContainText("sanctions_only");
  await expect(pep).not.toContainText("{name}");
});

test("screening-health screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  // IN ARABIC, which is the reading direction these words were written for — and the capability
  // table is the markup this batch changed: a `Note` in a cell, then a second row whose single
  // cell spans all four columns.
  await mockAuth(page, "AR");
  await mockHealth(page, health({ capabilities: builtInNine() }));

  await page.goto("/screening-health");
  await expect(page.locator('[data-capability-caution="PEP"]')).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
