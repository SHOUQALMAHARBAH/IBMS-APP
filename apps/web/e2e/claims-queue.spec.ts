import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { expectNone } from "./support/anchored";
import {
  expectLayoutOnlyControl,
  useTheme,
  type BaseTheme,
} from "./fixtures/base-style";
import { permissionsForRoles } from "./fixtures/role-permissions";

/*
 * The claims queue — `/claims` and `/claims/[id]`.
 *
 * These screens exist because a CLAIMS_OFFICER could not reach the one set of
 * forms the role exists to operate. It holds `claim.read`, `claim.register`,
 * `claim.document`, `claim.assess`, `claim.settle.approve` and `claim.close`,
 * but every route to a claim went through `/opportunities/[id]`, a screen
 * behind an `opportunity.read` the role does NOT hold. The API accepted them;
 * no screen offered it. Structurally the same defect as the Policy Checking
 * Officer routing gap, and covered the same way here.
 *
 * The role assertions below are the point of this file: they pin that the
 * screens work for the role that was locked out, using that role's REAL
 * seeded permission set rather than a convenient superset.
 */

const ME_BASE = {
  id: "user-1",
  email: "claims@ibms.test",
  fullName: "Claims Officer",
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
  roles: string[] = ["CLAIMS_OFFICER"],
  languagePreference: "AR" | "EN" = "EN",
) {
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fake-access-token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      status: 200,
      json: {
        ...ME_BASE,
        roles,
        // DECISION 157 - the home page greets a person with their role's NAME, so
        // /auth/me carries the display names beside the machine names. A fixture that
        // omits this makes `user.roleNames.length` throw and the shell render
        // "This page couldn't load" - a broken SCREEN rather than a stale mock.
        roleNames: roles.map((r) => ({ ar: r, en: r })),
        languagePreference,
        permissions: permissionsForRoles(roles),
      },
    }),
  );
  await page.route("http://localhost:4000/notifications", (route) =>
    route.fulfill({ status: 200, json: { items: [], total: 0 } }),
  );
}

function paged<T>(items: T[], total = items.length) {
  return { items, total, page: 0, pageSize: 50 };
}

const CLAIM = {
  id: "clm-1",
  policyId: "pol-1",
  customerId: "cust-1",
  policyNumber: "POL-2026-0451",
  insuranceLine: "Property All Risks",
  claimNumber: "CLM-2026-0007",
  insurerClaimReference: "UN-77120",
  status: "UNDER_ASSESSMENT",
  lossDate: "2026-09-05",
  lossLocation: "Amman industrial zone",
  causeOfLoss: "Water damage following a burst riser",
  estimatedLoss: "48000.000",
  isThirdPartyInvolved: false,
  isLargeClaim: false,
  classification: "HIGHLY_CONFIDENTIAL",
  followUpAlertThresholdDays: 7,
  thirdParty: null,
  adjuster: {
    name: "Rami Haddad",
    firm: "Levant Loss Adjusters",
    assignedAt: "2026-09-06T08:00:00.000Z",
    surveyCompletedAt: null,
    investigationCompletedAt: null,
  },
  coverage: {
    scheduleId: "sch-1",
    effectiveFrom: "2026-10-01T00:00:00.000Z",
    effectiveTo: null,
  },
  coverageResolvedAtLossDate: true,
  documents: [],
  documentChecklist: [],
  documentationComplete: false,
  missingMandatoryDocuments: ["claim_form"],
  assessment: {
    surveyCompletedAt: null,
    investigationCompletedAt: null,
    adjusterWorkComplete: false,
    readyForAssessment: false,
    outcome: null,
  },
  followUp: {
    followUpAlerts: [
      {
        id: "alert-1",
        triggeredAt: "2026-09-14T08:00:00.000Z",
        resolvedAt: null,
      },
    ],
    followUpAlertOpen: true,
    followUpAlertThresholdDays: 7,
    awaitingInsurerResponse: true,
    awaitingInsurerSince: "2026-09-08T08:00:00.000Z",
  },
  settlement: null,
  closedAt: null,
  statusHistory: [],
  createdAt: "2026-09-05T10:00:00.000Z",
  updatedAt: "2026-09-08T10:00:00.000Z",
};

const QUEUE_URL = "http://localhost:4000/claims";
const DETAIL_URL = "http://localhost:4000/claims/clm-1";

