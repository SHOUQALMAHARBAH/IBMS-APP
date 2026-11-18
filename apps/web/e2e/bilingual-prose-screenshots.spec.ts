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

/*
 * 🔴 THE ARABIC ANCHORS USED TO BE «العملية N», AND OWNER DECISION 150 RULING 3-أ DELETED THEM.
 *
 * Five of these screens were anchored on the backlog's own process number — «العملية 8»,
 * «العملية 9», … — which is exactly the prefix she ruled out of all twenty-five descriptions:
 * «يُحذَف من الخمسة والعشرين». So this spec was asserting the PRESENCE of a string the owner had
 * ruled against, and it went red on the commit that obeyed her. CI caught it; my local sweep did
 * not, because I did not run this file.
 *
 * ⟶ Each Arabic anchor is now a DISTINCTIVE PHRASE THAT SURVIVES the ruling, taken from the
 *   post-150 text in `docs/decision-150-ratified-strings.md` §٥. The full strings are pinned
 *   byte-for-byte against that annex by `lib/i18n/decision-150.strings.test.ts`; what this file
 *   needs is only something stable to prove the prose REACHED THE SCREEN before it screenshots.
 *
 * ⚠️ AND THE ENGLISH ANCHORS WERE LEFT ALONE, MEASURED RATHER THAN ASSUMED — ruling 3-أ and the
 * annex name ARABIC spans only, so «Process N — » still opened the English and still anchored
 * here. Whether the English should lose its prefix too was recorded as an EMPTY CELL, because
 * ⛔ removing it because the Arabic lost it would have been deciding for her.
 *
 * 🔴 SHE RULED IT — OWNER DECISION 152 §٢, and this file is the creditor being paid. The prefix
 * is gone from the twenty-five English values too, so the five English anchors below have moved
 * to a DISTINCTIVE PHRASE THAT SURVIVES the ruling, exactly as the Arabic ones did a batch ago.
 * Each was proven present in the shipping text before it was written here, and
 * `check:process-prefix` now holds BOTH languages at budget zero.
 *
 * ⛔ `access-recertification`'s «البند 5.1» / «Part 5.1» pair is NOT touched. Decision 151
 * ruling 2 deletes those internal clause references, but 151 is COPY ONLY this batch — the
 * strings move when it is built, and re-anchoring ahead of the change would leave this file
 * asserting the absence of something still on the screen.
 */
// screen -> [path, a phrase that must be on it in AR, and in EN]
const SCREENS: Array<[string, string, string, string]> = [
  ["cross-sell", "/cross-sell", "بقائمة فروع تأمين مرجعية", "benchmark line list"],
  ["up-sell", "/up-sell", "مبلغ التأمين المصمم للممتلكات", "designed property Sum Insured"],
  ["crm", "/crm", "تسجيل كل نقطة تواصل مع العميل", "Log every customer touchpoint"],
  ["needs-assessments", "/needs-assessments", "استبيان مخاطر منظّم", "A structured risk questionnaire"],
  [
    "insurance-programs",
    "/insurance-programs",
    "برنامج تأمين متعدد فروع التأمين",
    "A multi-line Insurance Program",
  ],
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
