import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ME_BASE = {
  id: "user-1",
  email: "mgr@ibms.test",
  fullName: "Branch Manager",
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

const COMPLAINTS = [
  {
    id: "c-1",
    customerId: "11111111-1111-1111-1111-111111111111",
    claimId: "claim-1",
    policyId: null,
    issue: "The settlement was 200 JOD below the assessed amount",
    category: "denied_claim",
    status: "ESCALATED",
    isClosed: false,
    responsibleEmployeeUserId: "u-claims",
    resolution: null,
    resolvedByUserId: null,
    closureApprovedByUserId: null,
    closedAt: null,
    sla: {
      timerId: "sla-1",
      dueAt: "2026-09-17T00:00:00.000Z",
      escalatedAt: null,
      escalatedTo: "BRANCH_DEPARTMENT_MANAGER",
      resolvedAt: "2026-09-15T00:00:00.000Z",
      breached: false,
    },
    actions: [
      {
        id: "a-1",
        actionText: "Asked the insurer to re-review",
        takenByUserId: "u-claims",
        takenAt: "2026-09-05T00:00:00.000Z",
      },
    ],
    escalations: [
      {
        id: "e-1",
        escalatedTo: "dispute_resolution_committee",
        escalatedByUserId: "u-comp",
        reason: "Insurer non-response after 20 business days",
        escalatedAt: "2026-09-14T00:00:00.000Z",
      },
    ],
    createdAt: "2026-09-03T09:00:00.000Z",
  },
];

async function mockComplaints(page: Page, opts: { status?: number } = {}) {
  await page.route("http://localhost:4000/complaints**", (route) => {
    if (opts.status && opts.status !== 200) {
      return route.fulfill({ status: opts.status, json: { message: "no" } });
    }
    return route.fulfill({ status: 200, json: COMPLAINTS });
  });
}

test("lists complaints with SLA + escalation state and the log form", async ({
  page,
}) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await mockComplaints(page);

  await page.goto("/complaints");
  await expect(
    page.getByRole("heading", { name: "Complaints" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", {
      name: "The settlement was 200 JOD below the assessed amount",
    }),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: "ESCALATED" })).toBeVisible();
  await expect(page.getByLabel("Category")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Log complaint" }),
  ).toBeVisible();
  // ESCALATED + Manager -> Start, Resolve visible
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resolve" })).toBeVisible();
});

test("a user without the permission sees a friendly message", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockComplaints(page, { status: 403 });

  await page.goto("/complaints");
  await expect(
    page.getByText("complaint.log permission", { exact: false }),
  ).toBeVisible();
});

test("complaints screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await mockComplaints(page);

  await page.goto("/complaints");
  await expect(
    page.getByRole("cell", {
      name: "The settlement was 200 JOD below the assessed amount",
    }),
  ).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
