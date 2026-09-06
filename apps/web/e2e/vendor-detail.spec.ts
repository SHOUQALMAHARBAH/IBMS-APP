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

const VENDOR = {
  id: "vendor-1",
  name: "High Risk Cloud Vendor",
  vendorType: "it_cloud",
  riskTier: "high",
  annualReviewDueAt: "2027-09-06T09:00:00.000Z",
  terminationDataReturnConfirmedAt: null as string | null,
  accessRevokedAt: null as string | null,
  createdAt: "2026-09-06T09:00:00.000Z",
};

test("shows the vendor profile, risk tier, and readiness check", async ({ page }) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("http://localhost:4000/vendors/vendor-1", (route) =>
    route.fulfill({ status: 200, json: VENDOR }),
  );
  await page.route("http://localhost:4000/vendors/vendor-1/data-processing-agreements", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route("http://localhost:4000/vendors/vendor-1/data-share-readiness", (route) =>
    route.fulfill({
      status: 200,
      json: { vendorId: "vendor-1", riskTier: "high", ready: false, reasons: ["No signed Data Processing Agreement is on file for this tier."] },
    }),
  );

  await page.goto("/vendors/vendor-1");
  await expect(page.getByRole("heading", { name: "High Risk Cloud Vendor" })).toBeVisible();
  await expect(page.getByText("high", { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: "Check readiness" }).click();
  await expect(page.getByText("Not ready", { exact: false })).toBeVisible();
});

test("a user without the permission sees a friendly message", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/vendors/vendor-1", (route) =>
    route.fulfill({ status: 403, json: { message: "no" } }),
  );

  await page.goto("/vendors/vendor-1");
  await expect(
    page.getByText("vendor.manage permission", { exact: false }),
  ).toBeVisible();
});

test("creates and signs a Data Processing Agreement", async ({ page }) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("http://localhost:4000/vendors/vendor-1", (route) =>
    route.fulfill({ status: 200, json: VENDOR }),
  );
  let dpas: Array<Record<string, unknown>> = [];
  await page.route("http://localhost:4000/vendors/vendor-1/data-processing-agreements", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 200, json: dpas });
    }
    dpas = [
      {
        id: "dpa-1",
        vendorId: "vendor-1",
        signedAt: null,
        assessedByUserId: "user-1",
        dpoApprovedByUserId: null,
        expiresAt: null,
      },
    ];
    return route.fulfill({ status: 201, json: dpas[0] });
  });
  await page.route("http://localhost:4000/data-processing-agreements/dpa-1/sign", (route) => {
    dpas = [{ ...dpas[0], signedAt: "2026-09-06T09:00:00.000Z" }];
    return route.fulfill({ status: 201, json: dpas[0] });
  });

  await page.goto("/vendors/vendor-1");
  await page.getByRole("button", { name: "Create a new DPA" }).click();
  await expect(page.getByRole("cell", { name: "unsigned" })).toBeVisible();
  await page.getByRole("button", { name: "Sign", exact: true }).click();
  await expect(page.getByRole("cell", { name: "2026-09-06" })).toBeVisible();
});

test("terminates a vendor and then revokes access", async ({ page }) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  let current = { ...VENDOR };
  await page.route("http://localhost:4000/vendors/vendor-1", (route) =>
    route.fulfill({ status: 200, json: current }),
  );
  await page.route("http://localhost:4000/vendors/vendor-1/data-processing-agreements", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route("http://localhost:4000/vendors/vendor-1/terminate", (route) => {
    current = { ...current, terminationDataReturnConfirmedAt: "2026-09-06T09:00:00.000Z" };
    return route.fulfill({ status: 201, json: current });
  });
  await page.route("http://localhost:4000/vendors/vendor-1/revoke-access", (route) => {
    current = { ...current, accessRevokedAt: "2026-09-06T10:00:00.000Z" };
    return route.fulfill({ status: 201, json: current });
  });

  await page.goto("/vendors/vendor-1");
  await page.getByRole("button", { name: "Terminate (confirm data return/destruction)" }).click();
  await expect(page.getByText("Termination confirmed: 2026-09-06", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Revoke access" }).click();
  await expect(page.getByText("Access revoked: 2026-09-06", { exact: false })).toBeVisible();
});

test("vendor detail screen has no serious/critical accessibility violations @a11y", async ({ page }) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("http://localhost:4000/vendors/vendor-1", (route) =>
    route.fulfill({ status: 200, json: VENDOR }),
  );
  await page.route("http://localhost:4000/vendors/vendor-1/data-processing-agreements", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );

  await page.goto("/vendors/vendor-1");
  await expect(page.getByRole("heading", { name: "High Risk Cloud Vendor" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
