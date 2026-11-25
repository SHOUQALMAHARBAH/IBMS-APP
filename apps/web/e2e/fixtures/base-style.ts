import { expect, type Locator, type Page } from '@playwright/test';

/*
 * 🔴 OWNER DECISION 161 RULING 2, WIDENED BY MESSAGE 53 §1 — THE BASE SHAPE REACHES A CONTROL
 * WHOSE INLINE STYLE IS ONLY ABOUT LAYOUT.
 *
 * `globals.css` used to ask whether a control had an inline style at all (`:not([style])`). It
 * now asks what that style NAMES: a style mentioning `background`, `color` or `border` is a look
 * and keeps it; one that names only a margin, a width or a cursor is layout, and the base rule
 * completes it. See the block comment in `globals.css` for the measurement.
 *
 * ## WHY THESE HELPERS READ THE PIXEL
 *
 * Measured in Chromium and recorded in `base-style.spec.ts`: a rule that reaches a form control
 * can COMPUTE the right `backgroundColor` and PAINT Chromium's own native field colour, because
 * Chromium decides whether to drop a control's native appearance by a route a computed-style
 * read cannot see. ⟶ A computed-style assertion would have passed over the exact defect the
 * owner reported. Both are checked, and the pixel is the one that catches it.
 *
 * ## AND EVERY PROBE ASSERTS WHAT IT IS PROBING
 *
 * `expectLayoutOnlyControl` fails if the control it was handed is NOT layout-only — no inline
 * style at all, or one that names a look word. Without that, the day somebody gives one of these
 * controls a background, this test would quietly start measuring a different claim and keep
 * passing.
 */

/** The tokens `globals.css` resolves to in each theme — the same table `base-style.spec.ts` uses. */
export const BASE_TOKEN = {
  light: { surfaceCard: 'rgb(255, 255, 255)', inkPrimary: 'rgb(38, 48, 62)' },
  dark: { surfaceCard: 'rgb(30, 39, 51)', inkPrimary: 'rgb(232, 236, 242)' },
} as const;

/** Chromium's own native field colour under a dark `color-scheme` — the thing being displaced. */
export const CHROMIUM_NATIVE_DARK_FIELD = 'rgb(59, 59, 59)';

/** The three property names that make an inline style a LOOK rather than a layout instruction. */
export const LOOK_WORDS = ['background', 'color', 'border'] as const;

export type BaseTheme = keyof typeof BASE_TOKEN;

/**
 * Pins the viewer's theme before the page loads.
 *
 * ⛔ Must be called BEFORE `page.goto`: `globals.css` reads `data-theme` off the root element,
 * which the app stamps from `localStorage` on first paint.
 */
export async function useTheme(page: Page, theme: BaseTheme): Promise<void> {
  await page.addInitScript(
    (v) => window.localStorage.setItem('ibms.theme', v),
    theme,
  );
}

/**
 * The colour that actually COVERS most of an element, read back off a screenshot of it.
 *
 * 🔴 AND IT IS THE DOMINANT PIXEL RATHER THAN THE CENTRE ONE, WHICH IS A MEASUREMENT. The first
 * version sampled the single pixel at the element's centre — which is what `base-style.spec.ts`
 * does for an EMPTY `<input>`, correctly. Run against a labelled BUTTON it read
 * `rgb(38, 48, 62)`: `--ink-primary`, because the centre of «← All opportunities» is a glyph.
 *
 * ⟶ So the whole control is captured and its most common colour returned. That is also a
 *   STRONGER claim than one pixel: it is what the control mostly looks like, and it survives a
 *   label, a select's dropdown arrow and an RTL mirror without the test having to know where
 *   any of them sit.
 *
 * ⚠️ The 1px border and the glyphs are a small minority of a 36px-tall control's area, and the
 * defect this exists to catch — Chromium painting its own native field colour while reporting
 * the token — covers the WHOLE control, so it cannot hide in a minority.
 */
export async function paintedColour(target: Locator): Promise<string> {
  const box = await target.boundingBox();
  expect(box, 'the control has no box — it is not laid out').not.toBeNull();
  /*
   * ⚠️ AN ELEMENT SCREENSHOT, NOT A CLIPPED PAGE ONE, AND THAT IS A SECOND MEASURED CORRECTION.
   * A page screenshot's `clip` is in VIEWPORT coordinates, so the first version answered
   * «Clipped area is either empty or outside the resulting image» for the role-revoke button on
   * `/settings/users` — which sits below the fold of a long table. `locator.screenshot()` scrolls
   * the element into view itself and crops exactly its box, and it is still a crop of the PAGE
   * render, so a transparent control still shows what is painted behind it.
   */
  const shot = await target.screenshot();
  // Decoded in the browser rather than with a PNG library in the test process.
  return target.page().evaluate(async (bytes: number[]) => {
    const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height);
    const tally = new Map<string, number>();
    for (let i = 0; i < data.length; i += 4) {
      const key = `rgb(${data[i]}, ${data[i + 1]}, ${data[i + 2]})`;
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
    let best = '';
    let most = -1;
    for (const [key, n] of tally) {
      if (n > most) {
        most = n;
        best = key;
      }
    }
    return best;
  }, Array.from(shot));
}

/**
 * Asserts that one control is LAYOUT-ONLY styled and that the base shape reached it — computed
 * AND painted — in `theme`.
 *
 * @param what names the control in the failure message, so a red run says which of the eleven
 *             the owner's walk listed has stopped taking the shape.
 */
export async function expectLayoutOnlyControl(
  target: Locator,
  theme: BaseTheme,
  what: string,
): Promise<void> {
  await expect(target, `${what}: not on the screen`).toBeVisible();

  const probe = await target.evaluate((el) => ({
    style: el.getAttribute('style') ?? '',
    hasClass: el.hasAttribute('class'),
    bg: getComputedStyle(el).backgroundColor,
    radius: getComputedStyle(el).borderTopLeftRadius,
    borderWidth: getComputedStyle(el).borderTopWidth,
  }));

  // THE PROBE ASSERTS WHAT IT IS PROBING, in both directions.
  expect(
    probe.style,
    `${what}: this probe is for a control with a LAYOUT-ONLY inline style, and this one has no ` +
      'inline style at all — it belongs in the bare-control test instead',
  ).not.toBe('');
  expect(
    probe.hasClass,
    `${what}: a control with a className is outside this rule by design`,
  ).toBe(false);
  for (const word of LOOK_WORDS) {
    expect(
      probe.style.toLowerCase().includes(word),
      `${what}: its inline style now names \`${word}\`, so it is a LOOK and keeps its own — ` +
        'either the control changed or this probe is pointed at the wrong thing',
    ).toBe(false);
  }

  expect(probe.bg, `${what}: computed background in ${theme}`).toBe(
    BASE_TOKEN[theme].surfaceCard,
  );
  // The shape, not only the colour: a 6px radius and a 1px border are what make it read as a
  // control rather than as a word.
  expect(probe.radius, `${what}: radius in ${theme}`).not.toBe('0px');
  expect(probe.borderWidth, `${what}: border width in ${theme}`).toBe('1px');

  // THE PIXEL, which is the half a computed-style assertion cannot do.
  const painted = await paintedColour(target);
  expect(painted, `${what}: PAINTED colour in ${theme}`).toBe(
    BASE_TOKEN[theme].surfaceCard,
  );
  if (theme === 'dark') {
    expect(
      painted,
      `${what}: painted Chromium's own native dark field colour, which is what a ` +
        'computed-style assertion cannot see',
    ).not.toBe(CHROMIUM_NATIVE_DARK_FIELD);
  }
}
