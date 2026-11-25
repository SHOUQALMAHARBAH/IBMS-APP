import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";
import { anchoredCount, expectAbsentWithin } from "./support/anchored";
import {
  expectLayoutOnlyControl,
  useTheme,
  type BaseTheme,
} from "./fixtures/base-style";

const ME_BASE = {
  id: "user-1",
  email: "officer@ibms.test",
  fullName: "Placement Officer",
  languagePreference: "EN",
  mfaEnabled: false,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

/** 🔴 OWNER DECISION 150 RULING 1 — the three lists return a PAGE now, every branch. */
function listPage<T>(items: T[]) {
  return { items, total: items.length, page: 0, pageSize: 50 };
}

async function mockAuth(
  page: Page,
  roles: string[],
  // OWNER DECISION 143's label is ARABIC and ratified, so one test renders the screen in Arabic
  // and reads it off a real DOM. Defaulted to EN so every existing caller is untouched.
  languagePreference: "AR" | "EN" = "EN",
) {
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fake-access-token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      status: 200,
      json: {
        ...ME_BASE,
        languagePreference,
        roles,
        permissions: permissionsForRoles(roles),
      },
    }),
  );
}

/** 🔴 OWNER DECISION 150 RULING 1 — the customer every book-wide list row carries. */
const LIST_CUSTOMER = { id: "cust-1", legalName: "Acme Trading" };

const OPPORTUNITY = {
  id: "opp-1",
  customerId: "cust-1",
  insuranceProgramId: "prog-1",
  isRenewal: false,
  status: "NEEDS_CONFIRMED",
  targetPremiumThreshold: null as string | null,
  createdByUserId: "user-1",
  createdAt: "2026-03-01T00:00:00.000Z",
  updatedAt: "2026-03-01T00:00:00.000Z",
  context: {
    insuranceProgramId: "prog-1",
    customerId: "cust-1",
    // 🔴 OWNER DECISION 163 RULING 1 — the two names the title is made of. A fixture
    // without them renders «Opportunity — undefined», so they are not optional.
    customerLegalName: "Acme Trading",
    insuranceProgramName: "Head office",
  },
};

/*
 * The shortlist picker's list AND the insurer on every submission row (`RFQ` below reads
 * `INSURERS[0]`). It is a SECOND mirror of `insurerIdentity()`'s return beside
 * `INSURER_IDENTITY` — keep both aligned with the wire.
 *
 * ⚠️ `ins-1` CARRIES AN ARABIC NAME AND `ins-2` DELIBERATELY DOES NOT. Both halves are load
 * bearing: with `nameAr: null` on ins-1 an Arabic render falls back to the Latin name, so the
 * by-language test would have passed against the very defect it exists to catch — measured, it
 * did, on the first run. ins-2 keeps `null` so the FALLBACK direction stays exercised, because
 * an insurer with no Arabic name must still render something rather than a blank cell.
 *
 * ⛔ The Arabic is COPIED from `apps/api/test/insurer-crud.e2e-spec.ts`, which has shipped it as
 * an insurer fixture name since that suite was written. No Arabic is invented here.
 */
const INSURERS = [
  {
    id: "ins-1",
    name: "Jordan Insurance Co",
    nameAr: "وادي رم التعاونية",
    financialStrengthRating: "A-",
  },
  {
    id: "ins-2",
    name: "Middle East Assurance",
    nameAr: null,
    financialStrengthRating: null,
  },
];

/**
 * §P3 — what `GET /rfqs/available-lines` returns for `opp-1`.
 *
 * ⚠️ The Arabic is the CATALOGUE's own, carried on the wire by the server — see
 * `insurance-line-names.ts` for why the screen cannot look it up. Copied from the seeded
 * `InsuranceLine` row for PROPERTY_ALL_RISKS; ⛔ no Arabic is invented here.
 */
const AVAILABLE_LINES = [
  {
    insuranceLine: "Property All Risks",
    insuranceLineAr: "تأمين جميع أخطار الممتلكات",
  },
  { insuranceLine: "Business Interruption", insuranceLineAr: null },
];

const RFQ = {
  id: "rfq-1",
  opportunityId: "opp-1",
  insuranceLine: "Property All Risks",
  issuedAt: "2026-03-02T00:00:00.000Z",
  followUpThresholdDays: 9,
  issuedByUserId: "user-1",
  opportunity: { customerId: "cust-1" },
  insurerSubmissions: [
    {
      id: "sub-1",
      rfqId: "rfq-1",
      insurerId: "ins-1",
      status: "SENT",
      sentAt: "2026-03-02T00:00:00.000Z",
      respondedAt: null,
      followUpAlertSentAt: null,
      insurer: INSURERS[0],
    },
  ],
};

/**
 * The insurer identity the API returns, mirrored here.
 *
 * This fixture used to be the only place the FLATTENED shape existed: the API
 * passed the raw Prisma join through on three endpoints, so `insurer.name` was
 * undefined in production while this mock supplied it and every web test passed.
 * The mock was asserting the shape the web wished for. Those three views now
 * flatten through `insurerIdentity()` and each has an API-side assertion on its
 * own wire shape, so this is a mirror of a checked contract rather than the
 * authority on an unchecked one.
 *
 * 🔴 CORRECTED 2026-11-17 — IT WAS FOUR ENDPOINTS, NOT THREE, AND THE FOURTH WAS
 * STILL BROKEN UNDER THIS PARAGRAPH. The owner's demo-path walk (§W3) found the
 * submissions table on `/rfqs/[id]` rendering an EMPTY insurer column: `GET
 * /rfqs/:id` was never added to the set this comment describes, so the same
 * defect survived in a fourth place while the text above said it had been dealt
 * with — and this mock supplied the wished-for shape there too, exactly as it
 * once did for the other three. The RFQ's reads flatten now, and
 * `rfq-oversight-read.e2e-spec.ts` carries the matching wire-shape assertion.
 *
 * ⟶ A fixture that supplies a shape the API does not send is not a neutral
 *   convenience: it is the thing that keeps a whole suite green over a blank
 *   screen. When this mirror and the wire disagree, the WIRE is the defect.
 *
 * Keep it aligned with `insurerIdentity()`'s return. `isActive` is part of that
 * contract because a deactivated insurer's quote stays comparable and has to be
 * marked wherever it can be chosen.
 *
 * ⚠️ `nameAr` CARRIES AN ARABIC NAME, AND IT IS NOT A NEW ONE. With `null` there
 * an Arabic render falls back to the Latin name and the by-language test below
 * would pass against the very defect it exists to catch. The string is COPIED
 * from `apps/api/test/insurer-crud.e2e-spec.ts`, which has shipped it as an
 * insurer fixture name since that suite was written — ⛔ no Arabic is invented
 * here, not even for test data, because a name nobody ratified is a name that
 * can escape a fixture into a screen.
 */
const INSURER_IDENTITY = {
  id: "ins-1",
  name: "Jordan Insurance Co",
  nameAr: "وادي رم التعاونية",
  financialStrengthRating: "A-",
  isActive: true,
};

function quoteVersion(over: Record<string, unknown> = {}) {
  return {
    id: "q-1",
    rfqId: "rfq-1",
    insurerId: "ins-1",
    versionNumber: 1,
    previousVersionId: null,
    isCurrentVersion: true,
    premium: "125000.5",
    currency: "JOD",
    deductible: null,
    limits: null,
    biPeriodMonths: null,
    liabilityLimit: null,
    exclusions: null,
    conditions: null,
    commissionRatePercent: null,
    negotiationNotes: null,
    receivedAt: "2026-03-05T00:00:00.000Z",
    capturedByUserId: "user-1",
    insurer: INSURER_IDENTITY,
    rfq: {
      id: "rfq-1",
      opportunityId: "opp-1",
      insuranceLine: "Property All Risks",
    },
    ...over,
  };
}

/** Part C #15 — the round-by-round projection the API returns alongside a
 * chain's raw versions. `versions` here are ordered oldest-first. */
function negotiationHistory(
  versions: ReturnType<typeof quoteVersion>[],
): Record<string, unknown>[] {
  return versions.map((v, index) => {
    const prev = index === 0 ? null : versions[index - 1];
    return {
      round: index,
      versionNumber: v.versionNumber,
      isCurrentVersion: v.isCurrentVersion,
      receivedAt: v.receivedAt,
      capturedByUserId: v.capturedByUserId,
      premium: v.premium,
      premiumDeltaFromPrevious:
        prev === null
          ? null
          : (Number(v.premium) - Number(prev.premium)).toFixed(3),
      changedTermFields:
        prev === null
          ? []
          : Number(v.premium) === Number(prev.premium)
            ? []
            : ["premium"],
      negotiationNotes: v.negotiationNotes ?? null,
    };
  });
}

