import { expect, test, type Page } from "@playwright/test";

// Part F item #8 — "Four-state (loading/empty/error/populated) screenshot
// evidence per screen" — a verification DISCIPLINE overlay on items #1-7,
// not a separate build item (ibms-brain/meta/context/bilingual-ui.md).
// Scoped, per the user's own confirmed decision, to the screens items #1-7
// actually built/touched — not a blanket sweep of every page in the app.
// Captures whichever of the 4 states are genuinely applicable per screen
// (verification-contract.md's own "Only applicable states need to be
// implemented for a specific page" allowance) as plain PNG evidence
// (`page.screenshot()`, no pixel-diff baseline — a lower-maintenance choice
// than `toHaveScreenshot()` on a bilingual RTL/LTR app where font-rendering
// differences across platforms would otherwise cause noisy false failures),
// saved under `test-results/four-state-screenshots/<screen>/<state>.png`
// (already covered by the existing `test-results/` gitignore entry — not
// committed, the same treatment Playwright's own trace/video artifacts get).

const ME_BASE = {
  id: "user-1",
  email: "officer@ibms.test",
  fullName: "Verification Officer",
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
    route.fulfill({ status: 200, json: { ...ME_BASE, roles, languagePreference } }),
  );
}

async function capture(page: Page, screen: string, state: string) {
  await page.screenshot({
    path: `test-results/four-state-screenshots/${screen}/${state}.png`,
    fullPage: true,
  });
}

/** Delays the route's fulfillment until `resolve()` is called, so a
 * navigation can be captured mid-flight (the loading state) before the
 * caller lets the mocked response resolve. */
function gate<T>(json: T, status = 200): { route: (route: Parameters<Parameters<Page["route"]>[1]>[0]) => Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const wait = new Promise<void>((r) => (resolve = r));
  return {
    route: async (route) => {
      await wait;
      await route.fulfill({ status, json });
    },
    resolve,
  };
}

// --- /customers — item #6 (bilingual search) + item #3 (bidi) -------------

const CUSTOMER_AR = {
  id: "cust-1",
  prospectId: null,
  customerType: "CORPORATE",
  legalName: "شركة الأفق للتأمين",
  givenName: null,
  fatherName: null,
  grandfatherName: null,
  familyName: null,
  registrationNumber: "REG-2026-0451",
  taxRegistrationNumber: null,
  registeredAddress: "عمّان، الأردن — شارع الملكة رانيا",
  natureOfBusiness: "Insurance intermediation",
  languagePreference: "AR",
  status: "ACTIVE",
  classification: "CONFIDENTIAL",
  ownerUserId: "user-1",
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
  nationalId: null,
  contactPhone: "***-7890",
  contactEmail: "***@example.test",
};

test("four-state screenshots: /customers (item #6 search, item #3 bidi)", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"], "AR");

  // loading
  const g = gate([CUSTOMER_AR]);
  await page.route("http://localhost:4000/customers", g.route);
  await page.goto("/customers");
  await expect(page.getByText("Loading…")).toBeVisible();
  await capture(page, "customers", "loading");
  g.resolve();
  await expect(page.getByText("شركة الأفق للتأمين")).toBeVisible();
  await capture(page, "customers", "populated");
  await page.unroute("http://localhost:4000/customers");

  // empty
  await page.route("http://localhost:4000/customers", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.goto(page.url());
  await expect(page.getByText("No customers yet.")).toBeVisible();
  await capture(page, "customers", "empty");
  await page.unroute("http://localhost:4000/customers");

  // error
  await page.route("http://localhost:4000/customers", (route) =>
    route.fulfill({
      status: 403,
      json: { message: "You do not hold a permission required to perform this action" },
    }),
  );
  await page.goto(page.url());
  await expect(page.locator('p[role="alert"]')).toBeVisible();
  await capture(page, "customers", "error");
});

// --- /customers/[id] — item #3 (bidi) + item #4 (national-ID name split) --

