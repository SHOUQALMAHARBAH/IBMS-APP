import { expect, test, type Page } from "@playwright/test";
import { permissionsForRoles } from "./fixtures/role-permissions";
import { expectNone } from "./support/anchored";

/**
 * THE DISCARD CONTROL — withdrawing a record raised in error, on a screen.
 *
 * ## Why the claim detail page
 *
 * `DiscardControl` is ONE component, wired into four sections (policy, claim, endorsement,
 * recommendation). What differs between them is a boolean the section computes from its own commitment rule,
 * and each of those four rules is proven server-side in `apps/api/test/discard.e2e-spec.ts`. What is worth
 * proving in a browser is the part the API cannot: that the reason field gates the button, that a withdrawn
 * record still SHOWS — with its reason — rather than vanishing, that the forward action disappears, and that
 * a caller without the code sees no control at all.
 *
 * `/claims/[id]` renders the same `ClaimCard` the opportunity screen does and fetches exactly one endpoint,
 * so it proves the component at a fraction of the mocking. Testing it through `/opportunities/[id]` would
 * have meant standing up eleven fixtures to reach the same four assertions.
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

const REASON = "Notified against the wrong policy — the client has two.";

interface DiscardBlock {
  at: string;
  byUserId: string;
  reason: string;
}

/** Only the fields `ClaimCard` and the discard control actually read. */
function claimFixture(over: Record<string, unknown> = {}) {
  return {
    id: "clm-1",
    discard: null as DiscardBlock | null,
    policyId: "pol-1",
    customerId: "cust-1",
    policyNumber: "POL-2026-0451",
    insuranceLine: "Property All Risks",
    claimNumber: null,
    insurerClaimReference: null,
    status: "NOTIFIED",
    lossDate: "2026-09-05",
    lossLocation: "Amman",
    causeOfLoss: "Water damage following a burst riser",
    estimatedLoss: "48000.000",
    isThirdPartyInvolved: false,
    isLargeClaim: false,
    classification: "HIGHLY_CONFIDENTIAL",
    followUpAlertThresholdDays: 7,
    thirdParty: null,
    adjuster: null,
    coverage: {
      scheduleId: "sch-1",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: null,
    },
    coverageResolvedAtLossDate: true,
    documents: [],
    documentChecklist: [],
    documentationComplete: false,
    missingMandatoryDocuments: [],
    assessment: {
      surveyCompletedAt: null,
      investigationCompletedAt: null,
      adjusterWorkComplete: false,
      readyForAssessment: false,
      outcome: null,
    },
    followUp: {
      followUpAlerts: [],
      followUpAlertOpen: false,
      followUpAlertThresholdDays: 7,
      awaitingInsurerResponse: false,
      awaitingInsurerSince: null,
    },
    settlement: null,
    closedAt: null,
    statusHistory: [],
    createdAt: "2026-09-05T10:00:00.000Z",
    updatedAt: "2026-09-05T10:00:00.000Z",
    ...over,
  };
}

async function mockClaimPage(
  page: Page,
  opts: {
    roles?: string[];
    /** Overrides on the served claim — `status`, or an already-set `discard`. */
    claim?: Record<string, unknown>;
    onDiscard?: (body: { reason: string }) => void;
  } = {},
) {
  const roles = opts.roles ?? ["CLAIMS_OFFICER"];
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fake-access-token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      status: 200,
      json: { ...ME_BASE, roles, permissions: permissionsForRoles(roles) },
    }),
  );

  // Mutable, so a successful discard is visible on the reload the control triggers — the screen has to show
  // the withdrawal it just made, which is the whole point of the record staying.
  let claim = claimFixture(opts.claim);

  // Host-qualified: a bare glob also matches the page document and would answer the navigation with JSON.
  await page.route("http://localhost:4000/claims/**", (route) => {
    const url = route.request().url();
    if (route.request().method() === "POST" && /\/discard(\?|$)/.test(url)) {
      const body = route.request().postDataJSON() as { reason: string };
      opts.onDiscard?.(body);
      claim = claimFixture({
        ...opts.claim,
        discard: {
          at: "2026-09-25T09:30:00.000Z",
          byUserId: "user-1",
          reason: body.reason,
        },
      });
      return route.fulfill({ status: 201, json: claim });
    }
    return route.fulfill({ status: 200, json: claim });
  });
}