async function mockRfqApi(
  page: Page,
  opts: {
    /** Serve the insurer as deactivated everywhere this fixture returns one —
     *  the comparison rows, the quotation chains and the recommendation. Used by
     *  the marker test, because all three read the same identity. */
    insurerDeactivated?: boolean;
    onCreateRfq?: () => void;
    onTransition?: (status: string) => void;
    onLogComm?: (body: { direction: string; body: string }) => void;
    onCaptureQuote?: (body: { insurerId: string; premium: string }) => void;
    onReviseQuote?: (body: {
      premium: string;
      negotiationNotes?: string;
    }) => void;
    onBuildComparison?: (body: {
      rfqId: string;
      scores?: { insurerId: string }[];
    }) => void;
    onDraftRecommendation?: (body: {
      recommendedQuotationId: string;
      rationale: string;
    }) => void;
    onClientDecision?: (body: {
      decision: string;
      evidenceRef: string;
    }) => void;
    onPlacePolicy?: (body: {
      opportunityId: string;
      inceptionDate: string;
    }) => void;
    onRecordIssuance?: (body: {
      policyNumber: string;
      issuedPremium: string;
    }) => void;
    onCheckPolicy?: (body: {
      requestedCoverage: {
        limits: Record<string, unknown>;
        namedPerils?: string[];
      };
    }) => void;
    onRecordDelivery?: (body: { method: string; recipient: string }) => void;
    onRequestEndorsement?: (body: {
      type: string;
      changeType: string;
      premiumAmount: string;
    }) => void;
    onNotifyClaim?: (body: {
      policyId: string;
      lossDate: string;
      causeOfLoss: string;
      estimatedLoss: string;
      isThirdPartyInvolved?: boolean;
    }) => void;
    onRegisterClaim?: (body: {
      insurerClaimReference: string;
      claimNumber?: string;
      adjuster: { name: string; firm?: string };
    }) => void;
    onAttachClaimDocs?: (body: {
      documents: { docType: string; classification: string }[];
    }) => void;
    onClaimAssessment?: (body: Record<string, unknown>) => void;
    onClaimFollowUp?: (body: Record<string, unknown>) => void;
    onClaimSettlement?: (body: Record<string, unknown>) => void;
    onClaimClosure?: (body: Record<string, unknown>) => void;
    onCreateInvoice?: (body: Record<string, unknown>) => void;
    onCollectionStep?: (body: Record<string, unknown>) => void;
    /** pre-seed an already-ISSUED policy (a checker opening one they did not place) */
    seedIssuedPolicy?: boolean;
    /** pre-seed an ACTIVE policy (delivered + acknowledged) — Process 22 needs one */
    seedActivePolicy?: boolean;
    /** A declared combined-duty act on the seeded policy's quality check — Part 4 step 5. */
    seedCombinedDutyAct?: {
      id: string;
      at: string;
      actorUserId: string;
      reason: string;
      pair: string;
      roles: string[];
      hatAmbiguous: boolean;
    } | null;
    /**
     * A declared combined-duty act on the seeded RECOMMENDATION's approval — Part 4 step 5, a
     * different pair on a different record. Passing this also pre-seeds an APPROVED recommendation,
     * because an act without an approval is a state the server cannot produce.
     */
    seedRecommendationCombinedDutyAct?: {
      id: string;
      at: string;
      actorUserId: string;
      reason: string;
      pair: string;
      roles: string[];
      hatAmbiguous: boolean;
    } | null;
    /** pre-seed an APPROVED recommendation with no declaration — the ordinary two-person case. */
    seedApprovedRecommendation?: boolean;
    opportunityStatus?: string;
  } = {},
) {
  // The identity this fixture serves, honouring `insurerDeactivated`. Local rather
  // than a mutated module constant: these specs share a module instance within a
  // worker, and a test that flipped a shared object would change what the next one
  // sees.
  const insurer = opts.insurerDeactivated
    ? { ...INSURER_IDENTITY, isActive: false }
    : INSURER_IDENTITY;
  /** A quote version carrying this fixture's identity — the comparison rows embed
   *  a quotation, so the flag has to reach them through here too. */
  const quote = (over: Record<string, unknown> = {}) =>
    quoteVersion({ insurer, ...over });

  // Correspondence log — starts empty, a POST appends so the list re-renders
  // with the new row.
  const comms: Record<string, unknown>[] = [];

  // Quotation chains — starts empty; a capture POST adds a chain, a revise
  // POST appends a version so the section re-renders.
  type QuoteChain = {
    rfqId: string;
    insurerId: string;
    insuranceLine: string;
    insurer: typeof INSURER_IDENTITY;
    current: ReturnType<typeof quoteVersion>;
    versions: ReturnType<typeof quoteVersion>[];
    history: Record<string, unknown>[];
  };
  let chains: QuoteChain[] = [];

  await page.route("http://localhost:4000/quotations**", (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (method === "POST" && /\/quotations\/[^/]+\/revise(\?|$)/.test(url)) {
      const b = route.request().postDataJSON() as {
        premium: string;
        negotiationNotes?: string;
      };
      opts.onReviseQuote?.(b);
      const v1 = quote({ isCurrentVersion: false });
      const v2 = quote({
        id: "q-2",
        versionNumber: 2,
        previousVersionId: "q-1",
        premium: b.premium,
        negotiationNotes: b.negotiationNotes ?? null,
      });
      chains = [
        {
          rfqId: "rfq-1",
          insurerId: "ins-1",
          insuranceLine: "Property All Risks",
          insurer,
          current: v2,
          versions: [v1, v2],
          history: negotiationHistory([v1, v2]),
        },
      ];
      return route.fulfill({ status: 201, json: chains[0] });
    }
    if (method === "POST" && /\/quotations(\?|$)/.test(url.split("?")[0])) {
      const b = route.request().postDataJSON() as {
        insurerId: string;
        premium: string;
      };
      opts.onCaptureQuote?.(b);
      const v1 = quote({ premium: b.premium });
      chains = [
        {
          rfqId: "rfq-1",
          insurerId: "ins-1",
          insuranceLine: "Property All Risks",
          insurer,
          current: v1,
          versions: [v1],
          history: negotiationHistory([v1]),
        },
      ];
      return route.fulfill({ status: 201, json: chains[0] });
    }
    return route.fulfill({ status: 200, json: chains });
  });

  // Comparison matrix — 404 until built, then a POST returns/stores it.
  let matrix: Record<string, unknown> | null = null;
  const buildMatrix = () => ({
    id: "cm-1",
    rfqId: "rfq-1",
    insuranceLine: "Property All Risks",
    builtAt: "2026-03-07T00:00:00.000Z",
    builtByUserId: "user-1",
    rows: [
      {
        id: "row-1",
        quotationId: "q-1",
        insurerQualityScore: null,
        serviceScore: null,
        quotation: quote({ premium: "125000.500" }),
      },
    ],
    missingInsurers: [
      { id: "ins-2", name: "Middle East Assurance", status: "NO_RESPONSE" },
    ],
    declinedInsurers: [] as { id: string; name: string }[],
  });

  await page.route("http://localhost:4000/comparison-matrices**", (route) => {
    const method = route.request().method();
    if (method === "POST") {
      const b = route.request().postDataJSON() as {
        rfqId: string;
        scores?: { insurerId: string }[];
      };
      opts.onBuildComparison?.(b);
      matrix = buildMatrix();
      return route.fulfill({ status: 201, json: matrix });
    }
    if (matrix === null) {
      return route.fulfill({
        status: 404,
        json: {
          message: "No comparison matrix has been built for this RFQ yet.",
        },
      });
    }
    return route.fulfill({ status: 200, json: matrix });
  });

  // Opportunity — the detail GET reflects the current threshold; a PATCH
  // (Part C #16) updates it in place.
  const opp = {
    ...OPPORTUNITY,
    status: opts.opportunityStatus ?? OPPORTUNITY.status,
  };
  await page.route("http://localhost:4000/opportunities**", (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (method === "PATCH" && /\/target-premium-threshold(\?|$)/.test(url)) {
      const b = route.request().postDataJSON() as {
        targetPremiumThreshold: string | null;
      };
      opp.targetPremiumThreshold = b.targetPremiumThreshold;
      return route.fulfill({ status: 200, json: opp });
    }
    if (/\/opportunities\/opp-1(\?|$)/.test(url)) {
      return route.fulfill({ status: 200, json: opp });
    }
    /*
     * 🔴 OWNER DECISION 150 RULING 1 — the list returns a PAGE now, and its rows name their
     * customer. ⛔ The customer is added HERE and not on the `OPPORTUNITY` fixture above: the
     * DETAIL route does not send it, and a fixture that handed both branches the same shape
     * would be a fixture agreeing with a defect rather than with the product.
     */
    return route.fulfill({
      status: 200,
      json: listPage([{ ...opp, customer: LIST_CUSTOMER }]),
    });
  });

  // Broker recommendation (Part C #16) — starts empty; a POST drafts it, and
  // approve / disclose / send each mutate the single row in place.
  let recommendation: Record<string, unknown> | null = null;
  if (
    opts.seedApprovedRecommendation ||
    opts.seedRecommendationCombinedDutyAct
  ) {
    // An act without an approval is a state the server cannot produce, so both options seed the SAME
    // approved row and differ only in whether a declaration sits on it.
    recommendation = {
      id: "rec-1",
      opportunityId: "opp-1",
      customerId: "cust-1",
      recommendedQuotation: {
        id: "q-1",
        insurerId: "ins-1",
        insurer,
        insuranceLine: "Property All Risks",
        /* 🔴 THE FINAL WALK §ب-٧ — the Arabic line name, which the api now resolves from the
           catalogue row the RFQ points at. A fixture carrying Arabic in `insuranceLine`
           instead would pass against a card that never reads the pair, which is the vacuity
           message 49 §1 item 5 measured in four document fixtures. */
        insuranceLineAr: "تأمين جميع أخطار الممتلكات",
        premium: "12000.000",
        currency: "JOD",
        commissionRatePercent: "17.5",
      },
      rationale:
        "Widest cover for the price, and the insurer settles claims fastest of the three.",
      rationaleFactors: {},
      approvalRequired: true,
      approvedByUserId: opts.seedRecommendationCombinedDutyAct
        ? "user-1"
        : "mgr-1",
      approvedAt: "2026-03-09T00:00:00.000Z",
      conflictOfInterestFlagged: false,
      coiCompetingQuotationId: null,
      coiCommissionDiffPercent: null,
      conflictOfInterestDisclosure: null,
      sentToClientAt: null,
      sentByUserId: null,
      draftedByUserId: "user-1",
      createdAt: "2026-03-08T00:00:00.000Z",
      combinedDutyAct: opts.seedRecommendationCombinedDutyAct ?? null,
      blockedFromSend: [] as string[],
    };
  }
  const recBlocked = () => {
    const blocked: string[] = [];
    if (
      (recommendation?.approvalRequired as boolean) &&
      recommendation?.approvedByUserId == null
    ) {
      blocked.push(
        "Senior-officer approval is required (recommended premium exceeds the Opportunity target threshold).",
      );
    }
    if (
      (recommendation?.conflictOfInterestFlagged as boolean) &&
      recommendation?.conflictOfInterestDisclosure == null
    ) {
      blocked.push(
        "A conflict-of-interest disclosure is required before this recommendation can be sent.",
      );
    }
    return blocked;
  };
  await page.route("http://localhost:4000/recommendations**", (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (method === "POST" && /\/recommendations\/[^/]+\/approve/.test(url)) {
      recommendation = { ...recommendation, approvedByUserId: "mgr-1" };
      recommendation.blockedFromSend = recBlocked();
      return route.fulfill({ status: 201, json: recommendation });
    }
    if (method === "POST" && /\/conflict-of-interest-disclosure/.test(url)) {
      recommendation = {
        ...recommendation,
        conflictOfInterestDisclosure: {
          id: "coi-1",
          competingQuotationId: "q-1",
          commissionDifferencePercent: "7.50",
          disclosureText: "Disclosed to the client.",
          acknowledgedByUserId: "cmp-1",
          acknowledgedAt: "2026-03-09T00:00:00.000Z",
        },
      };
      recommendation.blockedFromSend = recBlocked();
      return route.fulfill({ status: 201, json: recommendation });
    }
    if (method === "POST" && /\/recommendations\/[^/]+\/send/.test(url)) {
      recommendation = {
        ...recommendation,
        sentToClientAt: "2026-03-10T00:00:00.000Z",
      };
      recommendation.blockedFromSend = [];
      return route.fulfill({ status: 201, json: recommendation });
    }
    if (method === "POST") {
      const b = route.request().postDataJSON() as {
        recommendedQuotationId: string;
        rationale: string;
        rationaleFactors: Record<string, string>;
      };
      opts.onDraftRecommendation?.(b);
      const q = quote({ premium: "125000.500" });
      recommendation = {
        id: "rec-1",
        opportunityId: "opp-1",
        customerId: "cust-1",
        recommendedQuotation: {
          id: q.id,
          insurerId: q.insurerId,
          insurer,
          insuranceLine: "Property All Risks",
          premium: q.premium,
          currency: "JOD",
          commissionRatePercent: "17.5",
        },
        rationale: b.rationale,
        rationaleFactors: b.rationaleFactors,
        approvalRequired: true,
        approvedByUserId: null,
        approvedAt: null,
        conflictOfInterestFlagged: true,
        coiCompetingQuotationId: "q-2",
        coiCommissionDiffPercent: "7.50",
        conflictOfInterestDisclosure: null,
        sentToClientAt: null,
        sentByUserId: null,
        draftedByUserId: "user-1",
        createdAt: "2026-03-08T00:00:00.000Z",
        // The endpoint returns this now. Null on a freshly drafted row: nothing has approved it.
        combinedDutyAct: null,
        blockedFromSend: [] as string[],
      };
      recommendation.blockedFromSend = recBlocked();
      return route.fulfill({ status: 201, json: recommendation });
    }
    return route.fulfill({
      status: 200,
      json: recommendation ? [recommendation] : [],
    });
  });

  // Client decision (Part C #17) — starts empty; a POST records the single
  // decision and routes the mocked opportunity.
  let clientDecision: Record<string, unknown> | null = null;
  const ROUTE_BY_DECISION: Record<string, [string, string]> = {
    ACCEPT: ["PLACEMENT", "Proceed to placement"],
    REJECT: ["CLOSED_LOST", "Close the request"],
    REQUEST_FURTHER_NEGOTIATION: ["RENEGOTIATE", "Renewed negotiation"],
    REQUEST_ALTERNATIVE_OPTIONS: ["RENEGOTIATE", "Renewed negotiation"],
    REQUEST_PRICE_REDUCTION: ["RENEGOTIATE", "Renewed negotiation"],
    REQUEST_COVERAGE_INCREASE: ["RENEGOTIATE", "Renewed negotiation"],
  };
  await page.route("http://localhost:4000/client-decisions**", (route) => {
    const method = route.request().method();
    if (method === "POST") {
      const b = route.request().postDataJSON() as {
        decision: string;
        evidenceType: string;
        evidenceRef: string;
        notes?: string;
      };
      opts.onClientDecision?.(b);
      const [routeName, label] = ROUTE_BY_DECISION[b.decision] ?? [
        "PLACEMENT",
        "Proceed to placement",
      ];
      opp.status = routeName;
      clientDecision = {
        id: "cd-1",
        opportunityId: "opp-1",
        customerId: "cust-1",
        decision: b.decision,
        route: routeName,
        routeLabel: label,
        evidenceType: b.evidenceType,
        evidenceRef: b.evidenceRef,
        notes: b.notes ?? null,
        capturedByUserId: "user-1",
        decidedAt: "2026-03-12T00:00:00.000Z",
        opportunityStatus: routeName,
        routingComplete: true,
      };
      return route.fulfill({ status: 201, json: clientDecision });
    }
    return route.fulfill({
      status: 200,
      json: clientDecision ? [clientDecision] : [],
    });
  });

  // Policy (Part C #18-19) — starts empty; a POST /policies places it
  // (PLACEMENT_CONFIRMED), a POST /policies/:id/issuance moves it to ISSUED
  // with a schedule + documents, a POST /policies/:id/documents appends more.
  const seededSchedule = {
    id: "sch-1",
    effectiveFrom: "2026-10-01T00:00:00.000Z",
    effectiveTo: null,
    limits: { buildings: "5000000.000" },
    sumsInsured: { total: "5000000.000" },
    namedPerils: ["fire", "flood"],
    extensions: [],
    sourceEndorsementId: null,
    createdAt: "2026-10-01T00:00:00.000Z",
  };
  let policy: Record<string, unknown> | null =
    opts.seedIssuedPolicy || opts.seedActivePolicy
      ? {
          id: "pol-1",
          opportunityId: "opp-1",
          customerId: "cust-1",
          insurerId: "ins-1",
          insurer,
          policyNumber: "POL-SEED-1",
          insuranceLine: "Property All Risks",
          status: opts.seedActivePolicy ? "ACTIVE" : "ISSUED",
          inceptionDate: "2026-10-01T00:00:00.000Z",
          expiryDate: opts.seedActivePolicy ? "2027-10-01T00:00:00.000Z" : null,
          requestedPremium: "120000.000",
          issuedPremium: "120000.000",
          premiumVariance: "0.000",
          currency: "JOD",
          placedByUserId: "someone-else",
          issuedByUserId: "someone-else",
          schedules: [seededSchedule],
          documents: [],
          checking: opts.seedActivePolicy
            ? {
                placedByUserId: "someone-else",
                checkedByUserId: "chk-1",
                // OWNER DECISION 153 §٢ row ٧ (amended by 157 table أ) — the wire carries the
                // checker's NAME now, resolved server-side. A fixture that left this out would
                // render «—» and the Arabic-no-English assertion below would still pass, so it
                // is a real name and the test asserts the name is on the screen.
                checkedByName: "سامر الحديد",
                checkedAt: "2026-10-05T00:00:00.000Z",
                discrepancyFound: false,
                discrepancyDetail: null,
                discrepancyLoggedAsPiRiskEvent: false,
                complianceOverrideByUserId: null,
                checklist: {},
                createdAt: "2026-10-05T00:00:00.000Z",
                // The endpoint returns this now, so the fixture carries it. `null` is the ordinary
                // two-person check, which is what this seed represents — `chk-1` checked what
                // `someone-else` placed.
                combinedDutyAct: opts.seedCombinedDutyAct ?? null,
              }
            : null,
          delivery: opts.seedActivePolicy
            ? {
                deliveredAt: "2026-10-08T00:00:00.000Z",
                method: "courier",
                recipient: "Acme Risk Dept",
                receiptAcknowledgedAt: "2026-10-10T00:00:00.000Z",
              }
            : null,
          issuanceComplete: true,
          checkingComplete: Boolean(opts.seedActivePolicy),
          deliveryComplete: Boolean(opts.seedActivePolicy),
          createdAt: "2026-09-15T00:00:00.000Z",
          updatedAt: "2026-10-01T00:00:00.000Z",
        }
      : null;

  // Process 22 — endorsements against the policy. Starts empty; a POST
  // /policies/:id/endorsements (or /cancellation) appends a REQUESTED row.
  const endorsements: Record<string, unknown>[] = [];
  await page.route("http://localhost:4000/policies**", (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (/\/policies\/[^/]+\/endorsements(\?|$)/.test(url)) {
      if (method === "POST") {
        const b = route.request().postDataJSON() as {
          type: "POSITIVE" | "NEGATIVE";
          changeType: string;
          premiumAmount: string;
        };
        opts.onRequestEndorsement?.(b);
        const row = {
          id: `end-${endorsements.length + 1}`,
          policyId: "pol-1",
          customerId: "cust-1",
          type: b.type,
          changeType: b.changeType,
          status: "REQUESTED",
          premiumAdjustment:
            (b.type === "NEGATIVE" ? "-" : "") + b.premiumAmount,
          requestedByUserId: "user-1",
          submittedToInsurerAt: null,
          insurerConfirmedAt: null,
          financialAdjustmentCalculatedAt: null,
          appliedAt: null,
          clientNotifiedAt: null,
          cancellation: null,
          refund: null,
          commissionReversal: null,
          scheduleVersioned: false,
          createdAt: "2026-11-01T00:00:00.000Z",
        };
        endorsements.push(row);
        return route.fulfill({ status: 201, json: row });
      }
      return route.fulfill({ status: 200, json: endorsements });
    }
    if (
      method === "POST" &&
      /\/policies\/[^/]+\/cancellation(\?|$)/.test(url)
    ) {
      const b = route.request().postDataJSON() as {
        reason: string;
        basis: string;
      };
      const row = {
        id: `end-${endorsements.length + 1}`,
        policyId: "pol-1",
        customerId: "cust-1",
        type: "NEGATIVE",
        changeType: "cancellation",
        status: "REQUESTED",
        premiumAdjustment: "-1972.603",
        requestedByUserId: "user-1",
        submittedToInsurerAt: null,
        insurerConfirmedAt: null,
        financialAdjustmentCalculatedAt: null,
        appliedAt: null,
        clientNotifiedAt: null,
        cancellation: {
          reason: b.reason,
          basis: b.basis,
          returnPremium: "1972.603",
          clientNotifiedAt: null,
        },
        refund: null,
        commissionReversal: null,
        scheduleVersioned: false,
        createdAt: "2026-11-01T00:00:00.000Z",
      };
      endorsements.push(row);
      return route.fulfill({ status: 201, json: row });
    }
    if (method === "POST" && /\/policies\/[^/]+\/issuance(\?|$)/.test(url)) {
      const b = route.request().postDataJSON() as {
        policyNumber: string;
        issuedPremium: string;
        schedule: {
          limits: Record<string, unknown>;
          sumsInsured: Record<string, unknown>;
          namedPerils?: string[];
          extensions?: string[];
        };
        documents: {
          category: string;
          classification: string;
          fileName: string;
        }[];
      };
      opts.onRecordIssuance?.(b);
      policy = {
        ...(policy ?? {}),
        status: "ISSUED",
        policyNumber: b.policyNumber,
        issuedPremium: b.issuedPremium,
        premiumVariance: "-1500.000",
        issuedByUserId: "user-1",
        issuanceComplete: true,
        checking: null,
        checkingComplete: false,
        schedules: [
          {
            id: "sch-1",
            effectiveFrom: "2026-10-01T00:00:00.000Z",
            effectiveTo: null,
            limits: b.schedule.limits,
            sumsInsured: b.schedule.sumsInsured,
            namedPerils: b.schedule.namedPerils ?? [],
            extensions: b.schedule.extensions ?? [],
            sourceEndorsementId: null,
            createdAt: "2026-10-01T00:00:00.000Z",
          },
        ],
        documents: b.documents.map((d, i) => ({
          ...d,
          id: `doc-${i}`,
          storageRef: `s3://x/${i}`,
          versionNumber: 1,
          previousVersionId: null,
          uploadedByUserId: "user-1",
          createdAt: "2026-10-01T00:00:00.000Z",
        })),
      };
      return route.fulfill({ status: 201, json: policy });
    }
    if (method === "POST" && /\/policies\/[^/]+\/checking(\?|$)/.test(url)) {
      const b = route.request().postDataJSON() as {
        requestedCoverage: {
          limits: Record<string, unknown>;
          namedPerils?: string[];
        };
      };
      opts.onCheckPolicy?.(b);
      const issuedLimits =
        ((policy?.schedules as { limits?: Record<string, unknown> }[]) ?? [])[0]
          ?.limits ?? {};
      const mismatch =
        JSON.stringify(b.requestedCoverage.limits) !==
        JSON.stringify(issuedLimits);
      policy = {
        ...(policy ?? {}),
        status: mismatch ? "DISCREPANCY" : "VERIFIED",
        checkingComplete: true,
        checking: {
          placedByUserId: "user-1",
          checkedByUserId: "chk-1",
          // DECISION 153 §٢ row ٧ — the name the line renders; see the seeded fixture above.
          checkedByName: "سامر الحديد",
          checkedAt: "2026-10-05T00:00:00.000Z",
          discrepancyFound: mismatch,
          discrepancyDetail: mismatch
            ? "limits.buildings: requested 8000000.000, issued 5000000.000"
            : null,
          discrepancyLoggedAsPiRiskEvent: mismatch,
          complianceOverrideByUserId: null,
          checklist: {},
          createdAt: "2026-10-05T00:00:00.000Z",
        },
      };
      return route.fulfill({ status: 201, json: policy });
    }
    if (
      method === "POST" &&
      /\/policies\/[^/]+\/delivery\/acknowledge-receipt(\?|$)/.test(url)
    ) {
      policy = {
        ...(policy ?? {}),
        status: "ACTIVE",
        deliveryComplete: true,
        delivery: {
          ...((policy?.delivery as Record<string, unknown>) ?? {}),
          receiptAcknowledgedAt: "2026-10-10T00:00:00.000Z",
        },
      };
      return route.fulfill({ status: 201, json: policy });
    }
    if (method === "POST" && /\/policies\/[^/]+\/delivery(\?|$)/.test(url)) {
      const b = route.request().postDataJSON() as {
        method: string;
        recipient: string;
      };
      opts.onRecordDelivery?.(b);
      policy = {
        ...(policy ?? {}),
        status: "DELIVERED",
        delivery: {
          deliveredAt: "2026-10-08T00:00:00.000Z",
          method: b.method,
          recipient: b.recipient,
          receiptAcknowledgedAt: null,
        },
        deliveryComplete: false,
      };
      return route.fulfill({ status: 201, json: policy });
    }
    if (method === "POST" && /\/policies\/[^/]+\/documents(\?|$)/.test(url)) {
      const b = route.request().postDataJSON() as {
        documents: {
          category: string;
          classification: string;
          fileName: string;
        }[];
      };
      const existing = (policy?.documents as unknown[]) ?? [];
      policy = {
        ...(policy ?? {}),
        documents: [
          ...existing,
          ...b.documents.map((d, i) => ({
            ...d,
            id: `doc-extra-${i}`,
            storageRef: `s3://x/extra-${i}`,
            versionNumber: 1,
            previousVersionId: null,
            uploadedByUserId: "user-1",
            createdAt: "2026-10-02T00:00:00.000Z",
          })),
        ],
      };
      return route.fulfill({ status: 201, json: policy });
    }
    if (method === "POST" && /\/policies(\?|$)/.test(url.split("?")[0])) {
      const b = route.request().postDataJSON() as {
        opportunityId: string;
        inceptionDate: string;
      };
      opts.onPlacePolicy?.(b);
      policy = {
        id: "pol-1",
        opportunityId: "opp-1",
        customerId: "cust-1",
        insurerId: "ins-1",
        insurer,
        policyNumber: null,
        insuranceLine: "Property All Risks",
        status: "PLACEMENT_CONFIRMED",
        inceptionDate: `${b.inceptionDate}T00:00:00.000Z`,
        expiryDate: null,
        requestedPremium: "120000.000",
        issuedPremium: null,
        premiumVariance: null,
        currency: "JOD",
        placedByUserId: "user-1",
        issuedByUserId: null,
        schedules: [],
        documents: [],
        checking: null,
        delivery: null,
        issuanceComplete: false,
        checkingComplete: false,
        deliveryComplete: false,
        createdAt: "2026-09-15T00:00:00.000Z",
        updatedAt: "2026-09-15T00:00:00.000Z",
      };
      return route.fulfill({ status: 201, json: policy });
    }
    return route.fulfill({ status: 200, json: paged(policy ? [policy] : []) });
  });

  // Process 31-32 — the premium invoice + its collection cycle. Starts empty;
  // a POST /invoices composes it (premium carried, commission netted at 12%,
  // total = premium + tax + fees - commission); POST /invoices/:id/receipt |
  // /reconcile | /remittance walk it INVOICED -> COLLECTED -> RECONCILED ->
  // REMITTED, attaching the receipt / remittance sub-objects.
  const PREMIUM = 120000;
  const COMMISSION = PREMIUM * 0.12;
  const invoiceRows: Record<string, unknown>[] = [];
  await page.route("http://localhost:4000/invoices**", (route) => {
    const url = route.request().url();
    const method = route.request().method();
    const inv = invoiceRows[0] as Record<string, unknown> | undefined;

    if (method === "POST" && /\/invoices\/[^/]+\/receipt(\?|$)/.test(url)) {
      const b = route.request().postDataJSON() as {
        amount: string;
        method?: string;
      };
      opts.onCollectionStep?.({ step: "receipt", ...b });
      if (inv) {
        const receipts = (inv.receipts ?? []) as Record<string, unknown>[];
        receipts.push({
          id: `rcpt-${receipts.length + 1}`,
          amount: b.amount,
          method: b.method ?? null,
          receivedAt: "2026-09-20T00:00:00.000Z",
        });
        const collected = receipts.reduce(
          (sum, r) => sum + Number(r.amount as string),
          0,
        );
        const total = Number(inv.totalAmount as string);
        inv.receipts = receipts;
        inv.receipt = receipts[receipts.length - 1];
        inv.collectedAmount = collected.toFixed(3);
        inv.outstandingAmount = Math.max(0, total - collected).toFixed(3);
        inv.fullyCollected = collected >= total;
        // Only the instalment that completes the invoice moves it on.
        if (collected >= total) inv.status = "COLLECTED";
      }
      return route.fulfill({ status: 201, json: inv });
    }
    if (method === "POST" && /\/invoices\/[^/]+\/reconcile(\?|$)/.test(url)) {
      opts.onCollectionStep?.({ step: "reconcile" });
      if (inv) inv.status = "RECONCILED";
      return route.fulfill({ status: 201, json: inv });
    }
    if (method === "POST" && /\/invoices\/[^/]+\/remittance(\?|$)/.test(url)) {
      opts.onCollectionStep?.({ step: "remittance" });
      if (inv) {
        inv.status = "REMITTED";
        inv.remittance = {
          id: "rem-1",
          amount: (PREMIUM - COMMISSION).toFixed(3),
          insurerId: "ins-1",
          remittedAt: "2026-09-25T00:00:00.000Z",
        };
      }
      return route.fulfill({ status: 201, json: inv });
    }

    if (method === "POST" && /\/invoices(\?|$)/.test(url.split("?")[0])) {
      const b = route.request().postDataJSON() as {
        policyId: string;
        taxAmount: string;
        feesAmount?: string;
        dueDate: string;
      };
      opts.onCreateInvoice?.(b);
      if (invoiceRows.length > 0) {
        return route.fulfill({
          status: 409,
          json: {
            message: "A premium invoice already exists for this policy.",
          },
        });
      }
      const tax = Number(b.taxAmount) || 0;
      const fees = Number(b.feesAmount) || 0;
      const row = {
        id: "inv-1",
        policyId: b.policyId,
        customerId: "cust-1",
        invoiceType: "new_business_premium",
        premiumAmount: PREMIUM.toFixed(3),
        taxAmount: tax.toFixed(3),
        feesAmount: fees.toFixed(3),
        commissionDeducted: COMMISSION.toFixed(3),
        totalAmount: (PREMIUM + tax + fees - COMMISSION).toFixed(3),
        currency: "JOD",
        dueDate: `${b.dueDate}T00:00:00.000Z`,
        status: "INVOICED",
        createdAt: "2026-09-16T00:00:00.000Z",
        netRemittance: (PREMIUM - COMMISSION).toFixed(3),
        // Process 32 — an invoice may be settled in instalments, so the view
        // carries the running totals alongside the receipt list.
        receipts: [],
        receipt: null,
        collectedAmount: "0.000",
        outstandingAmount: (PREMIUM + tax + fees - COMMISSION).toFixed(3),
        fullyCollected: false,
        remittance: null,
      };
      invoiceRows.push(row);
      return route.fulfill({ status: 201, json: row });
    }
    return route.fulfill({ status: 200, json: invoiceRows });
  });

  // Process 23-24 — claims against the policy. Starts empty; a POST /claims
  // appends a NOTIFIED row; a POST /claims/:id/registration moves it to
  // REGISTERED and attaches the insurer ref + adjuster.
  const claimRows: Record<string, unknown>[] = [];
  await page.route("http://localhost:4000/claims**", (route) => {
    const url = route.request().url();
    const method = route.request().method();

    // the seeded policy line is "Property All Risks" -> mandatory docs.
    const MANDATORY = ["claim_form", "photo", "repair_estimate"];
    const CLAIM_DOC_TYPES = [
      "claim_form",
      "police_report",
      "medical_report",
      "photo",
      "invoice",
      "repair_estimate",
      "expert_report",
      "correspondence",
    ];
    const applyChecklist = (row: Record<string, unknown>) => {
      const present = new Set(
        (row.documents as { docType: string }[]).map((d) => d.docType),
      );
      row.documentChecklist = CLAIM_DOC_TYPES.map((docType) => ({
        docType,
        required: MANDATORY.includes(docType),
        present: present.has(docType),
      }));
      const missing = MANDATORY.filter((t) => !present.has(t));
      row.missingMandatoryDocuments = missing;
      row.documentationComplete = missing.length === 0;
    };

    // Process 26 — derive the assessment sub-view from status + docs + adjuster.
    const OUTCOMES = ["APPROVED", "PARTIALLY_APPROVED", "DECLINED"];
    const applyAssessment = (row: Record<string, unknown>) => {
      const adj = row.adjuster as Record<string, unknown> | null;
      const survey = (adj?.surveyCompletedAt as string | null) ?? null;
      const investigation =
        (adj?.investigationCompletedAt as string | null) ?? null;
      row.assessment = {
        surveyCompletedAt: survey,
        investigationCompletedAt: investigation,
        adjusterWorkComplete: survey !== null && investigation !== null,
        readyForAssessment:
          row.status === "DOCUMENTATION_IN_PROGRESS" &&
          row.documentationComplete === true,
        outcome: OUTCOMES.includes(row.status as string)
          ? (row.status as string)
          : null,
      };
    };

    // Process 28 — derive the settlement sub-view.
    const applySettlement = (row: Record<string, unknown>) => {
      const s = row.settlement as Record<string, unknown> | null;
      if (!s) {
        row.settlement = null;
        return;
      }
      const approved = Number(s.approvedAmount);
      const secondApproverRequired =
        s.brokerProcessedPayment === true || approved >= 25000;
      row.settlement = {
        ...s,
        secondApproverRequired,
        settled: row.status === "SETTLED" || row.status === "CLOSED",
      };
    };
    const money3 = (n: number) => n.toFixed(3);

    // Process 27 — the follow-up sub-view + a synthetic "overdue" flag the
    // sweep branch uses (the real due-check is business-day date math).
    const AWAITING = [
      "REGISTERED",
      "DOCUMENTATION_IN_PROGRESS",
      "UNDER_ASSESSMENT",
    ];
    const applyFollowUp = (row: Record<string, unknown>) => {
      const alerts = (row.followUpAlerts as Record<string, unknown>[]) ?? [];
      row.followUpAlerts = alerts;
      row.followUp = {
        followUpAlerts: alerts,
        followUpAlertOpen: alerts.some((a) => a.resolvedAt === null),
        followUpAlertThresholdDays: 10,
        awaitingInsurerResponse: AWAITING.includes(row.status as string),
        awaitingInsurerSince: "2026-11-05T00:00:00.000Z",
      };
    };

    // Process 28 — record the four settlement figures / second-approve.
    const settleMatch = /\/claims\/([^/?]+)\/settlement(\?|$)/.exec(url);
    if (method === "POST" && settleMatch) {
      const row = claimRows.find((r) => r.id === settleMatch[1]);
      const b = route.request().postDataJSON() as {
        approvedAmount: string;
        deductible: string;
        brokerProcessedPayment?: boolean;
      };
      opts.onClaimSettlement?.({ step: "record", ...b });
      if (row && !row.settlement) {
        const approved = Number(b.approvedAmount);
        const ded = Number(b.deductible);
        const broker = b.brokerProcessedPayment === true;
        row.settlement = {
          estimatedLoss: money3(Number(row.estimatedLoss)),
          approvedAmount: money3(approved),
          deductible: money3(ded),
          netSettlement: money3(approved - ded),
          brokerProcessedPayment: broker,
          approvedByUserId: "user-1",
          secondApproverUserId: null,
          // The endpoint returns this now. Null through this whole flow: `user-1` records the
          // settlement and `user-2` gives the second approval, which is the ordinary two-person case.
          combinedDutyAct: null,
        };
        if (!broker && approved < 25000) {
          const from = row.status as string;
          row.status = "SETTLED";
          (row.statusHistory as Record<string, unknown>[]).push({
            fromStatus: from,
            toStatus: "SETTLED",
            changedByUserId: "user-1",
            changedAt: "2026-11-30T00:00:00.000Z",
          });
        }
        applySettlement(row);
        applyAssessment(row);
        applyFollowUp(row);
      }
      return route.fulfill({ status: 201, json: row ?? {} });
    }

    const secondApproveMatch =
      /\/claims\/([^/?]+)\/settlement\/second-approve(\?|$)/.exec(url);
    if (method === "POST" && secondApproveMatch) {
      opts.onClaimSettlement?.({ step: "second-approve" });
      const row = claimRows.find((r) => r.id === secondApproveMatch[1]);
      const s = row?.settlement as Record<string, unknown> | undefined;
      if (row && s && s.secondApproverUserId == null) {
        s.secondApproverUserId = "user-2";
        const from = row.status as string;
        row.status = "SETTLED";
        (row.statusHistory as Record<string, unknown>[]).push({
          fromStatus: from,
          toStatus: "SETTLED",
          changedByUserId: "user-2",
          changedAt: "2026-11-30T00:00:00.000Z",
        });
        applySettlement(row);
        applyAssessment(row);
        applyFollowUp(row);
      }
      return route.fulfill({ status: 201, json: row ?? {} });
    }

    // Process 29 — formal closure (SETTLED / DECLINED -> CLOSED).
    const closeMatch = /\/claims\/([^/?]+)\/closure(\?|$)/.exec(url);
    if (method === "POST" && closeMatch) {
      const row = claimRows.find((r) => r.id === closeMatch[1]);
      const b = (route.request().postDataJSON() ?? {}) as {
        clientPaymentConfirmedAt?: string;
      };
      opts.onClaimClosure?.({ ...b });
      if (row && row.status !== "CLOSED") {
        const from = row.status as string;
        const s = row.settlement as Record<string, unknown> | null;
        if (s && b.clientPaymentConfirmedAt) {
          s.clientPaymentConfirmedAt = `${b.clientPaymentConfirmedAt}T00:00:00.000Z`;
        }
        row.status = "CLOSED";
        row.closedAt = "2026-12-15T00:00:00.000Z";
        (row.statusHistory as Record<string, unknown>[]).push({
          fromStatus: from,
          toStatus: "CLOSED",
          changedByUserId: "user-1",
          changedAt: "2026-12-15T00:00:00.000Z",
        });
        applySettlement(row);
        applyAssessment(row);
        applyFollowUp(row);
      }
      return route.fulfill({ status: 201, json: row ?? {} });
    }

    const sweepMatch = /\/claims\/follow-up-sweep(\?|$)/.exec(url);
    if (method === "POST" && sweepMatch) {
      opts.onClaimFollowUp?.({ step: "sweep" });
      let raised = 0;
      for (const row of claimRows) {
        // The real sweep does business-day date math; the mock raises for any
        // pre-verdict claim with no open alert so the UI flow is exercised.
        if (
          AWAITING.includes(row.status as string) &&
          ((row.followUpAlerts as unknown[]) ?? []).length === 0
        ) {
          (row.followUpAlerts as Record<string, unknown>[]) = [
            {
              id: `fa-${row.id}`,
              triggeredAt: "2026-11-20T00:00:00.000Z",
              resolvedAt: null,
            },
          ];
          raised += 1;
        }
        applyFollowUp(row);
      }
      return route.fulfill({
        status: 201,
        json: {
          awaiting: claimRows.length,
          due: raised,
          raised,
          skippedAlreadyAlerted: 0,
          autoResolved: 0,
          failed: 0,
        },
      });
    }

    const resolveMatch =
      /\/claims\/([^/?]+)\/follow-up-alerts\/([^/?]+)\/resolve(\?|$)/.exec(url);
    if (method === "POST" && resolveMatch) {
      opts.onClaimFollowUp?.({ step: "resolve", alertId: resolveMatch[2] });
      const row = claimRows.find((r) => r.id === resolveMatch[1]);
      if (row) {
        for (const a of (row.followUpAlerts as Record<string, unknown>[]) ??
          []) {
          if (a.id === resolveMatch[2] && a.resolvedAt === null) {
            a.resolvedAt = "2026-11-25T00:00:00.000Z";
          }
        }
        applyFollowUp(row);
      }
      return route.fulfill({ status: 201, json: row ?? {} });
    }

    const docMatch = /\/claims\/([^/?]+)\/documents(\?|$)/.exec(url);
    if (method === "POST" && docMatch) {
      const b = route.request().postDataJSON() as {
        documents: {
          docType: string;
          classification: string;
          fileName: string;
          storageRef: string;
        }[];
      };
      opts.onAttachClaimDocs?.(b);
      const row = claimRows.find((r) => r.id === docMatch[1]);
      if (row) {
        const docs = row.documents as Record<string, unknown>[];
        b.documents.forEach((d, i) => {
          docs.push({
            id: `cd-${docs.length + i + 1}`,
            docType: d.docType,
            category: "CLAIM",
            classification: d.classification,
            fileName: d.fileName,
            versionNumber: 1,
            uploadedByUserId: "user-1",
            createdAt: "2026-11-06T00:00:00.000Z",
          });
        });
        if (row.status === "REGISTERED") {
          row.status = "DOCUMENTATION_IN_PROGRESS";
          (row.statusHistory as Record<string, unknown>[]).push({
            fromStatus: "REGISTERED",
            toStatus: "DOCUMENTATION_IN_PROGRESS",
            changedByUserId: "user-1",
            changedAt: "2026-11-06T00:00:00.000Z",
          });
        }
        applyChecklist(row);
        applyAssessment(row);
        applySettlement(row);
        applyFollowUp(row);
      }
      return route.fulfill({ status: 201, json: row ?? {} });
    }

    // Process 26 — adjuster progress / submit for assessment / verdict.
    const asmtMatch = /\/claims\/([^/?]+)\/assessment\/([a-z-]+)(\?|$)/.exec(
      url,
    );
    if (method === "POST" && asmtMatch) {
      const row = claimRows.find((r) => r.id === asmtMatch[1]);
      const step = asmtMatch[2];
      const b = (route.request().postDataJSON() ?? {}) as Record<
        string,
        unknown
      >;
      opts.onClaimAssessment?.({ step, ...b });
      if (row) {
        const push = (fromStatus: string, toStatus: string) =>
          (row.statusHistory as Record<string, unknown>[]).push({
            fromStatus,
            toStatus,
            changedByUserId: "user-1",
            changedAt: "2026-11-07T00:00:00.000Z",
          });
        if (step === "adjuster-progress") {
          const adj = row.adjuster as Record<string, unknown>;
          if (
            typeof b.surveyCompletedAt === "string" &&
            !adj.surveyCompletedAt
          ) {
            adj.surveyCompletedAt = b.surveyCompletedAt;
          }
          if (
            typeof b.investigationCompletedAt === "string" &&
            !adj.investigationCompletedAt
          ) {
            adj.investigationCompletedAt = b.investigationCompletedAt;
          }
        } else if (step === "submit") {
          if (row.status === "DOCUMENTATION_IN_PROGRESS") {
            row.status = "UNDER_ASSESSMENT";
            push("DOCUMENTATION_IN_PROGRESS", "UNDER_ASSESSMENT");
          }
        } else if (step === "decision") {
          if (row.status === "UNDER_ASSESSMENT") {
            row.status = b.outcome as string;
            push("UNDER_ASSESSMENT", b.outcome as string);
          }
        }
        applyAssessment(row);
        applySettlement(row);
        applyFollowUp(row);
      }
      return route.fulfill({ status: 201, json: row ?? {} });
    }

    const regMatch = /\/claims\/([^/?]+)\/registration(\?|$)/.exec(url);
    if (method === "POST" && regMatch) {
      const b = route.request().postDataJSON() as {
        insurerClaimReference: string;
        claimNumber?: string;
        adjuster: { name: string; firm?: string };
      };
      opts.onRegisterClaim?.(b);
      const row = claimRows.find((r) => r.id === regMatch[1]);
      if (row) {
        row.status = "REGISTERED";
        row.insurerClaimReference = b.insurerClaimReference;
        if (b.claimNumber) row.claimNumber = b.claimNumber;
        row.adjuster = {
          name: b.adjuster.name,
          firm: b.adjuster.firm ?? null,
          assignedAt: "2026-11-05T00:00:00.000Z",
          surveyCompletedAt: null,
          investigationCompletedAt: null,
        };
        (row.statusHistory as Record<string, unknown>[]).push({
          fromStatus: "NOTIFIED",
          toStatus: "REGISTERED",
          changedByUserId: "user-1",
          changedAt: "2026-11-05T00:00:00.000Z",
        });
        applyAssessment(row);
        applySettlement(row);
        applyFollowUp(row);
      }
      return route.fulfill({ status: 201, json: row ?? {} });
    }

    if (method === "POST") {
      const b = route.request().postDataJSON() as {
        policyId: string;
        lossDate: string;
        causeOfLoss: string;
        lossLocation?: string;
        estimatedLoss: string;
        isThirdPartyInvolved?: boolean;
        thirdParty?: {
          fullName?: string;
          subrogationRecoveryFlag?: boolean;
        };
      };
      opts.onNotifyClaim?.(b);
      const row: Record<string, unknown> = {
        id: `claim-${claimRows.length + 1}`,
        policyId: b.policyId,
        customerId: "cust-1",
        policyNumber: "POL-SEED-1",
        insuranceLine: "Property All Risks",
        claimNumber: null,
        insurerClaimReference: null,
        status: "NOTIFIED",
        lossDate: `${b.lossDate}T00:00:00.000Z`,
        lossLocation: b.lossLocation ?? null,
        causeOfLoss: b.causeOfLoss,
        estimatedLoss: b.estimatedLoss,
        isThirdPartyInvolved: Boolean(b.isThirdPartyInvolved),
        isLargeClaim: Number(b.estimatedLoss) >= 25000,
        classification: "HIGHLY_CONFIDENTIAL",
        followUpAlertThresholdDays: 9,
        thirdParty: b.isThirdPartyInvolved
          ? {
              fullName: b.thirdParty?.fullName ?? null,
              subrogationRecoveryFlag: Boolean(
                b.thirdParty?.subrogationRecoveryFlag,
              ),
            }
          : null,
        adjuster: null,
        documents: [],
        documentChecklist: [],
        documentationComplete: false,
        missingMandatoryDocuments: [],
        followUpAlerts: [],
        coverage: {
          scheduleId: "sch-1",
          effectiveFrom: "2026-10-01T00:00:00.000Z",
          effectiveTo: null,
        },
        coverageResolvedAtLossDate: true,
        settlement: null,
        closedAt: null,
        statusHistory: [
          {
            fromStatus: null,
            toStatus: "NOTIFIED",
            changedByUserId: "user-1",
            changedAt: `${b.lossDate}T00:00:00.000Z`,
          },
        ],
        createdAt: "2026-11-01T00:00:00.000Z",
        updatedAt: "2026-11-01T00:00:00.000Z",
      };
      applyChecklist(row);
      applyAssessment(row);
      applySettlement(row);
      applyFollowUp(row);
      claimRows.push(row);
      return route.fulfill({ status: 201, json: row });
    }
    // `GET /claims` returns the same paged envelope on every branch now
    // (scoped or queue), so the mock has to carry it too.
    return route.fulfill({
      status: 200,
      json: {
        items: claimRows,
        total: claimRows.length,
        page: 0,
        pageSize: 50,
      },
    });
  });

  // One route for the whole /rfqs prefix — the last-registered route wins in
  // Playwright, so a separate /rfqs/selectable-insurers route would be
  // shadowed by this one. Branch internally instead.
  await page.route("http://localhost:4000/rfqs**", (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (/\/rfqs\/selectable-insurers(\?|$)/.test(url)) {
      return route.fulfill({ status: 200, json: INSURERS });
    }
    /*
     * §P3 — the lines this opportunity can still be taken to market on. The server decides
     * which they are (on the programme, and not already carrying an RFQ); the form only
     * renders what it is given, which is why this mock is a flat list and not a filter.
     */
    if (/\/rfqs\/available-lines(\?|$)/.test(url)) {
      return route.fulfill({ status: 200, json: AVAILABLE_LINES });
    }
    if (/\/rfqs\/rfq-1\/communications(\?|$)/.test(url)) {
      if (method === "POST") {
        const b = route.request().postDataJSON() as {
          direction: string;
          channel: string;
          body: string;
          subject?: string;
        };
        opts.onLogComm?.(b);
        const row = {
          id: `comm-${comms.length + 1}`,
          rfqId: "rfq-1",
          rfqInsurerId: null,
          direction: b.direction,
          channel: b.channel,
          subject: b.subject ?? null,
          body: b.body,
          loggedByUserId: "user-1",
          sentAt: "2026-03-06T00:00:00.000Z",
          createdAt: "2026-03-06T00:00:00.000Z",
          rfqInsurer: null,
        };
        comms.unshift(row);
        return route.fulfill({ status: 201, json: row });
      }
      return route.fulfill({ status: 200, json: comms });
    }
    if (method === "POST" && /\/rfqs$/.test(url.split("?")[0])) {
      opts.onCreateRfq?.();
      return route.fulfill({ status: 201, json: RFQ });
    }
    if (/\/rfqs\/rfq-1(\/|\?|$)/.test(url)) {
      return route.fulfill({ status: 200, json: RFQ });
    }
    // 🔴 OWNER DECISION 150 RULING 1 — a PAGE, and the row names its customer. Added here
    // rather than on `RFQ`, for the same reason as the opportunity list above.
    return route.fulfill({
      status: 200,
      json: listPage([{ ...RFQ, customer: LIST_CUSTOMER }]),
    });
  });

  await page.route("http://localhost:4000/rfq-insurers/**", (route) => {
    const body = route.request().postDataJSON() as { toStatus: string };
    opts.onTransition?.(body.toStatus);
    return route.fulfill({
      status: 201,
      json: {
        ...RFQ.insurerSubmissions[0],
        status: body.toStatus,
        respondedAt: "2026-03-05T00:00:00.000Z",
      },
    });
  });
  // Part D §5.1 touchpoint #4 (RFQ) and the claims touchpoint (both on
  // pages this helper drives) each mount a consent-capture control that
  // reads this on mount; the base mock here is an empty, quiet list —
  // individual tests override it with route.fulfill precedence (most
  // recently registered wins) when they need to exercise capture itself
  // (see the dedicated "captures Claims consent..." test below, or
  // customers.spec.ts for the onboarding/KYC touchpoint).
  await page.route("http://localhost:4000/consent-records**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route("http://localhost:4000/privacy-notices/current**", (route) =>
    route.fulfill({ status: 200, json: { notice: null } }),
  );
}