test("four-state screenshots: /customers/[id] (item #3 bidi, item #4 name split)", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"], "AR");
  await page.route("http://localhost:4000/customers/cust-1/documents", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route("http://localhost:4000/consent-records**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route("http://localhost:4000/privacy-notices/current**", (route) =>
    route.fulfill({ status: 200, json: { notice: null } }),
  );

  // error (not found / no visibility)
  await page.route("http://localhost:4000/customers/cust-1", (route) =>
    route.fulfill({ status: 404, json: { message: "Customer not found" } }),
  );
  await page.route("http://localhost:4000/customers/cust-1/ubos", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.goto("/customers/cust-1");
  await expect(page.locator('p[role="alert"]')).toBeVisible();
  await capture(page, "customers-detail", "error");
  await page.unroute("http://localhost:4000/customers/cust-1");

  // populated — the Arabic legal name renders inside a <bdi> isolate, and
  // the UBO's split national-ID name parts render as distinct fields.
  await page.route("http://localhost:4000/customers/cust-1", (route) =>
    route.fulfill({ status: 200, json: CUSTOMER_AR }),
  );
  await page.route("http://localhost:4000/customers/cust-1/ubos", (route) =>
    route.fulfill({
      status: 200,
      json: [
        {
          id: "ubo-1",
          customerId: "cust-1",
          fullName: "يوسف أحمد الفاخوري",
          givenName: "يوسف",
          fatherName: "أحمد",
          grandfatherName: null,
          familyName: "الفاخوري",
          ownershipPercent: "60.00",
          isAuthorizedSignatory: true,
          isPep: false,
          createdAt: "2026-08-26T00:00:00.000Z",
          nationalId: "******6789",
        },
      ],
    }),
  );
  await page.goto("/customers/cust-1");
  await expect(page.getByRole("heading", { name: "شركة الأفق للتأمين" })).toBeVisible();
  await expect(page.getByText("يوسف أحمد الفاخوري")).toBeVisible();
  await capture(page, "customers-detail", "populated");
});

// --- /watchlist-sync — item #2 (full RTL layout mirroring) -----------------

const SYNC_RUNS = [
  {
    id: "run-1",
    source: "OFAC_SDN",
    startedAt: "2026-09-05T00:00:00.000Z",
    completedAt: "2026-09-05T00:00:05.000Z",
    status: "succeeded",
    recordCount: 19329,
    errorMessage: null,
  },
  {
    id: "run-2",
    source: "UN_CONSOLIDATED",
    startedAt: "2026-09-05T00:00:00.000Z",
    completedAt: "2026-09-05T00:00:03.000Z",
    status: "succeeded",
    recordCount: 1011,
    errorMessage: null,
  },
];

test("four-state screenshots: /watchlist-sync (item #2 RTL layout mirroring)", async ({
  page,
}) => {
  // AR — this screen is the RTL-layout-mirroring proof (rtl-layout.spec.ts's
  // own representative page); rendered in Arabic so the screenshot itself
  // shows the mirrored table, not just an English page that happens to work.
  await mockAuth(page, ["COMPLIANCE_OFFICER"], "AR");

  // empty
  await page.route("http://localhost:4000/watchlist-sync/status**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.goto("/watchlist-sync");
  await expect(page.getByText("No sync has run yet.")).toBeVisible();
  await capture(page, "watchlist-sync", "empty");
  await page.unroute("http://localhost:4000/watchlist-sync/status**");

  // error
  await page.route("http://localhost:4000/watchlist-sync/status**", (route) =>
    route.fulfill({ status: 403, json: { message: "no" } }),
  );
  await page.goto(page.url());
  await expect(page.locator('p[role="alert"]')).toBeVisible();
  await capture(page, "watchlist-sync", "error");
  await page.unroute("http://localhost:4000/watchlist-sync/status**");

  // populated
  await page.route("http://localhost:4000/watchlist-sync/status**", (route) =>
    route.fulfill({ status: 200, json: SYNC_RUNS }),
  );
  await page.goto(page.url());
  await expect(page.getByRole("cell", { name: "OFAC_SDN" })).toBeVisible();
  await capture(page, "watchlist-sync", "populated");
});

// --- /complaints — item #7 slice 1 (complaint acknowledgement PDF) --------

const COMPLAINTS = [
  {
    id: "c-1",
    customerId: "11111111-1111-1111-1111-111111111111",
    claimId: "claim-1",
    policyId: null,
    issue: "The settlement was 200 JOD below the assessed amount",
    category: "denied_claim",
    status: "ESCALATED",
    isClosed: false,
    responsibleEmployeeUserId: "u-claims",
    resolution: null,
    resolvedByUserId: null,
    closureApprovedByUserId: null,
    closedAt: null,
    sla: {
      timerId: "sla-1",
      dueAt: "2026-09-17T00:00:00.000Z",
      escalatedAt: null,
      escalatedTo: "BRANCH_DEPARTMENT_MANAGER",
      resolvedAt: "2026-09-15T00:00:00.000Z",
      breached: false,
    },
    actions: [],
    escalations: [],
    createdAt: "2026-09-03T09:00:00.000Z",
  },
];

test("four-state screenshots: /complaints (item #7 slice — complaint acknowledgement)", async ({
  page,
}) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);

  // loading
  const g = gate(COMPLAINTS);
  await page.route("http://localhost:4000/complaints**", g.route);
  await page.goto("/complaints");
  await expect(page.getByText("Loading…")).toBeVisible();
  await capture(page, "complaints", "loading");
  g.resolve();
  await expect(page.getByRole("heading", { name: "Complaints" })).toBeVisible();
  await page.unroute("http://localhost:4000/complaints**");

  // empty
  await page.route("http://localhost:4000/complaints**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.goto(page.url());
  await expect(page.getByText("No complaints.")).toBeVisible();
  await capture(page, "complaints", "empty");
  await page.unroute("http://localhost:4000/complaints**");

  // error
  await page.route("http://localhost:4000/complaints**", (route) =>
    route.fulfill({ status: 403, json: { message: "no" } }),
  );
  await page.goto(page.url());
  await expect(page.locator('p[role="alert"]')).toBeVisible();
  await capture(page, "complaints", "error");
  await page.unroute("http://localhost:4000/complaints**");

  // populated — with the download button visible
  await page.route("http://localhost:4000/complaints**", (route) =>
    route.fulfill({ status: 200, json: COMPLAINTS }),
  );
  await page.goto(page.url());
  await expect(
    page.getByRole("button", { name: "Download acknowledgement (PDF)" }),
  ).toBeVisible();
  await capture(page, "complaints", "populated");
});

// --- /rfqs/[id] — item #7 slice 2 (quotation comparison PDF) --------------

const INSURER = {
  id: "ins-1",
  name: "Union Insurance",
  nameAr: "الاتحاد للتأمين",
  financialStrengthRating: "A-",
};

const RFQ = {
  id: "rfq-1",
  opportunityId: "opp-1",
  insuranceLine: "Property All Risks",
  issuedAt: "2026-09-01T00:00:00.000Z",
  followUpThresholdDays: 10,
  issuedByUserId: "user-1",
  insurerSubmissions: [
    {
      id: "sub-1",
      rfqId: "rfq-1",
      insurerId: "ins-1",
      status: "QUOTE_RECEIVED",
      sentAt: "2026-09-01T00:00:00.000Z",
      respondedAt: "2026-09-03T00:00:00.000Z",
      followUpAlertSentAt: null,
      insurer: INSURER,
    },
  ],
  opportunity: { customerId: "cust-1" },
};

const QUOTATION = {
  id: "q-1",
  rfqId: "rfq-1",
  insurerId: "ins-1",
  versionNumber: 1,
  previousVersionId: null,
  isCurrentVersion: true,
  premium: "120000.000",
  currency: "JOD",
  deductible: "1000.000",
  limits: null,
  biPeriodMonths: 12,
  liabilityLimit: "5000000.000",
  exclusions: "War, nuclear risks",
  conditions: "Standard subrogation clause",
  commissionRatePercent: "12.00",
  receivedAt: "2026-09-03T00:00:00.000Z",
  capturedByUserId: "user-1",
  negotiationNotes: null,
  insurer: INSURER,
  rfq: { id: "rfq-1", opportunityId: "opp-1", insuranceLine: "Property All Risks" },
};

const COMPARISON_MATRIX = {
  id: "cm-1",
  rfqId: "rfq-1",
  insuranceLine: "Property All Risks",
  builtAt: "2026-09-04T00:00:00.000Z",
  builtByUserId: "user-1",
  rows: [
    {
      id: "row-1",
      quotationId: "q-1",
      insurerQualityScore: "4.5",
      serviceScore: "4.0",
      quotation: QUOTATION,
    },
  ],
  missingInsurers: [],
  declinedInsurers: [],
};

async function mockRfqDetailBase(page: Page) {
  await page.route("http://localhost:4000/rfqs/rfq-1/communications", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  // GET /quotations?rfqId= returns QuotationChain[] (grouped by insurer, with
  // current/versions/history), never a flat QuotationVersion[] — feeding
  // QuotationsSection.tsx the wrong shape here crashes it (`chain.current` is
  // undefined), found via a diagnostic pageerror listener while debugging
  // this exact test.
  await page.route("http://localhost:4000/quotations**", (route) =>
    route.fulfill({
      status: 200,
      json: [
        {
          rfqId: "rfq-1",
          insurerId: "ins-1",
          insuranceLine: "Property All Risks",
          insurer: INSURER,
          current: QUOTATION,
          versions: [QUOTATION],
          history: [],
        },
      ],
    }),
  );
  await page.route("http://localhost:4000/consent-records**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route("http://localhost:4000/privacy-notices/current**", (route) =>
    route.fulfill({ status: 200, json: { notice: null } }),
  );
}

// Split into 3 separate tests (a fresh page per state) rather than chaining
// navigations within one test, unlike the other screens in this file — this
// specific page hit a genuine browser-level navigation failure ("This page
// couldn't load") on a same-URL re-navigation after swapping mocks mid-test,
// not reproducible on any other screen here. Splitting matches this
// codebase's own established per-state-test convention anyway (see
// customers.spec.ts, complaints.spec.ts) and sidesteps the issue entirely.

test("four-state screenshots: /rfqs/[id] — error (item #7 slice — quotation comparison)", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockRfqDetailBase(page);
  await page.route("http://localhost:4000/rfqs/rfq-1", (route) =>
    route.fulfill({ status: 404, json: { message: "RFQ not found" } }),
  );
  await page.goto("/rfqs/rfq-1");
  await expect(page.locator('p[role="alert"]')).toBeVisible();
  await capture(page, "rfq-detail", "error");
});

test("four-state screenshots: /rfqs/[id] — empty (item #7 slice — quotation comparison)", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockRfqDetailBase(page);
  await page.route("http://localhost:4000/rfqs/rfq-1", (route) =>
    route.fulfill({ status: 200, json: RFQ }),
  );
  await page.route("http://localhost:4000/comparison-matrices**", (route) =>
    route.fulfill({ status: 404, json: { message: "no matrix yet" } }),
  );
  await page.goto("/rfqs/rfq-1");
  await expect(
    page.getByRole("button", { name: "Build comparison" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download comparison (PDF)" }),
  ).toHaveCount(0);
  await capture(page, "rfq-detail", "empty");
});

test("four-state screenshots: /rfqs/[id] — populated (item #7 slice — quotation comparison)", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockRfqDetailBase(page);
  await page.route("http://localhost:4000/rfqs/rfq-1", (route) =>
    route.fulfill({ status: 200, json: RFQ }),
  );
  await page.route("http://localhost:4000/comparison-matrices**", (route) =>
    route.fulfill({ status: 200, json: COMPARISON_MATRIX }),
  );
  await page.goto("/rfqs/rfq-1");
  await expect(
    page.getByRole("button", { name: "Download comparison (PDF)" }),
  ).toBeVisible();
  await capture(page, "rfq-detail", "populated");
});

// --- /opportunities/[id] — item #7 slices 3-6 (recommendation, policy
// schedule, certificate, invoice) --------------------------------------

const RECOMMENDATION = {
  id: "rec-1",
  opportunityId: "opp-1",
  customerId: "cust-1",
  recommendedQuotation: {
    id: "q-1",
    insurerId: "ins-1",
    insurer: INSURER,
    insuranceLine: "Property All Risks",
    premium: "120000.000",
    currency: "JOD",
    commissionRatePercent: "12.00",
  },
  rationale: "Best combination of coverage, price and insurer strength.",
  rationaleFactors: {
    coverage: "Matches every requested peril.",
    price: "Lowest premium of the shortlist.",
    financialStrength: "A- rated carrier.",
    claimsService: "Ten-day average settlement.",
    deductible: "JOD 1,000, in line with the market.",
    policyConditions: "Standard subrogation clause.",
  },
  approvalRequired: false,
  approvedByUserId: null,
  approvedAt: null,
  conflictOfInterestFlagged: false,
  coiCompetingQuotationId: null,
  coiCommissionDiffPercent: null,
  conflictOfInterestDisclosure: null,
  sentToClientAt: "2026-09-05T00:00:00.000Z",
  sentByUserId: "user-1",
  draftedByUserId: "user-1",
  createdAt: "2026-09-04T00:00:00.000Z",
  blockedFromSend: [],
};

const CLIENT_DECISION = {
  id: "cd-1",
  opportunityId: "opp-1",
  decision: "ACCEPT",
  evidenceType: "e-signature",
  evidenceRef: "env-1",
  notes: null,
  decidedAt: "2026-09-06T00:00:00.000Z",
};

const POLICY = {
  id: "pol-1",
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
  schedules: [
    {
      id: "sch-1",
      effectiveFrom: "2026-10-01T00:00:00.000Z",
      effectiveTo: null,
      limits: { buildings: "5000000.000", contents: "1200000.000" },
      sumsInsured: { total: "6200000.000" },
      namedPerils: ["fire", "flood", "theft"],
      extensions: ["debris removal"],
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

const INVOICE = {
  id: "inv-1",
  policyId: "pol-1",
  customerId: "cust-1",
  invoiceType: "new_business_premium",
  premiumAmount: "118500.000",
  taxAmount: "9480.000",
  feesAmount: "150.000",
  commissionDeducted: "14220.000",
  totalAmount: "113910.000",
  currency: "JOD",
  dueDate: "2026-10-15T00:00:00.000Z",
  status: "INVOICED",
  createdAt: "2026-09-08T00:00:00.000Z",
  netRemittance: "104280.000",
  receipt: null,
  remittance: null,
};

const OPPORTUNITY = {
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

async function mockOpportunityDetailBase(page: Page) {
  await page.route("http://localhost:4000/rfqs?opportunityId=opp-1", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route(
    "http://localhost:4000/client-decisions?opportunityId=opp-1",
    (route) => route.fulfill({ status: 200, json: [] }),
  );
  await page.route("http://localhost:4000/policies/pol-1/endorsements", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route("http://localhost:4000/commission/agreements**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route("http://localhost:4000/commission/entries**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route("http://localhost:4000/consent-records**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route("http://localhost:4000/privacy-notices/current**", (route) =>
    route.fulfill({ status: 200, json: { notice: null } }),
  );
  await page.route("http://localhost:4000/claims**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
}

test("four-state screenshots: /opportunities/[id] (item #7 slices — recommendation, policy schedule, certificate, invoice)", async ({
  page,
}) => {
  await mockAuth(page, [
    "PLACEMENT_TECHNICAL_OFFICER",
    "BRANCH_DEPARTMENT_MANAGER",
    "SALES_RELATIONSHIP_OFFICER",
    "FINANCE_COLLECTIONS_OFFICER",
  ]);
  await mockOpportunityDetailBase(page);

  // error
  await page.route("http://localhost:4000/opportunities/opp-1", (route) =>
    route.fulfill({ status: 404, json: { message: "not found" } }),
  );
  await page.goto("/opportunities/opp-1");
  await expect(page.locator('p[role="alert"]')).toBeVisible();
  await capture(page, "opportunity-detail", "error");
  await page.unroute("http://localhost:4000/opportunities/opp-1");

  // empty — a fresh opportunity with no recommendation/policy/invoice yet
  await page.route("http://localhost:4000/opportunities/opp-1", (route) =>
    route.fulfill({ status: 200, json: OPPORTUNITY }),
  );
  await page.route(
    "http://localhost:4000/recommendations?opportunityId=opp-1",
    (route) => route.fulfill({ status: 200, json: [] }),
  );
  await page.route("http://localhost:4000/policies?opportunityId=opp-1", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.goto("/opportunities/opp-1");
  await expect(page.getByText("No RFQs yet.", { exact: false })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download report (PDF)" }),
  ).toHaveCount(0);
  await capture(page, "opportunity-detail", "empty");
  await page.unroute("http://localhost:4000/recommendations?opportunityId=opp-1");
  await page.unroute("http://localhost:4000/policies?opportunityId=opp-1");

  // populated — every item #7 download button on this page visible at once
  await page.route(
    "http://localhost:4000/recommendations?opportunityId=opp-1",
    (route) => route.fulfill({ status: 200, json: [RECOMMENDATION] }),
  );
  await page.route("http://localhost:4000/policies?opportunityId=opp-1", (route) =>
    route.fulfill({ status: 200, json: [POLICY] }),
  );
  await page.route("http://localhost:4000/invoices?policyId=pol-1", (route) =>
    route.fulfill({ status: 200, json: [INVOICE] }),
  );
  await page.goto(page.url());
  await expect(
    page.getByRole("button", { name: "Download report (PDF)" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download schedule summary (PDF)" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download certificate (PDF)" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download invoice (PDF)" }),
  ).toBeVisible();
  await capture(page, "opportunity-detail", "populated");
});

// --- /prospects — item #6 (bilingual search) -------------------------------

const PROSPECT_AR = {
  id: "pros-1",
  leadId: null,
  companyName: "شركة النخبة للتجارة",
  sector: "Trading",
  activity: "Wholesale distribution",
  employeeCount: 40,
  businessSize: "medium",
  location: "Amman",
  contactPerson: "Layla Odeh",
  productsOfInterest: ["Property", "Marine Cargo"],
  expectedPremium: "45000.000",
  salesOwnerUserId: "user-1",
  status: "QUALIFIED",
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
};

test("four-state screenshots: /prospects (item #6 bilingual search)", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"], "AR");

  const g = gate([PROSPECT_AR]);
  await page.route("http://localhost:4000/prospects**", g.route);
  await page.goto("/prospects");
  await expect(page.getByText("Loading…")).toBeVisible();
  await capture(page, "prospects", "loading");
  g.resolve();
  await expect(page.getByText("شركة النخبة للتجارة")).toBeVisible();
  await capture(page, "prospects", "populated");
  await page.unroute("http://localhost:4000/prospects**");

  await page.route("http://localhost:4000/prospects**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.goto(page.url());
  await expect(page.getByText("No prospects yet.")).toBeVisible();
  await capture(page, "prospects", "empty");
  await page.unroute("http://localhost:4000/prospects**");

  await page.route("http://localhost:4000/prospects**", (route) =>
    route.fulfill({ status: 403, json: { message: "no" } }),
  );
  await page.goto(page.url());
  await expect(page.locator('p[role="alert"]')).toBeVisible();
  await capture(page, "prospects", "error");
});

// --- /vendors — item #6 (bilingual search) ---------------------------------

const VENDOR_AR = {
  id: "vend-1",
  name: "شركة الأمان لخدمات تقييم الأضرار",
  vendorType: "loss_adjuster",
  riskTier: "low",
  annualReviewDueAt: "2027-01-01T00:00:00.000Z",
  terminationDataReturnConfirmedAt: null,
  accessRevokedAt: null,
  createdAt: "2026-08-20T00:00:00.000Z",
};

test("four-state screenshots: /vendors (item #6 bilingual search)", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"], "AR");

  const g = gate([VENDOR_AR]);
  await page.route("http://localhost:4000/vendors**", g.route);
  await page.goto("/vendors");
  await expect(page.getByText("Loading…")).toBeVisible();
  await capture(page, "vendors", "loading");
  g.resolve();
  await expect(page.getByText("شركة الأمان لخدمات تقييم الأضرار")).toBeVisible();
  await capture(page, "vendors", "populated");
  await page.unroute("http://localhost:4000/vendors**");

  await page.route("http://localhost:4000/vendors**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.goto(page.url());
  await expect(page.getByText("No vendors recorded yet.")).toBeVisible();
  await capture(page, "vendors", "empty");
  await page.unroute("http://localhost:4000/vendors**");

  await page.route("http://localhost:4000/vendors**", (route) =>
    route.fulfill({ status: 403, json: { message: "no" } }),
  );
  await page.goto(page.url());
  await expect(page.locator('p[role="alert"]')).toBeVisible();
  await capture(page, "vendors", "error");
});
