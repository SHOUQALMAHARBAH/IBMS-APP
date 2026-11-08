import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";
import { expectNone } from "./support/anchored";

const ME_BASE = {
  id: "user-1",
  email: "officer@ibms.test",
  fullName: "Sales Officer",
  languagePreference: "EN",
  mfaEnabled: false,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

async function mockAuth(page: Page, roles: string[]) {
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fake-access-token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({ status: 200, json: { ...ME_BASE, roles, permissions: permissionsForRoles(roles) } }),
  );
}

const LEADS = [
  {
    id: "lead-1",
    fullName: "Ahmad Al-Test",
    source: "referral",
    ownerUserId: "user-1",
    status: "NEW",
    contactPhone: "+962-7-0000-0000",
    contactEmail: null,
    marketingConsentGranted: false,
    firstContactAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "lead-2",
    fullName: "Not Mine",
    source: "website",
    ownerUserId: "some-other-officer",
    status: "CONTACTED",
    contactPhone: null,
    contactEmail: "notmine@ibms.test",
    marketingConsentGranted: true,
    firstContactAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

test("renders the pipeline board grouped by status", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/privacy-notices/current**", (route) =>
    route.fulfill({ status: 200, json: { notice: null } }),
  );
  await page.route("http://localhost:4000/leads", (route) =>
    route.fulfill({ status: 200, json: LEADS }),
  );

  await page.goto("/leads");

  await expect(page.getByRole("heading", { name: "Leads" })).toBeVisible();
  await expect(page.getByText("Ahmad Al-Test")).toBeVisible();
  await expect(page.getByText("Not Mine")).toBeVisible();
});

test("shows the intake form for a Sales Officer, but not for a Claims Officer", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/privacy-notices/current**", (route) =>
    route.fulfill({ status: 200, json: { notice: null } }),
  );
  await page.route("http://localhost:4000/leads", (route) => route.fulfill({ status: 200, json: [] }));
  await page.goto("/leads");
  await expect(page.getByRole("heading", { name: "New lead" })).toBeVisible();

  await mockAuth(page, ["CLAIMS_OFFICER"]);
  await page.goto("/leads");
  await expect(page.getByRole("heading", { name: "New lead" })).toHaveCount(0);
});

test("shows an empty state when there are no leads yet", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/privacy-notices/current**", (route) =>
    route.fulfill({ status: 200, json: { notice: null } }),
  );
  await page.route("http://localhost:4000/leads", (route) => route.fulfill({ status: 200, json: [] }));

  await page.goto("/leads");

  await expect(page.getByText("No leads yet — add one above to start your pipeline.")).toBeVisible();
});

test("shows a friendly message when the user lacks list permission", async ({ page }) => {
  await mockAuth(page, ["CLAIMS_OFFICER"]);
  await page.route("http://localhost:4000/leads", (route) =>
    route.fulfill({
      status: 403,
      json: { message: "You do not hold a permission required to perform this action" },
    }),
  );

  await page.goto("/leads");

  await expect(page.locator('main [role="alert"]')).toContainText("(lead.list.read)");
});

/*
 * MODULE 0-c ROW 59 — `/leads/[id]` was built, worked, and nothing in the application linked to it.
 *
 * Measured 2026-11-07: every reference to that path in `apps/web` was the detail page's own fetch,
 * two e2e specs, or a comment naming the file. No `href`, no `router.push`, no nav entry, and not
 * from the leads list itself — so a whole screen was unreachable, and nobody reported it missing
 * because nobody knew it was there. `/prospects/[id]` beside it has always been linked, which is
 * why only this one went unnoticed.
 *
 * Asserted by ARRIVING, not by the link's presence: a test that only checks an anchor exists would
 * pass against an `href` pointing anywhere, and the defect here was a route nobody reached.
 */
test("reaches the lead detail screen from its row in the pipeline", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/privacy-notices/current**", (route) =>
    route.fulfill({ status: 200, json: { notice: null } }),
  );
  await page.route("http://localhost:4000/leads", (route) => route.fulfill({ status: 200, json: LEADS }));
  await page.route("http://localhost:4000/leads/lead-1", (route) =>
    route.fulfill({ status: 200, json: LEADS[0] }),
  );

  await page.goto("/leads");
  await page.getByRole("link", { name: "Ahmad Al-Test" }).click();

  await expect(page).toHaveURL(/\/leads\/lead-1$/);
  /*
   * "Marketing Consent" is rendered by the DETAIL page and by nothing on the board, which is what
   * makes it evidence of arrival. The lead's NAME would not be: it is on the card the click
   * started from, so an assertion on it passes against a navigation that never happened.
   *
   * Deliberately not the `leaddLeadDetails` heading, and the reason has changed rather than gone
   * away: that string was waiting on the owner when this was written and it LANDED on 2026-11-08
   * («المرتقب» → «المحتمل»). It is asserted now, in Arabic, by
   * `part-h-detail-pages-screenshots.spec.ts`. Anchoring here on a heading that another spec
   * already owns would be a second home for one fact.
   */
  await expect(page.getByText("Marketing Consent")).toBeVisible();
});

test("only offers a transition action on the officer's own lead, and moving it updates the board", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/privacy-notices/current**", (route) =>
    route.fulfill({ status: 200, json: { notice: null } }),
  );
  await page.route("http://localhost:4000/leads", (route) => route.fulfill({ status: 200, json: LEADS }));
  // The real endpoint returns WorkflowTransitionService's generic
  // { id, status } shape, not the full Lead — mocking the full Lead here
  // would mask a crash the same way access-recertification's decide()
  // response mismatch once did (see that spec's comment).
  await page.route("**/leads/lead-1/transition", (route) =>
    route.fulfill({ status: 201, json: { id: "lead-1", status: "CONTACTED" } }),
  );

  await page.goto("/leads");

  // Anchored on the officer's OWN action, which must be present: otherwise "no button on someone
  // else's lead" and "the board has not rendered" are indistinguishable.
  await expectNone(
    page.getByRole("button", { name: /Not Mine/ }),
    page.getByRole("button", { name: "Mark contacted — Ahmad Al-Test" }),
  );
  await page.getByRole("button", { name: "Mark contacted — Ahmad Al-Test" }).click();

  await expect(page.getByRole("button", { name: "Mark contacted — Ahmad Al-Test" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Mark qualified — Ahmad Al-Test" })).toBeVisible();
});

test("leads page has no serious/critical accessibility violations @a11y", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/privacy-notices/current**", (route) =>
    route.fulfill({ status: 200, json: { notice: null } }),
  );
  await page.route("http://localhost:4000/leads", (route) => route.fulfill({ status: 200, json: LEADS }));

  await page.goto("/leads");
  await expect(page.getByText("Ahmad Al-Test")).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  const seriousOrCritical = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(seriousOrCritical).toEqual([]);
});

test("the intake form's fields are reachable via keyboard", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/privacy-notices/current**", (route) =>
    route.fulfill({ status: 200, json: { notice: null } }),
  );
  await page.route("http://localhost:4000/leads", (route) => route.fulfill({ status: 200, json: [] }));

  await page.goto("/leads");
  const fullNameInput = page.getByLabel("Full name");
  await fullNameInput.focus();
  await expect(fullNameInput).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Source")).toBeFocused();
});
