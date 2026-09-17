import { expect, test, type Page } from "@playwright/test";
import { permissionsForRoles } from "./fixtures/role-permissions";

/*
 * The picker that replaced ten raw customer-UUID fields.
 *
 * What matters here is that a person can find a customer by NAME — the field
 * used to demand a UUID, which nobody knows, so filling it in meant opening
 * another screen and copying one out of the address bar.
 *
 * Also proves the search actually reaches the server with `?search=`, since
 * the endpoint behind it is what supplies the bilingual and transliteration
 * matching ("Ahmad" finds "أحمد") — that behaviour is the api's own e2e to
 * prove, not this one's.
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

const customer = (id: string, legalName: string) => ({
  id,
  prospectId: null,
  customerType: "CORPORATE",
  legalName,
  givenName: null,
  fatherName: null,
  grandfatherName: null,
  familyName: null,
  dateOfBirth: null,
  nationality: null,
  registrationNumber: `REG-${id}`,
  taxRegistrationNumber: null,
  registeredAddress: null,
  natureOfBusiness: null,
  languagePreference: "EN",
  status: "ACTIVE",
  ownerUserId: "user-1",
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
});

const ALL = [customer("cust-1", "Al-Ufuq Trading Co."), customer("cust-2", "Sara Odeh")];

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
  // Registered BEFORE goto: the picker fetches on mount, so a route added
  // afterwards would miss that first call and leave the select empty.
  await page.route("http://localhost:4000/customers**", (route) => {
    const url = new URL(route.request().url());
    seen.push(url.search);
    const term = url.searchParams.get("search");
    const items = term
      ? ALL.filter((c) => c.legalName.includes(term))
      : ALL;
    return route.fulfill({
      status: 200,
      json: { items, total: items.length, page: 0, pageSize: 50 },
    });
  });
  await page.route("http://localhost:4000/service-requests**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.goto("/service-requests");
}

test("finds a customer by name and selects it, without anyone typing a UUID", async ({
  page,
}) => {
  const seen: string[] = [];
  await open(page, "EN", seen);

  const select = page.getByLabel("Customer", { exact: true });
  await expect(select).toBeVisible();
  // Both customers are offered before any search: for most books the first
  // page IS the whole list, so the field is usable without typing.
  await expect(select.locator("option")).toHaveCount(3); // 2 + the placeholder

  await page.getByLabel("Find a customer").fill("Sara");
  await page.getByRole("button", { name: "Search" }).click();

  await expect(select.locator("option")).toHaveCount(2);
  expect(seen.at(-1)).toContain("search=Sara");

  await select.selectOption("cust-2");
  await expect(select).toHaveValue("cust-2");
});

test("the picker renders in Arabic", async ({ page }) => {
  const seen: string[] = [];
  await open(page, "AR", seen);

  await expect(page.getByLabel("ابحث عن عميل")).toBeVisible();
  const select = page.getByLabel("العميل", { exact: true });
  await expect(select).toBeVisible();
  // The placeholder is the Arabic one, not a leftover English string.
  await expect(select.locator("option").first()).toHaveText("— اختر عميلاً —");
});

test("says so when a name matches nothing, rather than showing an empty box", async ({
  page,
}) => {
  const seen: string[] = [];
  await open(page, "EN", seen);

  await page.getByLabel("Find a customer").fill("zzz-no-such-customer");
  await page.getByRole("button", { name: "Search" }).click();

  await expect(page.getByText("No customer matches that name.")).toBeVisible();
});

test("Enter searches and does not submit the surrounding form", async ({ page }) => {
  const seen: string[] = [];
  await open(page, "EN", seen);

  // The picker sits inside a <form>; without preventDefault, Enter in its
  // search box would submit the request being drafted.
  await page.getByLabel("Find a customer").fill("Sara");
  await page.getByLabel("Find a customer").press("Enter");

  await expect
    .poll(() => seen.at(-1) ?? "")
    .toContain("search=Sara");
  await expect(page).toHaveURL(/\/service-requests$/);
});

// Evidence captures: the control replaced ten text inputs, so how it reads in
// both themes and both languages is the thing to look at.
for (const theme of ["light", "dark"] as const) {
  for (const lang of ["AR", "EN"] as const) {
    test(`customer picker — ${theme} / ${lang}`, async ({ page }) => {
      const seen: string[] = [];
      await open(page, lang, seen, theme);
      await expect(
        page.getByLabel(lang === "AR" ? "ابحث عن عميل" : "Find a customer"),
      ).toBeVisible();
      await page.screenshot({
        path: `test-results/customer-picker/${theme}-${lang}.png`,
        fullPage: true,
      });
    });
  }
}
