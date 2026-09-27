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

const SYNC_RUNS = [
  {
    id: "run-1",
    source: "OFAC_SDN",
    startedAt: "2026-09-05T00:00:00.000Z",
    completedAt: "2026-09-05T00:00:05.000Z",
    status: "succeeded",
    recordCount: 19329,
    errorMessage: null,
  },
  {
    id: "run-2",
    source: "UN_CONSOLIDATED",
    startedAt: "2026-09-05T00:00:00.000Z",
    completedAt: "2026-09-05T00:00:03.000Z",
    status: "succeeded",
    recordCount: 1011,
    errorMessage: null,
  },
];

async function mockStatus(page: Page, opts: { status?: number } = {}) {
  await page.route("http://localhost:4000/watchlist-sync/status**", (route) => {
    if (opts.status && opts.status !== 200) {
      return route.fulfill({ status: opts.status, json: { message: "no" } });
    }
    return route.fulfill({ status: 200, json: SYNC_RUNS });
  });
  // The screen now also loads the list GENERATIONS, so every test needs this
  // routed or the request escapes to a server that is not running.
  await mockDatasets(page, GENERATIONS);
}

function generation(over: Record<string, unknown> = {}) {
  return {
    id: "ver-1",
    source: "OFAC_SDN",
    status: "PUBLISHED",
    version: "2026-09-05",
    recordCount: 19329,
    addedCount: 12,
    downloadedAt: "2026-09-05T00:00:00.000Z",
    publishedAt: "2026-09-05T00:00:05.000Z",
    supersededAt: null,
    rejectedAt: null,
    rejectionReason: null,
    publishedByUserId: null,
    rolledBackFromId: null,
    rollbackReason: null,
    ...over,
  };
}

const GENERATIONS = [
  generation(),
  // A SUPERSEDED generation whose rows are still held — restorable.
  generation({
    id: "ver-old",
    status: "SUPERSEDED",
    version: "2026-08-01",
    recordCount: 19300,
    publishedAt: "2026-08-01T00:00:00.000Z",
    supersededAt: "2026-09-05T00:00:05.000Z",
  }),
  // A SUPERSEDED generation retention has already reclaimed. STILL LISTED, so it
  // looks available, and restoring it would leave screening running against
  // nothing — which looks exactly like screening that cleared everybody.
  generation({
    id: "ver-gone",
    status: "SUPERSEDED",
    version: "2026-01-01",
    recordCount: 0,
    publishedAt: "2026-01-01T00:00:00.000Z",
    supersededAt: "2026-02-01T00:00:00.000Z",
  }),
];

async function mockDatasets(page: Page, rows: Record<string, unknown>[]) {
  await page.route("**/watchlist-sync/datasets", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({ status: 200, json: rows });
  });
}

/** Every rollback POST, captured so the assertion is about the wire. */
async function captureRollbacks(page: Page, status = 201) {
  const calls: { url: string; body: unknown }[] = [];
  await page.route("**/watchlist-sync/datasets/*/rollback", (route) => {
    calls.push({
      url: route.request().url(),
      body: route.request().postDataJSON(),
    });
    return route.fulfill({
      status,
      json:
        status === 422
          ? {
              message:
                "Dataset generation 2026-01-01 has no records left — it is past the retention window and cannot be restored. Run a fresh sync instead.",
            }
          : generation({ id: "ver-old", status: "PUBLISHED" }),
    });
  });
  return calls;
}

test("lists sync runs with the sync/batch buttons", async ({ page }) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockStatus(page);

  await page.goto("/watchlist-sync");
  await expect(
    page.getByRole("heading", { name: "Sanctions watchlist sync" }),
  ).toBeVisible();
  await expect(
    page.getByTestId("watchlist-runs").getByRole("cell", { name: "OFAC SDN" }),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: "UN consolidated list" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sync watchlists now" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run recurring screening batch now" }),
  ).toBeVisible();
});

test("a user without the permission sees a friendly message", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockStatus(page, { status: 403 });

  await page.goto("/watchlist-sync");
  await expect(
    page.getByText("sanctions-pep.screen permission", { exact: false }),
  ).toBeVisible();
});

