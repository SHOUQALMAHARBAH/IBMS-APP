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

function result(over: Record<string, unknown> = {}) {
  return {
    fileName: "customers.csv",
    totalDataRows: 3,
    imported: 2,
    rejected: 1,
    screened: 2,
    screeningFlagged: 0,
    rejections: [{ lineNumber: 3, reason: "legalName is required" }],
    failures: [],
    ...over,
  };
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
  // The rejected row keeps the line number the office sees in their own spreadsheet.
  await expect(page.locator('[data-import-reject="3"]')).toContainText(
    "legalName is required",
  );
});

test("a screening hit is reported as work, and says the rows WERE imported", async ({
  page,
}) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await page.route("http://localhost:4000/imports/customers", (route) =>
    route.fulfill({
      status: 201,
      json: result({ screeningFlagged: 1, rejected: 0, rejections: [] }),
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
  await page.goto("/settings/customer-import");
  await expect(page.getByTestId("customer-import-form")).toBeVisible();

  const results = await new AxeBuilder({ page }).include("main").analyze();
  const serious = results.violations.filter((v) =>
    ["serious", "critical"].includes(v.impact ?? ""),
  );
  expect(serious).toEqual([]);
});
