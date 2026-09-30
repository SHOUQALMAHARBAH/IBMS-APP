import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";

const ME_BASE = {
  id: "user-1",
  email: "officer@ibms.test",
  fullName: "Sales Officer",
  languagePreference: "EN",
  mfaEnabled: false,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

async function mockAuth(
  page: Page,
  roles: string[],
  languagePreference: "AR" | "EN" = "EN",
) {
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fake-access-token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      status: 200,
      json: { ...ME_BASE, languagePreference, roles, permissions: permissionsForRoles(roles) },
    }),
  );
}

const CUSTOMER = {
  id: "cust-1",
  prospectId: null,
  customerType: "INDIVIDUAL",
  legalName: "Ahmad Al-Fulani",
  givenName: "Ahmad",
  fatherName: null,
  grandfatherName: null,
  familyName: "Al-Fulani",
  registrationNumber: null,
  taxRegistrationNumber: null,
  registeredAddress: null,
  natureOfBusiness: null,
  languagePreference: "AR",
  status: "PENDING_KYC",
  classification: "CONFIDENTIAL",
  ownerUserId: "user-1",
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
  nationalId: "******2345",
  contactPhone: "***-7890",
  contactEmail: "***@example.test",
};

const KYC_RECORD = {
  id: "kyc-1",
  customerId: "cust-1",
  status: "DRAFT",
  isEdd: false,
  submittedAt: null,
  createdByUserId: "user-1",
  approvedByUserId: null,
  // The endpoint returns this now. Null: nothing has approved this draft.
  combinedDutyAct: null,
  approvedAt: null,
  nextReviewDueAt: null,
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
};

// The five growing lists return `{ items, total, page, pageSize }`, not a bare
// array. Wrapping fixtures here rather than hand-writing the envelope at every
// mock keeps the shape in one place — the same reason the app has one
// `Pagination` component.
function paged<T>(items: T[]) {
  return { items, total: items.length, page: 0, pageSize: 50 };
}

test("renders the customer list and navigates to a profile on click", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/customers", (route) =>
    route.fulfill({ status: 200, json: paged([CUSTOMER]) }),
  );
  await page.route("http://localhost:4000/customers/cust-1", (route) =>
    route.fulfill({ status: 200, json: CUSTOMER }),
  );
  await page.route("http://localhost:4000/customers/cust-1/ubos", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route("http://localhost:4000/customers/cust-1/documents", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );

  await page.goto("/customers");
  await expect(page.getByRole("heading", { name: "Customers" })).toBeVisible();
  await page.getByRole("button", { name: "View profile — Ahmad Al-Fulani" }).click();

  await expect(page).toHaveURL("/customers/cust-1");
  await expect(page.getByRole("heading", { name: "Ahmad Al-Fulani" })).toBeVisible();
  await expect(page.getByText("Individual — Status: Pending KYC")).toBeVisible();
});

// Part F item #6 — bilingual full-text search. Proves the WIRING (search
// input -> correct querystring -> re-rendered list) — the real Postgres
// full-text-search behavior itself is proven by the api's own e2e tests
// (customer.e2e-spec.ts), not re-tested here against a mock.
test("the search box re-fetches with a search querystring and renders the filtered result", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  const OTHER_CUSTOMER = { ...CUSTOMER, id: "cust-2", legalName: "Sara Odeh", givenName: "Sara", familyName: "Odeh" };
  let lastUrl = "";
  await page.route("http://localhost:4000/customers**", (route) => {
    lastUrl = route.request().url();
    const url = new URL(lastUrl);
    if (url.searchParams.get("search") === "Sara") {
      return route.fulfill({ status: 200, json: paged([OTHER_CUSTOMER]) });
    }
    return route.fulfill({ status: 200, json: paged([CUSTOMER, OTHER_CUSTOMER]) });
  });

  await page.goto("/customers");
  await expect(page.getByText("Ahmad Al-Fulani")).toBeVisible();
  await expect(page.getByText("Sara Odeh")).toBeVisible();

  await page.getByLabel("Search", { exact: true }).fill("Sara");
  await page.getByRole("button", { name: "Search" }).click();

  await expect(page.getByText("Sara Odeh")).toBeVisible();
  await expect(page.getByText("Ahmad Al-Fulani")).toHaveCount(0);
  expect(new URL(lastUrl).searchParams.get("search")).toBe("Sara");
});

