import { expect, test, type Page } from "@playwright/test";
import { permissionsForRoles } from "./fixtures/role-permissions";

/*
 * Evidence captures for the prose sweep: the page intros, empty states,
 * buttons and back-links that used to render English on both sides of the
 * language switch.
 *
 * Arabic is the point of these, so every screen is shot in both languages and
 * both themes. What to look at: the paragraph under each <h1> (previously
 * English in Arabic), the empty states, and the back-link arrow — it points
 * LEFT in English and RIGHT in Arabic, because in an RTL line the arrow sits
 * at the right edge and a left arrow there points into the text it is meant
 * to lead away from.
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

async function openAt(
  page: Page,
  path: string,
  theme: "light" | "dark",
  lang: "AR" | "EN",
) {
  await page.addInitScript((t) => {
    window.localStorage.setItem("ibms.theme", t as string);
  }, theme);
  // The catch-all goes FIRST: Playwright matches the most recently registered
  // handler, so a catch-all registered last would swallow /auth/me.
  await page.route("http://localhost:4000/**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({ status: 200, json: me(lang) }),
  );
  // Not every endpoint answers with an array. `/claims-analytics/loss-ratio`
  // returns a LossRatioBreakdown object, and feeding the catch-all's `[]` to
  // it crashes the page into Chrome's own "This page couldn't load" rather
  // than a React error boundary - the same fixture trap the quotation-chain
  // shape caused before. The blunt catch-all is fine; the exceptions are not
  // optional.
  await page.route("http://localhost:4000/claims-analytics/**", (route) =>
    route.fulfill({
      status: 200,
      json: {
        groupBy: "customer",
        rows: [],
        totals: {
          periodClaims: "0.000",
          periodPremium: "0.000",
          ratio: "0.000",
          ratioCapped: false,
        },
      },
    }),
  );
  await page.goto(path);
}

// screen -> [path, a phrase that must be on it in AR, and in EN]
const SCREENS: Array<[string, string, string, string]> = [
  ["cross-sell", "/cross-sell", "العملية 8", "Process 8"],
  ["up-sell", "/up-sell", "العملية 9", "Process 9"],
  ["crm", "/crm", "العملية 10", "Process 10"],
  ["needs-assessments", "/needs-assessments", "العملية 5", "Process 5"],
  ["insurance-programs", "/insurance-programs", "العملية 7", "Process 7"],
  ["access-recertification", "/access-recertification", "البند 5.1", "Part 5.1"],
  ["claims-analytics", "/claims-analytics", "معدّل الخسارة", "Loss Ratio"],
];

for (const theme of ["light", "dark"] as const) {
  for (const lang of ["AR", "EN"] as const) {
    for (const [name, path, ar, en] of SCREENS) {
      test(`${name} intro — ${theme} / ${lang}`, async ({ page }) => {
        await openAt(page, path, theme, lang);
        await expect(
          page.getByText(lang === "AR" ? ar : en, { exact: false }).first(),
        ).toBeVisible();
        await page.screenshot({
          path: `test-results/bilingual-prose/${name}-${theme}-${lang}.png`,
          fullPage: true,
        });
      });
    }
  }
}
