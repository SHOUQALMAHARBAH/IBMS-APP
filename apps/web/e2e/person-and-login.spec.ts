import { expect, test, type Page, type Request } from "@playwright/test";
import { permissionsForRoles } from "./fixtures/role-permissions";
import { expectNone } from "./support/anchored";

/**
 * ONE PERSON, ONE SCREEN, ONE SAVE.
 *
 * Registering someone who needed a login was two screens in a fixed order — record the employee, then
 * go to Settings → Users and pick them out of a dropdown. The dropdown listed EXISTING employees, so
 * the person being registered was by definition never in it, and the two org-unit fields it demanded
 * had no source screen at all. The owner met all of that as "the button is broken".
 *
 * What these tests hold in place:
 *
 *   1. ONE request. If the login half ever posts separately, a failed second call leaves a person who
 *      half exists — so the test asserts what was sent, and that `/employees` was NOT called.
 *   2. The login half is ABSENT, with a sentence, for a role that cannot issue logins. Measured, not
 *      hypothetical: BRANCH_DEPARTMENT_MANAGER holds `employee.create` and not `user.manage`.
 *   3. A refusal names the way forward. An account needs a department and a branch; if the office has
 *      none, the screen says where to create them instead of failing on submit.
 */
const ME_BASE = {
  id: "user-1",
  email: "admin@ibms.test",
  fullName: "Office Administrator",
  languagePreference: "EN",
  mfaEnabled: true,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

const SALES_ROLE = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "SALES_RELATIONSHIP_OFFICER",
  nameEn: "Sales / Relationship Officer",
  nameAr: "موظف المبيعات وعلاقات العملاء",
  description: null,
  status: "ACTIVE",
};
const RETIRED_ROLE = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "OLD_DESK",
  nameEn: "Old desk",
  nameAr: "مكتب قديم",
  description: null,
  status: "INACTIVE",
};

const CLAIMS_DEPT = { id: "dept-1", name: "Claims", nameAr: "المطالبات" };
const IRBID_BRANCH = { id: "branch-1", name: "Irbid", nameAr: "إربد" };

const EMPLOYEE_ROW = {
  id: "emp-1",
  fullName: "سلمى خالد المحاربة",
  position: "Placement Officer",
  hireDate: "2020-06-01T00:00:00.000Z",
  terminationDate: null,
  licensedRole: null,
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

/** Everything the screen reads. `orgUnits: false` is an office that has created neither. */
async function mockScreen(
  page: Page,
  opts: { orgUnits?: boolean } = {},
): Promise<{ posts: Request[] }> {
  const posts: Request[] = [];
  const units = opts.orgUnits ?? true;

  await page.route("http://localhost:4000/employees", (route) => {
    if (route.request().method() === "POST") {
      posts.push(route.request());
      return route.fulfill({ status: 201, json: { ...EMPLOYEE_ROW, id: "emp-new" } });
    }
    return route.fulfill({ status: 200, json: [EMPLOYEE_ROW] });
  });
  await page.route("http://localhost:4000/admin/users", (route) => {
    if (route.request().method() === "POST") {
      posts.push(route.request());
      return route.fulfill({
        status: 201,
        json: { id: "user-new", email: "salma@ibms.test", fullName: EMPLOYEE_ROW.fullName },
      });
    }
    return route.fulfill({ status: 200, json: { users: [], total: 0 } });
  });
  await page.route("http://localhost:4000/admin/departments", (route) =>
    route.fulfill({ status: 200, json: units ? [CLAIMS_DEPT] : [] }),
  );
  await page.route("http://localhost:4000/admin/branches", (route) =>
    route.fulfill({ status: 200, json: units ? [IRBID_BRANCH] : [] }),
  );
  await page.route("http://localhost:4000/rbac/roles", (route) =>
    route.fulfill({ status: 200, json: [SALES_ROLE, RETIRED_ROLE] }),
  );
  return { posts };
}

async function fillPerson(page: Page) {
  await page.locator('[data-person-field="givenName"]').fill("سلمى");
  await page.locator('[data-person-field="familyName"]').fill("المحاربة");
  await page.locator('[data-person-field="nationalId"]').fill("9881234567");
  await page.locator('[data-person-field="hireDate"]').fill("2026-02-01");
}

test("ONE request creates the person and the login together", async ({ page }) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  const { posts } = await mockScreen(page);
  await page.goto("/employees");

  await fillPerson(page);
  await page.locator('[data-person-field="givenNameEn"]').fill("Salma");
  await page.locator('[data-person-field="familyNameEn"]').fill("Almaharbah");
  await page.locator('[data-person-field="departmentId"]').selectOption(CLAIMS_DEPT.id);
  await page.locator('[data-person-field="branchId"]').selectOption(IRBID_BRANCH.id);

  await page.locator("[data-give-login]").check();
  await page.locator('[data-account-field="email"]').fill("salma@ibms.test");
  await page.locator('[data-account-field="password"]').fill("Another-Correct-Horse-7!");
  await page.locator(`[data-account-role="${SALES_ROLE.id}"]`).check();
  await page.getByRole("button", { name: "Record the person and create the login" }).click();

  await expect.poll(() => posts.length).toBe(1);
  // ONE request, to the route that writes both rows in one transaction.
  const [sent] = posts;
  expect(sent.url()).toContain("/admin/users");
  const body = sent.postDataJSON() as {
    email: string;
    departmentId: string;
    branchId: string;
    roleIds: string[];
    fullName?: string;
    employee?: Record<string, string>;
  };
  expect(body.employee?.givenName).toBe("سلمى");
  expect(body.employee?.nationalId).toBe("9881234567");
  // Composed from what was typed; the father's English name was not given and is not invented.
  expect(body.employee?.givenNameEn).toBe("Salma");
  expect(body.employee?.fatherNameEn).toBeUndefined();
  // One pair of org-unit fields, used for both rows — nothing for them to disagree about.
  expect(body.departmentId).toBe(CLAIMS_DEPT.id);
  expect(body.branchId).toBe(IRBID_BRANCH.id);
  expect(body.roleIds).toEqual([SALES_ROLE.id]);
  // No fullName: the API refuses one alongside a person, because two spellings of one person leave
  // nothing to say which is right.
  expect(body.fullName).toBeUndefined();
});