test("pages the customer list, and hides the control when there is only one page", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  const SECOND = { ...CUSTOMER, id: "cust-2", legalName: "Sara Odeh", givenName: "Sara", familyName: "Odeh" };
  const THIRD = { ...CUSTOMER, id: "cust-3", legalName: "Rami Haddad", givenName: "Rami", familyName: "Haddad" };

  const seen: string[] = [];
  await page.route("http://localhost:4000/customers**", (route) => {
    const url = new URL(route.request().url());
    seen.push(url.search);
    const requested = Number(url.searchParams.get("page") ?? 0);
    // The server clamps and reports back; the control renders what it is told
    // rather than recomputing the window itself.
    return route.fulfill({
      status: 200,
      json: requested === 0
        ? { items: [CUSTOMER, SECOND], total: 3, page: 0, pageSize: 2 }
        : { items: [THIRD], total: 3, page: 1, pageSize: 2 },
    });
  });

  await page.goto("/customers");
  await expect(page.getByText("Showing 1–2 of 3")).toBeVisible();
  await expect(page.getByText("Rami Haddad")).toHaveCount(0);
  // Nothing before the first page, so Previous is inert rather than absent -
  // a control that appears and disappears moves the rows under the pointer.
  await expect(page.getByRole("button", { name: "Previous" })).toBeDisabled();

  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Rami Haddad")).toBeVisible();
  await expect(page.getByText("Showing 3–3 of 3")).toBeVisible();
  await expect(page.getByText("Ahmad Al-Fulani")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Previous" })).toBeEnabled();
  expect(seen.at(-1)).toContain("page=1");

  await page.getByRole("button", { name: "Previous" }).click();
  await expect(page.getByText("Ahmad Al-Fulani")).toBeVisible();
  // Back to the first page means back to the plain URL, not `page=0`.
  expect(seen.at(-1)).not.toContain("page=");
});

test("the page control renders in Arabic, and stays hidden on a single page", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"], "AR");
  await page.route("http://localhost:4000/customers**", (route) =>
    route.fulfill({
      status: 200,
      json: { items: [CUSTOMER], total: 3, page: 0, pageSize: 1 },
    }),
  );

  await page.goto("/customers");
  // Western digits in Arabic too: lib/i18n/format.ts pins 'ar', not 'ar-JO',
  // so numerals match every other figure in the app.
  await expect(page.getByText("عرض 1–1 من 3")).toBeVisible();
  await expect(page.getByRole("button", { name: "التالي" })).toBeEnabled();
});

test("shows an empty state when there are no customers yet", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/customers", (route) =>
    route.fulfill({ status: 200, json: paged([]) }),
  );

  await page.goto("/customers");

  await expect(page.getByText("No customers yet.")).toBeVisible();
});

test("shows a friendly message when the user lacks read permission", async ({ page }) => {
  await mockAuth(page, ["CLAIMS_OFFICER"]);
  await page.route("http://localhost:4000/customers", (route) =>
    route.fulfill({
      status: 403,
      json: { message: "You do not hold a permission required to perform this action" },
    }),
  );

  await page.goto("/customers");

  // `customer.read` since migration 20261105100000 — the LIST moved onto the narrow code while the
  // detail kept `customer.360-view.read`. The mechanical rewrite of this assertion could not know that:
  // it swapped the WORDING and the code had changed too.
  await expect(page.locator('p[role="alert"]')).toContainText(
    "You do not hold permission to find and list customers",
  );
  await expect(page.locator('p[role="alert"]')).toContainText("(customer.read)");
});

/*
 * CORRECTING A CUSTOMER'S CONTACT DETAILS — the caller `PATCH /customers/:id` shipped
 * without (IMPROVEMENTS § 1.65).
 *
 * Two capabilities were unreachable. The owner's requirement that phone, address and
 * email be correctable unconditionally; and — worse, because it is a gate whose
 * precondition became unreachable — `DsrService.fulfil` refuses to close a CORRECTION
 * request until a correction has actually been RECORDED against it, and this route is
 * the only thing that records one. So a statutory correction request could be neither
 * answered nor closed.
 */

/** The detail-page reads, plus a method-aware capture of the correction PATCH. The
 * detail GET and the correction PATCH share a path, so the mock has to branch on the
 * method or the GET swallows the PATCH. */
