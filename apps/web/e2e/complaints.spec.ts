import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";

const ME_BASE = {
  id: "user-1",
  email: "mgr@ibms.test",
  fullName: "Branch Manager",
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

const COMPLAINTS = [
  {
    id: "c-1",
    customerId: "11111111-1111-1111-1111-111111111111",
    customerName: "Al-Yarmouk Trading Company",
    claimId: "claim-1",
    policyId: null,
    issue: "The settlement was 200 JOD below the assessed amount",
    category: "denied_claim",
    status: "ESCALATED",
    isClosed: false,
    responsibleEmployeeUserId: "u-claims",
    resolution: null,
    resolvedByUserId: null,
    closureApprovedByUserId: null,
    // The endpoint returns this now. Null: nothing has approved this complaint's closure.
    closureCombinedDutyAct: null,
    closedAt: null,
    sla: {
      timerId: "sla-1",
      dueAt: "2026-09-17T00:00:00.000Z",
      escalatedAt: null,
      escalatedTo: "BRANCH_DEPARTMENT_MANAGER",
      resolvedAt: "2026-09-15T00:00:00.000Z",
      breached: false,
    },
    actions: [
      {
        id: "a-1",
        actionText: "Asked the insurer to re-review",
        takenByUserId: "u-claims",
        takenAt: "2026-09-05T00:00:00.000Z",
      },
    ],
    escalations: [
      {
        id: "e-1",
        escalatedTo: "dispute_resolution_committee",
        escalatedByUserId: "u-comp",
        reason: "Insurer non-response after 20 business days",
        escalatedAt: "2026-09-14T00:00:00.000Z",
      },
    ],
    createdAt: "2026-09-03T09:00:00.000Z",
  },
];

async function mockComplaints(
  page: Page,
  opts: { status?: number; complaints?: unknown[] } = {},
) {
  await page.route("http://localhost:4000/complaints**", (route) => {
    if (opts.status && opts.status !== 200) {
      return route.fulfill({ status: opts.status, json: { message: "no" } });
    }
    return route.fulfill({ status: 200, json: opts.complaints ?? COMPLAINTS });
  });
}

test("lists complaints with SLA + escalation state and the log form", async ({
  page,
}) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await mockComplaints(page);

  await page.goto("/complaints");
  await expect(page.getByRole("heading", { name: "Complaints" })).toBeVisible();
  await expect(
    page.getByRole("cell", {
      name: "The settlement was 200 JOD below the assessed amount",
    }),
  ).toBeVisible();
  // The status column now renders a label, not the raw enum token
  // (directive §2). Asserting "Escalated" rather than "ESCALATED" is the
  // point of the change, not an accommodation to it.
  await expect(page.getByRole("cell", { name: "Escalated" })).toBeVisible();
  // `exact` matters: getByRole name matching is case-INSENSITIVE by default,
  // so a bare "ESCALATED" would still match the "Escalated" label and this
  // assertion would prove nothing.
  await expect(
    page.getByRole("cell", { name: "ESCALATED", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Category")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Log complaint" }),
  ).toBeVisible();
  // ESCALATED + Manager -> Start, Resolve visible
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resolve" })).toBeVisible();
});

test("downloads a bilingual acknowledgement PDF for a permitted user", async ({
  page,
}) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await mockComplaints(page);
  await page.route(
    "http://localhost:4000/complaints/c-1/acknowledgement**",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/pdf",
        body: Buffer.from("%PDF-1.4 fake"),
      }),
  );

  await page.goto("/complaints");
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download acknowledgement (PDF)" })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "complaint-acknowledgement-c-1.pdf",
  );
});

test("a user without the permission sees a friendly message", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockComplaints(page, { status: 403 });

  await page.goto("/complaints");
  await expect(
    page.getByText("(complaint.log)", { exact: false }),
  ).toBeVisible();
});

test("complaints screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await mockComplaints(page);

  await page.goto("/complaints");
  await expect(
    page.getByRole("cell", {
      name: "The settlement was 200 JOD below the assessed amount",
    }),
  ).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});

