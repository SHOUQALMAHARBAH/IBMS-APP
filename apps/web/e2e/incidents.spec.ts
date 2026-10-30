import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";

const ME_BASE = {
  id: "user-1",
  email: "dpo@ibms.test",
  fullName: "Data Protection Officer",
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

const INCIDENTS = [
  {
    id: "incident-1",
    title: "Ransomware on a claims workstation",
    description: "A claims officer opened a malicious attachment.",
    severity: "critical",
    status: "CLASSIFIED",
    reportedAt: "2026-09-06T09:00:00.000Z",
    containedAt: "2026-09-06T10:00:00.000Z",
    impactAssessedAt: "2026-09-06T10:30:00.000Z",
    classification: "MATERIAL",
    classifiedByDpoUserId: "user-1",
    seniorManagementCoSignUserId: null,
    // The endpoint returns this now. Null: nothing has co-signed this classification.
    classificationCombinedDutyAct: null,
    seniorManagementNotifiedAt: null,
    notifiedRegulators: [],
    notifiedAt: null,
    affectedDataSubjectsNotifiedAt: null,
    rootCauseAnalysis: null,
    recoveredAt: null,
    closedAt: null,
    isContainmentOverdue: false,
    /*
     * OWNER DECISION 56. These six are not optional padding: the screen reads
     * `inc.containmentActions.length` unconditionally, so a fixture short of the
     * array throws during render and the page shows Chrome's own error document —
     * which looks like a broken selector and is not one.
     *
     * A MOCKED ENDPOINT CANNOT DROP A FIELD THE API SENDS. When an api view's shape
     * changes, every mock moves in the same commit.
     */
    containmentActions: [],
    touchesPersonalData: true,
    dataCategoriesAffected: "Claim files, national identifiers",
    subjectsAffectedEstimate: 412,
    occurredAt: "2026-09-06T08:40:00.000Z",
    reportedByUserId: "user-1",
  },
];

async function mockIncidents(
  page: Page,
  opts: { status?: number; incidents?: unknown[] } = {},
) {
  await page.route("http://localhost:4000/incidents**", (route) => {
    if (opts.status && opts.status !== 200) {
      return route.fulfill({ status: opts.status, json: { message: "no" } });
    }
    return route.fulfill({ status: 200, json: opts.incidents ?? INCIDENTS });
  });
}

test("lists incidents with the classification state and the log form", async ({
  page,
}) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await mockIncidents(page);

  await page.goto("/incidents");
  await expect(
    page.getByRole("heading", { name: "Incident Management" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Ransomware on a claims workstation" }),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: "MATERIAL" })).toBeVisible();
  await expect(page.getByLabel("Incident title")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Report incident" }),
  ).toBeVisible();
  // A DPO can notify Senior Management, but co-signing is Executive
  // Management's own step — the DPO who classified it must not see a
  // Co-sign button that the server would always 403 anyway.
  await expect(
    page.getByRole("button", { name: "Notify Senior Management" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Co-sign (Senior Management)" }),
  ).not.toBeVisible();
});

test("only Executive Management sees the Co-sign control", async ({ page }) => {
  await mockAuth(page, ["EXECUTIVE_MANAGEMENT"]);
  await mockIncidents(page);

  await page.goto("/incidents");
  await expect(
    page.getByRole("cell", { name: "Ransomware on a claims workstation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Co-sign (Senior Management)" }),
  ).toBeVisible();
  // Classifying is the DPO's own step — Executive Management must not see
  // a Classify control the server would always 403.
  await expect(
    page.getByRole("button", { name: "Classify Material" }),
  ).not.toBeVisible();
});

test("a user without the permission sees a friendly message", async ({
  page,
}) => {
  await mockAuth(page, ["POLICY_CHECKING_OFFICER"]);
  await mockIncidents(page, { status: 403 });

  await page.goto("/incidents");
  await expect(
    page.getByText("(incident.report)", { exact: false }),
  ).toBeVisible();
});

test("incidents screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await mockIncidents(page);

  await page.goto("/incidents");
  await expect(
    page.getByRole("cell", { name: "Ransomware on a claims workstation" }),
  ).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});

/*
 * THE COMBINED-DUTY ACT ON AN INCIDENT CLASSIFICATION — Part 4 step 5.
 *
 * `IncidentReport_classification_maker_checker_distinct` requires that whoever CLASSIFIES an incident —
 * the DPO's judgement on whether it is a personal-data breach — is not whoever co-signs that judgement at
 * senior-management level. **This is the decision that a regulator and the affected data subjects either
 * do or do not get told**, and it starts the statutory notification clock.
 *
 * The classification cell reads MATERIAL whether somebody else co-signed or the DPO co-signed her own
 * judgement, which is why the ordinary-case test asserts MATERIAL IS shown rather than asserting silence.
 */

/** Classified AND co-signed by the same person, with the reason they gave. */
const SELF_COSIGNED = {
  ...INCIDENTS[0],
  id: "incident-9",
  seniorManagementCoSignUserId: "user-1",
  classificationCombinedDutyAct: {
    id: "cda-inc-1",
    at: "2026-09-06T11:00:00.000Z",
    actorUserId: "user-1",
    reason:
      "Sole DPO in this office and the 72-hour notification window had already started.",
    pair: "IncidentReport_classification_maker_checker_distinct",
    roles: ["DATA_PROTECTION_OFFICER"],
    hatAmbiguous: false,
  },
};

test("shows that one person both classified and co-signed an incident, and why", async ({
  page,
}) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await mockIncidents(page, { incidents: [SELF_COSIGNED] });

  await page.goto("/incidents");
  const declared = page.getByTestId("combined-duty-incident-incident-9");
  await expect(declared).toContainText("DATA_PROTECTION_OFFICER");
  await expect(declared).toContainText("72-hour notification window");
  // Tied to the database rule it excuses, so the record and the constraint cannot drift apart.
  await expect(declared).toHaveAttribute(
    "data-combined-duty-pair",
    "IncidentReport_classification_maker_checker_distinct",
  );
});

test("prints the classification and declares nothing when two people signed it", async ({
  page,
}) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await mockIncidents(page, {
    // Classified by the DPO, co-signed by ANOTHER person — the ordinary case.
    incidents: [
      {
        ...SELF_COSIGNED,
        id: "incident-10",
        seniorManagementCoSignUserId: "user-9",
        classificationCombinedDutyAct: null,
      },
    ],
  });

  await page.goto("/incidents");
  // The POSITIVE claim is the anchor: the cell reads the classification, which is what a co-signed
  // MATERIAL incident shows. Asserting silence alone would pass on a cell that had stopped rendering
  // the declaration at all.
  await expect(
    page.getByRole("cell", { name: "Material", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByTestId("combined-duty-incident-incident-10"),
  ).toHaveCount(0);
});

/*
 * ==========================================================================
 * OWNER DECISION 56 — THE TWO ACTS COLLECT WHAT THEY CLAIM
 *
 * Her two sentences, which are what these tests are named after:
 *
 *   «بس بغيّر الحالة إلى تم احتوائه»
 *   «بس بظهرلي إنه تم تقييم أثره وأنا ما قيّمت ولا عملت شي»
 *
 * Both acts ran. What was missing was that neither collected anything, so the record
 * said the work had been done and held nothing a person could read back.
 * ==========================================================================
 */

/** Assessed, and BOTH findings are the ones a careless render loses. */
const ASSESSED_NEGATIVE = {
  ...INCIDENTS[0],
  id: "incident-20",
  status: "IMPACT_ASSESSED",
  classification: "NOT_YET_CLASSIFIED",
  classifiedByDpoUserId: null,
  impactAssessedAt: "2026-09-06T10:30:00.000Z",
  // The DPO assessed and found NO personal data, and NOBODY affected. Two real
  // step-4 outputs, and the two values React and JavaScript each quietly discard.
  touchesPersonalData: false,
  dataCategoriesAffected: "Internal build logs only",
  subjectsAffectedEstimate: 0,
};

/** Contained but never assessed — the row that proves the em dash still means something. */
const NEVER_ASSESSED = {
  ...INCIDENTS[0],
  id: "incident-21",
  status: "CONTAINED",
  classification: "NOT_YET_CLASSIFIED",
  classifiedByDpoUserId: null,
  impactAssessedAt: null,
  touchesPersonalData: null,
  dataCategoriesAffected: null,
  subjectsAffectedEstimate: null,
};

test("«ما قيّمت ولا عملت شي» is NOT what `false` and 0 mean — both render as answers", async ({
  page,
}) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await mockIncidents(page, {
    incidents: [ASSESSED_NEGATIVE, NEVER_ASSESSED, INCIDENTS[0]],
  });

  await page.goto("/incidents");

  // `false` is an ANSWER. React renders `false` as nothing and `x ?? '—'` leaves it
  // alone, so either shortcut turns the DPO's finding into a blank cell.
  const negative = page.getByTestId("inc-touches-incident-20");
  await expect(negative).toContainText("No");
  await expect(negative).not.toContainText("—");

  // 0 is an ANSWER. `x || '—'` renders the em dash for 0, which reports that nobody
  // recorded an estimate when somebody recorded that nobody was affected.
  const none = page.getByTestId("inc-subjects-incident-20");
  await expect(none).toContainText("0");
  await expect(none).not.toContainText("—");

  // THE DISCRIMINATOR. Without this the test above passes against a cell that renders
  // the same thing for every row: a never-assessed incident must still read as a gap.
  //
  // RE-POINTED 2026-10-29, AND IT IS A REAL REVERSAL: this asserted the em dash, which
  // was the right assertion while the word did not exist. Owner decision 60 gives this
  // exact case a word — «لم يُقيَّم بعد», *not assessed yet* — because a bare dash on a
  // statutory impact assessment leaves the reader asking *was this forgotten, or does it
  // not apply?*, and the answer decides whether somebody has to go and perform one.
  //
  // The property under test has NOT moved: a never-assessed incident must still read
  // DIFFERENTLY from one whose finding was `false` or `0`. What changed is that the
  // difference is now a sentence rather than a stroke. The absence of the dash is
  // asserted too, so a regression that reverts the word fails here rather than passing
  // on a substring.
  const neverAssessed = page.getByTestId("inc-impact-incident-21");
  await expect(neverAssessed).toHaveText("not assessed yet");
  await expect(neverAssessed).not.toContainText("—");

  // And the positive side, so neither assertion above is passing on a hardcoded word.
  await expect(page.getByTestId("inc-touches-incident-1")).toContainText("Yes");
  await expect(page.getByTestId("inc-subjects-incident-1")).toContainText("412");
});

/** Two containment actions, newest first, by two different people. */
const CONTAINED_TWICE = {
  ...INCIDENTS[0],
  id: "incident-22",
  status: "CONTAINED",
  classification: "NOT_YET_CLASSIFIED",
  classifiedByDpoUserId: null,
  impactAssessedAt: null,
  touchesPersonalData: null,
  dataCategoriesAffected: null,
  subjectsAffectedEstimate: null,
  containmentActions: [
    {
      id: "ica-2",
      description: "Disabled the claims officer's account.",
      actionTakenByUserId: "11111111-2222-3333-4444-555555555555",
      actionTakenByName: "Layla Al-Hashemi",
      takenAt: "2026-09-06T10:05:00.000Z",
    },
    {
      id: "ica-1",
      description: "Isolated the workstation from the network.",
      // The id did not resolve — a deleted account. NULL IS NO NAME.
      actionTakenByUserId: "99999999-8888-7777-6666-555555555555",
      actionTakenByName: null,
      takenAt: "2026-09-06T09:50:00.000Z",
    },
  ],
};

test("«بس بغيّر الحالة إلى تم احتوائه» — the log says WHAT was done, by WHOM, and when", async ({
  page,
}) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await mockIncidents(page, { incidents: [CONTAINED_TWICE] });

  await page.goto("/incidents");
  const log = page.getByTestId("inc-log-incident-22");

  // WHAT — both actions, not just the latest. The field is a LOG.
  await expect(log).toContainText("Isolated the workstation from the network.");
  await expect(log).toContainText("Disabled the claims officer's account.");

  // WHO, BY NAME — decision 48. The two facts the dictionary types are the two a
  // joined string of descriptions would have thrown away.
  await expect(log).toContainText("Layla Al-Hashemi");

  // AND NEVER THE UUID. `actionTakenByName` null means NO NAME; filling it from the
  // id beside it is the `?? id` fallback the rendered-identifier budget counts, and
  // it is the one shape that always produces something to render.
  await expect(log).not.toContainText("99999999");
  await expect(log).not.toContainText("11111111");

  // NEWEST FIRST, as the api sends it — the order is one answer, in `INCIDENT_INCLUDE`.
  const entries = log.locator("li");
  await expect(entries).toHaveCount(2);
  await expect(entries.first()).toContainText("Disabled the claims officer's account.");
});

test("containment is PLURAL — the control is still there on a contained incident", async ({
  page,
}) => {
  // COMPLIANCE_OFFICER, not the DPO: `incident.contain` is held by Compliance, the
  // office administrator and the security administrator. See the absence test below.
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockIncidents(page, { incidents: [CONTAINED_TWICE] });
  // Registered AFTER the list route, so it wins: Playwright matches handlers in
  // reverse registration order.
  await page.route("**/incidents/incident-22/contain", (route) =>
    route.fulfill({
      status: 201,
      json: {
        ...CONTAINED_TWICE,
        containmentActions: [
          {
            id: "ica-3",
            description: "Rotated every credential on the affected host.",
            actionTakenByUserId: "11111111-2222-3333-4444-555555555555",
            actionTakenByName: "Layla Al-Hashemi",
            takenAt: "2026-09-06T10:20:00.000Z",
          },
          ...CONTAINED_TWICE.containmentActions,
        ],
      },
    }),
  );

  await page.goto("/incidents");
  const describe = page.getByLabel("Describe the immediate containment action");
  // REACHABLE WHILE CONTAINED. The api appends and an e2e contains twice; a screen
  // gated on REPORTED alone would make every action after the first unreachable.
  await expect(describe).toBeVisible();

  const button = page.getByRole("button", { name: "Contain" });
  // The server refuses a blank description, so the screen does not offer to send one.
  await expect(button).toBeDisabled();
  // Nine characters, not zero — a test that only types nothing cannot tell a
  // ten-character floor from a non-empty check.
  await describe.fill("too short");
  await expect(button).toBeDisabled();
  await describe.fill("Rotated every credential on the affected host.");
  await expect(button).toBeEnabled();

  await button.click();
  // WHAT THE ACT DID — the silent-act defect, which her walk reported on this screen.
  // The FIGURE rather than the state: a second containment leaves the status at
  // CONTAINED, so a status line would print the same sentence before and after.
  await expect(page.getByTestId("incident-incident-22-outcome")).toContainText(
    "Immediate actions taken: 3",
  );
});

test("the assessment form refuses a partial answer and asks for all three outputs", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockIncidents(page, { incidents: [NEVER_ASSESSED] });

  await page.goto("/incidents");
  const button = page.getByRole("button", { name: "Assess impact" });
  // PRIV-SOP-09 step 4 has three outputs and the server refuses a partial assessment
  // per field. An empty form is the state her sentence describes — the record saying
  // the impact was assessed when nothing was assessed.
  await expect(button).toBeDisabled();

  await page.getByLabel("The incident touches personal data").check();
  await expect(button).toBeDisabled();
  await page.getByLabel("Data categories").fill("Claim files, national identifiers");
  await expect(button).toBeDisabled();
  // Only once the third output is given. 0 is ACCEPTED — it is a finding, not a gap —
  // which is the same rule the render side asserts, on the write side.
  await page.getByLabel("Approximate number of affected data subjects").fill("0");
  await expect(button).toBeEnabled();
});

/*
 * THE SOP-09 SEGREGATION GAP, ASSERTED RATHER THAN DESCRIBED — reported, not closed.
 *
 * `PRIV-SOP-09` § 6 assigns step 3 (containment) to «دائرة تقنية المعلومات» and step 4
 * (the impact assessment) to «مسؤول حماية البيانات». This system has no IT role, and
 * `incident.contain` gates FOUR acts of different consequence — appending to the
 * containment log, performing the statutory impact assessment, recording recovery, and
 * CLOSING the incident — so one holder performs all four.
 *
 * MEASURED: the DPO holds `incident.classify`, `incident.report`,
 * `incident.notify-regulator` and `incident.senior-management.notify`. It does NOT hold
 * `incident.contain`, so step 4 is unreachable for the function the procedure assigns it
 * to, while the DPO CAN classify the incident on the strength of an assessment somebody
 * else performed.
 *
 * Nothing is widened to fix that: who holds what is a grant decision and
 * `incident.contain` is a decision-98 candidate (two acts, one code) rather than a bug
 * to patch from a screen. The absence is pinned here so the day it changes, it changes
 * deliberately.
 */
test("the DPO is offered NEITHER containment nor the impact assessment — the SOP-09 split this product cannot express", async ({
  page,
}) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await mockIncidents(page, { incidents: [NEVER_ASSESSED] });

  await page.goto("/incidents");
  // THE ANCHOR, from the same render: the DPO reaches this screen and reads the row.
  // Without it the two absences below would be satisfied by a page that never mounted.
  await expect(page.getByTestId("inc-log-incident-21")).toBeVisible();

  await expect(
    page.getByRole("button", { name: "Assess impact" }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Describe the immediate containment action"),
  ).toHaveCount(0);
});