async function mockCustomerDetail(page: Page) {
  const patches: { body: unknown }[] = [];
  await page.route("http://localhost:4000/customers/cust-1", (route) => {
    if (route.request().method() === "PATCH") {
      patches.push({ body: route.request().postDataJSON() });
      return route.fulfill({ status: 200, json: CUSTOMER });
    }
    return route.fulfill({ status: 200, json: CUSTOMER });
  });
  await page.route("http://localhost:4000/customers/cust-1/ubos", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route("http://localhost:4000/customers/cust-1/documents", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  return patches;
}

test("records a contact correction, sending only the fields actually typed", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  const patches = await mockCustomerDetail(page);

  await page.goto("/customers/cust-1");
  await page.getByTestId("customer-correct-open").click();

  // NOTHING IS PREFILLED, and that is a correctness rule rather than a style
  // choice: `contactPhone` and `contactEmail` arrive MASKED on the detail read, so
  // prefilling would write the mask back as the customer's phone number.
  await expect(page.getByTestId("correct-phone")).toHaveValue("");
  await expect(page.getByTestId("correct-email")).toHaveValue("");

  // An empty correction is refused client-side — the service answers one with a 422.
  await expect(page.getByTestId("customer-correct-submit")).toBeDisabled();

  await page.getByTestId("correct-phone").fill("  +962 7 9000 1234  ");
  await page.getByTestId("correct-reason").fill("  Customer called to report it  ");
  await expect(page.getByTestId("customer-correct-submit")).toBeEnabled();
  await page.getByTestId("customer-correct-submit").click();

  await expect.poll(() => patches.length).toBe(1);
  // TRIMMED, and the two untouched fields are ABSENT rather than empty strings: a
  // blank box means "leave it alone", not "store an empty value".
  expect(patches[0].body).toEqual({
    contactPhone: "+962 7 9000 1234",
    reason: "Customer called to report it",
  });
});

test("omits a field the officer typed into and then cleared", async ({ page }) => {
  // THE CASE THE FILTER ACTUALLY EXISTS FOR, and my first version of these tests
  // could not observe it. An UNTOUCHED field is `undefined` and never reaches the
  // body at all, so planting the removal of the empty-string filter killed nothing
  // (§ 1.51(d)). It is only a typed-then-cleared field that becomes `''` — and
  // sending `''` instructs the server to STORE an empty phone number, which is the
  // opposite of "leave it alone".
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  const patches = await mockCustomerDetail(page);

  await page.goto("/customers/cust-1");
  await page.getByTestId("customer-correct-open").click();

  await page.getByTestId("correct-email").fill("typed-then-cleared@example.test");
  await page.getByTestId("correct-phone").fill("+962 7 9000 1234");
  // Cleared again — the officer changed their mind about the email.
  await page.getByTestId("correct-email").fill("");
  await page.getByTestId("customer-correct-submit").click();

  await expect.poll(() => patches.length).toBe(1);
  expect(patches[0].body).toEqual({ contactPhone: "+962 7 9000 1234" });
});

test("sends the DSR reference, and the request type alongside it", async ({ page }) => {
  // The reference is what `DsrService.fulfil` looks for before it will close a
  // statutory correction request, so it is the field that makes the gate satisfiable.
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  const patches = await mockCustomerDetail(page);

  await page.goto("/customers/cust-1");
  await page.getByTestId("customer-correct-open").click();
  await page.getByTestId("correct-address").fill("12 King Hussein Street, Amman");
  await page.getByTestId("correct-dsr").fill("dsr-77");
  await page.getByTestId("customer-correct-submit").click();

  await expect.poll(() => patches.length).toBe(1);
  expect(patches[0].body).toEqual({
    registeredAddress: "12 King Hussein Street, Amman",
    answersRequestId: "dsr-77",
    // Never sent without the id it qualifies.
    answersRequestType: "dsr",
  });
});

test("says which fields cannot be corrected here, and why", async ({ page }) => {
  // Name, date of birth, nationality and national ID are screening identifiers: the
  // AMLU requires a fresh screen on a change to any of them, and that mechanism does
  // not exist (§ 1.59). The server refuses them structurally via
  // `forbidNonWhitelisted`; an officer who cannot find the name field needs telling
  // why rather than concluding the form is broken.
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockCustomerDetail(page);

  await page.goto("/customers/cust-1");
  await page.getByTestId("customer-correct-open").click();
  await expect(
    page.getByTestId("customer-correct-identifiers-note"),
  ).toContainText("screening event");
});

test("surfaces the server's refusal rather than a generic failure", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockCustomerDetail(page);
  // Re-routed after the helper, so this takes precedence for the PATCH.
  await page.route("http://localhost:4000/customers/cust-1", (route) => {
    if (route.request().method() !== "PATCH") {
      return route.fulfill({ status: 200, json: CUSTOMER });
    }
    return route.fulfill({
      status: 422,
      json: {
        message:
          "registeredAddress is a corporate field and this customer is an individual.",
      },
    });
  });

  await page.goto("/customers/cust-1");
  await page.getByTestId("customer-correct-open").click();
  await page.getByTestId("correct-address").fill("12 King Hussein Street, Amman");
  await page.getByTestId("customer-correct-submit").click();

  await expect(page.getByTestId("customer-correct-error")).toContainText(
    "corporate field",
  );
});