/** Part C #26/#28 — drive a freshly-notified claim all the way to an insurer
 * verdict through the UI (notify -> register -> file every mandatory doc ->
 * stamp the adjuster survey + investigation -> submit -> record the verdict).
 * The Process 28 settlement controls only appear once the claim is APPROVED /
 * PARTIALLY_APPROVED. */
/**
 * File the three mandatory claim documents, waiting for each one to LAND before starting the next.
 *
 * IMPROVEMENTS § 1.47. Four tests in this file were chronically flaky in CI — reported as `4 flaky` in a
 * run that still concluded SUCCESS, with the count growing 2 → 2 → 4 across three runs while no code
 * changed. They shared a shape rather than any state: roughly sixteen sequential interactions with ONE
 * assertion at the end, against a 30s per-test budget that is marginal on a single-core runner.
 *
 * The defect was not the budget. It was that a loop of unsynchronised clicks and a single final assertion
 * reports "slow" and "broken" identically: `waiting for element to be visible, enabled and stable` on
 * `Documentation · complete` says nothing about WHICH of the twelve interactions did not land.
 *
 * So each iteration now waits on the state the NEXT one depends on — the filed-document count, which only
 * advances once the request completed AND the parent refetched, which is also exactly when the form is
 * ready to be typed into again. Three intermediate assertions instead of one final one, so a step that
 * genuinely fails names itself, and no `fill` races a re-render.
 *
 * The timeout is deliberately NOT raised. That would be § 1.1's mistake: a mitigation that buys time and
 * hides the next crossing.
 */
