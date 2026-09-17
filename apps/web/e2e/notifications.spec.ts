import { expect, test, type Page } from "@playwright/test";
import { permissionsForRoles } from "./fixtures/role-permissions";

/*
 * The notification bell.
 *
 * It renders in the navbar on every screen, so the cases that matter most are
 * the degenerate ones: no work to show, and a response that is not the shape
 * the component expects. Either of those crashing would take out the whole app
 * shell, not just the bell.
 */

const ROLES = ["COMPLIANCE_OFFICER"];

const me = (languagePreference: "AR" | "EN") => ({
  id: "user-1",
  email: "officer@ibms.test",
  fullName: "Compliance Officer",
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

const FEED = {
  items: [
    { kind: "aml_alert", count: 2, severity: "warning", href: "/transaction-monitoring" },
    { kind: "screening_match", count: 5, severity: "action", href: "/screening-matches" },
  ],
  total: 7,
};

async function open(
  page: Page,
  lang: "AR" | "EN",
  body: unknown = FEED,
  theme: "light" | "dark" = "light",
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
  await page.route("http://localhost:4000/notifications", (route) =>
    route.fulfill({ status: 200, json: body }),
  );
  await page.route("http://localhost:4000/leads**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.goto("/leads");
}

test("the badge counts the work, not the sources, and the panel lists each kind", async ({
  page,
}) => {
  await open(page, "EN");

  // Two sources, seven pieces of work: the badge reads 7.
  const bell = page.getByRole("button", { name: /Notifications, 7/ });
  await expect(bell).toBeVisible();

  await bell.click();
  await expect(page.getByText("Open transaction-monitoring alerts")).toBeVisible();
  await expect(page.getByText("Screening matches to review")).toBeVisible();
});

test("a row navigates to the screen where the work is done", async ({ page }) => {
  await open(page, "EN");
  await page.getByRole("button", { name: /Notifications, 7/ }).click();
  await page.getByText("Screening matches to review").click();
  await expect(page).toHaveURL(/\/screening-matches$/);
});

test("Escape closes the panel", async ({ page }) => {
  await open(page, "EN");
  const bell = page.getByRole("button", { name: /Notifications, 7/ });
  await bell.click();
  await expect(page.getByText("Screening matches to review")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Screening matches to review")).toHaveCount(0);
});

test("with nothing to do the badge is absent and the panel says so", async ({ page }) => {
  await open(page, "EN", { items: [], total: 0 });

  // No badge at all rather than a grey zero: an empty bell should not look
  // like a thing that needs pressing.
  const bell = page.getByRole("button", { name: "Notifications, nothing needs attention" });
  await expect(bell).toBeVisible();
  await bell.click();
  await expect(page.getByText("Nothing needs your attention right now.")).toBeVisible();
});

test("a response of the wrong shape empties the bell instead of breaking the app", async ({
  page,
}) => {
  // A bare array is what a catch-all mock — or a future api change — would
  // hand back. `feed.items.length` on that throws, and this component renders
  // inside the navbar on every screen, so the blast radius is the whole app.
  await open(page, "EN", []);

  await expect(page.getByRole("heading", { name: "Leads" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Notifications, nothing needs attention" }),
  ).toBeVisible();
});

test("the bell renders in Arabic", async ({ page }) => {
  await open(page, "AR");
  const bell = page.getByRole("button", { name: /الإشعارات، 7/ });
  await expect(bell).toBeVisible();
  await bell.click();
  await expect(page.getByText("نتائج فحص بحاجة إلى مراجعة")).toBeVisible();
});

// Evidence captures.
for (const theme of ["light", "dark"] as const) {
  for (const lang of ["AR", "EN"] as const) {
    test(`notification panel — ${theme} / ${lang}`, async ({ page }) => {
      await open(page, lang, FEED, theme);
      await page
        .getByRole("button", { name: lang === "AR" ? /الإشعارات، 7/ : /Notifications, 7/ })
        .click();
      await page.screenshot({
        path: `test-results/notifications/${theme}-${lang}.png`,
        fullPage: true,
      });
    });
  }
}
