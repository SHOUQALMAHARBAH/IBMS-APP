import { expect, test, type Page } from "@playwright/test";
import { permissionsForRoles } from "./fixtures/role-permissions";

/*
 * THE ONE FIELD, on a second screen and in both languages.
 *
 * Named after `CustomerPicker`, which is long deleted. Kept under that name because what it holds in
 * place is the same promise the picker was built for: a person finds a customer by NAME, where the field
 * used to demand a uuid nobody knows.
 *
 * What this file covers that `entity-search.spec.ts` does not, which is why both exist:
 *
 *   1. A SECOND CALL SITE. `entity-search.spec.ts` drives `/dsr`; this drives `/service-requests`. One
 *      component on eleven screens is a claim that needs more than one of them exercised.
 *   2. ARABIC. The field, its placeholder and its result list in the reader's own script and direction —
 *      and this platform is Arabic-first, so an English-only spec proves the less important half.
 *   3. The screenshot evidence captures (Part F item #8), theme × language.
 *
 * ## It was REWRITTEN on 2026-10-01, and CI is what found it
 *
 * It tested the two-field design — a search box labelled "Find a customer" and a separate `<select>`
 * labelled "Customer" — which the owner's one-field decision removed. My scope search for that change
 * looked for `EntitySearch` USAGES and never for specs asserting the UI it renders, so a targeted local
 * run of `entity-search` alone was green while this file was broken.
 *
 * It also found a real defect rather than only a stale test: the listbox carried the FIELD's label, so
 * `getByLabel('Customer', { exact: true })` matched two elements. That is a strict-mode violation in a
 * test and an ambiguity for a screen reader, which would announce the input and its results by the same
 * name. The listbox has its own label now.
 */

const ROLES = ["CUSTOMER_SERVICE_OFFICER", "BRANCH_DEPARTMENT_MANAGER"];

const me = (languagePreference: "AR" | "EN") => ({
  id: "user-1",
  email: "officer@ibms.test",
  fullName: "Service Officer",
  languagePreference,
  roles: ROLES,
  permissions: permissionsForRoles(ROLES),
  mfaEnabled: true,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
});

/** The narrow row `GET /customers/search` returns — not a full customer. */
const row = (id: string, legalName: string) => ({
  id,
  legalName,
  customerType: "CORPORATE",
  status: "ACTIVE",
  registrationNumber: `REG-${id}`,
  taxRegistrationNumber: null,
});

const ALL = [row("cust-1", "Al-Ufuq Trading Co."), row("cust-2", "Sara Odeh")];

async function open(
  page: Page,
  lang: "AR" | "EN",
  seen: string[],
  theme: "light" | "dark" = "light",
) {
  await page.addInitScript((tm) => {
    window.localStorage.setItem("ibms.theme", tm as string);
  }, theme);
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({ status: 200, json: me(lang) }),
  );
  // The SEARCH route. Registered before `goto` as before, though the reason changed: the field no
  // longer fetches on mount — it fetches on the third character — so this is about not racing the
  // first keystroke rather than about not missing a mount request.
  await page.route("http://localhost:4000/customers/search**", (route) => {
    const url = new URL(route.request().url());
    seen.push(url.search);
    const term = url.searchParams.get("q") ?? "";
    const items = ALL.filter((c) =>
      c.legalName.toLowerCase().includes(term.toLowerCase()),
    );
    return route.fulfill({ status: 200, json: items });
  });
  // The LIST route, which this field must never reach. Routed separately so reaching it is a visible
  // event rather than a 404 in the background whose only symptom is an empty dropdown.
  await page.route("http://localhost:4000/customers?**", (route) => {
    seen.push(`LIST${url(route.request().url())}`);
    return route.fulfill({
      status: 200,
      json: { items: [], total: 0, page: 0, pageSize: 50 },
    });
  });
  await page.route("http://localhost:4000/service-requests**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.goto("/service-requests");
}

function url(full: string): string {
  return new URL(full).search;
}