test("a Claims Officer lands on the queue and sees the triage signals", async ({
  page,
}) => {
  await mockAuth(page);
  await page.route(QUEUE_URL, (route) =>
    route.fulfill({ status: 200, json: paged([CLAIM]) }),
  );

  await page.goto("/claims");
  await expect(page.getByRole("heading", { name: "Claims" })).toBeVisible();
  await expect(page.getByText("CLM-2026-0007")).toBeVisible();
  await expect(page.getByText("POL-2026-0451")).toBeVisible();

  // The row carries STATE, not just a link — this is a queue, not an index.
  await expect(page.locator('[data-claim-status="UNDER_ASSESSMENT"]')).toBeVisible();
  await expect(page.locator('[data-claim-alert="open"]')).toBeVisible();
  await expect(page.locator('[data-claim-docs="incomplete"]')).toBeVisible();

  // The badge shows the LABEL while `data-*` keeps the raw code.
  // Scoped to the badge: the same label is also an <option> in the status
  // filter, so an unscoped lookup is a strict-mode violation.
  await expect(
    page.locator('[data-claim-status="UNDER_ASSESSMENT"]'),
  ).toHaveText("Under assessment");
});

test("the sidebar offers Claims to a Claims Officer and hides it without claim.read", async ({
  page,
}) => {
  await mockAuth(page);
  await page.route(QUEUE_URL, (route) =>
    route.fulfill({ status: 200, json: paged([]) }),
  );
  await page.goto("/claims");
  await expect(
    page.getByRole("link", { name: "Claims", exact: true }),
  ).toBeVisible();

  // A role with no claim.read never sees the entry — the control does not
  // exist on their screen rather than being rendered and then refused.
  await page.unroute("**/auth/me");
  await mockAuth(page, ["FINANCE_COLLECTIONS_OFFICER"]);
  await page.goto("/policies");
  // BY HREF. This assertion did die under a "every role holds every permission" plant, so
  // it was not vacuous — but it passed only because the group holding the current route
  // happened to be expanded, which is luck rather than design. The href is in the DOM
  // whether or not its group is open, so the assertion no longer depends on which page the
  // test happens to be standing on.
  // The anchor is the nav LANDMARK, not another destination: this role holds no
  // `policy.read` either, so anchoring on the Policies link asserted the absence of one
  // thing against the absence of another and failed. The landmark proves the shell
  // hydrated, which is all an anchor has to do.
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expectNone(nav.locator('a[href="/claims"]'), nav);
});

test("the queue filters by status and by needs-follow-up, and both travel with the page", async ({
  page,
}) => {
  await mockAuth(page);
  const seen: string[] = [];
  await page.route(`${QUEUE_URL}**`, (route) => {
    seen.push(route.request().url());
    return route.fulfill({ status: 200, json: paged([CLAIM], 1) });
  });

  await page.goto("/claims");
  await expect(page.getByText("CLM-2026-0007")).toBeVisible();

  await page.getByLabel("Status").selectOption("SETTLED");
  await expect.poll(() => seen.some((u) => u.includes("status=SETTLED"))).toBe(true);

  await page.getByLabel("Needs follow-up only").check();
  await expect
    .poll(() =>
      seen.some((u) => u.includes("alertOpen=true") && u.includes("status=SETTLED")),
    )
    .toBe(true);
});

test("opening a claim from the queue reaches the work surface with its forms", async ({
  page,
}) => {
  await mockAuth(page);
  await page.route(QUEUE_URL, (route) =>
    route.fulfill({ status: 200, json: paged([CLAIM]) }),
  );
  await page.route(DETAIL_URL, (route) =>
    route.fulfill({ status: 200, json: CLAIM }),
  );

  await page.goto("/claims");
  await page.getByRole("button", { name: "Open claim CLM-2026-0007" }).click();

  await expect(page).toHaveURL(/\/claims\/clm-1$/);
  // The forms the role exists to operate, on a route that needs no
  // `opportunity.read` — the whole point of this screen.
  await expect(
    page.getByRole("heading", { name: "Claim CLM-2026-0007" }),
  ).toBeVisible();
  await expect(page.getByText("Documentation", { exact: false })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "File document" }),
  ).toBeVisible();
});

test("the queue shows a friendly message when the caller lacks claim.read", async ({
  page,
}) => {
  await mockAuth(page);
  await page.route(QUEUE_URL, (route) =>
    route.fulfill({
      status: 403,
      json: { message: "forbidden" },
    }),
  );
  await page.goto("/claims");
  await expect(page.locator('main [role="alert"]')).toContainText("claim.read");
});

