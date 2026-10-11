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

const LICENSE = {
  // A uuid-shaped id, not "the-broker-license": Module 0 item (c) retired that constant, which had
  // been the table's PRIMARY KEY and therefore allowed one licence row per PLATFORM.
  id: "b1f0c0de-0000-4000-8000-000000000001",
  licenseNumber: "CBJ-2026-001",
  scopeOfAuthorization: "General insurance brokerage",
  issuedAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2027-01-01T00:00:00.000Z",
  status: "active",
  isCurrentlyLapsed: false,
  certificateDocumentId: "doc-certificate-1",
  renewalRequestedAt: null,
  // Module 0 item (d). Shaped from the endpoint: art. 11's deadline is 45 calendar days before
  // expiry, and 2027-01-01 minus 45 days is 2026-11-17.
  renewalDueBy: "2026-11-17T00:00:00.000Z",
  renewalFiledOnTime: false,
  validByOperationOfLaw: false,
  expiryIsEndOfCalendarYear: false,
  expectedExpiryForThreeYearTerm: "2028-12-31T00:00:00.000Z",
};

/*
 * THE ENVELOPE `GET /broker-license` ACTUALLY RETURNS since Module 0 item (c): the current term
 * plus the series.
 *
 * Shaped from the endpoint rather than approximated. A mock whose shape differs from the real
 * response crashes the component it feeds and surfaces as Chrome's own "This page couldn't load"
 * rather than a React error — which this project has been bitten by three times — and the screen
 * reads `series.current`, so a flat body would leave it `undefined`.
 */
const LICENSE_SERIES = { current: LICENSE, terms: [LICENSE] };

const CALENDAR_ITEMS = [
  {
    id: "item-1",
    obligationName: "Annual AML training attestation",
    ownerUserId: "user-1",
    dueDate: "2026-01-01T00:00:00.000Z",
    evidenceOfSubmissionRef: null,
    submittedAt: null,
    isSubmitted: false,
    isOverdue: true,
  },
  {
    id: "item-2",
    obligationName: "Quarterly CBJ prudential return",
    ownerUserId: "user-1",
    dueDate: "2026-12-01T00:00:00.000Z",
    evidenceOfSubmissionRef: "doc://ref-1",
    submittedAt: "2026-11-15T00:00:00.000Z",
    isSubmitted: true,
    isOverdue: false,
  },
];

async function mockRegulatoryCompliance(
  page: Page,
  opts: {
    licenseStatus?: number;
    calendarStatus?: number;
    /** Module 0 item (c) — override the series to exercise a different licence state. */
    licenseSeries?: unknown;
  } = {},
) {
  await page.route("http://localhost:4000/broker-license", (route) => {
    if (opts.licenseStatus && opts.licenseStatus !== 200) {
      return route.fulfill({
        status: opts.licenseStatus,
        json: { message: "no" },
      });
    }
    return route.fulfill({
      status: 200,
      json: opts.licenseSeries ?? LICENSE_SERIES,
    });
  });
  await page.route("http://localhost:4000/compliance-calendar**", (route) => {
    if (opts.calendarStatus && opts.calendarStatus !== 200) {
      return route.fulfill({
        status: opts.calendarStatus,
        json: { message: "no" },
      });
    }
    return route.fulfill({ status: 200, json: CALENDAR_ITEMS });
  });
}

test("shows the broker license status and the compliance calendar with the create forms", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockRegulatoryCompliance(page);

  await page.goto("/regulatory-compliance");
  await expect(
    page.getByRole("heading", { name: "Regulatory compliance" }),
  ).toBeVisible();
  await expect(page.getByText("CBJ-2026-001")).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark lapsed" })).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Annual AML training attestation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Quarterly CBJ prudential return" }),
  ).toBeVisible();
  await expect(page.getByLabel("License number")).toBeVisible();
  await expect(page.getByLabel("Obligation")).toBeVisible();
  // the overdue, unsubmitted item shows a record-submission control; the
  // already-submitted one does not
  await expect(page.getByRole("button", { name: "Record submission" })).toHaveCount(
    1,
  );
});

test("a user without either permission sees friendly messages", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockRegulatoryCompliance(page, {
    licenseStatus: 403,
    calendarStatus: 403,
  });

  await page.goto("/regulatory-compliance");
  await expect(
    page.getByText("(license.manage)", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("(compliance-calendar.manage)", { exact: false }),
  ).toBeVisible();
});

test("regulatory compliance screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockRegulatoryCompliance(page);

  await page.goto("/regulatory-compliance");
  await expect(page.getByText("CBJ-2026-001")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});

