import { DESTINATION_GROUPS, HOME } from '../../components/app/destinations';

/**
 * MODULE 0 ITEM (i) — WHICH GRANTS OPEN NO SCREEN.
 *
 * ## Why this lives in the web and not in the api
 *
 * The question is "does holding this permission open anything in the navigation", and the navigation
 * map is `components/app/destinations.ts` — a web artefact the api has never heard of. A warning
 * computed server-side would need a copy of that map, which is the second-home shape this repository
 * refuses: the copy is the one that drifts, and it would drift the first time a screen was added.
 *
 * ## Derived from the map at runtime, never listed
 *
 * `scripts/measurements/permission-reachability.py` answers the same question offline and found
 * TEN (role, code) pairs in the seeded grid with no nav route. A hand-kept list of those ten here
 * would be stale the moment a screen ships — and it was a hand-kept COUNT in that very script
 * (`491` against a real `502`) that stopped the measurement running at all, which is the defect item
 * (i) also asked to fix. So the reachable set is read from the map every time.
 *
 * ## It WARNS, and must never refuse
 *
 * A grant that opens no screen is often correct:
 *
 *   - the code gates a CONTROL on a screen reached by another permission (measured: 7 codes are read
 *     only by a component, never directly by a page),
 *   - or it is exercised by an integration rather than by a person,
 *   - or its screen is not built yet and the grant is deliberate.
 *
 * So the warning says what it knows — nothing in the navigation opens on this grant alone — and
 * leaves the judgement to the administrator. A refusal here would make an office unable to configure
 * a role for a capability this product genuinely has.
 */

/**
 * Every permission code that gates at least one navigation destination.
 *
 * Computed once per call rather than cached in a module constant: the map is a static import so the
 * answer cannot change at runtime, and a module-level constant computed at import time is the shape
 * that goes stale under hot reload while looking correct.
 */
export function codesWithANavRoute(): Set<string> {
  const out = new Set<string>();
  for (const group of DESTINATION_GROUPS) {
    for (const destination of group.items) {
      for (const code of destination.permissions ?? []) out.add(code);
    }
  }
  // `HOME` is a standalone destination outside the groups — the 81st `href:` in that file is the
  // TYPE declaration, not a destination, which is the correction recorded for item (a)'s Step 1
  // measurement. It carries no permissions today; reading it anyway means a future gate on it is
  // counted without anybody remembering this function exists.
  for (const code of HOME.permissions ?? []) out.add(code);
  return out;
}

/**
 * The subset of `codes` that opens no navigation destination.
 *
 * Order is preserved from the input, so a screen listing them shows them as the administrator ticked
 * them rather than in an order nobody chose.
 */
export function grantsWithNoNavRoute(codes: readonly string[]): string[] {
  const reachable = codesWithANavRoute();
  return codes.filter((code) => !reachable.has(code));
}
