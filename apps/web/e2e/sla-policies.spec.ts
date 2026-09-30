import { expect, test, type Page } from "@playwright/test";
import { permissionsForRoles } from "./fixtures/role-permissions";
import { expectNone } from "./support/anchored";

// Configurable SLA policies (task Part A).
//
// The behaviour worth pinning here is NOT the table markup. It is that the
// screen never presents an internal target as a legal requirement — that is
// the entire reason SLA provenance became a structured field, and a UI that
// blurs it puts the whole feature back where it started.

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

async function mockAuth(
  page: Page,
  roles: string[],
  languagePreference: "AR" | "EN" = "EN",
) {
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fake-access-token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      status: 200,
      json: { ...ME_BASE, roles, languagePreference, permissions: permissionsForRoles(roles) },
    }),
  );
}

/**
 * An EXACT permission set rather than a role's.
 *
 * `sla.policy.manage` became `.create` / `.update` / `.deactivate` plus `sla.holiday.create`, and every
 * seeded role holding the umbrella received all four. So the states where the split is observable at all
 * are ones no role name describes — which is precisely what an office creates the first time it uses the
 * Role screen. The api-side equivalent is `four-action-separability.e2e-spec.ts`.
 */
async function mockAuthWithCodes(page: Page, permissions: string[]) {
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fake-access-token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      status: 200,
      json: { ...ME_BASE, roles: ["COMPLIANCE_OFFICER"], permissions },
    }),
  );
}

function policy(over: Record<string, unknown> = {}) {
  return {
    id: "p-1",
    policyCode: "SLA-DSR-ACCESS-DELETION",
    policyName: "DSR — Access / Deletion",
    processType: "dsr_access_deletion",
    workflowState: null,
    description: null,
    durationValue: 15,
    durationUnit: "BUSINESS_DAYS",
    calendarType: "JORDAN_STANDARD",
    customWeekendDays: [],
    workingHoursStart: null,
    workingHoursEnd: null,
    timezone: "Asia/Amman",
    sourceType: "REGULATORY",
    sourceReference: "DSR — Access / Deletion (M04)",
    sourceDocument: "PRIV-STD-01",
    sourceSection: "§6.4",
    isRegulatory: true,
    sourceLabel: "Regulatory — PRIV-STD-01 §6.4",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: null,
    escalationEnabled: true,
    warningThreshold: 0.8,
    status: "ACTIVE",
    escalations: [],
    createdByUserId: "system",
    updatedByUserId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

const internalPolicy = policy({
  id: "p-2",
  policyCode: "SLA-SANCTIONS-MATCH-REVIEW",
  policyName: "Sanctions match review (Compliance adjudication)",
  processType: "sanctions_match_review",
  durationValue: 3,
  sourceType: "INTERNAL_POLICY",
  sourceReference: null,
  sourceDocument: null,
  sourceSection: null,
  isRegulatory: false,
  sourceLabel: "Internal policy",
});

async function mockPolicies(page: Page, rows: Record<string, unknown>[]) {
  await page.route("**/sla/policies*", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({ status: 200, json: rows });
  });
  // The screen now also loads the non-working-day calendar, so every test needs
  // it mocked or the request escapes to a server that is not running and the
  // section renders a load error over the policies the test is about.
  await mockHolidays(page, []);
}

function holidayRow(over: Record<string, unknown> = {}) {
  return {
    id: "hol-1",
    observedOn: "2026-05-25T00:00:00.000Z",
    name: "Independence Day",
    calendarType: null,
    createdByUserId: "user-1",
    createdAt: "2026-01-02T00:00:00.000Z",
    ...over,
  };
}

const ALL_OCCASIONS = [
  { key: "islamic_new_year", nameEn: "Islamic New Year", nameAr: "رأس السنة الهجرية", days: 1 },
  { key: "prophets_birthday", nameEn: "Prophet's Birthday", nameAr: "المولد النبوي الشريف", days: 1 },
  { key: "eid_al_fitr", nameEn: "Eid al-Fitr", nameAr: "عيد الفطر", days: 4 },
  { key: "eid_al_adha", nameEn: "Eid al-Adha", nameAr: "عيد الأضحى", days: 5 },
];

const ALL_FIXED = [
  { nameEn: "New Year's Day", nameAr: "رأس السنة الميلادية", observedOn: "2026-01-01" },
  { nameEn: "Labour Day", nameAr: "عيد العمال", observedOn: "2026-05-01" },
  { nameEn: "Independence Day", nameAr: "عيد الاستقلال", observedOn: "2026-05-25" },
  { nameEn: "Christmas", nameAr: "عيد الميلاد المجيد", observedOn: "2026-12-25" },
];

/** The calendar is read PER YEAR, because the Islamic occasions are entered from each
 * year's official announcement rather than computed. Re-routable: a later `page.route`
 * for the same pattern wins, so a test can override the default. */
async function mockHolidays(
  page: Page,
  rows: Record<string, unknown>[],
  over: Partial<{ missingFixed: unknown[]; missingOccasions: unknown[] }> = {},
) {
  await page.route("http://localhost:4000/sla/holidays/year/*", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({
      status: 200,
      json: {
        year: 2026,
        holidays: rows,
        missingFixed: over.missingFixed ?? (rows.length === 0 ? ALL_FIXED : []),
        missingOccasions: over.missingOccasions ?? ALL_OCCASIONS,
      },
    });
  });
}