test("the same form records a person with NO login", async ({ page }) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  const { posts } = await mockScreen(page);
  await page.goto("/employees");

  await fillPerson(page);
  await page.locator('[data-person-field="departmentId"]').selectOption(CLAIMS_DEPT.id);
  await page.getByRole("button", { name: "Record employee" }).click();

  await expect.poll(() => posts.length).toBe(1);
  const [sent] = posts;
  // The person-only route. Which endpoint is called is invisible to whoever pressed Save; that it is
  // ONE call either way is the property.
  expect(sent.url()).toMatch(/\/employees$/);
  const body = sent.postDataJSON() as { givenName: string; departmentId?: string };
  expect(body.givenName).toBe("سلمى");
  expect(body.departmentId).toBe(CLAIMS_DEPT.id);
});

test("a Manager can record people and is told plainly that logins are not theirs to give", async ({
  page,
}) => {
  // Measured against the seeded grid, not assumed: BRANCH_DEPARTMENT_MANAGER holds employee.create,
  // department.read and branch.read — and NOT user.manage.
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await mockScreen(page);
  await page.goto("/employees");

  // Positive anchor first, so the absence below means something.
  await expect(page.getByRole("heading", { name: "Record a new employee" })).toBeVisible();
  await expect(page.locator('[data-person-field="givenName"]')).toBeVisible();
  // The placement fields are there — they hold both read codes.
  await expect(page.locator('[data-person-field="departmentId"]')).toBeVisible();

  await expectNone(
    page.locator("[data-give-login]"),
    page.locator('[data-person-field="givenName"]'),
  );
  // Absent AND explained. A missing control with no sentence reads as a missing feature.
  await expect(page.locator("[data-no-login-permission]")).toContainText("user.manage");
});

test("an office with no departments is told where to create them, not refused on submit", async ({
  page,
}) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  const { posts } = await mockScreen(page, { orgUnits: false });
  await page.goto("/employees");

  await fillPerson(page);
  await page.locator("[data-give-login]").check();

  const blocked = page.locator("[data-account-blocked]");
  await expect(blocked).toBeVisible();
  await expect(blocked.getByRole("link", { name: "Departments & branches" })).toBeVisible();
  // And the button cannot be pressed into a 422 that says the same thing later.
  await expect(
    page.getByRole("button", { name: "Record the person and create the login" }),
  ).toBeDisabled();
  expect(posts).toEqual([]);
});

