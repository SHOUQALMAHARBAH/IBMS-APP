import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";
import { expectNone } from "./support/anchored";

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
    route.fulfill({ status: 200, json: { ...ME_BASE, roles, permissions: permissionsForRoles(roles) } }),
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
    // `**` also matches `/dsr/dsr-1` and `/dsr/dsr-1/sla/pause`, so this default has to
    // step aside for the clock routes or it answers them with the LIST — which renders as
    // a screen that silently does nothing.
    const url = route.request().url();
    if (/\/dsr\/[^/?]+/.test(url)) return route.fallback();
    return route.fulfill({ status: 200, json: DSRS });
  });
}

/** The single-request read, which is the only one carrying `slaClock`, plus a capture of
 * the two clock writes. */
async function mockClock(
  page: Page,
  clock: { open: number; paused: number; pauseReason: string | null; pausedAt: string | null },
) {
  const calls: { url: string; body: unknown }[] = [];
  await page.route("http://localhost:4000/dsr/*/sla/*", (route) => {
    calls.push({
      url: route.request().url(),
      body: route.request().postDataJSON(),
    });
    return route.fulfill({
      status: 201,
      json: { paused: clock.open, alreadyPaused: 0, open: clock.open },
    });
  });
  await page.route("http://localhost:4000/dsr/*", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({ status: 200, json: { ...DSRS[0], slaClock: clock } });
  });
  return calls;
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
  await expect(page.getByRole("cell", { name: "In progress" })).toBeVisible();
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

/*
 * THE STATUTORY CLOCK, CONTROLLED FROM THE REQUEST — IMPROVEMENTS § 1.61.
 *
 * The owner's decision: the DPO holds `sla.timer.pause` and NOT `sla-dashboard.view`, so
 * the control moved to the request rather than the deadlines dashboard being opened up to
 * that role.
 */

test("the DPO can stop and restart a request's clock from the request", async ({
  page,
}) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await mockDsrs(page);
  const calls = await mockClock(page, {
    open: 4,
    paused: 0,
    pauseReason: null,
    pausedAt: null,
  });

  await page.goto("/dsr");
  await page.getByTestId("dsr-clock-open-dsr-1").click();

  // The COUNTS, not a word — a request carries four timers, and "paused" over a
  // two-of-four state is the reassuring lie this area keeps producing.
  await expect(page.getByTestId("dsr-clock-state-dsr-1")).toContainText(
    "0 of 4",
  );

  const pause = page.getByTestId("dsr-clock-pause-dsr-1");
  // NINE characters, not zero: a test that types nothing cannot tell a ten-character
  // floor from a non-empty check.
  await page.getByTestId("dsr-clock-reason-dsr-1").fill("Nine char");
  await expect(pause).toBeDisabled();
  expect(calls).toHaveLength(0);

  await page
    .getByTestId("dsr-clock-reason-dsr-1")
    .fill("  Waiting for the identity documents the subject was asked for  ");
  await expect(pause).toBeEnabled();
  await pause.click();

  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0].url).toContain("/dsr/dsr-1/sla/pause");
  expect(calls[0].body).toEqual({
    reason: "Waiting for the identity documents the subject was asked for",
  });
});

test("offers RESTART, not stop, on a request whose clock is already paused", async ({
  page,
}) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await mockDsrs(page);
  const calls = await mockClock(page, {
    open: 4,
    paused: 4,
    pauseReason: "Awaiting documents from the subject",
    pausedAt: "2026-09-28T00:00:00.000Z",
  });

  await page.goto("/dsr");
  await page.getByTestId("dsr-clock-open-dsr-1").click();

  // The stated basis is readable afterwards, which is the only thing that makes a
  // mandatory reason worth collecting.
  await expect(page.getByTestId("dsr-clock-state-dsr-1")).toContainText(
    "Awaiting documents",
  );
  const resume = page.getByTestId("dsr-clock-resume-dsr-1");
  await expect(resume).toBeEnabled();
  await expect(page.getByTestId("dsr-clock-pause-dsr-1")).toHaveCount(0);

  await resume.click();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0].url).toContain("/sla/resume");
});

test("the DPO still cannot open the deadlines dashboard", async ({ page }) => {
  // THE SECOND HALF OF THE OWNER'S ACCEPTANCE, asserted explicitly. A test that only
  // proved the button works would pass equally on the version that ALSO handed this role
  // the whole office's dashboard — which is the thing the decision refused.
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await mockDsrs(page);
  await mockClock(page, { open: 4, paused: 0, pauseReason: null, pausedAt: null });
  // The dashboard's own reads answer 403 for this role, which is what the API does.
  await page.route("http://localhost:4000/sla-dashboard/**", (route) =>
    route.fulfill({ status: 403, json: { message: "no" } }),
  );

  // Anchor: the role really can work the request, so the refusal below is about the
  // dashboard and not about a broken session.
  await page.goto("/dsr");
  await expect(page.getByTestId("dsr-clock-open-dsr-1")).toBeEnabled();

  // NO NAV DESTINATION TO IT — asserted on the HREF, not on the accessible role name.
  //
  // My first version used `getByRole('link', { name: 'SLA dashboard' })` and it could
  // NEVER fail: the nav group is collapsed, so the anchor is outside the accessibility
  // tree and `getByRole` finds nothing whether the grant exists or not. Measured with the
  // grant planted in: byRole=0, byHref=1. Planting `sla-dashboard.view` onto this role
  // left all 8 tests green — exactly the hole the owner named, in the test written to
  // close it.
  //
  // `expectNone` takes a REQUIRED anchor for the same family of reason: an absence
  // assertion that runs before hydration is satisfied by a blank page.
  await expectNone(
    page.locator('a[href="/sla-dashboard"]'),
    page.locator('a[href="/dsr"]'),
  );

  // ...and typing the URL is refused rather than rendering the office's deadlines.
  await page.goto("/sla-dashboard");
  await expect(
    page.getByText("sla-dashboard.view", { exact: false }),
  ).toBeVisible();
});

test("a role that can handle requests but cannot pause sees no clock control", async ({
  page,
}) => {
  // COMPLIANCE_OFFICER holds `sla.timer.pause`; a Sales Officer holds neither that nor
  // `dsr.handle`. The control is gated on the PAUSE permission and not on `dsr.handle`,
  // because stopping a compliance clock is the same act here as anywhere else.
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockDsrs(page);
  await mockClock(page, { open: 4, paused: 0, pauseReason: null, pausedAt: null });

  await page.goto("/dsr");
  // Anchor: the list rendered for this reader before asserting the absence.
  await expect(page.getByText("ACCESS", { exact: false }).first()).toBeVisible();
  await expect(page.getByTestId("dsr-clock-open-dsr-1")).toHaveCount(0);
});

test("a CLOSED request offers no clock control", async ({ page }) => {
  // Its clock has already stopped; the server refuses a pause on one, so offering the
  // control would be offering an action that cannot succeed.
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await mockDsrs(page);
  await mockClock(page, { open: 0, paused: 0, pauseReason: null, pausedAt: null });

  await page.goto("/dsr");
  await expect(page.getByTestId("dsr-clock-open-dsr-1")).toBeEnabled();
  await expect(page.getByTestId("dsr-clock-open-dsr-2")).toHaveCount(0);
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
