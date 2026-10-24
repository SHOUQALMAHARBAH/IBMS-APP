import { expect, test, type Page } from '@playwright/test';
import { permissionsForRoles } from './fixtures/role-permissions';
import { expectNone } from './support/anchored';

/**
 * MODULE 0-ب, DECISION 36 — THE CONFLICT-OF-INTEREST DISCLOSURE REGISTER.
 *
 * Two halves with different audiences on one section of `/settings/security`:
 *
 *  1. DECLARING is for EVERYBODY and is gated by nothing. The discloser is the subject, so there is
 *     no permission code for it and there cannot be one — a code an office could withhold would
 *     leave the person who HAS the conflict as the one person unable to say so. That is the property
 *     these tests exist for, and it is asserted with a role holding the narrowest keyring in the
 *     seeded grid.
 *  2. READING other people's disclosures is `conflict-of-interest.register.read`, and for a reader
 *     without it the register renders NOTHING — not a refusal sentence. Somebody who came to this
 *     page to pair an authenticator has no reason to be told a register they cannot read exists;
 *     that is the `EncryptionKeyInventory` placement decision, reused with its reasoning.
 */

const ME_BASE = {
  id: 'user-1',
  email: 'officer@ibms.test',
  fullName: 'Sales Officer',
  languagePreference: 'EN',
  mfaEnabled: true,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
  dutySegregationMode: 'SEGREGATED',
};

const DISCLOSURE =
  'My brother-in-law is a director of an insurer this office places business with.';

interface Posted {
  disclosure: string;
}

async function mockSecurityPage(
  page: Page,
  opts: {
    roles?: string[];
    entries?: {
      id: string;
      declaredByUserId: string;
      declaredByName: string;
      disclosure: string;
      declaredAt: string;
    }[];
    onDeclare?: (body: Posted) => void;
  } = {},
) {
  const roles = opts.roles ?? ['SALES_RELATIONSHIP_OFFICER'];
  await page.route('**/auth/refresh', (route) =>
    route.fulfill({ status: 200, json: { accessToken: 'fake-access-token' } }),
  );
  await page.route('**/auth/me', (route) =>
    route.fulfill({
      status: 200,
      json: { ...ME_BASE, roles, permissions: permissionsForRoles(roles) },
    }),
  );
  // The page's OTHER sections. A fixture that omits an endpoint the screen calls is unfaithful, and
  // its load error would make a page-wide `role=alert` assertion ambiguous.
  await page.route('**/auth/mfa/credentials', (route) =>
    route.fulfill({ status: 200, json: [] }),
  );
  await page.route('**/security/encryption-keys', (route) =>
    route.fulfill({ status: 403, json: { message: 'no' } }),
  );

  const entries = opts.entries ?? [];
  // Host-qualified: a bare glob also matches the page document and answers the navigation with JSON.
  await page.route(
    'http://localhost:4000/conflict-of-interest/disclosures',
    (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON() as Posted;
        opts.onDeclare?.(body);
        const created = {
          id: 'entry-new',
          declaredByUserId: 'user-1',
          declaredByName: ME_BASE.fullName,
          disclosure: body.disclosure,
          declaredAt: '2026-10-22T10:00:00.000Z',
        };
        entries.unshift(created);
        return route.fulfill({ status: 201, json: created });
      }
      return route.fulfill({ status: 200, json: entries });
    },
  );
}

test.describe('the conflict-of-interest disclosure register', () => {
  test('a role with no compliance permissions can declare, and the register does not render for them', async ({
    page,
  }) => {
    const posted: Posted[] = [];
    await mockSecurityPage(page, { onDeclare: (b) => posted.push(b) });
    await page.goto('/settings/security');

    const declare = page.getByTestId('coi-declare');
    // NINE CHARACTERS, not zero: a test that only checks the empty form cannot tell a ten-character
    // floor from a non-empty check.
    await expect(declare).toBeDisabled();
    await page.getByTestId('coi-disclosure').fill('a conflic');
    await expect(declare).toBeDisabled();

    await page.getByTestId('coi-disclosure').fill(DISCLOSURE);
    await expect(declare).toBeEnabled();
    await declare.click();

    expect(posted).toEqual([{ disclosure: DISCLOSURE }]);
    await expect(page.getByTestId('coi-register')).toContainText(
      'Your disclosure has been recorded',
    );

    // THE GATED HALF RENDERS NOTHING — not a refusal. Anchored on a positive read from the same
    // render, because `toHaveCount(0)` passes on its first poll.
    await expectNone(
      page.getByTestId('coi-register-table'),
      page.getByTestId('coi-declare'),
    );
  });

  test('a holder of the read code sees the register, with NAMES rather than ids', async ({
    page,
  }) => {
    await mockSecurityPage(page, {
      roles: ['BRANCH_DEPARTMENT_MANAGER'],
      entries: [
        {
          id: 'entry-1',
          declaredByUserId: '7f3a1c22-0000-4000-8000-000000000001',
          declaredByName: 'Mira Al-Qudah',
          disclosure: DISCLOSURE,
          declaredAt: '2026-10-20T08:30:00.000Z',
        },
      ],
    });
    await page.goto('/settings/security');

    const table = page.getByTestId('coi-register-table');
    await expect(table).toBeVisible();
    await expect(table).toContainText('Mira Al-Qudah');
    await expect(table).toContainText(DISCLOSURE);
    // AND NEVER THE UUID. A uuid in front of the manager reading this is the
    // identifier-where-a-name-exists fault, and the api sends the name for exactly this reason.
    await expect(table).not.toContainText('7f3a1c22');
  });

  test('the register says so when it is empty, rather than rendering an empty table', async ({
    page,
  }) => {
    await mockSecurityPage(page, {
      roles: ['BRANCH_DEPARTMENT_MANAGER'],
      entries: [],
    });
    await page.goto('/settings/security');

    await expect(page.getByTestId('coi-register-table')).toContainText(
      'Nobody in this office has recorded a disclosure yet',
    );
  });

  /**
   * THE DECLARING HALF IS STILL THERE FOR A READER WHO CAN ALSO READ. The two halves are independent,
   * and a version that showed the form only to non-holders would be the mirror defect.
   */
  test('a holder of the read code can still declare their own conflict', async ({
    page,
  }) => {
    await mockSecurityPage(page, { roles: ['BRANCH_DEPARTMENT_MANAGER'] });
    await page.goto('/settings/security');
    await expect(page.getByTestId('coi-disclosure')).toBeVisible();
  });
});
