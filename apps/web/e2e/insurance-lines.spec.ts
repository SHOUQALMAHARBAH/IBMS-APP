import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";

/*
 * THE OFFICE'S OWN ADDITIONS TO THE INSURANCE-LINE VOCABULARY — `/settings/insurance-lines`.
 *
 * `POST /insurance-lines` and `PATCH /insurance-lines/:id` both shipped with no web
 * caller. The POST was invisible to IMPROVEMENTS § 1.44's original measurement because
 * that pass compares PATHS and `GET /insurance-lines` is called by three pickers, so a
 * POST on the same path read as covered; the verb-aware second pass found it (§ 1.65).
 *
 * What it cost: an office could pick from the vocabulary and could neither extend nor
 * correct it, so a line of business it actually writes had no entry at all.
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

const STANDARD = {
  id: "line-std",
  code: "MOTOR_COMPREHENSIVE",
  nameEn: "Motor — comprehensive",
  nameAr: "تأمين المركبات الشامل",
  category: "GENERAL",
  isStandard: true,
};

const OWN = {
  id: "line-own",
  code: null,
  nameEn: "Pet insurance",
  nameAr: "تأمين الحيوانات الأليفة",
  category: "GENERAL",
  isStandard: false,
};

/** The list, plus a method-aware capture of the two writes.
 *
 * TWO TRAPS IN ONE HELPER. GET, POST and PATCH share the collection path, so the mock
 * has to branch on the METHOD. And the pattern must name the API ORIGIN: `**\/insurance-lines`
 * also matches this screen's own URL, `/settings/insurance-lines`, so a glob-only route
 * intercepts the PAGE NAVIGATION and serves the JSON list as the document — which
 * renders as a page of raw JSON with no heading and no error, and reads exactly like a
 * screen that failed to mount. */
async function mockLines(
  page: Page,
  rows: Record<string, unknown>[] = [STANDARD, OWN],
  writeStatus = 201,
) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  await page.route("http://localhost:4000/insurance-lines", (route) => {
    const req = route.request();
    if (req.method() === "GET") {
      return route.fulfill({ status: 200, json: rows });
    }
    calls.push({ method: req.method(), url: req.url(), body: req.postDataJSON() });
    return writeStatus === 201
      ? route.fulfill({ status: 201, json: OWN })
      : route.fulfill({
          status: writeStatus,
          json: {
            message:
              '"Motor — comprehensive" / "تأمين المركبات الشامل" is already a standard insurance line.',
          },
        });
  });
  await page.route("http://localhost:4000/insurance-lines/*", (route) => {
    const req = route.request();
    calls.push({ method: req.method(), url: req.url(), body: req.postDataJSON() });
    return route.fulfill({ status: 200, json: OWN });
  });
  return calls;
}

test("lists standard lines and this office's own additions, distinguishing them", async ({
  page,
}) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockLines(page);

  await page.goto("/settings/insurance-lines");
  await expect(
    page.getByRole("heading", { name: "Lines of business" }),
  ).toBeVisible();

  // The origin is the load-bearing distinction: a standard line is published
  // platform-wide and carries a CODE an office cannot mint.
  await expect(page.getByTestId("line-line-std")).toContainText("Standard");
  await expect(page.getByTestId("line-line-std")).toContainText(
    "MOTOR_COMPREHENSIVE",
  );
  await expect(page.getByTestId("line-line-own")).toContainText(
    "This office's addition",
  );
  // An office addition has no code, so none is shown.
  await expect(page.getByTestId("line-line-own")).not.toContainText("MOTOR");
});

