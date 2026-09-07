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

const INCIDENTS = [
  {
    id: "incident-1",
    title: "Ransomware on a claims workstation",
    description: "A claims officer opened a malicious attachment.",
    severity: "critical",
    status: "CLASSIFIED",
    reportedAt: "2026-09-06T09:00:00.000Z",
    containedAt: "2026-09-06T10:00:00.000Z",
    impactAssessedAt: "2026-09-06T10:30:00.000Z",
    classification: "MATERIAL",
    classifiedByDpoUserId: "user-1",
    seniorManagementCoSignUserId: null,
    seniorManagementNotifiedAt: null,
    notifiedRegulators: [],
    notifiedAt: null,
    affectedDataSubjectsNotifiedAt: null,
    rootCauseAnalysis: null,
    recoveredAt: null,
    closedAt: null,
    isContainmentOverdue: false,
  },
];

async function mockIncidents(page: Page, opts: { status?: number } = {}) {
  await page.route("http://localhost:4000/incidents**", (route) => {
    if (opts.status && opts.status !== 200) {
      return route.fulfill({ status: opts.status, json: { message: "no" } });
    }
    return route.fulfill({ status: 200, json: INCIDENTS });
  });
}

test("lists incidents with the classification state and the log form", async ({
  page,
}) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await mockIncidents(page);

  await page.goto("/incidents");
  await expect(
    page.getByRole("heading", { name: "Incident Management" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Ransomware on a claims workstation" }),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: "MATERIAL" })).toBeVisible();
  await expect(page.getByLabel("Incident title")).toBeVisible();
  await expect(page.getByRole("button", { name: "Report incident" })).toBeVisible();
  // A DPO can notify Senior Management, but co-signing is Executive
  // Management's own step — the DPO who classified it must not see a
  // Co-sign button that the server would always 403 anyway.
  await expect(
    page.getByRole("button", { name: "Notify Senior Management" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Co-sign (Senior Management)" }),
  ).not.toBeVisible();
});

test("only Executive Management sees the Co-sign control", async ({ page }) => {
  await mockAuth(page, ["EXECUTIVE_MANAGEMENT"]);
  await mockIncidents(page);

  await page.goto("/incidents");
  await expect(
    page.getByRole("cell", { name: "Ransomware on a claims workstation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Co-sign (Senior Management)" }),
  ).toBeVisible();
  // Classifying is the DPO's own step — Executive Management must not see
  // a Classify control the server would always 403.
  await expect(
    page.getByRole("button", { name: "Classify Material" }),
  ).not.toBeVisible();
});

test("a user without the permission sees a friendly message", async ({
  page,
}) => {
  await mockAuth(page, ["POLICY_CHECKING_OFFICER"]);
  await mockIncidents(page, { status: 403 });

  await page.goto("/incidents");
  await expect(
    page.getByText("incident.report permission", { exact: false }),
  ).toBeVisible();
});

test("incidents screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await mockIncidents(page);

  await page.goto("/incidents");
  await expect(
    page.getByRole("cell", { name: "Ransomware on a claims workstation" }),
  ).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