async function fileMandatoryClaimDocuments(page: Page) {
  const documents = [
    ["claim_form", "cf.pdf"],
    ["photo", "ph.jpg"],
    ["repair_estimate", "re.pdf"],
  ] as const;

  for (const [index, [docType, fileName]] of documents.entries()) {
    await page.getByLabel("Document type").selectOption(docType);
    await page.getByLabel("File name").fill(fileName);
    await page.getByLabel("Storage reference").fill(`s3://claims/${docType}`);
    await page.getByRole("button", { name: "File document" }).click();
    // The count is the settled-state signal: it only moves once the attach returned and the card
    // refetched. Singular on the first one, because the screen says "1 file on record."
    const filed = index + 1;
    await expect(
      page.getByText(`${filed} file${filed === 1 ? "" : "s"} on record.`),
    ).toBeVisible();
  }
  await expect(page.getByText("Documentation · complete")).toBeVisible();
}

async function driveClaimToVerdict(
  page: Page,
  opts: {
    estimatedLoss: string;
    verdict: "APPROVED" | "PARTIALLY_APPROVED";
    insurerRef: string;
  },
) {
  await page.getByLabel("Loss date").fill("2026-11-15");
  await page
    .getByLabel("Cause of loss")
    .fill("Storm ripped the roof sheeting.");
  await page.getByLabel("Estimated loss").fill(opts.estimatedLoss);
  await page.getByRole("button", { name: "Notify claim" }).click();
  await expect(page.getByText("Notified", { exact: true })).toBeVisible();

  await page.getByLabel("Insurer claim reference").fill(opts.insurerRef);
  await page.getByLabel("Loss adjuster").fill("Cunningham Lindsey");
  await page
    .getByRole("button", { name: "Register & assign adjuster" })
    .click();
  await expect(page.getByText("Registered", { exact: true })).toBeVisible();

  await fileMandatoryClaimDocuments(page);

  await page
    .getByLabel("Completion date (adjuster survey / investigation)")
    .fill("2026-11-16");
  await page.getByRole("button", { name: "Mark survey complete" }).click();
  await page
    .getByRole("button", { name: "Mark investigation complete" })
    .click();

  await page.getByRole("button", { name: "Submit for assessment" }).click();
  await expect(
    page.getByText("Under assessment", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Assessment verdict").selectOption(opts.verdict);
  await page.getByRole("button", { name: "Record verdict" }).click();
  // The <select> is driven by the stored code; the line below it now reads
  // the label, so the assertion maps one to the other.
  const VERDICT_LABEL: Record<string, string> = {
    APPROVED: "Approved",
    PARTIALLY_APPROVED: "Partially approved",
    DECLINED: "Declined",
  };
  await expect(
    page.getByText(`Verdict ${VERDICT_LABEL[opts.verdict]}`),
  ).toBeVisible();
}

// `/policies` is one of the five paged lists: it returns
// `{ items, total, page, pageSize }`, on its scoped branches too, so the
// client has one response shape rather than one per branch.
function paged<T>(items: T[]) {
  return { items, total: items.length, page: 0, pageSize: 50 };
}

test("opens an opportunity and lists its RFQs", async ({ page }) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockRfqApi(page);

  await page.goto("/opportunities?customerId=cust-1");
  await expect(
    page.getByRole("heading", { name: "RFQ / market" }),
  ).toBeVisible();
  // 🔴 OWNER DECISION 163 RULING 1 — this card used to be named «Opportunity opp-1», eight
  // characters of a uuid. CORRECTED to the ruled title rather than deleted.
  await page.getByRole("button", { name: /Opportunity — Acme Trading/ }).click();

  await expect(page).toHaveURL("/opportunities/opp-1");
  await expect(page.getByText("Status: Needs confirmed")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Property All Risks/ }),
  ).toBeVisible();
});

/*
 * 🔴 OWNER DECISION 150 RULING 1 — THE ACCEPTANCE PATH, BY CLICKING, WITH NO URL TYPED.
 *
 * The owner's second walk reported that `/opportunities` and `/rfqs` opened from the sidebar
 * with one sentence and nothing else, because each list was requested per customer. These two
 * tests are the ruling's own acceptance: from the navigation to an opportunity, and from the
 * navigation to a request, without a `customerId` anywhere.
 *
 * ⛔ `page.goto` TAKES THE BARE PATH, which is the whole point — the test would pass against the
 * old screen if it carried a query string, and that is exactly the defect.
 */
test("OWNER DECISION 150 ruling 1 — the opportunities list opens from the sidebar and a row opens", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockRfqApi(page);

  await page.goto("/opportunities");
  await expect(
    page.getByRole("heading", { name: "RFQ / market" }),
  ).toBeVisible();
  // The row names its customer — the half that makes a book-wide row usable by a reader who
  // arrived with nothing in hand.
  await expect(page.getByText("Acme Trading")).toBeVisible();
  /* And the prompt that WAS this screen is gone. ⛔ SCOPED to `main`, not page-wide: a
     page-wide text absence can match an element the test is not about — a nav label, a tooltip
     — and `check:absence` refuses one for exactly that reason. */
  await expectAbsentWithin(page.locator("main"), (scope) =>
    scope.getByText("No customer selected"),
  );

  // 🔴 OWNER DECISION 163 RULING 1 — this card used to be named «Opportunity opp-1», eight
  // characters of a uuid. CORRECTED to the ruled title rather than deleted.
  await page.getByRole("button", { name: /Opportunity — Acme Trading/ }).click();
  await expect(page).toHaveURL("/opportunities/opp-1");
  await expect(page.getByText("Status: Needs confirmed")).toBeVisible();
});

test("OWNER DECISION 150 ruling 1 — the RFQ list opens from the sidebar, named by customer, line and insurer", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockRfqApi(page);

  await page.goto("/rfqs");
  await expect(page.getByRole("heading", { name: "RFQs" })).toBeVisible();
  await expect(page.getByText("Acme Trading")).toBeVisible();
  // ⛔ THE INSURER NAME, through message 45's helper. The measured failure it closes is an
  // EMPTY cell: `undefined` renders as nothing in React, so a row that could not resolve a name
  // would look like a row with no insurer rather than like a bug.
  await expect(page.getByText("Jordan Insurance Co")).toBeVisible();
  await expectAbsentWithin(page.locator("main"), (scope) =>
    scope.getByText("No customer or opportunity"),
  );

  await page.getByRole("button", { name: /Property All Risks/ }).first().click();
  await expect(page).toHaveURL("/rfqs/rfq-1");
});

test("creates an RFQ with an insurer shortlist", async ({ page }) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  let created = false;
  await mockRfqApi(page, {
    onCreateRfq: () => {
      created = true;
    },
  });

  await page.goto("/rfqs/new?opportunityId=opp-1");
  await expect(page.getByRole("heading", { name: "New RFQ" })).toBeVisible();
  // §P3 — a CHOICE now, not free text. The old `.fill()` typed a value the server happened to
  // accept; the walk found that a reader following the screen's own Arabic hint was refused.
  await page
    .getByLabel("Insurance line")
    .selectOption({ value: "Property All Risks" });
  // 🔴 THE RATING LEFT THIS LABEL (message 53 §1). It read «Jordan Insurance Co · A-», and
  // on the demo database three of these labels carried the stored English «A- (sample
  // rating)». What settled it is the DATE: `SelectableInsurer` carries the rating and not
  // `financialStrengthRatingAsOf`, so this label showed the one half
  // `Insurer_rating_carries_its_date` refuses to let stand alone. CORRECTED, not deleted.
  await page.getByLabel("Jordan Insurance Co").check();
  await page.getByRole("button", { name: "Create RFQ" }).click();

  await expect.poll(() => created).toBe(true);
  await expect(page).toHaveURL("/rfqs/rfq-1");
  await expect(
    page.getByRole("heading", { name: "RFQ — Property All Risks" }),
  ).toBeVisible();
});

test("records an insurer response status from the RFQ detail screen", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  let transitionedTo: string | null = null;
  await mockRfqApi(page, {
    onTransition: (s) => {
      transitionedTo = s;
    },
  });

  await page.goto("/rfqs/rfq-1");
  await expect(
    page.getByRole("cell", { name: "Jordan Insurance Co" }),
  ).toBeVisible();
  await page
    .getByLabel("Set status for Jordan Insurance Co")
    .selectOption("QUOTED");

  await expect.poll(() => transitionedTo).toBe("QUOTED");
});

test("🔴 §W3/§P4 — every submissions row names its insurer, in Arabic, on the table a reader sees", async ({
  page,
}) => {
  /*
   * ## The defect this is the acceptance test for (owner's demo-path walk, 2026-11-17)
   *
   * The submissions table showed three rows with an EMPTY insurer column. `GET /rfqs/:id`
   * returned the raw Prisma join — `legalName` / `legalNameAr`, no `name` — against a web type
   * declaring `{ name, nameAr }`, so the cell read `undefined` and React rendered nothing.
   *
   * ⚠️ AND THE SIBLING TEST ABOVE COULD NOT HAVE CAUGHT IT, which is the point of this one.
   * It asserts a cell named "Jordan Insurance Co" is visible — true against the MOCK, which has
   * always supplied the flattened shape the API did not send. That is the fixture-as-authority
   * failure the `INSURER_IDENTITY` comment now records for the fourth time.
   *
   * ⟶ So this test asserts a property of EVERY ROW rather than one expected string: the cell is
   *   non-empty, and in Arabic it is the ARABIC name. A row that lost its name fails here by
   *   count, however the fixture is edited.
   */
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"], "AR");
  await mockRfqApi(page);

  await page.goto("/rfqs/rfq-1");

  // The table must be ON SCREEN first. Asserting cell text while the block is collapsed or still
  // loading would pass for the wrong reason — the recorded non-vacuity shape.
  const rows = page.locator("table tbody tr").filter({
    has: page.locator("select, span"),
  });
  await expect(rows.first()).toBeVisible();

  const arabicName = INSURERS[0].nameAr as string;
  const insurerCells = page.getByRole("cell", { name: arabicName });
  await expect(insurerCells.first()).toBeVisible();

  // EVERY submission row, not merely one: the walk found THREE blank rows, so a test satisfied by
  // the first row naming its insurer would have passed against the screen she was looking at.
  // `anchoredCount`, not `.count()`: a bare count does not auto-wait and answers 0 before the
  // table renders, so it could agree with a blank screen. `test/e2e-anchored-reads.test.ts`
  // refused the first version of this line by name, which is the guard working.
  const count = await anchoredCount(insurerCells);
  expect(count).toBe(RFQ.insurerSubmissions.length);

  // ⛔ And the Latin name is NOT also on the screen in Arabic. Without this the test would pass
  // against a by-language helper that fell back to `name` whenever `nameAr` was present — which
  // is precisely the behaviour the four screens had before this change.
  await expect(
    page.getByRole("cell", { name: INSURERS[0].name, exact: true }),
  ).toHaveCount(0);
});

test("logs a broker<->insurer exchange on the RFQ detail screen", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  let logged: { direction: string; body: string } | null = null;
  await mockRfqApi(page, {
    onLogComm: (b) => {
      logged = b;
    },
  });

  await page.goto("/rfqs/rfq-1");
  await expect(
    page.getByRole("heading", { name: "Correspondence" }),
  ).toBeVisible();
  await page.getByLabel("Direction").selectOption("INBOUND");
  await page.getByLabel("Channel").selectOption("CALL");
  await page
    .getByLabel("Exchange")
    .fill("Please send 3 years of loss history for site 2.");
  await page.getByRole("button", { name: "Log exchange" }).click();

  await expect.poll(() => logged?.direction).toBe("INBOUND");
  await expect(
    page.getByText("Please send 3 years of loss history for site 2."),
  ).toBeVisible();

  // This screen's own channel wording, not the communications screen's. Four
  // `commChannel*` keys were declared in BOTH rfq.ts and customer-service.ts,
  // and the merge in translations.ts spreads customer-service last — so this
  // row rendered "Phone call" and "Customer portal" instead. `exact` matters:
  // a substring match on "Call" is satisfied by "Phone call" and would have
  // passed against the bug.
  const logRow = page
    .getByRole("row")
    .filter({ hasText: "Please send 3 years" });
  await expect(logRow.getByText("Call", { exact: true })).toBeVisible();
  await expect(logRow.getByText("Phone call")).toHaveCount(0);
  await expect(logRow.getByText("Inbound", { exact: true })).toBeVisible();
});

test("a non-Placement user sees the list but no create controls", async ({
  page,
}) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await mockRfqApi(page);

  await page.goto("/opportunities/opp-1");
  await expect(page.getByText("Status: Needs confirmed")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create RFQ for a line" }),
  ).toHaveCount(0);
});

test("captures a quotation for a shortlisted insurer on the RFQ detail screen", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  let captured: { insurerId: string; premium: string } | null = null;
  await mockRfqApi(page, {
    onCaptureQuote: (b) => {
      captured = b;
    },
  });

  await page.goto("/rfqs/rfq-1");
  await expect(page.getByRole("heading", { name: "Quotations" })).toBeVisible();
  await page.getByLabel("Insurer", { exact: true }).selectOption("ins-1");
  await page.getByLabel("Premium *").fill("125000.500");
  await page.getByRole("button", { name: "Capture quote" }).click();

  await expect.poll(() => captured?.insurerId).toBe("ins-1");
  await expect.poll(() => captured?.premium).toBe("125000.500");
  // The captured chain now renders with a per-chain Revise control.
  await expect(
    page.getByRole("button", { name: "Revise (new version)" }),
  ).toBeVisible();
});

/*
 * ROW 12 — THE NARROWED ROLE, WHICH IS THE ONLY THING THAT PROVES THIS ITEM.
 * Added 2026-11-06 (module 0-c batch 6b).
 *
 * `/rfqs/[id]` bound ONE boolean to `rfq.insurer.update` and passed it to three places needing
 * three other codes: `quotation.capture`, `quotation.negotiate` and `comparison.build`. Under the
 * SEEDED grants that is invisible — measured 2026-11-06, all four are granted to `[PLACEMENT]`
 * alone, so `PLACEMENT_TECHNICAL_OFFICER` holds every one of them and a screen test with a seeded
 * role passes either way. **A test that mocks a seeded role therefore cannot see this defect at
 * all**, which is why these two go through `permissions` DIRECTLY rather than through
 * `permissionsForRoles`: an office that defines its own roles is exactly the case office-scoped
 * RBAC exists for, and it is the case the mismatch breaks.
 *
 * Each test asserts in BOTH directions from the same render — the control that SHOULD be there,
 * and the one that should not — so neither can pass against a blank page.
 */
async function mockAuthWithPermissions(page: Page, permissions: string[]) {
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fake-access-token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      status: 200,
      json: {
        ...ME_BASE,
        roles: ["PLACEMENT_TECHNICAL_OFFICER"],
        permissions,
      },
    }),
  );
}

test("row 12 — a role with rfq.insurer.update but NOT quotation.capture gets no capture form", async ({
  page,
}) => {
  await mockAuthWithPermissions(page, [
    "rfq.read",
    "opportunity.read",
    "quotation.read",
    "comparison.read",
    "rfq.insurer.update",
  ]);
  await mockRfqApi(page);

  await page.goto("/rfqs/rfq-1");

  // THE ANCHOR: this role's OWN control is present, so the page rendered and the absence below is
  // a gate rather than an empty screen. `rfq.insurer.update` is what the status control enforces,
  // and it was the ONE code the old single boolean got right.
  await expect(page.getByRole("heading", { name: "Quotations" })).toBeVisible();
  await expect(page.getByText("Set status")).toBeVisible();

  // Before the split, this form was gated on `rfq.insurer.update` and would have rendered.
  await expect(
    page.getByRole("button", { name: "Capture quote" }),
  ).toHaveCount(0);
});

test("row 12 — a role with quotation.capture but NOT rfq.insurer.update gets the capture form", async ({
  page,
}) => {
  await mockAuthWithPermissions(page, [
    "rfq.read",
    "opportunity.read",
    "quotation.read",
    "comparison.read",
    "quotation.capture",
  ]);
  await mockRfqApi(page);

  await page.goto("/rfqs/rfq-1");

  // The direction that FAILS CLOSED and is therefore the quiet one: before the split this role
  // could not see the capture form at all, because the gate asked for a code it does not hold —
  // and a hidden control looks exactly like a correct screen to everybody who cannot use it.
  await expect(
    page.getByRole("button", { name: "Capture quote" }),
  ).toBeVisible();
  /*
   * SCOPED, NOT PAGE-WIDE — and a CI gate taught me that, not a review.
   *
   * This was `expect(page.getByText("Set status")).toHaveCount(0)`, and CI step 9 of the `frontend`
   * job (`page-wide-absence-assertions.py --check`) refused it: **43 against a budget of 42**, with
   * "Do NOT raise the budget" in its own message. A page-wide text absence can match an element the
   * test is not about — the recorded case is a role-name loop that matched a NAV LABEL and failed on
   * a correct tree.
   *
   * `expectAbsentWithin` takes a `Locator`, so the compiler refuses a page-wide root, and it
   * asserts the scope VISIBLE first — which fixes the wrong-element failure AND the not-yet-rendered
   * one, because `toHaveCount(0)` passes on its first poll.
   */
  await expectAbsentWithin(page.getByRole("table").first(), (scope) =>
    scope.getByText("Set status"),
  );
});

