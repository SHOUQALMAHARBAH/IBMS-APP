import { expect, test, type Page } from "@playwright/test";
import { permissionsForRoles } from "./fixtures/role-permissions";
import { expectNone } from "./support/anchored";

/**
 * PART 4 STEP 4 — the screen that declares whether this office separates the two halves of an approval.
 *
 * Three properties are asserted rather than assumed, and each is a decision somebody could reasonably have
 * made differently:
 *
 *  1. **The reason gates the button.** The setting weakens a control, so it cannot be changed without saying
 *     why — and the reason field IS the confirmation step, with no separate "are you sure" to click past.
 *  2. **Whoever REVIEWS the acts sees the setting and cannot change it.** Compliance opens the same page
 *     read-only, with a sentence saying why. Hiding the office's own posture from its reviewers would be the
 *     wrong half to close.
 *  3. **COMBINED is visible and refused, with the reason beside it.** An option that silently vanishes teaches
 *     nothing; the administrator is entitled to know what has to exist first.
 */

const ME_BASE = {
  id: "user-1",
  email: "admin@ibms.test",
  fullName: "Office Administrator",
  languagePreference: "EN",
  mfaEnabled: false,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
  dutySegregationMode: "SEGREGATED",
};

const REASON = "This office has one licensed broker and reviews its own work.";

/** MODULE 0-ب — the body the designation form posts. */
interface RecordedDpo {
  dataProtectionOfficerName: string;
  combinedAssignmentDeclaration?: { noticeShown: string; acknowledged: boolean };
}

const MANAGER = "Mira Al-Qudah";
const SOMEBODY_ELSE = "Yousef Haddad";

async function mockModePage(
  page: Page,
  opts: {
    roles?: string[];
    declared?: boolean;
    onDeclare?: (body: { mode: string; reason: string }) => void;
    declareStatus?: number;
    declareBody?: unknown;
    /** MODULE 0-ب — the DPO assignment section lives on this page, so its route is always mocked. */
    managerName?: string | null;
    dpoName?: string | null;
    acknowledgedPerson?: string | null;
    onRecordDpo?: (body: RecordedDpo) => void;
    dpoStatus?: number;
    dpoBody?: unknown;
  } = {},
) {
  const roles = opts.roles ?? ["OFFICE_ADMINISTRATOR"];
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fake-access-token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      status: 200,
      json: { ...ME_BASE, roles, permissions: permissionsForRoles(roles) },
    }),
  );

  let mode = {
    mode: "SEGREGATED",
    declaredAt: opts.declared ? "2026-09-20T09:00:00.000Z" : null,
    declaredByUserId: opts.declared ? "user-1" : null,
    declaredByName: opts.declared ? "Office Administrator" : null,
  };

  // Host-qualified: a bare glob also matches the page document and answers the navigation with JSON.
  await page.route("http://localhost:4000/duty-segregation/mode", (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as {
        mode: string;
        reason: string;
      };
      opts.onDeclare?.(body);
      if (opts.declareStatus && opts.declareStatus >= 400) {
        return route.fulfill({
          status: opts.declareStatus,
          json: opts.declareBody ?? { message: "refused" },
        });
      }
      mode = {
        mode: body.mode,
        declaredAt: "2026-09-26T10:00:00.000Z",
        declaredByUserId: "user-1",
        declaredByName: "Office Administrator",
      };
      return route.fulfill({ status: 200, json: mode });
    }
    return route.fulfill({ status: 200, json: mode });
  });

  /*
   * MODULE 0-ب — THE DPO ASSIGNMENT SECTION'S OWN ROUTE, MOCKED UNCONDITIONALLY.
   *
   * Not an optional extra: the section is on this page, and without this route it renders a load
   * error carrying `role="alert"`. The sibling refusal test asserts `main >> role=alert`, which would
   * then resolve to TWO elements and fail in strict mode — the ambiguity class this repository has
   * paid for three times. A fixture that omits an endpoint the screen calls is an unfaithful fixture,
   * and the fix is the fixture rather than a weaker locator.
   */
  let designation = {
    dataProtectionOfficerName: opts.dpoName ?? null,
    generalManagerName: opts.managerName === undefined ? MANAGER : opts.managerName,
    combinedWithManager: false,
    declarationRequired: false,
    acknowledgedAt: null as string | null,
    acknowledgedByUserId: null as string | null,
    acknowledgedByName: null as string | null,
    noticeShown: null as string | null,
  };
  await page.route(
    "http://localhost:4000/duty-segregation/dpo-designation",
    (route) => {
      if (route.request().method() === "PATCH") {
        const body = route.request().postDataJSON() as RecordedDpo;
        opts.onRecordDpo?.(body);
        if (opts.dpoStatus && opts.dpoStatus >= 400) {
          return route.fulfill({
            status: opts.dpoStatus,
            json: opts.dpoBody ?? { message: "refused" },
          });
        }
        const combined =
          body.dataProtectionOfficerName.trim() !== "" &&
          body.dataProtectionOfficerName.trim() ===
            (designation.generalManagerName ?? "").trim();
        designation = {
          ...designation,
          dataProtectionOfficerName: body.dataProtectionOfficerName,
          combinedWithManager: combined,
          declarationRequired: false,
          acknowledgedAt: body.combinedAssignmentDeclaration
            ? "2026-10-22T10:00:00.000Z"
            : designation.acknowledgedAt,
          acknowledgedByName: body.combinedAssignmentDeclaration
            ? "Office Administrator"
            : designation.acknowledgedByName,
          noticeShown:
            body.combinedAssignmentDeclaration?.noticeShown ??
            designation.noticeShown,
        };
        return route.fulfill({ status: 200, json: designation });
      }
      return route.fulfill({ status: 200, json: designation });
    },
  );
}

