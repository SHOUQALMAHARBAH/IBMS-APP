import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";
import { expectAbsentWithin } from "./support/anchored";

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
    route.fulfill({ status: 200, json: { ...ME_BASE, roles, permissions: permissionsForRoles(roles) } }),
  );
}

const CLEAN_REPORT = {
  generatedAt: "2026-09-07T10:00:00.000Z",
  pairsScanned: 16,
  totalRowsChecked: 512,
  violations: [],
  byPair: [
    {
      entityType: "KYCRecord",
      pairLabel: "createdByUserId / approvedByUserId",
      rowsChecked: 40,
      violationCount: 0,
      dbCheckConstraint: "KYCRecord_maker_checker_distinct",
      dormant: false,
      truncated: false,
    },
    {
      entityType: "DisposalBatch",
      pairLabel: "nominatedByUserId / dpoApprovedByUserId",
      rowsChecked: 0,
      violationCount: 0,
      dbCheckConstraint: "DisposalBatch_maker_checker_distinct",
      dormant: true,
      truncated: false,
    },
  ],
};

const DIRTY_REPORT = {
  ...CLEAN_REPORT,
  violations: [
    {
      entityType: "PolicyChecking",
      pairLabel: "issuedByUserId (Policy) / checkedByUserId",
      entityId: "pc-1",
      makerField: "issuedByUserId",
      checkerField: "checkedByUserId",
      userId: "user-x",
      // Item 1 — the colleague who did both halves, by name.
      userName: "سامر عبدالله الحوراني",
      dbCheckConstraint: null,
    },
  ],
};

async function mockAudit(page: Page, opts: { status?: number; dirty?: boolean } = {}) {
  await page.route(
    "http://localhost:4000/internal-controls/self-approval-audit**",
    (route) => {
      if (opts.status && opts.status !== 200) {
        return route.fulfill({ status: opts.status, json: { message: "no" } });
      }
      return route.fulfill({
        status: 200,
        json: opts.dirty ? DIRTY_REPORT : CLEAN_REPORT,
      });
    },
  );
}

test("renders a clean audit with the per-pair breakdown", async ({ page }) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockAudit(page);

  await page.goto("/internal-controls");
  await expect(
    page.getByRole("heading", { name: "Internal controls — self-approval audit" }),
  ).toBeVisible();
  await expect(page.getByText("None")).toBeVisible();
  /* RE-POINTED BY OWNER DECISION 53, AND THE REVERSAL IS STATED. This asserted the raw member
     name `KYCRecord` in the by-pair table. That cell now renders the entity's own WORD — the KYC
     queue's heading, which is BROADER than one record and is shipped as such on decision 53's
     explicit instruction (narrowing it would mean writing Arabic, which is the owner's). Both
     halves: the word present AND the member name gone, because a half-switched table would
     satisfy a word-only check — which is exactly how this screen's OTHER table was caught. */
  await expect(
    page.getByRole("cell", { name: /KYC compliance queue/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "KYCRecord", exact: true }),
  ).toHaveCount(0);
  /*
   * RE-POINTED BY OWNER DECISION 54, AND THE REVERSAL IS STATED. This asserted the literal
   * `(dormant)`, which was hardcoded ENGLISH — an Arabic reader saw it too, and
   * `hardcoded-ui-english.py` reported 0 for this screen while it was there, which is the
   * detector defect batch ten closed.
   *
   * The marker now carries a real sentence in both languages. BOTH HALVES on purpose: the new
   * sentence present AND the bare word gone, because a half-done replacement would render both
   * and satisfy a presence-only check.
   *
   * The word still carries BOTH meanings — watched, AND not yet used — which is the owner's own
   * reasoning: «غير مستعمل» alone would leave the reader asking why the pair is listed at all,
   * which is the question the flag exists to answer.
   */
  const byPair = page.getByTestId("ic-by-pair");
  await expect(byPair.getByText("(watched, and not yet used)")).toBeVisible();
  // SCOPED, because `check:absence` refuses a page-wide text absence — and it caught these two in
  // CI after I ran that gate and then added them. The helper takes a Locator, so the compiler
  // refuses a page-wide root, and it asserts the scope VISIBLE first: scoping fixes the
  // wrong-element failure and NOT the not-yet-rendered one, since `toHaveCount(0)` passes on its
  // first poll.
  await expectAbsentWithin(byPair, (s) => s.getByText("(dormant)"));

  /*
   * AND THE TRUNCATION MARKER'S SENTENCE, asserted here because it is the one marker on this
   * screen that can make an INCOMPLETE scan read as a clean one: a row of zeroes under a
   * truncated scan is NOT clean, and `(truncated)` told an English reader nothing either. The
   * figure it names is tied to `INTERNAL_CONTROLS_SCAN_LIMIT` by `screen-copy.test.ts`, so this
   * assertion cannot go stale against the constant without that test failing first.
   */
  await page.route("http://localhost:4000/internal-controls/self-approval-audit", (route) =>
    route.fulfill({
      status: 200,
      json: {
        ...CLEAN_REPORT,
        byPair: [{ ...CLEAN_REPORT.byPair[0], truncated: true }],
      },
    }),
  );
  await page.reload();
  const truncatedTable = page.getByTestId("ic-by-pair");
  await expect(
    truncatedTable.getByText(
      "(incomplete result — only the first 20,000 records were scanned)",
    ),
  ).toBeVisible();
  await expectAbsentWithin(truncatedTable, (s) => s.getByText("(truncated)"));
  await expect(
    page.getByRole("heading", { name: "Self-approval violations found" }),
  ).not.toBeVisible();
});

