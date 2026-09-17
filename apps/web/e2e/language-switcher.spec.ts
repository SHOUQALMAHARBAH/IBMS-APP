import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";

// Part F — Bilingual UI (backlog Part 11), item #1: "instant language switch
// without losing session context + a persistent per-user language
// preference." Verifies the switcher itself (mounted in AppNav, visible on
// every authenticated screen) flips <html lang/dir> instantly and persists
// via PATCH /auth/me/language — not the rest of Part F's scope (RTL layout
// polish, bidi text, locale formatting, document generation, full-text
// search), which are separate, later items.

const ME_BASE = {
  id: "user-1",
  email: "officer@ibms.test",
  fullName: "Sales Officer",
  mfaEnabled: false,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

async function mockAuth(page: Page, languagePreference: "AR" | "EN") {
  let currentLanguage = languagePreference;
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fake-access-token" } }),
  );
  await page.route("**/auth/me", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({
      status: 200,
      json: { ...ME_BASE, roles: ["SALES_RELATIONSHIP_OFFICER"], permissions: permissionsForRoles(["SALES_RELATIONSHIP_OFFICER"]), languagePreference: currentLanguage },
    });
  });
  await page.route("**/auth/me/language", async (route) => {
    const body = route.request().postDataJSON() as { languagePreference: "AR" | "EN" };
    currentLanguage = body.languagePreference;
    return route.fulfill({
      status: 200,
      json: { ...ME_BASE, roles: ["SALES_RELATIONSHIP_OFFICER"], permissions: permissionsForRoles(["SALES_RELATIONSHIP_OFFICER"]), languagePreference: currentLanguage },
    });
  });
  await page.route("http://localhost:4000/leads**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
}

test("defaults to the account's stored language and applies dir/lang on load", async ({ page }) => {
  await mockAuth(page, "AR");
  await page.goto("/leads");
  await expect(page.getByRole("navigation", { name: /^(Primary|التنقّل الرئيسي)$/ })).toBeVisible();

  await expect.poll(() => page.evaluate(() => document.documentElement.dir)).toBe("rtl");
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe("ar");
  await expect(page.getByRole("button", { name: "العربية" })).toHaveAttribute("aria-pressed", "true");
});

test("switching language is instant (no reload) and persists via PATCH /auth/me/language", async ({ page }) => {
  await mockAuth(page, "AR");
  await page.goto("/leads");
  await expect(page.getByRole("navigation", { name: /^(Primary|التنقّل الرئيسي)$/ })).toBeVisible();

  let patchCalled = false;
  page.on("request", (req) => {
    if (req.url().includes("/auth/me/language") && req.method() === "PATCH") patchCalled = true;
  });

  await page.getByRole("button", { name: "English" }).click();

  // instant — no navigation, dir/lang flip client-side immediately
  await expect.poll(() => page.evaluate(() => document.documentElement.dir)).toBe("ltr");
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe("en");
  await expect(page.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");
  // Both landmarks re-render, so assert one string from each: the sidebar no
  // longer has a sign-out to check (identity and sign-out moved to the navbar
  // profile menu), and checking only the navbar would leave the sidebar —
  // which is most of the translated surface — unasserted.
  await expect(
    page.getByRole("navigation", { name: /^(Primary|التنقّل الرئيسي)$/ }).getByRole("link", { name: "Home" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: /^(Account and settings|الحساب والإعدادات)$/ })
      .getByText("Sales Officer"),
  ).toBeVisible();
  expect(patchCalled).toBe(true);

  // a fresh load now reflects the persisted (mocked-server) preference
  await page.reload();
  await expect(page.getByRole("navigation", { name: /^(Primary|التنقّل الرئيسي)$/ })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.dir)).toBe("ltr");
});

test("language switcher has no serious/critical accessibility violations @a11y", async ({ page }) => {
  await mockAuth(page, "EN");
  await page.goto("/leads");
  await expect(page.getByRole("navigation", { name: /^(Primary|التنقّل الرئيسي)$/ })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
});
