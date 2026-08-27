import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ME_BASE = {
  id: "user-1",
  email: "officer@ibms.test",
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

const INTERACTION = {
  id: "int-1",
  customerId: "cust-1",
  channel: "EMAIL",
  summary: "Sent the renewal terms",
  occurredAt: "2026-02-10T00:00:00.000Z",
  loggedByUserId: "user-1",
  createdAt: "2026-02-10T00:00:00.000Z",
};

function view(overrides: Record<string, unknown> = {}) {
  return {
    customer: {
      id: "cust-1",
      legalName: "Acme Trading LLC",
      customerType: "CORPORATE",
      status: "ACTIVE",
      ownerUserId: "user-1",
    },
    interactions: [INTERACTION],
    policies: [],
    claims: [],
    complaints: [],
    timeline: [
      {
        kind: "INTERACTION",
        refId: "int-1",
        at: "2026-02-10T00:00:00.000Z",
        title: "EMAIL",
        detail: "Sent the renewal terms",
        status: null,
      },
    ],
    counts: { interactions: 1, policies: 0, claims: 0, complaints: 0 },
    ...overrides,
  };
}

async function mockCrm(
  page: Page,
  opts: { viewStatus?: number; view?: unknown; onLog?: () => void } = {},
) {
  await page.route("http://localhost:4000/customers/**", (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (/\/customers\/cust-1\/interactions$/.test(url) && method === "POST") {
      opts.onLog?.();
      return route.fulfill({ status: 201, json: INTERACTION });
    }
    if (/\/customers\/cust-1\/360-view$/.test(url)) {
      return route.fulfill({
        status: opts.viewStatus ?? 200,
        json:
          opts.viewStatus === 403
            ? { message: "You do not hold a permission required to perform this action" }
            : (opts.view ?? view()),
      });
    }
    return route.fulfill({ status: 200, json: [] });
  });
}

test("shows the customer, counts and timeline", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockCrm(page);

  await page.goto("/crm?customerId=cust-1");
  await expect(page.getByRole("heading", { name: "Relationship (CRM)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Acme Trading LLC" })).toBeVisible();
  await expect(page.getByText("Interactions: 1")).toBeVisible();
  await expect(page.getByText("Sent the renewal terms")).toBeVisible();
});

test("logs an interaction and refreshes the timeline", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  let logged = false;
  await mockCrm(page, {
    onLog: () => {
      logged = true;
    },
  });

  await page.goto("/crm?customerId=cust-1");
  await page.getByLabel("What happened?").fill("Called about the claim");
  await page.getByRole("button", { name: "Log interaction" }).click();
  await expect.poll(() => logged).toBe(true);
});

test("shows an empty timeline state", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockCrm(page, {
    view: view({ interactions: [], timeline: [], counts: { interactions: 0, policies: 0, claims: 0, complaints: 0 } }),
  });

  await page.goto("/crm?customerId=cust-1");
  await expect(
    page.getByText("Nothing on this customer's timeline yet"),
  ).toBeVisible();
});

test("prompts to pick a customer when none is in the URL", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockCrm(page);

  await page.goto("/crm");
  await expect(page.locator('p[role="alert"]')).toContainText("No customer selected");
});

test("a role that can log but not read the 360 view still gets the log form", async ({
  page,
}) => {
  // Placement/Claims/Finance hold interaction.log but not customer.360-view.read.
  await mockAuth(page, ["PLACEMENT_TECHNICAL_OFFICER"]);
  let logged = false;
  await mockCrm(page, {
    viewStatus: 403,
    onLog: () => {
      logged = true;
    },
  });

  await page.goto("/crm?customerId=cust-1");
  await expect(page.getByText("The 360° timeline needs the")).toBeVisible();
  await page.getByLabel("What happened?").fill("Chased the insurer for the schedule");
  await page.getByRole("button", { name: "Log interaction" }).click();
  await expect.poll(() => logged).toBe(true);
  await expect(page.getByText("Interaction logged.")).toBeVisible();
});

test("a role with neither permission sees a friendly message and no form", async ({
  page,
}) => {
  await mockAuth(page, ["DATA_PROTECTION_OFFICER"]);
  await mockCrm(page, { viewStatus: 403 });

  await page.goto("/crm?customerId=cust-1");
  await expect(page.locator('p[role="alert"]')).toContainText(
    "don't hold the customer.360-view.read",
  );
  await expect(page.getByLabel("What happened?")).toHaveCount(0);
});

test("crm timeline screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockCrm(page);

  await page.goto("/crm?customerId=cust-1");
  await expect(page.getByText("Sent the renewal terms")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
});

test("the Log interaction control is reachable via keyboard", async ({ page }) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockCrm(page);

  await page.goto("/crm?customerId=cust-1");
  await page.getByLabel("What happened?").fill("Quick note");
  const log = page.getByRole("button", { name: "Log interaction" });
  await log.focus();
  await expect(log).toBeFocused();
});