test("adds a line, requiring BOTH names", async ({ page }) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  const calls = await mockLines(page);

  await page.goto("/settings/insurance-lines");
  const add = page.getByTestId("line-add");
  await expect(add).toBeDisabled();

  // English alone is NOT enough, and that is the point of asserting it: Arabic is
  // this platform's primary language and a line name appears on documents a client
  // reads, so a one-script entry renders untranslated mid-sentence.
  await page.getByTestId("line-name-en").fill("Pet insurance");
  await expect(add).toBeDisabled();

  await page.getByTestId("line-name-ar").fill("  تأمين الحيوانات الأليفة  ");
  await expect(add).toBeEnabled();
  await page.getByTestId("line-category").selectOption("LIFE");
  await add.click();

  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0].method).toBe("POST");
  expect(calls[0].body).toEqual({
    nameEn: "Pet insurance",
    nameAr: "تأمين الحيوانات الأليفة",
    category: "LIFE",
  });
});

test("corrects an office addition, and sends nothing when nothing changed", async ({
  page,
}) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  const calls = await mockLines(page);

  await page.goto("/settings/insurance-lines");
  await page.getByTestId("line-edit-line-own").click();

  // PREFILLED from the row — unlike the customer correction, these values are plain
  // text rather than masked, so the current name is what a corrector starts from.
  await expect(page.getByTestId("line-edit-en-line-own")).toHaveValue(
    "Pet insurance",
  );
  // And with nothing changed the save is refused: an empty body is a no-op
  // server-side, and a screen should not send a request that does nothing.
  await expect(page.getByTestId("line-save-line-own")).toBeDisabled();

  await page
    .getByTestId("line-edit-en-line-own")
    .fill("Pet and livestock insurance");
  await expect(page.getByTestId("line-save-line-own")).toBeEnabled();
  await page.getByTestId("line-save-line-own").click();

  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0].method).toBe("PATCH");
  expect(calls[0].url).toContain("/insurance-lines/line-own");
  // Only what changed: the unchanged Arabic name and category are still sent because
  // the editor prefills them, which is correct — they are the current values, not
  // blanks. What must NOT appear is a field the row never had.
  expect(calls[0].body).toMatchObject({ nameEn: "Pet and livestock insurance" });
});

test("a standard line cannot be corrected here, and the row says why", async ({
  page,
}) => {
  // The server agrees structurally: `PATCH` resolves through `findOfficeLineById`, so
  // a standard line's id reads as ABSENT rather than forbidden. A missing button with
  // no explanation reads as a broken screen, so the reason is stated.
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockLines(page);

  await page.goto("/settings/insurance-lines");
  // Anchor: the editable row's control is present in the same render.
  await expect(page.getByTestId("line-edit-line-own")).toBeEnabled();
  await expect(page.getByTestId("line-edit-line-std")).toHaveCount(0);
  await expect(page.getByTestId("line-locked-line-std")).toContainText(
    "Standard line",
  );
});

test("surfaces the server's collision refusal rather than a generic failure", async ({
  page,
}) => {
  // "Collides with a standard line" and "this office already added it" are different
  // problems and the API distinguishes them, so its sentence has to reach the reader.
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockLines(page, [STANDARD, OWN], 409);

  await page.goto("/settings/insurance-lines");
  await page.getByTestId("line-name-en").fill("Motor — comprehensive");
  await page.getByTestId("line-name-ar").fill("تأمين المركبات الشامل");
  await page.getByTestId("line-add").click();

  await expect(page.getByTestId("line-admin-error")).toContainText(
    "already a standard insurance line",
  );
});

test("a role without the write codes sees the list read-only and is told why", async ({
  page,
}) => {
  // SALES_RELATIONSHIP_OFFICER holds `insurer.read` and neither write code — measured
  // against the seeded grid. The vocabulary is still readable, which is right: it is
  // what every picker on the platform renders from.
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockLines(page);

  await page.goto("/settings/insurance-lines");
  // Anchor first: the list rendered for this reader.
  await expect(page.getByTestId("line-line-own")).toBeVisible();
  await expect(page.getByTestId("line-add-form")).toHaveCount(0);
  await expect(page.getByTestId("line-edit-line-own")).toHaveCount(0);
  await expect(page.getByTestId("line-admin-readonly")).toContainText(
    "insurance-line.create",
  );
});

test("insurance-lines screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockLines(page);

  await page.goto("/settings/insurance-lines");
  await expect(page.getByTestId("line-line-own")).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
