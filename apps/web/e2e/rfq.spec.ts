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
    /** pre-seed an already-ISSUED policy (a checker opening one they did not place) */
    seedIssuedPolicy?: boolean;
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
  let policy: Record<string, unknown> | null = opts.seedIssuedPolicy
    ? {
        id: "pol-1",
        opportunityId: "opp-1",
        customerId: "cust-1",
        insurerId: "ins-1",
        insurer: INSURER_IDENTITY,
        policyNumber: "POL-SEED-1",
        insuranceLine: "Property All Risks",
        status: "ISSUED",
        inceptionDate: "2026-10-01T00:00:00.000Z",
        expiryDate: null,
        requestedPremium: "120000.000",
        issuedPremium: "120000.000",
        premiumVariance: "0.000",
        currency: "JOD",
        placedByUserId: "someone-else",
        issuedByUserId: "someone-else",
        schedules: [
          {
            id: "sch-1",
            effectiveFrom: "2026-10-01T00:00:00.000Z",
            effectiveTo: null,
            limits: { buildings: "5000000.000" },
            sumsInsured: { total: "5000000.000" },
            namedPerils: ["fire", "flood"],
            extensions: [],
            sourceEndorsementId: null,
            createdAt: "2026-10-01T00:00:00.000Z",
          },
        ],
        documents: [],
        checking: null,
        delivery: null,
        issuanceComplete: true,
        checkingComplete: false,
        deliveryComplete: false,
        createdAt: "2026-09-15T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
      }
    : null;
  await page.route("http://localhost:4000/policies**", (route) => {
    const url = route.request().url();
    const method = route.request().method();
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
