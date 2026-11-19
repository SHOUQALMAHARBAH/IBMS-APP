import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";
import { pickEntity } from "./support/pick-entity";
import { anchoredCount, expectAbsentWithin, expectNone } from "./support/anchored";

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
    route.fulfill({ status: 200, json: { ...ME_BASE, roles, permissions: permissionsForRoles(roles) } }),
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

/**
 * `/documents` carried TWO REQUIRED `policyId` text boxes — the worst of the measured identifier
 * defects, because the screen could not be used at all without pasting a uuid from somewhere else. Both
 * are pickers now, so these specs select a policy instead of typing its id.
 */
const POLICY_SEARCH = "http://localhost:4000/policies/search**";
const POLICY_OPTION = {
  id: "policy-1",
  policyNumber: "POL-1",
  customerLegalName: "Acme Trading",
  insuranceLine: "MOTOR",
  status: "ACTIVE",
};

test("looks up a policy's documents and shows the create-version form", async ({ page }) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await page.route("http://localhost:4000/documents?policyId=policy-1", (route) =>
    route.fulfill({ status: 200, json: [DOC] }),
  );

  await page.goto("/documents");
  await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
  await pickEntity(page, "policy", POLICY_OPTION, { route: POLICY_SEARCH, nth: 0 });
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
  await pickEntity(page, "policy", POLICY_OPTION, { route: POLICY_SEARCH, nth: 0 });
  await page.getByRole("button", { name: "Look up documents" }).click();
  await expect(
    page.getByText("(document.read)", { exact: false }),
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
  await pickEntity(page, "policy", POLICY_OPTION, { route: POLICY_SEARCH, nth: 0 });
  await page.getByRole("button", { name: "Look up documents" }).click();
  await expect(page.getByRole("cell", { name: "Locked" })).toBeVisible();
  await page.getByRole("button", { name: "Unlock for deletion" }).click();
  await expect(page.getByRole("cell", { name: "Unlocked" })).toBeVisible();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("No documents recorded for this policy.")).toBeVisible();
});

/**
 * A STORED CERTIFICATE. `storageRef` carries the `db:documentContent/` prefix the repository writes
 * when this system holds the bytes itself — ⛔ the discriminator is that prefix and not the category,
 * because the prefix is what the server really writes.
 */
const STORED_CERT = {
  ...DOC,
  id: "doc-2",
  category: "CERTIFICATE_OF_INSURANCE",
  fileName: "certificate-of-insurance-policy-1-AR.pdf",
  storageRef: "db:documentContent/doc-2",
};

/*
 * 🔴 OWNER DECISION 142 §٥ CRITERION 5 — «لا مسار يحذف الشهادة», ON THE SCREEN.
 *
 * ⚠️ TWO ROLES, AND THAT IS A MEASUREMENT RATHER THAN CONVENIENCE: no seeded role holds BOTH
 * `document.read` and `document.delete-override` (measured 2026-11-18 across the fixture — the
 * override is ADMIN + DPO, neither of whom holds the read). An office defines its own roles now, so
 * a person holding both is constructible; assigning both roles is how this test says so out loud.
 */
test("a stored certificate offers no deletion control, even to a caller who may override the lock", async ({ page }) => {
  await mockAuth(page, ["SYSTEM_SECURITY_ADMINISTRATOR", "PLACEMENT_TECHNICAL_OFFICER"]);
  await page.route("http://localhost:4000/documents?policyId=policy-1", (route) =>
    route.fulfill({ status: 200, json: [DOC, STORED_CERT] }),
  );

  await page.goto("/documents");
  await pickEntity(page, "policy", POLICY_OPTION, { route: POLICY_SEARCH, nth: 0 });
  await page.getByRole("button", { name: "Look up documents" }).click();
  await expect(page.getByRole("cell", { name: "certificate-of-insurance-policy-1-AR.pdf" })).toBeVisible();

  /*
   * NON-VACUITY, AND IT IS THE WHOLE TEST. The ordinary row's unlock button IS there, for this
   * same caller in this same render — so the certificate's missing one is about the ROW. Without
   * this the assertion below would pass just as well against a screen that withheld the control
   * from everybody, or against one that never rendered.
   */
  await expect(page.getByRole("button", { name: "Unlock for deletion" })).toBeVisible();
  expect(
    await anchoredCount(page.getByRole("button", { name: "Unlock for deletion" })),
    "the stored certificate was offered a deletion unlock — decision 142 §٥ criterion 5",
  ).toBe(1);

  // And the certificate is not simply absent from the screen: its own control is there.
  expect(await anchoredCount(page.locator("[data-stored-download]"))).toBe(1);
});

