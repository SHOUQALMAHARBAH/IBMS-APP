import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("home page renders the IBMS heading", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "IBMS" })).toBeVisible();
});

test("home page has no serious/critical accessibility violations @a11y", async ({ page }) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page }).analyze();
  // Evidence gate (verification-contract.md) is "0 serious/critical" — moderate/minor
  // findings are reported here for visibility but don't fail the gate.
  if (results.violations.length > 0) {
    console.log(`axe-core found ${results.violations.length} total violation(s):`, results.violations.map((v) => `${v.id} (${v.impact})`));
  }
  const seriousOrCritical = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(seriousOrCritical).toEqual([]);
});
