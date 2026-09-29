import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";
import { expectNone } from "./support/anchored";

const ME_BASE = {
  id: "user-1",
  email: "reviewer@ibms.test",
  fullName: "Compliance Reviewer",
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
  // The administrator-record section renders for ANY role holding
  // `access-recertification.cycle.start`, which COMPLIANCE_OFFICER does — so every test on this
  // screen needs these two reads answered or the section reports a load failure and puts an
  // extra role="alert" on the page. Defaults to NO cycles, which is the quiet state; a test
  // about the record registers its own routes afterwards, and the later registration wins.
  await page.route(
    "http://localhost:4000/access-recertification/cycles",
    (route) => route.fulfill({ status: 200, json: [] }),
  );
}

const CYCLES = [
  {
    id: "cycle-2",
    cycleLabel: "Q2-2026",
    startedAt: "2026-04-01T00:00:00.000Z",
    dueAt: "2026-04-22T00:00:00.000Z",
    closedAt: null,
  },
  {
    id: "cycle-1",
    cycleLabel: "Q1-2026",
    startedAt: "2026-01-01T00:00:00.000Z",
    dueAt: "2026-01-22T00:00:00.000Z",
    closedAt: "2026-01-20T00:00:00.000Z",
  },
];

/** An administrator subject reviewed by somebody else, and one who reviewed themselves. */
const ADMIN_ITEMS = [
  {
    id: "admin-item-1",
    cycleId: "cycle-2",
    cycleLabel: "Q2-2026",
    subjectUserId: "admin-1",
    subjectFullName: "Office Administrator",
    subjectEmail: "oa@ibms.test",
    subjectRoles: ["OFFICE_ADMINISTRATOR"],
    subjectIsUserAdministrator: true,
    reviewerUserId: "reviewer-9",
    reviewerFullName: "Compliance Reviewer",
    decision: "confirmed",
    reviewedAt: "2026-04-05T00:00:00.000Z",
    // The endpoint returns both now. Null: no declaration on either the arrangement or the decision.
    arrangementCombinedDutyAct: null,
    decisionCombinedDutyAct: null,
    createdAt: "2026-04-01T00:00:00.000Z",
  },
  {
    id: "admin-item-2",
    cycleId: "cycle-2",
    cycleLabel: "Q2-2026",
    subjectUserId: "admin-2",
    subjectFullName: "Security Administrator",
    subjectEmail: "sa@ibms.test",
    subjectRoles: ["SYSTEM_SECURITY_ADMINISTRATOR"],
    subjectIsUserAdministrator: true,
    // Reviewer IS the subject — a declared self-review the office allowed.
    reviewerUserId: "admin-2",
    reviewerFullName: "Security Administrator",
    decision: null,
    reviewedAt: null,
    // The endpoint returns both now. Null: no declaration on either the arrangement or the decision.
    arrangementCombinedDutyAct: null,
    decisionCombinedDutyAct: null,
    createdAt: "2026-04-01T00:00:00.000Z",
  },
];

/** The record's two reads, with the cycle list non-empty. Registered AFTER mockAuth so it wins. */
async function mockAdminRecord(
  page: Page,
  itemsByCycle: Record<string, unknown[]>,
) {
  await page.route(
    "http://localhost:4000/access-recertification/cycles",
    (route) => route.fulfill({ status: 200, json: CYCLES }),
  );
  await page.route(
    "http://localhost:4000/access-recertification/cycles/*/admin-items",
    (route) => {
      const match = /\/cycles\/([^/]+)\/admin-items/.exec(
        route.request().url(),
      );
      const id = match?.[1] ?? "";
      return route.fulfill({ status: 200, json: itemsByCycle[id] ?? [] });
    },
  );
}

