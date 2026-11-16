import { expect, test, type Page } from "@playwright/test";
import { permissionsForRoles } from "./fixtures/role-permissions";
import { pickEntity } from "./support/pick-entity";

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * 🔴 OWNER DECISION 148 §٦ CRITERION 2 — NO BLANK CATEGORY CELL ON ANY SCREEN THAT SHOWS A
 * DOCUMENT.
 *
 * ## WHY THIS FILE EXISTS, AND IT IS A DEFECT RATHER THAN A NEW FEATURE
 *
 * Measured 2026-11-16: `ENUM_LABEL.DocumentCategory` carried 13 keys for 16 schema members, and
 * `translate()` returns `undefined` for a missing key — so React rendered NOTHING. On dev that
 * was **7 of 15 `Document` rows** showing an empty category cell. Nothing failed, because
 * nothing was checking: `satisfies Labels<string>` enforces no coverage at all.
 *
 * `document-category.strings.test.ts` proves the three words are HERS and that the map reaches
 * them. It cannot prove what a SCREEN renders, and a screen is where the defect was visible.
 *
 * ## FOUR SCREENS, ONE ASSERTION EACH, EACH ON A PREVIOUSLY-BLANK CATEGORY
 *
 * Every fixture below deliberately carries one of the THREE members that used to render blank.
 * A fixture using `POLICY` would pass against the defect, which is how this went unnoticed for
 * as long as it did — every existing spec happens to use a labelled category.
 *
 * Rendered in ARABIC: the word is the whole of what she ratified, and an English render would
 * prove a cell is non-empty while proving nothing about the word in it.
 * ───────────────────────────────────────────────────────────────────────────────────────────── */

const ME_BASE = {
  id: "user-1",
  email: "officer@ibms.test",
  fullName: "Officer",
  languagePreference: "AR",
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
      json: {
        ...ME_BASE,
        roles,
        permissions: permissionsForRoles(roles),
      },
    }),
  );
}

/** Her ratified words, decision 148 §٣. Asserted on a real render rather than compared to a
 *  dictionary — that comparison is `document-category.strings.test.ts`'s job. */
const BROKER_LICENCE = "شهادة ترخيص الوسيط";
const INSURER_LICENCE = "شهادة ترخيص شركة التأمين";
const CBJ_DECISION = "قرار من البنك المركزي";

const DOC_BASE = {
  id: "doc-1",
  policyId: "policy-1",
  customerId: null,
  classification: "CONFIDENTIAL",
  fileName: "licence.pdf",
  storageRef: "s3://ibms/licence.pdf",
  versionNumber: 1,
  previousVersionId: null,
  uploadedByUserId: "user-1",
  deletionLocked: true,
  deletionOverrideByUserId: null as string | null,
  createdAt: "2026-09-20T09:00:00.000Z",
};

const POLICY_SEARCH = "http://localhost:4000/policies/search**";
const POLICY_OPTION = {
  id: "policy-1",
  policyNumber: "POL-1",
  customerLegalName: "Acme Trading",
  insuranceLine: "MOTOR",
  status: "ACTIVE",
};

test("SCREEN 1 of 4 — /documents shows the category of a broker licence certificate", async ({
  page,
}) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await page.route(
    "http://localhost:4000/documents?policyId=policy-1",
    (route) =>
      route.fulfill({
        status: 200,
        json: [{ ...DOC_BASE, category: "BROKER_LICENSE_CERTIFICATE" }],
      }),
  );

  await page.goto("/documents");
  await pickEntity(page, "policy", POLICY_OPTION, {
    route: POLICY_SEARCH,
    nth: 0,
  });
  await page.getByRole("button", { name: "استعراض المستندات" }).click();

  // The ROW first, so the category assertion below is about a cell that is really on screen —
  // a locator that matched nothing would otherwise read as "the word is absent", which is the
  // same result a blank cell gives and the opposite diagnosis.
  await expect(page.getByRole("cell", { name: "licence.pdf" })).toBeVisible();
  await expect(
    page.getByRole("cell", { name: BROKER_LICENCE, exact: true }),
  ).toBeVisible();
});

test("SCREEN 2 of 4 — /audit-trail's document history shows a Central Bank decision's category", async ({
  page,
}) => {
  await mockAuth(page, ["EXTERNAL_AUDITOR"]);
  await page.route(
    "http://localhost:4000/audit-trail/documents/*/history",
    (route) =>
      route.fulfill({
        status: 200,
        json: {
          // The field names are the DTO's own (`DocumentHistory` in `audit-trail-api.ts`):
          // `requestedDocumentId`, `uploadedByName`, and an `auditTrail` beside the versions.
          // A fixture whose shape does not match renders an empty table, which looks exactly
          // like a screen that failed rather than like a wrong mock.
          requestedDocumentId: "doc-1",
          versions: [
            {
              id: "doc-1",
              versionNumber: 1,
              isRequestedVersion: true,
              fileName: "cbj-letter.pdf",
              category: "REGULATORY_DECISION",
              classification: "CONFIDENTIAL",
              uploadedByUserId: "user-1",
              uploadedByName: "سامر عبدالله الحوراني",
              deletionLocked: true,
              deletionOverrideByUserId: null,
              createdAt: "2026-09-20T09:00:00.000Z",
            },
          ],
          auditTrail: [],
        },
      }),
  );

  await page.goto("/audit-trail");
  await page.getByLabel("معرّف المستند").fill("doc-1");
  await page
    .getByRole("button", { name: "بحث" })
    .nth(1)
    .click();

  await expect(
    page.getByRole("cell", { name: "cbj-letter.pdf" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: CBJ_DECISION, exact: true }),
  ).toBeVisible();
});