test("an empty queue explains what belongs there", async ({ page }) => {
  await mockAuth(page);
  await page.route(QUEUE_URL, (route) =>
    route.fulfill({ status: 200, json: paged([]) }),
  );
  await page.goto("/claims");
  await expect(
    page.getByText("No claims yet", { exact: false }),
  ).toBeVisible();
});

test("a claim outside the caller's book reads as not found, not as an empty screen", async ({
  page,
}) => {
  await mockAuth(page);
  await page.route(DETAIL_URL, (route) =>
    route.fulfill({ status: 404, json: { message: "Claim not found" } }),
  );
  await page.goto("/claims/clm-1");
  await expect(page.locator('main [role="alert"]')).toContainText("your book");
});

test("the queue renders in Arabic with translated status labels", async ({
  page,
}) => {
  await mockAuth(page, ["CLAIMS_OFFICER"], "AR");
  await page.route(QUEUE_URL, (route) =>
    route.fulfill({ status: 200, json: paged([CLAIM]) }),
  );
  await page.goto("/claims");
  await expect(page.getByRole("heading", { name: "المطالبات" })).toBeVisible();
  // The status badge reads an Arabic label while `data-*` keeps the code.
  await expect(page.locator('[data-claim-status="UNDER_ASSESSMENT"]')).toBeVisible();
  await expect(
    page.locator('[data-claim-status="UNDER_ASSESSMENT"]'),
  ).toHaveText("قيد التقييم");
});

/*
 * 🔴 THE FULL WALK §A ITEM 1 — THE STUCK CLAIM, REPRODUCED.
 *
 * The owner's walk left claim `AR-2026-7781` at `UNDER_ASSESSMENT` with the survey stamped
 * and the investigation not. `ClaimCard.tsx` hid both stamp buttons at that status while the
 * verdict button is disabled until BOTH are recorded — so the screen offered nothing, and
 * the claim could not move in any direction.
 *
 * ⚠️ AND THIS FILE ALREADY RENDERED THE DEAD END ON EVERY RUN. `CLAIM` above is
 * `UNDER_ASSESSMENT` with both stamps null, driven by a CLAIMS_OFFICER who holds
 * `claim.assess` — a state even more stuck than the owner's. Nobody asserted the controls,
 * so nine tests walked past it.
 *
 * ⟶ The fixture here carries ONE stamp, which is the owner's state exactly rather than a
 * tidier version of it: a zero-stamp claim would also pass against a fix that only ever
 * showed the FIRST stamp button.
 */
const ONE_STAMP_CLAIM = {
  ...CLAIM,
  adjuster: {
    ...CLAIM.adjuster,
    surveyCompletedAt: "2026-11-25T00:00:00.000Z",
  },
  assessment: {
    ...CLAIM.assessment,
    surveyCompletedAt: "2026-11-25T00:00:00.000Z",
    // Still false, and that is the whole defect: the verdict needs both.
    adjusterWorkComplete: false,
  },
};

test("a claim under assessment with one stamp can still record the other", async ({
  page,
}) => {
  await mockAuth(page);
  await page.route(DETAIL_URL, (route) =>
    route.fulfill({ status: 200, json: ONE_STAMP_CLAIM }),
  );
  await page.goto("/claims/clm-1");
  await expect(
    page.getByRole("heading", { name: "Claim CLM-2026-0007" }),
  ).toBeVisible();

  // THE FIX. The missing stamp is reachable — the route accepts it at this status, and the
  // screen now agrees with the route.
  const investigation = page.getByRole("button", {
    name: "Mark investigation complete",
  });
  await expect(investigation).toBeVisible();

  /*
   * AND IT BECOMES PRESSABLE ONCE THE DATE IS GIVEN, which is what makes this a route back rather
   * than a rendered-but-dead control.
   *
   * ⚠️ MEASURED, AND MY FIRST VERSION OF THIS ASSERTION WAS WRONG. It read
   * `expect(investigation).toBeEnabled()` on the claim as loaded, with a comment claiming the date
   * field defaults to today. It does not — `useState('')` — and the two stamp buttons are disabled
   * on `instant().length === 0`, which is correct: the stamp RECORDS a completion date, and a
   * button that submits an empty one would be the worse control. So the date is filled first, and
   * the before/after pair is the real assertion.
   */
  await expect(investigation).toBeDisabled();
  await page.getByLabel("Completion date (adjuster survey / investigation)").fill("2026-11-26");
  await expect(investigation).toBeEnabled();

  // The stamp ALREADY recorded stays disabled — it is write-once on the server (409 on a
  // different value), so offering it again would be a control that can only fail.
  await expect(
    page.getByRole("button", { name: "Mark survey complete" }),
  ).toBeDisabled();

  // The verdict is on the screen and correctly withheld, WITH its reason — so the reader is
  // told what is missing rather than facing a dead button.
  const verdict = page.getByRole("button", { name: "Record verdict" });
  await expect(verdict).toBeVisible();
  await expect(verdict).toBeDisabled();
  await expect(verdict).toHaveAttribute(
    "title",
    "Record the adjuster survey + investigation first.",
  );

  // ⛔ AND SUBMIT IS GONE, which is the half that really does belong to one status: the
  // route refuses a second submission, so the control must not exist here. Anchored on the
  // verdict button rather than on the page, so an empty render cannot satisfy it.
  await expectNone(
    page.getByRole("button", { name: "Submit for assessment" }),
    verdict,
  );
});