test("revises a captured quotation into a new version", async ({ page }) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  let captured = false;
  let revised: { premium: string; negotiationNotes?: string } | null = null;
  await mockRfqApi(page, {
    onCaptureQuote: () => {
      captured = true;
    },
    onReviseQuote: (b) => {
      revised = b;
    },
  });

  await page.goto("/rfqs/rfq-1");
  await page.getByLabel("Insurer", { exact: true }).selectOption("ins-1");
  await page.getByLabel("Premium *").fill("125000.500");
  await page.getByRole("button", { name: "Capture quote" }).click();
  await expect.poll(() => captured).toBe(true);

  await page.getByRole("button", { name: "Revise (new version)" }).click();
  await page.getByLabel("Premium *").fill("119000.000");
  await page
    .getByLabel("Negotiation notes (what was requested / conceded this round)")
    .fill("asked for 5% off and the flood exclusion struck");
  await page.getByRole("button", { name: "Save new version" }).click();

  await expect.poll(() => revised?.premium).toBe("119000.000");
  await expect
    .poll(() => revised?.negotiationNotes)
    .toBe("asked for 5% off and the flood exclusion struck");
  // The chain now has two versions, so the history toggle appears.
  await page.getByRole("button", { name: "Version history" }).click();
  // Round 1's premium delta and the round rationale both render.
  await expect(page.getByText("Round 1")).toBeVisible();
  await expect(
    page.getByText("“asked for 5% off and the flood exclusion struck”"),
  ).toBeVisible();
});

test("builds the comparison matrix and shows the missing-insurer flag", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  let built: { rfqId: string } | null = null;
  await mockRfqApi(page, {
    onBuildComparison: (b) => {
      built = b;
    },
  });

  await page.goto("/rfqs/rfq-1");
  await expect(page.getByRole("heading", { name: "Comparison" })).toBeVisible();
  await expect(page.getByText("No comparison built yet.")).toBeVisible();

  await page.getByRole("button", { name: "Build comparison" }).click();

  await expect.poll(() => built?.rfqId).toBe("rfq-1");
  await expect(
    page.getByRole("button", { name: "Rebuild comparison" }),
  ).toBeVisible();
  await expect(
    page.getByText("Middle East Assurance (No response)"),
  ).toBeVisible();
});

test("marks a deactivated insurer on every surface where one can be chosen", async ({
  page,
}) => {
  // The consequence of keeping quotation capture legal for a deactivated insurer.
  //
  // You cannot solicit anything NEW from them — the RFQ picker does not offer them
  // and an existing RFQ will not take them — but a premium they actually sent is a
  // factual event and stays recorded. So the quote reaches the comparison and can be
  // recommended, and without a marker a broker could present it and a client choose
  // it, with nobody finding out until placement refused. That is a worse failure
  // than not recording the quote.
  //
  // All three surfaces read the same identity, so one fixture flag covers them.
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockRfqApi(page, { insurerDeactivated: true });

  await page.goto("/rfqs/rfq-1");

  // Nothing shows an insurer until something exists to show: this fixture starts
  // with no quotation chains and no comparison, which is the honest initial state
  // of an RFQ that has just gone out.
  //
  // 1. The quotation chain — where a quote is read before anything is compared.
  await expect(page.getByRole("heading", { name: "Quotations" })).toBeVisible();
  await page.getByLabel("Insurer", { exact: true }).selectOption("ins-1");
  await page.getByLabel("Premium *").fill("125000.500");
  await page.getByRole("button", { name: "Capture quote" }).click();
  await expect(
    page.locator("[data-deactivated-insurer]").first(),
    "a captured quote from a deactivated insurer must be marked on the chain",
  ).toBeVisible();
  await expect(page.getByText("No longer dealt with").first()).toBeVisible();

  // 2. The comparison row — the surface a broker presents from.
  await page.getByRole("button", { name: "Build comparison" }).click();
  await expect(
    page.getByRole("button", { name: "Rebuild comparison" }),
  ).toBeVisible();
  const badges = page.locator("[data-deactivated-insurer]");
  await expect(
    badges,
    "the chain and the comparison row must each carry the marker",
  ).not.toHaveCount(0);

  // The insurer is still NAMED alongside the marker — the point is that the quote
  // is real and the insurer is not available, so blanking either would be wrong.
  await expect(page.getByText("Jordan Insurance Co").first()).toBeVisible();

  // 3. And the badge explains itself rather than just labelling.
  await expect(
    page.locator("[data-deactivated-insurer]").first(),
  ).toHaveAttribute("title", /cannot be placed with them/);
});

test("shows no deactivated marker for an insurer the office still deals with", async ({
  page,
}) => {
  // The other half: a marker that appeared for every insurer would be worse than
  // none, because it would stop meaning anything.
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockRfqApi(page);

  await page.goto("/rfqs/rfq-1");
  await page.getByRole("button", { name: "Build comparison" }).click();
  await expect(
    page.getByRole("button", { name: "Rebuild comparison" }),
  ).toBeVisible();
  await expect(page.locator("[data-deactivated-insurer]")).toHaveCount(0);
});

test("downloads a bilingual quotation-comparison PDF once a comparison exists", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockRfqApi(page);
  // Registered AFTER mockRfqApi's own broader "comparison-matrices**"
  // route — Playwright runs routes in reverse-registration order, so this
  // more specific one wins for the document endpoint while the general
  // one still handles build/read.
  await page.route(
    "http://localhost:4000/comparison-matrices/*/document**",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/pdf",
        body: Buffer.from("%PDF-1.4 fake"),
      }),
  );

  await page.goto("/rfqs/rfq-1");
  await page.getByRole("button", { name: "Build comparison" }).click();
  await expect(
    page.getByRole("button", { name: "Rebuild comparison" }),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download comparison (PDF)" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("quotation-comparison-cm-1.pdf");
});

test("a non-Placement user sees the comparison but no build control", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockRfqApi(page);

  await page.goto("/rfqs/rfq-1");
  await expect(page.getByRole("heading", { name: "Comparison" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Build comparison|Rebuild comparison/ }),
  ).toHaveCount(0);
});

test("drafts a broker recommendation and clears the approval + conflict-of-interest gates before sending", async ({
  page,
}) => {
  // A dual-hatted Placement + Manager user can drive every step here.
  await mockAuth(page, [
    "PLACEMENT_TECHNICAL_OFFICER",
    "BRANCH_DEPARTMENT_MANAGER",
  ]);
  let drafted: { rationale: string } | null = null;
  await mockRfqApi(page, {
    onDraftRecommendation: (b) => {
      drafted = b;
    },
  });
  // Registered AFTER mockRfqApi's own broader "recommendations**" route —
  // Playwright runs routes in reverse-registration order, so this more
  // specific one wins for the document endpoint while the general one
  // still handles draft/approve/disclose/send/read.
  await page.route(
    "http://localhost:4000/recommendations/*/document**",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/pdf",
        body: Buffer.from("%PDF-1.4 fake"),
      }),
  );

  // Capture a quote first so the recommendation form has something to pick.
  await page.goto("/rfqs/rfq-1");
  await page.getByLabel("Insurer", { exact: true }).selectOption("ins-1");
  await page.getByLabel("Premium *").fill("125000.500");
  await page.getByRole("button", { name: "Capture quote" }).click();
  await expect(
    page.getByRole("button", { name: "Revise (new version)" }),
  ).toBeVisible();

  await page.goto("/opportunities/opp-1");
  await expect(
    page.getByRole("heading", { name: "Broker recommendation" }),
  ).toBeVisible();

  await page.getByLabel("Recommended quotation").selectOption({ index: 1 });
  await page
    .getByLabel("Overall rationale")
    .fill("Insurer One on balance of coverage and claims service.");
  for (const label of [
    "Coverage",
    "Price",
    "Insurer financial strength",
    "Claims service",
    "Deductible",
    "Policy conditions",
  ]) {
    await page
      .getByLabel(label, { exact: true })
      .fill(`${label} reasoning here.`);
  }
  await page.getByRole("button", { name: "Draft recommendation" }).click();

  await expect.poll(() => drafted?.rationale).toContain("balance of coverage");
  // Both gates block the send.
  await expect(
    page.getByText("Senior-officer approval is required", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("A conflict-of-interest disclosure is required", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send to client" }),
  ).toHaveCount(0);
  // Part F item #7 — the download button is gated the same way: not
  // shown at all while blockedFromSend is non-empty.
  await expect(
    page.getByRole("button", { name: "Download report (PDF)" }),
  ).toHaveCount(0);

  // Approve, then disclose, then send.
  await page.getByRole("button", { name: "Approve" }).click();
  await page
    .getByLabel("Conflict-of-interest disclosure")
    .fill(
      "Insurer One pays 7.5 points more commission than a comparable quote; disclosed to the client.",
    );
  await page.getByRole("button", { name: "Record disclosure" }).click();

  await page.getByRole("button", { name: "Send to client" }).click();
  await expect(page.getByText("sent to client")).toBeVisible();

  // Part F item #7 — once unblocked, downloads a real bilingual PDF.
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download report (PDF)" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("recommendation-report-rec-1.pdf");
});

test("records a client decision and shows the route it takes", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  let captured: { decision: string; evidenceRef: string } | null = null;
  await mockRfqApi(page, {
    opportunityStatus: "SENT_TO_CLIENT",
    onClientDecision: (b) => {
      captured = b;
    },
  });

  await page.goto("/opportunities/opp-1");
  await expect(
    page.getByRole("heading", { name: "Client decision" }),
  ).toBeVisible();

  await page.getByLabel("Decision").selectOption("REQUEST_PRICE_REDUCTION");
  await page.getByLabel("Evidence type").selectOption("email_confirmation");
  await page.getByLabel("Evidence reference").fill("msg-9931");
  await page.getByRole("button", { name: "Record client decision" }).click();

  await expect.poll(() => captured?.decision).toBe("REQUEST_PRICE_REDUCTION");
  await expect.poll(() => captured?.evidenceRef).toBe("msg-9931");
  await expect(page.getByText("Renewed negotiation")).toBeVisible();
});

test("places a policy from an accepted opportunity and records its issuance", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  let placed: { inceptionDate: string } | null = null;
  let issued: { policyNumber: string; issuedPremium: string } | null = null;
  await mockRfqApi(page, {
    opportunityStatus: "PLACEMENT",
    onPlacePolicy: (b) => {
      placed = b;
    },
    onRecordIssuance: (b) => {
      issued = b;
    },
  });
  // Registered AFTER mockRfqApi's own broader "policies**" route —
  // Playwright runs routes in reverse-registration order, so these more
  // specific ones win for the document endpoints while the general one
  // still handles place/issuance/checking/delivery/read.
  await page.route("http://localhost:4000/policies/*/document**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/pdf",
      body: Buffer.from("%PDF-1.4 fake"),
    }),
  );
  await page.route("http://localhost:4000/policies/*/certificate**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/pdf",
      body: Buffer.from("%PDF-1.4 fake certificate"),
    }),
  );

  await page.goto("/opportunities/opp-1");
  await expect(page.getByRole("heading", { name: "Policy" })).toBeVisible();

  // Part F item #7 — no coverage schedule yet, so neither download
  // button appears (both the schedule summary and the certificate).
  await expect(
    page.getByRole("button", { name: "Download schedule summary (PDF)" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Download certificate (PDF)" }),
  ).toHaveCount(0);

  await page.getByLabel("Inception date").fill("2026-10-01");
  await page.getByRole("button", { name: "Place policy" }).click();

  await expect.poll(() => placed?.inceptionDate).toBe("2026-10-01");
  await expect(page.getByText("Placement confirmed")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download schedule summary (PDF)" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Download certificate (PDF)" }),
  ).toHaveCount(0);

  await page.getByLabel("Policy number").fill("POL-WEB-1");
  await page.getByLabel("Issued premium").fill("118500.000");
  await page.getByRole("button", { name: "Record issuance" }).click();

  await expect.poll(() => issued?.policyNumber).toBe("POL-WEB-1");
  await expect.poll(() => issued?.issuedPremium).toBe("118500.000");
  await expect(page.getByText("Issued", { exact: true })).toBeVisible();
  await expect(page.getByText("POL-WEB-1")).toBeVisible();

  // Part F item #7 — a schedule now exists, so both buttons appear and
  // each produces a real bilingual PDF download.
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download schedule summary (PDF)" })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "policy-schedule-summary-pol-1.pdf",
  );

  const certDownloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download certificate (PDF)" })
    .click();
  const certDownload = await certDownloadPromise;
  expect(certDownload.suggestedFilename()).toBe(
    "certificate-of-insurance-pol-1.pdf",
  );
});