test("SCREEN 3 of 4 — the policy's electronic file shows an insurer licence certificate's category", async ({
  page,
}) => {
  /*
   * The `Opportunity` and `Policy` fixtures are COPIED FROM `commission-override-duty.spec.ts`
   * rather than written fresh, and the first attempt here is why: an invented opportunity shape
   * (missing `status`, `context`, `targetPremiumThreshold`) rendered «This page couldn't load»,
   * which looks exactly like a broken SCREEN and is in fact a broken MOCK. Only `documents`
   * differs from that spec's copy, which is the whole subject of this test.
   */
  await mockAuth(page, ["BRANCH_DEPARTMENT_MANAGER"]);
  await page.route("http://localhost:4000/opportunities/opp-1", (route) =>
    route.fulfill({
      status: 200,
      json: {
        id: "opp-1",
        customerId: "cust-1",
        insuranceProgramId: "prog-1",
        isRenewal: false,
        status: "PLACEMENT",
        targetPremiumThreshold: null,
        createdByUserId: "user-1",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-08T00:00:00.000Z",
        context: { insuranceProgramId: "prog-1", customerId: "cust-1" },
      },
    }),
  );
  for (const url of [
    "http://localhost:4000/rfqs?opportunityId=opp-1",
    "http://localhost:4000/client-decisions?opportunityId=opp-1",
    "http://localhost:4000/recommendations?opportunityId=opp-1",
    "http://localhost:4000/commission/agreements**",
    "http://localhost:4000/commission/entries**",
    "http://localhost:4000/consent-records**",
    "http://localhost:4000/invoices**",
  ]) {
    await page.route(url, (route) => route.fulfill({ status: 200, json: [] }));
  }
  await page.route("http://localhost:4000/privacy-notices/current**", (route) =>
    route.fulfill({ status: 200, json: { notice: null } }),
  );
  await page.route(
    "http://localhost:4000/policies?opportunityId=opp-1",
    (route) =>
      route.fulfill({
        status: 200,
        json: {
          items: [
            {
              id: "pol-1",
              discard: null,
              opportunityId: "opp-1",
              customerId: "cust-1",
              insurerId: "ins-1",
              insurer: {
                id: "ins-1",
                name: "Union Insurance",
                nameAr: "الاتحاد للتأمين",
              },
              policyNumber: "POL-2026-0451",
              insuranceLine: "Property All Risks",
              status: "ACTIVE",
              inceptionDate: "2026-10-01",
              expiryDate: "2027-10-01",
              requestedPremium: "120000.000",
              issuedPremium: "118500.000",
              premiumVariance: "-1500.000",
              currency: "JOD",
              placedByUserId: "user-1",
              issuedByUserId: "user-1",
              customer: { id: "cust-1", legalName: "شركة الأفق للتأمين" },
              schedules: [],
              // THE SUBJECT: a category that rendered BLANK until OWNER DECISION 148.
              documents: [
                {
                  ...DOC_BASE,
                  id: "doc-9",
                  policyId: "pol-1",
                  category: "INSURER_LICENSE_CERTIFICATE",
                  fileName: "insurer-licence.pdf",
                },
              ],
              checking: null,
              delivery: null,
              issuanceComplete: true,
              checkingComplete: false,
              deliveryComplete: false,
              createdAt: "2026-09-07T00:00:00.000Z",
              updatedAt: "2026-09-08T00:00:00.000Z",
            },
          ],
          total: 1,
          page: 0,
          pageSize: 50,
        },
      }),
  );

  await page.goto("/opportunities/opp-1");
  // The FILE first: it anchors the assertion to a line that is really on screen, so a blank
  // category fails as a missing word rather than as a missing section.
  const file = page.getByText("insurer-licence.pdf");
  await expect(file).toBeVisible();
  await expect(file).toContainText(INSURER_LICENCE);
});

test("SCREEN 4 of 4 — the document PICKER shows a category on its option line", async ({
  page,
}) => {
  /*
   * The picker is the one of the four that is not a table, and its detail line is where a blank
   * category is hardest to notice: the option still shows a file name, so it reads as a working
   * picker with a stray separator.
   *
   * ⚠️ COMPLIANCE_OFFICER, **not** EXTERNAL_AUDITOR. The chooser is gated on `document.read`,
   * which the external auditor deliberately does NOT hold — `/audit-trail`'s own comment records
   * why: it would hand a read-only auditor a name search over every document in the office. So
   * the auditor keeps the typed field and has no picker to assert on at all.
   */
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("http://localhost:4000/documents/search**", (route) =>
    route.fulfill({
      status: 200,
      json: [
        {
          id: "doc-1",
          fileName: "broker-licence.pdf",
          category: "BROKER_LICENSE_CERTIFICATE",
          versionNumber: 1,
        },
      ],
    }),
  );

  await page.goto("/audit-trail");
  /*
   * Driven by hand rather than through `pickEntity`, because the assertion is about the OPTION
   * LINE and the helper selects the option and moves on. The category lives in that line's
   * detail; once the option is chosen it is gone from the screen, so there is no later moment
   * at which this could be asserted.
   */
  await page
    .locator('[data-entity-search-term="document"]')
    .first()
    .fill("broker");
  const option = page.locator('[data-entity-search-option="doc-1"]');
  await expect(option).toBeVisible();
  await expect(option).toContainText("broker-licence.pdf");
  await expect(
    option,
    "the document picker's option line shows no category — OWNER DECISION 148",
  ).toContainText(BROKER_LICENCE);
});
