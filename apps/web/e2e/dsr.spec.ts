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

const DSRS = [
  {
    id: "dsr-1",
    customerId: "11111111-1111-1111-1111-111111111111",
    insuredPersonId: null,
    type: "ACCESS",
    status: "IN_PROGRESS",
    receivedAt: "2026-09-01T09:00:00.000Z",
    identityVerifiedAt: "2026-09-01T10:00:00.000Z",
    slaDueAt: "2026-09-22T00:00:00.000Z",
    accessExtensionAppliedAt: null,
    extensionReason: null,
    retentionScheduleReference: null,
    partialFulfilmentJustification: null,
    closedAt: null,
    dpoHandlerUserId: "user-1",
    processedByUserId: null,
    closedByUserId: null,
    rejectionReason: null,
    isOverdue: false,
    createdAt: "2026-09-01T09:00:00.000Z",
  },
  {
    id: "dsr-2",
    customerId: "22222222-2222-2222-2222-222222222222",
    insuredPersonId: null,
    type: "DELETION",
    status: "CLOSED",
    receivedAt: "2026-08-01T09:00:00.000Z",
    identityVerifiedAt: "2026-08-01T10:00:00.000Z",
    slaDueAt: "2026-08-22T00:00:00.000Z",
    accessExtensionAppliedAt: null,
    extensionReason: null,
    retentionScheduleReference: "RSI-2026-001",
    partialFulfilmentJustification: "7-year retention still open.",
    closedAt: "2026-08-20T00:00:00.000Z",
    dpoHandlerUserId: "user-2",
    processedByUserId: "user-2",
    closedByUserId: "user-3",
    rejectionReason: null,
    isOverdue: false,
    createdAt: "2026-08-01T09:00:00.000Z",
  },
];

async function mockDsrs(page: Page, opts: { status?: number } = {}) {
  await page.route("http://localhost:4000/dsr**", (route) => {
    if (opts.status && opts.status !== 200) {
      return route.fulfill({ status: opts.status, json: { message: "no" } });
    }
    return route.fulfill({ status: 200, json: DSRS });
  });
}

test("lists Data Subject Requests with SLA state and the log form", async ({
  page,
}) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await mockDsrs(page);

  await page.goto("/dsr");
  await expect(
    page.getByRole("heading", { name: "Data Subject Requests" }),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: "ACCESS" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "IN_PROGRESS" })).toBeVisible();
  await expect(page.getByLabel("Type")).toBeVisible();
  await expect(page.getByRole("button", { name: "Log request" })).toBeVisible();
  // IN_PROGRESS + DPO -> Fulfil / Partially fulfil / Reject / Assign visible;
  // the already-CLOSED row shows no actions
  await expect(
    page.getByRole("button", { name: "Fulfil", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Partially fulfil" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Reject" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Apply +15 day extension" }),
  ).toBeVisible();
});

test("a user without the permission sees a friendly message", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockDsrs(page, { status: 403 });

  await page.goto("/dsr");
  await expect(
    page.getByText("dsr.log permission", { exact: false }),
  ).toBeVisible();
});

test("dsr screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await mockDsrs(page);

  await page.goto("/dsr");
  await expect(page.getByRole("cell", { name: "ACCESS" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