/** The two per-year writes, captured so assertions are about the wire. */
async function captureYearWrites(page: Page) {
  const calls: { url: string; body: unknown }[] = [];
  for (const pattern of [
    "http://localhost:4000/sla/holidays/year/*/fixed",
    "http://localhost:4000/sla/holidays/occasion",
  ]) {
    await page.route(pattern, (route) => {
      calls.push({
        url: route.request().url(),
        body: route.request().postDataJSON(),
      });
      return route.fulfill({ status: 201, json: { created: [], skipped: 0 } });
    });
  }
  return calls;
}

/** Every POST to the calendar, captured so an assertion is about the wire. */
async function captureHolidayPosts(page: Page, status = 201) {
  const calls: { body: unknown }[] = [];
  await page.route("http://localhost:4000/sla/holidays", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    calls.push({ body: route.request().postDataJSON() });
    return route.fulfill({
      status,
      json:
        status === 409
          ? { message: "2026-05-25 is already recorded as a non-working day for every calendar." }
          : holidayRow(),
    });
  });
  return calls;
}

/*
 * DEFINING AN SLA POLICY — `POST /sla/policies`, which had no web caller, so an office could edit
 * the duration of a seeded policy and never state a target of its own.
 *
 * The load-bearing property is `sourceType`. REGULATORY claims LEGAL force, and the API gates the
 * whole route on `sla.policy.create` alone while changing an EXISTING policy's source type needs
 * `sla.policy.regulatory` on top — so two roles can create as REGULATORY what they could not
 * change to REGULATORY. The server is deliberately not tightened (a refusal change on a route
 * with a passing e2e); the FORM is what keeps the two paths consistent, which is why these tests
 * drive it through exact permission sets rather than role names.
 */

test("offers the create form only where sla.policy.create is held", async ({ page }) => {
  await mockAuthWithCodes(page, ["sla.policy.read"]);
  await mockPolicies(page, [policy()]);
  await page.goto("/sla-policies");

  // Anchored on the list rendering, so the absence is not satisfied by a page that never mounted.
  await expect(page.getByText("DSR — Access / Deletion")).toBeVisible();
  await expect(page.getByTestId("new-sla-policy-open")).toHaveCount(0);

  await mockAuthWithCodes(page, ["sla.policy.read", "sla.policy.create"]);
  await page.goto("/sla-policies");
  await expect(page.getByTestId("new-sla-policy-open")).toBeVisible();
});

test("the create form sits ABOVE the list it adds to", async ({ page }) => {
  // B.7 rule 1. A create form below its own table is a control the reader scrolls past, and four
  // screens were fixed for exactly this.
  await mockAuthWithCodes(page, ["sla.policy.read", "sla.policy.create"]);
  await mockPolicies(page, [policy()]);
  await page.goto("/sla-policies");

  const form = await page.getByTestId("new-sla-policy-open").boundingBox();
  const table = await page.getByRole("table").first().boundingBox();
  expect(form).not.toBeNull();
  expect(table).not.toBeNull();
  expect(form!.y).toBeLessThan(table!.y);
});

