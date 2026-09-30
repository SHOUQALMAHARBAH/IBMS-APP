import { expect, test, type Page } from "@playwright/test";

/*
 * HOW LONG A PERMISSION DESCRIPTION THE ROLE SCREEN CAN ACTUALLY SHOW.
 *
 * The owner is about to write 219 Arabic descriptions as document prose for an office manager deciding a
 * grant — several of two or three sentences, the longest well beyond anything the map holds today (its
 * longest written line is 68 characters). If the screen truncates or breaks at that length she needs to know
 * BEFORE writing them, so she can write a short line per code and keep the full text in the handover
 * document instead.
 *
 * She asked for a measurement rather than an estimate, and a ladder rather than one number: I do not have
 * her longest line, so guessing a single length and reporting on it would be the estimate she ruled out.
 * Each rung reports what the browser actually did.
 *
 * WHAT IS MEASURED, and why each one:
 *
 *   rendered height     wrapping shows up here and nowhere else — a truncating element stays one line tall.
 *   full text present   a `textContent` compare catches truncation that CSS hides rather than removes
 *                       (`text-overflow: ellipsis` leaves the text in the DOM, so height alone can lie).
 *   row overflow        the description is a flex ITEM in a `flexWrap` row, and a flex item's default
 *                       `min-width: auto` is the classic way long content overflows its container.
 *   page overflow       the repo's own responsive rule: the page body must never scroll sideways.
 *
 * The descriptions reach the screen through the CATALOGUE mock rather than through the descriptions map,
 * because `describePermission` falls back to `Permission.description` for any code with no written line —
 * which is every code but five. That makes the length question answerable without touching the map.
 */

const ME_BASE = {
  id: "user-1",
  email: "admin@ibms.test",
  fullName: "Office Administrator",
  languagePreference: "AR",
  mfaEnabled: false,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

/** Arabic prose, repeated to a target length — the real script, because line-breaking is script-dependent. */
const SENTENCE =
  "يتيح هذا التصريح للموظف الاطلاع على السجل والتعديل عليه وفق ما تسمح به سياسة المكتب، ";

function arabicOfLength(target: number): string {
  let out = "";
  while (out.length < target) out += SENTENCE;
  return out.slice(0, target).trim();
}

/** The rungs. 68 is the longest line the map holds today, so it is the baseline rather than a rung. */
const LENGTHS = [68, 140, 240, 360, 480, 720];

const CUSTOM_ROLE = {
  id: "role-custom",
  name: "CLAIMS_TRIAGE_DESK",
  nameEn: "Claims Triage Desk",
  nameAr: "مكتب فرز المطالبات",
  description: "First look at every new claim.",
  status: "ACTIVE" as const,
  isSystem: false,
  requiresMfaAlways: true,
  requiresHardwareToken: true,
  holderCount: 3,
  permissionCodes: [],
};

async function mockScreen(page: Page) {
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fake-access-token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      status: 200,
      json: {
        ...ME_BASE,
        roles: ["OFFICE_ADMINISTRATOR"],
        permissions: ["role.read", "permission.read", "role.update"],
      },
    }),
  );
  await page.route("http://localhost:4000/rbac/roles", (route) =>
    route.fulfill({ status: 200, json: [CUSTOM_ROLE] }),
  );
  // The permission panel FETCHES the role before it renders the matrix. Without this the click succeeds,
  // the panel stays empty, and the measurement has nothing to measure — which is why the first run failed
  // on `[data-matrix-for]` rather than on anything about length.
  await page.route(
    `http://localhost:4000/rbac/roles/${CUSTOM_ROLE.id}`,
    (route) =>
      route.fulfill({
        status: 200,
        json: { ...CUSTOM_ROLE, permissionCodes: [] },
      }),
  );
  await page.route("http://localhost:4000/rbac/permissions", (route) =>
    route.fulfill({
      status: 200,
      json: LENGTHS.map((n) => ({
        code: `claims.len${n}`,
        module: "claims",
        description: arabicOfLength(n),
      })),
    }),
  );
}

test("a long permission description wraps rather than truncating, and does not break the row", async ({
  page,
}) => {
  await mockScreen(page);
  await page.goto("/settings/roles");

  // The matrix lives inside a role's permission panel, not on the screen by itself.
  await page
    .locator('[data-role="CLAIMS_TRIAGE_DESK"]')
    .getByRole("button", { name: /Permissions|الصلاحيات/ })
    .click();
  await expect(page.locator("[data-matrix-for]")).toHaveCount(1);

  // A module renders as a COLLAPSED `<details>`, so its rows are in the DOM with no layout box and
  // `boundingBox()` would return null — measuring nothing and reporting it as a clean result. Typing in
  // the matrix search forces every match open, which is the component's own documented behaviour rather
  // than a click on a summary this test would then depend on.
  await page.locator("[data-matrix-search]").fill("claims.len");

  const baseline = page.locator('[data-describes="claims.len68"]');
  await expect(baseline).toBeVisible();
  const baselineBox = await baseline.boundingBox();
  expect(baselineBox, "the baseline description has no box — the row did not render").not.toBeNull();
  const oneLine = baselineBox!.height;

  const report: string[] = [];
  for (const n of LENGTHS) {
    const el = page.locator(`[data-describes="claims.len${n}"]`);
    await expect(el).toBeVisible();
    const box = await el.boundingBox();
    expect(box).not.toBeNull();

    const measured = await el.evaluate((node) => {
      const row = node.closest("label");
      return {
        text: (node.textContent ?? "").length,
        clipped: node.scrollHeight > node.clientHeight + 1,
        rowOverflow: row ? row.scrollWidth > row.clientWidth + 1 : false,
        pageOverflow:
          document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      };
    });

    const lines = Math.round(box!.height / oneLine);
    report.push(
      `${String(n).padStart(4)} chars -> ${box!.height.toFixed(0)}px (~${lines} line${lines === 1 ? "" : "s"}), ` +
        `text in DOM ${measured.text}, clipped=${measured.clipped}, ` +
        `rowOverflow=${measured.rowOverflow}, pageOverflow=${measured.pageOverflow}`,
    );

    // THE WHOLE TEXT IS PRESENT. A CSS truncation leaves the text in the DOM and hides it, so this is
    // checked together with `clipped` below rather than on its own.
    expect(measured.text, `${n}-char description lost characters in the DOM`).toBe(
      arabicOfLength(n).length,
    );
    expect(measured.clipped, `${n}-char description is clipped by its own box`).toBe(false);
    expect(measured.rowOverflow, `${n}-char description overflows its row`).toBe(false);
    expect(measured.pageOverflow, `${n}-char description makes the page scroll sideways`).toBe(false);
  }

  // Printed so the numbers are readable in the run output rather than inferred from a pass.
  console.log("permission description length ladder:\n  " + report.join("\n  "));

  // AND IT MUST ACTUALLY GROW. Without this the four assertions above would pass on a screen that
  // rendered every rung as one truncated line — the shape of a guard that cannot fail.
  const longest = await page.locator(`[data-describes="claims.len720"]`).boundingBox();
  expect(
    longest!.height,
    "the longest description is no taller than a single line, so it is not wrapping",
  ).toBeGreaterThan(oneLine * 2);
});
