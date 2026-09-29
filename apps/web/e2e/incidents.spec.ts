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
    page.getByText("incident.report permission", { exact: false }),
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