test("sends the policy, with an untouched optional field absent rather than empty", async ({
  page,
}) => {
  await mockAuthWithCodes(page, ["sla.policy.read", "sla.policy.create"]);
  await mockPolicies(page, [policy()]);

  let body: unknown = null;
  await page.route("**/sla/policies", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    body = route.request().postDataJSON();
    return route.fulfill({ status: 201, json: policy() });
  });
  await page.goto("/sla-policies");

  await page.getByTestId("new-sla-policy-open").click();
  await page.getByTestId("new-sla-code").fill("sla-quote-response");
  await page.getByTestId("new-sla-name").fill("  Quote response  ");
  await page.getByTestId("new-sla-process").fill("rfq_response");
  await page.getByTestId("new-sla-duration").fill("2");
  await page.getByTestId("new-sla-save").click();

  await expect(page.getByTestId("new-sla-policy-form")).toHaveCount(0);
  expect(body).toMatchObject({
    // Upper-cased for the server's pattern rather than 422'd back at the reader.
    policyCode: "SLA-QUOTE-RESPONSE",
    policyName: "Quote response",
    processType: "rfq_response",
    durationValue: 2,
    durationUnit: "BUSINESS_DAYS",
    sourceType: "INTERNAL_POLICY",
  });
  // An untouched optional field must be ABSENT, never ''. An empty string would store a workflow
  // state of "" instead of meaning "the whole process".
  expect(body).not.toHaveProperty("workflowState");
  expect(body).not.toHaveProperty("description");
});

test("does NOT offer REGULATORY without sla.policy.regulatory, and says why", async ({
  page,
}) => {
  // Measured: BRANCH_DEPARTMENT_MANAGER and EXECUTIVE_MANAGEMENT hold `sla.policy.create` and NOT
  // `sla.policy.regulatory` — so on the API they cannot change a policy to REGULATORY and could
  // create one that way. The form is what closes that.
  await mockAuthWithCodes(page, ["sla.policy.read", "sla.policy.create"]);
  await mockPolicies(page, [policy()]);
  await page.goto("/sla-policies");

  await page.getByTestId("new-sla-policy-open").click();
  const sourceType = page.getByTestId("new-sla-source-type");
  // Anchored on an option that IS offered, so "no REGULATORY option" cannot pass on an empty
  // select that never rendered.
  await expect(
    sourceType.getByRole("option", { name: "INTERNAL_POLICY" }),
  ).toHaveCount(1);
  await expect(
    sourceType.getByRole("option", { name: "REGULATORY" }),
  ).toHaveCount(0);
  // Silence would read as "there is no such thing". The reader came here to state a target and
  // needs to know which grant they lack.
  await expect(page.getByTestId("new-sla-regulatory-note")).toContainText(
    "sla.policy.regulatory",
  );
});

test("REGULATORY demands BOTH citations before it will save", async ({ page }) => {
  await mockAuthWithCodes(page, [
    "sla.policy.read",
    "sla.policy.create",
    "sla.policy.regulatory",
  ]);
  await mockPolicies(page, [policy()]);
  await page.goto("/sla-policies");

  await page.getByTestId("new-sla-policy-open").click();
  await page.getByTestId("new-sla-code").fill("SLA-BREACH-NOTIFY");
  await page.getByTestId("new-sla-name").fill("Breach notification");
  await page.getByTestId("new-sla-process").fill("breach_notification");
  await page.getByTestId("new-sla-duration").fill("72");
  await page.getByTestId("new-sla-unit").selectOption("HOURS");

  await page.getByTestId("new-sla-source-type").selectOption("REGULATORY");
  await expect(page.getByTestId("new-sla-regulatory-warning")).toContainText(
    "naming the instrument",
  );
  await expect(page.getByTestId("new-sla-save")).toBeDisabled();

  // ONE citation at a time. Filling both at once cannot tell "both are required" from "one is" —
  // the same reason the insurance-line form asserts the English-only case is refused.
  await page.getByTestId("new-sla-source-reference").fill("PDPL 24/2023 art. 27");
  await expect(page.getByTestId("new-sla-save")).toBeDisabled();

  await page.getByTestId("new-sla-source-document").fill("PRIV-STD-01");
  await expect(page.getByTestId("new-sla-save")).toBeEnabled();
});

test("marks an internal SLA as NOT a legal requirement", async ({ page }) => {
  // The 3-business-day sanctions-match figure: drafted in this repo, tighter
  // than the standard KYC review, on reasoning that is the broker's and not a
  // regulator's. It must never read as law.
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockPolicies(page, [internalPolicy]);

  await page.goto("/sla-policies");

  await expect(
    page.getByText("Sanctions match review", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Internal policy", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Not a legal requirement")).toBeVisible();
  await expect(page.locator('[data-regulatory="false"]')).toHaveCount(1);
});