const ITEMS = [
  {
    id: "item-1",
    cycleId: "cycle-1",
    cycleLabel: "Q1-2026",
    subjectUserId: "subject-1",
    subjectFullName: "Sales Officer",
    subjectEmail: "sales@ibms.test",
    subjectRoles: ["SALES_RELATIONSHIP_OFFICER"],
    // Phase 2 — the admin badge is a SERVER-supplied fact now, not derived from
    // the role names. A client cannot answer "can this subject administer
    // users?" once role names are office-chosen.
    subjectIsUserAdministrator: false,
    reviewerUserId: "user-1",
    reviewerFullName: "Compliance Reviewer",
    decision: null,
    reviewedAt: null,
    // The endpoint returns both now. Null: no declaration on either the arrangement or the decision.
    arrangementCombinedDutyAct: null,
    decisionCombinedDutyAct: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "item-2",
    cycleId: "cycle-1",
    cycleLabel: "Q1-2026",
    subjectUserId: "subject-2",
    subjectFullName: "Admin Person",
    subjectEmail: "admin@ibms.test",
    subjectRoles: ["SYSTEM_SECURITY_ADMINISTRATOR"],
    subjectIsUserAdministrator: true,
    reviewerUserId: "user-1",
    reviewerFullName: "Compliance Reviewer",
    decision: null,
    reviewedAt: null,
    // The endpoint returns both now. Null: no declaration on either the arrangement or the decision.
    arrangementCombinedDutyAct: null,
    decisionCombinedDutyAct: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

test("renders the review queue with subject details and an admin badge", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("**/access-recertification/items", (route) =>
    route.fulfill({ status: 200, json: ITEMS }),
  );

  await page.goto("/access-recertification");

  await expect(
    page.getByRole("heading", { name: "Access recertification" }),
  ).toBeVisible();
  await expect(page.getByText("Sales Officer")).toBeVisible();
  await expect(page.getByText("sales@ibms.test")).toBeVisible();
  await expect(
    page.getByText("Admin access — not exempt from review"),
  ).toBeVisible();
});

test("shows the start-cycle form for a Compliance Officer, but not for a Sales Officer", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("**/access-recertification/items", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.goto("/access-recertification");
  await expect(
    page.getByRole("heading", { name: "Start a new recertification cycle" }),
  ).toBeVisible();

  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.goto("/access-recertification");
  await expect(
    page.getByRole("heading", { name: "Start a new recertification cycle" }),
  ).toHaveCount(0);
});

test("shows an empty state when nothing is assigned for review", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("**/access-recertification/items", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );

  await page.goto("/access-recertification");

  await expect(
    page.getByText(
      "No access-recertification items are currently assigned to you for review.",
    ),
  ).toBeVisible();
});

test("shows a friendly message when the user lacks review permission", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("**/access-recertification/items", (route) =>
    route.fulfill({
      status: 403,
      json: {
        message: "You do not hold a permission required to perform this action",
      },
    }),
  );

  await page.goto("/access-recertification");

  await expect(page.locator('p[role="alert"]')).toContainText(
    "don't hold the access-recertification.review",
  );
});

/**
 * An EXACT permission set with a declared mode — the same reason `payment-channels.spec.ts` needs one.
 *
 * No role name can express "reviewing my OWN access in an office that has declared combined duties", and
 * that is the only state in which the owner's Option 2 is visible on screen.
 */
async function mockAuthCombined(page: Page) {
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fake-access-token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      status: 200,
      json: {
        ...ME_BASE,
        roles: ["COMPLIANCE_OFFICER"],
        permissions: permissionsForRoles(["COMPLIANCE_OFFICER"]),
        dutySegregationMode: "COMBINED",
      },
    }),
  );
}