/*
 * THE COMBINED-DUTY ACT ON A COMPLAINT — Part 4 step 5.
 *
 * `Complaint_closure_maker_checker_distinct` requires that whoever RESOLVES a complaint is not whoever
 * approves its closure. **A closed complaint is the record a regulator reads to see the office answered
 * its customer** — and the status cell reads CLOSED whether one person or two signed it off, which is
 * why the ordinary-case test asserts CLOSED IS shown rather than asserting silence alone.
 */

/** Resolved AND closure-approved by the same person, with the reason they gave. */
const SELF_CLOSED = {
  ...COMPLAINTS[0],
  id: "c-9",
  status: "CLOSED",
  isClosed: true,
  resolution: "Insurer re-reviewed and paid the 200 JOD difference.",
  resolvedByUserId: "user-1",
  closureApprovedByUserId: "user-1",
  closureCombinedDutyAct: {
    id: "cda-c-1",
    at: "2026-09-16T00:00:00.000Z",
    actorUserId: "user-1",
    reason:
      "Sole officer covering customer service that week; the SLA deadline fell inside it.",
    pair: "Complaint_closure_maker_checker_distinct",
    roles: ["BRANCH_DEPARTMENT_MANAGER"],
    hatAmbiguous: false,
  },
  closedAt: "2026-09-16T00:00:00.000Z",
};

test("shows that one person both resolved and closed a complaint, and why", async ({
  page,
}) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await mockComplaints(page, { complaints: [SELF_CLOSED] });

  await page.goto("/complaints");
  const declared = page.getByTestId("combined-duty-complaint-c-9");
  await expect(declared).toContainText("BRANCH_DEPARTMENT_MANAGER");
  await expect(declared).toContainText(
    "Sole officer covering customer service",
  );
  // Tied to the database rule it excuses, so the record and the constraint cannot drift apart.
  await expect(declared).toHaveAttribute(
    "data-combined-duty-pair",
    "Complaint_closure_maker_checker_distinct",
  );
});

test("prints Closed and declares nothing when two people signed the closure off", async ({
  page,
}) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await mockComplaints(page, {
    // Resolved by one person, closure-approved by ANOTHER — the ordinary case.
    complaints: [
      {
        ...SELF_CLOSED,
        id: "c-10",
        closureApprovedByUserId: "user-9",
        closureCombinedDutyAct: null,
      },
    ],
  });

  await page.goto("/complaints");
  // The POSITIVE claim is the anchor: the cell reads Closed, which is true of a two-person closure.
  // Asserting silence alone would pass on a cell that had stopped rendering the declaration at all.
  await expect(
    page.getByRole("cell", { name: "Closed", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("combined-duty-complaint-c-10")).toHaveCount(0);
});

test("RULE 2 — the Customer column names the customer, and never shows the id", async ({
  page,
}) => {
  /*
   * MEASURED BEFORE THIS WAS WRITTEN: with the screen changed and the build forced, every existing
   * test in this file still passed — nothing was looking at the Customer column, so the column
   * rendering eight characters of a uuid had no observer at all and neither would the fix.
   *
   * ASSERTED AS A PAIR. The name alone passes against a screen that renders BOTH, and the absence
   * alone passes against a screen that renders NEITHER — which is what an empty cell looks like.
   */
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await mockComplaints(page);

  await page.goto("/complaints");

  const main = page.locator("main");
  await expect(main).toContainText("Al-Yarmouk Trading Company");
  await expect(main).not.toContainText("11111111");
});

/*
 * «لما أبحث أول مرة عملية البحث ممتازة، بس لما أبحث كمان مرة بتعلّق ما بتظهر اشي،
 *  وبتطلع هاي الرسالة "customerId must be a UUID"»
 * — the owner's walk, 2026-10-26, on this screen.
 *
 * ONE omission produced every clause. `EntitySearch.clear()` resets the cached
 * option and the typed term, and it is only ever called by the Clear BUTTON. This
 * screen clears the selection the other way — `setCustomerId('')` after a
 * successful create — and the cached option was left behind, after which the
 * search effect's own first line (`if (chosen !== null) return`) meant it NEVER
 * SEARCHED AGAIN, the box still displayed the previous customer's name for an id
 * the form no longer held, that non-empty text satisfied `required`, and the
 * submit carried `customerId: ''`.
 *
 * The existing "clearing the field clears the SELECTION" test covers the Clear
 * button. Nothing covered the caller clearing it, which is what every create form
 * in this app does.
 */
async function mockCustomerSearch(page: Page) {
  await page.route("http://localhost:4000/customers/search**", (route) =>
    route.fulfill({
      status: 200,
      json: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          legalName: "Al-Yarmouk Trading Company",
          customerType: "CORPORATE",
          status: "ACTIVE",
          registrationNumber: "REG-9",
          taxRegistrationNumber: null,
        },
      ],
    }),
  );
}

