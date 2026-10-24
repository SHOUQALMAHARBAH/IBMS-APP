import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";

const ME_BASE = {
  id: "user-1",
  email: "admin@ibms.test",
  fullName: "Security Administrator",
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

const ASSET = {
  id: "asset-1",
  name: "Customer Data Warehouse",
  assetType: "customer_data",
  ownerUserId: "user-2",
  // Item 1 — the accountable colleague's name, resolved by the api through decision 48's resolver.
  ownerName: "سامر عبدالله الحوراني",
  classification: "HIGHLY_CONFIDENTIAL",
  createdAt: "2026-09-20T09:00:00.000Z",
};

test("renders the information asset list with the create form", async ({ page }) => {
  await mockAuth(page, ["SYSTEM_SECURITY_ADMINISTRATOR"]);
  await page.route("http://localhost:4000/information-assets", (route) =>
    route.fulfill({ status: 200, json: [ASSET] }),
  );

  await page.goto("/information-assets");
  await expect(page.getByRole("heading", { name: "Information Assets" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Customer Data Warehouse" })).toBeVisible();

  /*
   * ITEM 1 — THE ACCOUNTABLE COLLEAGUE BY NAME. Written because the spec passed the moment the
   * view landed without observing it: every assertion here reads the asset's own NAME, so the raw
   * row and the view are indistinguishable to them.
   *
   * This is the register whose whole purpose is saying WHO is accountable for a classified asset,
   * and it was answering with a uuid. THE PAIR — the name present AND the uuid gone — because a
   * screen rendering both would satisfy a name-only check.
   */
  await expect(
    page.getByRole("cell", { name: "سامر عبدالله الحوراني" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "user-2", exact: true }),
  ).toHaveCount(0);

  await expect(
    page.getByRole("heading", { name: "Record a new information asset" }),
  ).toBeVisible();
});

test("a user without the permission sees a friendly message", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/information-assets", (route) =>
    route.fulfill({ status: 403, json: { message: "no" } }),
  );

  await page.goto("/information-assets");
  await expect(
    page.getByText("(information-asset.manage)", { exact: false }),
  ).toBeVisible();
});

test("renames an information asset inline", async ({ page }) => {
  await mockAuth(page, ["SYSTEM_SECURITY_ADMINISTRATOR"]);
  let current = { ...ASSET };
  await page.route("http://localhost:4000/information-assets", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 200, json: [current] });
    }
    return route.fallback();
  });
  await page.route("http://localhost:4000/information-assets/asset-1", (route) => {
    current = { ...current, name: "Customer Data Lake" };
    return route.fulfill({ status: 200, json: current });
  });

  await page.goto("/information-assets");
  await expect(page.getByRole("cell", { name: "Customer Data Warehouse" })).toBeVisible();
  await page.getByRole("button", { name: "Rename" }).click();
  await page
    .getByRole("row", { name: "Customer Data Warehouse customer_data" })
    .getByRole("textbox")
    .fill("Customer Data Lake");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("cell", { name: "Customer Data Lake" })).toBeVisible();
});

test("information assets screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["SYSTEM_SECURITY_ADMINISTRATOR"]);
  await page.route("http://localhost:4000/information-assets", (route) =>
    route.fulfill({ status: 200, json: [ASSET] }),
  );

  await page.goto("/information-assets");
  await expect(page.getByRole("cell", { name: "Customer Data Warehouse" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
