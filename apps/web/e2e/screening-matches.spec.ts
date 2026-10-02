import { expect, test, type Page } from "@playwright/test";
import { expectNone } from "./support/anchored";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";

// Process 49 — the sanctions match review queue.
//
// This screen is the ENTIRE justification for fuzzy matching. Containment
// matching over-fires by construction, which is only a defensible trade if a
// person actually adjudicates the output; that person works here. So the
// behaviour worth pinning is not the table markup, it is:
//
//   * an EMPTY queue is ambiguous, and the screen must say which kind of empty
//     it is — "nothing matched" or "nothing was ever checked". Every
//     deployment of this system is currently the second kind, because the
//     watchlist sync has never been run.
//   * a decision cannot be recorded without a written reason.
//   * a non-reviewer can read the queue but not adjudicate it.
//
// Follows the four-state screenshot convention established by
// four-state-screenshots.spec.ts (plain `page.screenshot()` evidence, no
// pixel-diff baseline — the same reasoning about a bilingual RTL/LTR app).

const ME_BASE = {
  id: "user-1",
  email: "officer@ibms.test",
  fullName: "Verification Officer",
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
      json: { ...ME_BASE, roles, languagePreference, permissions: permissionsForRoles(roles) },
    }),
  );
}

async function capture(page: Page, state: string) {
  await page.screenshot({
    path: `test-results/four-state-screenshots/screening-matches/${state}.png`,
    fullPage: true,
  });
}

function matchRow(over: Record<string, unknown> = {}) {
  return {
    id: "sm-1",
    kycRecordId: "kyc-1",
    customerId: "cust-1",
    customerLegalName: "Acme Trading Co.",
    customerStatus: "ACTIVE",
    kycStatus: "APPROVED",
    isEdd: true,
    subjectName: "Ahmad Khalid Yousef Al Hashimi",
    matchType: "fuzzy",
    status: "pending",
    detectedAt: "2026-09-10T00:00:00.000Z",
    reviewedByUserId: null,
    reviewedAt: null,
    reviewReason: null,
    listSource: "OFAC_SDN (SDGT)",
    listEntryName: "AHMAD AL HASHIMI",
    listEntryRemarks: null,
    listEntryDelisted: false,
    /* THE CASE WORKFLOW, which this fixture did not carry and the endpoint did
     * not return (IMPROVEMENTS § 1.62).
     *
     * Defaulted to UNDER_REVIEW — a case somebody has picked up — because the
     * decision tests below are about the DECISION, and the API refuses one
     * unless the case is UNDER_REVIEW or ESCALATED. Before this field existed
     * those tests passed against a mocked `/review` while the real endpoint
     * would have returned 422 every time: the mock was what hid it. */
    caseStatus: "UNDER_REVIEW",
    assignedToUserId: "user-1",
    assignedAt: "2026-09-11T00:00:00.000Z",
    reviewStartedAt: "2026-09-11T09:00:00.000Z",
    escalatedToUserId: null,
    escalatedAt: null,
    escalationReason: null,
    ...over,
  };
}

const REVIEWERS = [
  { id: "user-1", fullName: "Compliance Officer" },
  { id: "user-2", fullName: "Senior Compliance Officer" },
];

/** The assignee picker's source. Mocked on every queue test because the screen
 * loads it once for any reader holding the screening permission. */
async function mockReviewers(
  page: Page,
  rows: { id: string; fullName: string }[] = REVIEWERS,
) {
  await page.route("**/screening/reviewers", (route) =>
    route.fulfill({ status: 200, json: rows }),
  );
}

/** Every case-workflow POST, captured so assertions are about the wire rather
 * than about a button having been clickable. */
async function captureCaseCalls(page: Page) {
  const calls: { url: string; body: unknown }[] = [];
  for (const path of ["assign", "start-review", "escalate", "notes"]) {
    await page.route(`**/screening/matches/*/${path}`, (route) => {
      calls.push({
        url: route.request().url(),
        body: route.request().postDataJSON(),
      });
      return route.fulfill({ status: 201, json: matchRow() });
    });
  }
  return calls;
}

