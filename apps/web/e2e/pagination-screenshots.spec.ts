import { expect, test, type Page } from "@playwright/test";
import { permissionsForRoles } from "./fixtures/role-permissions";

/*
 * Evidence captures for the page control on the three lists that grew a
 * pagination bar: /customers, /policies, /audit-trail.
 *
 * Four combinations per screen — light/dark x EN/AR — because the control is
 * the first shared component this app has added since the theme toggle, and
 * its two borders and its disabled state are exactly the things that read
 * differently on a dark ground. The AR captures also prove the range label
 * mirrors: "Showing 1-50 of 312" is a directional sentence, and its numerals
 * stay Western (lib/i18n/format.ts pins 'ar', never 'ar-JO').
 *
 * Screenshots land in test-results/, already gitignored — the same treatment
 * four-state-screenshots.spec.ts gets. Proof of existence, not a pixel diff.
 */

const ROLES = ["BRANCH_DEPARTMENT_MANAGER"];

const me = (languagePreference: "AR" | "EN") => ({
  id: "user-mgr",
  email: "manager@ibms.test",
  fullName: "Branch Manager",
  languagePreference,
  roles: ROLES,
  permissions: permissionsForRoles(ROLES),
  mfaEnabled: true,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  department: { name: "Claims", nameAr: "المطالبات" },
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
});

const CUSTOMER = (n: number) => ({
  id: `cust-${n}`,
  prospectId: null,
  customerType: "CORPORATE",
  legalName: `شركة الأفق للتجارة ${n}`,
  givenName: null,
  fatherName: null,
  grandfatherName: null,
  familyName: null,
  registrationNumber: `REG-${1000 + n}`,
  taxRegistrationNumber: null,
  registeredAddress: "Amman, Jordan",
  natureOfBusiness: "Trading",
  languagePreference: "AR",
  status: "ACTIVE",
  ownerUserId: "user-mgr",
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
});

const POLICY = (n: number) => ({
  id: `pol-${n}`,
  opportunityId: "opp-1",
  customerId: "cust-1",
  insurerId: "ins-1",
  insurer: {
    id: "ins-1",
    financialStrengthRating: "A",
    insurerMaster: { legalName: "Jordan Insurance", legalNameAr: "التأمين الأردنية" },
  },
  customer: { id: "cust-1", legalName: "شركة الأفق للتجارة" },
  policyNumber: `POL-2026-0034${n}`,
  insuranceLine: "Property All Risks",
  status: "ISSUED",
  inceptionDate: "2026-10-01T00:00:00.000Z",
  expiryDate: "2027-09-30T00:00:00.000Z",
  requestedPremium: "120000.000",
  issuedPremium: "118500.000",
  currency: "JOD",
  placedByUserId: "user-mgr",
  issuedByUserId: "user-mgr",
  schedules: [],
  documents: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
});

const AUDIT_ROW = (n: number) => ({
  id: `log-${n}`,
  userId: "user-mgr",
  action: "TRANSITION",
  entityType: "Lead",
  entityId: `lead-${n}`,
  beforeValue: { status: "NEW" },
  afterValue: { status: "QUALIFIED" },
  isSensitiveDataAccess: false,
  occurredAt: "2026-09-01T09:00:00.000Z",
});

/** A page that is genuinely one of several, so the control actually renders. */
function page1Of<T>(items: T[], total: number) {
  return { items, total, page: 0, pageSize: items.length };
}

async function shoot(page: Page, screen: string, theme: "light" | "dark", lang: "EN" | "AR") {
  await page.screenshot({
    path: `test-results/pagination/${screen}-${theme}-${lang}.png`,
    fullPage: true,
  });
}

async function openAt(
  page: Page,
  path: string,
  theme: "light" | "dark",
  lang: "EN" | "AR",
) {
  await page.addInitScript((t) => {
    window.localStorage.setItem("ibms.theme", t as string);
  }, theme);
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({ status: 200, json: me(lang) }),
  );
  await page.goto(path);
}

const MATRIX: Array<{ theme: "light" | "dark"; lang: "EN" | "AR" }> = [
  { theme: "light", lang: "EN" },
  { theme: "light", lang: "AR" },
  { theme: "dark", lang: "EN" },
  { theme: "dark", lang: "AR" },
];

for (const { theme, lang } of MATRIX) {
  test(`customers page control — ${theme} / ${lang}`, async ({ page }) => {
    await page.route("http://localhost:4000/customers**", (route) =>
      route.fulfill({
        status: 200,
        json: page1Of([1, 2, 3, 4, 5].map(CUSTOMER), 312),
      }),
    );
    await openAt(page, "/customers", theme, lang);
    await expect(page.getByText(lang === "AR" ? "عرض 1–5 من 312" : "Showing 1–5 of 312")).toBeVisible();
    // Nothing before page 0: Previous must render inert rather than vanish.
    await expect(
      page.getByRole("button", { name: lang === "AR" ? "السابق" : "Previous" }),
    ).toBeDisabled();
    await shoot(page, "customers", theme, lang);
  });

  test(`policies page control — ${theme} / ${lang}`, async ({ page }) => {
    await page.route("http://localhost:4000/policies**", (route) =>
      route.fulfill({
        status: 200,
        json: page1Of([1, 2, 3].map(POLICY), 208),
      }),
    );
    await openAt(page, "/policies", theme, lang);
    await expect(page.getByText(lang === "AR" ? "عرض 1–3 من 208" : "Showing 1–3 of 208")).toBeVisible();
    await shoot(page, "policies", theme, lang);
  });

  test(`audit-trail page control — ${theme} / ${lang}`, async ({ page }) => {
    await page.route("http://localhost:4000/audit-trail**", (route) => {
      if (route.request().url().includes("/audit-trail/")) return route.fallback();
      return route.fulfill({
        status: 200,
        json: page1Of([1, 2, 3, 4].map(AUDIT_ROW), 41_286),
      });
    });
    await openAt(page, "/audit-trail", theme, lang);
    await page.getByRole("button", { name: lang === "AR" ? "تصفح" : "Browse" }).click();
    // The grouped total is the point of this capture: the audit log is the
    // table that actually reaches five figures, and it used to be capped.
    await expect(
      page.getByText(lang === "AR" ? "عرض 1–4 من 41,286" : "Showing 1–4 of 41,286"),
    ).toBeVisible();
    await shoot(page, "audit-trail", theme, lang);
  });
}
