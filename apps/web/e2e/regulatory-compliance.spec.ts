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

const LICENSE = {
  id: "the-broker-license",
  licenseNumber: "CBJ-2026-001",
  scopeOfAuthorization: "General insurance brokerage",
  issuedAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2027-01-01T00:00:00.000Z",
  status: "active",
  isCurrentlyLapsed: false,
};

const CALENDAR_ITEMS = [
  {
    id: "item-1",
    obligationName: "Annual AML training attestation",
    ownerUserId: "user-1",
    dueDate: "2026-01-01T00:00:00.000Z",
    evidenceOfSubmissionRef: null,
    submittedAt: null,
    isSubmitted: false,
    isOverdue: true,
  },
  {
    id: "item-2",
    obligationName: "Quarterly CBJ prudential return",
    ownerUserId: "user-1",
    dueDate: "2026-12-01T00:00:00.000Z",
    evidenceOfSubmissionRef: "doc://ref-1",
    submittedAt: "2026-11-15T00:00:00.000Z",
    isSubmitted: true,
    isOverdue: false,
  },
];

async function mockRegulatoryCompliance(
  page: Page,
  opts: { licenseStatus?: number; calendarStatus?: number } = {},
) {
  await page.route("http://localhost:4000/broker-license", (route) => {
    if (opts.licenseStatus && opts.licenseStatus !== 200) {
      return route.fulfill({
        status: opts.licenseStatus,
        json: { message: "no" },
      });
    }
    return route.fulfill({ status: 200, json: LICENSE });
  });
  await page.route("http://localhost:4000/compliance-calendar**", (route) => {
    if (opts.calendarStatus && opts.calendarStatus !== 200) {
      return route.fulfill({
        status: opts.calendarStatus,
        json: { message: "no" },
      });
    }
    return route.fulfill({ status: 200, json: CALENDAR_ITEMS });
  });
}

test("shows the broker license status and the compliance calendar with the create forms", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockRegulatoryCompliance(page);

  await page.goto("/regulatory-compliance");
  await expect(
    page.getByRole("heading", { name: "Regulatory compliance" }),
  ).toBeVisible();
  await expect(page.getByText("CBJ-2026-001")).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark lapsed" })).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Annual AML training attestation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Quarterly CBJ prudential return" }),
  ).toBeVisible();
  await expect(page.getByLabel("License number")).toBeVisible();
  await expect(page.getByLabel("Obligation")).toBeVisible();
  // the overdue, unsubmitted item shows a record-submission control; the
  // already-submitted one does not
  await expect(page.getByRole("button", { name: "Record submission" })).toHaveCount(
    1,
  );
});

test("a user without either permission sees friendly messages", async ({
  page,
}) => {
  await mockAuth(page, ["SALES_RELATIONSHIP_OFFICER"]);
  await mockRegulatoryCompliance(page, {
    licenseStatus: 403,
    calendarStatus: 403,
  });

  await page.goto("/regulatory-compliance");
  await expect(
    page.getByText("license.manage permission", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("compliance-calendar.manage permission", { exact: false }),
  ).toBeVisible();
});

test("regulatory compliance screen has no serious/critical accessibility violations @a11y", async ({
  page,
}) => {
  await mockAuth(page, ["COMPLIANCE_OFFICER"]);
  await mockRegulatoryCompliance(page);

  await page.goto("/regulatory-compliance");
  await expect(page.getByText("CBJ-2026-001")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    ),
  ).toEqual([]);
});