test.describe("declaring the office's separation of duties", () => {
  test("the reason gates the button, and the declaration reaches the API", async ({
    page,
  }) => {
    const posted: { mode: string; reason: string }[] = [];
    await mockModePage(page, { onDeclare: (b) => posted.push(b) });
    await page.goto("/settings/duty-segregation");

    // Segregated by DEFAULT reads differently from segregated by decision, and the screen says which.
    await expect(page.getByTestId("duty-mode-current")).toContainText(
      "two people required",
    );
    await expect(page.getByText("Nobody has declared this")).toBeVisible();

    const declare = page.getByTestId("duty-mode-declare");
    await expect(declare).toBeDisabled();
    await page.getByTestId("duty-mode-reason").fill("too short");
    await expect(declare).toBeDisabled();

    await page.getByTestId("duty-mode-reason").fill(REASON);
    await expect(declare).toBeEnabled();
    await declare.click();

    expect(posted).toEqual([{ mode: "SEGREGATED", reason: REASON }]);
    // The screen reflects the declaration it just made: who and when, not only the mode.
    await expect(page.getByText(/Declared by Office Administrator/)).toBeVisible();
  });

  /*
   * RE-POINTED, NOT DELETED — AND THE REVERSAL IS STATED.
   *
   * This test used to assert that the screen showed a sentence saying COMBINED could not be declared
   * because the self-approval report did not exist, and that the API refused it with a 403. BOTH
   * HALVES ARE NOW FALSE: the gate was lifted on 2026-09-26 in the commit that shipped
   * `GET /internal-controls/combined-duty-acts`, and `DutySegregationModeService.declare` has
   * refused nothing since.
   *
   * It passed anyway, for twenty-six days, because it MOCKED the 403 — the recorded class that a
   * mocked endpoint cannot refuse you, so a precondition that has gone is invisible to it.
   *
   * WHAT SURVIVES IS THE PROPERTY WORTH KEEPING: the screen renders the API's OWN sentence rather
   * than a generic failure, so a refusal that explains itself is not swallowed. Driven here by a
   * refusal the API can still produce.
   */
  test("a refusal is rendered as the API's own sentence, not a generic failure", async ({
    page,
  }) => {
    await mockModePage(page, {
      declareStatus: 403,
      declareBody: {
        message:
          "Whoever declares the mode is not whoever reviews the acts it permits.",
      },
    });
    await page.goto("/settings/duty-segregation");

    await page.getByTestId("duty-mode-combined").check();
    await page.getByTestId("duty-mode-reason").fill(REASON);
    await page.getByTestId("duty-mode-declare").click();

    // The API's sentence, not a generic failure — the screen must not swallow a refusal that explains itself.
    await expect(page.locator("main").getByRole("alert")).toContainText(
      "reviews the acts it permits",
    );
    // And the setting did not move.
    await expect(page.getByTestId("duty-mode-current")).toContainText(
      "two people required",
    );
  });

  test("whoever reviews the acts sees the setting and cannot change it", async ({
    page,
  }) => {
    // Compliance holds `internal-controls.view` and not `duty-segregation.mode.declare` — measured against the
    // seeded grid, which is what decides this rather than the test.
    await mockModePage(page, {
      roles: ["COMPLIANCE_OFFICER"],
      declared: true,
    });
    await page.goto("/settings/duty-segregation");

    const readOnly = page.getByTestId("duty-mode-read-only");
    await expect(readOnly).toBeVisible();
    await expect(page.getByTestId("duty-mode-current")).toBeVisible();
    // No form at all — anchored on something that proves the page rendered.
    await expectNone(page.getByTestId("duty-mode-declare"), readOnly);
    await expectNone(page.getByTestId("duty-mode-reason"), readOnly);
  });
});

/*
 * MODULE 0-ب — THE DPO ASSIGNMENT, AND THE DECLARATION WHEN ONE PERSON HOLDS BOTH.
 *
 * The property that matters most is the PAIR: the notice appears AND the arrangement still saves. A
 * test asserting only the notice would pass against an implementation that also blocked — which is
 * exactly what the struck hard block did, and what the owner reversed.
 */