/*
 * RESTORING AN EARLIER SANCTIONS LIST — `GET /watchlist-sync/datasets` and
 * `POST /watchlist-sync/datasets/:id/rollback`, which had no web caller and wrote
 * no audit row (IMPROVEMENTS § 1.44, § 1.63). The API's own comment calls the
 * rollback "the most consequential manual override in this module".
 */

test("lists every generation and marks which one screening runs against", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockStatus(page);

  await page.goto("/watchlist-sync");
  await expect(page.getByTestId("watchlist-generations")).toBeVisible();
  await expect(page.getByTestId("generation-status-ver-1")).toHaveText(
    "PUBLISHED",
  );
  await expect(page.getByTestId("generation-status-ver-old")).toHaveText(
    "SUPERSEDED",
  );
});

test("offers the restore only where it can succeed, and says why when it cannot", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockStatus(page);

  await page.goto("/watchlist-sync");

  // Restorable: superseded, rows still held.
  await expect(page.getByTestId("restore-ver-old")).toBeEnabled();

  // The LIVE one is not restorable and needs no explanation.
  await expect(page.getByTestId("restore-ver-1")).toHaveCount(0);

  // THE TRAP: listed, superseded, and its rows are gone. The reason is stated
  // rather than left as a missing button, because "why can I not restore this
  // one" is exactly what a listed generation provokes.
  await expect(page.getByTestId("restore-ver-gone")).toHaveCount(0);
  await expect(page.getByTestId("generation-locked-ver-gone")).toContainText(
    "records are still held",
  );
});

test("restores a generation only with a stated reason of at least ten characters", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockStatus(page);
  const calls = await captureRollbacks(page);

  await page.goto("/watchlist-sync");
  await page.getByTestId("restore-ver-old").click();

  const confirm = page.getByTestId("restore-confirm-ver-old");
  // NINE characters, not zero: a test that types nothing cannot tell a
  // ten-character floor from a non-empty check.
  await page.getByTestId("restore-reason-ver-old").fill("Nine char");
  await expect(confirm).toBeDisabled();
  expect(calls).toHaveLength(0);

  await page
    .getByTestId("restore-reason-ver-old")
    .fill("  The 2026-09-05 ingest truncated the SDN list at 400 rows  ");
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0].url).toContain("/watchlist-sync/datasets/ver-old/rollback");
  expect(calls[0].body).toEqual({
    reason: "The 2026-09-05 ingest truncated the SDN list at 400 rows",
  });
});

test("renders the server's own refusal when its live row count disagrees", async ({
  page,
}) => {
  // The screen decides from `recordCount`, the ingest figure; the server checks
  // the rows that actually survive. Those can disagree, and the server is right —
  // so its sentence has to reach the reader rather than a generic failure.
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockStatus(page);
  await captureRollbacks(page, 422);

  await page.goto("/watchlist-sync");
  await page.getByTestId("restore-ver-old").click();
  await page
    .getByTestId("restore-reason-ver-old")
    .fill("Restoring the last good generation after a bad ingest");
  await page.getByTestId("restore-confirm-ver-old").click();

  await expect(page.getByTestId("watchlist-restore-error")).toContainText(
    "past the retention window",
  );
});

test("shows the recorded reason on a generation that was restored", async ({
  page,
}) => {
  // The stated basis is the control, so it has to be READABLE afterwards and not
  // only present in the audit log.
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockStatus(page);
  await mockDatasets(page, [
    generation({
      id: "ver-old",
      status: "PUBLISHED",
      rolledBackFromId: "ver-1",
      rollbackReason: "The newer ingest truncated the SDN list",
    }),
  ]);

  await page.goto("/watchlist-sync");
  await expect(page.getByTestId("generation-ver-old")).toContainText(
    "truncated the SDN list",
  );
});

test("watchlist-sync screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockStatus(page);

  await page.goto("/watchlist-sync");
  await expect(
    page.getByTestId("watchlist-runs").getByRole("cell", { name: "OFAC SDN" }),
  ).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