async function mockQueue(
  page: Page,
  rows: Record<string, unknown>[],
  watchlistReady = true,
) {
  await page.route("**/screening/matches/pending-count", (route) =>
    route.fulfill({
      status: 200,
      json: { pending: rows.length, watchlistReady },
    }),
  );
  await page.route("**/screening/matches?*", (route) =>
    route.fulfill({ status: 200, json: rows }),
  );
  // Loaded by the screen for any reader who can review, so it is part of the
  // queue mock rather than something each test remembers separately.
  await mockReviewers(page);
}

test("warns that an empty queue means nothing was CHECKED, not nothing matched", async ({
  page,
}) => {
  // The state every deployment of this system is actually in today. Without
  // this banner a Compliance Officer reads a clean screen as reassurance.
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockQueue(page, [], false);

  await page.goto("/screening-matches");

  await expect(page.getByText("Nothing awaiting review.")).toBeVisible();
  const warning = page.getByRole("alert").filter({ hasText: "EMPTY" });
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("has never run");
  await expect(warning).toContainText("does NOT mean there are no matches");

  // AND THE INTRO SENTENCE IS GONE. It reads "Names are checked against the synced OFAC and UN
  // sanctions lists" in the PRESENT TENSE, and it used to render unconditionally — so with an empty
  // list the screen asserted it and then retracted it in the alert above, relying on the reader
  // reaching the second. The alert being louder is not a reason to leave a false sentence standing.
  // Anchored on the warning, so this cannot pass on a page that rendered neither.
  await expectNone(page.getByText("Names are checked against", { exact: false }), warning);
  await capture(page, "empty-watchlist-never-synced");
});

test("does NOT warn when the watchlist is populated and the queue is genuinely clear", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockQueue(page, [], true);

  await page.goto("/screening-matches");

  await expect(page.getByText("Nothing awaiting review.")).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "EMPTY" }),
  ).toHaveCount(0);
  // AND THE INTRO SENTENCE IS PRESENT, because here it is TRUE. Without this half, hiding the sentence
  // in every state would pass the test above — the fix would be "delete it" rather than "condition it".
  await expect(
    page.getByText("Names are checked against", { exact: false }),
  ).toBeVisible();
  await capture(page, "empty");
});

test("shows a pending fuzzy match and refuses a decision without a written reason", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockQueue(page, [matchRow()]);

  await page.goto("/screening-matches");

  await expect(page.getByText("Acme Trading Co.")).toBeVisible();
  await expect(page.getByText("Ahmad Khalid Yousef Al Hashimi")).toBeVisible();
  await expect(page.getByText("AHMAD AL HASHIMI")).toBeVisible();
  await expect(page.getByText("OFAC_SDN (SDGT)")).toBeVisible();
  // "EDD" also appears inside "Enhanced due diligence"-adjacent copy, so scope
  // the assertion to the customer cell rather than the whole page.
  await expect(
    page.getByRole("cell", { name: "Acme Trading Co." }).getByText("EDD"),
  ).toBeVisible();

  // The reason IS the control — it is the record a regulator asks for when
  // questioning why a name that matched a sanctions list was let through. Both
  // buttons stay disabled until one is written.
  const clear = page.getByRole("button", { name: "Clear (false positive)" });
  const confirm = page.getByRole("button", { name: "Confirm match" });
  await expect(clear).toBeDisabled();
  await expect(confirm).toBeDisabled();

  const reason = page.getByLabel(
    "Review reason for Ahmad Khalid Yousef Al Hashimi",
  );
  await reason.fill("too short");
  await expect(clear).toBeDisabled();

  await reason.fill(
    "Different date of birth and nationality; not the listed individual.",
  );
  await expect(clear).toBeEnabled();
  await expect(confirm).toBeEnabled();
  await capture(page, "populated");
});

test("records a decision and sends the written reason to the API", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockQueue(page, [matchRow()]);

  let posted: Record<string, unknown> | null = null;
  await page.route("**/screening/matches/sm-1/review", async (route) => {
    posted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      json: matchRow({ status: "cleared", reviewReason: posted.reviewReason }),
    });
  });

  await page.goto("/screening-matches");
  await page
    .getByLabel("Review reason for Ahmad Khalid Yousef Al Hashimi")
    .fill(
      "Different date of birth and nationality; not the listed individual.",
    );
  await page.getByRole("button", { name: "Clear (false positive)" }).click();

  await expect.poll(() => posted).not.toBeNull();
  expect(posted!.decision).toBe("cleared");
  expect(String(posted!.reviewReason)).toContain("Different date of birth");
});

