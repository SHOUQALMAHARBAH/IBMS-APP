import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { permissionsForRoles } from "./fixtures/role-permissions";
import { anchoredTexts, expectNone } from "./support/anchored";

const ME_BASE = {
  id: "user-1",
  email: "auditor@ibms.test",
  fullName: "External Auditor",
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
    route.fulfill({ status: 200, json: { ...ME_BASE, roles, permissions: permissionsForRoles(roles) } }),
  );
}

const AUDIT_ROWS = [
  {
    id: "audit-1",
    userId: "user-2",
    action: "TRANSITION",
    entityType: "Lead",
    entityId: "lead-1",
    beforeValue: { status: "NEW" },
    afterValue: { status: "CONTACTED" },
    isSensitiveDataAccess: false,
    occurredAt: "2026-09-07T09:00:00.000Z",
  },
];

const DOCUMENT_HISTORY = {
  requestedDocumentId: "doc-1",
  versions: [
    {
      id: "doc-1",
      versionNumber: 1,
      fileName: "policy-schedule.pdf",
      category: "POLICY",
      classification: "CONFIDENTIAL",
      uploadedByUserId: "user-2",
      deletionLocked: true,
      deletionOverrideByUserId: null,
      createdAt: "2026-09-01T00:00:00.000Z",
      isRequestedVersion: true,
    },
  ],
  auditTrail: AUDIT_ROWS,
};

// The audit-log browse returns `{ items, total, page, pageSize }` — it is one
// of the five paged lists. Workflow/document history are NOT paged: they are
// bounded by the entity they belong to, and still return bare arrays.
function paged<T>(items: T[]) {
  return { items, total: items.length, page: 0, pageSize: 50 };
}

test("browses the audit log, looks up workflow history, and looks up document history", async ({
  page,
}) => {
  await mockAuth(page, ["EXTERNAL_AUDITOR"]);
  await page.route("http://localhost:4000/audit-trail?**", (route) =>
    route.fulfill({ status: 200, json: paged(AUDIT_ROWS) }),
  );
  await page.route("http://localhost:4000/audit-trail/workflow-history**", (route) =>
    route.fulfill({ status: 200, json: AUDIT_ROWS }),
  );
  await page.route("http://localhost:4000/audit-trail/documents/*/history", (route) =>
    route.fulfill({ status: 200, json: DOCUMENT_HISTORY }),
  );

  await page.goto("/audit-trail");
  await expect(page.getByRole("heading", { name: "Audit Trail" })).toBeVisible();

  await page.getByLabel("Entity type").first().fill("Lead");
  await page.getByRole("button", { name: "Browse" }).click();
  await expect(page.getByRole("cell", { name: "Status change" }).first()).toBeVisible();

  // `selectOption`, not `fill` — owner decision 41 made this a `<select>` over the eighteen entity
  // types the transition engine knows. It was a free-text box validated server-side against
  // `@Length(1, 100)` and against nothing else, so a person had to guess the exact string the writers
  // store and a wrong guess returned an empty history that reads as "nothing ever happened here".
  await page.getByLabel("Workflow entity type").selectOption("Lead");
  await page.getByLabel("Workflow entity id").fill("lead-1");
  await page.getByRole("button", { name: "Look up" }).first().click();
  await expect(page.getByText("lead-1").first()).toBeVisible();

  await page.getByLabel("Document id").fill("doc-1");
  await page.getByRole("button", { name: "Look up" }).nth(1).click();
  await expect(page.getByRole("cell", { name: "policy-schedule.pdf" })).toBeVisible();
  await expect(page.getByText("v1 (requested)")).toBeVisible();
});

