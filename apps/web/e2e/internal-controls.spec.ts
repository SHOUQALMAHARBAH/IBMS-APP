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

const CLEAN_REPORT = {
  generatedAt: "2026-09-07T10:00:00.000Z",
  pairsScanned: 16,
  totalRowsChecked: 512,
  violations: [],
  byPair: [
    {
      entityType: "KYCRecord",
      pairLabel: "createdByUserId / approvedByUserId",
      rowsChecked: 40,
      violationCount: 0,
      dbCheckConstraint: "KYCRecord_maker_checker_distinct",
      dormant: false,
      truncated: false,
    },
    {
      entityType: "DisposalBatch",
      pairLabel: "nominatedByUserId / dpoApprovedByUserId",
      rowsChecked: 0,
      violationCount: 0,
      dbCheckConstraint: "DisposalBatch_maker_checker_distinct",
      dormant: true,
      truncated: false,
    },
  ],
};

const DIRTY_REPORT = {
  ...CLEAN_REPORT,
  violations: [
    {
      entityType: "PolicyChecking",
      pairLabel: "issuedByUserId (Policy) / checkedByUserId",
      entityId: "pc-1",
      makerField: "issuedByUserId",
      checkerField: "checkedByUserId",
      userId: "user-x",
      dbCheckConstraint: null,
    },
  ],
};

async function mockAudit(page: Page, opts: { status?: number; dirty?: boolean } = {}) {
  await page.route(
    "http://localhost:4000/internal-controls/self-approval-audit**",
    (route) => {
      if (opts.status && opts.status !== 200) {
        return route.fulfill({ status: opts.status, json: { message: "no" } });
      }
      return route.fulfill({
        status: 200,
        json: opts.dirty ? DIRTY_REPORT : CLEAN_REPORT,
      });
    },
  );
}

test("renders a clean audit with the per-pair breakdown", async ({ page }) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockAudit(page);

  await page.goto("/internal-controls");
  await expect(
    page.getByRole("heading", { name: "Internal controls — self-approval audit" }),
  ).toBeVisible();
  await expect(page.getByText("None")).toBeVisible();
  await expect(page.getByRole("cell", { name: "KYCRecord", exact: true })).toBeVisible();
  await expect(page.getByText("(dormant)")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Self-approval violations found" }),
  ).not.toBeVisible();
});

test("surfaces a detected violation prominently", async ({ page }) => {
  await mockAuth(page, ["EXECUTIVE_MANAGEMENT"]);
  await mockAudit(page, { dirty: true });

  await page.goto("/internal-controls");
  await expect(
    page.getByRole("heading", { name: "Self-approval violations found" }),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: "pc-1" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "user-x" })).toBeVisible();
});

test("a user without the permission sees a friendly message", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockAudit(page, { status: 403 });

  await page.goto("/internal-controls");
  await expect(
    page.getByText("internal-controls.audit permission", { exact: false }),
  ).toBeVisible();
});

test("internal-controls screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockAudit(page);

  await page.goto("/internal-controls");
  await expect(page.getByRole("cell", { name: "KYCRecord", exact: true })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
