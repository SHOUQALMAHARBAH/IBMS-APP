import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";

const ME_BASE = {
  id: "user-1",
  email: "dpo@ibms.test",
  fullName: "Data Protection Officer",
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

const ROWS = [
  {
    id: "dsa-1",
    vendorId: null,
    description: "Claims documents shared with a one-off external loss adjuster.",
    classification: "CONFIDENTIAL",
    channel: "ENCRYPTED_EMAIL",
    isRegulatoryChannel: false,
    requestedByUserId: "user-2",
    approvedByUserId: null,
    // The endpoint returns this now. Null: nothing has decided this request.
    combinedDutyAct: null,
    slaDueAt: "2026-09-10T00:00:00.000Z",
    decidedAt: null,
    createdAt: "2026-09-07T00:00:00.000Z",
    isApproved: false,
    isDeclined: false,
    isPending: true,
  },
];

test("lists data-sharing requests with the request form and approve/decline actions", async ({
  page,
}) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await page.route("http://localhost:4000/data-sharing-approvals**", (route) =>
    route.fulfill({ status: 200, json: ROWS }),
  );

  await page.goto("/data-sharing-approvals");
  await expect(page.getByRole("heading", { name: "Third Parties & Data Sharing" })).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Claims documents shared with a one-off external loss adjuster." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Decline" })).toBeVisible();
});

test("a user without the permission sees the translated 403 message", async ({ page }) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await page.route("http://localhost:4000/data-sharing-approvals**", (route) =>
    route.fulfill({
      status: 403,
      json: { message: "You do not hold a permission required to perform this action" },
    }),
  );

  await page.goto("/data-sharing-approvals");
  // The screen's own translated 403 copy, not the API's English message.
  // This page used to pass `err.message` straight through, so the raw
  // server string reached the user in both languages — and this test
  // asserted exactly that. The absence check is what makes it a proof:
  // without it the old behaviour satisfies the new assertion too.
  await expect(
    page.getByText("data-sharing requests", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("You do not hold a permission required", { exact: false }),
  ).toHaveCount(0);
});

test("data-sharing-approvals screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await page.route("http://localhost:4000/data-sharing-approvals**", (route) =>
    route.fulfill({ status: 200, json: ROWS }),
  );

  await page.goto("/data-sharing-approvals");
  await expect(page.getByRole("button", { name: "Approve" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
});

/*
 * THE COMBINED-DUTY ACT ON A DATA-SHARING APPROVAL — Part 4 step 5.
 *
 * `DataSharingApproval_maker_checker_distinct` requires that whoever requests an approval is not
 * whoever decides it, and **this pair guards personal data leaving the office to a third party**.
 *
 * The status cell asserts "Approved", which is only true of a two-person decision — the same shape as
 * the commission override's `(approved)` and the settlement's ` · second-approved`.
 */

/** Decided by the SAME person who requested it, with the reason they gave. */
const SELF_DECIDED = {
  id: "dsa-2",
  vendorId: null,
  description: "Policy schedules shared with a reinsurance broker.",
  classification: "CONFIDENTIAL",
  channel: "ENCRYPTED_EMAIL",
  isRegulatoryChannel: false,
  requestedByUserId: "user-2",
  approvedByUserId: "user-2",
  combinedDutyAct: {
    id: "cda-dsa-1",
    at: "2026-09-09T00:00:00.000Z",
    actorUserId: "user-2",
    reason: "Sole DPO available and the reinsurer's deadline fell inside the closure.",
    pair: "DataSharingApproval_maker_checker_distinct",
    roles: ["DATA_PROTECTION_OFFICER"],
    hatAmbiguous: false,
  },
  slaDueAt: "2026-09-10T00:00:00.000Z",
  decidedAt: "2026-09-09T00:00:00.000Z",
  createdAt: "2026-09-07T00:00:00.000Z",
  isApproved: true,
  isDeclined: false,
  isPending: false,
};

test("shows that one person both requested and approved a data-sharing decision", async ({
  page,
}) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await page.route("http://localhost:4000/data-sharing-approvals**", (route) =>
    route.fulfill({ status: 200, json: [SELF_DECIDED] }),
  );
  await page.goto("/data-sharing-approvals");

  const declared = page.getByTestId("combined-duty-sharing-dsa-2");
  await expect(declared).toContainText("DATA_PROTECTION_OFFICER");
  await expect(declared).toContainText("Sole DPO available");
  // Tied to the database rule it excuses, so the record and the constraint cannot drift apart.
  await expect(declared).toHaveAttribute(
    "data-combined-duty-pair",
    "DataSharingApproval_maker_checker_distinct",
  );
});

test("prints Approved and declares nothing when two people decided it", async ({
  page,
}) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await page.route("http://localhost:4000/data-sharing-approvals**", (route) =>
    route.fulfill({
      status: 200,
      // Requested by one person, approved by ANOTHER — the ordinary case.
      json: [{ ...SELF_DECIDED, id: "dsa-3", approvedByUserId: "user-9", combinedDutyAct: null }],
    }),
  );
  await page.goto("/data-sharing-approvals");

  // The POSITIVE claim is the anchor: the cell asserts "Approved", which is only true of a two-person
  // decision. Asserting silence alone would pass on a cell that had stopped printing anything.
  await expect(page.getByText("Approved")).toBeVisible();
  await expect(page.getByTestId("combined-duty-sharing-dsa-3")).toHaveCount(0);
});
