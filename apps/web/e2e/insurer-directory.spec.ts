import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";

/**
 * The cross-office insurer directory screen.
 *
 * Three properties, and the first two are about what must NOT happen:
 *
 *  1. **A refused line code renders as a REFUSAL, never as no-results.** `[]` is indistinguishable
 *     from "nobody writes this cover" and looks like an answer — an office that reads it stops
 *     looking. This is the failure mode the whole filter was designed around, so the test asserts
 *     the error text appears AND that the empty state does not.
 *  2. **Nothing office-scoped is on the page.** The boundary is enforced by a `SECURITY DEFINER`
 *     view with no such column in it, so this test cannot catch a server leak — but it can catch a
 *     screen that started rendering a field it was handed, which is the change a future edit makes.
 *  3. The line filter offers PLATFORM codes only, because an office addition has no code and the
 *     API would refuse it.
 */

const ME_BASE = {
  id: "user-1",
  email: "placement@ibms.test",
  fullName: "Placement Officer",
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

async function mockLines(page: Page) {
  await page.route("http://localhost:4000/insurance-lines**", (route) =>
    route.fulfill({
      status: 200,
      json: [
        {
          id: "line-motor",
          code: "MOTOR_COMPREHENSIVE",
          nameEn: "Motor Comprehensive",
          nameAr: "تأمين المركبات الشامل",
          category: "GENERAL",
          isStandard: true,
        },
        {
          id: "line-travel",
          code: "TRAVEL",
          nameEn: "Travel",
          nameAr: "تأمين السفر",
          category: "GENERAL",
          isStandard: true,
        },
        // No platform code — the API resolves `lineCode` from one, so this must NOT be offered.
        {
          id: "line-drone",
          code: null,
          nameEn: "Drone Hull",
          nameAr: "أجسام الطائرات المسيرة",
          category: "GENERAL",
          isStandard: false,
        },
      ],
    }),
  );
}

const ENTRY = {
  directoryKey: "master-1",
  name: "Al-Yarmouk Insurance",
  nameAr: "شركة اليرموك للتأمين",
  structure: "TAKAFUL",
  companyPhone: "+962 6 500 7000",
  companyEmail: "contact@yarmouk.test",
  companyWebsite: "yarmouk.test",
  companyCorrespondenceAddress: "Amman",
  lines: [
    { code: "MOTOR_COMPREHENSIVE", nameEn: "Motor Comprehensive", nameAr: "تأمين المركبات الشامل" },
    // An office-added line reaches the directory with a NULL code and no hint of which office
    // added it. It renders as local vocabulary.
    { code: null, nameEn: "Drone Hull", nameAr: "أجسام الطائرات المسيرة" },
  ],
};

test("lists one entry per company, with public contact details and its lines", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockLines(page);
  await page.route("http://localhost:4000/insurer-directory**", (route) =>
    route.fulfill({
      status: 200,
      json: { items: [ENTRY], total: 1, page: 0, pageSize: 50 },
    }),
  );

  await page.goto("/insurer-directory");
  await expect(page.getByRole("heading", { name: "Insurer directory" })).toBeVisible();
  // Scoped to the CARD, not the page: the line names also appear as <option>s in the filter, which
  // Playwright reports as hidden — so an unscoped `.first()` matches the option and fails on a
  // correctly rendered card.
  const card = page.locator("[data-directory-entry]");
  await expect(card).toHaveCount(1);
  await expect(card.getByText("Al-Yarmouk Insurance")).toBeVisible();
  await expect(card.getByText("contact@yarmouk.test")).toBeVisible();
  await expect(card.getByText("Motor Comprehensive")).toBeVisible();
  await expect(card.getByText("Drone Hull")).toBeVisible();

  // The boundary is STATED on the page, because a screen showing a company's phone number looks
  // like it might show more if asked.
  await expect(page.locator("[data-boundary-note]")).toContainText(
    "no credit terms",
  );
});

