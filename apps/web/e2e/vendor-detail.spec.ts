import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";

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
    route.fulfill({
      status: 200,
      json: { ...ME_BASE, roles, permissions: permissionsForRoles(roles) },
    }),
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

test("shows the vendor profile, risk tier, and readiness check", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("http://localhost:4000/vendors/vendor-1", (route) =>
    route.fulfill({ status: 200, json: VENDOR }),
  );
  await page.route(
    "http://localhost:4000/vendors/vendor-1/data-processing-agreements",
    (route) => route.fulfill({ status: 200, json: [] }),
  );
  await page.route(
    "http://localhost:4000/vendors/vendor-1/data-share-readiness",
    (route) =>
      route.fulfill({
        status: 200,
        json: {
          vendorId: "vendor-1",
          riskTier: "high",
          ready: false,
          reasons: [
            "No signed Data Processing Agreement is on file for this tier.",
          ],
        },
      }),
  );

  await page.goto("/vendors/vendor-1");
  await expect(
    page.getByRole("heading", { name: "High Risk Cloud Vendor" }),
  ).toBeVisible();
  await expect(page.getByText("high", { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: "Check readiness" }).click();
  await expect(page.getByText("Not ready", { exact: false })).toBeVisible();
});

test("a user without the permission sees a friendly message", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/vendors/vendor-1", (route) =>
    route.fulfill({ status: 403, json: { message: "no" } }),
  );

  await page.goto("/vendors/vendor-1");
  await expect(
    page.getByText("vendor.read permission", { exact: false }),
  ).toBeVisible();
});

test("creates and signs a Data Processing Agreement", async ({ page }) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("http://localhost:4000/vendors/vendor-1", (route) =>
    route.fulfill({ status: 200, json: VENDOR }),
  );
  let dpas: Array<Record<string, unknown>> = [];
  await page.route(
    "http://localhost:4000/vendors/vendor-1/data-processing-agreements",
    (route) => {
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
          // The endpoint returns this now. Null: nothing has DPO-approved this agreement yet.
          combinedDutyAct: null,
          expiresAt: null,
        },
      ];
      return route.fulfill({ status: 201, json: dpas[0] });
    },
  );
  await page.route(
    "http://localhost:4000/data-processing-agreements/dpa-1/sign",
    (route) => {
      dpas = [{ ...dpas[0], signedAt: "2026-09-06T09:00:00.000Z" }];
      return route.fulfill({ status: 201, json: dpas[0] });
    },
  );

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
  await page.route(
    "http://localhost:4000/vendors/vendor-1/data-processing-agreements",
    (route) => route.fulfill({ status: 200, json: [] }),
  );
  await page.route(
    "http://localhost:4000/vendors/vendor-1/terminate",
    (route) => {
      current = {
        ...current,
        terminationDataReturnConfirmedAt: "2026-09-06T09:00:00.000Z",
      };
      return route.fulfill({ status: 201, json: current });
    },
  );
  await page.route(
    "http://localhost:4000/vendors/vendor-1/revoke-access",
    (route) => {
      current = { ...current, accessRevokedAt: "2026-09-06T10:00:00.000Z" };
      return route.fulfill({ status: 201, json: current });
    },
  );

  await page.goto("/vendors/vendor-1");
  await page
    .getByRole("button", {
      name: "Terminate (confirm data return/destruction)",
    })
    .click();
  await expect(
    page.getByText("Termination confirmed: 2026-09-06", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Revoke access" }).click();
  await expect(
    page.getByText("Access revoked: 2026-09-06", { exact: false }),
  ).toBeVisible();
});

test("vendor detail screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("http://localhost:4000/vendors/vendor-1", (route) =>
    route.fulfill({ status: 200, json: VENDOR }),
  );
  await page.route(
    "http://localhost:4000/vendors/vendor-1/data-processing-agreements",
    (route) => route.fulfill({ status: 200, json: [] }),
  );

  await page.goto("/vendors/vendor-1");
  await expect(
    page.getByRole("heading", { name: "High Risk Cloud Vendor" }),
  ).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});

/*
 * THE COMBINED-DUTY ACT ON A DATA PROCESSING AGREEMENT — Part 4 step 5.
 *
 * `DataProcessingAgreement_maker_checker_distinct` requires that whoever ASSESSES a processor's data
 * protection is not whoever DPO-approves the agreement. **A DPA is what makes a third party lawful to
 * send personal data to at all** — the readiness gate on this very screen refuses a data share without
 * one — so whether two people agreed is what the row is for.
 *
 * The DPO-approved column prints "Yes" for a self-approved agreement and for a two-person one alike,
 * which is why the ordinary-case test asserts that "Yes" IS shown beside the absent declaration rather
 * than asserting silence on its own.
 */

/** Assessed AND DPO-approved by the same person, with the reason they gave. */
const SELF_APPROVED_DPA = {
  id: "dpa-9",
  vendorId: "vendor-1",
  signedAt: "2026-09-06T09:00:00.000Z",
  assessedByUserId: "user-1",
  dpoApprovedByUserId: "user-1",
  combinedDutyAct: {
    id: "cda-dpa-1",
    at: "2026-09-08T00:00:00.000Z",
    actorUserId: "user-1",
    reason:
      "Sole compliance officer in this office; the vendor go-live was inside the review window.",
    pair: "DataProcessingAgreement_maker_checker_distinct",
    roles: ["COMPLIANCE_OFFICER"],
    hatAmbiguous: false,
  },
  expiresAt: null,
};

test("shows that one person both assessed and DPO-approved an agreement, and why", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("http://localhost:4000/vendors/vendor-1", (route) =>
    route.fulfill({ status: 200, json: VENDOR }),
  );
  await page.route(
    "http://localhost:4000/vendors/vendor-1/data-processing-agreements",
    (route) => route.fulfill({ status: 200, json: [SELF_APPROVED_DPA] }),
  );

  await page.goto("/vendors/vendor-1");
  const declared = page.getByTestId("combined-duty-dpa-dpa-9");
  await expect(declared).toContainText("COMPLIANCE_OFFICER");
  await expect(declared).toContainText("Sole compliance officer");
  // Tied to the database rule it excuses, so the record and the constraint cannot drift apart.
  await expect(declared).toHaveAttribute(
    "data-combined-duty-pair",
    "DataProcessingAgreement_maker_checker_distinct",
  );
});

test("prints DPO approved and declares nothing when two people agreed", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("http://localhost:4000/vendors/vendor-1", (route) =>
    route.fulfill({ status: 200, json: VENDOR }),
  );
  await page.route(
    "http://localhost:4000/vendors/vendor-1/data-processing-agreements",
    (route) =>
      route.fulfill({
        status: 200,
        // Assessed by one person, DPO-approved by ANOTHER — the ordinary case.
        json: [
          {
            ...SELF_APPROVED_DPA,
            id: "dpa-10",
            dpoApprovedByUserId: "user-9",
            combinedDutyAct: null,
          },
        ],
      }),
  );

  await page.goto("/vendors/vendor-1");
  // The POSITIVE claim is the anchor: the cell prints the approved marker, which is true of a two-person
  // approval. Asserting silence alone would pass on a cell that had stopped rendering the declaration.
  // `exact` is what makes this an anchor rather than a near-miss: the self-approved cell carries the same
  // word PLUS the declaration, so an inexact match would be satisfied by either row.
  await expect(
    page.getByRole("cell", { name: "yes", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("combined-duty-dpa-dpa-10")).toHaveCount(0);
});
