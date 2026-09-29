import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";

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
    route.fulfill({
      status: 200,
      json: { ...ME_BASE, roles, permissions: permissionsForRoles(roles) },
    }),
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
    // The endpoint returns this now. Null: nothing has approved this complaint's closure.
    closureCombinedDutyAct: null,
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

async function mockComplaints(
  page: Page,
  opts: { status?: number; complaints?: unknown[] } = {},
) {
  await page.route("http://localhost:4000/complaints**", (route) => {
    if (opts.status && opts.status !== 200) {
      return route.fulfill({ status: opts.status, json: { message: "no" } });
    }
    return route.fulfill({ status: 200, json: opts.complaints ?? COMPLAINTS });
  });
}

test("lists complaints with SLA + escalation state and the log form", async ({
  page,
}) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await mockComplaints(page);

  await page.goto("/complaints");
  await expect(page.getByRole("heading", { name: "Complaints" })).toBeVisible();
  await expect(
    page.getByRole("cell", {
      name: "The settlement was 200 JOD below the assessed amount",
    }),
  ).toBeVisible();
  // The status column now renders a label, not the raw enum token
  // (directive §2). Asserting "Escalated" rather than "ESCALATED" is the
  // point of the change, not an accommodation to it.
  await expect(page.getByRole("cell", { name: "Escalated" })).toBeVisible();
  // `exact` matters: getByRole name matching is case-INSENSITIVE by default,
  // so a bare "ESCALATED" would still match the "Escalated" label and this
  // assertion would prove nothing.
  await expect(
    page.getByRole("cell", { name: "ESCALATED", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Category")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Log complaint" }),
  ).toBeVisible();
  // ESCALATED + Manager -> Start, Resolve visible
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resolve" })).toBeVisible();
});

test("downloads a bilingual acknowledgement PDF for a permitted user", async ({
  page,
}) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await mockComplaints(page);
  await page.route(
    "http://localhost:4000/complaints/c-1/acknowledgement**",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/pdf",
        body: Buffer.from("%PDF-1.4 fake"),
      }),
  );

  await page.goto("/complaints");
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download acknowledgement (PDF)" })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "complaint-acknowledgement-c-1.pdf",
  );
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

/*
 * THE COMBINED-DUTY ACT ON A COMPLAINT — Part 4 step 5.
 *
 * `Complaint_closure_maker_checker_distinct` requires that whoever RESOLVES a complaint is not whoever
 * approves its closure. **A closed complaint is the record a regulator reads to see the office answered
 * its customer** — and the status cell reads CLOSED whether one person or two signed it off, which is
 * why the ordinary-case test asserts CLOSED IS shown rather than asserting silence alone.
 */

/** Resolved AND closure-approved by the same person, with the reason they gave. */
const SELF_CLOSED = {
  ...COMPLAINTS[0],
  id: "c-9",
  status: "CLOSED",
  isClosed: true,
  resolution: "Insurer re-reviewed and paid the 200 JOD difference.",
  resolvedByUserId: "user-1",
  closureApprovedByUserId: "user-1",
  closureCombinedDutyAct: {
    id: "cda-c-1",
    at: "2026-09-16T00:00:00.000Z",
    actorUserId: "user-1",
    reason:
      "Sole officer covering customer service that week; the SLA deadline fell inside it.",
    pair: "Complaint_closure_maker_checker_distinct",
    roles: ["BRANCH_DEPARTMENT_MANAGER"],
    hatAmbiguous: false,
  },
  closedAt: "2026-09-16T00:00:00.000Z",
};

test("shows that one person both resolved and closed a complaint, and why", async ({
  page,
}) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await mockComplaints(page, { complaints: [SELF_CLOSED] });

  await page.goto("/complaints");
  const declared = page.getByTestId("combined-duty-complaint-c-9");
  await expect(declared).toContainText("BRANCH_DEPARTMENT_MANAGER");
  await expect(declared).toContainText(
    "Sole officer covering customer service",
  );
  // Tied to the database rule it excuses, so the record and the constraint cannot drift apart.
  await expect(declared).toHaveAttribute(
    "data-combined-duty-pair",
    "Complaint_closure_maker_checker_distinct",
  );
});

test("prints Closed and declares nothing when two people signed the closure off", async ({
  page,
}) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await mockComplaints(page, {
    // Resolved by one person, closure-approved by ANOTHER — the ordinary case.
    complaints: [
      {
        ...SELF_CLOSED,
        id: "c-10",
        closureApprovedByUserId: "user-9",
        closureCombinedDutyAct: null,
      },
    ],
  });

  await page.goto("/complaints");
  // The POSITIVE claim is the anchor: the cell reads Closed, which is true of a two-person closure.
  // Asserting silence alone would pass on a cell that had stopped rendering the declaration at all.
  await expect(
    page.getByRole("cell", { name: "Closed", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("combined-duty-complaint-c-10")).toHaveCount(0);
});
