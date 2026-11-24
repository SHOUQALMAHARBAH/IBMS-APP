import { expect, test, type Page } from '@playwright/test';

import { permissionsForRoles } from './fixtures/role-permissions';

/*
 * 🔴 OWNER DECISION 161 RULING 2 — THE BASE SHAPE FOR THE CONTROLS NOBODY STYLED.
 *
 * «الشكل بيخزي» — her own words about the look rather than the defects. `globals.css` carried
 * 729 lines and not one rule for a button, a field, a select or the disabled state, so 582 of
 * the 901 controls in this app were drawn by the browser's own defaults.
 *
 * ## WHY THIS SPEC READS THE PIXEL AND NOT ONLY `getComputedStyle`
 *
 * The first version of the rule was wrapped in `:where(…)` for zero specificity. Measured in
 * Chromium, a bare `<input>` in the dark theme then reported a computed
 * `backgroundColor` of `rgb(30, 39, 51)` — the right token — while the PIXEL under it was
 * `rgb(59, 59, 59)`, Chromium's own native dark field colour. Chromium decides whether to drop a
 * control's native appearance by asking whether the author gave it a background, and a
 * declaration reached through `:where()` does not answer that question.
 *
 * ⟶ So a computed-style assertion would have passed over the exact defect the owner reported
 *   («الخانات الفاتحة في الوضع الداكن»). Both are asserted here, and the pixel is the one that
 *   would have caught it.
 *
 * ## AND BOTH THEMES, BECAUSE ONE OF THEM IS WHERE IT WENT WRONG
 *
 * ⚠️ Ruling 4 says the presenter shows the LIGHT theme, which is exactly why the dark theme
 * needs a test: nobody will be looking at it on the day.
 */

const ME = {
  id: 'user-1',
  email: 'officer@ibms.test',
  fullName: 'هدى الشوابكة',
  languagePreference: 'AR' as const,
  mfaEnabled: true,
  mfaPolicySatisfied: true,
  accessValidUntil: null,
  idleTimeoutMinutes: 15,
  hardLogoutAfterIdleMinutes: 30,
  stepUpFresh: true,
  organizationName: { en: 'GO Global', ar: 'جو جلوبال' },
};

/** The tokens this rule is built on, as `globals.css` defines them in each theme. */
const TOKEN = {
  light: { surfaceCard: 'rgb(255, 255, 255)', inkPrimary: 'rgb(38, 48, 62)' },
  dark: { surfaceCard: 'rgb(30, 39, 51)', inkPrimary: 'rgb(232, 236, 242)' },
};

/** Chromium's own native field colour in a dark `color-scheme` — the thing being displaced. */
const CHROMIUM_NATIVE_DARK_FIELD = 'rgb(59, 59, 59)';

/** Enough of a catalogue for the matrix — and so for its own styled search box — to render. */
const CATALOGUE = [
  { code: 'claim.read', module: 'claims', description: 'عرض مطالبة ومستنداتها' },
  { code: 'claim.register', module: 'claims', description: 'تسجيل مطالبة مبلَّغة' },
];

async function openRoles(
  page: Page,
  theme: 'light' | 'dark',
  catalogue: unknown[] = [],
) {
  await page.addInitScript(
    (v) => window.localStorage.setItem('ibms.theme', v),
    theme,
  );
  await page.setViewportSize({ width: 1360, height: 1000 });
  await page.route('**/auth/refresh', (r) =>
    r.fulfill({ status: 200, json: { accessToken: 'fake-access-token' } }),
  );
  await page.route('**/auth/me', (r) =>
    r.fulfill({
      status: 200,
      json: {
        ...ME,
        roles: ['OFFICE_ADMINISTRATOR'],
        permissions: permissionsForRoles(['OFFICE_ADMINISTRATOR']),
      },
    }),
  );
  await page.route('http://localhost:4000/rbac/roles**', (r) =>
    r.fulfill({ status: 200, json: [] }),
  );
  await page.route('http://localhost:4000/rbac/permissions', (r) =>
    r.fulfill({ status: 200, json: catalogue }),
  );
  await page.route('http://localhost:4000/insurance-lines**', (r) =>
    r.fulfill({ status: 200, json: [] }),
  );
  await page.goto('/settings/roles');
  // The create-role form's own heading, so the reads below happen after hydration.
  await expect(
    page.getByRole('heading', { name: 'إنشاء دور' }),
  ).toBeVisible();
}

