import { expect, test, type Page } from "@playwright/test";
import { permissionsForRoles } from "./fixtures/role-permissions";
import type { Lead } from "../lib/lead/lead-api";
import type { Policy } from "../lib/policy/policy-api";
import type { Claim } from "../lib/claim/claim-api";
import type { RenewalCase } from "../lib/renewal/renewal-api";
import type { OpportunityWithContext } from "../lib/opportunity/opportunity-api";

/*
 * Part G, checklist item 7 — "The core screens (Lead→Policy→Claim→Renewal)
 * work in both Arabic and English across all four states, with screenshots."
 *
 * This is the LAST item on Part G's final verification checklist, and it is
 * deliberately a separate file from `four-state-screenshots.spec.ts` (Part F
 * item #8) rather than an extension of it. Part F item #8's own scope note in
 * README says why the earlier sweep does not satisfy this one: it captures ONE
 * language per screen (chosen per screen to demonstrate RTL/bidi), and it has
 * no `/leads` capture at all. Item 7 asks for BOTH languages on FOUR named
 * workflow stages. Keeping them apart also keeps each part's evidence
 * separately attributable.
 *
 * Four states, as Part F item #8's own backlog line defines them:
 * loading / empty / error / populated. 4 screens x 2 languages x 4 states =
 * 32 captures, which is exactly the "up to 32" this item was scoped at.
 *
 * ONE ROLE drives all four screens. `SALES_RELATIONSHIP_OFFICER` is the only
 * seeded role holding every permission the chain needs — `lead.list.read`,
 * `policy.read`, `claim.read`, `renewal.read`, plus the `opportunity.read`
 * that the claims screen sits behind. That is not a convenience: item 7 says
 * the core screens WORK, and a superuser fixture stitched from several roles
 * would prove the pages render without proving any real user can walk the
 * chain. This is also the check that caught the Policy Checking Officer
 * routing gap (README § Known gaps) — a role that cannot reach a screen is a
 * broken workflow even when every page renders correctly on its own.
 *
 * Captures land in `test-results/part-g-core-screens/<screen>/<lang>-<state>.png`,
 * covered by the existing `test-results/` gitignore entry — the same treatment
 * Part F item #8's evidence and Playwright's own traces get.
 */

const LANGS = ["EN", "AR"] as const;
type Lang = (typeof LANGS)[number];

/**
 * Copy asserted on per language. Every value is read from
 * `lib/i18n/translations/`, never transcribed by ear — an assertion on a
 * hand-typed Arabic string is an assertion on the typist.
 */
const COPY = {
  loading: { EN: "Loading…", AR: "جارٍ التحميل…" },
  leadsHeading: { EN: "Leads", AR: "العملاء المحتملون" },
  leadsNoneYet: {
    EN: "No leads yet — add one above to start your pipeline.",
    AR: "لا يوجد عملاء محتملون بعد — أضف واحداً أعلاه لبدء مسارك.",
  },
  policiesHeading: { EN: "Policies", AR: "الوثائق" },
  policiesNoneYet: {
    EN: "No policies to show. A policy appears here once an accepted opportunity has been placed and issued.",
    AR: "لا توجد وثائق لعرضها. تظهر الوثيقة هنا بعد وضع فرصة مقبولة من العميل وإصدارها.",
  },
  claimsHeading: { EN: "Claims", AR: "المطالبات" },
  claimsNoneYet: { EN: "No claims yet.", AR: "لا توجد مطالبات بعد." },
  renewalHeading: { EN: "Renewal cases", AR: "حالات التجديد" },
  renewalNoneYet: {
    EN: "No renewal cases — nothing is inside the lead-time window yet.",
    AR: "لا توجد حالات تجديد.",
  },
} satisfies Record<string, Record<Lang, string>>;

const ME_BASE = {
  id: "user-1",
  email: "officer@ibms.test",
  fullName: "Verification Officer",
  mfaEnabled: false,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

/** The one role that can walk the whole chain. */
const ROLE = "SALES_RELATIONSHIP_OFFICER";

async function mockAuth(page: Page, languagePreference: Lang) {
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fake-access-token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      status: 200,
      json: {
        ...ME_BASE,
        roles: [ROLE],
        languagePreference,
        permissions: permissionsForRoles([ROLE]),
      },
    }),
  );
  // The bell renders inside the navbar on EVERY screen in this sweep.
  await page.route("http://localhost:4000/notifications", (route) =>
    route.fulfill({ status: 200, json: { items: [], total: 0 } }),
  );
}

async function capture(page: Page, screen: string, lang: Lang, state: string) {
  await page.screenshot({
    path: `test-results/part-g-core-screens/${screen}/${lang}-${state}.png`,
    fullPage: true,
  });
}