test("a reader without customer.update is told, not shown a dead form", async ({
  page,
}) => {
  // COMPLIANCE_OFFICER holds `customer.360-view.read` and NOT `customer.update` —
  // measured against the seeded grid, and it is also the finding in § 1.65: the DPO
  // who must CLOSE a correction request cannot RECORD the correction that unlocks it,
  // so the statutory flow needs two people.
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockCustomerDetail(page);

  await page.goto("/customers/cust-1");
  // Anchor: the profile rendered for this reader before asserting the absence.
  await expect(
    page.getByRole("heading", { name: "Ahmad Al-Fulani" }),
  ).toBeVisible();
  await expect(page.getByTestId("customer-correct-open")).toHaveCount(0);
  await expect(page.getByTestId("customer-correct-denied")).toContainText(
    "customer.update",
  );
});

test("the onboarding wizard walks an individual customer through profile -> documents -> submit", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/customers", (route) =>
    route.fulfill({ status: 201, json: CUSTOMER }),
  );
  await page.route("http://localhost:4000/customers/cust-1/kyc", (route) =>
    route.fulfill({ status: 201, json: KYC_RECORD }),
  );
  await page.route("http://localhost:4000/customers/cust-1/documents", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 201,
        json: { id: "doc-1", category: "APPLICATION_PROPOSAL", classification: "CONFIDENTIAL", fileName: "proposal.pdf", storageRef: "ref-1", createdAt: "2026-08-26T00:00:00.000Z" },
      });
    }
    return route.fulfill({ status: 200, json: [] });
  });
  await page.route("http://localhost:4000/kyc-records/kyc-1/submit", (route) =>
    route.fulfill({ status: 201, json: { ...KYC_RECORD, status: "SUBMITTED" } }),
  );
  await page.route("http://localhost:4000/customers/cust-1", (route) =>
    route.fulfill({ status: 200, json: CUSTOMER }),
  );
  await page.route("http://localhost:4000/customers/cust-1/ubos", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route("http://localhost:4000/consent-records**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route("http://localhost:4000/privacy-notices/current**", (route) =>
    route.fulfill({ status: 200, json: { notice: null } }),
  );

  await page.goto("/customers/new");
  await page.getByRole("button", { name: "Individual" }).click();

  await page.getByLabel("Given name").fill("Ahmad");
  await page.getByLabel("Family name").fill("Al-Fulani");
  await page.getByLabel("National ID").fill("9901012345");
  await page.getByLabel("Contact phone").fill("+962-7-9000-0000");
  await page.getByLabel("Contact email").fill("ahmad@example.test");
  await page.getByRole("button", { name: "Create customer & start KYC" }).click();

  await expect(page.getByRole("heading", { name: "Supporting documents" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Review & submit" })).toBeVisible();
  // The review step must show the values the officer actually typed — not the
  // masked create() response (CUSTOMER.contactEmail is "***@example.test").
  await expect(page.getByText("+962-7-9000-0000")).toBeVisible();
  await expect(page.getByText("ahmad@example.test")).toBeVisible();
  await expect(page.getByText("***@example.test")).toHaveCount(0);
  await page.getByRole("button", { name: "Submit for compliance review" }).click();

  await expect(page).toHaveURL("/customers/cust-1");
});

test("captures onboarding/KYC consent from the customer profile screen (Part D §5.1 touchpoint #2)", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/customers/cust-1", (route) =>
    route.fulfill({ status: 200, json: CUSTOMER }),
  );
  await page.route("http://localhost:4000/customers/cust-1/ubos", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route("http://localhost:4000/customers/cust-1/documents", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  let captured = false;
  await page.route("http://localhost:4000/consent-records**", (route) => {
    if (route.request().method() === "POST") {
      captured = true;
      return route.fulfill({
        status: 201,
        json: {
          id: "consent-1",
          customerId: "cust-1",
          insuredPersonId: null,
          leadId: null,
          purpose: "KYC_AML",
          isMarketing: false,
          granted: true,
          consentTextVersion: "kyc-notice-v1",
          grantedAt: "2026-08-26T00:00:00.000Z",
          withdrawnAt: null,
          isActive: true,
          createdAt: "2026-08-26T00:00:00.000Z",
        },
      });
    }
    return route.fulfill({ status: 200, json: captured ? [{ id: "consent-1", isActive: true }] : [] });
  });
  await page.route("http://localhost:4000/privacy-notices/current**", (route) =>
    route.fulfill({ status: 200, json: { notice: null } }),
  );

  await page.goto("/customers/cust-1");
  await expect(page.getByRole("heading", { name: "Onboarding / KYC consent" })).toBeVisible();
  await expect(page.getByText("No decision captured yet.")).toBeVisible();

  await page.getByRole("button", { name: "Grant" }).click();
  await expect.poll(() => captured).toBe(true);
});

// Part 10.2 — `customer.national-id.reveal` split out of
// `customer.360-view.read`. The customer split is enforced per FIELD, not per
// route, because the same endpoint reveals a phone number a Sales/Relationship
// Officer needs for ordinary work on a customer they own. These two tests are
// the screen's half of that: the officer keeps the contact reveals and loses the
// national-ID one, and Compliance holds all three.
async function mockCustomerProfile(page: Page) {
  await page.route("http://localhost:4000/customers/cust-1", (route) =>
    route.fulfill({ status: 200, json: CUSTOMER }),
  );
  await page.route("http://localhost:4000/customers/cust-1/ubos", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route("http://localhost:4000/customers/cust-1/documents", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route("http://localhost:4000/consent-records**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route("http://localhost:4000/privacy-notices/current**", (route) =>
    route.fulfill({ status: 200, json: { notice: null } }),
  );
}

test("the owning Sales Officer can reveal the contact fields but not the national ID", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockCustomerProfile(page);

  await page.goto("/customers/cust-1");
  await expect(page.getByRole("heading", { name: "Ahmad Al-Fulani" })).toBeVisible();

  // Three fields are revealable in the markup; the national ID's own row must
  // offer no control. Scoped by the row's own `data-field` hook: all three
  // buttons carry the same translated label, and an ancestor-based locator
  // resolves to the grid container and therefore finds the other two.
  const nationalIdRow = page.locator('[data-field="nationalId"]');
  await expect(nationalIdRow).toHaveCount(1);
  await expect(page.getByText("******2345")).toBeVisible();
  await expect(
    nationalIdRow.getByRole("button", { name: "Reveal", exact: true }),
  ).toHaveCount(0);

  // Two remain — phone and email — so the officer is not locked out of their own
  // customer's contact details.
  await expect(
    page.getByRole("button", { name: "Reveal", exact: true }),
  ).toHaveCount(2);
});

test("Compliance holds the national-ID reveal and gets the real value", async ({ page }) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockCustomerProfile(page);
  await page.route("http://localhost:4000/customers/cust-1/reveal-field", (route) =>
    route.fulfill({ status: 201, json: { field: "nationalId", value: "9901012345" } }),
  );

  await page.goto("/customers/cust-1");
  await expect(page.getByRole("heading", { name: "Ahmad Al-Fulani" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reveal", exact: true }),
  ).toHaveCount(3);
  await expect(
    page.locator('[data-field="nationalId"]').getByRole("button", {
      name: "Reveal",
      exact: true,
    }),
  ).toHaveCount(1);

  await page.getByRole("button", { name: "Reveal", exact: true }).first().click();
  await page
    .getByLabel(/Justification for revealing nationalId/)
    .fill("KYC identity verification against the passport on file");
  await page.getByRole("button", { name: "Confirm reveal" }).click();
  await expect(page.getByText("9901012345")).toBeVisible();
});

test("customer list and profile screens have no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/customers", (route) =>
    route.fulfill({ status: 200, json: paged([CUSTOMER]) }),
  );
  await page.route("http://localhost:4000/customers/cust-1", (route) =>
    route.fulfill({ status: 200, json: CUSTOMER }),
  );
  await page.route("http://localhost:4000/customers/cust-1/ubos", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route("http://localhost:4000/customers/cust-1/documents", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route("http://localhost:4000/consent-records**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route("http://localhost:4000/privacy-notices/current**", (route) =>
    route.fulfill({ status: 200, json: { notice: null } }),
  );

  await page.goto("/customers");
  await expect(page.getByText("Ahmad Al-Fulani")).toBeVisible();
  const listResults = await new AxeBuilder({ page }).analyze();
  expect(listResults.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);

  await page.goto("/customers/cust-1");
  await expect(page.getByRole("heading", { name: "Ahmad Al-Fulani" })).toBeVisible();
  const profileResults = await new AxeBuilder({ page }).analyze();
  expect(profileResults.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual(
    [],
  );
});
