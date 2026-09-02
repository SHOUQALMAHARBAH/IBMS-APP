import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

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

async function mockAuth(page: Page, roles: string[]) {
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fake-access-token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({ status: 200, json: { ...ME_BASE, roles } }),
  );
}

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
  context: { insuranceProgramId: "prog-1", customerId: "cust-1" },
};

const INSURERS = [
  { id: "ins-1", name: "Jordan Insurance Co", nameAr: null, financialStrengthRating: "A-" },
  { id: "ins-2", name: "Middle East Assurance", nameAr: null, financialStrengthRating: null },
];

const RFQ = {
  id: "rfq-1",
  opportunityId: "opp-1",
  insuranceLine: "Property All Risks",
  issuedAt: "2026-03-02T00:00:00.000Z",
  followUpThresholdDays: 9,
  issuedByUserId: "user-1",
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

const INSURER_IDENTITY = {
  id: "ins-1",
  name: "Jordan Insurance Co",
  nameAr: null,
  financialStrengthRating: "A-",
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
    rfq: { id: "rfq-1", opportunityId: "opp-1", insuranceLine: "Property All Risks" },
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
    onCreateRfq?: () => void;
    onTransition?: (status: string) => void;
    onLogComm?: (body: { direction: string; body: string }) => void;
    onCaptureQuote?: (body: { insurerId: string; premium: string }) => void;
    onReviseQuote?: (body: { premium: string; negotiationNotes?: string }) => void;
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
    onPlacePolicy?: (body: { opportunityId: string; inceptionDate: string }) => void;
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
    /** pre-seed an already-ISSUED policy (a checker opening one they did not place) */
    seedIssuedPolicy?: boolean;
    /** pre-seed an ACTIVE policy (delivered + acknowledged) — Process 22 needs one */
    seedActivePolicy?: boolean;
    opportunityStatus?: string;
  } = {},
) {
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
      const v1 = quoteVersion({ isCurrentVersion: false });
      const v2 = quoteVersion({
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
          insurer: INSURER_IDENTITY,
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
      const v1 = quoteVersion({ premium: b.premium });
      chains = [
        {
          rfqId: "rfq-1",
          insurerId: "ins-1",
          insuranceLine: "Property All Risks",
          insurer: INSURER_IDENTITY,
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
        quotation: quoteVersion({ premium: "125000.500" }),
      },
    ],
    missingInsurers: [
      { id: "ins-2", name: "Middle East Assurance", status: "NO_RESPONSE" },
    ],
    declinedInsurers: [] as { id: string; name: string }[],
  });

  await page.route(
    "http://localhost:4000/comparison-matrices**",
    (route) => {
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
          json: { message: "No comparison matrix has been built for this RFQ yet." },
        });
      }
      return route.fulfill({ status: 200, json: matrix });
    },
  );

  // Opportunity — the detail GET reflects the current threshold; a PATCH
  // (Part C #16) updates it in place.
  const opp = { ...OPPORTUNITY, status: opts.opportunityStatus ?? OPPORTUNITY.status };
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
    return route.fulfill({ status: 200, json: [opp] });
  });

  // Broker recommendation (Part C #16) — starts empty; a POST drafts it, and
  // approve / disclose / send each mutate the single row in place.
  let recommendation: Record<string, unknown> | null = null;
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
    if (
      method === "POST" &&
      /\/conflict-of-interest-disclosure/.test(url)
    ) {
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
      const q = quoteVersion({ premium: "125000.500" });
      recommendation = {
        id: "rec-1",
        opportunityId: "opp-1",
        customerId: "cust-1",
        recommendedQuotation: {
          id: q.id,
          insurerId: q.insurerId,
          insurer: INSURER_IDENTITY,
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
          insurer: INSURER_IDENTITY,
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
                checkedAt: "2026-10-05T00:00:00.000Z",
                discrepancyFound: false,
                discrepancyDetail: null,
                discrepancyLoggedAsPiRiskEvent: false,
                complianceOverrideByUserId: null,
                checklist: {},
                createdAt: "2026-10-05T00:00:00.000Z",
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
    if (method === "POST" && /\/policies\/[^/]+\/cancellation(\?|$)/.test(url)) {
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
        documents: { category: string; classification: string; fileName: string }[];
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
        JSON.stringify(b.requestedCoverage.limits) !== JSON.stringify(issuedLimits);
      policy = {
        ...(policy ?? {}),
        status: mismatch ? "DISCREPANCY" : "VERIFIED",
        checkingComplete: true,
        checking: {
          placedByUserId: "user-1",
          checkedByUserId: "chk-1",
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
        documents: { category: string; classification: string; fileName: string }[];
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
        insurer: INSURER_IDENTITY,
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
    return route.fulfill({ status: 200, json: policy ? [policy] : [] });
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
    const AWAITING = ["REGISTERED", "DOCUMENTATION_IN_PROGRESS", "UNDER_ASSESSMENT"];
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
          if (typeof b.surveyCompletedAt === "string" && !adj.surveyCompletedAt) {
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
    return route.fulfill({ status: 200, json: claimRows });
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
    return route.fulfill({ status: 200, json: [RFQ] });
  });

  await page.route("http://localhost:4000/rfq-insurers/**", (route) => {
    const body = route.request().postDataJSON() as { toStatus: string };
    opts.onTransition?.(body.toStatus);
    return route.fulfill({
      status: 201,
      json: { ...RFQ.insurerSubmissions[0], status: body.toStatus, respondedAt: "2026-03-05T00:00:00.000Z" },
    });
  });
}

/** Part C #26/#28 — drive a freshly-notified claim all the way to an insurer
 * verdict through the UI (notify -> register -> file every mandatory doc ->
 * stamp the adjuster survey + investigation -> submit -> record the verdict).
 * The Process 28 settlement controls only appear once the claim is APPROVED /
 * PARTIALLY_APPROVED. */
async function driveClaimToVerdict(
  page: Page,
  opts: {
    estimatedLoss: string;
    verdict: "APPROVED" | "PARTIALLY_APPROVED";
    insurerRef: string;
  },
) {
  await page.getByLabel("Loss date").fill("2026-11-15");
  await page.getByLabel("Cause of loss").fill("Storm ripped the roof sheeting.");
  await page.getByLabel("Estimated loss").fill(opts.estimatedLoss);
  await page.getByRole("button", { name: "Notify claim" }).click();
  await expect(page.getByText("NOTIFIED", { exact: true })).toBeVisible();

  await page.getByLabel("Insurer claim reference").fill(opts.insurerRef);
  await page.getByLabel("Loss adjuster").fill("Cunningham Lindsey");
  await page
    .getByRole("button", { name: "Register & assign adjuster" })
    .click();
  await expect(page.getByText("REGISTERED", { exact: true })).toBeVisible();

  for (const [docType, fileName] of [
    ["claim_form", "cf.pdf"],
    ["photo", "ph.jpg"],
    ["repair_estimate", "re.pdf"],
  ] as const) {
    await page.getByLabel("Document type").selectOption(docType);
    await page.getByLabel("File name").fill(fileName);
    await page.getByLabel("Storage reference").fill(`s3://claims/${docType}`);
    await page.getByRole("button", { name: "File document" }).click();
  }
  await expect(page.getByText("Documentation · complete")).toBeVisible();

  await page
    .getByLabel("Completion date (adjuster survey / investigation)")
    .fill("2026-11-16");
  await page.getByRole("button", { name: "Mark survey complete" }).click();
  await page
    .getByRole("button", { name: "Mark investigation complete" })
    .click();

  await page.getByRole("button", { name: "Submit for assessment" }).click();
  await expect(
    page.getByText("UNDER_ASSESSMENT", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Assessment verdict").selectOption(opts.verdict);
  await page.getByRole("button", { name: "Record verdict" }).click();
  await expect(page.getByText(`verdict ${opts.verdict}`)).toBeVisible();
}

test("opens an opportunity and lists its RFQs", async ({ page }) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockRfqApi(page);

  await page.goto("/opportunities?customerId=cust-1");
  await expect(page.getByRole("heading", { name: "RFQ / market" })).toBeVisible();
  await page.getByRole("button", { name: /Opportunity opp-1/ }).click();

  await expect(page).toHaveURL("/opportunities/opp-1");
  await expect(page.getByText("Status: NEEDS_CONFIRMED")).toBeVisible();
  await expect(page.getByRole("button", { name: /Property All Risks/ })).toBeVisible();
});

test("creates an RFQ with an insurer shortlist", async ({ page }) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  let created = false;
  await mockRfqApi(page, { onCreateRfq: () => { created = true; } });

  await page.goto("/rfqs/new?opportunityId=opp-1");
  await expect(page.getByRole("heading", { name: "New RFQ" })).toBeVisible();
  await page.getByLabel("Insurance line").fill("Property All Risks");
  await page.getByLabel("Jordan Insurance Co · A-").check();
  await page.getByRole("button", { name: "Create RFQ" }).click();

  await expect.poll(() => created).toBe(true);
  await expect(page).toHaveURL("/rfqs/rfq-1");
  await expect(page.getByRole("heading", { name: "RFQ — Property All Risks" })).toBeVisible();
});

test("records an insurer response status from the RFQ detail screen", async ({ page }) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  let transitionedTo: string | null = null;
  await mockRfqApi(page, { onTransition: (s) => { transitionedTo = s; } });

  await page.goto("/rfqs/rfq-1");
  await expect(page.getByRole("cell", { name: "Jordan Insurance Co" })).toBeVisible();
  await page
    .getByLabel("Set status for Jordan Insurance Co")
    .selectOption("QUOTED");

  await expect.poll(() => transitionedTo).toBe("QUOTED");
});

test("logs a broker<->insurer exchange on the RFQ detail screen", async ({ page }) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  let logged: { direction: string; body: string } | null = null;
  await mockRfqApi(page, { onLogComm: (b) => { logged = b; } });

  await page.goto("/rfqs/rfq-1");
  await expect(page.getByRole("heading", { name: "Correspondence" })).toBeVisible();
  await page.getByLabel("Direction").selectOption("INBOUND");
  await page.getByLabel("Exchange").fill("Please send 3 years of loss history for site 2.");
  await page.getByRole("button", { name: "Log exchange" }).click();

  await expect.poll(() => logged?.direction).toBe("INBOUND");
  await expect(
    page.getByText("Please send 3 years of loss history for site 2."),
  ).toBeVisible();
});

test("a non-Placement user sees the list but no create controls", async ({ page }) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await mockRfqApi(page);

  await page.goto("/opportunities/opp-1");
  await expect(page.getByText("Status: NEEDS_CONFIRMED")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create RFQ for a line" })).toHaveCount(0);
});

test("captures a quotation for a shortlisted insurer on the RFQ detail screen", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  let captured: { insurerId: string; premium: string } | null = null;
  await mockRfqApi(page, { onCaptureQuote: (b) => { captured = b; } });

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

test("revises a captured quotation into a new version", async ({ page }) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  let captured = false;
  let revised: { premium: string; negotiationNotes?: string } | null = null;
  await mockRfqApi(page, {
    onCaptureQuote: () => { captured = true; },
    onReviseQuote: (b) => { revised = b; },
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
  await mockRfqApi(page, { onBuildComparison: (b) => { built = b; } });

  await page.goto("/rfqs/rfq-1");
  await expect(
    page.getByRole("heading", { name: "Comparison" }),
  ).toBeVisible();
  await expect(page.getByText("No comparison built yet.")).toBeVisible();

  await page.getByRole("button", { name: "Build comparison" }).click();

  await expect.poll(() => built?.rfqId).toBe("rfq-1");
  await expect(
    page.getByRole("button", { name: "Rebuild comparison" }),
  ).toBeVisible();
  await expect(
    page.getByText("Middle East Assurance (NO_RESPONSE)"),
  ).toBeVisible();
});

test("a non-Placement user sees the comparison but no build control", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockRfqApi(page);

  await page.goto("/rfqs/rfq-1");
  await expect(
    page.getByRole("heading", { name: "Comparison" }),
  ).toBeVisible();
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
    await page.getByLabel(label, { exact: true }).fill(`${label} reasoning here.`);
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

  await page.goto("/opportunities/opp-1");
  await expect(page.getByRole("heading", { name: "Policy" })).toBeVisible();

  await page.getByLabel("Inception date").fill("2026-10-01");
  await page.getByRole("button", { name: "Place policy" }).click();

  await expect.poll(() => placed?.inceptionDate).toBe("2026-10-01");
  await expect(page.getByText("PLACEMENT_CONFIRMED")).toBeVisible();

  await page.getByLabel("Policy number").fill("POL-WEB-1");
  await page.getByLabel("Issued premium").fill("118500.000");
  await page.getByRole("button", { name: "Record issuance" }).click();

  await expect.poll(() => issued?.policyNumber).toBe("POL-WEB-1");
  await expect.poll(() => issued?.issuedPremium).toBe("118500.000");
  await expect(page.getByText("ISSUED", { exact: true })).toBeVisible();
  await expect(page.getByText("POL-WEB-1")).toBeVisible();
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
    .poll(() => (checked?.requestedCoverage.limits as { buildings?: string })?.buildings)
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

  await expect(page.getByRole("button", { name: "Record delivery" })).toBeVisible();
  await page.getByLabel("Method").selectOption("courier");
  await page.getByLabel("Recipient").fill("Acme Risk Dept");
  await page.getByRole("button", { name: "Record delivery" }).click();

  await expect.poll(() => delivered?.recipient).toBe("Acme Risk Dept");
  await expect(page.getByText("awaiting client acknowledgement")).toBeVisible();

  await page.getByRole("button", { name: "Acknowledge receipt" }).click();
  await expect(page.getByText("ACTIVE", { exact: true })).toBeVisible();
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
  await page.getByLabel("Change", { exact: true }).selectOption("sum_insured_increase");
  await page.getByLabel("Premium amount (unsigned)").fill("2500.000");
  await page.getByLabel("Effective from").fill("2026-12-01");
  await page
    .getByRole("button", { name: "Request endorsement" })
    .click();

  await expect.poll(() => requested?.premiumAmount).toBe("2500.000");
  await expect(page.getByText("REQUESTED", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Premium adjustment JOD 2,500.000"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Advance to insurer" }),
  ).toBeVisible();
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
  await expect(page.getByText("NOTIFIED", { exact: true })).toBeVisible();
  await expect(page.getByText("large claim", { exact: false })).toBeVisible();
  await expect(
    page.getByText("coverage version in force", { exact: false }),
  ).toBeVisible();
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
  await page.getByLabel("Cause of loss").fill("Burst riser main flooded unit 4.");
  await page.getByLabel("Estimated loss").fill("14000.000");
  await page.getByRole("button", { name: "Notify claim" }).click();
  await expect(page.getByText("NOTIFIED", { exact: true })).toBeVisible();

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
  await expect(page.getByText("REGISTERED", { exact: true })).toBeVisible();
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
  await page.getByLabel("Cause of loss").fill("Storm ripped the roof sheeting.");
  await page.getByLabel("Estimated loss").fill("14000.000");
  await page.getByRole("button", { name: "Notify claim" }).click();
  await expect(page.getByText("NOTIFIED", { exact: true })).toBeVisible();

  await page.getByLabel("Insurer claim reference").fill("INS-DOC-1");
  await page.getByLabel("Loss adjuster").fill("Cunningham Lindsey");
  await page
    .getByRole("button", { name: "Register & assign adjuster" })
    .click();
  await expect(page.getByText("REGISTERED", { exact: true })).toBeVisible();

  // the documentation checklist shows the missing mandatory docs
  await expect(page.getByText("missing claim_form, photo, repair_estimate")).toBeVisible();

  await page.getByLabel("Document type").selectOption("claim_form");
  await page.getByLabel("File name").fill("claim-form.pdf");
  await page.getByLabel("Storage reference").fill("s3://claims/cf");
  await page.getByRole("button", { name: "File document" }).click();

  await expect.poll(() => attached?.documents[0].docType).toBe("claim_form");
  await expect(page.getByText("DOCUMENTATION_IN_PROGRESS", { exact: true })).toBeVisible();
  await expect(page.getByText("missing photo, repair_estimate")).toBeVisible();
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
  await page.getByLabel("Cause of loss").fill("Storm ripped the roof sheeting.");
  await page.getByLabel("Estimated loss").fill("14000.000");
  await page.getByRole("button", { name: "Notify claim" }).click();
  await page.getByLabel("Insurer claim reference").fill("INS-ASMT-1");
  await page.getByLabel("Loss adjuster").fill("Cunningham Lindsey");
  await page
    .getByRole("button", { name: "Register & assign adjuster" })
    .click();
  await expect(page.getByText("REGISTERED", { exact: true })).toBeVisible();

  // file every mandatory document
  for (const [docType, fileName] of [
    ["claim_form", "cf.pdf"],
    ["photo", "ph.jpg"],
    ["repair_estimate", "re.pdf"],
  ] as const) {
    await page.getByLabel("Document type").selectOption(docType);
    await page.getByLabel("File name").fill(fileName);
    await page.getByLabel("Storage reference").fill(`s3://claims/${docType}`);
    await page.getByRole("button", { name: "File document" }).click();
  }
  await expect(page.getByText("Documentation · complete")).toBeVisible();

  // record the adjuster's survey + investigation
  await page
    .getByLabel("Completion date (adjuster survey / investigation)")
    .fill("2026-11-16");
  await page.getByRole("button", { name: "Mark survey complete" }).click();
  await page
    .getByRole("button", { name: "Mark investigation complete" })
    .click();
  await expect.poll(() => steps.filter((s) => s === "adjuster-progress").length).toBe(2);

  // submit for assessment, then record the verdict
  await page.getByRole("button", { name: "Submit for assessment" }).click();
  await expect(page.getByText("UNDER_ASSESSMENT", { exact: true })).toBeVisible();
  await page
    .getByLabel("Assessment verdict")
    .selectOption("PARTIALLY_APPROVED");
  await page.getByRole("button", { name: "Record verdict" }).click();

  // the verdict shows and the decision control is gone
  await expect(page.getByText("verdict PARTIALLY_APPROVED")).toBeVisible();
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
  await expect(page.getByText("REGISTERED", { exact: true })).toBeVisible();

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

  await page
    .getByRole("button", { name: "Second-approve settlement" })
    .click();

  // the second approval settles it
  await expect(
    page.getByText(/· second-approved · settled/),
  ).toBeVisible();
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

test("RFQ screens have no serious/critical accessibility violations @a11y", async ({ page }) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockRfqApi(page);

  await page.goto("/opportunities/opp-1");
  await expect(page.getByRole("heading", { name: /Opportunity opp-1/ })).toBeVisible();
  const oppResults = await new AxeBuilder({ page }).analyze();
  expect(
    oppResults.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);

  await page.goto("/rfqs/rfq-1");
  await expect(page.getByText("Insurer submissions")).toBeVisible();
  const rfqResults = await new AxeBuilder({ page }).analyze();
  expect(
    rfqResults.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
});
