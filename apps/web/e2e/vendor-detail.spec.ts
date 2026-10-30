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
    page.getByText("(vendor.read)", { exact: false }),
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
          // Item 4(a). The assessor is named; nothing has approved this yet, so the approver name
          // is null — and the screen must render NOTHING for it rather than an empty "approved by".
          assessedByName: "سامر عبدالله الحوراني",
          dpoApprovedByName: null,
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
  // Item 4(a) — the two people by NAME, resolved by the api. Here they are the SAME person, which
  // is what makes this fixture the self-approval case.
  assessedByName: "سامر عبدالله الحوراني",
  dpoApprovedByName: "سامر عبدالله الحوراني",
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

  /*
   * ITEM 4(a) — WHO APPROVED IT, which this register did not say.
   *
   * A DPA is what makes sending personal data to a third party lawful at all, and its approval is
   * a maker/checker decision with a database CHECK behind it — so the screen reported WHETHER it
   * was approved and never BY WHOM. Both sides are named now, because a reader cannot see that
   * two people were involved from one name.
   *
   * This is also why BOTH halves are asserted here rather than one: on this fixture the assessor
   * and the approver are the SAME person, so a test reading only one name could not tell a
   * self-approval from a two-person agreement — which is exactly what the combined-duty act above
   * exists to make visible.
   */
  await expect(
    page.locator('[data-dpa-approver="dpa-9"]'),
  ).toContainText("approved by سامر عبدالله الحوراني");
  await expect(
    page.locator('[data-dpa-assessor="dpa-9"]'),
  ).toContainText("سامر عبدالله الحوراني");
  // Each row carries its OWN hook keyed on the agreement id, so a vendor with several agreements
  // cannot have one row's approver read as another's — and so neither assertion can pass by
  // matching text anywhere on the page, which `check:absence` exists to forbid.
  // The budget does NOT move for this: `/vendors/[id]`'s counted identifier is the PRESENCE TEST
  // gating the approve control, which never reached a reader. Register entry 134.
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
            // Item 4(a) — a DIFFERENT person, and therefore a different NAME. Spreading
            // SELF_APPROVED_DPA would otherwise carry user-1's name onto user-9's approval, so
            // the fixture would be asserting data the api could never produce.
            dpoApprovedByName: "ليلى محمود الزعبي",
            combinedDutyAct: null,
          },
        ],
      }),
  );

  await page.goto("/vendors/vendor-1");
  /*
   * RE-POINTED BY ITEM 4(a), AND THE REVERSAL IS STATED. This asserted the approved cell's
   * accessible name was EXACTLY "yes", and its own comment explained why: the self-approved cell
   * carried that word PLUS a declaration, so `exact` was what told the two rows apart.
   *
   * Item 4(a) adds the APPROVER'S NAME to every approved cell, so neither row's name is "yes" any
   * more and the old anchor cannot match either. The property it was about is kept and
   * STRENGTHENED: the two-person case is now visible AS two people — a different name from the
   * assessor's — where before it was only inferable from the ABSENCE of a declaration.
   *
   * The silence half (no combined-duty declaration on this row) is asserted immediately below and
   * is unchanged; it is the assertion that would pass vacuously on its own, which is why the
   * positive anchor comes first.
   */
  await expect(
    page.locator('[data-dpa-approver="dpa-10"]'),
  ).toContainText("approved by ليلى محمود الزعبي");
  await expect(
    page.locator('[data-dpa-assessor="dpa-10"]'),
  ).toContainText("سامر عبدالله الحوراني");
  await expect(page.getByTestId("combined-duty-dpa-dpa-10")).toHaveCount(0);
});