test("shows a regulatory SLA with the instrument that requires it", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockPolicies(page, [policy()]);

  await page.goto("/sla-policies");

  await expect(page.getByText("Regulatory — PRIV-STD-01 §6.4")).toBeVisible();
  await expect(page.locator('[data-regulatory="true"]')).toHaveCount(1);
  // A regulatory row must NOT carry the internal disclaimer.
  await expect(page.getByText("Not a legal requirement")).toHaveCount(0);
});

test("distinguishes the two side by side", async ({ page }) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockPolicies(page, [policy(), internalPolicy]);

  await page.goto("/sla-policies");

  await expect(page.locator('[data-regulatory="true"]')).toHaveCount(1);
  await expect(page.locator('[data-regulatory="false"]')).toHaveCount(1);
});

test("shows business days as the unit, not raw hours", async ({ page }) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockPolicies(page, [policy()]);

  await page.goto("/sla-policies");

  // SCOPED to the policies table, not weakened. This test is about the DURATION
  // rendering as a unit rather than raw hours, and the phrase now also appears in
  // the non-working-days section's own intro ("every deadline measured in business
  // days is counted against this calendar") — a second legitimate match, which
  // makes a page-wide query ambiguous rather than wrong.
  await expect(
    page.getByRole("table").first().getByText("business days"),
  ).toBeVisible();
});

test("a read-only role sees the policies but cannot edit them", async ({
  page,
}) => {
  await mockAuth(page, ["EXTERNAL_AUDITOR"]);
  await mockPolicies(page, [policy()]);

  await page.goto("/sla-policies");

  await expect(page.getByText("DSR — Access / Deletion")).toBeVisible();
  await expect(page.getByText("Read only")).toBeVisible();
  await expect(page.getByRole("button", { name: "Deactivate" })).toHaveCount(0);
});

test("the update code alone offers Save and NOT the off switch", async ({
  page,
}) => {
  // Four-action Phase 4, owner-ruled. No ROLE NAME can express "may correct a deadline, may not switch
  // the SLA off" — every seeded role that held the umbrella received all four successors — so this mocks
  // an exact permission set, the same reason `payment-channels.spec.ts` does.
  await mockAuthWithCodes(page, ["sla.policy.read", "sla.policy.update"]);
  await mockPolicies(page, [policy()]);

  await page.goto("/sla-policies");

  // The anchor, asserted first: the write control this role DOES hold rendered. Without it the absence
  // below is satisfied by a page that never hydrated.
  await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
  await expectNone(
    page.getByRole("button", { name: "Deactivate" }),
    page.getByRole("button", { name: "Save" }),
  );
});

test("the deactivate code alone offers the off switch and NOT Save", async ({
  page,
}) => {
  // The inverse, and the direction that would go unnoticed: a deactivate code quietly carrying the edit
  // is the umbrella surviving under a narrower name.
  await mockAuthWithCodes(page, ["sla.policy.read", "sla.policy.deactivate"]);
  await mockPolicies(page, [policy()]);

  await page.goto("/sla-policies");

  await expect(page.getByRole("button", { name: "Deactivate" })).toBeVisible();
  await expectNone(
    page.getByRole("button", { name: "Save" }),
    page.getByRole("button", { name: "Deactivate" }),
  );
});

test("surfaces a permission failure rather than an empty list", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("**/sla/policies*", (route) =>
    route.fulfill({ status: 403, json: { message: "Forbidden" } }),
  );

  await page.goto("/sla-policies");

  await expect(
    page.getByRole("alert").filter({ hasText: "sla.policy.read" }),
  ).toBeVisible();
  await expect(page.getByText("No policies.")).toHaveCount(0);
});

/*
 * THE NON-WORKING-DAY CALENDAR — `GET`/`POST /sla/holidays`, which had no web
 * caller at all (IMPROVEMENTS § 1.44, § 1.57).
 *
 * The empty state is the interesting one and it is not an empty state: the dev
 * database holds zero holiday rows, so every business-day deadline in the system
 * is computed as though Fridays were the only non-working days of the year, and
 * the resulting figures overstate the brokerage's lateness against itself.
 */