test("the deletion controls are withheld from a caller who does not hold document.delete-override", async ({ page }) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await page.route("http://localhost:4000/documents?policyId=policy-1", (route) =>
    route.fulfill({ status: 200, json: [DOC] }),
  );

  await page.goto("/documents");
  await pickEntity(page, "policy", POLICY_OPTION, { route: POLICY_SEARCH, nth: 0 });
  await page.getByRole("button", { name: "Look up documents" }).click();

  /*
   * The anchor is a control this caller DOES hold, on the row under test — so the absence below
   * is read off a screen that demonstrably rendered this document, which is what `expectNone`
   * exists to insist on. The owner's second walk saw the unlock offered to exactly this role.
   */
  const anchor = page.getByRole("button", { name: "New version" });
  await expect(anchor).toBeVisible();
  await expectNone(page.getByRole("button", { name: "Unlock for deletion" }), anchor);
  await expectNone(page.getByRole("button", { name: "Delete", exact: true }), anchor);
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
  await pickEntity(page, "policy", POLICY_OPTION, { route: POLICY_SEARCH, nth: 1 });
  await page.getByRole("button", { name: "Compute" }).click();
  // "2 document(s)" before the plural pass; the count now selects a real
  // form, so English reads "2 documents" and Arabic would read "مستندان".
  await expect(page.getByText("2 documents", { exact: false })).toBeVisible();
  await expect(page.getByText("HIGHLY_CONFIDENTIAL")).toBeVisible();
});

test("documents screen has no serious/critical accessibility violations @a11y", async ({ page }) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await page.route("http://localhost:4000/documents?policyId=policy-1", (route) =>
    route.fulfill({ status: 200, json: [DOC] }),
  );

  await page.goto("/documents");
  await pickEntity(page, "policy", POLICY_OPTION, { route: POLICY_SEARCH, nth: 0 });
  await page.getByRole("button", { name: "Look up documents" }).click();
  await expect(page.getByRole("cell", { name: "wording.pdf" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});

/*
 * «جارٍ التحميل…» and it never resolves — the owner's walk, 2026-10-26.
 *
 * A DIFFERENT shape from /internal-audit-findings', which is why it was measured
 * rather than assumed: `scripts/measurements/loading-shown-when-empty.py` reports
 * this screen's condition as testing a VARIABLE, so an empty list was never the
 * cause here. The classification block rendered its loading line whenever
 * `summary` was null — which is the state BEFORE anybody has looked a policy up —
 * so the line stood under an empty field from the moment the screen opened and
 * could never clear. It was also guarded on `loadError`, which belongs to the
 * document LIST above it rather than to this lookup.
 *
 * Nothing is rendered before a lookup: the field's own label and the paragraph
 * above it already say what to do, and an invented prompt would be a sentence
 * nobody decided.
 */
test("says nothing about loading until a classification lookup is actually running", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route(POLICY_SEARCH, (route) =>
    route.fulfill({ status: 200, json: [] }),
  );

  await page.goto("/documents");

  // Anchored on the block's own heading, so the absence cannot pass while the
  // page is still mounting.
  // Scoped to the classification FORM, not the page: `docLoading` is rendered by
  // the document list on this same screen, so a page-wide absence would be
  // asserting about a different block — the wrong-element failure the shared
  // helper exists to make unwritable. The scope is asserted visible first.
  const classification = page
    .locator("form")
    .filter({ has: page.getByRole("heading", { name: "Policy file classification" }) });
  await expectAbsentWithin(classification, (s) => s.getByText("Loading…"));
});