test("a Policy Checking Officer runs the QC check and sees a discrepancy block Delivery", async ({
  page,
}) => {
  await mockAuth(page, ["POLICY_CHECKING_OFFICER"]);
  let checked: {
    requestedCoverage: { limits: Record<string, unknown> };
  } | null = null;
  await mockRfqApi(page, {
    opportunityStatus: "PLACEMENT",
    seedIssuedPolicy: true,
    onCheckPolicy: (b) => {
      checked = b;
    },
  });

  await page.goto("/opportunities/opp-1");
  await expect(
    page.getByRole("heading", { name: "Policy", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Quality-control check")).toBeVisible();

  // requested buildings limit higher than the issued 5,000,000 -> discrepancy
  await page
    .getByLabel("Requested limits (JSON)")
    .fill('{ "buildings": "8000000.000" }');
  await page
    .getByLabel("Requested sums insured (JSON)")
    .fill('{ "total": "5000000.000" }');
  await page.getByRole("button", { name: "Run check" }).click();

  await expect
    .poll(
      () =>
        (checked?.requestedCoverage.limits as { buildings?: string })
          ?.buildings,
    )
    .toBe("8000000.000");
  await expect(page.getByText("DISCREPANCY — Delivery blocked")).toBeVisible();
  await expect(
    page.getByText("A Professional Indemnity risk event has been logged."),
  ).toBeVisible();
});

test("records policy delivery and the client receipt acknowledgement", async ({
  page,
}) => {
  // dual-hatted so the QC check (which reveals the delivery form once the
  // policy is VERIFIED) and the delivery can both be driven from one session
  await mockAuth(page, [
    "PLACEMENT_TECHNICAL_OFFICER",
    "POLICY_CHECKING_OFFICER",
  ]);
  let delivered: { method: string; recipient: string } | null = null;
  await mockRfqApi(page, {
    opportunityStatus: "PLACEMENT",
    seedIssuedPolicy: true,
    onRecordDelivery: (b) => {
      delivered = b;
    },
  });

  await page.goto("/opportunities/opp-1");
  await expect(
    page.getByRole("heading", { name: "Policy", exact: true }),
  ).toBeVisible();

  // clean QC check -> VERIFIED, which reveals the "Record delivery" form
  await page
    .getByLabel("Requested limits (JSON)")
    .fill('{ "buildings": "5000000.000" }');
  await page
    .getByLabel("Requested sums insured (JSON)")
    .fill('{ "total": "5000000.000" }');
  await page.getByRole("button", { name: "Run check" }).click();

  await expect(
    page.getByRole("button", { name: "Record delivery" }),
  ).toBeVisible();
  await page.getByLabel("Method").selectOption("courier");
  await page.getByLabel("Recipient").fill("Acme Risk Dept");
  await page.getByRole("button", { name: "Record delivery" }).click();

  await expect.poll(() => delivered?.recipient).toBe("Acme Risk Dept");
  await expect(page.getByText("awaiting client acknowledgement")).toBeVisible();

  await page.getByRole("button", { name: "Acknowledge receipt" }).click();
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
});

test("raises a positive endorsement on an ACTIVE policy", async ({ page }) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  let requested: {
    type: string;
    changeType: string;
    premiumAmount: string;
  } | null = null;
  await mockRfqApi(page, {
    opportunityStatus: "PLACEMENT",
    seedActivePolicy: true,
    onRequestEndorsement: (b) => {
      requested = b;
    },
  });

  await page.goto("/opportunities/opp-1");
  await expect(
    page.getByRole("heading", { name: "Endorsements", exact: true }),
  ).toBeVisible();

  await page.getByLabel("Type", { exact: true }).selectOption("POSITIVE");
  await page
    .getByLabel("Change", { exact: true })
    .selectOption("sum_insured_increase");
  await page.getByLabel("Premium amount (unsigned)").fill("2500.000");
  await page.getByLabel("Effective from").fill("2026-12-01");
  await page.getByRole("button", { name: "Request endorsement" }).click();

  await expect.poll(() => requested?.premiumAmount).toBe("2500.000");
  await expect(page.getByText("Requested", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Premium adjustment JOD 2,500.000"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Advance to insurer" }),
  ).toBeVisible();
});

test("raises a premium invoice from the Billing block — commission netted, total computed", async ({
  page,
}) => {
  await mockAuth(page, ["FINANCE_COLLECTIONS_OFFICER"]);
  let created: {
    policyId: string;
    taxAmount: string;
    feesAmount?: string;
    dueDate: string;
  } | null = null;
  await mockRfqApi(page, {
    opportunityStatus: "PLACEMENT",
    seedIssuedPolicy: true,
    onCreateInvoice: (b) => {
      created = b as typeof created;
    },
  });
  // Part F item #7 — registered AFTER mockRfqApi's own broader
  // "invoices**" route, so this more specific one wins for the document
  // endpoint (same reverse-registration-order precedent the policy
  // schedule-summary/certificate routes already use).
  await page.route("http://localhost:4000/invoices/*/document**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/pdf",
      body: Buffer.from("%PDF-1.4 fake invoice"),
    }),
  );

  await page.goto("/opportunities/opp-1");
  await expect(
    page.getByRole("heading", { name: "Finance", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("No premium invoice yet")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download invoice (PDF)" }),
  ).toHaveCount(0);

  await page.getByLabel("Tax amount").fill("9600.000");
  await page.getByLabel("Fees amount").fill("150.000");
  await page.getByLabel("Due date").fill("2026-12-01");
  await page.getByRole("button", { name: "Issue invoice" }).click();

  await expect.poll(() => created?.taxAmount).toBe("9600.000");
  await expect(page.getByText("−JOD 14,400.000")).toBeVisible();
  // the "Total due" figure — exact so it isn't confused with the "Record
  // receipt of JOD 115,350.000" collection button #32 adds
  await expect(
    page.getByText("JOD 115,350.000", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("invoice-status")).toHaveText("Invoiced");

  // Part F item #7 — an invoice now exists, so the download button
  // appears and produces a real bilingual PDF download.
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download invoice (PDF)" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("invoice-inv-1.pdf");
});

test("a non-Finance user sees no raise-invoice control on the Billing block", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockRfqApi(page, {
    opportunityStatus: "PLACEMENT",
    seedIssuedPolicy: true,
  });

  await page.goto("/opportunities/opp-1");
  await expect(
    page.getByRole("heading", { name: "Finance", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Raise premium invoice" }),
  ).toHaveCount(0);
});

test("walks the collection cycle from the Billing block: receipt -> reconcile -> remittance", async ({
  page,
}) => {
  await mockAuth(page, ["FINANCE_COLLECTIONS_OFFICER"]);
  const steps: string[] = [];
  await mockRfqApi(page, {
    opportunityStatus: "PLACEMENT",
    seedIssuedPolicy: true,
    onCollectionStep: (b) => {
      steps.push(b.step as string);
    },
  });

  await page.goto("/opportunities/opp-1");
  await expect(
    page.getByRole("heading", { name: "Finance", exact: true }),
  ).toBeVisible();

  // raise the invoice first
  await page.getByLabel("Tax amount").fill("9600.000");
  await page.getByLabel("Fees amount").fill("150.000");
  await page.getByLabel("Due date").fill("2026-12-01");
  await page.getByRole("button", { name: "Issue invoice" }).click();
  await expect(page.getByTestId("invoice-status")).toHaveText("Invoiced");

  // 1a. Process 32 — a PART payment. The money is booked, but the invoice
  //     stays Invoiced: only the instalment that completes it moves it on,
  //     which is what keeps it on the #33 ageing report for the remainder.
  // The payment reference is MANDATORY — it is the idempotency key, and the
  // submit button stays disabled without one. While it was optional the cash
  // path had no duplicate protection at all: a double-click booked the
  // client's money twice (two Receipts, two `in` ledger rows).
  await page.getByLabel("Payment reference").fill("E2E-INSTALMENT-1");

  /*
   * ROW 21 — THE ASSERTION THAT MAKES THAT FIX REAL, added 2026-11-07 after noticing the
   * re-pointed step below proves nothing on its own: it types an EXPLICIT amount, so it
   * passes whether or not the amount is required. The fix shipped UNGUARDED, and nothing in
   * the tree would have failed if the substitution came back.
   *
   * The owner's decision was that the instalment amount is REQUIRED. What it replaced was
   * `instalmentAmount.trim() || invoice.outstandingAmount` — a BLANK field silently booking a
   * receipt for the ENTIRE outstanding balance, deliberate, commented, and never stated on
   * screen. Asserting the button DISABLED with the reference present and the amount blank is
   * what makes that substitution unreachable: it cannot be submitted, so it cannot return
   * without this failing.
   *
   * Both directions from the SAME render, because a disabled button on its own proves nothing
   * — the control could be disabled for some unrelated reason. The ENABLE after one fill is
   * what isolates the amount as the cause.
   *
   * What this deliberately does NOT claim: `required` is DECORATIVE on this component. There
   * is no `<form>` anywhere in it and every button is `type="button"`, so native validation
   * never fires — which has always been true of `paymentReference` too. The disabled state is
   * the whole of the client-side enforcement, which is exactly why it needs an assertion.
   */
  const recordCollection = page.getByRole("button", {
    name: "Record collection",
  });
  await expect(recordCollection).toBeDisabled();
  await page
    .getByLabel("Instalment amount")
    .fill("15,350.000".replace(",", ""));
  await expect(recordCollection).toBeEnabled();

  await recordCollection.click();
  await expect(page.getByTestId("invoice-status")).toHaveText("Invoiced");
  await expect(page.getByText("JOD 15,350.000")).toBeVisible();
  // The remaining balance is shown while the invoice is part-paid.
  await expect(page.getByText("Outstanding balance")).toBeVisible();
  await expect(page.getByText("JOD 100,000.000")).toBeVisible();

  /*
   * 1b. the instalment that settles the rest.
   *
   * RE-POINTED 2026-11-07 (row 21), AND THE REVERSAL IS THE POINT. This step used to leave the
   * amount BLANK and its comment said why: *"a blank amount means 'the whole outstanding
   * balance'"*. So the test asserted the defect the owner has now closed — a blank field recording
   * a receipt for the entire balance, deliberate, commented, and never stated on screen.
   *
   * The amount is typed now, and the figure is the balance the assertions above just proved is
   * outstanding (100,000.000), so the test still settles the invoice and still drives
   * `Invoiced -> Collected`. The property it was really about — that only the instalment which
   * COMPLETES an invoice moves it on — is unchanged and is what the status assertion below pins.
   *
   * A DIFFERENT reference: the same one would resume the first instalment idempotently rather than
   * booking a second.
   */
  await page.getByLabel("Instalment amount").fill("100000.000");
  await page.getByLabel("Payment reference").fill("E2E-INSTALMENT-2");
  await page.getByRole("button", { name: "Record collection" }).click();
  await expect(page.getByTestId("invoice-status")).toHaveText("Collected");
  // Collected is now the pooled total of BOTH instalments — which equals the
  // invoiced total, so the figure legitimately appears TWICE ("Total due" and
  // "Collected"). Asserting the count says exactly that, where a bare
  // `toBeVisible()` would trip Playwright's strict mode on the ambiguity.
  await expect(page.getByText("JOD 115,350.000")).toHaveCount(2);
  await expect(page.getByText("Outstanding balance")).toBeHidden();

  // 2. reconcile
  await page.getByRole("button", { name: "Reconcile collected funds" }).click();
  await expect(page.getByTestId("invoice-status")).toHaveText("Reconciled");

  // 3. remit the net premium (120000 - 14400)
  await page
    .getByRole("button", { name: /Remit JOD 105,600.000 to insurer/ })
    .click();
  await expect(page.getByTestId("invoice-status")).toHaveText("Remitted");
  await expect(page.getByText("Remitted to insurer")).toBeVisible();
  await expect(page.getByText(/JOD 105,600.000 on/)).toBeVisible();

  expect(steps).toEqual(["receipt", "receipt", "reconcile", "remittance"]);
});

test("notifies a claim against an issued policy", async ({ page }) => {
  await mockAuth(page, ["CLAIMS_OFFICER"]);
  let notified: {
    lossDate: string;
    causeOfLoss: string;
    estimatedLoss: string;
    isThirdPartyInvolved?: boolean;
  } | null = null;
  await mockRfqApi(page, {
    opportunityStatus: "PLACEMENT",
    seedIssuedPolicy: true,
    onNotifyClaim: (b) => {
      notified = b;
    },
  });

  await page.goto("/opportunities/opp-1");
  await expect(
    page.getByRole("heading", { name: "Claims", exact: true }),
  ).toBeVisible();

  await page.getByLabel("Loss date").fill("2026-11-15");
  await page
    .getByLabel("Cause of loss")
    .fill("Storm damage to the warehouse roof.");
  await page.getByLabel("Estimated loss").fill("30000.000");
  await page.getByRole("button", { name: "Notify claim" }).click();

  await expect.poll(() => notified?.estimatedLoss).toBe("30000.000");
  await expect.poll(() => notified?.causeOfLoss).toContain("warehouse roof");
  await expect(page.getByText("Notified", { exact: true })).toBeVisible();
  await expect(page.getByText("large claim", { exact: false })).toBeVisible();
  await expect(
    page.getByText("coverage version in force", { exact: false }),
  ).toBeVisible();
});

test("captures Claims consent from the opportunity detail screen (Part D §5.1, Claims touchpoint)", async ({
  page,
}) => {
  await mockAuth(page, ["CLAIMS_OFFICER"]);
  await mockRfqApi(page, {
    opportunityStatus: "PLACEMENT",
    seedIssuedPolicy: true,
  });
  let captured = false;
  await page.route("http://localhost:4000/consent-records**", (route) => {
    if (route.request().method() === "POST") {
      captured = true;
      return route.fulfill({
        status: 201,
        json: {
          id: "consent-claims-1",
          customerId: "cust-1",
          insuredPersonId: null,
          leadId: null,
          purpose: "CLAIMS",
          isMarketing: false,
          granted: true,
          consentTextVersion: "claims-notice-v1",
          grantedAt: "2026-11-15T00:00:00.000Z",
          withdrawnAt: null,
          isActive: true,
          createdAt: "2026-11-15T00:00:00.000Z",
        },
      });
    }
    return route.fulfill({
      status: 200,
      json: captured ? [{ id: "consent-claims-1", isActive: true }] : [],
    });
  });

  await page.goto("/opportunities/opp-1");
  await expect(
    page.getByRole("heading", { name: "Claims consent" }),
  ).toBeVisible();
  await expect(page.getByText("No decision captured yet.")).toBeVisible();

  await page.getByRole("button", { name: "Grant" }).click();
  await expect.poll(() => captured).toBe(true);
});

test("registers a NOTIFIED claim with the insurer and assigns the adjuster", async ({
  page,
}) => {
  await mockAuth(page, ["CLAIMS_OFFICER"]);
  let registered: {
    insurerClaimReference: string;
    adjuster: { name: string };
  } | null = null;
  await mockRfqApi(page, {
    opportunityStatus: "PLACEMENT",
    seedIssuedPolicy: true,
    onRegisterClaim: (b) => {
      registered = b;
    },
  });

  await page.goto("/opportunities/opp-1");
  await expect(
    page.getByRole("heading", { name: "Claims", exact: true }),
  ).toBeVisible();

  // notify first
  await page.getByLabel("Loss date").fill("2026-11-15");
  await page
    .getByLabel("Cause of loss")
    .fill("Burst riser main flooded unit 4.");
  await page.getByLabel("Estimated loss").fill("14000.000");
  await page.getByRole("button", { name: "Notify claim" }).click();
  await expect(page.getByText("Notified", { exact: true })).toBeVisible();

  // the registration form appears on the NOTIFIED claim
  await page.getByLabel("Insurer claim reference").fill("INS-CLM-2026-9001");
  await page.getByLabel("Loss adjuster").fill("Cunningham Lindsey");
  await page.getByLabel("Adjuster firm (optional)").fill("CL Loss Adjusters");
  await page
    .getByRole("button", { name: "Register & assign adjuster" })
    .click();

  await expect
    .poll(() => registered?.insurerClaimReference)
    .toBe("INS-CLM-2026-9001");
  await expect.poll(() => registered?.adjuster.name).toBe("Cunningham Lindsey");
  await expect(page.getByText("Registered", { exact: true })).toBeVisible();
  await expect(
    page.getByText("adjuster Cunningham Lindsey", { exact: false }),
  ).toBeVisible();
});

test("files claim documentation and tracks the mandatory checklist", async ({
  page,
}) => {
  await mockAuth(page, ["CLAIMS_OFFICER"]);
  let attached: {
    documents: { docType: string; classification: string }[];
  } | null = null;
  await mockRfqApi(page, {
    opportunityStatus: "PLACEMENT",
    seedIssuedPolicy: true,
    onAttachClaimDocs: (b) => {
      attached = b;
    },
  });

  await page.goto("/opportunities/opp-1");
  await expect(
    page.getByRole("heading", { name: "Claims", exact: true }),
  ).toBeVisible();

  // notify + register
  await page.getByLabel("Loss date").fill("2026-11-15");
  await page
    .getByLabel("Cause of loss")
    .fill("Storm ripped the roof sheeting.");
  await page.getByLabel("Estimated loss").fill("14000.000");
  await page.getByRole("button", { name: "Notify claim" }).click();
  await expect(page.getByText("Notified", { exact: true })).toBeVisible();

  await page.getByLabel("Insurer claim reference").fill("INS-DOC-1");
  await page.getByLabel("Loss adjuster").fill("Cunningham Lindsey");
  await page
    .getByRole("button", { name: "Register & assign adjuster" })
    .click();
  await expect(page.getByText("Registered", { exact: true })).toBeVisible();

  /*
   * The documentation checklist shows the missing mandatory docs — BY NAME.
   *
   * 🔴 THIS ASSERTION PINNED THE DEFECT AND IS CORRECTED RATHER THAN DELETED. The final walk
   * §ب-٦ read «التوثيق · ناقص claim_form, medical_report, invoice» off the claim card: the
   * header printed the STORED CODES directly above a list whose every row already carried the
   * shipping name. The codes are the names now, through the same `ENUM_LABEL.ClaimDocType` the
   * list uses.
   */
  await expect(
    page.getByText("missing Claim form, Photo, Repair estimate"),
  ).toBeVisible();

  await page.getByLabel("Document type").selectOption("claim_form");
  await page.getByLabel("File name").fill("claim-form.pdf");
  await page.getByLabel("Storage reference").fill("s3://claims/cf");
  await page.getByRole("button", { name: "File document" }).click();

  await expect.poll(() => attached?.documents[0].docType).toBe("claim_form");
  await expect(
    page.getByText("Documentation in progress", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("missing Photo, Repair estimate"),
  ).toBeVisible();
});

test("tracks the adjuster survey, submits for assessment once the checklist is complete, and records the verdict", async ({
  page,
}) => {
  await mockAuth(page, ["CLAIMS_OFFICER"]);
  const steps: string[] = [];
  await mockRfqApi(page, {
    opportunityStatus: "PLACEMENT",
    seedIssuedPolicy: true,
    onClaimAssessment: (b) => {
      steps.push(b.step as string);
    },
  });

  await page.goto("/opportunities/opp-1");
  await expect(
    page.getByRole("heading", { name: "Claims", exact: true }),
  ).toBeVisible();

  // notify + register
  await page.getByLabel("Loss date").fill("2026-11-15");
  await page
    .getByLabel("Cause of loss")
    .fill("Storm ripped the roof sheeting.");
  await page.getByLabel("Estimated loss").fill("14000.000");
  await page.getByRole("button", { name: "Notify claim" }).click();
  await page.getByLabel("Insurer claim reference").fill("INS-ASMT-1");
  await page.getByLabel("Loss adjuster").fill("Cunningham Lindsey");
  await page
    .getByRole("button", { name: "Register & assign adjuster" })
    .click();
  await expect(page.getByText("Registered", { exact: true })).toBeVisible();

  // file every mandatory document
  await fileMandatoryClaimDocuments(page);

  // record the adjuster's survey + investigation
  await page
    .getByLabel("Completion date (adjuster survey / investigation)")
    .fill("2026-11-16");
  await page.getByRole("button", { name: "Mark survey complete" }).click();
  await page
    .getByRole("button", { name: "Mark investigation complete" })
    .click();
  await expect
    .poll(() => steps.filter((s) => s === "adjuster-progress").length)
    .toBe(2);

  // submit for assessment, then record the verdict
  await page.getByRole("button", { name: "Submit for assessment" }).click();
  await expect(
    page.getByText("Under assessment", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Assessment verdict")
    .selectOption("PARTIALLY_APPROVED");
  await page.getByRole("button", { name: "Record verdict" }).click();

  // the verdict shows and the decision control is gone
  await expect(page.getByText("Verdict Partially approved")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Record verdict" }),
  ).toHaveCount(0);
  expect(steps).toEqual([
    "adjuster-progress",
    "adjuster-progress",
    "submit",
    "decision",
  ]);
});

test("raises an insurer non-response follow-up alert via the sweep and resolves it", async ({
  page,
}) => {
  await mockAuth(page, ["CLAIMS_OFFICER"]);
  const steps: string[] = [];
  await mockRfqApi(page, {
    opportunityStatus: "PLACEMENT",
    seedIssuedPolicy: true,
    onClaimFollowUp: (b) => {
      steps.push(b.step as string);
    },
  });

  await page.goto("/opportunities/opp-1");
  await expect(
    page.getByRole("heading", { name: "Claims", exact: true }),
  ).toBeVisible();

  // notify + register — the claim is now REGISTERED, awaiting the insurer.
  await page.getByLabel("Loss date").fill("2026-11-15");
  await page.getByLabel("Cause of loss").fill("Roof torn off in a gale.");
  await page.getByLabel("Estimated loss").fill("14000.000");
  await page.getByRole("button", { name: "Notify claim" }).click();
  await page.getByLabel("Insurer claim reference").fill("INS-FU-1");
  await page.getByLabel("Loss adjuster").fill("Cunningham Lindsey");
  await page
    .getByRole("button", { name: "Register & assign adjuster" })
    .click();
  await expect(page.getByText("Registered", { exact: true })).toBeVisible();

  // no alert yet
  await expect(page.getByText("Insurer follow-up alert")).toHaveCount(0);

  // run the sweep — the pre-verdict claim gets an alert
  await page.getByRole("button", { name: "Run follow-up sweep" }).click();
  await expect(page.getByText("Insurer follow-up alert")).toBeVisible();

  // resolve it
  await page.getByRole("button", { name: "Resolve", exact: true }).click();
  await expect(page.getByText("Insurer follow-up alert")).toHaveCount(0);

  expect(steps).toEqual(["sweep", "resolve"]);
});

test("settles a small claim straight through as four distinct figures", async ({
  page,
}) => {
  await mockAuth(page, ["CLAIMS_OFFICER"]);
  let settlement: Record<string, unknown> | null = null;
  await mockRfqApi(page, {
    opportunityStatus: "PLACEMENT",
    seedIssuedPolicy: true,
    onClaimSettlement: (b) => {
      settlement = b;
    },
  });

  await page.goto("/opportunities/opp-1");
  await expect(
    page.getByRole("heading", { name: "Claims", exact: true }),
  ).toBeVisible();

  await driveClaimToVerdict(page, {
    estimatedLoss: "20000.000",
    verdict: "APPROVED",
    insurerRef: "INS-STL-1",
  });

  // the settlement form appears once the claim is APPROVED
  await page.getByLabel("Approved amount").fill("17500.000");
  await page.getByLabel("Deductible").fill("2500.000");
  await page.getByRole("button", { name: "Record settlement" }).click();

  // under the large-claim threshold and not broker-processed -> settles now,
  // and all four distinct figures render (never one collapsed number).
  await expect(
    page.getByText(
      /Estimated .+ · approved .+ · deductible .+ · net .+ · settled/,
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Record settlement" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Second-approve settlement" }),
  ).toHaveCount(0);

  await expect.poll(() => settlement?.approvedAmount).toBe("17500.000");
  await expect.poll(() => settlement?.deductible).toBe("2500.000");
});

test("a large claim settlement blocks on a mandatory distinct second approver", async ({
  page,
}) => {
  await mockAuth(page, ["CLAIMS_OFFICER", "BRANCH_DEPARTMENT_MANAGER"]);
  const steps: string[] = [];
  await mockRfqApi(page, {
    opportunityStatus: "PLACEMENT",
    seedIssuedPolicy: true,
    onClaimSettlement: (b) => {
      steps.push(b.step as string);
    },
  });

  await page.goto("/opportunities/opp-1");
  await expect(
    page.getByRole("heading", { name: "Claims", exact: true }),
  ).toBeVisible();

  await driveClaimToVerdict(page, {
    estimatedLoss: "40000.000",
    verdict: "PARTIALLY_APPROVED",
    insurerRef: "INS-STL-2",
  });

  await page.getByLabel("Approved amount").fill("30000.000");
  await page.getByLabel("Deductible").fill("5000.000");
  await page.getByRole("button", { name: "Record settlement" }).click();

  // over the large-claim threshold -> all four figures recorded, but NOT
  // settled: it waits on a second approver who cannot be the first.
  await expect(
    page.getByText(
      /Estimated .+ · approved .+ · deductible .+ · net .+ · awaiting a second approver/,
    ),
  ).toBeVisible();
  await expect(page.getByText(/· settled/)).toHaveCount(0);

  await page.getByRole("button", { name: "Second-approve settlement" }).click();

  // the second approval settles it
  await expect(page.getByText(/· second-approved · settled/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Second-approve settlement" }),
  ).toHaveCount(0);

  expect(steps).toEqual(["record", "second-approve"]);
});

test("closes a settled claim once the client payment receipt is confirmed", async ({
  page,
}) => {
  await mockAuth(page, ["CLAIMS_OFFICER"]);
  let closure: Record<string, unknown> | null = null;
  await mockRfqApi(page, {
    opportunityStatus: "PLACEMENT",
    seedIssuedPolicy: true,
    onClaimClosure: (b) => {
      closure = b;
    },
  });

  await page.goto("/opportunities/opp-1");
  await expect(
    page.getByRole("heading", { name: "Claims", exact: true }),
  ).toBeVisible();

  await driveClaimToVerdict(page, {
    estimatedLoss: "20000.000",
    verdict: "APPROVED",
    insurerRef: "INS-CLS-1",
  });
  await page.getByLabel("Approved amount").fill("17500.000");
  await page.getByLabel("Deductible").fill("2500.000");
  await page.getByRole("button", { name: "Record settlement" }).click();
  await expect(page.getByText(/· net .+ · settled/)).toBeVisible();

  // the closure block asks for the client payment date, then closes
  await page
    .getByLabel("Client received the settlement payment on")
    .fill("2026-12-01");
  await page
    .getByRole("button", { name: "Confirm payment & close claim" })
    .click();

  await expect(page.getByText(/^Closed /)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm payment & close claim" }),
  ).toHaveCount(0);
  await expect.poll(() => closure?.clientPaymentConfirmedAt).toBe("2026-12-01");
});

test("RFQ screens have no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockRfqApi(page);

  await page.goto("/opportunities/opp-1");
  await expect(
    page.getByRole("heading", { name: /Opportunity — Acme Trading/ }),
  ).toBeVisible();
  const oppResults = await new AxeBuilder({ page }).analyze();
  expect(
    oppResults.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);

  await page.goto("/rfqs/rfq-1");
  await expect(page.getByText("Insurer submissions")).toBeVisible();
  const rfqResults = await new AxeBuilder({ page }).analyze();
  expect(
    rfqResults.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});

/*
 * THE COMBINED-DUTY ACT ON THE POLICY'S QUALITY CHECK — Part 4 step 5, the second pair to show it.
 *
 * When an office declares COMBINED duty segregation, one person may place AND check the same policy
 * by stating why. Until now that was visible only in the report at `/internal-controls`: the policy
 * showed `placedByUserId` and `checkedByUserId` and a reader could not tell they were the same person
 * without looking both up. **The four-eyes check is exactly the place somebody must be able to see
 * there were not four eyes.**
 *
 * Rendered by the SHARED `CombinedDutyOnRecord`, which the endorsement's refund block now also uses —
 * so the sentence reads the same on both, and the remaining twelve pairs are one line each.
 */

const SELF_CHECK_ACT = {
  id: "cda-1",
  at: "2026-10-05T00:00:00.000Z",
  actorUserId: "someone-else",
  reason: "Only qualified checker present; branch covered alone this week.",
  pair: "PolicyChecking_maker_checker_distinct",
  roles: ["POLICY_CHECKING_OFFICER"],
  hatAmbiguous: false,
};

test("shows on the policy that one person both placed and checked it, and why", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockRfqApi(page, {
    seedActivePolicy: true,
    seedCombinedDutyAct: SELF_CHECK_ACT,
  });
  await page.goto("/opportunities/opp-1");

  const declared = page.getByTestId("combined-duty-policy-checking");
  // The hat and the reason. The reason is what a reader is entitled to — a bare "self-approved" says
  // nothing about whether it was reasonable.
  await expect(declared).toContainText("POLICY_CHECKING_OFFICER");
  await expect(declared).toContainText("Only qualified checker present");
  // Tied to the database rule it excuses, so the record and the constraint cannot drift apart.
  await expect(declared).toHaveAttribute(
    "data-combined-duty-pair",
    "PolicyChecking_maker_checker_distinct",
  );
});

test("says the authorising role cannot be determined when more than one granted it", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockRfqApi(page, {
    seedActivePolicy: true,
    seedCombinedDutyAct: {
      ...SELF_CHECK_ACT,
      roles: ["POLICY_CHECKING_OFFICER", "BRANCH_DEPARTMENT_MANAGER"],
      hatAmbiguous: true,
    },
  });
  await page.goto("/opportunities/opp-1");

  // The act records ambiguity deliberately rather than picking one role, and the record must not
  // resolve it either — naming one would assert something the system cannot know.
  const declared = page.getByTestId("combined-duty-policy-checking");
  await expect(declared).toContainText("cannot be determined");
  await expect(declared).toContainText("BRANCH_DEPARTMENT_MANAGER");
});

test("says nothing on an ordinary two-person check", async ({ page }) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  // The same seed WITHOUT an act — `chk-1` checked what `someone-else` placed, which is every
  // ordinary check and nearly every record.
  await mockRfqApi(page, { seedActivePolicy: true });
  await page.goto("/opportunities/opp-1");

  // Anchored on the quality-check block itself, from the SAME read that would carry the act — so the
  // absence cannot pass while that read is still in flight.
  await expect(page.getByText("Checked by", { exact: false })).toBeVisible();
  await expect(page.getByTestId("combined-duty-policy-checking")).toHaveCount(
    0,
  );
});

/*
 * THE COMBINED-DUTY ACT ON THE BROKER'S RECOMMENDATION — Part 4 step 5.
 *
 * `Recommendation_maker_checker_distinct` requires that whoever DRAFTS the recommendation is not whoever
 * approves it for sending. **This is the advice the client acts on when buying insurance** — this
 * product's whole professional-indemnity exposure sits on it, which is why `ProfessionalIndemnityPolicy`
 * exists as a model at all — so whether a second person agreed with the advice before it went out is what
 * the record is for.
 *
 * The approval line reads "Approved" whether a second person agreed or the drafter approved her own,
 * which is why the ordinary-case test asserts that line IS shown rather than asserting silence alone.
 */

const SELF_APPROVED_RECOMMENDATION_ACT = {
  id: "cda-rec-1",
  at: "2026-03-09T00:00:00.000Z",
  actorUserId: "user-1",
  reason:
    "Sole senior officer in this branch; the client's cover incepted the following Monday.",
  pair: "Recommendation_maker_checker_distinct",
  roles: ["BRANCH_DEPARTMENT_MANAGER"],
  hatAmbiguous: false,
};

test("shows on the recommendation that one person both drafted and approved it, and why", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockRfqApi(page, {
    seedRecommendationCombinedDutyAct: SELF_APPROVED_RECOMMENDATION_ACT,
  });
  await page.goto("/opportunities/opp-1");

  const declared = page.getByTestId("combined-duty-recommendation-rec-1");
  // The hat and the reason. A bare "self-approved" says nothing about whether it was reasonable.
  await expect(declared).toContainText("BRANCH_DEPARTMENT_MANAGER");
  await expect(declared).toContainText("Sole senior officer in this branch");
  // Tied to the database rule it excuses, so the record and the constraint cannot drift apart.
  await expect(declared).toHaveAttribute(
    "data-combined-duty-pair",
    "Recommendation_maker_checker_distinct",
  );
});

test("the recommendation declares nothing when two people agreed with the advice", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockRfqApi(page, { seedApprovedRecommendation: true });
  await page.goto("/opportunities/opp-1");

  // Anchored on the approval line itself, from the SAME read that would carry the act — so the absence
  // cannot pass while that read is still in flight, and cannot pass on a line that stopped rendering the
  // declaration at all.
  await expect(
    page.getByText("Approved", { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByTestId("combined-duty-recommendation-rec-1"),
  ).toHaveCount(0);
});

/**
 * DECISION ITEM 7 — the refusal on our own error path now names a cause and a way forward.
 *
 * `GET /rfqs/:id` answers 404 rather than 403 for a record in another owner's book, deliberately: a
 * 403 would confirm that the record exists. That pattern is CORRECT and is not what changed.
 *
 * What changed is the sentence. It used to read "it may not exist, or you may not have access to it"
 * — true, and it names neither a likely cause nor anything to do next, which is the class this whole
 * module was spent removing. Both tests below drive the SAME screen through the two statuses and
 * assert the same sentence, because the ambiguity is the point: a reader must not be able to tell a
 * missing record from somebody else's.
 */
for (const status of [404, 403] as const) {
  test(`the ${status} on an RFQ names a likely cause and a way forward, and confirms nothing`, async ({
    page,
  }) => {
    await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
    await page.route("http://localhost:4000/rfqs/rfq-1", (route) =>
      route.fulfill({ status, json: { message: "RFQ not found" } }),
    );
    await page.route("http://localhost:4000/rfqs/rfq-1/communications", (route) =>
      route.fulfill({ status, json: { message: "RFQ not found" } }),
    );

    await page.goto("/rfqs/rfq-1");

    const notice = page.locator("main").getByText("could not be found", {
      exact: false,
    });
    await expect(notice).toBeVisible();
    // THE WAY FORWARD is the half that was missing. Asserted separately from the sentence above,
    // because a reword that drops it would otherwise still satisfy the first assertion.
    await expect(
      page.getByText("may not be one of your files", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByText("check the reference, or ask the file", { exact: false }),
    ).toBeVisible();
    // AND NO ROLE NAME IN THE SENTENCE. The first wording said "your branch manager" and was
    // withdrawn on measurement: zero `Branch` rows exist, and the reader most likely to see this
    // sentence is the sole practitioner who owns every file. Asserted as an ABSENCE, which is the
    // only form that can fail if somebody adds one back to be helpful.
    //
    // SCOPED TO THE NOTICE, not page-wide. The first version of this loop was page-wide and matched
    // "Compliance" in the NAV SIDEBAR — a real label, nothing to do with this sentence — so it
    // failed on a correct tree. Page-wide text assertions on this app are the trap IMPROVEMENTS
    // § 1.85 records, and this is the fourth time it has been paid for.
    const sentence = (await notice.textContent()) ?? "";
    for (const role of [
      "branch manager",
      "Manager",
      "Administrator",
      "Compliance",
      "Executive",
    ]) {
      expect(sentence).not.toContain(role);
    }
    // AND IT CONFIRMS NOTHING. Anchored on the notice above already being visible, so this cannot
    // pass on a page that never rendered. The API's own English message must be absent too —
    // passing it straight through is the behaviour this scheme replaced.
    await expect(
      page.getByText("you may not have access", { exact: false }),
    ).toHaveCount(0);
    await expect(
      page.locator("main").getByText("RFQ not found", { exact: false }),
    ).toHaveCount(0);
  });
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 OWNER DECISION 143 — «إرفاق المراسلة», THE BUTTON THAT CLEARS «بلا إثبات».
 *
 * ## WHY THESE ARE HERE AND NOT ONLY IN THE api e2e
 *
 * `POST /rfqs/:id/article-15-d/evidence` has had an api spec since 2026-11-15 proving it clears
 * the mark, refuses WhatsApp, an outbound message and another customer's message, and that the
 * database refuses to un-clear it. **None of that was evidence that a person could reach it** —
 * and they could not: there was no control on any screen, because the label did not exist.
 *
 * So what is proven here is the half that was missing, which is decision 143's own criterion 2:
 * «موظف يصل إلى الإرفاق بالكبس من الشاشة» — an employee gets there by clicking.
 *
 * ⚠️ `lacksEvidence` IS DERIVED BY THE SERVER, so each mock answers it the way the api does:
 * marked before the attach, unmarked after. A mock that flipped nothing would let a screen which
 * hid the mark locally pass — which is exactly the implementation this component refuses.
 * ───────────────────────────────────────────────────────────────────────────────────────────── */

const EXEMPTION_5_UNPROVEN = {
  id: "exm-1",
  exemption: "AT_CUSTOMER_REQUEST",
  basis: "CHOSEN_BY_PERSON",
  insurerCount: 1,
  declaredAnnualPremiumJod: null,
  ceilingValueJod: null,
  evidenceCommunicationLogId: null,
  lacksEvidence: true,
  chosenByNameShown: "Placement Officer",
  recordedAt: "2026-03-02T00:00:00.000Z",
};

const EVIDENCE_CANDIDATES = [
  { id: "log-1", channel: "EMAIL", sentAt: "2026-03-01T09:00:00.000Z" },
  { id: "log-2", channel: "WRITTEN_NOTICE", sentAt: "2026-02-20T09:00:00.000Z" },
];

/**
 * The RFQ detail endpoint answering the mark the way the api derives it, plus the candidate list
 * and the attach. `attachedTo` is what the server would have written.
 */
async function mockMarkedRfq(
  page: Page,
  options: {
    candidates?: typeof EVIDENCE_CANDIDATES;
    attachStatus?: number;
  } = {},
) {
  const state = { attachedTo: null as string | null };
  await page.route("http://localhost:4000/rfqs/rfq-1", (route) =>
    route.fulfill({
      status: 200,
      json: {
        ...RFQ,
        article15DExemption: {
          ...EXEMPTION_5_UNPROVEN,
          evidenceCommunicationLogId: state.attachedTo,
          lacksEvidence: state.attachedTo === null,
          /*
           * 🔴 OWNER DECISION 159 RULING 4 — what the api sends once the message is attached:
           * the chosen log's own means and date, flattened off the join. `null` while the mark
           * is still on, which is the state every test above this one is in.
           */
          evidence:
            state.attachedTo === null
              ? null
              : (EVIDENCE_CANDIDATES.find((c) => c.id === state.attachedTo) ??
                null),
        },
        article15DAlerts: [],
      },
    }),
  );
  await page.route("http://localhost:4000/rfqs/rfq-1/communications", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route(
    "http://localhost:4000/rfqs/rfq-1/article-15-d/evidence-options",
    (route) =>
      route.fulfill({
        status: 200,
        json: options.candidates ?? EVIDENCE_CANDIDATES,
      }),
  );
  await page.route(
    "http://localhost:4000/rfqs/rfq-1/article-15-d/evidence",
    async (route) => {
      const status = options.attachStatus ?? 201;
      if (status >= 400) {
        return route.fulfill({ status, json: { message: "refused" } });
      }
      const body = route.request().postDataJSON() as {
        evidenceCommunicationLogId: string;
      };
      state.attachedTo = body.evidenceCommunicationLogId;
      return route.fulfill({ status, json: { attached: true } });
    },
  );
  return state;
}

/**
 * CRITERION 1 and CRITERION 2 together, because they are one sentence of hers: the button appears
 * on a marked exemption 5, it carries HER word, and pressing it clears the mark.
 *
 * Rendered in ARABIC deliberately. The label is the one thing decision 143 actually decided, and
 * asserting the English rendering would prove the control exists while proving nothing about the
 * word — which is the entire content of the ruling.
 */
test("OWNER DECISION 143 criteria 1+2 — the attach button stands on the marked exemption, and clicking it clears the mark", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"], "AR");
  const state = await mockMarkedRfq(page);

  await page.goto("/rfqs/rfq-1");

  const record = page.locator('[data-article-15-d="record"]');
  await expect(record).toBeVisible();
  // THE MARK FIRST. The button is only correct BESIDE it — a control to clear a mark that is not
  // showing would be a control for a problem nobody has.
  await expect(
    record.locator('[data-article-15-d="lacks-evidence"]'),
  ).toBeVisible();

  const button = record.locator('[data-article-15-d="attach-button"]');
  await expect(button).toBeVisible();
  // CRITERION 1 — her word, off a real render. The byte-for-byte comparison against decision 143
  // itself lives in `lib/i18n/article-15-d.strings.test.ts`; this proves the dictionary entry
  // actually REACHES THE SCREEN, which a dictionary test cannot.
  await expect(button).toHaveText("إرفاق المراسلة");

  // CRITERION 2 — the employee gets there by clicking. Choosing is a separate act from attaching,
  // because the row is WRITE-ONCE and no permission takes it back.
  await expect(button).toBeDisabled();
  await record.locator('[data-evidence-id="log-1"]').check();
  await expect(button).toBeEnabled();
  await button.click();

  // THE MARK IS GONE, and it is gone because the REQUEST WAS RE-READ — the mock answers
  // `lacksEvidence: false` only after the attach landed, so a screen that hid the mark locally
  // would pass the assertion below while `attachedTo` stayed null.
  await expect(
    record.locator('[data-article-15-d="lacks-evidence"]'),
  ).toHaveCount(0);
  expect(state.attachedTo).toBe("log-1");
});

/**
 * CRITERION 4 — «بعد رفع الوسم لا يظهر الزرّ». Asserted as its own test rather than tacked onto
 * the one above, because it is the property that keeps the control honest: the attach is
 * irreversible, so a button that lingered would invite a second attempt that can only ever 409.
 */
test("OWNER DECISION 143 criterion 4 — the button is gone once the mark is", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockMarkedRfq(page);

  await page.goto("/rfqs/rfq-1");
  const record = page.locator('[data-article-15-d="record"]');
  const button = record.locator('[data-article-15-d="attach-button"]');
  await expect(button).toBeVisible();

  await record.locator('[data-evidence-id="log-2"]').check();
  await button.click();

  await expect(button).toHaveCount(0);
  // AND THE CANDIDATE LIST GOES WITH IT. A picker left standing under a cleared mark would offer
  // a choice the server now refuses outright.
  await expect(
    record.locator('[data-article-15-d="attach-candidate"]'),
  ).toHaveCount(0);
});

/**
 * THE EMPTY OFFER SAYS WHAT SHE RATIFIED — decision 143 §4's «والقائمة الفارغة تعرض جملة القرار
 * ١٣٩ بحرفها», which is the SAME key the creation window uses.
 *
 * The employee told «يمكنك المتابعة» when the request went out meets those same words when they
 * come back to prove it. Two sentences for one fact would be the screen saying two different
 * things about the same gap.
 */
test("OWNER DECISION 143 — an empty offer renders decision 139's own sentence, and the button stays", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"], "AR");
  await mockMarkedRfq(page, { candidates: [] });

  await page.goto("/rfqs/rfq-1");
  const record = page.locator('[data-article-15-d="record"]');
  const none = record.locator('[data-article-15-d="attach-none"]');
  await expect(none).toBeVisible();
  await expect(none).toContainText("يمكنك المتابعة");
  // ⛔ AND THE CONTROL DOES NOT VANISH WITH ITS LIST. An employee facing no button and no sentence
  // cannot tell «there is nothing to attach» from «this screen cannot attach at all».
  await expect(
    record.locator('[data-article-15-d="attach-button"]'),
  ).toBeVisible();
  await expect(
    record.locator('[data-article-15-d="attach-button"]'),
  ).toBeDisabled();
});

/**
 * 🔴 AND A READER WHO MAY SEE THE MARK AND MAY NOT CLEAR IT GETS NO CONTROL.
 *
 * `frontend-ux-directive.md` — a control a role cannot use does not exist on their screen — and
 * the route carries `rfq.communication.log`, which a compliance reader need not hold. Measured
 * 2026-11-16: exactly ONE of the twelve seeded roles holds it, `PLACEMENT_TECHNICAL_OFFICER`.
 *
 * ⚠️ NON-VACUOUS BY CONSTRUCTION: the mark itself is asserted VISIBLE first. A reader who could
 * not reach the RFQ at all would see no button either, and this test would pass for the wrong
 * reason — the defect the dismiss button's own absence test was corrected for.
 */
test("OWNER DECISION 143 — the mark shows without the button for a reader who cannot attach", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockMarkedRfq(page);

  await page.goto("/rfqs/rfq-1");
  const record = page.locator('[data-article-15-d="record"]');
  await expect(
    record.locator('[data-article-15-d="lacks-evidence"]'),
  ).toBeVisible();
  await expect(
    record.locator('[data-article-15-d="attach-button"]'),
  ).toHaveCount(0);
  await expect(record.locator('[data-article-15-d="attach"]')).toHaveCount(0);
});

/**
 * 🔴 OWNER DECISION 145(ب) CRITERION 4 — THE ATTACH FAILS AND THE SCREEN SAYS SO IN HER WORDS.
 *
 * Message 42 shipped this branch borrowing «تعذر تسجيل المراسلة» and reported the gap as an empty
 * cell: no decision ratified a sentence for *the attach failed*, and decision 125 forbids
 * composing one. She ruled it on 2026-11-16.
 *
 * Rendered in ARABIC, for the same reason criterion 1 is: the sentence IS the ruling, and an
 * English render would prove an error element exists while proving nothing about the word.
 *
 * ⚠️ NON-VACUOUS: the button is asserted ENABLED and the click is what produces the message. An
 * error element that rendered on load — a failed candidate list, say — would satisfy a bare
 * toBeVisible() while the attach branch stayed untested, and those two branches carry DIFFERENT
 * sentences by her ruling.
 */
test("OWNER DECISION 145 criterion 4 — a failed attach says «تعذّر إرفاق المراسلة.»", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"], "AR");
  await mockMarkedRfq(page, { attachStatus: 500 });

  await page.goto("/rfqs/rfq-1");
  const record = page.locator('[data-article-15-d="record"]');
  const button = record.locator('[data-article-15-d="attach-button"]');

  // The list LOADED — so nothing has failed yet, and the error element is absent rather than
  // merely empty. This is what makes the assertion below about the ATTACH and not the load.
  await expect(record.locator('[data-article-15-d="attach-error"]')).toHaveCount(
    0,
  );
  await record.locator('[data-evidence-id="log-1"]').check();
  await expect(button).toBeEnabled();
  await button.click();

  const failure = record.locator('[data-article-15-d="attach-error"]');
  await expect(failure).toBeVisible();
  await expect(failure).toHaveText("تعذّر إرفاق المراسلة.");

  // ⛔ AND IT IS NOT THE LIST SENTENCE. Her ruling keeps «تعذر تحميل سجل المراسلات» for the
  // load because it is true of what failed there; a single sentence serving both would make the
  // screen say the list failed when the write did.
  await expect(failure).not.toHaveText(
    "تعذر تحميل سجل المراسلات — حاول مرة أخرى.",
  );

  // AND THE MARK SURVIVES A FAILED ATTACH. The server wrote nothing, so a screen that cleared the
  // mark optimistically would tell an inspector the exemption is proven when it is not.
  await expect(
    record.locator('[data-article-15-d="lacks-evidence"]'),
  ).toBeVisible();
});

/**
 * 🔴 OWNER DECISIONS 153 §٢ AND 157 — NO ENGLISH LEFT ON THE POLICY SECTION, IN ARABIC.
 *
 * The owner's fourth answer sheet is about a reader who opens an opportunity carrying a policy
 * and meets: «Requested JOD 1,200.000 · Issued JOD 1,180.000 (Δ JOD 20.000)» then «Inception
 * 01/11/2026 · Expiry 31/10/2027» then «Checked by 8f3c1a92-…». Five English words and a
 * 36-character internal id, on the screen the demo walks.
 *
 * ## ⚠️ ANCHORED, AND ASSERTED NON-EMPTY FIRST
 *
 * A page-wide `not.toContainText('Requested')` passes on a screen that failed to load, and it
 * passes on a screen whose policy section never rendered — which is the shape this spec's own
 * `/insurance-programs` paragraph already records. So the section is located, proven VISIBLE and
 * proven to carry real content, and only then is the English asserted absent from it.
 */
test("the policy section says nothing in English to an Arabic reader", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"], "AR");
  await mockRfqApi(page, { seedActivePolicy: true });
  await page.goto("/opportunities/opp-1");

  const section = page.locator("section", {
    has: page.getByRole("heading", { name: "الوثيقة", exact: true }),
  });
  await expect(section).toBeVisible();

  // NON-VACUITY, in both directions: the section is rendered AND it is rendering the facts the
  // English used to sit beside. Without this, every absence below is satisfied by an empty box.
  await expect(section).toContainText("القسط المطلوب:");
  await expect(section).toContainText("تاريخ بدء التغطية:");
  await expect(section).toContainText("دقّقها:");
  // The checker is named, which is the half of row ٧ that needed the wire to change.
  await expect(section).toContainText("سامر الحديد");

  for (const english of [
    "Requested",
    "Issued",
    "Inception",
    "Expiry",
    "Checked by",
    "receipt acknowledged",
    "perils:",
    "extensions:",
    "Effective",
  ]) {
    await expect(
      section,
      `«${english}» is still on the policy section in Arabic`,
    ).not.toContainText(english);
  }

  // ⛔ AND THE INTERNAL ID IS GONE FROM THE LINE, which is decision 153 §٦ criterion 4 — not a
  // translation question at all. `chk-1` is what this fixture's `checkedByUserId` holds.
  await expect(section).not.toContainText("chk-1");
});