test("reviewing your OWN access asks why, and refuses until it is answered", async ({
  page,
}) => {
  // The owner chose Option 2: she is asked again at the review itself, so the flagged line in the
  // self-approval report is dated to the act rather than to the arrangement.
  await mockAuthCombined(page);
  const ownItem = {
    ...ITEMS[0],
    subjectUserId: ME_BASE.id,
    subjectFullName: "Compliance Officer",
  };
  await page.route("**/access-recertification/items", (route) =>
    route.fulfill({ status: 200, json: [ownItem] }),
  );
  const sent: string[] = [];
  await page.route(
    "**/access-recertification/items/item-1/decision",
    (route) => {
      sent.push(route.request().postData() ?? "");
      return route.fulfill({
        status: 201,
        json: {
          id: "item-1",
          cycleId: "cycle-1",
          subjectUserId: ME_BASE.id,
          reviewerUserId: ME_BASE.id,
          decision: "confirmed",
          reviewedAt: "2026-03-14T00:00:00.000Z",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      });
    },
  );

  await page.goto("/access-recertification");

  const reason = page.getByTestId("combined-duty-reason-item-1");
  await expect(reason).toBeVisible();
  const confirm = page.getByRole("button", { name: "Confirm" });
  // Refused until answered — all three decision buttons, because three buttons are three ways to send a
  // request the screen already knows will be refused.
  await expect(confirm).toBeDisabled();
  await expect(page.getByRole("button", { name: "Revoke" })).toBeDisabled();

  await reason.fill("too short");
  await expect(confirm).toBeDisabled();

  await reason.fill("  Still the only person in this office.  ");
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect
    .poll(() => sent.length, { message: "no decision was sent" })
    .toBeGreaterThan(0);
  expect(JSON.parse(sent[0]!)).toEqual({
    decision: "confirmed",
    // Trimmed: the surrounding whitespace is not part of what she said.
    combinedDutyReason: "Still the only person in this office.",
  });
});

test("reviewing SOMEBODY ELSE's access asks nothing, on the same screen", async ({
  page,
}) => {
  // The other half, anchored on the enabled button from the SAME render — an absence satisfied by an
  // unhydrated page would pass while proving nothing.
  await mockAuthCombined(page);
  await page.route("**/access-recertification/items", (route) =>
    route.fulfill({ status: 200, json: [ITEMS[0]] }),
  );

  await page.goto("/access-recertification");
  const confirm = page.getByRole("button", { name: "Confirm" });
  await expect(confirm).toBeEnabled();
  await expectNone(page.getByTestId("combined-duty-reason-item-1"), confirm);
});

test("lets a reviewer confirm an item, which then shows as decided", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("**/access-recertification/items", (route) =>
    route.fulfill({ status: 200, json: [ITEMS[0]] }),
  );
  // The real endpoint returns the raw AccessRecertificationItem, not the
  // enriched shape GET .../items returns — no subjectFullName/subjectRoles/
  // cycleLabel. Mocking the full enriched item here previously masked a
  // real crash (the row read item.subjectRoles.includes(...) after this
  // response replaced the row wholesale) that only showed up against the
  // real backend.
  await page.route("**/access-recertification/items/item-1/decision", (route) =>
    route.fulfill({
      status: 201,
      json: {
        id: "item-1",
        cycleId: "cycle-1",
        subjectUserId: "subject-1",
        reviewerUserId: "user-1",
        decision: "confirmed",
        reviewedAt: "2026-01-02T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    }),
  );

  await page.goto("/access-recertification");
  await page
    .getByRole("button", { name: "Confirm access for Sales Officer" })
    .click();

  await expect(page.getByText("Confirmed")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm access for Sales Officer" }),
  ).toHaveCount(0);
  // The row must survive the update without crashing — its enriched fields
  // (only present in the original GET response) should still render.
  await expect(page.getByText("SALES RELATIONSHIP OFFICER")).toBeVisible();
});

/*
 * THE ADMINISTRATOR ACCESS REVIEW RECORD — `GET /cycles/:id/admin-items`, which had no web
 * caller.
 *
 * Part 5.1 is explicit that whoever can administer users is NOT exempt from recertification of
 * their own access. This is the record proving they were covered, and nobody could read it.
 */

test("shows which administrator accounts a cycle covered, and who reviewed each", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("**/access-recertification/items", (route) =>
    route.fulfill({ status: 200, json: ITEMS }),
  );
  await mockAdminRecord(page, { "cycle-2": ADMIN_ITEMS });
  await page.goto("/access-recertification");

  const record = page.getByTestId("admin-access-record");
  await expect(record.getByRole("heading")).toHaveText(
    "Administrator access review record",
  );

  // The SUBJECT by name, and the REVIEWER by name. The route returned raw uuids for both until
  // this section existed, which is unreadable by the only person who would ask.
  await expect(record).toContainText("Office Administrator");
  await expect(record).toContainText("Compliance Reviewer");
  await expect(page.getByTestId("admin-decision-admin-item-1")).toHaveText(
    "Confirmed",
  );
  // An undecided administrator row says so rather than rendering blank — "not reviewed" is the
  // answer this record exists to surface.
  await expect(page.getByTestId("admin-decision-admin-item-2")).toHaveText(
    "Not yet reviewed",
  );
});

test("marks an administrator who reviewed their own access", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("**/access-recertification/items", (route) =>
    route.fulfill({ status: 200, json: ITEMS }),
  );
  await mockAdminRecord(page, { "cycle-2": ADMIN_ITEMS });
  await page.goto("/access-recertification");

  // Anchored on the other row first, so the absence below cannot pass on an unrendered table.
  await expect(page.getByTestId("admin-decision-admin-item-1")).toHaveText(
    "Confirmed",
  );
  await expect(page.getByTestId("self-review-admin-item-2")).toContainText(
    "reviewed their own access",
  );
  // The row reviewed by somebody else must NOT be marked, or the mark says nothing.
  await expect(page.getByTestId("self-review-admin-item-1")).toHaveCount(0);
});

test("warns, rather than showing an empty table, when a cycle covered no administrator", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("**/access-recertification/items", (route) =>
    route.fulfill({ status: 200, json: ITEMS }),
  );
  // Q1 covered nobody who can administer users. That is the condition Part 5.1 exists to
  // prevent, so it must not read as "nothing to see".
  await mockAdminRecord(page, { "cycle-2": ADMIN_ITEMS, "cycle-1": [] });
  await page.goto("/access-recertification");

  // Start from the cycle that DOES have rows, so the switch below is observable.
  await expect(page.getByTestId("admin-decision-admin-item-1")).toBeVisible();

  await page.getByTestId("admin-record-cycle").selectOption("cycle-1");
  await expect(page.getByTestId("admin-record-none")).toContainText(
    "covered no administrator account",
  );
  await expect(page.getByTestId("admin-decision-admin-item-1")).toHaveCount(0);
});

