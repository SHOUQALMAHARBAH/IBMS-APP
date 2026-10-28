import { test, type Page } from "@playwright/test";
import { permissionsForRoles } from "./fixtures/role-permissions";

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
 * Saved under `test-results/design-pass/<screen>/<theme>-<width>.png`, which the existing
 * `test-results/` gitignore entry already covers — the same treatment Playwright's own traces get.
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

async function capture(page: Page, screen: string, theme: Theme, width: Width) {
  await page.screenshot({
    path: `test-results/design-pass/${screen}/${theme}-${width}.png`,
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

  screenshots(
    "payment-channels",
    "/payment-channels",
    ["FINANCE_OFFICER"],
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
