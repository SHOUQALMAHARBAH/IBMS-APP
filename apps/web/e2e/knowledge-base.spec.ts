import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ME_BASE = {
  id: "user-1",
  email: "compliance@ibms.test",
  fullName: "Compliance Officer",
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

const ARTICLE = {
  id: "article-1",
  title: "Property All Risks Overview",
  titleAr: null as string | null,
  category: "product_knowledge",
  bodyEn: "Coverage summary.",
  bodyAr: null as string | null,
  publishedAt: "2026-09-06T09:00:00.000Z",
};

test("renders the knowledge base list with the publish form", async ({ page }) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("http://localhost:4000/knowledge-base-articles", (route) =>
    route.fulfill({ status: 200, json: [ARTICLE] }),
  );

  await page.goto("/knowledge-base");
  await expect(page.getByRole("heading", { name: "Knowledge Base" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Property All Risks Overview" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Publish a new article" })).toBeVisible();
});

test("a user without the permission sees a friendly message", async ({ page }) => {
  await mockAuth(page, ["CLAIMS_OFFICER"]);
  await page.route("http://localhost:4000/knowledge-base-articles", (route) =>
    route.fulfill({ status: 403, json: { message: "no" } }),
  );

  await page.goto("/knowledge-base");
  await expect(
    page.getByText("kb.publish permission", { exact: false }),
  ).toBeVisible();
});

test("edits an article to add an Arabic title", async ({ page }) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  let current = { ...ARTICLE };
  await page.route("http://localhost:4000/knowledge-base-articles", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 200, json: [current] });
    }
    return route.fallback();
  });
  await page.route("http://localhost:4000/knowledge-base-articles/article-1", (route) => {
    current = { ...current, titleAr: "نظرة عامة" };
    return route.fulfill({ status: 200, json: current });
  });

  await page.goto("/knowledge-base");
  await expect(page.getByRole("cell", { name: "Property All Risks Overview" })).toBeVisible();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.locator('input[dir="rtl"]').first().fill("نظرة عامة");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("cell", { name: "نظرة عامة" })).toBeVisible();
});

test("publishes a new bilingual article", async ({ page }) => {
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  await page.route("http://localhost:4000/knowledge-base-articles", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 201,
        json: { ...ARTICLE, id: "article-2", title: "Motor Rate Guide", category: "rate_guide" },
      });
    }
    return route.fulfill({ status: 200, json: [ARTICLE] });
  });

  await page.goto("/knowledge-base");
  await page.getByLabel("Title (English)").fill("Motor Rate Guide");
  await page.getByLabel("Category").selectOption("rate_guide");
  await page.getByRole("button", { name: "Publish article" }).click();
  await expect(page.getByText("Could not publish the article.")).not.toBeVisible();
});

test("knowledge-base screen has no serious/critical accessibility violations @a11y", async ({ page }) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await page.route("http://localhost:4000/knowledge-base-articles", (route) =>
    route.fulfill({ status: 200, json: [ARTICLE] }),
  );

  await page.goto("/knowledge-base");
  await expect(page.getByRole("cell", { name: "Property All Risks Overview" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