/**
 * Holds a route open so a navigation can be photographed mid-flight, then
 * released. Same helper shape as `four-state-screenshots.spec.ts`.
 */
function gate<T>(json: T, status = 200) {
  let resolve!: () => void;
  const wait = new Promise<void>((r) => (resolve = r));
  return {
    route: async (route: Parameters<Parameters<Page["route"]>[1]>[0]) => {
      await wait;
      await route.fulfill({ status, json });
    },
    resolve,
  };
}

/** Every paged list endpoint returns this envelope on every branch. */
function paged<T>(items: T[]) {
  return { items, total: items.length, page: 0, pageSize: 50 };
}

/**
 * The 403 an officer sees when the permission behind a screen is missing —
 * the error state these screens are actually built to show, rather than an
 * invented 500.
 */
const FORBIDDEN = {
  status: 403,
  json: {
    message: "You do not hold a permission required to perform this action",
  },
};

// --- Lead -----------------------------------------------------------------

const LEADS: Lead[] = [
  {
    id: "lead-1",
    fullName: "مؤسسة النخيل التجارية",
    source: "referral",
    ownerUserId: "user-1",
    status: "NEW",
    contactPhone: "+962 7 9000 0000",
    contactEmail: "contact@example.test",
    marketingConsentGranted: true,
    firstContactAt: "2026-09-10T09:00:00.000Z",
    createdAt: "2026-09-10T09:00:00.000Z",
    updatedAt: "2026-09-10T09:00:00.000Z",
  },
  {
    id: "lead-2",
    fullName: "Cedar Logistics PLC",
    source: "campaign",
    ownerUserId: "user-1",
    status: "CONTACTED",
    contactPhone: null,
    contactEmail: "ops@cedar.test",
    marketingConsentGranted: false,
    firstContactAt: "2026-09-11T09:00:00.000Z",
    createdAt: "2026-09-11T09:00:00.000Z",
    updatedAt: "2026-09-12T09:00:00.000Z",
  },
];

const LEADS_URL = "http://localhost:4000/leads";

for (const lang of LANGS) {
  test(`Part G item 7 — Lead (/leads) four states in ${lang}`, async ({
    page,
  }) => {
    await mockAuth(page, lang);

    // loading
    const g = gate(LEADS);
    await page.route(LEADS_URL, g.route);
    await page.goto("/leads");
    await expect(
      page.getByRole("heading", { name: COPY.leadsHeading[lang] }),
    ).toBeVisible();
    await expect(page.getByText(COPY.loading[lang]).first()).toBeVisible();
    await capture(page, "lead", lang, "loading");

    // populated — released from the same navigation, so this is genuinely the
    // loading state resolving rather than a second page load.
    g.resolve();
    await expect(page.getByText("مؤسسة النخيل التجارية")).toBeVisible();
    await expect(page.getByText("Cedar Logistics PLC")).toBeVisible();
    await capture(page, "lead", lang, "populated");
    await page.unroute(LEADS_URL);

    // empty
    await page.route(LEADS_URL, (route) =>
      route.fulfill({ status: 200, json: [] }),
    );
    await page.goto("/leads");
    await expect(page.getByText(COPY.leadsNoneYet[lang])).toBeVisible();
    await capture(page, "lead", lang, "empty");
    await page.unroute(LEADS_URL);

    // error
    await page.route(LEADS_URL, (route) => route.fulfill(FORBIDDEN));
    await page.goto("/leads");
    await expect(page.locator('p[role="alert"]').first()).toBeVisible();
    await capture(page, "lead", lang, "error");
  });
}

// --- Policy ---------------------------------------------------------------

