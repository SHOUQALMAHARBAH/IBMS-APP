import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";
import { pickEntity } from "./support/pick-entity";

const ME_BASE = {
  id: "user-1",
  email: "manager@ibms.test",
  fullName: "Branch Manager",
  languagePreference: "EN",
  mfaEnabled: false,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

async function mockAuth(page: Page, roles: string[], language = "EN") {
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fake-access-token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      status: 200,
      json: {
        ...ME_BASE,
        languagePreference: language,
        roles,
        permissions: permissionsForRoles(roles),
      },
    }),
  );
}

const HISTORY = [
  {
    id: "record-2",
    employeeId: "employee-1",
    periodLabel: "2026-08",
    newClients: 4,
    premiumWrittenJod: "52000.000",
    commissionEarnedJod: "7800.000",
    renewalRatePercent: "80.00",
    crossSellRatePercent: null,
  },
  {
    id: "record-1",
    employeeId: "employee-1",
    periodLabel: "2026-07",
    newClients: 2,
    premiumWrittenJod: "18000.000",
    commissionEarnedJod: "2700.000",
    renewalRatePercent: null,
    crossSellRatePercent: "50.00",
  },
];

async function mockList(page: Page, opts: { status?: number } = {}) {
  await page.route("http://localhost:4000/employee-performance*", (route) => {
    if (route.request().method() !== "GET") return route.continue();
    if (opts.status && opts.status !== 200) {
      return route.fulfill({ status: opts.status, json: { message: "no" } });
    }
    return route.fulfill({ status: 200, json: HISTORY });
  });
}

/**
 * The employee picker over `GET /employees/search` — the route that already existed and that neither
 * screen needing it could reach, because it was gated on the national-ID reveal.
 */
const EMPLOYEE_SEARCH = "http://localhost:4000/employees/search**";
const EMPLOYEE_OPTION = {
  id: "employee-1",
  fullName: "Ahmad Al-Test",
  fullNameEn: "Ahmad Al-Test",
  position: "Officer",
  isCurrentEmployee: true,
};

test("looks up an employee and renders latest stats plus history, with a dash for no-data rates", async ({
  page,
}) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await mockList(page);

  await page.goto("/employee-performance");
  await expect(
    page.getByRole("heading", { name: "Employee Performance" }),
  ).toBeVisible();
  await pickEntity(page, "employee", EMPLOYEE_OPTION, { route: EMPLOYEE_SEARCH });
  await page.getByRole("button", { name: "View performance" }).click();

  await expect(page.getByText("80.00%").first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "2026-07" })).toBeVisible();
});

test("a user without the permission sees a friendly message", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockList(page, { status: 403 });

  await page.goto("/employee-performance");
  await pickEntity(page, "employee", EMPLOYEE_OPTION, { route: EMPLOYEE_SEARCH });
  await page.getByRole("button", { name: "View performance" }).click();
  await expect(
    page.getByText("(employee-performance.view)", { exact: false }),
  ).toBeVisible();
});

test("triggers a compute and refreshes the history", async ({ page }) => {
  await mockAuth(page, ["EXECUTIVE_MANAGEMENT"]);
  await mockList(page);
  await page.route(
    "http://localhost:4000/employee-performance/compute",
    (route) => route.fulfill({ status: 201, json: HISTORY[0] }),
  );

  await page.goto("/employee-performance");
  await pickEntity(page, "employee", EMPLOYEE_OPTION, { route: EMPLOYEE_SEARCH });
  await page.getByRole("button", { name: "Compute" }).click();
  await expect(page.getByText("Record computed.")).toBeVisible();
});

test("employee performance screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await mockList(page);

  await page.goto("/employee-performance");
  await pickEntity(page, "employee", EMPLOYEE_OPTION, { route: EMPLOYEE_SEARCH });
  await page.getByRole("button", { name: "View performance" }).click();
  await expect(page.getByText("80.00%").first()).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
test("the period fields carry the owner's hint, wired to the control, and echo the date back", async ({
  page,
}) => {
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"], "AR");
  await mockList(page);

  await page.goto("/employee-performance");

  // HER SENTENCE, BY CONTENT. A presence check on the element would pass against a key that
  // resolved to the English half, which is how a half-translated screen ships green.
  const start = page.getByLabel("بداية الفترة (اختياري)");
  await expect(start).toBeVisible();
  await expect(
    page.getByText("أول يوم تُحسب عليه الأرقام في هذه الشاشة."),
  ).toBeVisible();

  // THE ASSOCIATION IS REAL, not merely adjacent: `aria-describedby` is what makes a screen
  // reader announce the hint as the field's description. A hint rendered beside a control it is
  // not wired to is a hint only one of the two readers gets.
  const describedBy = await start.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();
  await expect(page.locator(`#${describedBy}`)).toHaveText(
    "أول يوم تُحسب عليه الأرقام في هذه الشاشة.",
  );

  // THE ECHO. Typed into a month-first control, `2026-03-04` is 4 March; the Arabic rendering is
  // DAY-first, so the reader sees the two numbers in the other order and can tell which was read.
  await start.fill("2026-03-04");
  await expect(page.locator('[data-date-echo="2026-03-04"]')).toHaveText(
    "4‏/3‏/2026",
  );
});