test("says plainly that an EMPTY calendar makes every business-day deadline wrong", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockPolicies(page, [internalPolicy]);

  await page.goto("/sla-policies");
  // Anchor: the section rendered at all.
  await expect(page.getByTestId("sla-holidays")).toBeVisible();

  const warning = page.getByTestId("sla-holidays-empty-warning");
  await expect(warning).toBeVisible();
  // The DIRECTION of the error is the part that matters to the owner, so it is
  // asserted rather than just the presence of a warning.
  await expect(warning).toContainText("overstate lateness");
});

test("does NOT warn once the calendar has days in it", async ({ page }) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockPolicies(page, [internalPolicy]);
  await mockHolidays(page, [holidayRow()]);

  await page.goto("/sla-policies");
  // Positive anchor from the same render before asserting the absence.
  await expect(page.getByTestId("sla-holiday-hol-1")).toContainText(
    "Independence Day",
  );
  await expect(page.getByTestId("sla-holidays-empty-warning")).toHaveCount(0);
  // Rendered as the stored UTC day, never shifted by a local-time conversion.
  await expect(page.getByTestId("sla-holiday-hol-1")).toContainText(
    "2026-05-25",
  );
  await expect(page.getByTestId("sla-holiday-hol-1")).toContainText(
    "All calendars",
  );
});

test("records a non-working day, defaulting to every calendar", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockPolicies(page, [internalPolicy]);
  const calls = await captureHolidayPosts(page);

  await page.goto("/sla-policies");
  const add = page.getByTestId("sla-holiday-add");
  // Neither field filled: the button must not send a request the DTO refuses.
  await expect(add).toBeDisabled();

  await page.getByTestId("sla-holiday-date").fill("2026-05-25");
  await expect(add).toBeDisabled(); // a date with no occasion is still refused
  await page.getByTestId("sla-holiday-name").fill("  Independence Day  ");
  await expect(add).toBeEnabled();
  await add.click();

  await expect.poll(() => calls.length).toBe(1);
  // No `calendarType` at all rather than a null: omitted means every calendar,
  // and the DTO whitelist refuses a field it does not declare.
  expect(calls[0].body).toEqual({
    observedOn: "2026-05-25",
    name: "Independence Day",
  });
});

test("sends the named calendar when one is chosen", async ({ page }) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockPolicies(page, [internalPolicy]);
  const calls = await captureHolidayPosts(page);

  await page.goto("/sla-policies");
  await page.getByTestId("sla-holiday-date").fill("2026-05-25");
  await page.getByTestId("sla-holiday-name").fill("Office closure");
  await page.getByTestId("sla-holiday-calendar").selectOption("CUSTOM");
  await page.getByTestId("sla-holiday-add").click();

  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0].body).toEqual({
    observedOn: "2026-05-25",
    name: "Office closure",
    calendarType: "CUSTOM",
  });
});

test("shows the API's own sentence when the day is already recorded", async ({
  page,
}) => {
  // A duplicate used to be an unhandled P2002 and a 500. Two people working from
  // the same published holiday list is ordinary, and "the system is broken" is
  // the wrong thing to tell the second one.
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockPolicies(page, [internalPolicy]);
  await captureHolidayPosts(page, 409);

  await page.goto("/sla-policies");
  await page.getByTestId("sla-holiday-date").fill("2026-05-25");
  await page.getByTestId("sla-holiday-name").fill("Independence Day");
  await page.getByTestId("sla-holiday-add").click();

  await expect(page.getByTestId("sla-holiday-add-error")).toContainText(
    "already recorded as a non-working day",
  );
});

test("a reader without sla.holiday.create sees the calendar and no form", async ({
  page,
}) => {
  // The External Auditor holds sla.policy.read and not sla.holiday.create.
  await mockAuthWithCodes(page, ["sla.policy.read"]);
  await mockPolicies(page, [internalPolicy]);
  await mockHolidays(page, [holidayRow()]);

  await page.goto("/sla-policies");
  // Anchor: they can read the calendar.
  await expect(page.getByTestId("sla-holiday-hol-1")).toBeVisible();
  await expect(page.getByTestId("sla-holiday-add")).toHaveCount(0);
  await expect(page.getByText("sla.holiday.create")).toBeVisible();
});