test("an action-and-date browse sends all three filters, and `to` covers the WHOLE last day", async ({
  page,
}) => {
  // IMPROVEMENTS § 1.52 — "every DELETE last March" was unaskable from this screen while the API had
  // accepted `action`, `from` and `to` all along.
  await mockAuth(page, ["EXTERNAL_AUDITOR"]);
  const urls: string[] = [];
  await page.route("http://localhost:4000/audit-trail?**", (route) => {
    urls.push(route.request().url());
    return route.fulfill({ status: 200, json: paged(AUDIT_ROWS) });
  });

  await page.goto("/audit-trail");
  await expect(page.getByRole("heading", { name: "Audit Trail" })).toBeVisible();

  await page.getByLabel("Action").selectOption("DELETE");
  await page.getByLabel("From").fill("2026-03-01");
  await page.getByLabel("To").fill("2026-03-31");
  await page.getByRole("button", { name: "Browse" }).click();
  await expect(page.getByRole("cell", { name: "Status change" }).first()).toBeVisible();

  await expect.poll(() => urls.length, { message: "no browse request was sent" }).toBeGreaterThan(0);
  const sent = new URL(urls[urls.length - 1]!);
  expect(sent.searchParams.get("action")).toBe("DELETE");
  expect(sent.searchParams.get("from")).toBe("2026-03-01T00:00:00.000Z");
  // THE ASSERTION THAT MATTERS. `2026-03-31` as an instant is midnight at the START of the 31st, so a
  // naive conversion drops the last day of every range a person enters — a wrong answer that looks
  // complete. Asserting the date alone would pass against exactly that bug.
  expect(sent.searchParams.get("to")).toBe("2026-03-31T23:59:59.999Z");
});

test("the WITHDRAWN action is offered, which is the one the discard exists to make findable", async ({
  page,
}) => {
  // The web's `AuditAction` union was three values short — `DISCARD`, `SLA_ESCALATED` and
  // `ENCRYPTION_KEY_USED` — and this dropdown is built from it, so those three would have been the
  // actions nobody could filter for. `packages/db/prisma/audit-action-parity.spec.ts` guards the union
  // against the database enum; this asserts the SCREEN actually offers one of the recovered values.
  await mockAuth(page, ["EXTERNAL_AUDITOR"]);
  await page.route("http://localhost:4000/audit-trail?**", (route) =>
    route.fulfill({ status: 200, json: paged(AUDIT_ROWS) }),
  );

  await page.goto("/audit-trail");
  const action = page.getByLabel("Action");
  await expect(action).toBeVisible();
  await action.selectOption("DISCARD");
  await expect(action).toHaveValue("DISCARD");
  await action.selectOption("SLA_ESCALATED");
  await expect(action).toHaveValue("SLA_ESCALATED");
});

test("a user without any of the three permissions sees a friendly message per section", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await page.route("http://localhost:4000/audit-trail**", (route) => {
    if (route.request().url().includes("/audit-trail/")) return route.fallback();
    return route.fulfill({ status: 403, json: { message: "no" } });
  });

  await page.goto("/audit-trail");
  await page.getByLabel("Entity type").first().fill("Lead");
  await page.getByRole("button", { name: "Browse" }).click();
  await expect(
    page.getByText("(audit-log.read)", { exact: false }),
  ).toBeVisible();
});

test("the two fields a person could not fill arrive FILLED from the URL", async ({
  page,
}) => {
  /*
   * OWNER DECISION 41's WHOLE MECHANISM. Both fields were `required` and both took a uuid, so this
   * screen's workflow- and document-history sections could not be used at all by anybody who did not
   * already have the id. They are no longer required, and the normal way they get filled is NAVIGATION:
   * sixteen screens whose rows carry a workflow state link here with `?entityType=&entityId=`. The
   * `documentId` half is prefilled the same way and has NO inbound link yet — `Document` is not one of
   * the eighteen workflow types, so A3's link instruction did not cover it — which is why this test
   * supplies all three in one URL rather than clicking through.
   *
   * Asserting the VALUES rather than that a lookup succeeded: a test that only clicked Look up would
   * pass against a screen that ignored the URL and sent an empty id, because the mock answers anything.
   */
  await mockAuth(page, ["EXTERNAL_AUDITOR"]);
  await page.goto(
    "/audit-trail?entityType=DisposalBatch&entityId=batch-7&documentId=doc-9",
  );
  await expect(page.getByRole("heading", { name: "Audit Trail" })).toBeVisible();

  await expect(page.getByLabel("Workflow entity type")).toHaveValue(
    "DisposalBatch",
  );
  await expect(page.getByLabel("Workflow entity id")).toHaveValue("batch-7");
  await expect(page.getByLabel("Document id")).toHaveValue("doc-9");

  // And the button is reachable, which is the other half of dropping `required`: the server needs BOTH
  // halves, so the submit is gated on them rather than by HTML5 validation.
  await expect(
    page.getByRole("button", { name: "Look up" }).first(),
  ).toBeEnabled();
});

