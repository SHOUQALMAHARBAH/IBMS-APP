import { expect, test, type Page } from "@playwright/test";

// Part F — Bilingual UI (backlog Part 11), item #2: "full RTL layout for
// Arabic ... navigation, forms, tables ... genuinely mirrored, not just
// mirrored text." Verifies REAL layout positions (bounding boxes), not
// computed style keywords — `getComputedStyle().textAlign` for a logical
// value like `start` reports the specified keyword back unchanged in both
// directions, so it proves nothing about which side content actually
// renders on. A bounding-box check is the only thing that actually shows
// mirroring happened.

const ME_BASE = {
  id: "user-1",
  email: "compliance@ibms.test",
  fullName: "Compliance Officer",
  mfaEnabled: false,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
};

async function mockAuth(page: Page, languagePreference: "AR" | "EN") {
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fake-access-token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      status: 200,
      json: { ...ME_BASE, roles: ["COMPLIANCE_OFFICER"], languagePreference },
    }),
  );
}

const SYNC_RUNS = [
  {
    id: "run-1",
    source: "OFAC_SDN",
    startedAt: "2026-09-05T00:00:00.000Z",
    completedAt: "2026-09-05T00:00:05.000Z",
    status: "succeeded",
    recordCount: 19329,
    errorMessage: null,
  },
];

async function mockStatus(page: Page) {
  await page.route("http://localhost:4000/watchlist-sync/status**", (route) =>
    route.fulfill({ status: 200, json: SYNC_RUNS }),
  );
}

test("the sidebar renders on the opposite screen edge in Arabic vs. English — real mirroring, not just mirrored text", async ({
  page,
}) => {
  await mockAuth(page, "EN");
  await mockStatus(page);
  await page.goto("/watchlist-sync");
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav).toBeVisible();
  const ltrBox = await nav.boundingBox();
  if (!ltrBox) throw new Error("nav has no bounding box");
  // LTR: sidebar hugs the left edge.
  expect(ltrBox.x).toBeLessThan(50);

  await mockAuth(page, "AR");
  await page.reload();
  await expect(nav).toBeVisible();
  const rtlBox = await nav.boundingBox();
  if (!rtlBox) throw new Error("nav has no bounding box");
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("no viewport");
  // RTL: the SAME markup, same DOM order, now hugs the right edge instead —
  // `shellStyle`'s plain flex-direction: row does this for free once
  // dir="rtl" cascades from <html>, and sidebarStyle's logical
  // `borderInlineEnd` keeps the separator on the edge touching the content
  // column rather than the outer edge.
  expect(rtlBox.x + rtlBox.width).toBeGreaterThan(viewport.width - 50);
  expect(rtlBox.x).toBeGreaterThan(viewport.width / 2);
});

test("a table's column order visually reverses in Arabic — same DOM order, mirrored render", async ({
  page,
}) => {
  await mockAuth(page, "EN");
  await mockStatus(page);
  await page.goto("/watchlist-sync");

  const firstHeaderLtr = await page.getByRole("columnheader", { name: "Source" }).boundingBox();
  const lastHeaderLtr = await page.getByRole("columnheader", { name: "Completed" }).boundingBox();
  if (!firstHeaderLtr || !lastHeaderLtr) throw new Error("header cells not found");
  // LTR: "Source" (first in DOM) renders left of "Completed" (last in DOM).
  expect(firstHeaderLtr.x).toBeLessThan(lastHeaderLtr.x);

  await mockAuth(page, "AR");
  await page.reload();
  const firstHeaderRtl = await page.getByRole("columnheader", { name: "Source" }).boundingBox();
  const lastHeaderRtl = await page.getByRole("columnheader", { name: "Completed" }).boundingBox();
  if (!firstHeaderRtl || !lastHeaderRtl) throw new Error("header cells not found");
  // RTL: same DOM order, but native <table> column mirroring (a standard
  // browser behavior once `direction` inherits as rtl) now renders "Source"
  // to the RIGHT of "Completed".
  expect(firstHeaderRtl.x).toBeGreaterThan(lastHeaderRtl.x);
});
