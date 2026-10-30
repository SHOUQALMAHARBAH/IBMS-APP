import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";

const ME_BASE = {
  id: "user-1",
  email: "finance@ibms.test",
  fullName: "Finance Officer",
  languagePreference: "EN",
  mfaEnabled: false,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

async function mockAuth(page: Page, roles: string[], language = "EN") {
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fake-access-token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      status: 200,
      json: {
        ...ME_BASE,
        languagePreference: language,
        roles,
        permissions: permissionsForRoles(roles),
      },
    }),
  );
}

const REPORT = {
  asOf: "2026-09-03T00:00:00.000Z",
  currency: "JOD",
  rows: [
    {
      customerId: "acme",
      customerLegalName: "Acme Ltd",
      currency: "JOD",
      current: "0.000",
      d1_30: "0.000",
      d31_60: "0.000",
      d61_90: "0.000",
      d90_plus: "115350.000",
      outstandingTotal: "115350.000",
      invoiceCount: 1,
      oldestDueDate: "2026-05-01T00:00:00.000Z",
      oldestDaysOverdue: 125,
    },
    {
      customerId: "beta",
      customerLegalName: "Beta Co",
      currency: "JOD",
      current: "4000.000",
      d1_30: "2000.000",
      d31_60: "0.000",
      d61_90: "0.000",
      d90_plus: "0.000",
      outstandingTotal: "6000.000",
      invoiceCount: 2,
      oldestDueDate: "2026-08-20T00:00:00.000Z",
      oldestDaysOverdue: 14,
    },
  ],
  totals: {
    current: "4000.000",
    d1_30: "2000.000",
    d31_60: "0.000",
    d61_90: "0.000",
    d90_plus: "115350.000",
    outstandingTotal: "121350.000",
    invoiceCount: 3,
    customerCount: 2,
  },
};

async function mockAgeing(page: Page, opts: { status?: number } = {}) {
  await page.route("http://localhost:4000/client-accounting/ageing**", (route) => {
    if (opts.status && opts.status !== 200) {
      return route.fulfill({ status: opts.status, json: { message: "no" } });
    }
    return route.fulfill({ status: 200, json: REPORT });
  });
}

test("shows the ageing report worst-first with a totals row", async ({ page }) => {
  await mockAuth(page, ["FINANCE_COLLECTIONS_OFFICER"]);
  await mockAgeing(page);

  await page.goto("/client-accounting");
  await expect(
    page.getByRole("heading", { name: "Client accounting" }),
  ).toBeVisible();

  // worst-first: Acme (125d) is the first data row
  const firstRowCells = page.locator("tbody tr").first().locator("td");
  await expect(firstRowCells.first()).toHaveText("Acme Ltd");
  // RE-POINTED, and this is a real reversal rather than a rename: this asserted
  // `125d overdue` — two English words built by a template literal on the screen that says what
  // clients owe the office, on an Arabic-first product, and the assertion was PINNING them. The
  // figure stays a figure and the meaning now comes from `statusOverdue`, the marker owner
  // decision 55 already has serving three screens. Asserted as a PAIR so a revert fails: the
  // marker present AND the English run gone.
  await expect(
    page.getByRole("cell", { name: "125d (past its deadline)" }),
  ).toBeVisible();
  await expect(page.locator("tbody")).not.toContainText("125d overdue");
  await expect(
    page.getByRole("cell", { name: "JOD 115,350.000" }).first(),
  ).toBeVisible();

  await expect(page.getByRole("cell", { name: "Beta Co" })).toBeVisible();

  // totals row
  await expect(page.getByRole("cell", { name: "Total" })).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "JOD 121,350.000" }),
  ).toBeVisible();
});

test("a user without the permission sees a friendly message", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockAgeing(page, { status: 403 });

  await page.goto("/client-accounting");
  await expect(
    page.getByText("(client-accounting.read)", { exact: false }),
  ).toBeVisible();
});

test("client accounting screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["FINANCE_COLLECTIONS_OFFICER"]);
  await mockAgeing(page);

  await page.goto("/client-accounting");
  await expect(page.getByRole("cell", { name: "Acme Ltd" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
test("the as-of field's own label is the sentence its aria-label used to hide", async ({
  page,
}) => {
  // «تاريخ الرصيد» -- BALANCE DATE -- shipped as an invisible `aria-label` while the eye was given
  // «كما في», so a blind reader was better informed than a sighted one. An `aria-label` REPLACES
  // the accessible name, so the two readers were told different things and nobody proof-read the
  // invisible one. Owner decision: what is heard becomes what is seen.
  await mockAuth(page, ["FINANCE_COLLECTIONS_OFFICER"], "AR");
  await mockAgeing(page);

  await page.goto("/client-accounting");
  const field = page.getByLabel("تاريخ الرصيد");
  await expect(field).toBeVisible();

  // ASSERTED AS A PAIR. The positive half alone would pass against a screen that kept BOTH, which
  // is the state the decision exists to remove -- and `aria-label` is where the duplicate would
  // live, so its ABSENCE is the half that cannot be satisfied by accident.
  await expect(field).not.toHaveAttribute("aria-label", /./);
  await expect(page.locator("main label").first()).not.toHaveText("كما في");
});

test("the chosen date is echoed back through formatDate, so a month-first reading is visible", async ({
  page,
}) => {
  // THE SCREEN SHE SAW IT ON. `<input type="date">` renders its placeholder in the USER AGENT's
  // order, which here is MONTH-FIRST: `03/04` meaning 3 April is stored as 4 March -- a valid
  // date, silently wrong, deciding which ageing bucket every outstanding invoice falls into. A
  // hint cannot carry the format, because the format is not ours and differs per machine; the
  // echo shows what was READ instead of claiming what to type.
  //
  // THE ARABIC RENDERING IS DAY-FIRST, which is what makes the echo informative here: the reader
  // sees the two numbers in the other order from the one they typed. In ENGLISH `formatDate`
  // produces `3/4/2026` -- the SAME order as the input's own placeholder -- so it disambiguates
  // only when one number exceeds 12. That limit is measured and is in the register.
  await mockAuth(page, ["FINANCE_COLLECTIONS_OFFICER"], "AR");
  await mockAgeing(page);

  await page.goto("/client-accounting");
  await page.getByLabel("تاريخ الرصيد").fill("2026-03-04");
  await expect(page.locator('[data-date-echo="2026-03-04"]')).toHaveText(
    "4‏/3‏/2026",
  );
});