test.describe("the DPO assignment", () => {
  test("asks nothing when the DPO is somebody other than the manager", async ({
    page,
  }) => {
    const posted: RecordedDpo[] = [];
    await mockModePage(page, { onRecordDpo: (b) => posted.push(b) });
    await page.goto("/settings/duty-segregation");

    await expect(page.getByTestId("dpo-assign-manager")).toContainText(MANAGER);

    await page.getByTestId("dpo-assign-name").fill(SOMEBODY_ELSE);
    // NO NOTICE AND NO TICK. Anchored on a positive read from the same render, because
    // `toHaveCount(0)` passes on its first poll and an unhydrated page would satisfy an absence.
    await expect(page.getByTestId("dpo-assign-save")).toBeEnabled();
    await expectNone(
      page.getByTestId("dpo-assign-notice"),
      page.getByTestId("dpo-assign-save"),
    );

    await page.getByTestId("dpo-assign-save").click();
    // AND NO DECLARATION IS SENT. A screen that sent one anyway would record an acknowledgement of a
    // notice nobody was shown.
    expect(posted).toEqual([{ dataProtectionOfficerName: SOMEBODY_ELSE }]);
  });

  test("shows the owner's notice, holds the save until it is ticked, and SENDS what was rendered", async ({
    page,
  }) => {
    const posted: RecordedDpo[] = [];
    await mockModePage(page, { onRecordDpo: (b) => posted.push(b) });
    await page.goto("/settings/duty-segregation");

    await page.getByTestId("dpo-assign-name").fill(MANAGER);

    const notice = page.getByTestId("dpo-assign-notice");
    await expect(notice).toBeVisible();
    // THE ARTICLE AND THE PERMISSION, asserted separately — each is a clause a reword drops, and the
    // second is the half the struck block would have contradicted.
    await expect(notice).toContainText("article 11/a");
    await expect(notice).toContainText("does not prevent it");

    // `role="status"`, NEVER `alert`: this is the basis of something the system PERMITS. An `alert`
    // would tell an office of one person that something is wrong with an arrangement the owner
    // specifically decided to allow.
    await expect(notice).toHaveAttribute("role", "status");

    const save = page.getByTestId("dpo-assign-save");
    // NOT PRE-TICKED, and the save is held until it is. Both halves, because a pre-ticked box makes
    // the acknowledgement a field rather than an act.
    await expect(page.getByTestId("dpo-assign-acknowledge")).not.toBeChecked();
    await expect(save).toBeDisabled();

    await page.getByTestId("dpo-assign-acknowledge").check();
    await expect(save).toBeEnabled();
    await save.click();

    // THE SENT BODY AGAINST THE RENDERED ELEMENT — decision 28's precedent, and the only form that
    // can catch the server being sent a sentence nobody saw.
    expect(posted).toHaveLength(1);
    const sent = posted[0].combinedAssignmentDeclaration;
    expect(sent?.acknowledged).toBe(true);
    const rendered = (await notice.textContent()) ?? "";
    expect(sent?.noticeShown).toContain(rendered.trim());
    // And the acknowledgement line travels with it: it is her fourth paragraph and part of the record.
    expect(sent?.noticeShown).toMatch(/Acknowledge that you have read the above/i);
  });

  /*
   * THE SECOND PATH IN, and the one the screen deliberately cannot predict: two spellings of one name
   * that the server's canonical fold treats as the same person. The screen holds no copy of that fold
   * — a second copy of "are these the same person" is a second answer to it — so the server's 422 is
   * what reveals the notice.
   */
  test("reveals the notice when the SERVER says the two names are one person", async ({
    page,
  }) => {
    await mockModePage(page, {
      dpoStatus: 422,
      dpoBody: {
        code: "DPO_MANAGER_COMBINED_DECLARATION_REQUIRED",
        message:
          "The office-manager assignment and the data-protection-officer assignment name the same person. That is permitted, and this office may keep it.",
      },
    });
    await page.goto("/settings/duty-segregation");

    // A DIFFERENT SPELLING, so the screen's own optimistic comparison does NOT fire — which is what
    // makes this test about the server's path rather than about the client's.
    await page.getByTestId("dpo-assign-name").fill("mira al qudah");
    await expectNone(
      page.getByTestId("dpo-assign-notice"),
      page.getByTestId("dpo-assign-save"),
    );

    await page.getByTestId("dpo-assign-save").click();

    // The server's OWN sentence, not a generic failure — and the notice now rendered.
    await expect(page.getByTestId("dpo-assign")).toContainText(
      "That is permitted",
    );
    await expect(page.getByTestId("dpo-assign-notice")).toBeVisible();
  });

  test("a reviewer sees the assignment and is offered no form", async ({
    page,
  }) => {
    await mockModePage(page, { roles: ["COMPLIANCE_OFFICER"] });
    await page.goto("/settings/duty-segregation");

    // Positive read first, from the same render, so the absence below cannot pass on an unhydrated page.
    await expect(page.getByTestId("dpo-assign-manager")).toContainText(MANAGER);
    await expectNone(
      page.getByTestId("dpo-assign-name"),
      page.getByTestId("dpo-assign-manager"),
    );
  });
});
