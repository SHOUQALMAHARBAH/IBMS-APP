import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";

const ME_BASE = {
  id: "user-1",
  email: "sales@ibms.test",
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

const CONSENT_RECORDS = [
  {
    id: "consent-1",
    customerId: "11111111-1111-1111-1111-111111111111",
    insuredPersonId: null,
    leadId: null,
    // Batch six item 2 — whichever subject the record names, BY NAME.
    subjectName: "شركة اليرموك للتأمين",
    purpose: "MARKETING",
    isMarketing: true,
    granted: true,
    consentTextVersion: "privacy-notice-v1.2",
    grantedAt: "2026-09-04T09:00:00.000Z",
    withdrawnAt: null,
    isActive: true,
    createdAt: "2026-09-04T09:00:00.000Z",
  },
  {
    id: "consent-2",
    customerId: "11111111-1111-1111-1111-111111111111",
    insuredPersonId: null,
    leadId: null,
    // Batch six item 2 — whichever subject the record names, BY NAME.
    subjectName: "شركة اليرموك للتأمين",
    purpose: "KYC_AML",
    isMarketing: false,
    granted: false,
    consentTextVersion: "kyc-notice-v1",
    grantedAt: null,
    withdrawnAt: null,
    isActive: false,
    createdAt: "2026-08-01T09:00:00.000Z",
  },
];

async function mockConsentRecords(page: Page, opts: { status?: number } = {}) {
  await page.route("http://localhost:4000/consent-records**", (route) => {
    if (opts.status && opts.status !== 200) {
      return route.fulfill({ status: opts.status, json: { message: "no" } });
    }
    return route.fulfill({ status: 200, json: CONSENT_RECORDS });
  });
}

test("lists consent records with the capture form and withdrawal actions", async ({
  page,
}) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await mockConsentRecords(page);

  await page.goto("/consent");
  await expect(
    page.getByRole("heading", { name: "Consent management" }),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: "MARKETING" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "KYC_AML" })).toBeVisible();
  await expect(page.getByLabel("Purpose")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Record decision" }),
  ).toBeVisible();
  // only the active (granted, not withdrawn) row gets withdrawal actions
  await expect(
    page.getByRole("button", { name: "Request withdrawal" }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Confirm withdrawal" }),
  ).toHaveCount(1);

  /*
   * RULE 2 (batch six item 2) — WHOSE consent, by name. This column rendered `Lead <8 chars>` or a
   * bare sliced uuid on the one screen whose whole subject is who agreed to what.
   *
   * THE PAIR: the name present AND the uuid gone. And the `Lead ` prefix is asserted ABSENT too,
   * because it was hardcoded ENGLISH inside a template literal — an Arabic reader saw it as well,
   * and removing it is a second fix rather than a side effect.
   */
  /*
   * ASSERTED ON THE CELL WITH `exact: true`, NOT PAGE-WIDE, and the first version taught me why:
   * `getByText("Lead ")` matched the CAPTURE FORM's own «Lead ID» label — a correct element that
   * must stay — so the test failed on a correct screen. That is the page-wide-absence class
   * `check:absence` exists for, met inside a test written to check rule 2.
   *
   * `exact: true` on the cell is strictly stronger than what the page-wide pair could say: it
   * fails if the name is there AND fails if anything is prefixed to it, so the removed `Lead `
   * prefix and the removed uuid are both covered by one assertion about one element.
   */
  await expect(
    page.getByRole("cell", { name: "شركة اليرموك للتأمين", exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: /11111111/ })).toHaveCount(0);
});

test("a user without the permission sees a friendly message", async ({
  page,
}) => {
  await mockAuth(page, ["FINANCE_COLLECTIONS_OFFICER"]);
  await mockConsentRecords(page, { status: 403 });

  await page.goto("/consent");
  await expect(
    page.getByText("(consent.manage)", { exact: false }),
  ).toBeVisible();
});

test("consent screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await mockConsentRecords(page);

  await page.goto("/consent");
  await expect(page.getByRole("cell", { name: "MARKETING" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