test("surfaces a detected violation prominently", async ({ page }) => {
  await mockAuth(page, ["EXECUTIVE_MANAGEMENT"]);
  await mockAudit(page, { dirty: true });

  await page.goto("/internal-controls");
  await expect(
    page.getByRole("heading", { name: "Self-approval violations found" }),
  ).toBeVisible();
  /*
   * OWNER DECISION 53 — RE-POINTED, AND THE REVERSAL IS STATED. This asserted the bare record
   * uuid `pc-1`. The cell now carries the record TYPE IN ARABIC plus that number, which is
   * decision 49's shape for a set that is CLOSED — fifteen maker/checker entity types, closed by
   * `check:maker-checker-pairs` rather than by convention.
   *
   * `PolicyChecking` is deliberately the member this fixture uses: it is the ONE of the sixteen
   * whose word had to be SLICED rather than pointed at, because the only string naming it calls
   * it a DISCREPANCY — which a policy-checking record may not have.
   *
   * THE PAIR: the type word present AND the bare-uuid cell gone, because a screen rendering both
   * would satisfy a word-only check.
   */
  await expect(
    page.getByRole("cell", { name: /Policy Checking number pc-1/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "pc-1", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("cell", { name: "PolicyChecking", exact: true }),
  ).toHaveCount(0);

  /*
   * ITEM 1 — RE-POINTED, AND THE REVERSAL IS STATED. This asserted the cell reading `user-x`, the
   * actor's uuid, which was correct until the api started resolving the name. The property it was
   * about — the violating colleague is identifiable on the row — is kept and STRENGTHENED: the
   * name present AND the uuid gone, because a screen rendering both would pass a name-only check.
   *
   * The RECORD id beside it (`pc-1`) stays a uuid by decision 49 and is deliberately still
   * asserted: fifteen maker/checker entity types, nine of them with no Arabic word yet, so a type
   * word cannot be rendered without inventing one.
   */
  await expect(
    page.getByRole("cell", { name: "سامر عبدالله الحوراني" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "user-x", exact: true }),
  ).toHaveCount(0);
});

test("a user without the permission sees a friendly message", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockAudit(page, { status: 403 });

  await page.goto("/internal-controls");
  await expect(
    page.getByText("(internal-controls.view)", { exact: false }),
  ).toBeVisible();
});

test("internal-controls screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockAudit(page);

  await page.goto("/internal-controls");
  /* RE-POINTED BY OWNER DECISION 53, AND THE REVERSAL IS STATED. This asserted the raw member
     name `KYCRecord` in the by-pair table. That cell now renders the entity's own WORD — the KYC
     queue's heading, which is BROADER than one record and is shipped as such on decision 53's
     explicit instruction (narrowing it would mean writing Arabic, which is the owner's). Both
     halves: the word present AND the member name gone, because a half-switched table would
     satisfy a word-only check — which is exactly how this screen's OTHER table was caught. */
  await expect(
    page.getByRole("cell", { name: /KYC compliance queue/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "KYCRecord", exact: true }),
  ).toHaveCount(0);
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