test("asks about an EARLIER cycle, not only the one just started", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("**/access-recertification/items", (route) =>
    route.fulfill({ status: 200, json: ITEMS }),
  );
  const earlier = [
    {
      ...ADMIN_ITEMS[0]!,
      id: "admin-item-old",
      cycleId: "cycle-1",
      cycleLabel: "Q1-2026",
      subjectFullName: "Former Administrator",
      reviewerFullName: "Executive Manager",
    },
  ];
  await mockAdminRecord(page, { "cycle-2": ADMIN_ITEMS, "cycle-1": earlier });
  await page.goto("/access-recertification");

  // Defaults to the newest cycle, which is what somebody opening the section is asking about.
  await expect(page.getByTestId("admin-record-cycle")).toHaveValue("cycle-2");

  // The audit-time question is about a cycle that closed months ago. Before the cycles list
  // existed the only obtainable id was the one from the start-cycle response, so this was
  // unanswerable.
  await page.getByTestId("admin-record-cycle").selectOption("cycle-1");
  await expect(page.getByTestId("admin-access-record")).toContainText(
    "Former Administrator",
  );
  await expect(page.getByTestId("admin-access-record")).toContainText(
    "Executive Manager",
  );
});

test("a reviewer who cannot start cycles is not shown the administrator record", async ({
  page,
}) => {
  // BRANCH_DEPARTMENT_MANAGER holds `access-recertification.review` and NOT `.cycle.start` —
  // measured from the seeded grid. The record is gated on the same code as the route.
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await page.route("**/access-recertification/items", (route) =>
    route.fulfill({ status: 200, json: ITEMS }),
  );
  await mockAdminRecord(page, { "cycle-2": ADMIN_ITEMS });
  await page.goto("/access-recertification");

  // Anchored on their OWN queue rendering, so the absence is not satisfied by an unmounted page.
  await expect(page.getByText("Sales Officer")).toBeVisible();
  await expect(page.getByTestId("admin-access-record")).toHaveCount(0);
});

test("access-recertification page has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("**/access-recertification/items", (route) =>
    route.fulfill({ status: 200, json: ITEMS }),
  );

  await page.goto("/access-recertification");
  await expect(page.getByText("Sales Officer")).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  const seriousOrCritical = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(seriousOrCritical).toEqual([]);
});

test("decision buttons for a row are reachable via keyboard", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("**/access-recertification/items", (route) =>
    route.fulfill({ status: 200, json: [ITEMS[0]] }),
  );

  await page.goto("/access-recertification");
  const confirmButton = page.getByRole("button", {
    name: "Confirm access for Sales Officer",
  });
  await confirmButton.focus();
  await expect(confirmButton).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Revoke access for Sales Officer" }),
  ).toBeFocused();
});

