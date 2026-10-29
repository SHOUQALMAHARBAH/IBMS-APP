import { expect, test, type Page } from "@playwright/test";
import { permissionsForRoles } from "./fixtures/role-permissions";

/*
 * THE SHELL SCROLLS THE BODY AND NOTHING ELSE — and the one defect that change introduces.
 *
 * The owner asked for this after walking the captures: *«بدي يكون الناف بار و السايد بار ستاتيك
 * يعني ثابتين محلهم و بس البادي هو الي بيتحرك بالسكرول»* — the top bar and the rail stay put, only
 * the body moves. `shellStyle` is `100dvh` with `overflow: hidden` and the content column is the
 * only scroller.
 *
 * WHAT THIS SPEC IS FOR IS THE SECOND HALF. The browser resets scroll on the DOCUMENT scroller;
 * move the scroller into a div and that stops, so navigating from halfway down a long table lands
 * the reader halfway down the next screen — page header, the line saying what the screen is for,
 * and the primary action all above the fold. That is invisible in every screenshot (a capture is
 * taken at the top) and obvious to the first person who uses the product, which is the class of
 * fault that needs an assertion rather than an eye.
 *
 * THE TALLNESS IS INJECTED RATHER THAN MOCKED, AND THAT IS DELIBERATE. What is under test is a
 * property of the FRAME, which every one of the 106 authenticated screens renders into — so
 * depending on one screen's fixture having enough rows would make the test about that fixture, and
 * would make it stop being able to fail the day somebody trimmed it. `addStyleTag` survives an App
 * Router client navigation (the document is not reloaded), which is what lets BOTH screens in the
 * route-change test be tall.
 *
 * AND EVERY SCROLL ASSERTION HAS A NON-VACUITY FLOOR IN FRONT OF IT. `scrollTop` on an element
 * with nothing to scroll is 0 — permanently, whatever the code does — so an unguarded
 * `toBe(0)` after a navigation is a test that cannot fail. The floor is asserted first in both
 * places that read it.
 */

const ROLES = ["BRANCH_DEPARTMENT_MANAGER"];

const ME = {
  id: "user-mgr",
  email: "manager@ibms.test",
  fullName: "Branch Manager",
  languagePreference: "EN",
  roles: ROLES,
  permissions: permissionsForRoles(ROLES),
  mfaEnabled: true,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  department: { name: "Claims", nameAr: "المطالبات" },
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

async function openApp(page: Page) {
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "token" } }),
  );
  await page.route("**/auth/me", (route) => route.fulfill({ status: 200, json: ME }));
  // Every list this role's screens reach answers empty: the shell is what is under test, and a
  // screen's own data would only make the frame's behaviour depend on a fixture.
  await page.route("http://localhost:4000/**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.goto("/leads");
  await page.getByRole("navigation", { name: "Primary" }).waitFor();

  // Taller than any viewport, on whatever screen is mounted. Scoped to the content column's own
  // `<main>` so it cannot be satisfied by the rail or the bar.
  await page.addStyleTag({
    content: "[data-app-content] main { min-height: 4000px; }",
  });
}

function content(page: Page) {
  return page.locator("[data-app-content]");
}

function scrollTopOf(page: Page) {
  return content(page).evaluate((el) => el.scrollTop);
}

test("the content column is the scroller and the document is not", async ({ page }) => {
  await openApp(page);

  // The frame IS the viewport, so the document has nothing to scroll. A range rather than an
  // equality because a sub-pixel viewport height is normal at some device scales.
  const docOverflow = await page.evaluate(
    () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
  );
  expect(docOverflow, "the window still scrolls — the shell is not the viewport").toBeLessThan(2);

  await expect(content(page)).toBeVisible();
  const scrollable = await content(page).evaluate((el) => el.scrollHeight > el.clientHeight + 1);
  expect(
    scrollable,
    "the content column has nothing to scroll, so this test cannot see what it is about",
  ).toBe(true);
});

test("the bar and the rail do not move when the body scrolls", async ({ page }) => {
  await openApp(page);

  const bar = page.getByRole("navigation", { name: "Account and settings" });
  const rail = page.getByRole("navigation", { name: "Primary" });
  const barBefore = await bar.boundingBox();
  const railBefore = await rail.boundingBox();
  if (!barBefore || !railBefore) throw new Error("no bounding box before scrolling");

  await content(page).evaluate((el) => {
    el.scrollTop = 400;
  });
  await expect
    .poll(() => scrollTopOf(page), {
      message: "the body never scrolled, so this test cannot see whether the frame moved with it",
    })
    .toBeGreaterThan(100);

  const barAfter = await bar.boundingBox();
  const railAfter = await rail.boundingBox();
  if (!barAfter || !railAfter) throw new Error("no bounding box after scrolling");

  expect(barAfter.y, "the top bar moved when the body scrolled").toBeCloseTo(barBefore.y, 0);
  expect(railAfter.y, "the rail moved when the body scrolled").toBeCloseTo(railBefore.y, 0);
});

test("a route change puts the reader back at the top of the new screen", async ({ page }) => {
  await openApp(page);

  await content(page).evaluate((el) => {
    el.scrollTop = 500;
  });
  await expect
    .poll(() => scrollTopOf(page), {
      message: "the body never scrolled, so the reset this test is about cannot be observed",
    })
    .toBeGreaterThan(100);

  // Through the rail, because that is how a reader changes screen. A `page.goto` would reload the
  // document and reset the scroll for free, proving nothing about the effect in the layout — and
  // it would also drop the injected tallness, leaving a short destination whose `scrollTop` is 0
  // whatever the code does.
  await page.getByRole("link", { name: "Prospects" }).first().click();
  await expect(page).toHaveURL(/\/prospects/);

  // The destination is still tall (the style tag survives a client navigation), so a 0 here is the
  // reset rather than an element with nothing to scroll.
  const stillTall = await content(page).evaluate((el) => el.scrollHeight > el.clientHeight + 1);
  expect(
    stillTall,
    "the new screen is not scrollable, so `scrollTop === 0` would hold with no reset at all",
  ).toBe(true);

  await expect.poll(() => scrollTopOf(page)).toBe(0);
});
