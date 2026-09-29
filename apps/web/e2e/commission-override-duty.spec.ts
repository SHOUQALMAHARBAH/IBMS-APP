import { expect, test, type Page } from "@playwright/test";
import { permissionsForRoles } from "./fixtures/role-permissions";
import type { OpportunityWithContext } from "../lib/opportunity/opportunity-api";
import type { Policy } from "../lib/policy/policy-api";

/**
 * THE COMBINED-DUTY ACT ON A MANUAL COMMISSION OVERRIDE — the most urgent of the fifteen projections.
 *
 * `CommissionLedgerEntry_maker_checker_distinct` requires that whoever REQUESTS a manual override of
 * the broker's commission is not whoever approves it. In an office that declared COMBINED mode one
 * person may do both by stating why.
 *
 * ## Why this pair before the others
 *
 * `CommissionSection.tsx` already renders the override reason, names the REQUESTER, and prints
 * `(approved)` once an approver exists. It renders nothing about WHO approved it. So a self-approved
 * override was indistinguishable, on screen, from an ordinary two-person one — **showing half of a
 * two-person control is worse than showing none of it, because it reads as two people to anybody who
 * does not know the field is missing.**
 *
 * That is also why the "ordinary" test here asserts the `(approved)` marker IS present alongside the
 * absent declaration: the point is not that the screen is silent, it is that the screen makes a
 * positive claim which must be true.
 */