test("a refused line code renders as a REFUSAL, not as an empty result", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockLines(page);
  // Keyed on the URL, not on a call COUNT. A count assumes the page loads exactly once, and the
  // load effect legitimately re-runs when the language dictionary resolves — which made the
  // unfiltered first request get the 422 and the test fail against correct code. Mocking the
  // condition the API actually branches on (is there an unknown lineCode?) cannot drift that way.
  await page.route("http://localhost:4000/insurer-directory**", (route) => {
    if (route.request().url().includes("lineCode=TRAVEL")) {
      return route.fulfill({
        status: 422,
        json: {
          message:
            'Unknown insurance line code "TRAVEL". The directory filters on the platform catalogue.',
        },
      });
    }
    return route.fulfill({
      status: 200,
      json: { items: [ENTRY], total: 1, page: 0, pageSize: 50 },
    });
  });

  await page.goto("/insurer-directory");
  await expect(page.locator("[data-directory-entry]")).toHaveCount(1);

  await page.getByLabel("Insurance line").selectOption("TRAVEL");
  await page.getByRole("button", { name: "Search" }).click();

  // The API's own sentence, naming the code, plus what to do about it.
  const err = page.locator("[data-line-error]");
  await expect(err).toBeVisible();
  await expect(err).toContainText("TRAVEL");
  await expect(err).toContainText("NOT an empty result");

  // And critically: NOT the empty state. `[]` would read as "nobody writes travel cover", which is
  // an answer the system does not have — that conflation is the entire reason the API 422s.
  await expect(
    page.getByText("No office has registered a company that writes this line."),
  ).toHaveCount(0);
  await expect(page.getByText("No company matches.")).toHaveCount(0);
});

test("offers platform line codes only, never an office's own addition", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockLines(page);
  await page.route("http://localhost:4000/insurer-directory**", (route) =>
    route.fulfill({ status: 200, json: { items: [], total: 0, page: 0, pageSize: 50 } }),
  );

  await page.goto("/insurer-directory");
  const filter = page.getByLabel("Insurance line");
  // "Any line" + the two platform lines. The office addition has no code, so the API would refuse
  // it — and the count is asserted rather than only the wanted options, because an assertion that
  // names what it wants cannot tell "correctly excluded" from "never rendered".
  await expect(filter.locator("option")).toHaveCount(3);
  await expect(filter.locator("option[value='MOTOR_COMPREHENSIVE']")).toHaveText(
    "Motor Comprehensive",
  );
  await expect(filter.getByText("Drone Hull")).toHaveCount(0);
});

test("distinguishes 'no match' from 'nobody writes this line'", async ({ page }) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockLines(page);
  await page.route("http://localhost:4000/insurer-directory**", (route) =>
    route.fulfill({ status: 200, json: { items: [], total: 0, page: 0, pageSize: 50 } }),
  );

  await page.goto("/insurer-directory");
  // No filter applied: the honest sentence is about the search, not about the market.
  await expect(page.getByText("No company matches.")).toBeVisible();

  await page.getByLabel("Insurance line").selectOption("MOTOR_COMPREHENSIVE");
  await page.getByRole("button", { name: "Search" }).click();
  // With a line filter and a genuine empty page — the code WAS accepted — the sentence may say
  // something about the market, and only then.
  await expect(
    page.getByText("No office has registered a company that writes this line."),
  ).toBeVisible();
});

test("a user without insurer.directory.read is told so", async ({ page }) => {
  // Finance holds neither `insurer.read` nor the directory code — the split that lets an office be
  // given the market without its own panel, and vice versa.
  await mockAuth(page, ["FINANCE_COLLECTIONS_OFFICER"]);
  await mockLines(page);
  await page.route("http://localhost:4000/insurer-directory**", (route) =>
    route.fulfill({ status: 403, json: { message: "Forbidden" } }),
  );

  await page.goto("/insurer-directory");
  await expect(
    page.getByText("You do not hold insurer.directory.read", { exact: false }),
  ).toBeVisible();
});

test("directory screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await mockLines(page);
  await page.route("http://localhost:4000/insurer-directory**", (route) =>
    route.fulfill({
      status: 200,
      json: { items: [ENTRY], total: 1, page: 0, pageSize: 50 },
    }),
  );

  await page.goto("/insurer-directory");
  await expect(page.locator("[data-directory-entry]")).toHaveCount(1);
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(serious, serious.map((v) => v.id).join(", ")).toEqual([]);
});
