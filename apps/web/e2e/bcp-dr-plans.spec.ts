import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";

const ME_BASE = {
  id: "user-1",
  email: "admin@ibms.test",
  fullName: "Security Administrator",
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

const PLAN = {
  id: "plan-1",
  scenario: "system_outage",
  planDocumentId: null as string | null,
  rtoHours: 4,
  rpoHours: 24,
  lastTestedAt: null as string | null,
  nextTestDueAt: null as string | null,
};

const COVERAGE = [
  { scenario: "system_outage", hasPlan: true, plans: [PLAN] },
  { scenario: "office_site_loss", hasPlan: false, plans: [] },
  { scenario: "cyberattack_ransomware", hasPlan: false, plans: [] },
  { scenario: "key_staff_unavailability", hasPlan: false, plans: [] },
  { scenario: "insurer_service_interruption", hasPlan: false, plans: [] },
];

test("shows scenario coverage, including gaps for scenarios with no plan", async ({ page }) => {
  await mockAuth(page, ["SYSTEM_SECURITY_ADMINISTRATOR"]);
  await page.route("http://localhost:4000/bcp-dr-plans/coverage", (route) =>
    route.fulfill({ status: 200, json: COVERAGE }),
  );

  await page.goto("/bcp-dr-plans");
  await expect(
    page.getByRole("heading", { name: "Business Continuity & Disaster Recovery" }),
  ).toBeVisible();
  await expect(page.getByText("no plan on file").first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "4", exact: true })).toBeVisible();
});

test("a user without the permission sees a friendly message", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/bcp-dr-plans/coverage", (route) =>
    route.fulfill({ status: 403, json: { message: "no" } }),
  );

  await page.goto("/bcp-dr-plans");
  await expect(
    page.getByText("(bcp-dr.manage)", { exact: false }),
  ).toBeVisible();
});

test("records a plan test and shows the new due date", async ({ page }) => {
  await mockAuth(page, ["SYSTEM_SECURITY_ADMINISTRATOR"]);
  let current = { ...PLAN };
  await page.route("http://localhost:4000/bcp-dr-plans/coverage", (route) =>
    route.fulfill({
      status: 200,
      json: [
        { scenario: "system_outage", hasPlan: true, plans: [current] },
        ...COVERAGE.slice(1),
      ],
    }),
  );
  await page.route("http://localhost:4000/bcp-dr-plans/plan-1/record-test", (route) => {
    // MIDDAY UTC, not midnight. `nextTestDueAt` is a full `DateTime` rather than a
    // `@db.Date`, so the screen renders it in LOCAL time — and a midnight-UTC fixture
    // renders as the DAY BEFORE anywhere west of UTC, which would make this assertion
    // pass here and in CI and fail for one reader in New York. Midday is the same
    // calendar day from UTC-12 to UTC+11.
    current = { ...current, lastTestedAt: "2026-09-06T09:00:00.000Z", nextTestDueAt: "2027-09-06T12:00:00.000Z" };
    return route.fulfill({ status: 201, json: current });
  });

  await page.goto("/bcp-dr-plans");
  await page.getByRole("button", { name: "Record test" }).click();
  await page.locator('input[type="date"]').fill("2027-09-06");
  await page.getByRole("button", { name: "Save" }).click();
  // RE-POINTED, and the reversal is the point: this asserted the raw ISO day
  // `2027-09-06`, because the screen printed `.slice(0, 10)`. It goes through
  // `formatDate` now like every other date in the product, so an Arabic reader stops
  // seeing an ISO string on the screen whose dates are statutory test deadlines. The
  // property under test is unchanged — the new due date appears after recording — and
  // the assertion is still EXACT rather than loosened to a substring.
  // `06/09/2027`, DAY-FIRST — measured, not predicted. `EN_LOCALE` is `'en-GB'`, and my first
  // attempt here asserted `9/6/2027` because I reasoned from `en-US` instead of reading the
  // constant. That same wrong assumption produced a FALSE claim to the owner one batch ago about
  // `DateEcho` being silent in English; see the correction in CLAUDE.md.
  await expect(page.getByRole("cell", { name: "06/09/2027" })).toBeVisible();
});

test("creates a new plan for a scenario", async ({ page }) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("http://localhost:4000/bcp-dr-plans/coverage", (route) =>
    route.fulfill({ status: 200, json: COVERAGE }),
  );
  await page.route("http://localhost:4000/bcp-dr-plans", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 201,
        json: { ...PLAN, id: "plan-2", scenario: "office_site_loss", rtoHours: 12, rpoHours: 48 },
      });
    }
    return route.fallback();
  });

  await page.goto("/bcp-dr-plans");
  await page.getByLabel("Scenario").selectOption("office_site_loss");
  await page.getByLabel("RTO (hours)").fill("12");
  await page.getByLabel("RPO (hours)").fill("48");
  await page.getByRole("button", { name: "Record plan" }).click();
  await expect(page.getByText("Could not create the plan.")).not.toBeVisible();
});

test("bcp-dr-plans screen has no serious/critical accessibility violations @a11y", async ({ page }) => {
  await mockAuth(page, ["SYSTEM_SECURITY_ADMINISTRATOR"]);
  await page.route("http://localhost:4000/bcp-dr-plans/coverage", (route) =>
    route.fulfill({ status: 200, json: COVERAGE }),
  );

  await page.goto("/bcp-dr-plans");
  await expect(page.getByText("no plan on file").first()).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
test("the next-test-due input has a real label now — it had none at all", async ({ page }) => {
  // The one row the date measurement could not read: no label, no `aria-label`, no `id`, no
  // `htmlFor`. It renders only after a button is pressed, which is why the a11y suite had never
  // seen it. Her sentence is the LABEL, because there was no label for a hint to sit under.
  await mockAuth(page, ["SYSTEM_SECURITY_ADMINISTRATOR"], "AR");
  await page.route("http://localhost:4000/bcp-dr-plans/coverage", (route) =>
    route.fulfill({
      status: 200,
      json: [
        { scenario: "system_outage", hasPlan: true, plans: [PLAN] },
        ...COVERAGE.slice(1),
      ],
    }),
  );

  await page.goto("/bcp-dr-plans");

  // ANCHORED, and `e2e-anchored-reads.test.ts` caught this one before it shipped: `toHaveCount(0)`
  // passes on its FIRST poll, so an absence with nothing positive asserted before it cannot tell
  // "correctly withheld" from "the page has not rendered yet". The control that OPENS the row is
  // the anchor, because it proves the row this assertion is about is on screen.
  const open = page.getByRole("button", { name: "تسجيل اختبار" });
  await expect(open).toBeVisible();
  await expect(page.locator('input[type="date"]')).toHaveCount(0);

  await open.click();
  const field = page.getByLabel("تاريخ الفحص القادم للخطة.");
  await expect(field).toBeVisible();

  await field.fill("2027-09-06");
  await expect(page.locator('[data-date-echo="2027-09-06"]')).toHaveText(
    "6‏/9‏/2027",
  );
});