/**
 * 🔴 OWNER DECISION 157 RULING 1 — THE REFUSAL NAMES THE STAGE IT IS REFUSING.
 *
 * Decision 153 §٢ row ١٦ ratified «…لأنها في مرحلة التنسيب», and the server refuses an RFQ in
 * EVERY opportunity status other than `NEEDS_CONFIRMED` and `RFQ_ISSUED` — so the sentence was
 * true of one stage in eight and said «placement» to someone looking at a closed-lost file.
 *
 * Both ends are asserted, because one would not be enough: a screen hard-coding «التنسيب» passes
 * a PLACEMENT-only test perfectly.
 */
for (const [status, label] of [
  ["PLACEMENT", "التنسيب"],
  ["CLOSED_LOST", "مغلقة (خسارة)"],
] as const) {
  test(`the RFQ refusal names «${label}» when the opportunity is ${status}`, async ({
    page,
  }) => {
    await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"], "AR");
    await mockRfqApi(page, {});

    // The real refusal shape: the stable code and the status, as `rfq.service.ts` sends them.
    await page.route("http://localhost:4000/rfqs", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      return route.fulfill({
        status: 422,
        json: {
          code: "OPPORTUNITY_NOT_OPEN_FOR_RFQ",
          message: `Opportunity opp-1 is ${status}; an RFQ can only be issued while it is NEEDS_CONFIRMED or RFQ_ISSUED.`,
          opportunityStatus: status,
        },
      });
    });

    await page.goto("/rfqs/new?opportunityId=opp-1");
    // The same flow the English create test uses, in Arabic: the line is a CHOICE and the
    // shortlist a checkbox, and the submit control stays disabled until both are set.
    await page
      .getByLabel("فرع التأمين")
      .selectOption({ value: "Property All Risks" });
    // The insurer row goes through `insurerDisplayName`, so in Arabic ins-1 renders its
    // ARABIC name — which is the fix message 45 §2 shipped and this flow has to respect.
    await page.getByLabel("وادي رم التعاونية").check();
    const submit = page.getByRole("button", {
      name: "إنشاء طلب عرض الأسعار",
    });
    await expect(submit).toBeEnabled();
    await submit.click();

    // SCOPED TO `main`, the convention four other specs already use: Next.js renders its own
    // route announcer as `role="alert"` at the document root, so an unscoped lookup is a
    // strict-mode violation rather than a missing element.
    const error = page.locator("main").getByRole("alert");
    await expect(error).toBeVisible();
    await expect(error).toHaveText(
      `لا يُنشأ طلب عرض أسعار على هذه الفرصة لأنها في مرحلة «${label}».`,
    );
    // ⛔ AND NOT THE SERVER'S ENGLISH, which is what a code mismatch would fall back to.
    await expect(error).not.toContainText("an RFQ can only be issued");
  });
}

