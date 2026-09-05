import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

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
    route.fulfill({ status: 200, json: { ...ME_BASE, roles } }),
  );
}

const RISKS = [
  {
    id: "risk-1",
    riskType: "cyber",
    description: "A phishing email reached three staff mailboxes.",
    mitigationAction: null,
    status: "open",
    loggedAt: "2026-09-01T09:00:00.000Z",
    closedAt: null,
  },
];

const POLICIES = [
  {
    id: "pi-1",
    insurerName: "Jordan Insurance Co.",
    coverageLimit: "1000000.000",
    expiresAt: "2027-01-01T00:00:00.000Z",
    claimsHistorySummary: "No claims to date.",
    isCurrentlyLapsed: false,
    isCurrent: true,
  },
];

const EVENTS = [
  {
    id: "event-1",
    piPolicyId: "pi-1",
    sourcePolicyCheckingId: "check-1",
    description: "Requested Sum Insured did not match amount sent to insurer.",
    mitigationAction: null,
    loggedAt: "2026-09-01T09:00:00.000Z",
    isAutoLogged: true,
  },
];

async function mockData(page: Page, opts: { status?: number } = {}) {
  await page.route("http://localhost:4000/risk-register**", (route) => {
    if (opts.status && opts.status !== 200) {
      return route.fulfill({ status: opts.status, json: { message: "no" } });
    }
    return route.fulfill({ status: 200, json: RISKS });
  });
  await page.route("http://localhost:4000/pi-policy**", (route) => {
    if (opts.status && opts.status !== 200) {
      return route.fulfill({ status: opts.status, json: { message: "no" } });
    }
    return route.fulfill({ status: 200, json: POLICIES });
  });
  await page.route("http://localhost:4000/pi-risk-events**", (route) => {
    if (opts.status && opts.status !== 200) {
      return route.fulfill({ status: opts.status, json: { message: "no" } });
    }
    return route.fulfill({ status: 200, json: EVENTS });
  });
}

test("lists risk register items, PI policy, and PI risk events with their forms", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockData(page);

  await page.goto("/operational-pi-risk");
  await expect(
    page.getByRole("heading", { name: "Operational & Professional Indemnity Risk" }),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: "cyber" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Jordan Insurance Co." })).toBeVisible();
  await expect(
    page.getByRole("cell", {
      name: "Requested Sum Insured did not match amount sent to insurer.",
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Risk type")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Log risk", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Log PI policy" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Log risk event" })).toBeVisible();
});

test("a user without the permission sees a friendly message", async ({ page }) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockData(page, { status: 403 });

  await page.goto("/operational-pi-risk");
  await expect(
    page.getByText("risk-register.manage permission", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("pi-policy.manage permission", { exact: false }).first(),
  ).toBeVisible();
});

test("operational/PI risk screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockData(page);

  await page.goto("/operational-pi-risk");
  await expect(page.getByRole("cell", { name: "cyber" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
