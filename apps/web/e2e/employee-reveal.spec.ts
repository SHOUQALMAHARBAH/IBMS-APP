import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";
import { expectNone } from "./support/anchored";

/*
 * THE NARROW EMPLOYEE REVEAL SEARCH — IMPROVEMENTS § 1.83.
 *
 * `employee.national-id.reveal` is held by COMPLIANCE_OFFICER alone, and that role holds no
 * `employee.read` — so both employee screens 403 for it and the reveal was unusable by its only holder.
 * The owner refused granting Compliance the read and refused leaving it broken; this screen is the narrow
 * answer, and her four conditions are what these tests assert.
 *
 * Note the API path is named EXACTLY (`http://localhost:4000/employees/search**`) rather than by a
 * wildcard: `**\/employees**` would also intercept this screen's own navigation to `/employees/reveal` and
 * serve JSON as the document, which renders as a page of raw text with no heading and no error — the trap
 * the insurance-lines screen hit (§ 1.78).
 */

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
    route.fulfill({
      status: 200,
      json: { ...ME_BASE, roles, permissions: permissionsForRoles(roles) },
    }),
  );
}

/** Two people of the same family name — the case the disambiguation fields exist for. */
const RESULTS = [
  {
    id: "emp-1",
    fullName: "أحمد ناصر كريم الزعبي",
    fullNameEn: "Ahmad Nasser Karim Al-Zoubi",
    position: "Underwriting Assistant",
    isCurrentEmployee: true,
  },
  {
    id: "emp-2",
    fullName: "أحمد سامي كريم الزعبي",
    fullNameEn: "Ahmad Sami Karim Al-Zoubi",
    position: "Claims Clerk",
    isCurrentEmployee: false,
  },
];

async function mockSearch(page: Page, rows: unknown[], status = 200) {
  await page.route("http://localhost:4000/employees/search**", (route) =>
    route.fulfill({
      status,
      json: status === 200 ? rows : { message: "no" },
    }),
  );
}

test("finds a named person and shows only what distinguishes them", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockSearch(page, RESULTS);
  await page.goto("/employees/reveal");

  await expect(
    page.getByRole("heading", { name: "Reveal an employee's national ID" }),
  ).toBeVisible();

  // NOTHING SEARCHED YET is its own state — not an empty table. An empty table under a fresh search box
  // reads as "there are no employees", which is a claim this screen is not entitled to make.
  await expect(page.getByTestId("emp-reveal-idle")).toBeVisible();
  await expectNone(
    page.getByTestId("emp-reveal-results"),
    page.getByTestId("emp-reveal-idle"),
  );

  await page.getByLabel("Employee name").fill("Al-Zoubi");
  await page.getByRole("button", { name: "Search" }).click();

  const row = page.getByTestId("emp-reveal-row-emp-1");
  await expect(row).toContainText("Ahmad Nasser Karim Al-Zoubi");
  // The two disambiguators, which is the whole of condition 2: the job title, and whether they still work
  // here. Two people of one family name are told apart by these and nothing else.
  await expect(row).toContainText("Underwriting Assistant");
  await expect(row).toContainText("Currently employed");
  await expect(page.getByTestId("emp-reveal-row-emp-2")).toContainText(
    "No longer employed",
  );
  // And the idle state is gone once a search has run.
  await expect(page.getByTestId("emp-reveal-idle")).toHaveCount(0);
});

test("will not search on one character, and does not send a request it knows is refused", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  let requests = 0;
  await page.route("http://localhost:4000/employees/search**", (route) => {
    requests += 1;
    return route.fulfill({ status: 200, json: RESULTS });
  });
  await page.goto("/employees/reveal");

  const button = page.getByRole("button", { name: "Search" });
  // The owner's condition 1, on the screen half. The server enforces the two-character floor regardless;
  // this asserts the screen does not make a 400 the normal way to discover the rule.
  await expect(button).toBeDisabled();
  await page.getByLabel("Employee name").fill("a");
  await expect(button).toBeDisabled();
  await page.getByLabel("Employee name").fill("   ");
  // Whitespace-only is the case that matters — it LOOKS like a term and, untrimmed, matches everyone.
  await expect(button).toBeDisabled();
  await page.getByLabel("Employee name").fill("Al-Zoubi");
  await expect(button).toBeEnabled();

  // Nothing was requested while the term was too short. This is the assertion that proves the disabled
  // button is doing work rather than being decorative.
  expect(requests).toBe(0);
});

