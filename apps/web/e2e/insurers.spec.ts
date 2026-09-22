import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";

/**
 * The insurer screens — list, register, detail, and the deactivation step.
 *
 * Two properties carry most of the weight here, and both are about what a screen must NOT do:
 *
 *  1. **The company / relationship split.** An insurer row mixes public company facts with this
 *     office's own commercial terms, and only the first group may ever cross an office boundary.
 *     The screens keep them in separate headed sections; a test that only checked "the fields
 *     render" would pass on a layout that mixed them.
 *  2. **Deactivation shows what the record will say, before it acts.** The five impact counts come
 *     from the same endpoint the audit row is written from, and the two policy counts stay
 *     SEPARATE — one is cover running on its own, the other is work the insurer still owes. A
 *     single total would hide the half that should give an administrator pause.
 */

const ME_BASE = {
  id: "user-1",
  email: "admin@ibms.test",
  fullName: "Office Administrator",
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

const MOTOR_LINE = {
  id: "line-motor",
  code: "MOTOR_COMPREHENSIVE",
  nameEn: "Motor Comprehensive",
  nameAr: "تأمين المركبات الشامل",
  category: "GENERAL",
  isStandard: true,
};
/** An office's OWN added line — no code, by design. It must render as local vocabulary. */
const OFFICE_LINE = {
  id: "line-drone",
  code: null,
  nameEn: "Drone Hull",
  nameAr: "أجسام الطائرات المسيرة",
  category: "GENERAL",
  isStandard: false,
};

const ACTIVE_INSURER = {
  id: "ins-1",
  name: "Al-Yarmouk Insurance",
  nameAr: "شركة اليرموك للتأمين",
  isOfficeLocal: false,
  insurerMasterId: "master-1",
  isActive: true,
  linesOffered: [MOTOR_LINE, OFFICE_LINE],
  structure: "TAKAFUL",
  companyPhone: "+962 6 500 7000",
  companyEmail: "contact@yarmouk.test",
  companyWebsite: "yarmouk.test",
  companyCorrespondenceAddress: "Amman",
  // RELATIONSHIP-level. Present in the fixture precisely so the test can prove these appear under
  // their own heading and not among the company facts.
  financialStrengthRating: "A-",
  creditTermsDays: 45,
  rfqContactName: "Rana Q.",
  rfqContactEmail: "rana@yarmouk.test",
  rfqContactPhone: "+962 7 900 0000",
  claimsContactName: "Sami C.",
  claimsContactEmail: "sami@yarmouk.test",
  underwriterContact: "Underwriting desk",
  createdAt: "2026-03-01T00:00:00.000Z",
};

const LOCAL_INSURER = {
  ...ACTIVE_INSURER,
  id: "ins-2",
  name: "Local Only Insurance",
  nameAr: "شركة محلية للتأمين",
  isOfficeLocal: true,
  insurerMasterId: null,
  isActive: false,
  linesOffered: [],
};

const IMPACT = {
  policiesInForce: 3,
  policiesInIssuance: 2,
  openRenewalCases: 1,
  pendingRfqSubmissions: 4,
  unsettledInvoices: 5,
};

async function mockList(page: Page, items: unknown[]) {
  await page.route("http://localhost:4000/insurers?**", (route) =>
    route.fulfill({
      status: 200,
      json: { items, total: items.length, page: 0, pageSize: 50 },
    }),
  );
  await page.route("http://localhost:4000/insurers", (route) =>
    route.fulfill({
      status: 200,
      json: { items, total: items.length, page: 0, pageSize: 50 },
    }),
  );
}

test("lists insurers with their lines, and shows a deactivated one rather than hiding it", async ({
  page,
}) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockList(page, [ACTIVE_INSURER, LOCAL_INSURER]);

  await page.goto("/insurers");
  await expect(page.getByRole("heading", { name: "Insurers" })).toBeVisible();

  await expect(page.getByRole("link", { name: "Al-Yarmouk Insurance" })).toBeVisible();
  // A deactivated insurer is NOT hidden from the default view: it keeps its policies, claims and
  // invoices, and it is the row an administrator most needs to find. Hiding it would read as
  // deletion.
  await expect(page.getByRole("link", { name: "Local Only Insurance" })).toBeVisible();
  await expect(page.locator("[data-deactivated-insurer]")).toHaveCount(1);

  // Both kinds of line render, and the office's own is marked as local vocabulary.
  await expect(page.getByText("Motor Comprehensive")).toBeVisible();
  await expect(page.getByText("Drone Hull")).toBeVisible();
  await expect(page.getByText("Registered locally")).toBeVisible();
});

test("keeps company facts and the office's own terms in SEPARATE sections", async ({
  page,
}) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await page.route("http://localhost:4000/insurers/ins-1", (route) =>
    route.fulfill({ status: 200, json: ACTIVE_INSURER }),
  );

  await page.goto("/insurers/ins-1");
  await expect(
    page.getByRole("heading", { name: "Al-Yarmouk Insurance" }),
  ).toBeVisible();

  // The split asserted STRUCTURALLY — each fact under its own heading — rather than by checking
  // that both merely appear somewhere on the page. Only the company group may cross an office
  // boundary, so "these render" is not the property that matters; "these are grouped as public vs
  // ours" is.
  const company = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Company details" }) });
  await expect(company.getByText("Takaful", { exact: true })).toBeVisible();
  await expect(company.getByText("contact@yarmouk.test")).toBeVisible();
  await expect(company.getByText("A-", { exact: true })).toHaveCount(0);

  const relationship = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Your office's terms and contacts" }),
  });
  await expect(relationship.getByText("45 days")).toBeVisible();
  await expect(relationship.getByText("A-", { exact: true })).toBeVisible();
  await expect(relationship.getByText("Rana Q.")).toBeVisible();
  await expect(relationship.getByText("contact@yarmouk.test")).toHaveCount(0);
  await expect(
    relationship.getByText("None of these fields crosses an office boundary."),
  ).toBeVisible();
});

