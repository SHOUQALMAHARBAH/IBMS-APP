import { expect, test, type Page, type Request } from "@playwright/test";
import { permissionsForRoles } from "./fixtures/role-permissions";
import { expectNone } from "./support/anchored";

/**
 * THE MODE SCREEN MUST NOT OPEN ONTO A WALL.
 *
 * `/settings/duty-segregation` lets an office declare that one person may perform both halves of an
 * approval. The API then REQUIRES a reason on exactly those approvals — so if no approve screen can carry
 * one, declaring the mode buys the office a 422 and nowhere to type. That is the failure this file exists
 * to refuse, and it is asserted here rather than on each of the twelve screens because the condition and
 * the field are ONE shared component: what differs per screen is which column names the maker.
 *
 * The complaint closure is the host because it is the cheapest of the twelve to put on screen — one list
 * fetch, no expansion, the approve control rendered directly in the row.
 *
 * The companion proof is the plant `always-asks-for-a-declaration` (scripts/plants/duty-segregation.json):
 * dropping the mode check from the shared condition kills the recommendation approval and the claim
 * settlement second approval in `rfq.spec.ts`, which is how we know the ordinary two-person approvals this
 * product is mostly made of are observing the SEGREGATED half.
 */

const ME_BASE = {
  id: "user-1",
  email: "mgr@ibms.test",
  fullName: "Branch Manager",
  languagePreference: "EN",
  mfaEnabled: false,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
  roles: ["BRANCH_DEPARTMENT_MANAGER"],
  permissions: permissionsForRoles(["BRANCH_DEPARTMENT_MANAGER"]),
};

/**
 * A complaint this viewer RESOLVED themselves and nobody has signed off. `resolvedByUserId` is the maker
 * column for this pair, and it matches `ME_BASE.id` deliberately: the declaration is asked for only when
 * the approver is the maker, so a row resolved by somebody else would prove nothing either way.
 */
const OWN_RESOLVED_COMPLAINT = {
  id: "c-own",
  customerId: "11111111-1111-1111-1111-111111111111",
  claimId: null,
  policyId: null,
  issue: "Premium was debited twice in one month",
  category: "billing_error",
  status: "RESOLVED",
  isClosed: false,
  responsibleEmployeeUserId: "user-1",
  resolution: "Refunded the duplicate debit and confirmed with the client",
  resolvedByUserId: "user-1",
  closureApprovedByUserId: null,
  closedAt: null,
  sla: {
    timerId: "sla-own",
    dueAt: "2026-09-30T00:00:00.000Z",
    escalatedAt: null,
    escalatedTo: null,
    resolvedAt: "2026-09-24T00:00:00.000Z",
    breached: false,
  },
  actions: [],
  escalations: [],
  createdAt: "2026-09-20T09:00:00.000Z",
};

async function openComplaints(page: Page, mode: "SEGREGATED" | "COMBINED") {
  await page.route("**/auth/refresh", (route) =>
    route.fulfill({ status: 200, json: { accessToken: "fake-access-token" } }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({ status: 200, json: { ...ME_BASE, dutySegregationMode: mode } }),
  );
  await page.route("http://localhost:4000/complaints**", (route) => {
    if (route.request().method() !== "GET") {
      return route.fulfill({
        status: 200,
        json: { ...OWN_RESOLVED_COMPLAINT, status: "CLOSED", isClosed: true, closureApprovedByUserId: "user-1" },
      });
    }
    return route.fulfill({ status: 200, json: [OWN_RESOLVED_COMPLAINT] });
  });
  await page.goto("/complaints");
  await expect(page.getByRole("heading", { name: "Complaints" })).toBeVisible();
}

const reasonField = (page: Page) => page.getByTestId(`combined-duty-reason-${OWN_RESOLVED_COMPLAINT.id}`);
const closeButton = (page: Page) => page.getByRole("button", { name: "Close" });

test("a COMBINED office is asked why, and cannot approve until it says", async ({ page }) => {
  await openComplaints(page, "COMBINED");

  await expect(reasonField(page)).toBeVisible();
  await expect(page.getByText("Why you are doing both halves")).toBeVisible();
  // The whole point of the coupling: the button exists but refuses until there is a reason to record.
  await expect(closeButton(page)).toBeDisabled();

  // Nine characters. The server's floor is ten, and the screen must not send a request it knows will 422.
  await reasonField(page).fill("too short");
  await expect(closeButton(page)).toBeDisabled();

  const sent: Request[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/complaints/") && r.method() === "POST") sent.push(r);
  });

  await reasonField(page).fill("  Sole officer on duty over the weekend; branch manager on leave  ");
  await expect(closeButton(page)).toBeEnabled();
  await closeButton(page).click();

  await expect
    .poll(() => sent.length, { message: "the close request was never sent" })
    .toBeGreaterThan(0);
  expect(sent[0].postDataJSON()).toEqual({
    // Trimmed, because the surrounding whitespace is not part of what the officer said.
    combinedDutyReason: "Sole officer on duty over the weekend; branch manager on leave",
  });
});

test("a SEGREGATED office is asked nothing on the same row, and can approve at once", async ({ page }) => {
  await openComplaints(page, "SEGREGATED");

  // The anchor is the control itself: it must be on screen and ready BEFORE the absence below is read,
  // or an unhydrated page satisfies the absence and this test passes while proving nothing.
  await expect(closeButton(page)).toBeEnabled();
  await expectNone(reasonField(page), closeButton(page));

  const sent: Request[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/complaints/") && r.method() === "POST") sent.push(r);
  });
  await closeButton(page).click();

  await expect
    .poll(() => sent.length, { message: "the close request was never sent" })
    .toBeGreaterThan(0);
  // An ordinary two-person approval sends the body it always sent — no empty reason field riding along.
  expect(sent[0].postDataJSON()).toEqual({});
});
