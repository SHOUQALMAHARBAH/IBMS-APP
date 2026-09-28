import { expect, test, type Page } from "@playwright/test";
import { permissionsForRoles } from "./fixtures/role-permissions";
import { expectNone } from "./support/anchored";

/**
 * Tests of the absence-assertion RULE itself, not of a feature.
 *
 * `toHaveCount(0)` SUCCEEDS ON ITS FIRST POLL rather than waiting out its timeout. So on a screen
 * that loads two things in sequence, an absence anchored on the FIRST read is asserted while the
 * second is still in flight — "not yet" and "never" give the same answer, and which one a run gets
 * depends on machine load. Measured 2026-09-28: a planted regression died under the full spec and
 * PASSED when its own test ran alone, on the identical build.
 *
 * ## The race is made DETERMINISTIC here rather than reproduced under load
 *
 * Proving this by running things in parallel and hoping would make the proof itself flaky, which is
 * the defect it is about. Holding the second read for a fixed delay puts the timing under the
 * test's control: longer than a first poll, far shorter than the assertion timeout, so the window
 * is entered on every run and every machine.
 *
 * ## What these two tests pin
 *
 *  1. An anchor from the SAME read as the absent element is sufficient — `expectNone` then refuses
 *     a false absence, which is the behaviour every call site depends on.
 *  2. An anchor from an EARLIER read is NOT sufficient, and no wait inside the helper closes that.
 *     This is pinned as a fact so the next person to reach for
 *     `waitForLoadState('networkidle')` finds out here instead of in production: that state is a
 *     SNAPSHOT, and idleness is exactly the state between two sequential reads.
 */

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

const CYCLES = [
  {
    id: "cycle-2",
    cycleLabel: "Q2-2026",
    startedAt: "2026-04-01T00:00:00.000Z",
    dueAt: "2026-04-22T00:00:00.000Z",
    closedAt: null,
  },
];

const ADMIN_ITEM = {
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
  createdAt: "2026-04-01T00:00:00.000Z",
};

/** Longer than a first poll; far short of the assertion timeout. */
const SECOND_READ_DELAY_MS = 1500;

/**
 * The recertification screen, whose two reads are genuinely sequential: the cycle list, then the
 * items for whichever cycle that produced. A real shape, not a synthetic one.
 */
async function mockRacingScreen(page: Page) {
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
      },
    }),
  );
  await page.route("**/access-recertification/items", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  // FIRST read: immediate.
  await page.route(
    "http://localhost:4000/access-recertification/cycles",
    (route) => route.fulfill({ status: 200, json: CYCLES }),
  );
  // SECOND read: held, and it DOES return a row — so the absence asserted below is FALSE. The only
  // question either test asks is whether the assertion waits long enough to find that out.
  await page.route(
    "http://localhost:4000/access-recertification/cycles/*/admin-items",
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, SECOND_READ_DELAY_MS));
      return route.fulfill({ status: 200, json: [ADMIN_ITEM] });
    },
  );
}

test("an anchor from the SAME read makes expectNone refuse a false absence", async ({
  page,
}) => {
  await mockRacingScreen(page);
  await page.goto("/access-recertification");

  // The anchor comes from the SECOND read — the same one that produces the element claimed absent.
  // Waiting for it to be visible is what establishes that the read has landed.
  const sameRead = page.getByTestId("admin-decision-admin-item-1");
  await expect(sameRead).toBeVisible();

  // The row IS there, so a correct absence assertion about a sibling of it must still succeed for
  // something genuinely missing, and refuse for something present. Both halves, on one settled page.
  await expectNone(
    page.getByTestId("admin-decision-no-such-item"),
    page.getByTestId("admin-record-cycle"),
  );
  await expect(
    expectNone(sameRead, page.getByTestId("admin-record-cycle")),
    "expectNone accepted an absence for an element that is on the page",
  ).rejects.toThrow();
});

test("an anchor from an EARLIER read does not establish the absence, and no wait fixes it", async ({
  page,
}) => {
  await mockRacingScreen(page);
  await page.goto("/access-recertification");

  // A correct anchor by every rule the guard can express: genuinely visible, not the set under
  // test, proving the page rendered. It comes from the FIRST read.
  const earlierRead = page.getByTestId("admin-record-cycle");
  await expect(earlierRead).toBeVisible();

  /*
   * And the absence PASSES, wrongly — the row arrives 1.5s later.
   *
   * Pinned rather than left implicit, because it is the reason the rule lives at the call site.
   * `waitForLoadState('networkidle')` inside `expectNone` was tried and changed nothing: the second
   * request has not been issued yet at this instant, so the page really is idle. If somebody later
   * makes the helper wait in a way that DOES close this, the assertion below starts failing — which
   * is the right way to find out, because then the call-site rule can be relaxed.
   */
  await expectNone(page.getByTestId("admin-decision-admin-item-1"), earlierRead);
});
