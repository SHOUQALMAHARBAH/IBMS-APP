import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

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
    route.fulfill({ status: 200, json: { ...ME_BASE, roles } }),
  );
}

const REQUESTS = [
  {
    id: "sr-1",
    customerId: "11111111-1111-1111-1111-111111111111",
    policyId: null,
    requestType: "certificate",
    detail: "Certificate of insurance for the landlord",
    status: "in_progress",
    isClosed: false,
    raisedByUserId: "u-sales",
    assignedToUserId: "u-mgr",
    fulfilledByUserId: null,
    outcomeNote: null,
    sla: {
      timerId: "sla-1",
      dueAt: "2026-09-10T00:00:00.000Z",
      escalatedAt: null,
      escalatedTo: "BRANCH_DEPARTMENT_MANAGER",
      resolvedAt: null,
      breached: true,
    },
    createdAt: "2026-09-03T09:00:00.000Z",
    closedAt: null,
  },
];

async function mockRequests(page: Page, opts: { status?: number } = {}) {
  await page.route("http://localhost:4000/service-requests**", (route) => {
    if (opts.status && opts.status !== 200) {
      return route.fulfill({ status: opts.status, json: { message: "no" } });
    }
    return route.fulfill({ status: 200, json: REQUESTS });
  });
}

test("lists service requests with their SLA state and the log form", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockRequests(page);

  await page.goto("/service-requests");
  await expect(
    page.getByRole("heading", { name: "Customer requests" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Certificate of insurance for the landlord" }),
  ).toBeVisible();
  await expect(page.getByText("BREACHED", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Request type")).toBeVisible();
  await expect(page.getByRole("button", { name: "Log request" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fulfil" })).toBeVisible();
});

test("a user without the permission sees a friendly message", async ({
  page,
}) => {
  await mockAuth(page, ["CLAIMS_OFFICER"]);
  await mockRequests(page, { status: 403 });

  await page.goto("/service-requests");
  await expect(
    page.getByText("service-request.manage permission", { exact: false }),
  ).toBeVisible();
});

test("customer-requests screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockRequests(page);

  await page.goto("/service-requests");
  await expect(
    page.getByRole("cell", { name: "Certificate of insurance for the landlord" }),
  ).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
