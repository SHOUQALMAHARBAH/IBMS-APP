/*
 * ONE HOME FOR THE `data-*` PROP TYPE, and the reason it exists at all.
 *
 * TypeScript exempts hyphen-containing JSX attributes from excess-property checking. So
 * `<Card data-testid="x">` type-checks against ANY component — including one that has never heard
 * of the attribute — and then goes NOWHERE. There is no compile error, no runtime warning, and the
 * screen renders perfectly; the only thing that ever says so is a test looking for the hook, and
 * only if one exists.
 *
 * THAT DEFECT HAS NOW BEEN FOUND FIVE TIMES IN THIS BATCH, each time on a different component and
 * each time by something other than the compiler:
 *
 *   1. `Tr`, `EmptyState`, `Note` — three hooks `self-approval-report.spec.ts` reads, killed with
 *      `tsc` clean and that screen's own spec still green, because it happens not to use them.
 *   2. `Badge` — `/claims` hangs `data-claim-status` on its status pill.
 *   3. `Td` — `/screening-health` hangs `data-operational` on a cell.
 *   4. `ErrorState` — `/insurer-directory` hangs `data-line-error` on a refusal.
 *   5. `Card` — `/retention-disposal` hangs `data-testid` on a section.
 *
 * NAMING `data-testid` WAS THE FIRST FIX AND IT WAS ONE NAME SHORT EVERY TIME. Every screen uses
 * its own attribute, so a list of names is always missing the next one. The template-literal index
 * signature accepts the whole family, and spreading it onto the root element makes the support a
 * property of the SIGNATURE rather than something a reader has to go and verify in the body.
 *
 * `apps/web/test/data-attributes.test.ts` refuses a component in this directory that does not
 * forward, so a sixth cannot ship.
 */
export type DataAttributes = { [key: `data-${string}`]: string | undefined };
