import { expect, test, type Page } from "@playwright/test";
import { permissionsForRoles } from "./fixtures/role-permissions";
import { expectNone } from "./support/anchored";

/**
 * PART 4 STEP 6 — the self-approval report on screen, which is the shipping gate for COMBINED mode.
 *
 * The API spec proves the ORDERING against a real database. This proves the part only a browser can: that the
 * access row is FLAGGED and not merely first, that "nobody has done this" and "the report could not be read"
 * are different things on the page, and that one half failing does not blank the other.
 *
 * The empty state lives here rather than in the api e2e on purpose: db-test is cumulative and an office with
 * no declared acts is a state that database cannot be in, so the only place that claim can be tested honestly
 * is where the response is constructed.
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
  dutySegregationMode: "SEGREGATED",
};

/** The silent-self-approval scan, which should always find nothing. Mocked minimally so the page renders. */
const SCAN = {
  generatedAt: "2026-09-26T08:00:00.000Z",
  pairsScanned: 16,
  totalRowsChecked: 512,
  violations: [],
  // `byPair`, not `pairs`, and every field the table reads. A mock whose SHAPE differs from the endpoint's
  // crashes the component — which surfaces as Chrome's own "This page couldn't load", not a React error
  // boundary, and looks nothing like a wrong fixture. Third time this project has been bitten by it.
  byPair: [
    {
      entityType: "KYCRecord",
      pairLabel: "createdByUserId / approvedByUserId",
      rowsChecked: 40,
      violationCount: 0,
      dbCheckConstraint: "KYCRecord_maker_checker_distinct",
      dormant: false,
      truncated: false,
    },
  ],
};

const ACCESS_ROW = {
  id: "act-access",
  actorUserId: "user-9",
  actorName: "Shouq Al Maharbah",
  at: "2026-03-01T09:00:00.000Z",
  entity: "AccessRecertificationItem",
  entityId: "item-1",
  pair: "AccessRecertificationItem_maker_checker_distinct",
  reason: "The only person in this office reviewed her own access.",
  roles: ["OFFICE_ADMINISTRATOR", "BRANCH_DEPARTMENT_MANAGER"],
  hatAmbiguous: true,
  accessSelfReview: true,
};
const REFUND_ROW = {
  id: "act-refund",
  actorUserId: "user-9",
  actorName: "Shouq Al Maharbah",
  // NEWER than the access row on purpose: the page must render what the API ordered, not re-sort by date.
  at: "2026-09-20T09:00:00.000Z",
  entity: "Refund",
  entityId: "refund-1",
  pair: "Refund_maker_checker_distinct",
  reason: "The owner raised and approved this refund herself.",
  roles: ["BRANCH_DEPARTMENT_MANAGER"],
  hatAmbiguous: false,
  accessSelfReview: false,
};

async function mockReport(
  page: Page,
  opts: {
    rows?: unknown[];
    declaredStatus?: number;
    scanStatus?: number;
    office?: Record<string, unknown>;
  } = {},
) {
  const roles = ["COMPLIANCE_OFFICER"];
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fake-access-token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      status: 200,
      json: { ...ME_BASE, roles, permissions: permissionsForRoles(roles) },
    }),
  );
  await page.route(
    "http://localhost:4000/internal-controls/self-approval-audit**",
    (route) =>
      route.fulfill({
        status: opts.scanStatus ?? 200,
        json: opts.scanStatus && opts.scanStatus >= 400 ? { message: "scan down" } : SCAN,
      }),
  );
  await page.route(
    "http://localhost:4000/internal-controls/combined-duty-acts**",
    (route) => {
      if (opts.declaredStatus && opts.declaredStatus >= 400) {
        return route.fulfill({
          status: opts.declaredStatus,
          json: { message: "the report could not be produced" },
        });
      }
      const rows = opts.rows ?? [];
      return route.fulfill({
        status: 200,
        json: {
          office: opts.office ?? {
            mode: "SEGREGATED",
            declaredAt: null,
            declaredByUserId: null,
            declaredByName: null,
          },
          rows,
          accessSelfReviewCount: rows.filter(
            (r) => (r as { accessSelfReview: boolean }).accessSelfReview,
          ).length,
          totalCount: rows.length,
          truncated: false,
        },
      });
    },
  );
}

test.describe("the self-approval report", () => {
  test("the access self-review is FLAGGED and rendered first, above a newer refund", async ({
    page,
  }) => {
    // The API returns them already ordered. The page must not re-sort — so the fixture lists them in the
    // API's order with the refund newer, and the assertion is about what a reader sees top to bottom.
    await mockReport(page, {
      rows: [ACCESS_ROW, REFUND_ROW],
      office: {
        mode: "COMBINED",
        declaredAt: "2026-02-01T09:00:00.000Z",
        declaredByUserId: "user-1",
        declaredByName: "Office Administrator",
      },
    });
    await page.goto("/internal-controls");

    const rows = page.getByTestId(/^declared-row/);
    await expect(rows.first()).toBeVisible();
    // FLAGGED, not merely positioned: a position is something a reader re-sorts away, and the requirement
    // says the row has to be marked as the highest-attention one.
    await expect(page.getByTestId("access-flag")).toBeVisible();
    await expect(page.getByTestId("access-flag")).toContainText(
      "Reviewed their own access",
    );

    // First row is the access one; both are present. Order asserted through the DOM, which is what a person
    // actually reads.
    await expect(rows.first()).toHaveAttribute(
      "data-testid",
      "declared-row-access",
    );
    await expect(page.getByText("reviewed her own access")).toBeVisible();
    await expect(page.getByText("approved this refund herself")).toBeVisible();

    // "We cannot tell which hat" surfaced rather than hidden behind a picked-first role.
    await expect(page.getByText("more than one role grants this")).toBeVisible();

    // The office's posture beside the acts, and WHO declared it.
    await expect(page.getByTestId("declared-office-mode")).toContainText(
      "one person may perform both halves",
    );
    await expect(page.getByTestId("declared-office-mode")).toContainText(
      "Office Administrator",
    );
  });

  test('"nobody has done this" is not the same as "the report failed"', async ({
    page,
  }) => {
    await mockReport(page, { rows: [] });
    await page.goto("/internal-controls");

    const empty = page.getByTestId("declared-empty");
    await expect(empty).toContainText("No declared self-approvals");
    // No rows, no error — anchored on the empty statement so the absence cannot be satisfied by a page that
    // never rendered.
    await expectNone(page.getByTestId(/^declared-row/), empty);
    await expect(page.getByTestId("declared-office-mode")).toContainText(
      "Nobody has declared this explicitly",
    );
  });

  test("the report failing does not blank the scan, and says so in its own words", async ({
    page,
  }) => {
    await mockReport(page, { declaredStatus: 500 });
    await page.goto("/internal-controls");

    // Its own error, in the API's words — and the section that still works is still there. Two questions,
    // two answers: a reviewer needs whichever half is available.
    const section = page.getByTestId("declared-acts");
    await expect(section.getByRole("alert")).toContainText(
      "could not be produced",
    );
    await expect(page.getByText("Pairs scanned")).toBeVisible();
  });
});