/** The colour actually PAINTED at the centre of an element, read back off a screenshot. */
async function paintedColour(page: Page, selector: string): Promise<string> {
  const box = await page.locator(selector).first().boundingBox();
  expect(box, `${selector} has no box — it is not laid out`).not.toBeNull();
  const shot = await page.screenshot({
    clip: {
      x: box!.x + box!.width / 2,
      y: box!.y + box!.height / 2,
      width: 1,
      height: 1,
    },
  });
  // A 1×1 PNG, decoded in the browser rather than with a PNG library in the test process.
  return page.evaluate(async (bytes: number[]) => {
    const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  }, Array.from(shot));
}

for (const theme of ['light', 'dark'] as const) {
  test(`decision 161 ruling 2 — a bare input takes the token, in ${theme}, in the PIXEL`, async ({
    page,
  }) => {
    await openRoles(page, theme);

    /*
     * The create-role form's English-name box: a bare `<input>` with neither `style` nor
     * `className`, asserted to BE bare so this test cannot quietly start measuring a styled
     * control somebody added a style to.
     */
    const field = page.locator('[data-create-name-en]').first();
    const attrs = await field.evaluate((el) => ({
      hasStyle: el.hasAttribute('style'),
      hasClass: el.hasAttribute('class'),
      type: (el as HTMLInputElement).type,
    }));
    expect(attrs.hasStyle, 'the probe is no longer a BARE control').toBe(false);
    expect(attrs.hasClass, 'the probe is no longer a BARE control').toBe(false);
    expect(['text', 'search']).toContain(attrs.type);

    const computed = await field.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    expect(computed).toBe(TOKEN[theme].surfaceCard);

    // THE PIXEL, which is the half a computed-style assertion cannot do.
    const painted = await paintedColour(page, '[data-create-name-en]');
    expect(painted).toBe(TOKEN[theme].surfaceCard);
    if (theme === 'dark') {
      // Named explicitly: this is the colour the first version of the rule painted while
      // reporting the right one.
      expect(painted).not.toBe(CHROMIUM_NATIVE_DARK_FIELD);
    }
  });

  test(`decision 161 ruling 2 — a bare button and a disabled one read in ${theme}`, async ({
    page,
  }) => {
    await openRoles(page, theme);

    // The create button is DISABLED until the form is filled, which is the state the ruling
    // names by itself: «ولحالة التعطيل».
    const submit = page.locator('[data-create-role-submit]');
    await expect(submit).toBeDisabled();
    const style = await submit.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        bg: cs.backgroundColor,
        color: cs.color,
        cursor: cs.cursor,
        opacity: cs.opacity,
        radius: cs.borderTopLeftRadius,
      };
    });
    // ⛔ NOT MUTED WITH OPACITY — `check:opacity-muting`'s own rule, and the reason is that axe
    // measures the BLEND, so an opacity-muted control can fail contrast while its token passes.
    expect(style.opacity).toBe('1');
    expect(style.cursor).toBe('not-allowed');
    expect(style.radius).not.toBe('0px');
    // Readable in both themes: the disabled ink is a TOKEN this file proves against WCAG AA,
    // never the browser's own greyed-out text.
    expect(style.color).not.toBe(style.bg);
  });
}

test('⛔ an element that carries its own style or className keeps it', async ({
  page,
}) => {
  /*
   * Her ruling's other half: «والعنصر الذي له شكل خاصّ يبقى كما هو». The selector is
   * `:not([style]):not([class])`, so a styled control is not merely out-ranked — it is NOT
   * MATCHED, which is the stronger guarantee and the one asserted here.
   */
  await openRoles(page, 'light', CATALOGUE);
  const styled = page.locator('[data-matrix-search]');
  await expect(styled).toBeVisible();
  const hasOwn = await styled.evaluate((el) => el.hasAttribute('style'));
  expect(hasOwn, 'the probe is no longer a STYLED control').toBe(true);

  // Its own padding, from `matrixSearchStyle`, not this rule's `var(--space-2) var(--space-3)`.
  const padding = await styled.evaluate(
    (el) => getComputedStyle(el).paddingTop,
  );
  const bare = await page
    .locator('[data-create-name-en]')
    .first()
    .evaluate((el) => getComputedStyle(el).paddingTop);
  // NON-VACUITY: the two must actually differ, or this test would pass against a rule that
  // reached both and a styled control that happened to agree with it.
  expect(padding).not.toBe(bare);
});