test("a claim still in documentation keeps submit and offers both stamps", async ({
  page,
}) => {
  await mockAuth(page);
  await page.route(DETAIL_URL, (route) =>
    route.fulfill({
      status: 200,
      json: {
        ...CLAIM,
        status: "DOCUMENTATION_IN_PROGRESS",
      },
    }),
  );
  await page.goto("/claims/clm-1");

  // NON-VACUITY for the test above: the earlier status is unchanged by this fix, keeping its
  // submit control and both stamps. Without this, moving `submit` behind a status check could
  // have removed it everywhere and the first test would still pass.
  const submit = page.getByRole("button", { name: "Submit for assessment" });
  await expect(submit).toBeVisible();
  // Both stamps are offered here and neither is recorded, so both become pressable once the date
  // is given — the same date gate as the test above, for the same reason.
  await page.getByLabel("Completion date (adjuster survey / investigation)").fill("2026-11-26");
  await expect(
    page.getByRole("button", { name: "Mark survey complete" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Mark investigation complete" }),
  ).toBeEnabled();
  await expectNone(
    page.getByRole("button", { name: "Record verdict" }),
    submit,
  );
});

test("claims queue screens have no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page);
  await page.route(QUEUE_URL, (route) =>
    route.fulfill({ status: 200, json: paged([CLAIM]) }),
  );
  await page.route(DETAIL_URL, (route) =>
    route.fulfill({ status: 200, json: CLAIM }),
  );

  await page.goto("/claims");
  await expect(page.getByText("CLM-2026-0007")).toBeVisible();
  const queue = await new AxeBuilder({ page }).analyze();
  expect(
    queue.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact ?? ""),
    ),
  ).toEqual([]);

  await page.goto("/claims/clm-1");
  await expect(
    page.getByRole("heading", { name: "Claim CLM-2026-0007" }),
  ).toBeVisible();
  const detail = await new AxeBuilder({ page }).analyze();
  expect(
    detail.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact ?? ""),
    ),
  ).toEqual([]);
});

/*
 * 🔴 MESSAGE 53 §1 ITEM 1 — THE CONTROL(S) ON THIS SCREEN THAT THE BASE SHAPE USED TO SKIP.
 *
 * Decision 161 ruling 2's first selector asked only WHETHER a control had an inline style, so a
 * control whose style names a margin, a width or a cursor and nothing else was left to the
 * browser's own default. The rule now reads the property NAMES; see `globals.css`.
 *
 * ⚠️ RUN HERE rather than in `base-style.spec.ts`, on this file's own PROVEN fixtures — message
 * 44 lost a session to an invented fixture that rendered «This page couldn't load» and read
 * exactly like a product defect. ⚠️ And in BOTH themes, because ruling 4 says the presenter
 * shows the LIGHT one, which is why nobody will be looking at the dark one on the day.
 */
for (const theme of ["light", "dark"] as BaseTheme[]) {
  test(`decision 163 §1 — the claim back button takes the base shape in ${theme}`, async ({
    page,
  }) => {
    await useTheme(page, theme);
    await mockAuth(page, ["CLAIMS_OFFICER"]);
    await page.route(DETAIL_URL, (route) =>
      route.fulfill({ status: 200, json: CLAIM }),
    );
    await page.goto("/claims/clm-1");
    await expectLayoutOnlyControl(
      page.getByRole("button", { name: "← All claims" }),
      theme,
      "/claims/[id] back button",
    );
  });
}
