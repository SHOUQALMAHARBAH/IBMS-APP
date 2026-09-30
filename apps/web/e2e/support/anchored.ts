import { expect, type Locator } from "@playwright/test";

/**
 * ANCHORED READS — the only way this suite is allowed to read how many elements match.
 *
 * ## The defect this exists to make unwritable
 *
 * `locator.count()`, `evaluateAll()` and `allInnerTexts()` are the three reads in Playwright that do
 * NOT auto-wait. They answer instantly, about the DOM as it is at that instant. Called straight after
 * `goto()`, they measure "React has not hydrated yet" and return zero — and zero is a plausible
 * answer, so nothing fails.
 *
 * That is why this is worth a module rather than a code-review habit: it produced FOUR separate wrong
 * readings in a single session, in four different files, each one written by someone who knew about
 * the trap. Two of them failed for the wrong reason, which is survivable because someone investigates.
 * The other two would have PASSED for the wrong reason — an absence assertion satisfied by a blank
 * page cannot tell "the control is correctly withheld" from "the screen never rendered". That is the
 * same class as an exclusion filter that cannot tell "correctly excluded" from "never returned".
 *
 * ## What an anchor is
 *
 * Something that must be present, asserted with an auto-waiting matcher BEFORE the instant read. It
 * converts "the DOM is empty" from an answer into a failure. An action (`click`, `fill`, `check`)
 * anchors just as well, because actionability cannot be satisfied before render.
 *
 * ## Why these are functions and not advice
 *
 * The four sites each already carried a comment explaining the trap, written after being bitten by
 * it. A pattern you can still write by hand is a pattern that comes back — so the raw reads are now
 * an eslint failure inside every e2e spec file (see `eslint.config.mjs`), and this module is the
 * exemption. The companion guard is `test/e2e-anchored-reads.test.ts`, which fails when an absence
 * assertion has no anchor before it.
 */

/**
 * How many elements match, read only once the page has demonstrably rendered.
 *
 * The anchor defaults to the first match, which is the right anchor whenever the expected count is
 * one or more: if not even one is there, the count would be a measurement of nothing. For an expected
 * count of zero use {@link expectNone} — it takes an anchor that is NOT the set under test, because
 * an empty set cannot vouch for itself.
 */
export async function anchoredCount(target: Locator, anchor: Locator = target.first()): Promise<number> {
  await expect(
    anchor,
    "anchoredCount: nothing to anchor on, so a count here would measure an unrendered page. If the expected count is zero, use expectNone(target, anchor) with an anchor outside the set.",
  ).toBeVisible();
  return target.count();
}

/** One attribute across every match — the enumeration shape, with the same anchor discipline. */
export async function anchoredAttributes(
  target: Locator,
  attribute: string,
  anchor: Locator = target.first(),
): Promise<(string | null)[]> {
  await expect(
    anchor,
    `anchoredAttributes(${attribute}): nothing to anchor on, so this would enumerate an unrendered page.`,
  ).toBeVisible();
  return target.evaluateAll(
    (els, name: string) => els.map((el) => el.getAttribute(name)),
    attribute,
  );
}

/**
 * Rendered text of every match, in DOM order.
 *
 * `innerText` and not `textContent`: it reports what is on the screen, so a heading uppercased in CSS
 * comes back uppercased. Callers that compare against source strings lower-case it themselves.
 */
export async function anchoredTexts(target: Locator, anchor: Locator = target.first()): Promise<string[]> {
  await expect(
    anchor,
    "anchoredTexts: nothing to anchor on, so this would read an unrendered page.",
  ).toBeVisible();
  return target.allInnerTexts();
}

/**
 * Nothing matches — and the page it does not match on is really there.
 *
 * The anchor has no default and must be something OTHER than the set under test. This is the whole
 * point: `toHaveCount(0)` is satisfied by a blank page, so an unanchored absence assertion is
 * indistinguishable from a screen that failed to load.
 */
export async function expectNone(target: Locator, anchor: Locator): Promise<void> {
  await expect(
    anchor,
    "expectNone: the anchor must be visible, otherwise the absence below is satisfied by a blank page and proves nothing.",
  ).toBeVisible();

  /*
   * THE SECOND WAY AN ABSENCE ASSERTION LIES, and this helper CANNOT close it.
   *
   * An anchor proves that SOMETHING rendered. It cannot prove that the read which would produce the
   * absent element has finished. When a screen loads two things in sequence — the office's own rows,
   * then the shared ones — an anchor from the FIRST read is visible while the second is still in
   * flight, and `toHaveCount(0)` SUCCEEDS ON ITS FIRST POLL rather than waiting. "Not yet" and
   * "never" become the same answer, and which one a run gets depends on machine load: measured
   * 2026-09-28, a planted regression died under the full spec and PASSED when its own test ran
   * alone, on the identical build.
   *
   * ## `waitForLoadState('networkidle')` DOES NOT FIX IT. Tried, and disproved by a test.
   *
   * It looks like the obvious barrier and it is a SNAPSHOT. The second request is issued only after
   * the first resolves and the component re-renders, so at the instant this helper would ask, the
   * page genuinely IS idle — idleness is precisely the state BETWEEN the two reads. Adding the wait
   * changed nothing: `e2e/anchored-helper.spec.ts` holds the reproduction, with the second read
   * delayed so the window is entered on every run rather than under load.
   *
   * ## So the fix is not here
   *
   * What the assertion would need is "has everything that could produce this element run yet", and
   * nothing at the DOM boundary can answer that. It is answered by the CALLER choosing an anchor
   * from the same read as the absent thing — which is a rule about call sites, enforced by
   * `test/e2e-anchored-reads.test.ts`, not something this function can check. The four sites that
   * had the wrong shape are fixed; the guard refuses new ones.
   */
  await expect(target).toHaveCount(0);
}
