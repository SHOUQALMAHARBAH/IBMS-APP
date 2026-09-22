import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";

const ME_BASE = {
  id: "user-1",
  email: "compliance@ibms.test",
  fullName: "Compliance Officer",
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

const AGREEMENTS = [
  {
    id: "ag-open",
    insurerId: "ins-1",
    insurerName: "Acme Insurance",
    insuranceLine: "Property All Risks",
    ratePercent: "10.00",
    vatRatePercent: "16.00",
    effectiveFrom: "2026-06-01T00:00:00.000Z",
    effectiveTo: null,
    isOpen: true,
  },
  {
    id: "ag-closed",
    insurerId: "ins-1",
    insurerName: "Acme Insurance",
    insuranceLine: "Property All Risks",
    ratePercent: "15.00",
    vatRatePercent: "0.00",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: "2026-06-01T00:00:00.000Z",
    isOpen: false,
  },
];

async function mockCommission(page: Page, opts: { status?: number } = {}) {
  await page.route(
    "http://localhost:4000/commission/agreements**",
    (route) => {
      if (opts.status && opts.status !== 200) {
        return route.fulfill({ status: opts.status, json: { message: "no" } });
      }
      return route.fulfill({ status: 200, json: AGREEMENTS });
    },
  );
  await page.route("http://localhost:4000/commission/insurers**", (route) =>
    route.fulfill({
      status: 200,
      json: [{ id: "ins-1", name: "Acme Insurance" }],
    }),
  );
  // The managed line catalogue the rate form now PICKS from. It used to be a free-text input with
  // a placeholder showing a line name — and the Arabic placeholder was worded differently from the
  // seeded Arabic name, so following it produced a rate on a line nothing could match. The server
  // now resolves the line and refuses an unknown one, so free text would be a 422 for anyone who
  // typed.
  //
  // The office addition is in this fixture ON PURPOSE: it must NOT be offered, because the API
  // resolves a rate's line from a platform CODE and an office line has none.
  await page.route("http://localhost:4000/insurance-lines**", (route) =>
    route.fulfill({
      status: 200,
      json: [
        {
          id: "line-property",
          code: "PROPERTY_ALL_RISKS",
          nameEn: "Property All Risks",
          nameAr: "تأمين جميع أخطار الممتلكات",
          category: "GENERAL",
          isStandard: true,
        },
        {
          id: "line-cyber",
          code: "CYBER",
          nameEn: "Cyber",
          nameAr: "التأمين السيبراني",
          category: "GENERAL",
          isStandard: true,
        },
        {
          id: "line-office",
          code: null,
          nameEn: "Drone Hull",
          nameAr: "أجسام الطائرات المسيرة",
          category: "GENERAL",
          isStandard: false,
        },
      ],
    }),
  );
}

test("shows the governed rate table with the open + closed windows", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockCommission(page);

  await page.goto("/commission");
  await expect(
    page.getByRole("heading", { name: "Commission rates" }),
  ).toBeVisible();

  await expect(page.getByRole("cell", { name: "10.00%" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "15.00%" })).toBeVisible();
  // Process 36 — the governed VAT rate column
  await expect(page.getByRole("cell", { name: "16.00%" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Open", exact: true })).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Closed", exact: true }),
  ).toBeVisible();

  // Compliance sees the add form
  await expect(page.getByLabel("Insurer")).toBeVisible();
  await expect(page.getByLabel("Rate percent", { exact: true })).toBeVisible();
  await expect(page.getByLabel("VAT rate percent")).toBeVisible();

  // The line field is a PICKER over the managed catalogue, not free text.
  const line = page.getByLabel("Insurance line");
  await expect(line).toBeVisible();
  // Valued by CODE, so what is submitted is language-independent while the label follows the
  // reader. Asserted on the option's value rather than its text for the same reason.
  await expect(line.locator("option[value='PROPERTY_ALL_RISKS']")).toHaveText(
    "Property All Risks",
  );
  // And the office's own added line is NOT offered: it has no platform code, so the server would
  // have to refuse it. Offering a choice the server must reject is worse than not offering it.
  await expect(line.locator("option")).toHaveCount(3);
  await expect(line.getByText("Drone Hull")).toHaveCount(0);
});

test("a user without the permission sees a friendly message", async ({ page }) => {
  await mockAuth(page, ["FINANCE_COLLECTIONS_OFFICER"]);
  await mockCommission(page, { status: 403 });

  await page.goto("/commission");
  await expect(
    page.getByText("commission-rate.manage permission", { exact: false }),
  ).toBeVisible();
});

test("commission rates screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockCommission(page);

  await page.goto("/commission");
  await expect(page.getByRole("cell", { name: "10.00%" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
