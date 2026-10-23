import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";

/**
 * Loading an office's legacy customer file — `POST /imports/customers`, which had no web caller,
 * so `customer.bulk-import` was a permission its two holders could not exercise.
 *
 * ## What carries the weight
 *
 *  1. **The screening count is not an error count.** Every row is screened through the same
 *     `ScreeningService.run` the intake flow uses, and a potential match does NOT stop the import:
 *     the row is written and the match joins the sanctions review queue. A screen that folded that
 *     in with the failures would teach an office to treat a real hit as a data problem, so the two
 *     are asserted separately and the clear case is asserted too.
 *  2. **An unmapped field is ABSENT from the mapping, never `''`.** An empty heading tells the
 *     server to look for a column named "", which is a different request from "my file does not
 *     carry that field".
 *  3. **It is a MULTIPART request.** `apiPost` would serialise a `File` to `{}`, and the shared
 *     client used to stamp `application/json` on any body — which breaks the boundary the browser
 *     has to set itself. The send test asserts the content type, because that failure looks like a
 *     bad file rather than a bad header.
 */

const ME_BASE = {
  id: "user-1",
  email: "admin@ibms.test",
  fullName: "Office Administrator",
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
    route.fulfill({
      status: 200,
      json: { ...ME_BASE, roles, permissions: permissionsForRoles(roles) },
    }),
  );
}

const CSV = "Name,Kind,Phone\nAcme Trading,CORPORATE,+962 7 900 0000\n";

/*
 * THIS FIXTURE WAS WRONG, AND ITS WRONGNESS IS THE REASON THE SCREEN'S CRASH SURVIVED THREE WEEKS.
 *
 * It declared `rejections` and `failures` — the shape Phase 2 item 1 REMOVED from the api, replacing
 * both with one `issues` list carrying a `kind`, plus `refusedDuplicates` and `batchId`. The screen
 * read the old fields, so against this mock it worked perfectly and against the real server it threw
 * during render on every successful import.
 *
 * A MOCKED ENDPOINT CANNOT REFUSE YOU, AND IT CANNOT DROP A FIELD THE API DROPPED. No assertion
 * added to this file would have caught it; the instrument that can is
 * `packages/db/prisma/legacy-import-shape-parity.spec.ts`, which reads both declarations as text and
 * is the only place that can see them together.
 */
function result(over: Record<string, unknown> = {}) {
  return {
    batchId: "batch-1",
    fileName: "customers.csv",
    totalDataRows: 3,
    imported: 2,
    rejected: 1,
    refusedDuplicates: 0,
    screened: 2,
    screeningFlagged: 0,
    issues: [
      { lineNumber: 3, kind: "BAD_DATA", detail: "legalName is required" },
    ],
    ...over,
  };
}

/** Two past imports, newest first — the order the api's own `listRecent` returns. */
const BATCHES = [
  {
    id: "batch-1",
    fileName: "customers.csv",
    startedAt: "2026-10-20T09:00:00.000Z",
    totalDataRows: 3,
    imported: 2,
    refused: 1,
    screened: 2,
    needsReview: 0,
  },
  {
    id: "batch-0",
    fileName: "older.csv",
    startedAt: "2026-09-01T09:00:00.000Z",
    totalDataRows: 10,
    imported: 10,
    refused: 0,
    screened: 10,
    needsReview: 2,
  },
];

async function mockBatches(
  page: Page,
  opts: { batches?: unknown[]; status?: number; issues?: unknown[] } = {},
) {
  await page.route("http://localhost:4000/imports/customers/batches**", (route) =>
    opts.status && opts.status !== 200
      ? route.fulfill({
          status: opts.status,
          json: { message: "Something went wrong" },
        })
      : route.fulfill({ status: 200, json: opts.batches ?? BATCHES }),
  );
  // THE DETAIL ROUTE LAST, and that is load-bearing: `/batches**` above also matches
  // `/batches/batch-1`, and Playwright gives precedence to the handler registered LAST.
  await page.route(
    "http://localhost:4000/imports/customers/batches/*",
    (route) =>
      route.fulfill({
        status: 200,
        json: {
          ...BATCHES[0],
          issues:
            opts.issues ??
            [
              {
                lineNumber: 3,
                kind: "DUPLICATE",
                detail: "A customer with this registration number exists.",
                collidedWithCustomerId: "cust-9",
              },
              {
                lineNumber: 5,
                kind: "IMPORTED_NEEDS_REVIEW",
                detail: "Screening produced a potential match.",
              },
            ],
        },
      }),
  );
}