test.describe("discarding a record raised in error", () => {
  test("the reason gates the button, and the withdrawal reaches the API", async ({
    page,
  }) => {
    const posted: { reason: string }[] = [];
    await mockClaimPage(page, { onDiscard: (b) => posted.push(b) });
    await page.goto("/claims/clm-1");

    const open = page.getByTestId("discard-open-clm-1");
    await expect(open).toBeVisible();
    await open.click();

    const confirm = page.getByTestId("discard-confirm-clm-1");
    // Empty is refused by the control itself — the server refuses it too, but a round trip to learn that a
    // mandatory field is mandatory is a worse screen.
    await expect(confirm).toBeDisabled();
    // Still refused at nine characters: the floor is ten, and "too short" has to mean the same thing here as
    // it does in the service and in the CHECK constraint under it.
    await page.getByTestId("discard-reason-clm-1").fill("too short");
    await expect(confirm).toBeDisabled();

    await page.getByTestId("discard-reason-clm-1").fill(REASON);
    await expect(confirm).toBeEnabled();
    await confirm.click();

    // The record comes back showing its own withdrawal, reason included.
    await expect(page.getByTestId("discarded-notice")).toBeVisible();
    await expect(page.getByText(REASON)).toBeVisible();
    expect(posted).toEqual([{ reason: REASON }]);
  });

  test("a withdrawn claim still shows — with its reason — and offers no way forward", async ({
    page,
  }) => {
    await mockClaimPage(page, {
      claim: {
        discard: {
          at: "2026-09-20T08:00:00.000Z",
          byUserId: "user-1",
          reason: REASON,
        },
      },
    });
    await page.goto("/claims/clm-1");

    // Present, not hidden: a withdrawn record that vanished would read as a deletion, and somebody looking
    // for it later would find nothing where the mistake was.
    const notice = page.getByTestId("discarded-notice");
    await expect(notice).toBeVisible();
    await expect(page.getByText(REASON)).toBeVisible();

    // Registration is the only forward move from NOTIFIED, and the API refuses it on a withdrawn claim. An
    // enabled button that 422s teaches the user the screen is broken rather than that the record is closed.
    await expectNone(
      page.getByRole("button", { name: /register/i }),
      notice,
    );
    // And the control does not offer a second withdrawal — a discard is terminal.
    await expectNone(page.getByTestId("discard-open-clm-1"), notice);
  });

  test("a claim past its point of no return offers no withdrawal", async ({
    page,
  }) => {
    await mockClaimPage(page, {
      claim: { status: "REGISTERED", claimNumber: "CLM-2026-0007" },
    });
    await page.goto("/claims/clm-1");

    // Anchored on something that proves the card rendered — otherwise this absence is satisfied by a screen
    // that never loaded. NOT the claim number: it renders in the page heading AND in the card, which is a
    // strict-mode violation rather than a useful anchor.
    const anchor = page.getByText("Water damage following a burst riser");
    await expectNone(page.getByTestId("discard-open-clm-1"), anchor);
  });

  test("without claim.discard there is no control, on a screen that otherwise works", async ({
    page,
  }) => {
    // A Manager holds `claim.read` and NOT `claim.discard` — measured against the seeded grid, which is what
    // decides this rather than the test. (Sales does hold it: `claim.discard` went to Sales and Claims, on
    // the rule that whoever can notify a claim can withdraw one.)
    await mockClaimPage(page, { roles: ["BRANCH_DEPARTMENT_MANAGER"] });
    await page.goto("/claims/clm-1");

    const anchor = page.getByText("Water damage following a burst riser");
    await expectNone(page.getByTestId("discard-open-clm-1"), anchor);
  });
});
