import { expect, test, type Page } from "@playwright/test";
import { permissionsForRoles } from "./fixtures/role-permissions";
import { anchoredTexts, expectNone } from "./support/anchored";

/**
 * ONE CONTROL FOR FINDING A NAMED THING.
 *
 * Ten forms asked for a raw `customerId`, which nobody knows, so the only way to fill one in was to open
 * another screen and copy a uuid out of the address bar. `CustomerPicker` fixed that for customers;
 * `EntitySearch` is the same control with the per-entity part moved into a source, and the picker is
 * deleted.
 *
 * What these tests hold in place is the behaviour that would otherwise be re-implemented — differently —
 * every time someone needs a picker:
 *
 *   1. Enter searches and does NOT submit the surrounding form. Get that wrong and every one of the ten
 *      screens submits a half-filled record the moment someone presses Enter in a search box.
 *   2. The four states each say something: populated, empty ("nobody by that name"), error, loading.
 *   3. A second entity kind reuses all of it. The audit actor source is that second kind, and it is the
 *      proof the abstraction is one rather than a rename of the first.
 */
const ME_BASE = {
  id: "user-1",
  email: "compliance@ibms.test",
  fullName: "Compliance Officer",
  languagePreference: "EN",
  mfaEnabled: true,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

const CUSTOMERS = [
  {
    id: "cus-1",
    legalName: "Ahmad Al-Test",
    status: "ACTIVE",
    registrationNumber: "REG-1",
    nationality: "JO",
    dateOfBirth: "1980-01-01",
  },
  {
    id: "cus-2",
    legalName: "شركة اليرموك",
    status: "ACTIVE",
    registrationNumber: "REG-2",
    nationality: null,
    dateOfBirth: null,
  },
];

const ACTORS = [
  { id: "user-2", fullName: "سلمى خالد المحاربة" },
  { id: "user-3", fullName: "Rania Hijazi" },
];

const AUDIT_ROWS = [
  {
    id: "audit-1",
    userId: "user-2",
    actorName: "سلمى خالد المحاربة",
    action: "TRANSITION",
    entityType: "Lead",
    entityId: "lead-1",
    beforeValue: null,
    afterValue: null,
    isSensitiveDataAccess: false,
    occurredAt: "2026-09-07T09:00:00.000Z",
  },
  {
    id: "audit-2",
    // The fallback case: a row whose actor could not be resolved must show the id, not a blank cell.
    userId: "user-9",
    actorName: null,
    action: "READ",
    entityType: "Customer",
    entityId: "cus-1",
    beforeValue: null,
    afterValue: null,
    isSensitiveDataAccess: true,
    occurredAt: "2026-09-07T10:00:00.000Z",
  },
];

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

/** Records every customer-search request so the test can assert what was actually asked. */
async function mockCustomers(
  page: Page,
  opts: { fail?: boolean; empty?: boolean } = {},
): Promise<{ searches: string[] }> {
  const searches: string[] = [];
  await page.route("http://localhost:4000/customers**", (route) => {
    const url = new URL(route.request().url());
    searches.push(url.searchParams.get("search") ?? "");
    if (opts.fail) return route.fulfill({ status: 500, json: { message: "boom" } });
    const items = opts.empty ? [] : CUSTOMERS;
    return route.fulfill({
      status: 200,
      json: { items, total: items.length, page: 0, pageSize: 50 },
    });
  });
  return { searches };
}

test("localises the disambiguation line in the READER's language, not the language at mount", async ({
  page,
}) => {
  // The bug this caught in the first draft: the source translated at FETCH time, the fetch runs once on
  // mount, and the language had not resolved from /auth/me yet — so an English reader saw
  // `Ahmad Al-Test — نشط · REG-1`, the status in Arabic. Found by printing the option text, not by
  // reading the code.
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await mockCustomers(page);
  await page.route("http://localhost:4000/dsr**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );

  await page.goto("/dsr");
  const option = page
    .locator('[data-entity-search-select="customer"]')
    .locator('option[value="cus-1"]');
  await expect(option).toBeAttached();
  await expect(option).toHaveText(/Active/);
  await expect(option).not.toHaveText(/نشط/);
});

test("Enter in the search box searches and does NOT submit the form", async ({ page }) => {
  // The one that matters across every screen: a stray Enter must not submit the record.
  //
  // THE FIRST VERSION OF THIS TEST COULD NOT FAIL. It ran on /dsr and asserted that no POST happened —
  // but that form has required fields, so the browser blocks submission whether or not the component
  // calls preventDefault. Planting the missing preventDefault left all seven tests green, which is how
  // it was found.
  //
  // The audit browse form is the honest host: no required fields, and its submit is an observable GET.
  // With preventDefault the browse count stays 0; without it, Enter browses.
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  const browses: string[] = [];
  const searches: string[] = [];
  await page.route("http://localhost:4000/audit-trail/actors**", (route) => {
    searches.push(new URL(route.request().url()).searchParams.get("search") ?? "");
    return route.fulfill({ status: 200, json: ACTORS });
  });
  await page.route("http://localhost:4000/audit-trail*", (route) => {
    browses.push(route.request().url());
    return route.fulfill({
      status: 200,
      json: { items: AUDIT_ROWS, total: AUDIT_ROWS.length, page: 0, pageSize: 50 },
    });
  });

  await page.goto("/audit-trail");
  const term = page.locator('[data-entity-search-term="auditActor"]');
  await expect(term).toBeVisible();
  // Nothing has been browsed yet: the screen browses only on submit.
  expect(browses).toEqual([]);

  await term.fill("Rania");
  await term.press("Enter");

  // It searched...
  await expect.poll(() => searches).toContain("Rania");
  // ...and did not submit the form it sits inside.
  expect(browses, "Enter in a search box must not submit the surrounding form").toEqual([]);

  // And the button still does submit, so the test above is about Enter and not about a dead form.
  await page.getByRole("button", { name: "Browse" }).click();
  await expect.poll(() => browses.length).toBe(1);
});

test("the choice lists names with a line that tells two of them apart", async ({ page }) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await mockCustomers(page);
  await page.route("http://localhost:4000/dsr**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );

  await page.goto("/dsr");
  const select = page.locator('[data-entity-search-select="customer"]');
  // A named option, not the select: the select renders immediately with just its placeholder, so
  // anchoring on it would read the list before the search resolved.
  await expect(select.locator('option[value="cus-1"]')).toBeAttached();
  const options = await anchoredTexts(select.locator("option"), select);
  // The name, then what disambiguates it. Two customers of the same legal name are otherwise
  // indistinguishable in a dropdown, which is how the wrong one gets picked.
  expect(options.some((o) => o.includes("Ahmad Al-Test") && o.includes("REG-1"))).toBe(true);
  // An entry with no nationality or date of birth still renders, with the bits it has.
  expect(options.some((o) => o.includes("شركة اليرموك") && o.includes("REG-2"))).toBe(true);
});

test("says nobody matches, rather than showing an empty dropdown", async ({ page }) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await mockCustomers(page, { empty: true });
  await page.route("http://localhost:4000/dsr**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );

  await page.goto("/dsr");
  // An empty select and a failed search look identical without this sentence.
  await expect(page.locator('[data-entity-search-empty="customer"]')).toBeVisible();
});

test("says the search failed, rather than reading as nobody matching", async ({ page }) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await mockCustomers(page, { fail: true });
  await page.route("http://localhost:4000/dsr**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );

  await page.goto("/dsr");
  await page.locator('[data-entity-search-go="customer"]').click();
  await expect(page.locator("main").getByRole("alert")).toContainText("could not run");
  // The two states are different claims and must not collapse into one another.
  await expectNone(
    page.locator('[data-entity-search-empty="customer"]'),
    page.locator("main").getByRole("alert"),
  );
});

test("the SAME control finds a person in the audit trail, and filters by them", async ({ page }) => {
  // The second kind. If this needed its own markup, its own Enter handling or its own states, the
  // abstraction would be a rename rather than one control.
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  const browses: string[] = [];
  await page.route("http://localhost:4000/audit-trail/actors**", (route) =>
    route.fulfill({ status: 200, json: ACTORS }),
  );
  await page.route("http://localhost:4000/audit-trail?**", (route) => {
    browses.push(route.request().url());
    return route.fulfill({
      status: 200,
      json: { items: AUDIT_ROWS, total: AUDIT_ROWS.length, page: 0, pageSize: 50 },
    });
  });
  await page.route("http://localhost:4000/audit-trail", (route) =>
    route.fulfill({
      status: 200,
      json: { items: AUDIT_ROWS, total: AUDIT_ROWS.length, page: 0, pageSize: 50 },
    }),
  );

  await page.goto("/audit-trail");
  const select = page.locator('[data-entity-search-select="auditActor"]');
  await expect(select).toBeVisible();
  await select.selectOption("user-2");
  await page.getByRole("button", { name: "Browse" }).click();

  // The filter the API always accepted and the screen could never reach.
  await expect.poll(() => browses.join(" ")).toContain("userId=user-2");
});

test("the audit rows show WHO, not a uuid — and the id when the name is missing", async ({ page }) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("http://localhost:4000/audit-trail/actors**", (route) =>
    route.fulfill({ status: 200, json: ACTORS }),
  );
  await page.route("http://localhost:4000/audit-trail**", (route) =>
    route.fulfill({
      status: 200,
      json: { items: AUDIT_ROWS, total: AUDIT_ROWS.length, page: 0, pageSize: 50 },
    }),
  );

  await page.goto("/audit-trail");
  await page.getByRole("button", { name: "Browse" }).click();

  // The name, in a column that used to render a uuid at the person being asked to review it.
  await expect(page.locator('[data-audit-actor="user-2"]')).toContainText("سلمى خالد المحاربة");
  // And the fallback: an unresolved actor shows its id, because a blank cell reads as "nobody".
  await expect(page.locator('[data-audit-actor="user-9"]')).toContainText("user-9");
});