/*
 * THE CASE WORKFLOW — assign, pick up, escalate, annotate.
 *
 * Five routes with no web caller (IMPROVEMENTS § 1.44), and the consequence was
 * not five missing conveniences: the API refuses a decision unless the case is
 * UNDER_REVIEW or ESCALATED, and nothing could reach either state, so every match
 * sat at OPEN and the only control this screen offered returned 422 every time.
 */

test("an OPEN case cannot be decided, says why, and offers the assignment", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockQueue(page, [matchRow({ caseStatus: "OPEN", assignedToUserId: null })]);

  await page.goto("/screening-matches");

  // Anchor: the row rendered for this reader before anything is asserted absent
  // or disabled.
  await expect(page.getByTestId("case-status-sm-1")).toHaveText(
    "Open — nobody assigned",
  );

  // A VALID REASON IS TYPED FIRST, and that is the whole assertion.
  //
  // Without it this test could not fail: the decision button is also disabled
  // while the reason is too short, so asserting `toBeDisabled()` on an empty
  // form proves nothing about the case state. Planting the removal of
  // `caseCanBeDecided` left all 13 tests green, which is § 1.51(d) — a guard
  // whose test cannot observe it. With a valid reason present, the ONLY
  // remaining cause of the disabled button is that the case is not decidable.
  await page
    .getByLabel(/Review reason/i)
    .fill("Checked the identifiers and this is a clear false positive.");
  await expect(
    page.getByRole("button", { name: "Clear (false positive)" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Confirm match" }),
  ).toBeDisabled();
  await expect(page.getByTestId("case-not-decidable-sm-1")).toContainText(
    "Assign the case and start the review",
  );

  // And the way forward is present.
  await expect(page.getByTestId("case-assignee-select-sm-1")).toBeVisible();
});

test("assigns a case to a named reviewer and then starts the review", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockQueue(page, [matchRow({ caseStatus: "OPEN", assignedToUserId: null })]);
  const calls = await captureCaseCalls(page);

  await page.goto("/screening-matches");

  const assign = page.getByTestId("case-assign-sm-1");
  // Nobody chosen yet: the button must not send a request the API would 400.
  await expect(assign).toBeDisabled();

  await page
    .getByTestId("case-assignee-select-sm-1")
    .selectOption("user-2");
  await expect(assign).toBeEnabled();
  await assign.click();

  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0].url).toContain("/screening/matches/sm-1/assign");
  expect(calls[0].body).toEqual({ assigneeUserId: "user-2" });
});

test("starts the review on an assigned case", async ({ page }) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockQueue(page, [matchRow({ caseStatus: "ASSIGNED", reviewStartedAt: null })]);
  const calls = await captureCaseCalls(page);

  await page.goto("/screening-matches");
  // The reviewer's NAME, resolved from the picker source — never the raw uuid,
  // which is the defect the audit screen had.
  await expect(page.getByTestId("case-assignee-sm-1")).toContainText(
    "Compliance Officer",
  );

  await page.getByTestId("case-start-sm-1").click();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0].url).toContain("/screening/matches/sm-1/start-review");
});

test("escalates only with a stated reason of at least ten characters", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockQueue(page, [matchRow()]);
  const calls = await captureCaseCalls(page);

  await page.goto("/screening-matches");
  const escalate = page.getByTestId("case-escalate-sm-1");
  await page.getByTestId("case-escalate-to-sm-1").selectOption("user-2");

  // NINE characters, not zero: a test that types nothing cannot tell a
  // ten-character floor from a non-empty check.
  await page.getByTestId("case-escalate-reason-sm-1").fill("Nine char");
  await expect(escalate).toBeDisabled();
  expect(calls).toHaveLength(0);

  await page
    .getByTestId("case-escalate-reason-sm-1")
    .fill("  Same date of birth as the SDN entry, needs a second opinion  ");
  await expect(escalate).toBeEnabled();
  await escalate.click();

  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0].url).toContain("/screening/matches/sm-1/escalate");
  expect(calls[0].body).toEqual({
    toUserId: "user-2",
    reason: "Same date of birth as the SDN entry, needs a second opinion",
  });
});