const POLICY: Policy = {
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

const POLICIES_URL = "http://localhost:4000/policies";

for (const lang of LANGS) {
  test(`Part G item 7 — Policy (/policies) four states in ${lang}`, async ({
    page,
  }) => {
    await mockAuth(page, lang);

    // loading
    const g = gate(paged([POLICY]));
    await page.route(POLICIES_URL, g.route);
    await page.goto("/policies");
    await expect(
      page.getByRole("heading", { name: COPY.policiesHeading[lang] }),
    ).toBeVisible();
    await expect(page.getByText(COPY.loading[lang]).first()).toBeVisible();
    await capture(page, "policy", lang, "loading");

    // populated
    g.resolve();
    await expect(page.getByText("POL-2026-0451")).toBeVisible();
    await capture(page, "policy", lang, "populated");
    await page.unroute(POLICIES_URL);

    // empty
    await page.route(POLICIES_URL, (route) =>
      route.fulfill({ status: 200, json: paged([]) }),
    );
    await page.goto("/policies");
    await expect(page.getByText(COPY.policiesNoneYet[lang])).toBeVisible();
    await capture(page, "policy", lang, "empty");
    await page.unroute(POLICIES_URL);

    // error
    await page.route(POLICIES_URL, (route) => route.fulfill(FORBIDDEN));
    await page.goto("/policies");
    await expect(page.locator('p[role="alert"]').first()).toBeVisible();
    await capture(page, "policy", lang, "error");
  });
}

// --- Claim ----------------------------------------------------------------

/*
 * There is NO standalone claims screen in this app, and that is a real finding
 * rather than an omission in this sweep: `AppNav`'s own comment records that
 * the "Claims" nav group "held exactly one item, an analytics screen, with no
 * operational claims screen to sit beside", and was dissolved. Claims are
 * operated through `ClaimSection` on `/opportunities/[id]`, which is therefore
 * the screen item 7's "Claim" stage names. Logged in README § Known gaps.
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

const CLAIM: Claim = {
  id: "clm-1",
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

const OPP_URL = "http://localhost:4000/opportunities/opp-1";
const OPP_POLICIES_URL = "http://localhost:4000/policies?opportunityId=opp-1";
const OPP_RFQS_URL = "http://localhost:4000/rfqs?opportunityId=opp-1";
const CLAIMS_URL = "http://localhost:4000/claims?policyId=pol-1";

/**
 * Everything the opportunity screen fetches apart from the pieces each state
 * varies. Host-qualified throughout: a bare glob route also matches the PAGE
 * document and answers the navigation itself with JSON.
 */
async function mockOpportunityBase(page: Page) {
  for (const url of [
    "http://localhost:4000/client-decisions?opportunityId=opp-1",
    "http://localhost:4000/recommendations?opportunityId=opp-1",
    "http://localhost:4000/policies/pol-1/endorsements",
    "http://localhost:4000/commission/agreements**",
    "http://localhost:4000/commission/entries**",
    "http://localhost:4000/consent-records**",
    "http://localhost:4000/invoices**",
  ]) {
    await page.route(url, (route) => route.fulfill({ status: 200, json: [] }));
  }
  await page.route("http://localhost:4000/privacy-notices/current**", (route) =>
    route.fulfill({ status: 200, json: { notice: null } }),
  );
}

for (const lang of LANGS) {
  test(`Part G item 7 — Claim (/opportunities/[id]) four states in ${lang}`, async ({
    page,
  }) => {
    await mockAuth(page, lang);
    await mockOpportunityBase(page);
    await page.route(OPP_URL, (route) =>
      route.fulfill({ status: 200, json: OPPORTUNITY }),
    );

    // loading — the claims block reads the opportunity's policy first, so
    // holding BOTH that and the RFQ list open photographs the screen with a
    // visible loading indicator and the Claims block not yet rendered.
    // `ClaimSection` returns null until its policy resolves, which is why the
    // ABSENCE of the heading is what proves this capture is genuinely
    // mid-flight rather than just an empty screen.
    const gPolicies = gate(paged([POLICY]));
    const gRfqs = gate([]);
    await page.route(OPP_POLICIES_URL, gPolicies.route);
    await page.route(OPP_RFQS_URL, gRfqs.route);
    await page.route(CLAIMS_URL, (route) =>
      route.fulfill({ status: 200, json: paged([CLAIM]) }),
    );
    await page.goto("/opportunities/opp-1");
    await expect(page.getByText(COPY.loading[lang]).first()).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: COPY.claimsHeading[lang],
        exact: true,
      }),
    ).toHaveCount(0);
    await capture(page, "claim", lang, "loading");

    // populated
    gPolicies.resolve();
    gRfqs.resolve();
    await expect(
      page.getByRole("heading", {
        name: COPY.claimsHeading[lang],
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText("CLM-2026-0007")).toBeVisible();
    // The Arabic card must render Arabic LABELS. Each of these three was
    // hardcoded English until item 7's own AR screenshot showed them sitting
    // in the middle of the Arabic claim card — the screenshot caught what the
    // passing test did not, which is the argument for capturing evidence and
    // then looking at it, rather than only asserting.
    //
    // Asserted POSITIVELY, on the Arabic label, rather than as "the English
    // word is absent": `getByText` matches case-insensitive substrings, so a
    // negative check for "adjuster" also matches the adjuster FIRM's name
    // ("Levant Loss Adjusters") — real English data, which stays English by
    // design. A label is translated; a name is not.
    if (lang === "AR") {
      for (const label of [
        "الخسارة بتاريخ", // claimLossOnLabel
        "الخسارة التقديرية", // claimEstimatedLossLabel
        "مُقيِّم الخسائر", // claimAdjusterInlineLabel
      ]) {
        await expect(page.getByText(label, { exact: false }).first()).toBeVisible();
      }
    }
    await capture(page, "claim", lang, "populated");
    await page.unroute(OPP_POLICIES_URL);
    await page.unroute(OPP_RFQS_URL);
    await page.unroute(CLAIMS_URL);

    // empty — an issued policy with no claim against it yet
    await page.route(OPP_POLICIES_URL, (route) =>
      route.fulfill({ status: 200, json: paged([POLICY]) }),
    );
    await page.route(OPP_RFQS_URL, (route) =>
      route.fulfill({ status: 200, json: [] }),
    );
    await page.route(CLAIMS_URL, (route) =>
      route.fulfill({ status: 200, json: paged([]) }),
    );
    await page.goto("/opportunities/opp-1");
    await expect(page.getByText(COPY.claimsNoneYet[lang])).toBeVisible();
    await capture(page, "claim", lang, "empty");
    await page.unroute(CLAIMS_URL);

    // error — the claims read fails while the rest of the screen is fine,
    // which is the failure this block's own alert exists for.
    await page.route(CLAIMS_URL, (route) => route.fulfill(FORBIDDEN));
    await page.goto("/opportunities/opp-1");
    await expect(page.locator('p[role="alert"]').first()).toBeVisible();
    await capture(page, "claim", lang, "error");
  });
}

