import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ME_BASE = {
  id: "user-1",
  email: "dpo@ibms.test",
  fullName: "Data Protection Officer",
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

const SCHEDULE = [
  {
    id: "rsi-1",
    recordCategory: "AuditLogEntry",
    retentionPeriodMonths: 120,
    legalBasis: "DRAFT, unconfirmed.",
    confirmedByLegalCounselAt: null,
    isConfirmed: false,
  },
];

const HOLDS = [
  {
    id: "lh-1",
    scope: "Customer XYZ file — litigation ABC-2026-123",
    reason: "Active litigation pending discovery.",
    placedAt: "2026-09-01T00:00:00.000Z",
    nextReviewDueAt: "2027-03-01T00:00:00.000Z",
    releasedAt: null,
    retentionScheduleItemId: "rsi-1",
    customerId: null,
    insuredPersonId: null,
    isActive: true,
  },
  {
    id: "lh-2",
    scope: "Litigation hold on a named customer",
    reason: "Active litigation pending discovery.",
    placedAt: "2026-09-01T00:00:00.000Z",
    nextReviewDueAt: "2027-03-01T00:00:00.000Z",
    releasedAt: null,
    retentionScheduleItemId: null,
    customerId: "cust-12345678-e2e",
    insuredPersonId: null,
    isActive: true,
  },
];

const BATCHES = [
  {
    id: "db-1",
    retentionScheduleItemId: "rsi-1",
    status: "DPO_APPROVED",
    nominatedByUserId: "user-2",
    managerApprovedAt: "2026-09-05T00:00:00.000Z",
    dpoApprovedByUserId: "user-1",
    dpoApprovedAt: "2026-09-06T00:00:00.000Z",
    method: null,
    executedAt: null,
    slaDueAt: "2026-10-06T00:00:00.000Z",
    createdAt: "2026-09-04T00:00:00.000Z",
    hasCertificateOfDestruction: false,
  },
];

async function mockRegister(
  page: Page,
  opts: { scheduleStatus?: number } = {},
) {
  await page.route("http://localhost:4000/retention-schedule**", (route) => {
    if (opts.scheduleStatus && opts.scheduleStatus !== 200) {
      return route.fulfill({
        status: opts.scheduleStatus,
        json: { message: "You do not hold a permission required to perform this action" },
      });
    }
    return route.fulfill({ status: 200, json: SCHEDULE });
  });
  await page.route("http://localhost:4000/legal-holds**", (route) =>
    route.fulfill({ status: 200, json: HOLDS }),
  );
  await page.route("http://localhost:4000/disposal-batches**", (route) =>
    route.fulfill({ status: 200, json: BATCHES }),
  );
}

test("lists the retention schedule, Legal Holds, and disposal batches with their per-row actions", async ({
  page,
}) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await mockRegister(page);

  await page.goto("/retention-disposal");
  await expect(
    page.getByRole("heading", { name: "Retention & Disposal" }),
  ).toBeVisible();

  await expect(page.getByRole("cell", { name: "AuditLogEntry" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm" })).toBeVisible();

  await expect(
    page.getByText("Customer XYZ file", { exact: false }),
  ).toBeVisible();
  // Two Legal Holds are fixtured (one bare, one naming a customer) — each
  // row gets its own Release/Record review pair.
  await expect(
    page.getByRole("button", { name: "Release" }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Record review" }).first(),
  ).toBeVisible();

  await expect(page.getByRole("cell", { name: "DPO_APPROVED" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Record execution" }),
  ).toBeVisible();
});

test("shows a Legal Hold's named subject and lets a DPO place a new hold naming a customer", async ({
  page,
}) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await mockRegister(page);

  await page.goto("/retention-disposal");
  await expect(page.getByText("Customer cust-123…")).toBeVisible();

  let lastCreateBody: Record<string, unknown> | null = null;
  await page.route("http://localhost:4000/legal-holds", (route) => {
    if (route.request().method() === "POST") {
      lastCreateBody = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({
        status: 201,
        json: {
          id: "lh-3",
          scope: "New hold",
          reason: "New reason",
          placedAt: "2026-09-07T00:00:00.000Z",
          nextReviewDueAt: "2027-03-07T00:00:00.000Z",
          releasedAt: null,
          retentionScheduleItemId: null,
          customerId: "cust-new",
          insuredPersonId: null,
          isActive: true,
        },
      });
    }
    return route.fulfill({ status: 200, json: HOLDS });
  });

  await page.getByLabel("Legal hold scope").fill("New hold");
  await page.getByLabel("Legal hold reason").fill("New reason");
  await page.getByLabel("Legal hold customer ID").fill("cust-new");
  await page.getByRole("button", { name: "Place hold" }).click();

  await expect.poll(() => lastCreateBody).not.toBeNull();
  expect(lastCreateBody).toMatchObject({
    scope: "New hold",
    reason: "New reason",
    customerId: "cust-new",
  });
});

test("a user without the schedule permission sees the underlying error message", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockRegister(page, { scheduleStatus: 403 });

  await page.goto("/retention-disposal");
  await expect(
    page.getByText("You do not hold a permission required", { exact: false }),
  ).toBeVisible();
});

test("retention-disposal screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await mockRegister(page);

  await page.goto("/retention-disposal");
  await expect(page.getByRole("cell", { name: "AuditLogEntry" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
