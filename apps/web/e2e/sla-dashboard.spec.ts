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

const SUMMARY = {
  generatedAt: "2026-09-04T09:00:00.000Z",
  dueSoonWindow: { value: 3, unit: "calendarDays" },
  totals: {
    total: 7,
    onTrack: 2,
    dueSoon: 1,
    breached: 1,
    escalated: 1,
    resolvedOnTime: 1,
    resolvedLate: 1,
    openBreached: 2,
    breachRate: "0.6000",
  },
  byWorkflow: [
    {
      workflowName: "complaint_resolution",
      label: "Customer complaint resolution",
      entityType: "Complaint",
      drafted: true,
      configuredDuration: { value: 10, unit: "businessDays" },
      total: 4,
      onTrack: 1,
      dueSoon: 0,
      breached: 1,
      escalated: 1,
      resolvedOnTime: 0,
      resolvedLate: 1,
      openBreached: 2,
      entityCount: 4,
      oldestOverdueDays: 6,
    },
    {
      workflowName: "quarterly_access_review",
      label: "Quarterly access review",
      entityType: "AccessRecertificationCycle",
      drafted: false,
      configuredDuration: { value: 15, unit: "businessDays" },
      total: 3,
      onTrack: 1,
      dueSoon: 1,
      breached: 0,
      escalated: 0,
      resolvedOnTime: 1,
      resolvedLate: 0,
      openBreached: 0,
      entityCount: 3,
      oldestOverdueDays: null,
    },
  ],
  byEntityType: [
    {
      entityType: "Complaint",
      total: 4,
      onTrack: 1,
      dueSoon: 0,
      breached: 1,
      escalated: 1,
      resolvedOnTime: 0,
      resolvedLate: 1,
      openBreached: 2,
      entityCount: 4,
      oldestOverdueDays: 6,
    },
  ],
  byEscalationTarget: [
    {
      escalatedTo: "BRANCH_DEPARTMENT_MANAGER",
      open: 3,
      openBreached: 2,
      oldestOverdueDays: 6,
    },
  ],
};

const TIMERS = [
  {
    id: "t-esc",
    entityType: "Complaint",
    entityId: "cmp-1",
    workflowName: "complaint_resolution",
    baseWorkflowName: "complaint_resolution",
    label: "Customer complaint resolution",
    drafted: true,
    state: "escalated",
    dueAt: "2026-08-25T00:00:00.000Z",
    escalatedAt: "2026-09-01T00:00:00.000Z",
    escalatedTo: "BRANCH_DEPARTMENT_MANAGER",
    resolvedAt: null,
    createdAt: "2026-08-10T00:00:00.000Z",
    ageDays: 25,
    overdueDays: 6,
  },
  {
    id: "t-br",
    entityType: "Complaint",
    entityId: "cmp-2",
    workflowName: "complaint_resolution",
    baseWorkflowName: "complaint_resolution",
    label: "Customer complaint resolution",
    drafted: true,
    state: "breached",
    dueAt: "2026-09-02T00:00:00.000Z",
    escalatedAt: null,
    escalatedTo: "BRANCH_DEPARTMENT_MANAGER",
    resolvedAt: null,
    createdAt: "2026-08-20T00:00:00.000Z",
    ageDays: 15,
    overdueDays: 2,
  },
];

async function mockDashboard(page: Page, opts: { status?: number } = {}) {
  await page.route("http://localhost:4000/sla-dashboard/summary**", (route) => {
    if (opts.status && opts.status !== 200) {
      return route.fulfill({ status: opts.status, json: { message: "no" } });
    }
    return route.fulfill({ status: 200, json: SUMMARY });
  });
  await page.route("http://localhost:4000/sla-dashboard/timers**", (route) => {
    if (opts.status && opts.status !== 200) {
      return route.fulfill({ status: opts.status, json: { message: "no" } });
    }
    return route.fulfill({ status: 200, json: TIMERS });
  });
}

test("renders the summary stats, the by-workflow table and the timer list", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockDashboard(page);

  await page.goto("/sla-dashboard");
  await expect(
    page.getByRole("heading", { name: "SLA dashboard" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "By workflow" })).toBeVisible();
  await expect(page.getByText("60.0%")).toBeVisible(); // breach rate

  await expect(
    page.getByRole("cell", { name: "Quarterly access review" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Customer complaint resolution", exact: true }),
  ).toHaveCount(2); // by-workflow row + at least one timer row
  await expect(page.getByRole("cell", { name: "cmp-1", exact: false })).toBeVisible();
});

test("a user without the permission sees a friendly message", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockDashboard(page, { status: 403 });

  await page.goto("/sla-dashboard");
  await expect(
    page.getByText("sla-dashboard.view permission", { exact: false }),
  ).toBeVisible();
});

test("sla-dashboard screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockDashboard(page);

  await page.goto("/sla-dashboard");
  await expect(
    page.getByRole("cell", { name: "Quarterly access review" }),
  ).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
