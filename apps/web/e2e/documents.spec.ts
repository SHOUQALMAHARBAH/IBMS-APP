import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ME_BASE = {
  id: "user-1",
  email: "placement@ibms.test",
  fullName: "Placement Officer",
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

const DOC = {
  id: "doc-1",
  policyId: "policy-1",
  customerId: null,
  category: "POLICY",
  classification: "CONFIDENTIAL",
  fileName: "wording.pdf",
  storageRef: "s3://ibms/policy-1/wording.pdf",
  versionNumber: 1,
  previousVersionId: null,
  uploadedByUserId: "user-1",
  deletionLocked: true,
  deletionOverrideByUserId: null as string | null,
  createdAt: "2026-09-20T09:00:00.000Z",
};

test("looks up a policy's documents and shows the create-version form", async ({ page }) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await page.route("http://localhost:4000/documents?policyId=policy-1", (route) =>
    route.fulfill({ status: 200, json: [DOC] }),
  );

  await page.goto("/documents");
  await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
  await page.getByLabel("Policy ID").first().fill("policy-1");
  await page.getByRole("button", { name: "Look up documents" }).click();
  await expect(page.getByRole("cell", { name: "wording.pdf" })).toBeVisible();
  await page.getByRole("button", { name: "New version" }).click();
  await expect(page.getByRole("heading", { name: "Record a new version" })).toBeVisible();
});

test("a user without the permission sees a friendly message", async ({ page }) => {
  await mockAuth(page, ["POLICY_CHECKING_OFFICER"]);
  await page.route("http://localhost:4000/documents?policyId=policy-1", (route) =>
    route.fulfill({ status: 403, json: { message: "no" } }),
  );

  await page.goto("/documents");
  await page.getByLabel("Policy ID").first().fill("policy-1");
  await page.getByRole("button", { name: "Look up documents" }).click();
  await expect(
    page.getByText("document.manage permission", { exact: false }),
  ).toBeVisible();
});

test("unlocks and deletes a document", async ({ page }) => {
  await mockAuth(page, ["SYSTEM_SECURITY_ADMINISTRATOR"]);
  let current = { ...DOC };
  let deleted = false;
  await page.route("http://localhost:4000/documents?policyId=policy-1", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 200, json: deleted ? [] : [current] });
    }
    return route.fallback();
  });
  await page.route("http://localhost:4000/documents/doc-1/deletion-override", (route) => {
    current = { ...current, deletionLocked: false, deletionOverrideByUserId: "user-1" };
    return route.fulfill({ status: 201, json: current });
  });
  await page.route("http://localhost:4000/documents/doc-1", (route) => {
    if (route.request().method() === "DELETE") {
      deleted = true;
      return route.fulfill({ status: 204 });
    }
    return route.fallback();
  });

  await page.goto("/documents");
  await page.getByLabel("Policy ID").first().fill("policy-1");
  await page.getByRole("button", { name: "Look up documents" }).click();
  await expect(page.getByRole("cell", { name: "Locked" })).toBeVisible();
  await page.getByRole("button", { name: "Unlock for deletion" }).click();
  await expect(page.getByRole("cell", { name: "Unlocked" })).toBeVisible();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("No documents recorded for this policy.")).toBeVisible();
});

test("computes a policy's highest-classification-present summary", async ({ page }) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await page.route("http://localhost:4000/documents/classification-summary?policyId=policy-1", (route) =>
    route.fulfill({
      status: 200,
      json: { policyId: "policy-1", documentCount: 2, highestClassification: "HIGHLY_CONFIDENTIAL" },
    }),
  );

  await page.goto("/documents");
  await page.getByLabel("Policy ID").nth(1).fill("policy-1");
  await page.getByRole("button", { name: "Compute" }).click();
  await expect(page.getByText("2 document(s)", { exact: false })).toBeVisible();
  await expect(page.getByText("HIGHLY_CONFIDENTIAL")).toBeVisible();
});

test("documents screen has no serious/critical accessibility violations @a11y", async ({ page }) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await page.route("http://localhost:4000/documents?policyId=policy-1", (route) =>
    route.fulfill({ status: 200, json: [DOC] }),
  );

  await page.goto("/documents");
  await page.getByLabel("Policy ID").first().fill("policy-1");
  await page.getByRole("button", { name: "Look up documents" }).click();
  await expect(page.getByRole("cell", { name: "wording.pdf" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