const ME_BASE = {
  id: "user-1",
  email: "manager@ibms.test",
  fullName: "Branch Manager",
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
 * TYPED, and copied from `part-g-core-screens.spec.ts` rather than invented.
 *
 * My first version was a hand-written object with half these fields, and the page answered with
 * Chrome's own "This page couldn't load" — a crash inside the component, not a failed assertion. A
 * mock whose SHAPE differs from the endpoint's is the recorded cause of exactly that symptom, and it
 * has cost this project three wrong diagnoses. The type annotation is what makes the next one a
 * compile error instead.
 */
const OPPORTUNITY: OpportunityWithContext = {
  id: "opp-1",
  customerId: "cust-1",
  insuranceProgramId: "prog-1",
  isRenewal: false,
  status: "PLACEMENT",
  targetPremiumThreshold: null,
  createdByUserId: "user-1",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-08T00:00:00.000Z",
  context: { insuranceProgramId: "prog-1", customerId: "cust-1" },
};

/** An override APPROVED BY SOMEBODY ELSE — the ordinary two-person case. */
const ORDINARY_OVERRIDE = {
  id: "cle-1",
  policyId: "pol-1",
  commissionAgreementId: "ag-1",
  amount: "18000.00",
  vatRatePercent: "16",
  vatAmount: "2880.00",
  grossAmount: "20880.00",
  overrideAmount: "21000.00",
  effectiveAmount: "21000.00",
  status: "outstanding",
  isManualOverride: true,
  overrideReason: "Renewal concession agreed with the insurer.",
  overrideRequestedByUserId: "user-7",
  overrideApprovedByUserId: "user-9",
  combinedDutyAct: null,
  overridePending: false,
  paidAmount: null,
  paidAt: null,
  paymentReference: null,
  reversedAmount: null,
  reversedAt: null,
  reversalReason: null,
  createdAt: "2026-02-01T00:00:00.000Z",
};

/** The SAME person requested and approved it, with the reason they gave. */
const SELF_APPROVED_OVERRIDE = {
  ...ORDINARY_OVERRIDE,
  id: "cle-2",
  overrideApprovedByUserId: "user-7",
  combinedDutyAct: {
    id: "cda-cle-1",
    at: "2026-02-01T00:00:00.000Z",
    actorUserId: "user-7",
    reason: "Sole signatory present at month end; insurer credit note already issued.",
    pair: "CommissionLedgerEntry_maker_checker_distinct",
    roles: ["BRANCH_DEPARTMENT_MANAGER"],
    hatAmbiguous: false,
  },
};

/** Copied VERBATIM from `part-g-core-screens.spec.ts`. Typed, for the same reason as the opportunity. */
const POLICY: Policy = {
  id: "pol-1",
  discard: null,
  opportunityId: "opp-1",
  customerId: "cust-1",
  insurerId: "ins-1",
  insurer: { id: "ins-1", name: "Union Insurance", nameAr: "الاتحاد للتأمين" },
  policyNumber: "POL-2026-0451",
  insuranceLine: "Property All Risks",
  status: "ACTIVE",
  inceptionDate: "2026-10-01",
  expiryDate: "2027-10-01",
  requestedPremium: "120000.000",
  issuedPremium: "118500.000",
  premiumVariance: "-1500.000",
  currency: "JOD",
  placedByUserId: "user-1",
  issuedByUserId: "user-1",
  customer: { id: "cust-1", legalName: "شركة الأفق للتأمين" },
  schedules: [
    {
      id: "sch-1",
      effectiveFrom: "2026-10-01T00:00:00.000Z",
      effectiveTo: null,
      limits: { buildings: "5000000.000" },
      sumsInsured: { total: "6200000.000" },
      namedPerils: ["fire", "flood"],
      extensions: [],
      sourceEndorsementId: null,
      createdAt: "2026-09-08T00:00:00.000Z",
    },
  ],
  documents: [],
  checking: null,
  delivery: null,
  issuanceComplete: true,
  checkingComplete: false,
  deliveryComplete: false,
  createdAt: "2026-09-07T00:00:00.000Z",
  updatedAt: "2026-09-08T00:00:00.000Z",
};

/** `/policies?opportunityId=` returns a PAGE, not a bare array — `listPoliciesForOpportunity` reads
 *  `page.items`, so `[]` gives it `undefined` and the section reports a failed load. */
function paged<T>(items: T[]) {
  return { items, total: items.length, page: 0, pageSize: 50 };
}

async function mockScreen(page: Page, entries: unknown[]) {
  await page.route("http://localhost:4000/opportunities/opp-1", (route) =>
    route.fulfill({ status: 200, json: OPPORTUNITY }),
  );
  await page.route("http://localhost:4000/commission/entries**", (route) =>
    route.fulfill({ status: 200, json: entries }),
  );
  // Everything else the opportunity page reads, empty — this spec is about one block.
  for (const url of [
    "http://localhost:4000/rfqs?opportunityId=opp-1",
    "http://localhost:4000/client-decisions?opportunityId=opp-1",
    "http://localhost:4000/recommendations?opportunityId=opp-1",
    "http://localhost:4000/commission/agreements**",
    "http://localhost:4000/consent-records**",
    "http://localhost:4000/invoices**",
  ]) {
    await page.route(url, (route) => route.fulfill({ status: 200, json: [] }));
  }
  await page.route(
    "http://localhost:4000/policies?opportunityId=opp-1",
    (route) => route.fulfill({ status: 200, json: paged([POLICY]) }),
  );
  await page.route("http://localhost:4000/privacy-notices/current**", (route) =>
    route.fulfill({ status: 200, json: { notice: null } }),
  );
}

test("shows that one person both requested and approved an override, and why", async ({
  page,
}) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await mockScreen(page, [SELF_APPROVED_OVERRIDE]);
  await page.goto("/opportunities/opp-1");

  const declared = page.getByTestId("combined-duty-commission-cle-2");
  await expect(declared).toContainText("BRANCH_DEPARTMENT_MANAGER");
  await expect(declared).toContainText("Sole signatory present at month end");
  // Tied to the database rule it excuses, so the record and the constraint cannot drift apart.
  await expect(declared).toHaveAttribute(
    "data-combined-duty-pair",
    "CommissionLedgerEntry_maker_checker_distinct",
  );
});

test("an override approved by somebody else says (approved) and declares nothing", async ({
  page,
}) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await mockScreen(page, [ORDINARY_OVERRIDE]);
  await page.goto("/opportunities/opp-1");

  // The POSITIVE claim is the anchor, and it is the point: this screen asserts "(approved)", and that
  // assertion is only true of a two-person approval. It comes from the same read that would carry the
  // act, so the absence below cannot pass while that read is in flight.
  await expect(page.getByText("(approved)")).toBeVisible();
  await expect(
    page.getByTestId("combined-duty-commission-cle-1"),
  ).toHaveCount(0);
});