async function attachCsv(page: Page) {
  await page.getByTestId("import-file").setInputFiles({
    name: "customers.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(CSV),
  });
}

test("refuses to send until every required field names a column", async ({ page }) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  // THE REGISTER LOADS ON MOUNT, so every test that reaches this screen has to mock it — otherwise
  // its load error renders a SECOND `role="alert"` in `main` and the refusal test below becomes a
  // strict-mode violation rather than a failure that says what is wrong.
  await mockBatches(page);
  await page.goto("/settings/customer-import");

  await attachCsv(page);
  // Both required fields are unmapped, and the screen says WHICH — the server refuses naming the
  // field, so saying it here is telling the reader the same thing earlier.
  await expect(page.getByTestId("import-submit")).toBeDisabled();
  await expect(page.getByTestId("import-missing-required")).toContainText(
    "Legal name",
  );

  // ONE at a time, so the assertion can tell "both are required" from "one is".
  await page.getByTestId("import-map-legalName").fill("Name");
  await expect(page.getByTestId("import-submit")).toBeDisabled();
  await expect(page.getByTestId("import-missing-required")).toContainText(
    "Customer type",
  );

  await page.getByTestId("import-map-customerType").fill("Kind");
  await expect(page.getByTestId("import-submit")).toBeEnabled();
});

test("sends the file as multipart, with an unmapped field absent from the mapping", async ({
  page,
}) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  // THE REGISTER LOADS ON MOUNT, so every test that reaches this screen has to mock it — otherwise
  // its load error renders a SECOND `role="alert"` in `main` and the refusal test below becomes a
  // strict-mode violation rather than a failure that says what is wrong.
  await mockBatches(page);

  let contentType: string | null = null;
  let mapping: Record<string, string> | null = null;
  await page.route("http://localhost:4000/imports/customers", (route) => {
    const request = route.request();
    contentType = request.headers()["content-type"] ?? null;
    // The multipart body as text: enough to read back the mapping part without a parser.
    const raw = request.postData() ?? "";
    const match = /name="mapping"\r?\n\r?\n([^\r\n]*)/.exec(raw);
    mapping = match ? (JSON.parse(match[1]!) as Record<string, string>) : null;
    return route.fulfill({ status: 201, json: result() });
  });
  await page.goto("/settings/customer-import");

  await attachCsv(page);
  await page.getByTestId("import-map-legalName").fill("  Name  ");
  await page.getByTestId("import-map-customerType").fill("Kind");
  await page.getByTestId("import-map-contactPhone").fill("Phone");
  await page.getByTestId("import-submit").click();

  await expect(page.getByTestId("import-result")).toBeVisible();

  // The browser's own multipart type WITH its boundary. Had the shared client stamped
  // `application/json` on the FormData body, the server would read a multipart payload as JSON and
  // the failure would look like a bad file.
  expect(contentType).toContain("multipart/form-data");
  expect(contentType).toContain("boundary=");

  expect(mapping).toEqual({
    legalName: "Name",
    customerType: "Kind",
    contactPhone: "Phone",
  });
  // The four fields nobody named must be ABSENT, not ''. An empty heading tells the server to look
  // for a column named "".
  expect(mapping).not.toHaveProperty("nationality");
  expect(mapping).not.toHaveProperty("contactEmail");
});