test("every entity the engine knows is offered, and the three with no word show their member name", async ({
  page,
}) => {
  // The select is built from a map that is total over the union, so this asserts the COUNT against the
  // eighteen the api declares (kept honest by `workflow-entity-type-parity.spec.ts`) plus the empty
  // option. Two of the options are checked by label for opposite reasons: `DisposalBatch` carries a
  // derived Arabic/English heading, and `Endorsement` carries NO word at all — there is no screen under
  // `app/(app)` to take one from — so it renders its member name rather than a guessed word. That
  // fallback being visible is deliberate: an unfinished label should look unfinished.
  await mockAuth(page, ["EXTERNAL_AUDITOR"]);
  await page.goto("/audit-trail");
  const select = page.getByLabel("Workflow entity type");
  await expect(select).toBeVisible();
  await expect(select.locator("option")).toHaveCount(19);

  // A DERIVED label, asserted by its words: `DisposalBatch` takes its screen's own heading.
  await expect(
    select.locator("option", { hasText: "Retention & Disposal" }),
  ).toHaveCount(1);

  /*
   * AND NO OPTION IS EVER BLANK except the deliberate empty one.
   *
   * This replaces an assertion on the literal text "Endorsement", which was the wrong shape: that
   * member has no Arabic word yet, so it renders its member name — and the day the owner writes the
   * word, that assertion would have gone RED. A gate failing because somebody did the work it exists
   * to support is a cost this repository has already paid once, in the permission-description harvest,
   * and `MAY_HAVE_NO_LABEL` in the parity spec is a subset check for exactly that reason.
   *
   * What this asserts instead is the real failure mode and survives either state: a label map that
   * stopped being total renders `t(undefined)`, which is NOTHING — an option a reader cannot read,
   * the notification-bell defect on a dropdown. Eighteen non-empty labels plus one empty placeholder.
   */
  // `anchoredTexts`, not a raw read — `npm run lint` refuses the raw one by name, because it does not
  // auto-wait and returns `[]` before render, which would make the emptiness assertion below pass
  // against an unrendered page. The anchor is the select itself, asserted visible first.
  const texts = await anchoredTexts(select.locator("option"), select);
  expect(texts[0]).toBe("Choose a type…");
  expect(texts.slice(1).filter((t) => t.trim() === "")).toEqual([]);
  expect(texts.slice(1)).toHaveLength(18);

  // Selecting by VALUE works for every member, which is what the links send.
  await select.selectOption("CrossSellOpportunity");
  await expect(select).toHaveValue("CrossSellOpportunity");
});

test("the document chooser is ABSENT for the external auditor and PRESENT for compliance", async ({
  page,
}) => {
  /*
   * THE ABSENCE IS THE DECISION, NOT A GAP — owner decision 41.
   *
   * `GET /documents/search` is gated on `document.read` ALONE, a deliberate departure from the picker
   * rule argued in the api's `common/picker-search.config.ts`. Measured on the seeded grid, that code
   * reaches COMPLIANCE_OFFICER and NOT the EXTERNAL_AUDITOR — so the auditor keeps the TYPED FIELD and
   * is shown no chooser. NOT an inbound link, which is a correction: `/documents` is gated on
   * `document.read` too, so that role cannot open the register a link would come from. What reaches it
   * is the audit-log table on this same screen, whose Entity column renders `Document <id>` rows.
   * Widening the route would hand a read-only auditor a name search over every document in the office.
   *
   * BOTH halves in one test, because either alone is weak: the absence alone would pass against a
   * chooser nobody ever gets, and the presence alone would pass against one everybody gets.
   */
  await mockAuth(page, ["EXTERNAL_AUDITOR"]);
  await page.goto("/audit-trail");
  // The anchor is the field the auditor DOES keep, from the same render — without it the absence below
  // is satisfied by a page that has not hydrated.
  await expectNone(
    page.getByLabel("Find a document"),
    page.getByLabel("Document id"),
  );

  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.goto("/audit-trail");
  await expect(page.getByLabel("Find a document")).toBeVisible();
});

test("audit trail screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["EXTERNAL_AUDITOR"]);
  await page.goto("/audit-trail");
  await expect(page.getByRole("heading", { name: "Audit Trail" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
