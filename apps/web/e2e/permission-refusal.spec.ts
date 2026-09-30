import { expect, test, type Page } from "@playwright/test";
import { permissionsForRoles } from "./fixtures/role-permissions";

/*
 * THE REFUSAL SENTENCE, PROVEN AGAINST THE REAL SCREENS.
 *
 * 100 screens each wrote their own refusal and now all of them render one sentence from
 * `lib/i18n/permission-refusal.ts`. 61 existing specs assert that their own screen shows its own code in
 * the new parenthetical form, which proves the conversion reached them; NONE of them proves the SHAPE —
 * that the sentence names the act, names who grants it, and names them by function rather than by role.
 *
 * So the shape is proven once, thoroughly, here, rather than sixty-one times shallowly. That split is
 * deliberate: sixty-one copies of a long expected string is sixty-one places for the wording to drift, and
 * the wording being in ONE place is the whole point of the change.
 *
 * ## The three properties, and why each is asserted separately
 *
 *   1. THE ACT, in the language of the work. This is the half the English never had — every English string
 *      named the code and stopped, which tells a reader the name of the thing they must go and ask somebody
 *      else about and nothing about what they cannot do.
 *
 *   2. THE GRANTOR, so the reader has somewhere to go. Not one of the 100 said who could grant it.
 *
 *   3. THE GRANTOR NAMED BY FUNCTION, NEVER BY ROLE NAME — asserted as an ABSENCE, because that is the only
 *      form that can fail. An office defines its own role names (that is what office-scoped RBAC is for),
 *      so "ask your Office Administrator" is a sentence that can be false in any given office. The absence
 *      assertions below are anchored on the act being visible first: an unhydrated page satisfies every
 *      absence, so without the anchor they would pass on a blank screen.
 *
 * ## Both languages, because they were written independently
 *
 * The acts were not translated from each other — the English carried the code and the Arabic carried the
 * act, so each language was read for the half it actually held and the other half written. A test that
 * only ran in English would leave half the authored text unexercised, on an Arabic-first platform.
 */

const ME_BASE = {
  id: "user-1",
  email: "officer@ibms.test",
  fullName: "An Officer",
  languagePreference: "EN",
  mfaEnabled: false,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

async function mockAuth(page: Page, roles: string[], language = "EN") {
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fake-access-token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      status: 200,
      json: {
        ...ME_BASE,
        languagePreference: language,
        roles,
        permissions: permissionsForRoles(roles),
      },
    }),
  );
}

/** Every role name a seeded office uses, in both languages, as the forbidden vocabulary. */
const ROLE_WORDS = [
  "Office Administrator",
  "System",
  "Administrator",
  "Compliance",
  "Manager",
  "Executive",
  "مسؤول المكتب",
  "مدير",
  "الالتزام",
];

test("the refusal names the act, names who grants it, and names them by function", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await page.route("http://localhost:4000/payment-channels**", (route) =>
    route.fulfill({
      status: 403,
      json: {
        message: "You do not hold a permission required to perform this action",
      },
    }),
  );

  await page.goto("/payment-channels");

  // 1 — THE ACT, in the language of the work rather than of the permission.
  const refusal = page.getByText(
    "view the payment channels an office sends money through",
    { exact: false },
  );
  await expect(refusal).toBeVisible();

  // 2 — THE GRANTOR.
  await expect(
    page.getByText("ask whoever manages permissions in your office", {
      exact: false,
    }),
  ).toBeVisible();

  // 3 — the code ALONGSIDE, in a parenthetical, never as the sentence.
  await expect(
    page.getByText("(payment-channel.read)", { exact: false }),
  ).toBeVisible();

  // 4 — NO ROLE NAME. Anchored on the act above already being visible, so this cannot pass on a page that
  // never rendered. The API's own English message must be absent too: passing it through is the behaviour
  // this whole scheme replaced, and it would satisfy assertion 2 by accident if it ever came back.
  for (const word of ROLE_WORDS) {
    await expect(
      page.getByText(`ask your ${word}`, { exact: false }),
    ).toHaveCount(0);
  }
  await expect(
    page.getByText("You do not hold a permission required", { exact: false }),
  ).toHaveCount(0);
});

test("the Arabic refusal is the Arabic sentence, not a translated English one", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"], "AR");
  await page.route("http://localhost:4000/payment-channels**", (route) =>
    route.fulfill({
      status: 403,
      json: {
        message: "You do not hold a permission required to perform this action",
      },
    }),
  );

  await page.goto("/payment-channels");

  // The act, recovered verbatim from what the Arabic already said — the half the Arabic held all along.
  await expect(page.getByText("عرض قنوات الدفع", { exact: false })).toBeVisible();
  // The grantor, by function. «ممن يدير الصلاحيات في مكتبك» names a job, not a role.
  await expect(
    page.getByText("اطلبها ممن يدير الصلاحيات في مكتبك", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("(payment-channel.read)", { exact: false }),
  ).toBeVisible();
  // And no English leaked into the Arabic rendering — anchored on the Arabic act above.
  await expect(
    page.getByText("ask whoever manages", { exact: false }),
  ).toHaveCount(0);
});

test("ANY ONE of several codes — a route guard, which ORs them", async ({
  page,
}) => {
  // `GET /customers/kyc-records` declares ('kyc.capture', 'kyc.approve') and `PermissionsGuard` is
  // `required.some`, so holding EITHER is enough. The sentence has to say so: a reader told they need both
  // asks for a grant they do not need.
  await mockAuth(page, ["FINANCE_COLLECTIONS_OFFICER"]);
  // The exact URL, with no `**`: `kyc-queue-duty.spec.ts` records why — a wildcard here also catches
  // `/kyc-records/:id/submit` and every other action route. The controller carries no prefix, so the path
  // is `/kyc-records` and not `/customers/kyc-records` as the route's own file layout suggests.
  await page.route("http://localhost:4000/kyc-records", (route) =>
    route.fulfill({
      status: 403,
      json: {
        message: "You do not hold a permission required to perform this action",
      },
    }),
  );

  await page.goto("/customers/kyc-queue");

  await expect(
    page.getByText("work the KYC queue", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("any one of these permissions grants it", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("(kyc.capture, kyc.approve)", { exact: false }),
  ).toBeVisible();
  // The opposite claim must NOT be on the page — anchored on the act being visible above.
  await expect(
    page.getByText("needs all of these permissions", { exact: false }),
  ).toHaveCount(0);
});

test("ALL of several codes — a screen that loads them together", async ({
  page,
}) => {
  // The opposite case, and the one that makes the two functions worth having. This screen loads two
  // dashboards with `Promise.all` and closes entirely if EITHER refuses, so its reader needs BOTH. Phrasing
  // it "any one of these" — the rule that is true at the route guard — would tell somebody holding
  // `employee-performance.view` that they already qualify, when the screen will refuse them again.
  await mockAuth(page, ["FINANCE_COLLECTIONS_OFFICER"]);
  await page.route("http://localhost:4000/insurer-performance**", (route) =>
    route.fulfill({
      status: 403,
      json: {
        message: "You do not hold a permission required to perform this action",
      },
    }),
  );
  await page.route("http://localhost:4000/employee-performance**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );

  await page.goto("/dashboards/insurer-employee-performance");

  await expect(
    page.getByText("view the insurer and employee performance dashboard", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("needs all of these permissions", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("(insurer-performance.view, employee-performance.view)", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("any one of these permissions grants it", { exact: false }),
  ).toHaveCount(0);
});
