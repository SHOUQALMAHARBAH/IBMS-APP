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

const FINDINGS = [
  {
    id: "finding-1",
    auditPeriodLabel: "Q3 2026 Internal Audit",
    finding: "Two officers shared a login during a system outage.",
    remediationAction: null,
    status: "open",
    loggedAt: "2026-09-01T09:00:00.000Z",
    closedAt: null,
  },
];

async function mockFindings(page: Page, opts: { status?: number } = {}) {
  await page.route("http://localhost:4000/internal-audit-findings**", (route) => {
    if (opts.status && opts.status !== 200) {
      return route.fulfill({ status: opts.status, json: { message: "no" } });
    }
    return route.fulfill({ status: 200, json: FINDINGS });
  });
}

test("lists internal audit findings with the record form for Compliance", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockFindings(page);

  await page.goto("/internal-audit-findings");
  await expect(
    page.getByRole("heading", { name: "Internal Audit Findings" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Q3 2026 Internal Audit" }),
  ).toBeVisible();
  await expect(page.getByLabel("Audit period")).toBeVisible();
  await expect(page.getByRole("button", { name: "Record finding" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save remediation" })).toBeVisible();
});

test("a Branch/Department Manager can see and close a finding but not record one", async ({
  page,
}) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await mockFindings(page);

  await page.goto("/internal-audit-findings");
  await expect(
    page.getByRole("cell", { name: "Q3 2026 Internal Audit" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Close" })).toBeVisible();
  await expect(page.getByLabel("Audit period")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Save remediation" })).not.toBeVisible();
});

test("a user without the permission sees a friendly message", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockFindings(page, { status: 403 });

  await page.goto("/internal-audit-findings");
  await expect(
    page.getByText("internal-audit.record/internal-audit.close permission", {
      exact: false,
    }),
  ).toBeVisible();
});

test("internal audit findings screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockFindings(page);

  await page.goto("/internal-audit-findings");
  await expect(
    page.getByRole("cell", { name: "Q3 2026 Internal Audit" }),
  ).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
