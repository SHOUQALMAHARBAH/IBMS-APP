import { expect, test, type Page } from "@playwright/test";

// Part F — Bilingual UI (backlog Part 11), item #3: "Bidirectional (bidi)
// text handling for mixed-content fields" — e.g. an Arabic customer name, an
// Arabic insurance-line label sitting next to a Latin policy number, or a
// name/address a user might type in either script. The fix wraps each such
// dynamically-rendered value in a native <bdi> element (which isolates its
// bidi runs from surrounding text and auto-detects its own direction) and
// sets dir="auto" on the matching capture <input>s. Unlike item #2's layout
// mirroring, there is no bounding-box signal to assert here — the browser's
// own Unicode bidi implementation is not under test, only OUR markup is:
// did we actually apply the isolation mechanism, not just render the text.

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
    route.fulfill({ status: 200, json: { ...ME_BASE, roles } }),
  );
}

test("a customer's legal name renders inside a real <bdi> isolate, not a plain text node", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  const legalName = "شركة الأفق للتأمين Al-Ufuq Insurance Co.";
  const customer = {
    id: "cust-1",
    prospectId: null,
    customerType: "CORPORATE",
    legalName,
    registrationNumber: "12345",
    taxRegistrationNumber: null,
    registeredAddress: "شارع الملكة رانيا، عمّان Building 12",
    natureOfBusiness: "Insurance",
    languagePreference: "AR",
    status: "ACTIVE",
    classification: "CONFIDENTIAL",
    ownerUserId: "user-1",
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
    nationalId: null,
    contactPhone: "***-7890",
    contactEmail: "***@example.test",
  };
  await page.route("http://localhost:4000/customers/cust-1", (route) =>
    route.fulfill({ status: 200, json: customer }),
  );
  await page.route("http://localhost:4000/customers/cust-1/ubos", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route(
    "http://localhost:4000/customers/cust-1/documents",
    (route) => route.fulfill({ status: 200, json: [] }),
  );
  await page.route(
    "http://localhost:4000/consent-records**",
    (route) => route.fulfill({ status: 200, json: [] }),
  );
  await page.route(
    "http://localhost:4000/privacy-notices/current**",
    (route) => route.fulfill({ status: 200, json: { notice: null } }),
  );

  await page.goto("/customers/cust-1");

  const nameBdi = page.locator("bdi", { hasText: legalName }).first();
  await expect(nameBdi).toHaveText(legalName);
  await expect(nameBdi.evaluate((el) => el.tagName)).resolves.toBe("BDI");

  // The registered address is rendered through the same shared ProfileField
  // primitive — proving the fix was applied at the shared component, not
  // copy-pasted per field.
  const addressBdi = page.locator("bdi", { hasText: customer.registeredAddress }).first();
  await expect(addressBdi).toHaveText(customer.registeredAddress);
});

test("a policy number sitting next to an Arabic insurance-line label are each isolated separately", async ({
  page,
}) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  const insuranceLine = "تأمين السيارات الشامل";
  const policyNumber = "POL-2026-00123";
  const summary = {
    generatedAt: "2026-09-07T00:00:00.000Z",
    periodLabel: "2026-08",
    periodStart: "2026-08-01T00:00:00.000Z",
    periodEnd: "2026-09-01T00:00:00.000Z",
    renewalWindowDays: 90,
    activePoliciesCount: 240,
    expiringPoliciesCount: 18,
    newPoliciesIssuedCount: 12,
    cancelledPolicies: [
      {
        policyId: "pol-1",
        policyNumber,
        insuranceLine,
        reason: "Client sold the insured vehicle.",
        cancelledAt: "2026-08-15T00:00:00.000Z",
      },
    ],
  };
  await page.route("http://localhost:4000/dashboards/policy**", (route) =>
    route.fulfill({ status: 200, json: summary }),
  );

  await page.goto("/dashboards/policy");
  await expect(page.getByRole("heading", { name: "Policy Dashboard" })).toBeVisible();

  // Two adjacent values from different sources, joined only by DOM position
  // in the same row — each must be its OWN isolate, not one shared wrapper,
  // so the policy number's Latin/digit run never bleeds into the Arabic
  // line label's own direction (or vice versa).
  const lineBdi = page.locator("bdi", { hasText: insuranceLine }).first();
  const numberBdi = page.locator("bdi", { hasText: policyNumber }).first();
  // toHaveText's exact match (a plain string, not a regex) is what proves
  // these are two SEPARATE isolates rather than one shared wrapper around
  // both values — a combined wrapper's full text would be
  // "<line> · <number>", which would fail an exact match against either
  // value alone.
  await expect(lineBdi).toHaveText(insuranceLine);
  await expect(numberBdi).toHaveText(policyNumber);
  await expect(lineBdi.evaluate((el) => el.tagName)).resolves.toBe("BDI");
  await expect(numberBdi.evaluate((el) => el.tagName)).resolves.toBe("BDI");
});

test("a mixed-content name/address capture input lets the browser auto-detect direction", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("http://localhost:4000/vendors", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );

  await page.goto("/vendors");
  await expect(page.getByRole("heading", { name: "Vendors" })).toBeVisible();

  const nameInput = page.getByRole("textbox").first();
  await expect(nameInput).toHaveAttribute("dir", "auto");
});