test("reports a clear screening result apart from the rejections", async ({ page }) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  // THE REGISTER LOADS ON MOUNT, so every test that reaches this screen has to mock it — otherwise
  // its load error renders a SECOND `role="alert"` in `main` and the refusal test below becomes a
  // strict-mode violation rather than a failure that says what is wrong.
  await mockBatches(page);
  await page.route("http://localhost:4000/imports/customers", (route) =>
    route.fulfill({ status: 201, json: result() }),
  );
  await page.goto("/settings/customer-import");

  await attachCsv(page);
  await page.getByTestId("import-map-legalName").fill("Name");
  await page.getByTestId("import-map-customerType").fill("Kind");
  await page.getByTestId("import-submit").click();

  await expect(page.getByTestId("import-counts")).toContainText(
    "Imported 2 of 3 rows",
  );
  await expect(page.getByTestId("import-screening")).toContainText(
    "no potential match",
  );
  // The refused row keeps the line number the office sees in their own spreadsheet, and the KIND
  // leads the reason: a duplicate needs an identity decision where bad data needs a typo fixed.
  const refused = page.locator('[data-import-issue="3"]');
  await expect(refused).toContainText("legalName is required");
  // BAD_DATA has no Arabic word yet, so it renders its own member name — declared, not invented.
  await expect(refused).toContainText("BAD_DATA");
});

test("a screening hit is reported as work, and says the rows WERE imported", async ({
  page,
}) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  // THE REGISTER LOADS ON MOUNT, so every test that reaches this screen has to mock it — otherwise
  // its load error renders a SECOND `role="alert"` in `main` and the refusal test below becomes a
  // strict-mode violation rather than a failure that says what is wrong.
  await mockBatches(page);
  await page.route("http://localhost:4000/imports/customers", (route) =>
    route.fulfill({
      status: 201,
      json: result({ screeningFlagged: 1, rejected: 0, issues: [] }),
    }),
  );
  await page.goto("/settings/customer-import");

  await attachCsv(page);
  await page.getByTestId("import-map-legalName").fill("Name");
  await page.getByTestId("import-map-customerType").fill("Kind");
  await page.getByTestId("import-submit").click();

  const screening = page.getByTestId("import-screening");
  await expect(screening).toContainText("1 potential match");
  // The two claims that stop a real hit being read as a data problem: the rows are in, and the
  // match is somewhere a person will decide it.
  await expect(screening).toContainText("ARE imported");
  await expect(screening).toContainText("sanctions review queue");
});

test("renders the API's own refusal rather than a generic failure", async ({ page }) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  // THE REGISTER LOADS ON MOUNT, so every test that reaches this screen has to mock it — otherwise
  // its load error renders a SECOND `role="alert"` in `main` and the refusal test below becomes a
  // strict-mode violation rather than a failure that says what is wrong.
  await mockBatches(page);
  await page.route("http://localhost:4000/imports/customers", (route) =>
    route.fulfill({
      status: 422,
      json: { message: 'The mapping must name a column for "legalName".' },
    }),
  );
  await page.goto("/settings/customer-import");

  await attachCsv(page);
  await page.getByTestId("import-map-legalName").fill("Nmae");
  await page.getByTestId("import-map-customerType").fill("Kind");
  await page.getByTestId("import-submit").click();

  // The server knows which column it could not find; a generic "could not import" would send the
  // reader back to the file instead of to the mapping.
  await expect(page.locator("main").getByRole("alert")).toContainText(
    'must name a column for "legalName"',
  );
});

test("a role without customer.bulk-import is refused the screen by name", async ({
  page,
}) => {
  // SALES_RELATIONSHIP_OFFICER reads and creates customers and holds no bulk import — the mirror
  // of the two roles that hold the import and cannot read a customer at all.
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.goto("/settings/customer-import");

  // Anchored on the heading, which renders either way, so the absence below is not satisfied by a
  // page that failed to mount.
  await expect(
    page.getByRole("heading", { name: "Customer import" }),
  ).toBeVisible();
  await expect(page.getByTestId("customer-import-form")).toHaveCount(0);
  await expect(page.locator("main").getByRole("alert")).toContainText("customer.bulk-import");
});

test("customer import screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  // THE REGISTER LOADS ON MOUNT, so every test that reaches this screen has to mock it — otherwise
  // its load error renders a SECOND `role="alert"` in `main` and the refusal test below becomes a
  // strict-mode violation rather than a failure that says what is wrong.
  await mockBatches(page);
  await page.goto("/settings/customer-import");
  await expect(page.getByTestId("customer-import-form")).toBeVisible();

  const results = await new AxeBuilder({ page }).include("main").analyze();
  const serious = results.violations.filter((v) =>
    ["serious", "critical"].includes(v.impact ?? ""),
  );
  expect(serious).toEqual([]);
});

