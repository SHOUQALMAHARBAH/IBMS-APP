import { expect, test, type Page } from "@playwright/test";
import { permissionsForRoles } from "./fixtures/role-permissions";
import { expectNone } from "./support/anchored";

/**
 * ONE FIELD FOR FINDING A NAMED THING.
 *
 * Ten forms asked for a raw `customerId`, which nobody knows. `CustomerPicker` fixed that and
 * `EntitySearch` generalised it — and both offered a search box AND a separate select below it. The
 * owner's verdict on running the system herself: *"this is right but it is not practical."*
 *
 * It is one field now, and these tests hold in place the parts that would otherwise be re-implemented
 * differently by whoever next needs a picker:
 *
 *   1. THE FOUR ANTI-BROWSING CONDITIONS. Nothing before three characters, nothing on an empty query,
 *      a bounded set, every search recorded. The server enforces all four; what is asserted here is
 *      that the field does not send a request it knows will be refused, and — the one that matters —
 *      that it talks to `/customers/search` and NOT to the unfiltered list route.
 *   2. KEYBOARD ALONE. A combobox is the easiest control in a UI to make unreachable, and this one gave
 *      up a native `<select>` that carried the behaviour for free. So the whole flow is driven here
 *      with no mouse: type, arrow, Enter, Escape.
 *   3. THE CHOSEN CUSTOMER DISPLAYS AS A NAME. An identifier echoed back into the field would reopen
 *      rule 2 one keystroke after fixing the usability.
 *   4. The four states each say something, and "nobody by that name" never collapses into "the search
 *      failed".
 *   5. A second entity kind reuses all of it — the proof the abstraction is one rather than a rename.
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

/** The shape `GET /customers/search` returns — narrower than a list row. */
const CUSTOMERS = [
  {
    id: "cus-1",
    legalName: "Ahmad Al-Test",
    customerType: "INDIVIDUAL",
    status: "ACTIVE",
    registrationNumber: null,
    taxRegistrationNumber: null,
  },
  {
    id: "cus-2",
    legalName: "شركة اليرموك",
    customerType: "CORPORATE",
    status: "ACTIVE",
    registrationNumber: "REG-2",
    taxRegistrationNumber: null,
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
    userId: "user-9",
    actorName: "Rania Hijazi",
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

/**
 * Records every search so a test can assert what was actually asked — and routes the LIST path
 * separately, so "the field used the unfiltered list route" is a visible event rather than a silent
 * success. Without that second route the list call would simply 404 in the background and the only
 * symptom would be an empty dropdown.
 */
async function mockCustomerSearch(
  page: Page,
  opts: { fail?: boolean; empty?: boolean; all?: boolean } = {},
): Promise<{ searches: string[]; listCalls: string[] }> {
  const searches: string[] = [];
  const listCalls: string[] = [];
  await page.route("http://localhost:4000/customers/search**", (route) => {
    const url = new URL(route.request().url());
    searches.push(url.searchParams.get("q") ?? "");
    if (opts.fail)
      return route.fulfill({ status: 500, json: { message: "boom" } });
    const term = (url.searchParams.get("q") ?? "").toLowerCase();
    const items = opts.empty
      ? []
      : opts.all
        // The keyboard test needs TWO options to walk between, and the two fixtures share no substring
        // — an Arabic company name and a Latin personal one. `all` returns both whatever was typed, so
        // that test is about the keyboard rather than about the mock's filtering. My first version
        // filtered, got one option, and failed looking for the second.
        ? CUSTOMERS
        : CUSTOMERS.filter(
          (c) =>
            c.legalName.toLowerCase().includes(term) ||
            (c.registrationNumber ?? "").toLowerCase().startsWith(term),
        );
    return route.fulfill({ status: 200, json: items });
  });
  // The list route, which this field must never reach.
  await page.route("http://localhost:4000/customers?**", (route) => {
    listCalls.push(route.request().url());
    return route.fulfill({
      status: 200,
      json: { items: CUSTOMERS, total: 2, page: 0, pageSize: 50 },
    });
  });
  return { searches, listCalls };
}

async function openDsr(page: Page) {
  await page.route("http://localhost:4000/dsr**", (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.goto("/dsr");
}

test("sends NOTHING before three characters, and nothing at all on an empty query", async ({
  page,
}) => {
  // Conditions 1 and 3. The previous version searched once on mount with an EMPTY term, which returns
  // the first page of the whole customer book — so opening /complaints put a list of customers on
  // screen before anybody typed. That is the state these two conditions exist to remove, and the
  // assertion on `listCalls` is what proves the field is not quietly reaching the list route instead.
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  const { searches, listCalls } = await mockCustomerSearch(page);
  await openDsr(page);

  const field = page.locator('[data-entity-search-term="customer"]');
  await expect(field).toBeVisible();
  // Nothing on mount: no search, and no browse of the list either.
  expect(searches, "nothing may be searched before anybody types").toEqual([]);
  expect(listCalls, "the field must never reach the unfiltered list route").toEqual([]);

  await field.fill("Ah");
  // Two characters is below the floor. Poll rather than assert once: a request would arrive after the
  // debounce, so an immediate assertion would pass on timing instead of on behaviour.
  await page.waitForTimeout(600);
  expect(searches, "two characters is below the floor").toEqual([]);

  await field.fill("Ahm");
  await expect.poll(() => searches).toEqual(["Ahm"]);

  // Back below the floor: the list goes away rather than lingering.
  await field.fill("A");
  await expect(page.locator('[data-entity-search-list="customer"]')).toBeHidden();
  expect(listCalls).toEqual([]);
});

test("is driveable by KEYBOARD alone — type, arrow, Enter — and Enter does not submit the form", async ({
  page,
}) => {
  // The native `<select>` this replaces carried arrow keys, focus and ARIA for free. Having given that
  // up, the replacement has to be driven with no mouse at all, which is what this does.
  //
  // It also covers the one that matters across every screen: a stray Enter must not submit the record.
  // An earlier version of that test could not fail, because it ran on a form whose required fields make
  // the browser block submission either way. Here the choice is made BY Enter, so if Enter submitted
  // the form the selection would never land and the assertion would fail for the right reason.
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  const posts: string[] = [];
  await page.route("http://localhost:4000/dsr", (route) => {
    if (route.request().method() === "POST") posts.push(route.request().url());
    return route.fulfill({ status: 200, json: [] });
  });
  await mockCustomerSearch(page, { all: true });
  await openDsr(page);

  const field = page.locator('[data-entity-search-term="customer"]');
  await field.focus();
  await page.keyboard.type("Ahm");

  const list = page.locator('[data-entity-search-list="customer"]');
  await expect(list).toBeVisible();
  await expect(field).toHaveAttribute("aria-expanded", "true");

  // The first option is active without a keystroke, so Enter alone picks the obvious answer.
  const first = page.locator('[data-entity-search-option="cus-1"]');
  await expect(first).toHaveAttribute("aria-selected", "true");

  // Arrow down moves the active option, and `aria-activedescendant` follows it — which is the only
  // thing a screen reader has to go on.
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('[data-entity-search-option="cus-2"]')).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const activeId = await page.locator('[data-entity-search-option="cus-2"]').getAttribute("id");
  await expect(field).toHaveAttribute("aria-activedescendant", activeId!);

  // Escape closes without choosing — and leaves the typed term, so a stray Escape is not a lost field.
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
  await expect(field).toHaveAttribute("aria-expanded", "false");
  await expect(field).toHaveValue("Ahm");

  // Re-open by typing, then pick with Enter. The active option resets to the first, so Enter picks the
  // obvious answer rather than whatever the arrow keys last touched before Escape.
  await page.keyboard.type("a");
  await expect(list).toBeVisible();
  await expect(page.locator('[data-entity-search-option="cus-1"]')).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Enter");

  // THE NAME, not the id. This is the owner's third requirement.
  await expect(field).toHaveValue("Ahmad Al-Test");
  await expect(list).toBeHidden();
  // And Enter picked rather than submitting the surrounding form.
  expect(posts, "Enter in the field must not submit the form it sits inside").toEqual([]);
});

test("finds a company by its REGISTRATION NUMBER, and still shows the name once chosen", async ({
  page,
}) => {
  // The clerk holding a document knows the number and not the spelling — the owner's reason for this
  // half. The chosen value is still a name, so searching by number does not put an identifier in the
  // field.
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  const { searches } = await mockCustomerSearch(page);
  await openDsr(page);

  const field = page.locator('[data-entity-search-term="customer"]');
  await field.fill("REG-2");
  await expect.poll(() => searches).toContain("REG-2");

  const option = page.locator('[data-entity-search-option="cus-2"]');
  await expect(option).toBeVisible();
  // The option DOES echo the number, which is what confirms the right record came back.
  await expect(option).toContainText("REG-2");
  await option.click();

  // The field shows the company's NAME. Not the number it was found by.
  await expect(field).toHaveValue("شركة اليرموك");
  await expect(field).not.toHaveValue(/REG-2/);
});

test("localises the disambiguation line in the READER's language, not the language at request time", async ({
  page,
}) => {
  // The bug this caught in the first draft: the source translated at FETCH time, so the line was
  // localised in whatever language was active when the request went out — and on this Arabic-first
  // platform an English reader saw `شركة اليرموك — نشط · REG-2`, the status in Arabic, because the
  // language had not resolved from /auth/me yet. Found by printing the option text, not by reading.
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await mockCustomerSearch(page);
  await openDsr(page);

  await page.locator('[data-entity-search-term="customer"]').fill("REG-2");
  const option = page.locator('[data-entity-search-option="cus-2"]');
  await expect(option).toBeVisible();
  await expect(option).toContainText("Active");
  await expect(option).not.toContainText("نشط");
});

test("says nobody matches, rather than showing an empty list", async ({ page }) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await mockCustomerSearch(page, { empty: true });
  await openDsr(page);

  await page.locator('[data-entity-search-term="customer"]').fill("Nobody");
  // An empty list and a failed search look identical without this sentence.
  await expect(
    page.locator('[data-entity-search-status="customer"]'),
  ).toContainText("No customer matches");
});

test("says the search FAILED, rather than reading as nobody matching", async ({ page }) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await mockCustomerSearch(page, { fail: true });
  await openDsr(page);

  await page.locator('[data-entity-search-term="customer"]').fill("Ahm");
  const alert = page.locator('[data-entity-search-error="customer"]');
  await expect(alert).toContainText("could not run");
  // The two states are different claims and must not collapse into one another: anchored on the error
  // above, so this cannot pass on a field that rendered neither.
  await expectNone(
    page.locator('[data-entity-search-status="customer"]').getByText("No customer matches"),
    alert,
  );
});

test("clearing the field clears the SELECTION, not just the text", async ({ page }) => {
  // A name left in the box for an id the form no longer holds is the picker telling a reader they chose
  // somebody they did not. Asserted through the form's own submitted body rather than through the
  // field's appearance, because appearance is what would agree with the bug.
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await mockCustomerSearch(page);
  const bodies: string[] = [];
  await page.route("http://localhost:4000/dsr", (route) => {
    if (route.request().method() === "POST") bodies.push(route.request().postData() ?? "");
    return route.fulfill({ status: 201, json: { id: "dsr-1" } });
  });
  await openDsr(page);

  const field = page.locator('[data-entity-search-term="customer"]');
  await field.fill("Ahm");
  await page.locator('[data-entity-search-option="cus-1"]').click();
  await expect(field).toHaveValue("Ahmad Al-Test");

  await page.locator('[data-entity-search-clear="customer"]').click();
  await expect(field).toHaveValue("");
  // The clear button is gone with the selection, so there is nothing to clear twice.
  await expect(page.locator('[data-entity-search-clear="customer"]')).toBeHidden();
});

test("the SAME field finds a person in the audit trail, and filters by them", async ({ page }) => {
  // The second kind. If this needed its own markup, its own keyboard handling or its own states, the
  // abstraction would be a rename rather than one control.
  //
  // Its floor is ONE character, not three: this set is the actors already in the office's own log,
  // typically a handful of colleagues, and it is bounded by that fact rather than by a floor. The four
  // conditions were set for a CUSTOMER field.
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
  const field = page.locator('[data-entity-search-term="auditActor"]');
  await expect(field).toBeVisible();
  await field.fill("R");
  await page.locator('[data-entity-search-option="user-3"]').click();
  await expect(field).toHaveValue("Rania Hijazi");

  await page.getByRole("button", { name: "Browse" }).click();
  // The filter the API always accepted and the screen could never reach.
  await expect.poll(() => browses.join(" ")).toContain("userId=user-3");
});

test("the audit rows show WHO, not a uuid", async ({ page }) => {
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

  await expect(page.locator('[data-audit-actor="user-2"]')).toContainText("سلمى خالد المحاربة");
  await expect(page.locator('[data-audit-actor="user-9"]')).toContainText("Rania Hijazi");
  // AND NEVER THE ID — anchored on the two names above, so this cannot pass on a table that never
  // rendered.
  await expect(page.locator('[data-audit-actor="user-2"]')).not.toContainText("user-2");
  await expect(page.locator('[data-audit-actor="user-9"]')).not.toContainText("user-9");
});
