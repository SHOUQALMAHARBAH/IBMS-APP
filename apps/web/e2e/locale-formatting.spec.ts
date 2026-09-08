import { expect, test, type Page } from "@playwright/test";

// Part F — Bilingual UI (backlog Part 11), item #5 (sub-problem #1 of 3, by
// explicit user scoping decision): "locale-aware number/date formatting."
// Hijri calendar and multi-currency (reinsurance) support remain deferred,
// documented future work — not this item's scope.
//
// The whole point of this fix is a shared apps/web/lib/i18n/format.ts
// (formatMoney/formatDate/formatDateTime) replacing ~9 duplicated
// money()/fmtMoney() implementations, driven by the SAME live language
// switcher item #1 already ships in AppNav. A unit test already proves the
// pure functions are correct in isolation (format.test.ts) — this spec
// proves the mechanism is actually WIRED UP end to end in a real page: the
// rendered date genuinely changes when a user flips the switcher, and — the
// specific risk this item's locale-tag choice was designed to avoid — the
// rendered MONEY digits do NOT change, because bare 'ar' (not 'ar-JO') keeps
// Western Arabic numerals. Locale tags were empirically verified against
// Node's own ICU before being chosen, not assumed:
//   toLocaleDateString('en-GB') -> "07/09/2026" (DD/MM/YYYY, leading zeros)
//   toLocaleDateString('ar')    -> "7‏/9‏/2026"  (D/M/YYYY, no leading zeros,
//                                                 invisible RTL marks between
//                                                 components — stripped
//                                                 below before asserting the
//                                                 visible digits, the same
//                                                 stripDirectionMarks
//                                                 approach format.test.ts
//                                                 already uses)
//   toLocaleString('en-GB', {minimumFractionDigits:3,...}) -> "1,234.500"
//   toLocaleString('ar', {minimumFractionDigits:3,...})    -> "1,234.500"
//     (identical — proving the numeral system does NOT switch)

const ME_BASE = {
  id: "user-1",
  email: "officer@ibms.test",
  fullName: "Finance Officer",
  mfaEnabled: false,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

const stripDirectionMarks = (s: string) => s.replace(/[‎‏]/g, "");

async function mockAuth(page: Page) {
  let currentLanguage: "AR" | "EN" = "EN";
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fake-access-token" } }),
  );
  await page.route("**/auth/me", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({
      status: 200,
      json: {
        ...ME_BASE,
        roles: ["FINANCE_COLLECTIONS_OFFICER"],
        languagePreference: currentLanguage,
      },
    });
  });
  await page.route("**/auth/me/language", async (route) => {
    const body = route.request().postDataJSON() as {
      languagePreference: "AR" | "EN";
    };
    currentLanguage = body.languagePreference;
    return route.fulfill({
      status: 200,
      json: {
        ...ME_BASE,
        roles: ["FINANCE_COLLECTIONS_OFFICER"],
        languagePreference: currentLanguage,
      },
    });
  });
}

test("switching language re-renders a date in locale-aware format while money digits stay stable", async ({
  page,
}) => {
  await mockAuth(page);

  const row = {
    customerId: "cust-1",
    customerLegalName: "Al-Ittihad Trading Co.",
    currency: "JOD",
    current: "0.000",
    d1_30: "0.000",
    d31_60: "0.000",
    d61_90: "0.000",
    d90_plus: "1234.500",
    outstandingTotal: "1234.500",
    invoiceCount: 3,
    oldestDueDate: "2026-09-07T00:00:00.000Z",
    oldestDaysOverdue: 0,
  };
  const report = {
    asOf: "2026-09-07",
    currency: "JOD",
    rows: [row],
    totals: {
      current: "0.000",
      d1_30: "0.000",
      d31_60: "0.000",
      d61_90: "0.000",
      d90_plus: "1234.500",
      outstandingTotal: "1234.500",
      invoiceCount: 3,
      customerCount: 1,
    },
  };
  await page.route("http://localhost:4000/client-accounting/ageing**", (route) =>
    route.fulfill({ status: 200, json: report }),
  );

  await page.goto("/client-accounting");
  await expect(page.getByRole("heading", { name: "Client accounting" })).toBeVisible();

  const dataRow = page.locator("table tbody tr").first();
  const cells = dataRow.locator("td");
  // 0: client name, 1-5: ageing buckets, 6: outstanding total, 7: invoices, 8: oldest
  const outstandingCell = cells.nth(6);
  const oldestCell = cells.nth(8);

  await expect(outstandingCell).toHaveText("JOD 1,234.500");
  await expect(oldestCell).toHaveText("due 07/09/2026");

  await page.getByRole("button", { name: "العربية" }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe("ar");

  // Money is UNCHANGED — proving the deliberate 'ar' (not 'ar-JO') choice:
  // Western digits and the same grouping/decimal formatting either way.
  await expect(outstandingCell).toHaveText("JOD 1,234.500");

  // The date DID change — genuinely re-rendered through the Arabic locale
  // (D/M/YYYY, no leading zeros), not just re-using the English string.
  const oldestArText = await oldestCell.textContent();
  expect(oldestArText).not.toBe("due 07/09/2026");
  expect(stripDirectionMarks(oldestArText ?? "")).toBe("due 7/9/2026");
});
