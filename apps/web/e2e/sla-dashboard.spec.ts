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

const SUMMARY = {
  generatedAt: "2026-09-04T09:00:00.000Z",
  dueSoonWindow: { value: 3, unit: "calendarDays" },
  totals: {
    total: 7,
    onTrack: 2,
    dueSoon: 1,
    breached: 1,
    escalated: 1,
    paused: 1,
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
      paused: 0,
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
      paused: 0,
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
      paused: 0,
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
    // The six fields the web interface used to drop silently. A mock that
    // approximates the endpoint's shape is how this project has crashed a page
    // three times; these are copied from `SlaTimerRow` in
    // apps/api/src/modules/sla-dashboard/sla-dashboard.config.ts.
    slaStatus: "BREACHED",
    remainingMs: -518400000,
    effectiveDueAt: "2026-08-25T00:00:00.000Z",
    pausedAt: null,
    pauseReason: null,
    isRegulatory: true,
    sourceType: "REGULATORY",
    policyCode: "CBJ-COMPLAINT-10BD",
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
    slaStatus: "BREACHED",
    remainingMs: -172800000,
    effectiveDueAt: "2026-09-02T00:00:00.000Z",
    pausedAt: null,
    pauseReason: null,
    isRegulatory: false,
    sourceType: "INTERNAL_POLICY",
    policyCode: "INT-COMPLAINT",
  },
  {
    // A STOPPED CLOCK. Past its original dueAt, so before the classifier was
    // made pause-aware this row arrived as `state: "breached"` and the screen
    // reported a breach that had not happened.
    id: "t-paused",
    entityType: "DataSubjectRequest",
    entityId: "dsr-9",
    workflowName: "dsr_access_deletion",
    baseWorkflowName: "dsr_access_deletion",
    label: "Data subject request",
    drafted: false,
    state: "paused",
    dueAt: "2026-09-01T00:00:00.000Z",
    escalatedAt: null,
    escalatedTo: null,
    resolvedAt: null,
    createdAt: "2026-08-18T00:00:00.000Z",
    ageDays: 17,
    overdueDays: null,
    slaStatus: "PAUSED",
    remainingMs: null,
    effectiveDueAt: "2026-09-07T00:00:00.000Z",
    pausedAt: "2026-08-30T00:00:00.000Z",
    pauseReason: "Awaiting the identity documents the subject was asked for",
    isRegulatory: true,
    sourceType: "REGULATORY",
    policyCode: "PDPL-DSR-30CD",
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
    page.getByText("(sla-dashboard.view)", { exact: false }),
  ).toBeVisible();
});

/*
 * PAUSING AND RESUMING ONE CLOCK — the web callers `POST /sla/timers/:id/pause`
 * and `/resume` never had (IMPROVEMENTS § 1.44). Money does not move here, but a
 * statutory deadline stops, which is why these rank immediately after the refund
 * disbursement among the unreachable routes.
 */

/** The request the screen actually sent, so an assertion is about the wire and
 * not about the button having been clickable. */
async function capturePauseCalls(page: Page) {
  const calls: { url: string; body: unknown }[] = [];
  await page.route("http://localhost:4000/sla/timers/**", (route) => {
    calls.push({
      url: route.request().url(),
      body: route.request().postDataJSON(),
    });
    return route.fulfill({
      status: 200,
      json: { id: "t-br", pausedAt: "2026-09-04T09:05:00.000Z", pausedTotalMs: 0 },
    });
  });
  return calls;
}

test("pauses a clock, refusing a reason below the ten-character floor", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockDashboard(page);
  const calls = await capturePauseCalls(page);

  await page.goto("/sla-dashboard");
  // Anchor: the row exists and its control is enabled BEFORE anything is
  // asserted about the form, or an unhydrated page satisfies the rest vacuously.
  const pauseButton = page.getByTestId("sla-pause-t-br");
  await expect(pauseButton).toBeEnabled();
  await pauseButton.click();

  const confirm = page.getByTestId("sla-pause-confirm-t-br");
  // NINE characters, not zero: a test that only types nothing cannot tell a
  // ten-character floor from a non-empty check.
  await page.getByTestId("sla-pause-reason-t-br").fill("Nine char");
  await expect(confirm).toBeDisabled();
  expect(calls).toHaveLength(0);

  await page
    .getByTestId("sla-pause-reason-t-br")
    .fill("   Insurer has asked for the loss adjuster report   ");
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0].url).toContain("/sla/timers/t-br/pause");
  // TRIMMED — the server counts what it receives, so the ten characters it
  // checks must be the ten the reader typed.
  expect(calls[0].body).toEqual({
    reason: "Insurer has asked for the loss adjuster report",
  });
});

test("a paused clock reads as paused, shows its stated basis, and offers resume", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockDashboard(page);
  const calls = await capturePauseCalls(page);

  await page.goto("/sla-dashboard");

  // The row says PAUSED. It is past its original deadline, and reporting it as
  // breached is exactly what this screen used to do.
  const row = page.getByRole("row", { name: /dsr-9/ });
  await expect(row).toContainText("Paused");
  await expect(row).not.toContainText("Breached");

  // The basis is visible, which is the only thing that makes the mandatory
  // reason worth collecting.
  await expect(page.getByTestId("sla-clock-t-paused")).toContainText(
    "Awaiting the identity documents",
  );

  // A paused row offers RESUME and not PAUSE. The enabled resume button is the
  // anchor for the absence assertion beside it.
  const resume = page.getByTestId("sla-resume-t-paused");
  await expect(resume).toBeEnabled();
  await expect(page.getByTestId("sla-pause-t-paused")).toHaveCount(0);

  await resume.click();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0].url).toContain("/sla/timers/t-paused/resume");
});

test("a regulatory deadline is marked as such, an internal one is not", async ({
  page,
}) => {
  // `isRegulatory` was among the six fields the web interface dropped, so this
  // screen reported breaches without being able to say whether what was
  // breached was the law.
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockDashboard(page);

  await page.goto("/sla-dashboard");
  await expect(page.getByTestId("sla-regulatory-t-esc")).toHaveText(
    "Regulatory",
  );
  // t-br is INTERNAL_POLICY: the marker must be absent, anchored on the
  // regulatory one above being present in the same render.
  await expect(page.getByTestId("sla-regulatory-t-br")).toHaveCount(0);
});

test("a reader without sla.timer.pause gets no pause control and is told why", async ({
  page,
}) => {
  // COMPLIANCE_OFFICER holds sla-dashboard.view AND sla.timer.pause; the
  // EXTERNAL_AUDITOR is the read-only reader of this screen, which is the state
  // that must not render a control that would 403.
  await mockAuth(page, ["EXTERNAL_AUDITOR"]);
  await mockDashboard(page);

  await page.goto("/sla-dashboard");
  // Anchor first: the timer list rendered for this reader.
  await expect(
    page.getByRole("cell", { name: "dsr-9", exact: false }),
  ).toBeVisible();
  await expect(page.getByTestId("sla-pause-t-br")).toHaveCount(0);
  await expect(page.getByTestId("sla-resume-t-paused")).toHaveCount(0);
  await expect(
    page.getByText("sla.timer.pause", { exact: false }),
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