test("says nobody matched, which is not the same as nothing searched", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockSearch(page, []);
  await page.goto("/employees/reveal");

  await page.getByLabel("Employee name").fill("Nobody");
  await page.getByRole("button", { name: "Search" }).click();

  await expect(page.getByTestId("emp-reveal-no-matches")).toBeVisible();
  // The two empty states are DIFFERENT elements, so a screen that collapsed them into one blank space
  // fails here. "No employee by that name" and "type a name to begin" are different facts.
  await expect(page.getByTestId("emp-reveal-idle")).toHaveCount(0);
});

test("reveals only after a reason of at least ten characters", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockSearch(page, RESULTS);
  let revealBody: Record<string, unknown> | null = null;
  await page.route(
    "http://localhost:4000/employees/emp-1/reveal-field",
    (route) => {
      revealBody = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({
        status: 201,
        json: { field: "nationalId", value: "9881234567" },
      });
    },
  );
  await page.goto("/employees/reveal");
  await page.getByLabel("Employee name").fill("Al-Zoubi");
  await page.getByRole("button", { name: "Search" }).click();

  await page.getByTestId("emp-reveal-start-emp-1").click();
  const confirm = page.getByTestId("emp-reveal-confirm-emp-1");
  // NINE characters, not zero — a test that only types nothing cannot tell a ten-character floor from a
  // non-empty check. The reason field IS the confirmation step; there is no separate "are you sure".
  await page
    .getByLabel("Reason for revealing (at least ten characters)")
    .fill("AML file ");
  await expect(confirm).toBeDisabled();
  await page
    .getByLabel("Reason for revealing (at least ten characters)")
    .fill("  AML file review for this employee  ");
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(page.getByTestId("emp-reveal-value-emp-1")).toContainText(
    "9881234567",
  );
  // TRIMMED on the way out, so a reason of spaces cannot satisfy a server-side floor either.
  expect(revealBody).toEqual({
    field: "nationalId",
    reason: "AML file review for this employee",
  });
});

test("a new search drops an already-revealed national ID", async ({ page }) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockSearch(page, RESULTS);
  await page.route(
    "http://localhost:4000/employees/emp-1/reveal-field",
    (route) =>
      route.fulfill({
        status: 201,
        json: { field: "nationalId", value: "9881234567" },
      }),
  );
  await page.goto("/employees/reveal");
  await page.getByLabel("Employee name").fill("Al-Zoubi");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByTestId("emp-reveal-start-emp-1").click();
  await page
    .getByLabel("Reason for revealing (at least ten characters)")
    .fill("AML file review for this employee");
  await page.getByTestId("emp-reveal-confirm-emp-1").click();
  await expect(page.getByTestId("emp-reveal-value-emp-1")).toBeVisible();

  // A plaintext national ID left on screen beside a DIFFERENT person's name is worse than making somebody
  // reveal again. Anchored on the row still being present, so the absence cannot pass on an unmounted page.
  await page.getByLabel("Employee name").fill("Al-Zoubi again");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByTestId("emp-reveal-row-emp-1")).toBeVisible();
  await expect(page.getByTestId("emp-reveal-value-emp-1")).toHaveCount(0);
});

test("a role without the grant gets a sentence, not a search box", async ({
  page,
}) => {
  // BRANCH_DEPARTMENT_MANAGER holds `employee.read` and NOT the reveal — the mirror image of Compliance,
  // which is what makes this assert the right permission rather than any permission.
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await page.goto("/employees/reveal");

  // Scoped to `main`: Next renders its own route announcer with `role="alert"`, so a page-wide
  // `getByRole("alert")` is a strict-mode violation rather than a failing assertion. Recorded trap,
  // and it fired here on the first run.
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "employee.national-id.reveal",
  );
  // The reader came to this page FOR the capability being refused, so naming the missing grant helps.
  await expectNone(
    page.getByLabel("Employee name"),
    page.getByRole("heading", { name: "Reveal an employee's national ID" }),
  );
});

test("@a11y the reveal search has no serious accessibility violations", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockSearch(page, RESULTS);
  await page.goto("/employees/reveal");
  await page.getByLabel("Employee name").fill("Al-Zoubi");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByTestId("emp-reveal-row-emp-1")).toBeVisible();
  await page.getByTestId("emp-reveal-start-emp-1").click();

  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
