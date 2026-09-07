import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ME_BASE = {
  id: "user-1",
  email: "auditor@ibms.test",
  fullName: "External Auditor",
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

const AUDIT_ROWS = [
  {
    id: "audit-1",
    userId: "user-2",
    action: "TRANSITION",
    entityType: "Lead",
    entityId: "lead-1",
    beforeValue: { status: "NEW" },
    afterValue: { status: "CONTACTED" },
    isSensitiveDataAccess: false,
    occurredAt: "2026-09-07T09:00:00.000Z",
  },
];

const DOCUMENT_HISTORY = {
  requestedDocumentId: "doc-1",
  versions: [
    {
      id: "doc-1",
      versionNumber: 1,
      fileName: "policy-schedule.pdf",
      category: "POLICY",
      classification: "CONFIDENTIAL",
      uploadedByUserId: "user-2",
      deletionLocked: true,
      deletionOverrideByUserId: null,
      createdAt: "2026-09-01T00:00:00.000Z",
      isRequestedVersion: true,
    },
  ],
  auditTrail: AUDIT_ROWS,
};

test("browses the audit log, looks up workflow history, and looks up document history", async ({
  page,
}) => {
  await mockAuth(page, ["EXTERNAL_AUDITOR"]);
  await page.route("http://localhost:4000/audit-trail?**", (route) =>
    route.fulfill({ status: 200, json: AUDIT_ROWS }),
  );
  await page.route("http://localhost:4000/audit-trail/workflow-history**", (route) =>
    route.fulfill({ status: 200, json: AUDIT_ROWS }),
  );
  await page.route("http://localhost:4000/audit-trail/documents/*/history", (route) =>
    route.fulfill({ status: 200, json: DOCUMENT_HISTORY }),
  );

  await page.goto("/audit-trail");
  await expect(page.getByRole("heading", { name: "Audit Trail" })).toBeVisible();

  await page.getByLabel("Entity type").first().fill("Lead");
  await page.getByRole("button", { name: "Browse" }).click();
  await expect(page.getByRole("cell", { name: "TRANSITION" }).first()).toBeVisible();

  await page.getByLabel("Workflow entity type").fill("Lead");
  await page.getByLabel("Workflow entity id").fill("lead-1");
  await page.getByRole("button", { name: "Look up" }).first().click();
  await expect(page.getByText("lead-1").first()).toBeVisible();

  await page.getByLabel("Document id").fill("doc-1");
  await page.getByRole("button", { name: "Look up" }).nth(1).click();
  await expect(page.getByRole("cell", { name: "policy-schedule.pdf" })).toBeVisible();
  await expect(page.getByText("v1 (requested)")).toBeVisible();
});

test("a user without any of the three permissions sees a friendly message per section", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/audit-trail**", (route) => {
    if (route.request().url().includes("/audit-trail/")) return route.fallback();
    return route.fulfill({ status: 403, json: { message: "no" } });
  });

  await page.goto("/audit-trail");
  await page.getByLabel("Entity type").first().fill("Lead");
  await page.getByRole("button", { name: "Browse" }).click();
  await expect(
    page.getByText("audit-log.read permission", { exact: false }),
  ).toBeVisible();
});

test("audit trail screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["EXTERNAL_AUDITOR"]);
  await page.goto("/audit-trail");
  await expect(page.getByRole("heading", { name: "Audit Trail" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