test("finds a customer by name and selects it, without anyone typing a UUID", async ({
  page,
}) => {
  const seen: string[] = [];
  await open(page, "EN", seen);

  const field = page.getByLabel("Customer", { exact: true });
  await expect(field).toBeVisible();

  // NOTHING IS OFFERED BEFORE ANYBODY TYPES. The two-field version listed the first page of the book on
  // mount, which is what the owner's conditions 1 and 3 removed — so this assertion is the inverse of
  // the one it replaces, and deliberately so.
  expect(seen).toEqual([]);
  await expect(page.locator('[data-entity-search-list="customer"]')).toBeHidden();

  await field.fill("Sara");
  await expect(page.locator('[data-entity-search-option="cust-2"]')).toBeVisible();
  expect(seen.at(-1)).toContain("q=Sara");
  // And it asked the SEARCH route, never the register.
  expect(seen.filter((s) => s.startsWith("LIST"))).toEqual([]);

  await page.locator('[data-entity-search-option="cust-2"]').click();
  // The NAME, not the id — the owner's third requirement.
  await expect(field).toHaveValue("Sara Odeh");
});

test("the field renders in Arabic", async ({ page }) => {
  const seen: string[] = [];
  await open(page, "AR", seen);

  // The caller's own label, in Arabic. `/service-requests` passes it, which is why this is the Arabic
  // assertion that matters: the component's fallback label would hide a screen that forgot to translate.
  const field = page.getByLabel("العميل", { exact: true });
  await expect(field).toBeVisible();
  // The placeholder tells an Arabic reader what may be typed — including a number, which is half of
  // what this field now accepts.
  await expect(field).toHaveAttribute("placeholder", /رقم السجل/);

  await field.fill("Sara");
  const option = page.locator('[data-entity-search-option="cust-2"]');
  await expect(option).toBeVisible();
  // The result list is labelled in Arabic too, and NOT by the same name as the field.
  await expect(page.getByLabel("نتائج البحث")).toBeVisible();
});

test("says so when a name matches nothing, rather than showing an empty box", async ({
  page,
}) => {
  const seen: string[] = [];
  await open(page, "EN", seen);

  await page.getByLabel("Customer", { exact: true }).fill("zzz-no-such-customer");
  // "what you entered", not "that name" — the field matches a registration number too, and telling a
  // clerk searching a number that no customer has that NAME is the wrong sentence.
  await expect(page.getByText("No customer matches what you entered.")).toBeVisible();
});

test("Enter picks the active option and does not submit the surrounding form", async ({
  page,
}) => {
  const seen: string[] = [];
  await open(page, "EN", seen);

  // The field sits inside a `<form>`; without `preventDefault`, Enter would submit the request being
  // drafted. Here Enter PICKS, so if it submitted instead the selection would never land — the
  // assertion fails for the right reason rather than on a form the browser blocked anyway.
  const field = page.getByLabel("Customer", { exact: true });
  await field.fill("Sara");
  await expect(page.locator('[data-entity-search-option="cust-2"]')).toBeVisible();
  await field.press("Enter");

  await expect(field).toHaveValue("Sara Odeh");
  await expect(page).toHaveURL(/\/service-requests$/);
});

// Evidence captures: the control replaced ten text inputs and then two, so how it reads in both themes
// and both languages is the thing to look at. Captured WITH THE LIST OPEN, which is the state the
// two-field version could not show.
for (const theme of ["light", "dark"] as const) {
  for (const lang of ["AR", "EN"] as const) {
    test(`customer field — ${theme} / ${lang}`, async ({ page }) => {
      const seen: string[] = [];
      await open(page, lang, seen, theme);
      const field = page.getByLabel(lang === "AR" ? "العميل" : "Customer", {
        exact: true,
      });
      await expect(field).toBeVisible();
      await field.fill("Sara");
      await expect(page.locator('[data-entity-search-option="cust-2"]')).toBeVisible();
      await page.screenshot({
        path: `test-results/customer-field/${theme}-${lang}.png`,
        fullPage: true,
      });
    });
  }
}
