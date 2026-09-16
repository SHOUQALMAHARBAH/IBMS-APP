import { expect, test, type Page } from "@playwright/test";
import { permissionsForRoles } from "./fixtures/role-permissions";

/**
 * The book-wide policy list — the Policy Checking Officer's landing surface.
 *
 * Covers all four states directive §2 requires (loading / empty / error /
 * populated), the two filters, and the sidebar entry that makes the page
 * reachable at all. `/auth/me` is mocked, so `permissions` comes from the
 * generated grid fixture rather than being hand-written per spec.
 */

const ME_BASE = {
  id: "user-1",
  email: "checker@ibms.test",
  fullName: "Policy Checking Officer",
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
    route.fulfill({
      status: 200,
      json: { ...ME_BASE, roles, permissions: permissionsForRoles(roles) },
    }),
  );
}

function policy(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "pol-1",
    opportunityId: "opp-1",
    customerId: "cust-1",
    customer: { id: "cust-1", legalName: "Rawabi Trading Co." },
    insurerId: "ins-1",
    insurer: { id: "ins-1", name: "Jordan Insurance", nameAr: null },
    policyNumber: "POL-2026-00341",
    insuranceLine: "Property All Risks",
    status: "ACTIVE",
    inceptionDate: "2026-01-01T00:00:00.000Z",
    expiryDate: "2026-12-31T00:00:00.000Z",
    requestedPremium: "120000.000",
    issuedPremium: "120000.000",
    premiumVariance: "0.000",
    currency: "JOD",
    placedByUserId: "user-2",
    issuedByUserId: "user-2",
    schedules: [],
    documents: [],
    checking: null,
    delivery: null,
    issuanceComplete: true,
    checkingComplete: false,
    deliveryComplete: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

const LIST_URL = "http://localhost:4000/policies**";

// The five growing lists return `{ items, total, page, pageSize }`, not a bare
// array. Wrapping fixtures here rather than hand-writing the envelope at every
// mock keeps the shape in one place — the same reason the app has one
// `Pagination` component.
function paged<T>(items: T[]) {
  return { items, total: items.length, page: 0, pageSize: 50 };
}

test("renders the populated list and opens a policy on click", async ({ page }) => {
  await mockAuth(page, ["POLICY_CHECKING_OFFICER"]);
  await page.route(LIST_URL, (route) =>
    route.fulfill({ status: 200, json: paged([policy()]) }),
  );

  await page.goto("/policies");
  await expect(page.getByRole("heading", { name: "Policies" })).toBeVisible();
  await expect(page.getByText("POL-2026-00341")).toBeVisible();
  // The client name is the field that made the PolicyView widening necessary —
  // a list that cannot say whose policy this is would not be usable.
  await expect(page.getByText("Rawabi Trading Co.")).toBeVisible();
  await expect(page.getByText("Property All Risks")).toBeVisible();

  // Scoped to the CARD, not the page: the status filter renders an <option>
  // for every status, so a bare getByText("Active") also matches the dropdown
  // and proves nothing about the row.
  const card = page.getByRole("button", { name: /View policy POL-2026-00341/ });
  await expect(card).toContainText("Active");
  // The label is rendered, never the raw enum token.
  await expect(card).not.toContainText("ACTIVE");

  await card.click();
  await expect(page).toHaveURL(/\/policies\/pol-1$/);
});

test("shows an empty state that is true whether nothing exists or nothing is yours", async ({
  page,
}) => {
  await mockAuth(page, ["POLICY_CHECKING_OFFICER"]);
  await page.route(LIST_URL, (route) => route.fulfill({ status: 200, json: paged([]) }));

  await page.goto("/policies");
  await expect(page.getByText("No policies to show.", { exact: false })).toBeVisible();
});

test("shows a friendly message when the user lacks the permission", async ({ page }) => {
  await mockAuth(page, ["POLICY_CHECKING_OFFICER"]);
  await page.route(LIST_URL, (route) =>
    route.fulfill({ status: 403, json: { message: "Forbidden" } }),
  );

  await page.goto("/policies");
  const alert = page.locator('p[role="alert"]');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("policy.read");
});

test("shows a loading state before the list resolves", async ({ page }) => {
  await mockAuth(page, ["POLICY_CHECKING_OFFICER"]);
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(LIST_URL, async (route) => {
    await gate;
    await route.fulfill({ status: 200, json: paged([policy()]) });
  });

  await page.goto("/policies");
  await expect(page.getByText("Loading…")).toBeVisible();
  release?.();
  await expect(page.getByText("POL-2026-00341")).toBeVisible();
});

test("the status filter and the search box each reach the API as a query param", async ({
  page,
}) => {
  await mockAuth(page, ["POLICY_CHECKING_OFFICER"]);
  const seen: string[] = [];
  await page.route(LIST_URL, (route) => {
    seen.push(new URL(route.request().url()).search);
    return route.fulfill({ status: 200, json: paged([policy()]) });
  });

  await page.goto("/policies");
  await expect(page.getByText("POL-2026-00341")).toBeVisible();

  await page.getByLabel("Status").selectOption("DISCREPANCY");
  await expect.poll(() => seen.some((s) => s.includes("status=DISCREPANCY"))).toBe(true);

  await page.getByLabel("Search", { exact: true }).fill("Rawabi");
  await page.getByRole("button", { name: "Search" }).click();
  await expect.poll(() => seen.some((s) => s.includes("search=Rawabi"))).toBe(true);

  // The first load must carry no filters at all — an empty search box means
  // "show everything", not "search for an empty string".
  expect(seen[0]).toBe("");
});

test("a policy with no number yet still renders a usable row", async ({ page }) => {
  await mockAuth(page, ["POLICY_CHECKING_OFFICER"]);
  await page.route(LIST_URL, (route) =>
    route.fulfill({
      status: 200,
      json: paged([policy({ policyNumber: null, status: "PLACEMENT_CONFIRMED" })]),
    }),
  );

  await page.goto("/policies");
  const card = page.getByRole("button", { name: /View policy No number issued yet/ });
  await expect(card).toContainText("No number issued yet");
  // Scoped to the card for the same reason as above — the filter dropdown
  // carries an <option> with this label too.
  await expect(card).toContainText("Placement confirmed");
  await expect(card).not.toContainText("PLACEMENT_CONFIRMED");
});

test("the sidebar shows Policies to a Policy Checking Officer and hides it from a DPO", async ({
  page,
}) => {
  await mockAuth(page, ["POLICY_CHECKING_OFFICER"]);
  await page.route(LIST_URL, (route) => route.fulfill({ status: 200, json: paged([]) }));
  await page.goto("/policies");
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav.getByRole("link", { name: "Policies" })).toBeVisible();

  // The DPO holds no policy.read, so the link must not exist at all — not be
  // rendered and then rejected on click (directive §1).
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await page.goto("/consent");
  await expect(
    page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Policies" }),
  ).toHaveCount(0);
});