test("shows all five impact counts before a deactivation, keeping the two policy figures apart", async ({
  page,
}) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await page.route("http://localhost:4000/insurers/ins-1", (route) =>
    route.fulfill({ status: 200, json: ACTIVE_INSURER }),
  );
  await page.route(
    "http://localhost:4000/insurers/ins-1/status-impact",
    (route) => route.fulfill({ status: 200, json: IMPACT }),
  );

  await page.goto("/insurers/ins-1");
  await page.getByRole("button", { name: "Stop dealing with them" }).click();

  const panel = page.locator("[data-impact-panel]");
  await expect(panel).toBeVisible();
  // Each count asserted individually, by its own hook. A total would be satisfied by 3+2=5 in one
  // row — which is exactly the conflation the API refuses to do, since one figure is cover running
  // on its own and the other is work the INSURER still owes.
  await expect(panel.locator('[data-impact="in-force"]')).toHaveText("3");
  await expect(panel.locator('[data-impact="in-issuance"]')).toHaveText("2");
  await expect(panel.locator('[data-impact="renewals"]')).toHaveText("1");
  await expect(panel.locator('[data-impact="rfqs"]')).toHaveText("4");
  await expect(panel.locator('[data-impact="invoices"]')).toHaveText("5");

  // And the copy says what stopping does NOT do: it is allow-and-record, never a refusal, so
  // nothing here is cancelled.
  await expect(
    panel.getByText("None of these obligations is cancelled or stopped", {
      exact: false,
    }),
  ).toBeVisible();
});

test("refuses to confirm a deactivation with no reason", async ({ page }) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await page.route("http://localhost:4000/insurers/ins-1", (route) =>
    route.fulfill({ status: 200, json: ACTIVE_INSURER }),
  );
  await page.route(
    "http://localhost:4000/insurers/ins-1/status-impact",
    (route) => route.fulfill({ status: 200, json: IMPACT }),
  );
  // Fails the test if it is ever called: the reason guard must stop the request client-side rather
  // than let the API refuse it, so an administrator is not told "required" by a round trip.
  let posted = false;
  await page.route("http://localhost:4000/insurers/ins-1/deactivate", (route) => {
    posted = true;
    return route.fulfill({ status: 200, json: { insurer: ACTIVE_INSURER, impact: IMPACT } });
  });

  await page.goto("/insurers/ins-1");
  await page.getByRole("button", { name: "Stop dealing with them" }).click();
  await page.getByRole("button", { name: "Confirm — stop dealing" }).click();

  await expect(
    page.getByText("A reason is required to stop dealing with an insurer."),
  ).toBeVisible();
  expect(posted).toBe(false);
});

test("a reader without insurer.relationship.manage sees no register or deactivate control", async ({
  page,
}) => {
  // Compliance holds `insurer.read` and NOT `insurer.relationship.manage` — the split this feature
  // deliberately keeps, so reading the panel never implies changing it.
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockList(page, [ACTIVE_INSURER]);
  await page.route("http://localhost:4000/insurers/ins-1", (route) =>
    route.fulfill({ status: 200, json: ACTIVE_INSURER }),
  );

  await page.goto("/insurers");
  await expect(page.getByRole("link", { name: "Register an insurer" })).toHaveCount(0);

  await page.goto("/insurers/ins-1");
  await expect(
    page.getByRole("button", { name: "Stop dealing with them" }),
  ).toHaveCount(0);
});

test("registration offers ONE identity path at a time", async ({ page }) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await page.route("http://localhost:4000/insurer-masters", (route) =>
    route.fulfill({
      status: 200,
      json: [
        { id: "master-1", legalName: "Al-Yarmouk Insurance", legalNameAr: null, linesOffered: [] },
      ],
    }),
  );
  await page.route("http://localhost:4000/insurance-lines", (route) =>
    route.fulfill({ status: 200, json: [MOTOR_LINE, OFFICE_LINE] }),
  );

  await page.goto("/insurers/new");
  // The catalogue path is the default and its picker is shown; the local name fields are NOT, so
  // the both-paths combination the API refuses cannot be typed in the first place.
  await expect(page.getByLabel("Company in the catalogue")).toBeVisible();
  await expect(page.getByLabel("Legal name (English)")).toHaveCount(0);

  await page.getByRole("radio", { name: "A company only my office knows" }).click();
  await expect(page.getByLabel("Legal name (English)")).toBeVisible();
  await expect(page.getByLabel("Legal name (Arabic)")).toBeVisible();
  await expect(page.getByLabel("Company in the catalogue")).toHaveCount(0);
});

test("insurer screens have no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockList(page, [ACTIVE_INSURER, LOCAL_INSURER]);
  await page.route("http://localhost:4000/insurers/ins-1", (route) =>
    route.fulfill({ status: 200, json: ACTIVE_INSURER }),
  );

  for (const path of ["/insurers", "/insurers/ins-1"]) {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(
      serious,
      `${path}: ${serious.map((v) => v.id).join(", ")}`,
    ).toEqual([]);
  }
});
