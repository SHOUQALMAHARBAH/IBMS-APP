import { test, type Page } from "@playwright/test";
import { ROLE_PERMISSIONS, permissionsForRoles } from "./fixtures/role-permissions";

/*
 * THE DESIGN PASS'S OWN EVIDENCE — one capture per screen, per theme, per width, in ARABIC.
 *
 * The owner asked for this precisely, and her reason is the whole design: she will not re-walk a
 * system to discover nothing changed, and **the screenshots are how she reviews 113 screens
 * without opening 113 screens**. They are also how a design pass catches its own regressions,
 * because a design pass breaks things silently and a diff of two pictures does not.
 *
 * ARABIC, NOT ENGLISH. The product sets `dir="rtl"` for Arabic and that is its first language, so
 * a pass reviewed in English is a pass that has not been reviewed: icon direction, chevrons, table
 * alignment and anything that only looks right in LTR are invisible in an English capture. The
 * Latin-numeral columns are expected to stay LTR — that rule is already in `globals.css`.
 *
 * BOTH THEMES AND PHONE WIDTH, because neither is optional and both are in the reference pages.
 * `data-theme` is set before the first paint by the root layout's own inline script reading
 * `localStorage`, so the theme is seeded there rather than toggled after load — a toggle would
 * capture whatever the transition happened to be mid-way through.
 *
 * PLAIN PNG EVIDENCE, not `toHaveScreenshot()`. The same decision `four-state-screenshots.spec.ts`
 * made and for the same reason: this is proof of existence for a human reviewer, not a pixel-diff
 * test, and a pixel baseline on a bilingual RTL app fails noisily on cross-platform font rendering.
 *
 * Saved under `design-pass-captures/<screen>/<theme>-<width>.png` at the repo root — NOT under
 * `test-results/`, which Playwright CLEARS at the start of every run. Gitignored all the same:
 * these are evidence to look at, not an artefact to carry in the tree.
 * `docs/design-pass-register.md` links to the folder.
 */

const ME_BASE = {
  id: "user-1",
  email: "officer@ibms.test",
  fullName: "ھدى الشوابكة",
  languagePreference: "AR" as const,
  mfaEnabled: true,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
  organizationName: { en: "GO Global", ar: "جو جلوبال" },
};

type Theme = "light" | "dark";
type Width = "desktop" | "phone";