test("names what the year still owes, in occasions and in days", async ({ page }) => {
  // THE POINT OF THE PER-YEAR VIEW. Jordan's Islamic holidays are set by official
  // announcement and can differ by a day from any calendar conversion, so the system
  // does not compute them — which means an office has to be TOLD which ones it has not
  // entered. A calendar that only lists what is present cannot say that.
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockPolicies(page, [internalPolicy]);
  await mockHolidays(page, [holidayRow()]);

  await page.goto("/sla-policies");
  await expect(page.getByTestId("sla-holiday-year-owes")).toBeVisible();

  // The LENGTHS are shown, because an officer entering Eid al-Adha has to know it is
  // five days and not four.
  await expect(page.getByTestId("sla-holiday-missing-eid_al_adha")).toContainText(
    "5 days",
  );
  await expect(page.getByTestId("sla-holiday-missing-eid_al_fitr")).toContainText(
    "4 days",
  );
  await expect(page.getByTestId("sla-holiday-missing-islamic_new_year")).toContainText(
    "1 days",
  );
});

test("fills the four fixed dates for the selected year in one action", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockPolicies(page, [internalPolicy]);
  await mockHolidays(page, []);
  const calls = await captureYearWrites(page);

  await page.goto("/sla-policies");
  await expect(page.getByTestId("sla-holiday-add-fixed")).toBeEnabled();
  await page.getByTestId("sla-holiday-add-fixed").click();

  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0].url).toContain("/fixed");
});

test("enters a moving occasion from its FIRST day only", async ({ page }) => {
  // Only the start date is collected. The server supplies the length from the
  // occasion, so a five-day Eid cannot be entered as four by a screen that forgot —
  // and no date is ever computed from a Hijri conversion.
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockPolicies(page, [internalPolicy]);
  await mockHolidays(page, [holidayRow()]);
  const calls = await captureYearWrites(page);

  await page.goto("/sla-policies");
  const add = page.getByTestId("sla-holiday-add-occasion");
  await expect(add).toBeDisabled();

  await page.getByTestId("sla-holiday-occasion").selectOption("eid_al_adha");
  await expect(add).toBeDisabled(); // an occasion with no date is still refused
  await page.getByTestId("sla-holiday-occasion-start").fill("2026-05-27");
  await expect(add).toBeEnabled();
  await add.click();

  await expect.poll(() => calls.length).toBe(1);
  // No `days` field: the length is a fact about the occasion, not a caller's input.
  expect(calls[0].body).toEqual({
    occasionKey: "eid_al_adha",
    startDate: "2026-05-27",
  });
});

test("says a year is complete when nothing is missing", async ({ page }) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockPolicies(page, [internalPolicy]);
  await mockHolidays(page, [holidayRow()], {
    missingFixed: [],
    missingOccasions: [],
  });

  await page.goto("/sla-policies");
  await expect(page.getByTestId("sla-holiday-year-complete")).toBeVisible();
  // Positive anchor above, so this absence cannot pass on an unrendered section.
  await expect(page.getByTestId("sla-holiday-year-owes")).toHaveCount(0);
});

test("a reader without the write code is told what is missing but cannot fill it", async ({
  page,
}) => {
  // The missing list is information an auditor wants even when they cannot act on it.
  await mockAuthWithCodes(page, ["sla.policy.read"]);
  await mockPolicies(page, [internalPolicy]);
  await mockHolidays(page, []);

  await page.goto("/sla-policies");
  await expect(page.getByTestId("sla-holiday-year-owes")).toBeVisible();
  await expect(page.getByTestId("sla-holiday-add-fixed")).toHaveCount(0);
  await expect(page.getByTestId("sla-holiday-add-occasion")).toHaveCount(0);
});

test("renders in Arabic with RTL direction", async ({ page }) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"], "AR");
  await mockPolicies(page, [internalPolicy]);

  await page.goto("/sla-policies");

  await expect(
    page.getByRole("heading", { name: "سياسات مستوى الخدمة" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  // The distinction must survive translation — this is the claim that matters.
  await expect(page.getByText("سياسة داخلية", { exact: true })).toBeVisible();
  // Scoped to the TABLE: the intro paragraph also explains what a
  // non-regulatory SLA means, so a page-wide match is ambiguous. The claim
  // being tested is that the ROW carries the disclaimer.
  await expect(
    page.locator("table").getByText("ليست إلزاماً قانونياً"),
  ).toBeVisible();
});