test("does not offer a RETIRED role, and refuses to submit with no role at all", async ({
  page,
}) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  const { posts } = await mockScreen(page);
  await page.goto("/employees");

  await fillPerson(page);
  await page.locator('[data-person-field="departmentId"]').selectOption(CLAIMS_DEPT.id);
  await page.locator('[data-person-field="branchId"]').selectOption(IRBID_BRANCH.id);
  await page.locator("[data-give-login]").check();
  await page.locator('[data-account-field="email"]').fill("salma@ibms.test");
  await page.locator('[data-account-field="password"]').fill("Another-Correct-Horse-7!");

  // A retired role grants nothing, so offering one would hand a new account a row that reads as
  // access and confers none.
  await expect(page.locator(`[data-account-role="${SALES_ROLE.id}"]`)).toBeVisible();
  await expectNone(
    page.locator(`[data-account-role="${RETIRED_ROLE.id}"]`),
    page.locator(`[data-account-role="${SALES_ROLE.id}"]`),
  );

  await page.getByRole("button", { name: "Record the person and create the login" }).click();
  // Scoped to main: Next renders its own route announcer with role="alert", so a page-wide
  // getByRole("alert") is a strict-mode violation rather than a reading of this screen.
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "at least one role",
  );
  // Refused HERE, so the account is never created without the access that makes it usable.
  expect(posts).toEqual([]);
});

/**
 * THE SECOND CASE THE PICKER USED TO COVER.
 *
 * Someone recorded weeks ago, with no login, who now needs one. The account screen's employee dropdown
 * was the only way to do it; removing that dropdown without putting this here would have made a live
 * API surface unreachable from the product — which is exactly what IMPROVEMENTS § 1.44 had to measure
 * across four other endpoints.
 */
const DETAIL_BASE = {
  ...EMPLOYEE_ROW,
  givenName: "سلمى",
  fatherName: "خالد",
  grandfatherName: null,
  familyName: "المحاربة",
  nationalId: "***4567",
  confidentialityAgreementSignedAt: null,
  backgroundCheckCompletedAt: null,
  createdAt: "2020-06-01T09:00:00.000Z",
  updatedAt: "2020-06-01T09:00:00.000Z",
  trainings: [],
  deprovisioningChecklist: null,
};

async function mockDetail(
  page: Page,
  account: { id: string; email: string } | null,
): Promise<{ posts: Request[] }> {
  const posts: Request[] = [];
  await page.route("http://localhost:4000/employees/emp-1", (route) =>
    route.fulfill({ status: 200, json: { ...DETAIL_BASE, account } }),
  );
  await page.route("http://localhost:4000/admin/users", (route) => {
    if (route.request().method() === "POST") {
      posts.push(route.request());
      return route.fulfill({
        status: 201,
        json: { id: "user-new", email: "salma@ibms.test", fullName: DETAIL_BASE.fullName },
      });
    }
    return route.fulfill({ status: 200, json: { users: [], total: 0 } });
  });
  await page.route("http://localhost:4000/admin/departments", (route) =>
    route.fulfill({ status: 200, json: [CLAIMS_DEPT] }),
  );
  await page.route("http://localhost:4000/admin/branches", (route) =>
    route.fulfill({ status: 200, json: [IRBID_BRANCH] }),
  );
  await page.route("http://localhost:4000/rbac/roles", (route) =>
    route.fulfill({ status: 200, json: [SALES_ROLE, RETIRED_ROLE] }),
  );
  return { posts };
}

test("a person recorded earlier can be given a login from their own page", async ({ page }) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  const { posts } = await mockDetail(page, null);
  await page.goto("/employees/emp-1");

  await page.locator("[data-open-login-form]").click();
  await page.locator('[data-account-field="email"]').fill("salma@ibms.test");
  await page.locator('[data-account-field="password"]').fill("Another-Correct-Horse-7!");
  await page.locator('[data-account-field="departmentId"]').selectOption(CLAIMS_DEPT.id);
  await page.locator('[data-account-field="branchId"]').selectOption(IRBID_BRANCH.id);
  await page.locator(`[data-account-role="${SALES_ROLE.id}"]`).check();
  await page.locator("[data-submit-login]").click();

  await expect.poll(() => posts.length).toBe(1);
  const body = posts[0].postDataJSON() as {
    employeeId?: string;
    employee?: unknown;
    fullName?: string;
  };
  // Links THIS person by id — no person block, because the person already exists.
  expect(body.employeeId).toBe("emp-1");
  expect(body.employee).toBeUndefined();
  // And no name: it comes from the record, and the API refuses one that disagrees with it.
  expect(body.fullName).toBeUndefined();
});

test("names the login a person already holds instead of offering a second", async ({ page }) => {
  await mockAuth(page, ["OFFICE_ADMINISTRATOR"]);
  await mockDetail(page, { id: "user-7", email: "salma@ibms.test" });
  await page.goto("/employees/emp-1");

  // `User.employeeId` is unique, so a second login is not a thing to attempt and then be refused.
  // The screen knows because the detail response says so.
  await expect(page.locator('[data-existing-account="user-7"]')).toContainText(
    "salma@ibms.test",
  );
  await expectNone(
    page.locator("[data-open-login-form]"),
    page.locator("[data-login-section]"),
  );
});