/**
 * 🔴 THE ART. 15/d SECTION IS IN VIEW WHEN IT APPEARS — the owner's walk, §S3.
 *
 * «خالد يختار الشركة الثانية في طلب العرض. يظهر سؤال الإعفاء تحت، خارج ما يراه، فيظنّ أن شيئاً
 * لم يحصل.» The section was rendered AFTER the follow-up threshold field, so on an ordinary
 * window it appeared below the fold — triggered by a click the employee had just made somewhere
 * else. Nothing scrolled to it and nothing pointed at it.
 *
 * ⟶ MOVED rather than scrolled to. This asserts the OUTCOME (in the viewport) rather than the
 *   mechanism, so the test still holds if that choice is ever revisited.
 *
 * ⚠️ AND THE VIEWPORT IS SET SMALL ON PURPOSE. Playwright's default is 1280×720, which is tall
 *   enough to have shown the section even where it was — so a test at the default size would
 *   have passed against the defect and proved nothing. 720 is a real laptop's content height.
 */
test("the art. 15/d question is in view the moment the shortlist raises it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"], "AR");
  await mockRfqApi(page, {});

  await page.route(
    "http://localhost:4000/rfqs/article-15-d/options**",
    (route) =>
      route.fulfill({
        status: 200,
        json: {
          required: true,
          minInsurers: 3,
          premiumCeilingJod: "2000.000",
          exemptions: [
            {
              exemption: "AT_CUSTOMER_REQUEST",
              because: "the customer asked for this insurer",
            },
          ],
          mayDeclare: true,
          evidence: [],
          window: {
            title: "المادة ١٥/د",
            text: "نص المستشار",
            reasonHint: "السبب",
            acknowledgement: "إقرار",
            reasonMinLength: 20,
          },
        },
      }),
  );

  await page.goto("/rfqs/new?opportunityId=opp-1");
  await page
    .getByLabel("فرع التأمين")
    .selectOption({ value: "Property All Risks" });

  const question = page.locator('[data-article-15-d="question"]');
  // NON-VACUITY: it is NOT on the screen before the shortlist is short of the minimum, so what
  // the assertion below observes is the appearance and not a section that was always there.
  await expect(question).toHaveCount(0);

  await page.getByLabel("وادي رم التعاونية").check();

  await expect(question).toBeVisible();
  // ⛔ IN THE VIEWPORT, not merely in the DOM. `toBeVisible` passes on an element below the
  // fold — it is exactly what the screen did before this change — so the box is compared with
  // the window's own height.
  const box = await question.boundingBox();
  expect(box, "the art. 15/d section has no box").not.toBeNull();
  const viewport = page.viewportSize();
  expect(
    box!.y,
    `the art. 15/d section starts at y=${box!.y} on a ${viewport!.height}px window — ` +
      "it appeared below the fold, which is the whole finding of walk §S3",
  ).toBeLessThan(viewport!.height);

  // AND IT IS ABOVE THE THRESHOLD FIELD, which is the arrangement that makes it reachable by
  // pressing Tab once from the control that raised it.
  const thresholdBox = await page.locator("#threshold").boundingBox();
  expect(thresholdBox).not.toBeNull();
  expect(box!.y).toBeLessThan(thresholdBox!.y);
});

/**
 * 🔴 OWNER DECISION 159 RULING 4 — AND WHAT WAS ATTACHED IS NAMED, WHERE THE MARK STOOD.
 *
 * Before this the attach left the record SILENT: the «بلا إثبات» paragraph disappeared and
 * nothing took its place, so the screen an inspector reads could not tell an exemption whose
 * evidence is on file from one that was never marked.
 *
 * Rendered in ARABIC, because the words are the ruling: «موافقة على كلمات قائمة الاختيار نفسها»
 * — the evidence label the creation window already ships, and the same «{date} · {channel}» the
 * candidate row prints. An English render would prove a paragraph exists and nothing about which
 * words are in it.
 */
test("OWNER DECISION 159 ruling 4 — the attached message is named where «بلا إثبات» stood", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"], "AR");
  const state = await mockMarkedRfq(page);
  await page.goto("/rfqs/rfq-1");

  const record = page.locator('[data-article-15-d="record"]');
  await expect(record).toBeVisible();
  // BEFORE: the mark is showing and nothing names an attachment, because there is none.
  await expect(
    record.locator('[data-article-15-d="lacks-evidence"]'),
  ).toBeVisible();
  await expect(
    record.locator('[data-article-15-d="evidence-attached"]'),
  ).toHaveCount(0);

  await record.locator('[data-evidence-id="log-1"]').check();
  await record.locator('[data-article-15-d="attach-button"]').click();

  // AFTER: the mark is gone and the message is named in its place.
  await expect(
    record.locator('[data-article-15-d="lacks-evidence"]'),
  ).toHaveCount(0);
  const named = record.locator('[data-article-15-d="evidence-attached"]');
  await expect(named).toBeVisible();
  // `a15dEvidenceLabel`, the creation window's own sentence — ⛔ no new word.
  await expect(named).toContainText("طلب العميل، واصلاً بوسيلة تبليغ معتمدة");
  // And the same two facts the candidate row printed: the date, then the means. The regex
  // tolerates the bidi marks `ar-JO-u-nu-latn` writes around each solidus.
  await expect(named).toContainText(/1.?\/3.?\/2026/);
  await expect(named).toContainText("بريد إلكتروني");
  // The attach really happened — so this is not a screen hiding the mark locally.
  expect(state.attachedTo).toBe("log-1");
});

/**
 * 🔴 THE FINAL WALK §ب-٧ — THE RECOMMENDATION CARD'S LINE, IN ARABIC.
 *
 * «Property All Risks · JOD … · 12.50% عمولة» on the opportunity page, which is the screen the
 * whole demo path runs through. The RFQ's two line FK ids were already selected and the
 * CATALOGUE ROWS they point at were not, so `insuranceLineNameAr` had nothing to read.
 */
test("THE FINAL WALK §ب-٧ — the Arabic recommendation card names the line in Arabic", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"], "AR");
  await mockRfqApi(page, { seedApprovedRecommendation: true });
  await page.goto("/opportunities/opp-1");

  // Anchored on the rationale, which is on the SAME render as the line: an unhydrated page
  // would satisfy the absence below and prove nothing.
  await expect(page.locator("main")).toContainText("Widest cover for the price");

  /*
   * SCOPED TO THE CARD'S OWN LINE, and that scope is a finding rather than a convenience: the
   * RFQ LIST higher up the same page still prints «Property All Risks», because `GET /rfqs`
   * sends no `insuranceLineAr` for a list row. ⚠️ Reported and NOT built — §1 item 9 widens the
   * RECOMMENDATION query only, and a page-wide absence here would have been a claim about a
   * query nobody touched.
   */
  const line = page.locator("[data-recommendation-line]");
  await expect(line).toBeVisible();
  await expect(line).toContainText("تأمين جميع أخطار الممتلكات");
  // ⛔ AND THE STORED ENGLISH IS NOT BESIDE IT. `lineDisplayName`'s fallback is ONE WAY, so an
  // Arabic render never shows both — which is what a per-field coalesce would have produced.
  await expect(line).not.toContainText("Property All Risks");
});

/**
 * 🔴 THE FINAL WALK §ب-٢ — A 403 UNDER «المطالبات» PRINTED THE SERVER'S OWN ENGLISH.
 *
 * «You do not hold a permission required to perform this action», rendered under the claims
 * heading on the opportunity page, for `demo.placement@office-a`. `ClaimSection` showed
 * `err.message` for every `ApiError`, so the api's English refusal reached an Arabic screen —
 * on the LAST section of the one screen the whole demo path runs through.
 *
 * Rendered in ARABIC, because that is where the defect is: in English the server's sentence is
 * merely unhelpful, and here it is the wrong language.
 */
test("THE FINAL WALK §ب-٢ — the claims section refuses in Arabic, not in the server's English", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"], "AR");
  await mockRfqApi(page);
  /*
   * REGISTERED AFTER `mockRfqApi`, which is what makes it win. 403 on the POLICIES read, which
   * is the first of the two this section needs — the refusal names BOTH codes, because the
   * reads are sequential in one `try` and the section cannot render without either.
   */
  await page.route("http://localhost:4000/policies**", (route) =>
    route.fulfill({
      status: 403,
      json: {
        message: "You do not hold a permission required to perform this action",
      },
    }),
  );
  await page.goto("/opportunities/opp-1");

  const main = page.locator("main");
  // POSITIVE FIRST, from the same render: the page itself loaded.
  await expect(main).toContainText("فرصة تجارية");
  // ⛔ The server's English sentence is nowhere on the screen.
  await expect(main).not.toContainText("You do not hold a permission");
  // And the refusal is the decided Arabic shape: the act, then who can grant it.
  await expect(main).toContainText("عرض المطالبات");
  await expect(main).toContainText("من يدير الصلاحيات في مكتبك");
});

/*
 * 🔴 MESSAGE 53 §1 ITEM 1 — THE FIVE CONTROLS ON THESE SCREENS THAT THE BASE SHAPE USED TO SKIP.
 *
 * Decision 161 ruling 2 put one base shape in `globals.css` for the controls nobody styled, and
 * its first selector asked only WHETHER a control had an inline style. Five of the controls the
 * owner's walk named are on this spec's screens, and every one of them names a layout property
 * and nothing else:
 *
 *   /rfqs/new        the insurance-line select  `{ minWidth: '20rem', marginTop: '0.35rem' }`
 *   /opportunities   the «بحث» submit button    `listSearchButtonStyle` (margin + align)
 *   /rfqs            the «بحث» submit button    the same
 *   /opportunities/[id]  the «← كل الفرص …» back button  `{ cursor: 'pointer' }`
 *   /rfqs/[id]           the «← كل طلبات …» back button  `{ cursor: 'pointer' }`
 *
 * ⚠️ THESE RUN HERE RATHER THAN IN `base-style.spec.ts` ON PURPOSE: the fixtures these screens
 * need are `mockRfqApi`'s, already proven by forty other tests in this file. Message 44 lost a
 * session to an invented fixture that rendered «This page couldn't load» and looked like a
 * product defect.
 *
 * ⚠️ AND BOTH THEMES, because ruling 4 says the presenter shows the LIGHT one — which is exactly
 * why the dark one needs a test: nobody will be looking at it on the day.
 */
for (const theme of ["light", "dark"] as BaseTheme[]) {
  test(`decision 163 §1 — the line select takes the base shape in ${theme}`, async ({
    page,
  }) => {
    await useTheme(page, theme);
    await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
    await mockRfqApi(page);
    await page.goto("/rfqs/new?opportunityId=opp-1");
    await expect(page.getByRole("heading", { name: "New RFQ" })).toBeVisible();
    await expectLayoutOnlyControl(
      page.getByLabel("Insurance line"),
      theme,
      "/rfqs/new line select",
    );
  });

  test(`decision 163 §1 — the two list search buttons take the base shape in ${theme}`, async ({
    page,
  }) => {
    await useTheme(page, theme);
    await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
    await mockRfqApi(page);

    await page.goto("/opportunities");
    await expect(
      page.getByRole("heading", { name: "RFQ / market" }),
    ).toBeVisible();
    await expectLayoutOnlyControl(
      page.locator("form").getByRole("button", { name: "Search" }),
      theme,
      "/opportunities search button",
    );

    await page.goto("/rfqs");
    await expect(page.getByRole("heading", { name: "RFQs" })).toBeVisible();
    await expectLayoutOnlyControl(
      page.locator("form").getByRole("button", { name: "Search" }),
      theme,
      "/rfqs search button",
    );
  });

  test(`decision 163 §1 — the two back buttons take the base shape in ${theme}`, async ({
    page,
  }) => {
    await useTheme(page, theme);
    await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
    await mockRfqApi(page);

    await page.goto("/opportunities/opp-1");
    await expectLayoutOnlyControl(
      page.getByRole("button", { name: "← All opportunities" }),
      theme,
      "/opportunities/[id] back button",
    );

    await page.goto("/rfqs/rfq-1");
    await expectLayoutOnlyControl(
      page.getByRole("button", { name: "← Back to the opportunity" }),
      theme,
      "/rfqs/[id] back button",
    );
  });
}

/*
 * 🔴 OWNER DECISION 163 RULING 1 — THE OPPORTUNITY'S TWO NAMES, WHERE TWO uuid SLICES WERE.
 *
 * The title was «فرصة تجارية 78684085» and the programme link «من برنامج التأمين 7c0b5103»;
 * both now carry a name the reader can act on. ⛔ Asserted with the fixture's own customer and
 * programme names AND with the absence of the id fragments, because a title that gained a name
 * while keeping the id would satisfy a presence check alone.
 */
test("decision 163 ruling 1 — the opportunity title and programme link carry names", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockRfqApi(page);
  await page.goto("/opportunities/opp-1");

  await expect(
    page.getByRole("heading", { name: "Opportunity — Acme Trading" }),
  ).toBeVisible();
  // The programme link reads the programme's own name, not eight characters of its id.
  await expect(
    page.getByRole("button", { name: "Head office" }),
  ).toBeVisible();

  const main = page.locator("main");
  // ⛔ AND NO id FRAGMENT SURVIVES. `opp-1` and `prog-1` are this fixture's ids; a real one is a
  // uuid, and `.slice(0, 8)` of either is what the walk read off the screen.
  await expectAbsentWithin(main, (scope) => scope.getByText("Opportunity opp-1"));
  await expectAbsentWithin(main, (scope) =>
    scope.getByText("From insurance program prog-1"),
  );
});

/*
 * 🔴 OWNER DECISION 163 RULING 1 — THE LIST CARD, AND THE ROW IT REPLACES.
 *
 * The card's heading was «فرصة تجارية {8 of uuid}» with a separate «العميل: X» row beneath it.
 * The heading names the customer now, and that row is gone rather than printing the same fact
 * twice — a stated judgement, recorded at the call site.
 */
test("decision 163 ruling 1 — the opportunity card names its customer once", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockRfqApi(page);
  await page.goto("/opportunities");
  await expect(
    page.getByRole("heading", { name: "RFQ / market" }),
  ).toBeVisible();

  const card = page.getByRole("button", { name: /Opportunity — Acme Trading/ });
  await expect(card).toBeVisible();
  // ONCE, not twice: the labelled meta row that repeated it is gone.
  expect(
    await anchoredCount(card.getByText("Acme Trading"), card),
  ).toBe(1);
});