// --- Renewal --------------------------------------------------------------

const RENEWAL_CASES: RenewalCase[] = [
  {
    id: "ren-1",
    policyId: "pol-1",
    customerId: "cust-1",
    customerLegalName: "شركة الأفق للتأمين",
    policyNumber: "POL-2026-0451",
    insuranceLine: "Property All Risks",
    insurerId: "ins-1",
    policyStatus: "ACTIVE",
    inceptionDate: "2026-10-01",
    expiryDate: "2027-10-01",
    status: "IN_PROGRESS",
    leadTimeDays: 90,
    triggeredAt: "2027-07-03T00:00:00.000Z",
    riskChangedSinceLastRenewal: true,
    insurerTermsWorsened: false,
    retentionEscalatedAt: null,
    open: true,
    requiresRemarketing: true,
    lossRatio: {
      periodClaims: "48000.000",
      periodPremium: "118500.000",
      ratio: "0.4051",
    },
  },
  {
    id: "ren-2",
    policyId: "pol-2",
    customerId: "cust-2",
    customerLegalName: "Cedar Logistics PLC",
    policyNumber: "POL-2026-0388",
    insuranceLine: "Marine Cargo",
    insurerId: "ins-2",
    policyStatus: "ACTIVE",
    inceptionDate: "2026-09-15",
    expiryDate: "2027-09-15",
    status: "RENEWAL_DUE",
    leadTimeDays: 90,
    triggeredAt: "2027-06-17T00:00:00.000Z",
    riskChangedSinceLastRenewal: false,
    insurerTermsWorsened: false,
    retentionEscalatedAt: null,
    open: true,
    requiresRemarketing: false,
    lossRatio: null,
  },
];

const RENEWAL_URL = "http://localhost:4000/renewal-cases";

for (const lang of LANGS) {
  test(`Part G item 7 — Renewal (/renewal-cases) four states in ${lang}`, async ({
    page,
  }) => {
    await mockAuth(page, lang);

    // loading
    const g = gate(RENEWAL_CASES);
    await page.route(RENEWAL_URL, g.route);
    await page.goto("/renewal-cases");
    await expect(
      page.getByRole("heading", { name: COPY.renewalHeading[lang] }),
    ).toBeVisible();
    await expect(page.getByText(COPY.loading[lang]).first()).toBeVisible();
    await capture(page, "renewal", lang, "loading");

    // populated
    g.resolve();
    await expect(page.getByText("POL-2026-0451")).toBeVisible();
    await expect(page.getByText("POL-2026-0388")).toBeVisible();
    await capture(page, "renewal", lang, "populated");
    await page.unroute(RENEWAL_URL);

    // empty
    await page.route(RENEWAL_URL, (route) =>
      route.fulfill({ status: 200, json: [] }),
    );
    await page.goto("/renewal-cases");
    await expect(page.getByText(COPY.renewalNoneYet[lang])).toBeVisible();
    await capture(page, "renewal", lang, "empty");
    await page.unroute(RENEWAL_URL);

    // error
    await page.route(RENEWAL_URL, (route) => route.fulfill(FORBIDDEN));
    await page.goto("/renewal-cases");
    await expect(page.locator('p[role="alert"]').first()).toBeVisible();
    await capture(page, "renewal", lang, "error");
  });
}