const SIZES: Record<Width, { width: number; height: number }> = {
  desktop: { width: 1360, height: 1000 },
  phone: { width: 390, height: 900 },
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

/** Seeds the theme BEFORE first paint, the way the root layout's own script reads it. */
async function seedTheme(page: Page, theme: Theme) {
  await page.addInitScript(
    (value) => window.localStorage.setItem("ibms.theme", value),
    theme,
  );
}

/** A capture may not be taller than this. A screen whose content runs past it is a finding in
 *  itself, and a 40,000px PNG is not a thing anybody reviews. */
const MAX_CAPTURE_HEIGHT = 12_000;

async function capture(page: Page, screen: string, theme: Theme, width: Width) {
  /*
   * THE VIEWPORT IS GROWN TO THE CONTENT COLUMN BEFORE THE SHOT, AND THAT IS NOT COSMETIC.
   *
   * `fullPage: true` captures the DOCUMENT'S scrollable extent. The shell is `100dvh` with
   * `overflow: hidden` now, so on a desktop the document is exactly one viewport and `fullPage`
   * silently became a viewport shot — every desktop capture in this set stopped showing anything
   * below the fold, with nothing failing and the files still being written. The phone keeps the
   * page scroller (the 64rem block in `globals.css`), so half the set was unaffected, which is
   * why a glance at a phone capture would have said everything was fine.
   *
   * Growing the viewport rather than taking an ELEMENT screenshot of `[data-app-content]`: the
   * rail and the top bar are a third of what is being reviewed, and an element shot drops them.
   */
  const needed = await page.evaluate(() => {
    const col = document.querySelector("[data-app-content]");
    if (!col) return 0; // the sign-in screen has no shell
    return col.scrollHeight - col.clientHeight;
  });
  if (needed > 0) {
    const size = page.viewportSize();
    if (size) {
      await page.setViewportSize({
        width: size.width,
        height: Math.min(size.height + needed, MAX_CAPTURE_HEIGHT),
      });
    }
  }

  await page.screenshot({
    // NOT `test-results/` — Playwright CLEARS that directory at the start of every run, so
    // captures written there survive only until the next `npx playwright test`. These are
    // the owner's review of 113 screens; a file a later command silently deletes cannot be
    // that, and an empty folder looks exactly like a run that was never taken.
    path: `../../design-pass-captures/${screen}/${theme}-${width}.png`,
    fullPage: true,
  });
}

/**
 * One screen, four captures. `prepare` installs that screen's own mocks and `settle` is the one
 * positive signal that proves the page rendered — never a bare timeout, because a capture taken
 * before hydration is a picture of a skeleton and is indistinguishable from a picture of a
 * screen that failed to mount.
 */
function screenshots(
  name: string,
  path: string,
  roles: string[],
  prepare: (page: Page) => Promise<void>,
  settle: (page: Page) => Promise<void>,
) {
  // A ROLE NAME THAT DOES NOT EXIST YIELDS NO PERMISSIONS, SILENTLY - and a capture has no
  // expected value, so the picture shows a reader holding nothing and looks like the product.
  // `FINANCE_OFFICER` was passed on TWO screens for a batch; the seeded name is
  // `FINANCE_COLLECTIONS_OFFICER`, and the nav in both captures was two links long. Refusing by
  // name is the only thing that could have caught it - the same property the api e2e helper
  // already asserts one layer down, where a mistyped CODE must grant nothing.
  for (const role of roles) {
    if (!ROLE_PERMISSIONS[role]) {
      throw new Error(
        `design-pass screenshots: "${role}" is not a seeded role, so this capture would show a ` +
          `reader holding NOTHING. Known: ${Object.keys(ROLE_PERMISSIONS).join(", ")}`,
      );
    }
  }

  for (const theme of ["light", "dark"] as Theme[]) {
    for (const width of ["desktop", "phone"] as Width[]) {
      test(`${name} — ${theme}, ${width}`, async ({ page }) => {
        await page.setViewportSize(SIZES[width]);
        await seedTheme(page, theme);
        await mockAuth(page, roles);
        await prepare(page);
        await page.goto(path);
        await settle(page);
        await capture(page, name, theme, width);
      });
    }
  }
}

/* ------------------------------------------------------------------ the sign-in screen */

test.describe("design pass — screenshots", () => {
  for (const theme of ["light", "dark"] as Theme[]) {
    for (const width of ["desktop", "phone"] as Width[]) {
      test(`login — ${theme}, ${width}`, async ({ page }) => {
        await page.setViewportSize(SIZES[width]);
        await seedTheme(page, theme);
        await page.goto("/login");
        // The mark's own arrival ends at 1.84s (the last delay plus its duration), so the capture
        // waits past it: a screenshot taken mid-draw shows half a logo and says nothing about
        // whether the final state is right. The ambient pulse keeps running, which is the point.
        await page.getByRole("button", { name: /دخول|Sign in/ }).waitFor();
        await page.waitForTimeout(2200);
        await capture(page, "login", theme, width);
      });
    }
  }

  /* ------------------------------------------------------------------ /dashboards/claims */

  /*
   * THE FIGURES SHAPE. Three tiles, the ageing as one distribution, and three breakdown tables in
   * one card — the figures are byte-for-byte the ones the api sends, which is §7's limit.
   */
  const CLAIMS_SUMMARY = {
    generatedAt: "2026-09-07T00:00:00.000Z",
    asOf: "2026-09-07T00:00:00.000Z",
    openClaimsCount: 14,
    closedClaimsCount: 52,
    outstandingClaimsValueJod: "37500.000",
    ageing: {
      d0_30: { count: 6, valueJod: "12000.000" },
      d31_60: { count: 4, valueJod: "9500.000" },
      d61_90: { count: 2, valueJod: "8000.000" },
      d90_plus: { count: 2, valueJod: "8000.000" },
    },
    lossRatioByClient: [
      { key: "cus-1", label: "شركة الأمل للتجارة", periodClaims: "20000.000", periodPremium: "40000.000", ratio: "0.5000", ratioCapped: false, claimCount: 2, policyCount: 1 },
      { key: "cus-2", label: "مؤسسة النور", periodClaims: "6000.000", periodPremium: "30000.000", ratio: "0.2000", ratioCapped: false, claimCount: 1, policyCount: 2 },
    ],
    lossRatioByLine: [
      { key: "motor", label: "مركبات", periodClaims: "20000.000", periodPremium: "40000.000", ratio: "0.5000", ratioCapped: false, claimCount: 2, policyCount: 1 },
    ],
    lossRatioByInsurer: [
      { key: "ins-1", label: "الشركة الوطنية للتأمين", periodClaims: "20000.000", periodPremium: "40000.000", ratio: "0.5000", ratioCapped: false, claimCount: 2, policyCount: 1 },
    ],
  };

  screenshots(
    "dashboards-claims",
    "/dashboards/claims",
    ["BRANCH_DEPARTMENT_MANAGER"],
    async (page) => {
      await page.route("http://localhost:4000/dashboards/claims**", (route) =>
        route.fulfill({ status: 200, json: CLAIMS_SUMMARY }),
      );
    },
    async (page) => {
      // THE RING'S CAPTION, which is what this capture is now for. The anchor was `52` — the
      // closed-claims TILE's value — and owner answer 4 moved open-and-closed into a `Ring`, so
      // that text no longer exists on the screen. The caption is the stronger anchor anyway: it
      // is the half of the component that cannot be rendered without the denominator, which is
      // the whole reason `caption` is a required prop.
      //
      // `66` is the denominator and appears nowhere else on this screen. The fixture's own
      // 14 open / 52 closed makes it 14 of 66 — the owner's example verbatim — so the capture is
      // a picture of her own sentence.
      //
      // WESTERN DIGITS, even in Arabic: `AR_LOCALE` is `'ar'` rather than `'ar-JO'` precisely so
      // every figure in the product reads in Western numerals, which `format.ts` records. Waiting
      // for the Arabic-Indic form here timed out once and confirmed that decision is live.
      await page
        .locator('[data-testid="claims-open-ring"]')
        .getByText("66", { exact: false })
        .first()
        .waitFor();
    },
  );

  /* ------------------------------------------------------------------ /client-accounting */

  /*
   * THE MONEY SHAPE, and the one screen whose COLUMN HEADERS changed language in this batch: four
   * of the five ageing buckets now read in Arabic, and `1–30 days` is still English because the
   * word for that range is owed. The capture is the evidence for both halves at once.
   */
  const AGEING = {
    asOf: "2026-09-03T00:00:00.000Z",
    currency: "JOD",
    rows: [
      {
        customerId: "acme",
        customerLegalName: "شركة الأمل للتجارة",
        currency: "JOD",
        current: "0.000",
        d1_30: "0.000",
        d31_60: "0.000",
        d61_90: "0.000",
        d90_plus: "115350.000",
        outstandingTotal: "115350.000",
        invoiceCount: 1,
        oldestDueDate: "2026-05-01T00:00:00.000Z",
        oldestDaysOverdue: 125,
      },
      {
        customerId: "noor",
        customerLegalName: "مؤسسة النور",
        currency: "JOD",
        current: "4000.000",
        d1_30: "2000.000",
        d31_60: "0.000",
        d61_90: "0.000",
        d90_plus: "0.000",
        outstandingTotal: "6000.000",
        invoiceCount: 2,
        oldestDueDate: "2026-08-20T00:00:00.000Z",
        oldestDaysOverdue: 14,
      },
    ],
    totals: {
      current: "4000.000",
      d1_30: "2000.000",
      d31_60: "0.000",
      d61_90: "0.000",
      d90_plus: "115350.000",
      outstandingTotal: "121350.000",
      invoiceCount: 3,
      customerCount: 2,
    },
  };

  screenshots(
    "client-accounting",
    "/client-accounting",
    ["FINANCE_COLLECTIONS_OFFICER"],
    async (page) => {
      await page.route("http://localhost:4000/client-accounting/ageing**", (route) =>
        route.fulfill({ status: 200, json: AGEING }),
      );
    },
    async (page) => {
      await page.getByText("مؤسسة النور").first().waitFor();
    },
  );

  /* ------------------------------------------------------------------ /customers/[id] */

  /*
   * THE RECORD SHAPE. Copied from `customers.spec.ts` rather than approximated — the two
   * screening discriminators, the masked contact fields and the DRAFT KYC record are all the
   * states this screen exists to show at once.
   */
  const CUSTOMER = {
    id: "cust-1",
    prospectId: null,
    customerType: "INDIVIDUAL",
    legalName: "أحمد الفلاني",
    givenName: "أحمد",
    fatherName: null,
    grandfatherName: null,
    familyName: "الفلاني",
    dateOfBirth: "1988-02-29",
    nationality: "JO",
    registrationNumber: null,
    taxRegistrationNumber: null,
    registeredAddress: null,
    natureOfBusiness: null,
    languagePreference: "AR",
    status: "PENDING_KYC",
    classification: "CONFIDENTIAL",
    ownerUserId: "user-1",
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
    nationalId: "******2345",
    contactPhone: "***-7890",
    contactEmail: "***@example.test",
  };

  const KYC_RECORD = {
    id: "kyc-1",
    customerId: "cust-1",
    status: "DRAFT",
    isEdd: false,
    submittedAt: null,
    createdByUserId: "user-1",
    approvedByUserId: null,
    combinedDutyAct: null,
    approvedAt: null,
    nextReviewDueAt: null,
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
  };

  screenshots(
    "customer-record",
    "/customers/cust-1",
    ["SALES_RELATIONSHIP_OFFICER"],
    async (page) => {
      await page.route("http://localhost:4000/customers/cust-1", (route) =>
        route.fulfill({ status: 200, json: CUSTOMER }),
      );
      await page.route("http://localhost:4000/customers/cust-1/ubos", (route) =>
        route.fulfill({ status: 200, json: [] }),
      );
      await page.route("http://localhost:4000/customers/cust-1/documents", (route) =>
        route.fulfill({ status: 200, json: [] }),
      );
      await page.route("http://localhost:4000/kyc/customers/cust-1**", (route) =>
        route.fulfill({ status: 200, json: KYC_RECORD }),
      );
      // Anything else this record page reads answers EMPTY rather than hanging: a capture of a
      // screen still waiting on a request is a capture of a skeleton.
      await page.route("http://localhost:4000/customers/cust-1/**", (route) =>
        route.fulfill({ status: 200, json: [] }),
      );
    },
    async (page) => {
      await page.getByText("أحمد الفلاني").first().waitFor();
    },
  );

  /* ------------------------------------------------------------------ /screening-health */

  /*
   * THE SMALL-FACTS SHAPE. Ten stacked panels of label/value rows, no tables and no tiles, where
   * the thing that matters most is whether any panel is saying something is wrong. The fixture is
   * `screening-health.spec.ts`'s own, with a threshold problem and an unresolved screening left in
   * so the capture shows both an ordinary panel and an alarmed one.
   */
  const SCREENING_HEALTH = {
    provider: "built_in",
    providerName: "Built-in watchlist cache (OFAC SDN + UN Consolidated)",
    status: "HEALTHY",
    detail: "Sanctions cache refreshed 2h ago.",
    datasetVersion: "local-2026-09-10T00:00:00.000Z",
    datasetUpdatedAt: "2026-09-10T00:00:00.000Z",
    checkedAt: "2026-09-10T12:00:00.000Z",
    thresholds: { high: 0.9, review: 0.7, low: 0.5 },
    missing: [],
    thresholdProblems: [],
    sendIdentifiers: false,
    state: "HEALTHY",
    authenticationValid: null,
    /*
     * ALL NINE, because the product renders all nine — every provider adapter reports the whole
     * `ProviderCapability` union. The two-row version of this fixture is what the owner walked,
     * and it is why her note reads "a THIRD capability": a capture with fewer rows than the screen
     * has is a believable picture of a product that does not exist. `operational` and `note` are
     * carried too; without them the table showed a dash and an empty cell in every row.
     */
    capabilities: [
      { capability: "SANCTIONS", supported: true, configured: true, operational: true, note: "OFAC SDN + UN consolidated, synced." },
      { capability: "PEP", supported: false, configured: false, operational: false, note: "No PEP source is configured." },
      { capability: "WATCHLIST", supported: true, configured: true, operational: true, note: "Local watchlist." },
      { capability: "ADVERSE_MEDIA", supported: false, configured: false, operational: false, note: "Not available." },
      { capability: "INDIVIDUAL", supported: true, configured: true, operational: true, note: "Names are matched." },
      { capability: "ENTITY", supported: true, configured: true, operational: true, note: "Legal names are matched." },
      { capability: "BATCH", supported: true, configured: true, operational: true, note: "Recurring sweep." },
      { capability: "ONGOING_MONITORING", supported: true, configured: true, operational: true, note: "Four-hourly re-screen." },
      { capability: "WEBHOOKS", supported: false, configured: false, operational: false, note: "No callback endpoint." },
    ],
  };

  const SCREENING_OVERVIEW = {
    windowDays: 30,
    since: "2026-08-11T00:00:00.000Z",
    attempts: {
      total: 412,
      /*
       * THE REAL MEMBERS. This read `{ CLEAR: 388, POTENTIAL_MATCH: 21, ERROR: 3 }` — and `CLEAR`
       * and `ERROR` are not members of `ScreeningAttemptOutcome` at all. The owner read those
       * three token names off the picture this fixture produced and wrote Arabic for two tokens
       * that cannot occur. A screenshot has no expected value, which is exactly what makes a wrong
       * one so quiet.
       */
      byOutcome: {
        NO_MATCH: 388,
        POTENTIAL_MATCH: 21,
        SCREENING_FAILED: 2,
        UNABLE_TO_SCREEN: 1,
      },
      byProvider: { built_in: 412 },
      unresolved: 3,
      unresolvedRate: 0.0073,
      recentUnresolved: [],
    },
    matchQueue: {
      pending: 4,
      pendingByAlgorithmVersion: { "2.0.0": 4 },
      currentAlgorithmVersion: "2.0.0",
    },
    caseWorkload: {},
    datasets: [],
    schedules: {
      rescreenBatch: { cron: "0 */4 * * *", nextRunAt: "2026-09-11T00:00:00.000Z" },
      listSync: {
        cron: "0 */12 * * *",
        nextRunAt: "2026-09-11T00:00:00.000Z",
        lastSuccessAt: "2026-09-10T00:00:00.000Z",
      },
    },
    holds: {
      activeHolds: 2,
      decidableFiles: 1,
      releasedInWindow: 5,
      policy: {},
      staleAfterDays: 7,
      configurationProblems: [],
    },
    listSync: [],
  };

  screenshots(
    "screening-health",
    "/screening-health",
    ["COMPLIANCE_OFFICER"],
    async (page) => {
      await page.route("**/screening/providers/health", (route) =>
        route.fulfill({ status: 200, json: SCREENING_HEALTH }),
      );
      await page.route("**/screening/overview*", (route) =>
        route.fulfill({ status: 200, json: SCREENING_OVERVIEW }),
      );
    },
    async (page) => {
      await page.getByTestId("ops-attempts").waitFor();
    },
  );

  /* ------------------------------------------------------------------ /incidents */

  const INCIDENTS = [
    {
      id: "incident-1",
      title: "وصول غير مصرَّح به إلى صندوق بريد المكتب",
      description: "تم الوصول إلى صندوق البريد من عنوان غير معروف.",
      severity: "critical",
      status: "CONTAINED",
      classification: "NOT_YET_CLASSIFIED",
      isContainmentOverdue: true,
      reportedAt: "2026-10-28T09:14:00.000Z",
      impactAssessedAt: null,
      touchesPersonalData: null,
      dataCategoriesAffected: null,
      subjectsAffectedEstimate: null,
      seniorManagementCoSignUserId: null,
      seniorManagementNotifiedAt: null,
      affectedDataSubjectsNotifiedAt: null,
      classifiedByDpoUserId: null,
      classificationCombinedDutyAct: null,
      containmentActions: [
        {
          id: "act-1",
          description: "عزل خادم البريد عن الشبكة.",
          actionTakenByName: "عمر الرفاعي",
          takenAt: "2026-10-28T09:31:00.000Z",
        },
        {
          id: "act-2",
          description: "تعطيل الحساب المخترَق وإلغاء جلساته المفتوحة.",
          actionTakenByName: "عمر الرفاعي",
          takenAt: "2026-10-28T09:48:00.000Z",
        },
      ],
    },
    {
      id: "incident-2",
      title: "فقدان حاسوب محمول يحتوي ملفات عملاء",
      description: "فُقد الجهاز خارج المكتب.",
      severity: "high",
      status: "IMPACT_ASSESSED",
      classification: "MATERIAL",
      isContainmentOverdue: false,
      reportedAt: "2026-10-26T14:02:00.000Z",
      impactAssessedAt: "2026-10-26T16:40:00.000Z",
      touchesPersonalData: true,
      dataCategoriesAffected: "أسماء · عناوين بريد · أرقام وثائق تأمين",
      subjectsAffectedEstimate: 41,
      seniorManagementCoSignUserId: null,
      seniorManagementNotifiedAt: null,
      affectedDataSubjectsNotifiedAt: null,
      classifiedByDpoUserId: "user-1",
      classificationCombinedDutyAct: null,
      containmentActions: [],
    },
    {
      id: "incident-3",
      title: "رسالة تصيّد وصلت لثلاثة موظفين",
      description: "رسالة تحمل رابطاً خارجياً.",
      severity: "medium",
      status: "CLOSED",
      classification: "NON_MATERIAL",
      isContainmentOverdue: false,
      reportedAt: "2026-10-19T11:27:00.000Z",
      impactAssessedAt: "2026-10-19T12:05:00.000Z",
      touchesPersonalData: false,
      dataCategoriesAffected: "لا شيء",
      subjectsAffectedEstimate: 0,
      seniorManagementCoSignUserId: "user-2",
      seniorManagementNotifiedAt: "2026-10-19T13:00:00.000Z",
      affectedDataSubjectsNotifiedAt: null,
      classifiedByDpoUserId: "user-1",
      classificationCombinedDutyAct: null,
      containmentActions: [],
    },
  ];

  screenshots(
    "incidents",
    "/incidents",
    ["DATA_PROTECTION_OFFICER"],
    async (page) => {
      /*
       * THE API ORIGIN IS NAMED, never `**\/incidents`. A bare glob also matches the PAGE path
       * `/incidents`, so Playwright intercepts the NAVIGATION and serves the mocked JSON as the
       * document — a screen of raw JSON with no heading and no error, which is indistinguishable
       * from a page that failed to mount. This repository has paid for that once already; the
       * sibling specs name the origin for the same reason.
       */
      await page.route("http://localhost:4000/incidents**", (route) =>
        route.fulfill({ status: 200, json: INCIDENTS }),
      );
    },
    async (page) => {
      await page
        .getByRole("cell", { name: "وصول غير مصرَّح به إلى صندوق بريد المكتب" })
        .waitFor();
    },
  );

  /* ------------------------------------------------------------------ /payment-channels */

  const CHANNELS = [
    {
      id: "pc-1",
      ownerType: "customer",
      ownerName: "شركة اليرموك للتأمين",
      channelType: "bank_transfer",
      label: "الحساب الرئيسي",
      bankName: "البنك العربي",
      accountLast4: "4321",
      isActive: true,
    },
    {
      id: "pc-2",
      ownerType: "insurer",
      ownerName: "شركة الأردن للتأمين",
      channelType: "cheque",
      label: "شيكات التحويل",
      bankName: null,
      accountLast4: null,
      isActive: true,
    },
    {
      id: "pc-3",
      ownerType: "customer",
      ownerName: null,
      channelType: "cash",
      label: "صندوق المكتب",
      bankName: null,
      accountLast4: null,
      isActive: false,
    },
  ];

  /* ------------------------------------------------------------------ /internal-controls */

  const AUDIT = {
    generatedAt: "2026-10-28T22:15:00.000Z",
    pairsScanned: 16,
    totalRowsChecked: 4182,
    violations: [],
    byPair: [
      {
        entityType: "KYCRecord",
        pairLabel: "capturedBy / approvedBy",
        rowsChecked: 912,
        violationCount: 0,
        dbCheckConstraint: "KYCRecord_maker_checker_distinct",
        dormant: false,
        truncated: false,
      },
      {
        entityType: "Refund",
        pairLabel: "raisedBy / approvedBy",
        rowsChecked: 38,
        violationCount: 0,
        dbCheckConstraint: "Refund_maker_checker_distinct",
        dormant: false,
        truncated: false,
      },
      {
        entityType: "DisposalBatch",
        pairLabel: "nominatedBy / dpoApprovedBy",
        rowsChecked: 0,
        violationCount: 0,
        dbCheckConstraint: "DisposalBatch_maker_checker_distinct",
        dormant: true,
        truncated: false,
      },
    ],
  };

  /*
   * THE SHAPE IS COPIED FROM `CombinedDutyReport`, NOT PARAPHRASED — and the first version was
   * paraphrased and silently rendered nothing, because it was missing `entityId`, `actorUserId`,
   * `accessSelfReviewCount` and `totalCount`. `/internal-controls/combined-duty-acts` is mocked by
   * NO other Playwright spec, so there was no working fixture to copy and no assertion covering
   * the declared-acts half at all. That is its own small finding: the section the whole COMBINED
   * mode rests on has never been exercised in a browser.
   */
  const DECLARED = {
    office: {
      mode: "COMBINED",
      declaredAt: "2026-09-02T08:00:00.000Z",
      declaredByUserId: "user-1",
      declaredByName: "هدى الشوابكة",
    },
    accessSelfReviewCount: 1,
    totalCount: 2,
    truncated: false,
    rows: [
      {
        id: "act-1",
        actorUserId: "user-1",
        entityId: "ari-9",
        at: "2026-10-21T10:12:00.000Z",
        actorName: "هدى الشوابكة",
        entity: "مراجعة صلاحيات الوصول",
        pair: "AccessRecertificationItem_maker_checker_distinct",
        roles: ["مسؤولة حماية البيانات"],
        reason: "المكتب شخص واحد، ولا يوجد زميل آخر يراجع صلاحياتي.",
        hatAmbiguous: false,
        accessSelfReview: true,
      },
      {
        id: "act-2",
        actorUserId: "user-2",
        entityId: "ref-4",
        at: "2026-10-18T14:40:00.000Z",
        actorName: "عمر الرفاعي",
        entity: "استرداد",
        pair: "Refund_maker_checker_distinct",
        roles: ["موظف المالية", "مدير الفرع"],
        reason: "اعتمدتُ الاسترداد الذي رفعتُه بنفسي بعد مغادرة المدير.",
        hatAmbiguous: true,
        accessSelfReview: false,
      },
    ],
  };

  screenshots(
    "internal-controls",
    "/internal-controls",
    ["COMPLIANCE_OFFICER"],
    async (page) => {
      await page.route("http://localhost:4000/internal-controls/self-approval-audit**", (route) =>
        route.fulfill({ status: 200, json: AUDIT }),
      );
      await page.route("http://localhost:4000/internal-controls/combined-duty-acts**", (route) =>
        route.fulfill({ status: 200, json: DECLARED }),
      );
    },
    async (page) => {
      await page.getByTestId("declared-row-access").waitFor();
    },
  );

  screenshots(
    "payment-channels",
    "/payment-channels",
    ["FINANCE_COLLECTIONS_OFFICER"],
    async (page) => {
      await page.route("http://localhost:4000/payment-channels**", (route) =>
        route.fulfill({ status: 200, json: CHANNELS }),
      );
    },
    async (page) => {
      await page.getByRole("cell", { name: "الحساب الرئيسي" }).waitFor();
    },
  );
});
