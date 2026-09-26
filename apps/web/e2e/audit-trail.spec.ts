import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";

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
    route.fulfill({ status: 200, json: { ...ME_BASE, roles, permissions: permissionsForRoles(roles) } }),
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

// The audit-log browse returns `{ items, total, page, pageSize }` — it is one
// of the five paged lists. Workflow/document history are NOT paged: they are
// bounded by the entity they belong to, and still return bare arrays.
function paged<T>(items: T[]) {
  return { items, total: items.length, page: 0, pageSize: 50 };
}

test("browses the audit log, looks up workflow history, and looks up document history", async ({
  page,
}) => {
  await mockAuth(page, ["EXTERNAL_AUDITOR"]);
  await page.route("http://localhost:4000/audit-trail?**", (route) =>
    route.fulfill({ status: 200, json: paged(AUDIT_ROWS) }),
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
  await expect(page.getByRole("cell", { name: "Status change" }).first()).toBeVisible();

  await page.getByLabel("Workflow entity type").fill("Lead");
  await page.getByLabel("Workflow entity id").fill("lead-1");
  await page.getByRole("button", { name: "Look up" }).first().click();
  await expect(page.getByText("lead-1").first()).toBeVisible();

  await page.getByLabel("Document id").fill("doc-1");
  await page.getByRole("button", { name: "Look up" }).nth(1).click();
  await expect(page.getByRole("cell", { name: "policy-schedule.pdf" })).toBeVisible();
  await expect(page.getByText("v1 (requested)")).toBeVisible();
});

test("an action-and-date browse sends all three filters, and `to` covers the WHOLE last day", async ({
  page,
}) => {
  // IMPROVEMENTS § 1.52 — "every DELETE last March" was unaskable from this screen while the API had
  // accepted `action`, `from` and `to` all along.
  await mockAuth(page, ["EXTERNAL_AUDITOR"]);
  const urls: string[] = [];
  await page.route("http://localhost:4000/audit-trail?**", (route) => {
    urls.push(route.request().url());
    return route.fulfill({ status: 200, json: paged(AUDIT_ROWS) });
  });

  await page.goto("/audit-trail");
  await expect(page.getByRole("heading", { name: "Audit Trail" })).toBeVisible();

  await page.getByLabel("Action").selectOption("DELETE");
  await page.getByLabel("From").fill("2026-03-01");
  await page.getByLabel("To").fill("2026-03-31");
  await page.getByRole("button", { name: "Browse" }).click();
  await expect(page.getByRole("cell", { name: "Status change" }).first()).toBeVisible();

  await expect.poll(() => urls.length, { message: "no browse request was sent" }).toBeGreaterThan(0);
  const sent = new URL(urls[urls.length - 1]!);
  expect(sent.searchParams.get("action")).toBe("DELETE");
  expect(sent.searchParams.get("from")).toBe("2026-03-01T00:00:00.000Z");
  // THE ASSERTION THAT MATTERS. `2026-03-31` as an instant is midnight at the START of the 31st, so a
  // naive conversion drops the last day of every range a person enters — a wrong answer that looks
  // complete. Asserting the date alone would pass against exactly that bug.
  expect(sent.searchParams.get("to")).toBe("2026-03-31T23:59:59.999Z");
});

test("the WITHDRAWN action is offered, which is the one the discard exists to make findable", async ({
  page,
}) => {
  // The web's `AuditAction` union was three values short — `DISCARD`, `SLA_ESCALATED` and
  // `ENCRYPTION_KEY_USED` — and this dropdown is built from it, so those three would have been the
  // actions nobody could filter for. `packages/db/prisma/audit-action-parity.spec.ts` guards the union
  // against the database enum; this asserts the SCREEN actually offers one of the recovered values.
  await mockAuth(page, ["EXTERNAL_AUDITOR"]);
  await page.route("http://localhost:4000/audit-trail?**", (route) =>
    route.fulfill({ status: 200, json: paged(AUDIT_ROWS) }),
  );

  await page.goto("/audit-trail");
  const action = page.getByLabel("Action");
  await expect(action).toBeVisible();
  await action.selectOption("DISCARD");
  await expect(action).toHaveValue("DISCARD");
  await action.selectOption("SLA_ESCALATED");
  await expect(action).toHaveValue("SLA_ESCALATED");
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
