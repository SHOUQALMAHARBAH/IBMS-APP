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

/*
 * «لما نضغط ع الأزرار الموظف رح يشعر بالضياع لأن فش اشي بيظهر اله ولا كأنه عمل
 *  اشي… بس بنضغط زر وبنضيع فيه»
 * — the owner's walk, 2026-10-26, about this queue.
 *
 * The act RAN. `KycQueue.run()` calls the route, hands the updated record to the
 * parent and re-reads the screening hold — so a badge three columns away changed
 * and nothing said why. A status cell quietly becoming a different word is not a
 * statement that your action succeeded, which is the whole of what she reported.
 *
 * The request is HELD OPEN so the pending state is observable; fulfilling
 * immediately would pass against a screen that is still silent to a person.
 */
const AWAITING_SCREENING: KycQueueRecord = {
  ...TWO_PERSON,
  id: "kyc-3",
  status: "SUBMITTED",
  approvedByUserId: null,
  approvedAt: null,
  customer: { legalName: "Petra Logistics", customerType: "CORPORATE" },
};

test("states what running the screening did, and says so while it is running", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockQueue(page, [AWAITING_SCREENING]);
  await page.route(
    "http://localhost:4000/kyc-records/kyc-3/screening-hold",
    (route) =>
      route.fulfill({
        status: 200,
        json: {
          kycRecordId: "kyc-3",
          level: "NO_HOLD",
          releasable: false,
          reasons: [],
          releases: [],
          lastScreenedAt: null,
          configurationProblems: [],
        },
      }),
  );

  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "http://localhost:4000/kyc-records/kyc-3/run-screening",
    async (route) => {
      await held;
      await route.fulfill({
        status: 201,
        json: { ...AWAITING_SCREENING, status: "SCREENING" },
      });
    },
  );

  await page.goto("/customers/kyc-queue");
  await page.getByRole("button", { name: "Run screening" }).click();

  // IN FLIGHT, in the row the act belongs to.
  await expect(page.getByTestId("kyc-queue-kyc-3-pending")).toHaveText(
    "Working…",
  );

  release();

  // AND THEN IT SAYS WHAT IT DID — naming the state the record is now in, which
  // is composed from the column heading and the badge's own label, so not one
  // word of it is newly written.
  const outcome = page.getByTestId("kyc-queue-kyc-3-outcome");
  await expect(outcome).toHaveText("Status: Screening");
  await expect(outcome).toHaveAttribute("role", "status");
  await expect(page.getByTestId("kyc-queue-kyc-3-pending")).toHaveCount(0);
});

test("a refused screening is announced in the row, not swallowed", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockQueue(page, [AWAITING_SCREENING]);
  await page.route(
    "http://localhost:4000/kyc-records/kyc-3/screening-hold",
    (route) =>
      route.fulfill({
        status: 200,
        json: {
          kycRecordId: "kyc-3",
          level: "NO_HOLD",
          releasable: false,
          reasons: [],
          releases: [],
          lastScreenedAt: null,
          configurationProblems: [],
        },
      }),
  );
  await page.route(
    "http://localhost:4000/kyc-records/kyc-3/run-screening",
    (route) =>
      route.fulfill({
        status: 422,
        json: { message: "The watchlist has never been synced." },
      }),
  );

  await page.goto("/customers/kyc-queue");
  await page.getByRole("button", { name: "Run screening" }).click();

  const failed = page.getByTestId("kyc-queue-kyc-3-error");
  await expect(failed).toContainText("The watchlist has never been synced.");
  await expect(failed).toHaveAttribute("role", "alert");
  await expect(page.getByTestId("kyc-queue-kyc-3-outcome")).toHaveCount(0);
});
