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

async function mockModePage(
  page: Page,
  opts: {
    roles?: string[];
    declared?: boolean;
    onDeclare?: (body: { mode: string; reason: string }) => void;
    declareStatus?: number;
    declareBody?: unknown;
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

  test("COMBINED is offered, refused, and the refusal is the API's own sentence", async ({
    page,
  }) => {
    await mockModePage(page, {
      declareStatus: 403,
      declareBody: {
        message:
          "COMBINED mode cannot be declared yet: the self-approval report it depends on does not exist.",
      },
    });
    await page.goto("/settings/duty-segregation");

    // Visible and explained, not hidden.
    await expect(page.getByTestId("duty-mode-combined-blocked")).toContainText(
      "self-approval report",
    );

    await page.getByTestId("duty-mode-combined").check();
    await page.getByTestId("duty-mode-reason").fill(REASON);
    await page.getByTestId("duty-mode-declare").click();

    // The API's sentence, not a generic failure — the screen must not swallow a refusal that explains itself.
    await expect(
      page.locator("main").getByRole("alert"),
    ).toContainText("self-approval report");
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