/*
 * THE TWO COMBINED-DUTY RECORDS ON AN ACCESS RECERTIFICATION — Part 4 step 5, the last of the fifteen.
 *
 * `AccessRecertificationItem_maker_checker_distinct` requires that the SUBJECT of a review is not its
 * REVIEWER. It is the only row of the fifteen where the pair has TWO relations, and they are not two
 * pairs:
 *
 *   the ARRANGEMENT — she was SET TO review her own access. Written when the CYCLE OPENED, and in a
 *                     one-person office it is the only way a cycle can start at all. It says the office
 *                     had nobody else to ask; it does not say anybody signed off.
 *   the DECISION    — she DID review it, dated to the review. Evidence, and the act a reader wants.
 *
 * The third test below is the one that earns its place: an arrangement with NO decision yet must show the
 * first and not the second. Collapsing the two would report a cycle that merely could not do better as if
 * somebody had signed off on their own access — and the administrator record is exactly where a reader
 * must not be misled about that.
 */

const ARRANGEMENT_ACT = {
  id: "cda-acr-arr",
  at: "2026-04-01T00:00:00.000Z",
  actorUserId: "admin-2",
  reason:
    "This office employs one administrator, so no colleague can review her access.",
  pair: "AccessRecertificationItem_maker_checker_distinct",
  roles: ["SYSTEM_SECURITY_ADMINISTRATOR"],
  hatAmbiguous: false,
};

const DECISION_ACT = {
  id: "cda-acr-dec",
  at: "2026-04-06T00:00:00.000Z",
  actorUserId: "admin-2",
  reason:
    "Confirmed her own access; every role she holds is still required to run the office.",
  pair: "AccessRecertificationItem_maker_checker_distinct",
  roles: ["SYSTEM_SECURITY_ADMINISTRATOR"],
  hatAmbiguous: false,
};

test("the administrator record shows that a self-review was arranged AND decided", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockAdminRecord(page, {
    "cycle-2": [
      {
        ...ADMIN_ITEMS[1],
        decision: "confirmed",
        reviewedAt: "2026-04-06T00:00:00.000Z",
        arrangementCombinedDutyAct: ARRANGEMENT_ACT,
        decisionCombinedDutyAct: DECISION_ACT,
      },
    ],
  });
  await page.goto("/access-recertification");

  const arrangement = page.getByTestId(
    "combined-duty-admin-arrangement-admin-item-2",
  );
  await expect(arrangement).toContainText("employs one administrator");
  await expect(arrangement).toHaveAttribute(
    "data-combined-duty-pair",
    "AccessRecertificationItem_maker_checker_distinct",
  );

  const decision = page.getByTestId(
    "combined-duty-admin-decision-admin-item-2",
  );
  await expect(decision).toContainText("Confirmed her own access");
});

test("an arranged self-review that nobody has decided yet shows only the arrangement", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockAdminRecord(page, {
    // Exactly ADMIN_ITEMS[1]'s state — set to review herself, decision still null.
    "cycle-2": [
      { ...ADMIN_ITEMS[1], arrangementCombinedDutyAct: ARRANGEMENT_ACT },
    ],
  });
  await page.goto("/access-recertification");

  // THIS IS WHY THERE ARE TWO COLUMNS. The cycle put her in this position; she has not yet confirmed
  // anything. A single merged field would pass the test above and report a decision nobody has made.
  await expect(
    page.getByTestId("combined-duty-admin-arrangement-admin-item-2"),
  ).toBeVisible();
  await expect(
    page.getByTestId("combined-duty-admin-decision-admin-item-2"),
  ).toHaveCount(0);
});

test("an administrator reviewed by somebody else declares nothing", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockAdminRecord(page, { "cycle-2": [ADMIN_ITEMS[0]] });
  await page.goto("/access-recertification");

  // The POSITIVE claim is the anchor: the decision cell reads "Confirmed", which is what a two-person
  // review shows. Asserting silence alone would pass on a cell that stopped rendering either act.
  await expect(page.getByTestId("admin-decision-admin-item-1")).toContainText(
    "Confirmed",
  );
  await expect(
    page.getByTestId("combined-duty-admin-arrangement-admin-item-1"),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("combined-duty-admin-decision-admin-item-1"),
  ).toHaveCount(0);
});
