import { expect, test, type Page } from "@playwright/test";

// Process 49 — the sanctions match review queue.
//
// This screen is the ENTIRE justification for fuzzy matching. Containment
// matching over-fires by construction, which is only a defensible trade if a
// person actually adjudicates the output; that person works here. So the
// behaviour worth pinning is not the table markup, it is:
//
//   * an EMPTY queue is ambiguous, and the screen must say which kind of empty
//     it is — "nothing matched" or "nothing was ever checked". Every
//     deployment of this system is currently the second kind, because the
//     watchlist sync has never been run.
//   * a decision cannot be recorded without a written reason.
//   * a non-reviewer can read the queue but not adjudicate it.
//
// Follows the four-state screenshot convention established by
// four-state-screenshots.spec.ts (plain `page.screenshot()` evidence, no
// pixel-diff baseline — the same reasoning about a bilingual RTL/LTR app).

const ME_BASE = {
  id: "user-1",
  email: "officer@ibms.test",
  fullName: "Verification Officer",
  languagePreference: "EN",
  mfaEnabled: false,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

async function mockAuth(
  page: Page,
  roles: string[],
  languagePreference: "AR" | "EN" = "EN",
) {
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fake-access-token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      status: 200,
      json: { ...ME_BASE, roles, languagePreference },
    }),
  );
}

async function capture(page: Page, state: string) {
  await page.screenshot({
    path: `test-results/four-state-screenshots/screening-matches/${state}.png`,
    fullPage: true,
  });
}

function matchRow(over: Record<string, unknown> = {}) {
  return {
    id: "sm-1",
    kycRecordId: "kyc-1",
    customerId: "cust-1",
    customerLegalName: "Acme Trading Co.",
    customerStatus: "ACTIVE",
    kycStatus: "APPROVED",
    isEdd: true,
    subjectName: "Ahmad Khalid Yousef Al Hashimi",
    matchType: "fuzzy",
    status: "pending",
    detectedAt: "2026-09-10T00:00:00.000Z",
    reviewedByUserId: null,
    reviewedAt: null,
    reviewReason: null,
    listSource: "OFAC_SDN (SDGT)",
    listEntryName: "AHMAD AL HASHIMI",
    listEntryRemarks: null,
    listEntryDelisted: false,
    ...over,
  };
}

async function mockQueue(
  page: Page,
  rows: Record<string, unknown>[],
  watchlistReady = true,
) {
  await page.route("**/screening/matches/pending-count", (route) =>
    route.fulfill({
      status: 200,
      json: { pending: rows.length, watchlistReady },
    }),
  );
  await page.route("**/screening/matches?*", (route) =>
    route.fulfill({ status: 200, json: rows }),
  );
}

test("warns that an empty queue means nothing was CHECKED, not nothing matched", async ({
  page,
}) => {
  // The state every deployment of this system is actually in today. Without
  // this banner a Compliance Officer reads a clean screen as reassurance.
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockQueue(page, [], false);

  await page.goto("/screening-matches");

  await expect(page.getByText("Nothing awaiting review.")).toBeVisible();
  const warning = page.getByRole("alert").filter({ hasText: "EMPTY" });
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("has never run");
  await expect(warning).toContainText("does NOT mean there are no matches");
  await capture(page, "empty-watchlist-never-synced");
});

test("does NOT warn when the watchlist is populated and the queue is genuinely clear", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockQueue(page, [], true);

  await page.goto("/screening-matches");

  await expect(page.getByText("Nothing awaiting review.")).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "EMPTY" }),
  ).toHaveCount(0);
  await capture(page, "empty");
});

test("shows a pending fuzzy match and refuses a decision without a written reason", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockQueue(page, [matchRow()]);

  await page.goto("/screening-matches");

  await expect(page.getByText("Acme Trading Co.")).toBeVisible();
  await expect(page.getByText("Ahmad Khalid Yousef Al Hashimi")).toBeVisible();
  await expect(page.getByText("AHMAD AL HASHIMI")).toBeVisible();
  await expect(page.getByText("OFAC_SDN (SDGT)")).toBeVisible();
  // "EDD" also appears inside "Enhanced due diligence"-adjacent copy, so scope
  // the assertion to the customer cell rather than the whole page.
  await expect(
    page.getByRole("cell", { name: "Acme Trading Co." }).getByText("EDD"),
  ).toBeVisible();

  // The reason IS the control — it is the record a regulator asks for when
  // questioning why a name that matched a sanctions list was let through. Both
  // buttons stay disabled until one is written.
  const clear = page.getByRole("button", { name: "Clear (false positive)" });
  const confirm = page.getByRole("button", { name: "Confirm match" });
  await expect(clear).toBeDisabled();
  await expect(confirm).toBeDisabled();

  const reason = page.getByLabel(
    "Review reason for Ahmad Khalid Yousef Al Hashimi",
  );
  await reason.fill("too short");
  await expect(clear).toBeDisabled();

  await reason.fill(
    "Different date of birth and nationality; not the listed individual.",
  );
  await expect(clear).toBeEnabled();
  await expect(confirm).toBeEnabled();
  await capture(page, "populated");
});

test("records a decision and sends the written reason to the API", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockQueue(page, [matchRow()]);

  let posted: Record<string, unknown> | null = null;
  await page.route("**/screening/matches/sm-1/review", async (route) => {
    posted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      json: matchRow({ status: "cleared", reviewReason: posted.reviewReason }),
    });
  });

  await page.goto("/screening-matches");
  await page
    .getByLabel("Review reason for Ahmad Khalid Yousef Al Hashimi")
    .fill(
      "Different date of birth and nationality; not the listed individual.",
    );
  await page.getByRole("button", { name: "Clear (false positive)" }).click();

  await expect.poll(() => posted).not.toBeNull();
  expect(posted!.decision).toBe("cleared");
  expect(String(posted!.reviewReason)).toContain("Different date of birth");
});

test("a non-reviewer can read the queue but cannot adjudicate it", async ({
  page,
}) => {
  await mockAuth(page, ["EXTERNAL_AUDITOR"]);
  await mockQueue(page, [matchRow()]);

  await page.goto("/screening-matches");

  await expect(page.getByText("Acme Trading Co.")).toBeVisible();
  await expect(page.getByText("Compliance Officer only")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Clear (false positive)" }),
  ).toHaveCount(0);
});

test("surfaces a permission failure rather than an empty queue", async ({
  page,
}) => {
  // A 403 rendered as "nothing to review" would be the same class of lie the
  // empty-watchlist banner exists to prevent.
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("**/screening/matches/pending-count", (route) =>
    route.fulfill({ status: 200, json: { pending: 0, watchlistReady: true } }),
  );
  await page.route("**/screening/matches?*", (route) =>
    route.fulfill({ status: 403, json: { message: "Forbidden" } }),
  );

  await page.goto("/screening-matches");

  await expect(
    page.getByRole("alert").filter({ hasText: "sanctions-pep.screen" }),
  ).toBeVisible();
  await expect(page.getByText("Nothing awaiting review.")).toHaveCount(0);
  await capture(page, "error");
});

test("renders the queue in Arabic with RTL direction", async ({ page }) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"], "AR");
  await mockQueue(page, [matchRow()]);

  await page.goto("/screening-matches");

  await expect(
    page.getByRole("heading", { name: "مطابقات العقوبات للمراجعة" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await capture(page, "populated-ar");
});