test("OWNER DECISION 43 — the durable report is readable, and opening one past import fetches its lines", async ({
  page,
}) => {
  /*
   * RECORDED AS A DEFECT ON 2026-10-02 AND LEFT ALONE BY INSTRUCTION AT THE TIME: *"DEFECT 2: THE
   * DURABLE REPORT HAS NO SCREEN"*. `batchId`, both batch routes and the DUPLICATE-versus-BAD_DATA
   * split all worked, were proven over real HTTP, and nothing reachable by clicking read any of
   * them — so an officer who imported 2,000 rows read its refusals ONCE, in a panel that then threw.
   *
   * Two routes, and the test exercises BOTH: the list on mount, the detail on the click. A test that
   * only read the list would leave `GET .../batches/:id` exactly as unreachable as before.
   */
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockBatches(page);
  await page.goto("/settings/customer-import");

  const register = page.getByTestId("import-register");
  await expect(register).toBeVisible();

  // Both past imports, each carrying THE SAME SENTENCES the office was shown on the day — the
  // existing `impResultCounts` and screening keys, reused rather than reworded, so a reader cannot
  // be told two different things about one import.
  const newest = page.locator('[data-import-batch="customers.csv"]');
  await expect(newest).toContainText("Imported 2 of 3 rows");
  await expect(newest).toContainText("2026-10-20");
  const older = page.locator('[data-import-batch="older.csv"]');
  await expect(older).toContainText("Imported 10 of 10 rows");
  await expect(older).toContainText("2 potential match");

  // ---------------------------------------------- THE DETAIL ROUTE, ON THE CLICK
  const open = page.getByTestId("import-batch-open-customers.csv");
  await expect(open).toHaveAttribute("aria-expanded", "false");
  await open.click();
  await expect(open).toHaveAttribute("aria-expanded", "true");

  const lines = page.getByTestId("import-batch-issues-customers.csv");
  await expect(lines).toBeVisible();
  // The DUPLICATE line: an identity decision, and the api's own sentence beside it.
  await expect(lines.locator('[data-import-issue="3"]')).toContainText(
    "registration number exists",
  );
  // THE KIND LEADS THE REASON, and two of the three kinds have no Arabic word yet so they render
  // their member name — declared rather than invented, the eighteen-workflow-words decision.
  await expect(lines.locator('[data-import-issue="3"]')).toContainText(
    "DUPLICATE",
  );
  // AND THE THIRD KIND DOES HAVE A WORD, which is what proves the label map is consulted rather
  // than the member name always being rendered: `IMPORTED_NEEDS_REVIEW` reads "Awaiting review".
  const review = lines.locator('[data-import-issue="5"]');
  await expect(review).toContainText("Awaiting review");
  await expect(review).not.toContainText("IMPORTED_NEEDS_REVIEW");
});

test("OWNER DECISION 43 — an office that has never imported is told so, and a failed register read says what to do", async ({
  page,
}) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockBatches(page, { batches: [] });
  await page.goto("/settings/customer-import");

  await expect(page.getByTestId("import-register-none")).toContainText(
    "has run an import yet",
  );

  // ---------------------------------------------- AND THE LOAD ERROR SAYS WHAT TO DO
  /*
   * A SECOND PAGE LOAD rather than a second test, because the point is the OTHER branch of the same
   * state: "nobody has imported" and "we could not find out" must not look alike. The api's own
   * message wins when it sends one; the key is the fallback, and gate 14 requires it to carry a way
   * forward in both languages — which it does, because it is `endorsementLoadError` split around its
   * own noun so the way-forward tail came across intact.
   */
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockBatches(page, { status: 500 });
  await page.goto("/settings/customer-import");

  await expect(page.getByTestId("import-register-error")).toContainText(
    "Something went wrong",
  );
  await expect(page.getByTestId("import-register-none")).toHaveCount(0);
});