test("finds a customer on the SECOND search too, after a complaint was logged", async ({
  page,
}) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await mockComplaints(page);
  await mockCustomerSearch(page);
  const posted: unknown[] = [];
  await page.route("http://localhost:4000/complaints", (route) => {
    if (route.request().method() !== "POST") {
      return route.fulfill({ status: 200, json: COMPLAINTS });
    }
    posted.push(route.request().postDataJSON());
    return route.fulfill({ status: 201, json: COMPLAINTS[0] });
  });

  await page.goto("/complaints");

  const field = page.locator('[data-entity-search-term="customer"]');
  const list = page.locator('[data-entity-search-list="customer"]');

  // FIRST search — her words: «عملية البحث ممتازة».
  await field.fill("Yar");
  await expect(list).toBeVisible();
  await field.press("Enter");
  await expect(field).toHaveValue("Al-Yarmouk Trading Company");

  await page
    .getByRole("textbox", { name: "Issue", exact: true })
    .fill("The insurer has not replied for three weeks.");
  await page.getByRole("button", { name: "Log complaint" }).click();

  // The id reached the server, which is the half that was already working.
  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0]).toMatchObject({
    customerId: "11111111-1111-1111-1111-111111111111",
  });

  // THE FIELD FOLLOWED THE CALLER'S CLEAR. Before this it still read
  // "Al-Yarmouk Trading Company" for an id the form no longer held.
  await expect(field).toHaveValue("");

  // AND THE SECOND SEARCH WORKS. This is «بتعلّق ما بتظهر اشي» — the effect used
  // to return early for ever on the stale cached option, so no list could appear.
  await field.fill("Yar");
  await expect(list).toBeVisible();
  await expect(
    page.locator('[data-entity-search-option="11111111-1111-1111-1111-111111111111"]'),
  ).toBeVisible();
});

/*
 * «وبتطلع هاي الرسالة "customerId must be a UUID"» — and her instruction with it:
 * no raw validator text may surface as UI copy anywhere.
 *
 * That sentence is Nest's ValidationPipe naming OUR OWN COLUMN, in English, on an
 * Arabic-first screen. Fixing the field above removes the route she took to it;
 * this asserts it cannot be rendered even when the server sends one, because a
 * 400 is reachable by other means and the rule she gave is absolute.
 *
 * The discriminator is structural rather than a pattern match on the text: the
 * validation pipe is the only thing in this api that returns `message` as an
 * ARRAY, so the shape of the body IS the test. See `lib/i18n/action-error.ts`.
 */
test("a validation complaint naming one of our columns never reaches the screen", async ({
  page,
}) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await mockComplaints(page);
  await mockCustomerSearch(page);
  await page.route("http://localhost:4000/complaints", (route) => {
    if (route.request().method() !== "POST") {
      return route.fulfill({ status: 200, json: COMPLAINTS });
    }
    return route.fulfill({
      status: 400,
      json: {
        statusCode: 400,
        message: ["customerId must be a UUID", "issue should not be empty"],
        error: "Bad Request",
      },
    });
  });

  await page.goto("/complaints");
  const field = page.locator('[data-entity-search-term="customer"]');
  await field.fill("Yar");
  await expect(page.locator('[data-entity-search-list="customer"]')).toBeVisible();
  await field.press("Enter");
  await page
    .getByRole("textbox", { name: "Issue", exact: true })
    .fill("The insurer has not replied for three weeks.");
  await page.getByRole("button", { name: "Log complaint" }).click();

  const alert = page.locator("main").getByRole("alert");
  await expect(alert).toContainText("That action failed");
  // The two halves asserted separately: our column name, and the framework's
  // phrasing. A reword of either must still not reach her.
  await expect(alert).not.toContainText("customerId");
  await expect(alert).not.toContainText("must be a UUID");
});
