import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ME_BASE = {
  id: "user-1",
  email: "sales@ibms.test",
  fullName: "Sales Officer",
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
    route.fulfill({ status: 200, json: { ...ME_BASE, roles } }),
  );
}

const COMMUNICATIONS = [
  {
    id: "comm-1",
    customerId: "11111111-1111-1111-1111-111111111111",
    channel: "EMAIL",
    templateId: null,
    languageUsed: "AR",
    direction: "OUTBOUND",
    subject: "Your renewal documents",
    body: "Please find your certificate attached.",
    isMarketing: false,
    respectedConsent: true,
    consentRecordId: null,
    loggedByUserId: "u-sales",
    sentAt: "2026-09-04T09:00:00.000Z",
    createdAt: "2026-09-04T09:00:01.000Z",
  },
  {
    id: "comm-2",
    customerId: "11111111-1111-1111-1111-111111111111",
    channel: "EMAIL",
    templateId: "promo-v1",
    languageUsed: "AR",
    direction: "OUTBOUND",
    subject: "New motor product",
    body: "Check it out",
    isMarketing: true,
    respectedConsent: true,
    consentRecordId: "consent-9",
    loggedByUserId: "u-sales",
    sentAt: "2026-09-05T09:00:00.000Z",
    createdAt: "2026-09-05T09:00:01.000Z",
  },
];

async function mockCommunications(page: Page, opts: { status?: number } = {}) {
  await page.route("http://localhost:4000/communications**", (route) => {
    if (opts.status && opts.status !== 200) {
      return route.fulfill({ status: opts.status, json: { message: "no" } });
    }
    return route.fulfill({ status: 200, json: COMMUNICATIONS });
  });
}

test("lists communications with the marketing flag and the send form", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockCommunications(page);

  await page.goto("/communications");
  await expect(
    page.getByRole("heading", { name: "Communications" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Your renewal documents" }),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: "New motor product" })).toBeVisible();
  await expect(page.getByLabel("Channel")).toBeVisible();
  await expect(page.getByLabel("Marketing")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Log communication" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Check marketing consent" }),
  ).toBeVisible();
});

test("a user without the permission sees a friendly message", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockCommunications(page, { status: 403 });

  await page.goto("/communications");
  await expect(
    page.getByText("communication.send permission", { exact: false }),
  ).toBeVisible();
});

test("communications screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockCommunications(page);

  await page.goto("/communications");
  await expect(
    page.getByRole("cell", { name: "Your renewal documents" }),
  ).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
