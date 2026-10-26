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
    page.getByText("(sanctions-pep.screen)", { exact: false }),
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

/*
 * «الأزرار الي فيها مش شغالة، بضغط عليها ما بيظهر الي اشي»
 * — the owner's walk, 2026-10-26, about this screen.
 *
 * The buttons WERE working. `runWatchlistSync` fetches `treasury.gov` and
 * `scsanctions.un.org` with a 120-second timeout and two retries per source
 * (`watchlist-fetchers.ts#downloadOptions`), so the act can legitimately be in
 * flight for about six minutes — and the only thing that changed on screen was
 * `disabled`. Her conclusion was the reasonable one.
 *
 * The request is HELD OPEN here on purpose. A pending state that exists for
 * twenty milliseconds is a pending state nobody ever sees, so a test that
 * fulfils immediately would pass against a screen that is still silent in
 * practice.
 */
test("says work is under way while the sync runs, and then says what it did", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockStatus(page);

  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("http://localhost:4000/watchlist-sync/run", async (route) => {
    await held;
    await route.fulfill({
      status: 201,
      json: [
        { source: "OFAC_SDN", status: "succeeded", recordCount: 19329 },
        { source: "UN_CONSOLIDATED", status: "succeeded", recordCount: 743 },
      ],
    });
  });

  await page.goto("/watchlist-sync");
  await page.getByRole("button", { name: "Sync watchlists now" }).click();

  // IN FLIGHT. Before this, nothing here changed at all.
  const pending = page.getByTestId("ws-action-pending");
  await expect(pending).toHaveText("Working…");
  await expect(pending).toHaveAttribute("role", "status");

  release();

  // FINISHED, and the outcome NAMES what happened per source rather than
  // saying "done" — a success line carrying no information is the silence it
  // replaced with an extra step.
  const outcome = page.getByTestId("ws-action-outcome");
  await expect(outcome).toContainText("OFAC SDN");
  await expect(outcome).toContainText("UN consolidated list");
  await expect(outcome).toContainText("records");
  await expect(outcome).toHaveAttribute("role", "status");
  // And the pending line is gone, so the two cannot both stand.
  await expect(page.getByTestId("ws-action-pending")).toHaveCount(0);
});

test("a failed sync is announced as a failure, not as a quiet nothing", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockStatus(page);
  await page.route("http://localhost:4000/watchlist-sync/run", (route) =>
    route.fulfill({ status: 503, json: { message: "OFAC is unreachable" } }),
  );

  await page.goto("/watchlist-sync");
  await page.getByRole("button", { name: "Sync watchlists now" }).click();

  // `role="alert"`, not the outcome's polite `role="status"` — a failure is not
  // a quieter kind of success.
  const failed = page.getByTestId("ws-action-error");
  await expect(failed).toContainText("OFAC is unreachable");
  await expect(failed).toHaveAttribute("role", "alert");
  await expect(page.getByTestId("ws-action-outcome")).toHaveCount(0);
});
