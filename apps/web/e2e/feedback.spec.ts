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

const FEEDBACK = [
  {
    id: "fb-1",
    customerId: "11111111-1111-1111-1111-111111111111",
    context: "post_claim",
    score: 4,
    comments: "The adjuster was responsive throughout.",
    submittedAt: "2026-09-04T09:00:00.000Z",
  },
  {
    id: "fb-2",
    customerId: "11111111-1111-1111-1111-111111111111",
    context: "post_issuance",
    score: null,
    comments: null,
    submittedAt: "2026-09-05T09:00:00.000Z",
  },
];

async function mockFeedback(page: Page, opts: { status?: number } = {}) {
  await page.route("http://localhost:4000/feedback**", (route) => {
    if (opts.status && opts.status !== 200) {
      return route.fulfill({ status: opts.status, json: { message: "no" } });
    }
    return route.fulfill({ status: 200, json: FEEDBACK });
  });
}

test("lists feedback with score/comments and the log form", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockFeedback(page);

  await page.goto("/feedback");
  await expect(
    page.getByRole("heading", { name: "Customer feedback" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "The adjuster was responsive throughout." }),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: "post_issuance" })).toBeVisible();
  await expect(page.getByLabel("Context")).toBeVisible();
  await expect(page.getByLabel("Score")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Log feedback" }),
  ).toBeVisible();
});

test("a user without the permission sees a friendly message", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockFeedback(page, { status: 403 });

  await page.goto("/feedback");
  await expect(
    page.getByText("feedback.log permission", { exact: false }),
  ).toBeVisible();
});

test("feedback screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockFeedback(page);

  await page.goto("/feedback");
  await expect(
    page.getByRole("cell", { name: "The adjuster was responsive throughout." }),
  ).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
