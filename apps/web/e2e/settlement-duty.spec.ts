import { expect, test, type Page } from "@playwright/test";
import { permissionsForRoles } from "./fixtures/role-permissions";
import type { Claim } from "../lib/claim/claim-api";

/**
 * THE COMBINED-DUTY ACT ON A CLAIM SETTLEMENT — Part 4 step 5.
 *
 * `Settlement_maker_checker_distinct` requires that whoever records a settlement is not whoever gives
 * the mandatory second approval, and that second approval exists at all **because this is where a
 * claim payment leaves the office**.
 *
 * `ClaimCard.tsx` prints ` · second-approved` once an approver exists, and **that claim is only true
 * of a two-person approval** — the same half-truth the commission override had. Equal
 * `approvedByUserId` and `secondApproverUserId` are visible only to somebody who compares two uuids.
 *
 * ## Its own spec, rather than `rfq.spec.ts`
 *
 * That file's claims fixture is a stateful mock with no seeding path: a claim exists only after a POST
 * walks the flow, and its ids are generated. Adding a seed to a 3000-line mock to reach one render is
 * more risk than a focused spec with a typed fixture — and the fixture below is TYPED for the reason
 * the fourth "This page couldn't load" taught: a mock whose shape differs from the endpoint's crashes
 * the component instead of failing an assertion.
 */

const ME_BASE = {
  id: "user-1",
  email: "claims@ibms.test",
  fullName: "Claims Officer",
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

/**
 * Copied VERBATIM from `part-g-core-screens.spec.ts`, then adjusted to a SETTLED claim.
 *
 * My first attempt authored one from memory and the type rejected four invented fields — which is the
 * annotation working, and the reason not to author fixtures at all when a verified one exists.
 */
const CLAIM: Claim = {
  id: "clm-1",
  discard: null,
  policyId: "pol-1",
  customerId: "cust-1",
  policyNumber: "POL-2026-0451",
  insuranceLine: "Property All Risks",
  claimNumber: "CLM-2026-0007",
  insurerClaimReference: "UN-77120",
  status: "UNDER_ASSESSMENT",
  lossDate: "2026-09-05",
  lossLocation: "عمّان — المنطقة الصناعية",
  causeOfLoss: "Water damage following a burst riser",
  estimatedLoss: "48000.000",
  isThirdPartyInvolved: false,
  isLargeClaim: false,
  classification: "HIGHLY_CONFIDENTIAL",
  followUpAlertThresholdDays: 7,
  thirdParty: null,
  adjuster: {
    name: "Rami Haddad",
    firm: "Levant Loss Adjusters",
    assignedAt: "2026-09-06T08:00:00.000Z",
    surveyCompletedAt: "2026-09-08T08:00:00.000Z",
    investigationCompletedAt: null,
  },
  coverage: {
    scheduleId: "sch-1",
    effectiveFrom: "2026-10-01T00:00:00.000Z",
    effectiveTo: null,
  },
  coverageResolvedAtLossDate: true,
  documents: [],
  documentChecklist: [],
  documentationComplete: false,
  missingMandatoryDocuments: [],
  assessment: {
    surveyCompletedAt: "2026-09-08T08:00:00.000Z",
    investigationCompletedAt: null,
    adjusterWorkComplete: false,
    readyForAssessment: false,
    outcome: null,
  },
  followUp: {
    followUpAlerts: [],
    followUpAlertOpen: false,
    followUpAlertThresholdDays: 7,
    awaitingInsurerResponse: true,
    awaitingInsurerSince: "2026-09-08T08:00:00.000Z",
  },
  settlement: null,
  closedAt: null,
  statusHistory: [],
  createdAt: "2026-09-05T10:00:00.000Z",
  updatedAt: "2026-09-08T10:00:00.000Z",
};

/** A SETTLED claim whose two approvals are TWO PEOPLE — the ordinary case, derived from the fixture
 *  above so only the settlement differs. */
const TWO_PERSON: Claim = {
  ...CLAIM,
  status: "SETTLED",
  settlement: {
    estimatedLoss: "42000.000",
    approvedAmount: "38000.000",
    deductible: "1000.000",
    netSettlement: "37000.000",
    brokerProcessedPayment: false,
    approvedByUserId: "user-1",
    secondApproverUserId: "user-2",
    combinedDutyAct: null,
    secondApproverRequired: true,
    settled: true,
    clientPaymentConfirmedAt: null,
  },
};

/** The SAME person recorded it and gave the second approval, with the reason they gave. */
const SELF_APPROVED: Claim = {
  ...TWO_PERSON,
  settlement: {
    ...TWO_PERSON.settlement!,
    secondApproverUserId: "user-1",
    combinedDutyAct: {
      id: "cda-set-1",
      at: "2026-09-20T00:00:00.000Z",
      actorUserId: "user-1",
      reason:
        "Claims officer covering alone; insurer had already remitted the agreed amount.",
      pair: "Settlement_maker_checker_distinct",
      roles: ["CLAIMS_OFFICER"],
      hatAmbiguous: false,
    },
  },
};

/**
 * `/claims/:id` returns ONE claim, not a list.
 *
 * My first version answered `**\/claims**` with an array, which matched this path and handed the page
 * an array where it expected an object — Chrome's own "This page couldn't load" again, on the same day
 * as two others. The lesson is narrower than "type your fixtures": **match the exact path, because a
 * wildcard that also catches a detail route answers it with the list shape.**
 */
async function mockClaim(page: Page, claim: Claim) {
  await page.route("http://localhost:4000/claims/clm-1", (route) =>
    route.fulfill({ status: 200, json: claim }),
  );
}

test("shows that one person both recorded a settlement and second-approved it", async ({
  page,
}) => {
  await mockAuth(page, ["CLAIMS_OFFICER"]);
  await mockClaim(page, SELF_APPROVED);
  await page.goto("/claims/clm-1");

  const declared = page.getByTestId("combined-duty-settlement-clm-1");
  await expect(declared).toContainText("CLAIMS_OFFICER");
  await expect(declared).toContainText("Claims officer covering alone");
  // Tied to the database rule it excuses, so the record and the constraint cannot drift apart.
  await expect(declared).toHaveAttribute(
    "data-combined-duty-pair",
    "Settlement_maker_checker_distinct",
  );
});

test("prints second-approved and declares nothing when the two approvals are two people", async ({
  page,
}) => {
  await mockAuth(page, ["CLAIMS_OFFICER"]);
  await mockClaim(page, TWO_PERSON);
  await page.goto("/claims/clm-1");

  // The POSITIVE claim is the anchor and it is the point: the card asserts ` · second-approved`, which
  // is only true of a two-person approval. Asserting silence alone would pass on a card that had
  // quietly stopped printing anything.
  await expect(page.getByText("second-approved")).toBeVisible();
  await expect(
    page.getByTestId("combined-duty-settlement-clm-1"),
  ).toHaveCount(0);
});
