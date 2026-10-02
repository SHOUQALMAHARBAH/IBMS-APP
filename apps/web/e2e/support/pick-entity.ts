import { expect, type Page } from '@playwright/test';
import type { EntityKind } from '../../components/ui/EntitySearch';

/**
 * DRIVE A PICKER: mock its search route, type a term, choose the row.
 *
 * Written when seven screens' required uuid fields became pickers (2026-10-02) and every spec that had
 * typed an id into them went red — correctly, because the screens genuinely changed from "paste an id"
 * to "find the thing". A helper rather than seven copies of the same four lines: the selection ritual
 * is the component's, not each screen's, so a change to it should break one place.
 *
 * ## Why it ASSERTS the option appeared
 *
 * Without that assertion, a mock whose shape does not match the source's `search()` produces an empty
 * list, the click silently does nothing, and the test fails later on something unrelated — which is how
 * a wrong fixture gets diagnosed as a broken screen. Failing here names the picker.
 *
 * The term defaults to the id, which is fine because the SERVER does the matching and the server is
 * mocked; a spec that cares about the term (a floor, a trimmed query) should pass one explicitly.
 */
export async function pickEntity(
  page: Page,
  kind: EntityKind,
  row: { id: string; [key: string]: unknown },
  options: { route: string; term?: string; nth?: number } = { route: '' },
): Promise<void> {
  if (options.route) {
    // The API ORIGIN is named, never `**/thing`: a bare pattern also matches the SCREEN's own path
    // whenever the collection and the screen share a noun, and Playwright then serves the mocked JSON
    // as the page document — indistinguishable from a screen that failed to mount.
    await page.route(options.route, (route) =>
      route.fulfill({ status: 200, json: [row] }),
    );
  }

  const field = page.locator(`[data-entity-search-term="${kind}"]`).nth(options.nth ?? 0);
  await field.fill(options.term ?? row.id);
  const option = page.locator(`[data-entity-search-option="${row.id}"]`);
  await expect(
    option,
    `the ${kind} picker returned no option for ${row.id} — check the mocked route and its shape`,
  ).toBeVisible();
  await option.click();
}