test("records a working note and reads the case notes back", async ({ page }) => {
  // The note is the evidence half the AMLU requires kept — "the verification
  // mechanism and actions taken regarding the case" — which a decision reason
  // alone does not carry.
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockQueue(page, [matchRow()]);
  const calls = await captureCaseCalls(page);
  await page.route("**/screening/matches/sm-1/case", (route) =>
    route.fulfill({
      status: 200,
      json: {
        ...matchRow(),
        notes: [
          {
            id: "n-1",
            note: "Passport scan shows a different nationality from the SDN entry.",
            authorUserId: "user-1",
            createdAt: "2026-09-11T10:00:00.000Z",
          },
        ],
      },
    }),
  );

  await page.goto("/screening-matches");

  const add = page.getByTestId("case-note-add-sm-1");
  await expect(add).toBeDisabled();
  await page
    .getByTestId("case-note-sm-1")
    .fill("  Checked the date of birth against the list entry.  ");
  await expect(add).toBeEnabled();
  await add.click();

  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0].url).toContain("/screening/matches/sm-1/notes");
  expect(calls[0].body).toEqual({
    note: "Checked the date of birth against the list entry.",
  });

  // And the trail can be read back on the case.
  await page.getByTestId("case-notes-toggle-sm-1").click();
  await expect(page.getByTestId("case-notes-sm-1")).toContainText(
    "different nationality",
  );
});

test("a one-officer office is told there is nobody to assign to", async ({
  page,
}) => {
  // A real state, and it must read as a sentence rather than an empty dropdown
  // the officer clicks at.
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockQueue(page, [matchRow({ caseStatus: "OPEN", assignedToUserId: null })]);
  await mockReviewers(page, []);

  await page.goto("/screening-matches");
  await expect(page.getByTestId("case-status-sm-1")).toBeVisible();
  await expect(page.getByText("nobody to assign to")).toBeVisible();
  await expect(page.getByTestId("case-assignee-select-sm-1")).toHaveCount(0);
});

test("a non-reviewer can read the queue but cannot adjudicate it", async ({
  page,
}) => {
  await mockAuth(page, ["EXTERNAL_AUDITOR"]);
  await mockQueue(page, [matchRow()]);

  await page.goto("/screening-matches");

  await expect(page.getByText("Acme Trading Co.")).toBeVisible();
  await expect(page.getByText("Compliance Officer only")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Clear (false positive)" }),
  ).toHaveCount(0);
});

test("surfaces a permission failure rather than an empty queue", async ({
  page,
}) => {
  // A 403 rendered as "nothing to review" would be the same class of lie the
  // empty-watchlist banner exists to prevent.
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("**/screening/matches/pending-count", (route) =>
    route.fulfill({ status: 200, json: { pending: 0, watchlistReady: true } }),
  );
  await page.route("**/screening/matches?*", (route) =>
    route.fulfill({ status: 403, json: { message: "Forbidden" } }),
  );

  await page.goto("/screening-matches");

  await expect(
    page.getByRole("alert").filter({ hasText: "sanctions-pep.screen" }),
  ).toBeVisible();
  await expect(page.getByText("Nothing awaiting review.")).toHaveCount(0);
  await capture(page, "error");
});

test("renders the queue in Arabic with RTL direction", async ({ page }) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"], "AR");
  await mockQueue(page, [matchRow()]);

  await page.goto("/screening-matches");

  await expect(
    page.getByRole("heading", { name: "مطابقات العقوبات للمراجعة" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await capture(page, "populated-ar");
});

test("the case workflow controls have no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  // This screen had NO a11y test, and the case panel adds a select and two
  // textareas to every pending row — the controls most likely to ship without a
  // label. Run against an OPEN case, which renders the assignment picker.
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockQueue(page, [matchRow({ caseStatus: "OPEN", assignedToUserId: null })]);

  await page.goto("/screening-matches");
  await expect(page.getByTestId("case-assignee-select-sm-1")).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
