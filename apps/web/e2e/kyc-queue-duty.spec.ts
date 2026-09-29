import { expect, test, type Page } from "@playwright/test";
import { permissionsForRoles } from "./fixtures/role-permissions";
import type { KycQueueRecord } from "../lib/kyc/kyc-api";

/**
 * THE COMBINED-DUTY ACT ON A KYC FILE — Part 4 step 5.
 *
 * `KYCRecord_maker_checker_distinct` requires that whoever creates a KYC file is not whoever approves
 * it. In an office that declared COMBINED mode one person may do both by stating why.
 *
 * ## In scope rather than deferred, by the owner's ruling
 *
 * The money-and-screening deferral covers screening work, and **showing who performed an act and who
 * approved it is neither** — it does not touch the screening engine, does not extend it, and adds no
 * screening claim anywhere. It is the same line as the other pairs, on a record that happens to be a
 * KYC record.
 *
 * ## The first spec to render the queue at all
 *
 * `customers.spec.ts` mocks a single KYC record for the customer detail flow; nothing rendered
 * `/customers/kyc-queue`, where the approve control and the maker/checker pair actually live.
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

/** Approved by SOMEBODY ELSE — the ordinary two-person case. */
const TWO_PERSON: KycQueueRecord = {
  id: "kyc-1",
  customerId: "cust-1",
  status: "APPROVED",
  isEdd: false,
  submittedAt: "2026-09-01T00:00:00.000Z",
  createdByUserId: "user-7",
  approvedByUserId: "user-9",
  combinedDutyAct: null,
  approvedAt: "2026-09-02T00:00:00.000Z",
  nextReviewDueAt: "2027-09-02T00:00:00.000Z",
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-09-02T00:00:00.000Z",
  customer: { legalName: "Rawabi Trading Co.", customerType: "CORPORATE" },
};

/** The SAME person created and approved it, with the reason they gave. */
const SELF_APPROVED: KycQueueRecord = {
  ...TWO_PERSON,
  id: "kyc-2",
  approvedByUserId: "user-7",
  customer: { legalName: "Yarmouk Contracting", customerType: "CORPORATE" },
  combinedDutyAct: {
    id: "cda-kyc-1",
    at: "2026-09-02T00:00:00.000Z",
    actorUserId: "user-7",
    reason: "Sole compliance officer on duty during the Eid closure.",
    pair: "KYCRecord_maker_checker_distinct",
    roles: ["COMPLIANCE_OFFICER"],
    hatAmbiguous: false,
  },
};

/**
 * The EXACT list path, not a wildcard.
 *
 * `**\/kyc-records**` would also catch `/kyc-records/:id/submit` and every other action route and
 * answer them with the list shape — which is what crashed the claims detail page in the settlement
 * spec on the same day.
 */
async function mockQueue(page: Page, records: KycQueueRecord[]) {
  await page.route("http://localhost:4000/kyc-records", (route) =>
    route.fulfill({ status: 200, json: records }),
  );
  await page.route("http://localhost:4000/kyc-records?*", (route) =>
    route.fulfill({ status: 200, json: records }),
  );
}

test("shows that one person both created and approved a KYC file, and why", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockQueue(page, [SELF_APPROVED]);
  await page.goto("/customers/kyc-queue");

  const declared = page.getByTestId("combined-duty-kyc-kyc-2");
  await expect(declared).toContainText("COMPLIANCE_OFFICER");
  await expect(declared).toContainText("Sole compliance officer on duty");
  // Tied to the database rule it excuses, so the record and the constraint cannot drift apart.
  await expect(declared).toHaveAttribute(
    "data-combined-duty-pair",
    "KYCRecord_maker_checker_distinct",
  );
});

test("says nothing on a KYC file approved by somebody other than its creator", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockQueue(page, [TWO_PERSON]);
  await page.goto("/customers/kyc-queue");

  // Anchored on the row rendering, from the same read that would carry the act, so the absence cannot
  // pass while that read is in flight.
  await expect(page.getByText("Rawabi Trading Co.")).toBeVisible();
  await expect(page.getByTestId("combined-duty-kyc-kyc-1")).toHaveCount(0);
});