test("an office with NO licence term is told so, and told that new business is blocked", async ({
  page,
}) => {
  /*
   * Module 0 item (c). This is the state that MATTERS most on this screen and the one that could
   * not be rendered before: the route used to 404 for an office with no licence, which a reader
   * cannot tell apart from a broken page.
   *
   * It is also the state that now BLOCKS new business, so the screen has to say that rather than
   * just showing an empty panel — otherwise Compliance sees nothing wrong here and the refusal
   * surfaces later, on a placement, as an unexplained 422.
   */
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockRegulatoryCompliance(page, {
    licenseSeries: { current: null, terms: [] },
  });
  await page.goto("/regulatory-compliance");

  const alert = page.locator("main").getByRole("alert");
  await expect(alert).toContainText("no licence term on record");
  // The refusal names the REGULATION, not just the fact. A reader who is told only "no licence"
  // has to guess whether it matters.
  await expect(alert).toContainText("art. 21/a/9");

  // The form is still offered — this is a screen for fixing the problem, not only reporting it.
  await expect(
    page.getByLabel("Certificate file name", { exact: true }),
  ).toBeVisible();
});

test("the licence is a SERIES: earlier terms stay visible, with the current one marked", async ({
  page,
}) => {
  // The claim the old implementation could not satisfy. Renewal was an updateMany over one row, so
  // the previous term was erased and the office could not show a regulator what it once held.
  const previous = {
    ...LICENSE,
    id: "b1f0c0de-0000-4000-8000-000000000000",
    licenseNumber: "CBJ-2023-OLD",
    expiresAt: "2025-12-31T00:00:00.000Z",
    status: "lapsed",
    isCurrentlyLapsed: true,
  };
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockRegulatoryCompliance(page, {
    licenseSeries: { current: LICENSE, terms: [LICENSE, previous] },
  });
  await page.goto("/regulatory-compliance");

  // Scoped by test id, not by position: this screen renders three tables and `.last()`
  // silently followed the compliance calendar.
  const terms = page.getByTestId("licence-terms");
  await expect(terms.getByText("CBJ-2023-OLD")).toBeVisible();
  // Which term is in force has to be legible, not inferred from row order.
  await expect(terms.getByText(/CBJ-2026-001 \(Current term\)/)).toBeVisible();
});

test("an expiry that is not a 31 December WARNS and does not block (art. 10/b)", async ({
  page,
}) => {
  /*
   * Module 0 item (d). The requirement is precise about this: the date is entered as printed on the
   * certificate, the certificate is the authority, and the system asks a human to verify rather
   * than refusing. So the assertion is a PAIR — the warning is present AND the term is still
   * treated as usable.
   */
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockRegulatoryCompliance(page);
  await page.goto("/regulatory-compliance");

  const warning = page.locator("[data-expiry-not-end-of-year]");
  await expect(warning).toContainText("not a 31 December");
  await expect(warning).toContainText("art. 10/b");
  // Not refused: the entry stands and the licence still reads active.
  await expect(warning).toContainText("was not refused");
  await expect(page.locator("main")).toContainText("CBJ-2026-001");
});

test("an expired term with a timely application says it is still valid by operation of law (art. 11)", async ({
  page,
}) => {
  // Without this the screen would show an expiry in the past beside a licence the system is
  // content with, and explain neither.
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  const extended = {
    ...LICENSE,
    expiresAt: "2026-12-31T00:00:00.000Z",
    expiryIsEndOfCalendarYear: true,
    renewalRequestedAt: "2026-11-16T00:00:00.000Z",
    renewalFiledOnTime: true,
    validByOperationOfLaw: true,
    isCurrentlyLapsed: false,
  };
  await mockRegulatoryCompliance(page, {
    licenseSeries: { current: extended, terms: [extended] },
  });
  await page.goto("/regulatory-compliance");

  const notice = page.locator("[data-valid-by-operation-of-law]");
  await expect(notice).toContainText("by operation of law");
  await expect(notice).toContainText("art. 11");
  // And the two warnings are distinct states, not one: a 31-December expiry raises no art. 10/b
  // warning even while this one is showing.
  await expect(page.locator("[data-expiry-not-end-of-year]")).toHaveCount(0);
});

test("an application filed AFTER the deadline is called out while there is still time", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  const late = {
    ...LICENSE,
    expiresAt: "2026-12-31T00:00:00.000Z",
    expiryIsEndOfCalendarYear: true,
    renewalRequestedAt: "2026-12-20T00:00:00.000Z",
    renewalFiledOnTime: false,
    validByOperationOfLaw: false,
  };
  await mockRegulatoryCompliance(page, {
    licenseSeries: { current: late, terms: [late] },
  });
  await page.goto("/regulatory-compliance");

  const notice = page.locator("[data-renewal-filed-late]");
  await expect(notice).toContainText("after the deadline");
  // The consequence, not just the fact: the extension will not apply.
  await expect(notice).toContainText("will not remain valid");
});
