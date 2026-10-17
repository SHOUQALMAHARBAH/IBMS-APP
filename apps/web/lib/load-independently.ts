/**
 * Load several independent lists, keep what resolved, and NAME what did not.
 *
 * ## WHY THIS EXISTS — a measured pattern, not two files
 *
 * The owner opened `/provider-register-office` and found eight empty dropdowns. The cause was one
 * `Promise.all` over two loaders, one of which 403s, inside a bare `catch`:
 *
 *     try {
 *       const [data, catalogue] = await Promise.all([getReferenceData(), listStandardInsuranceLines()]);
 *       setReference(data);
 *       setLines(catalogue);
 *     } catch {
 *       setLoadError(t('regOfficeLoadError'));
 *     }
 *
 * `Promise.all` rejects on the FIRST rejection and **discards every value that resolved**. So one
 * refused call threw away the seven reference lists that had arrived perfectly, and the form rendered
 * with nothing selectable in legal form, licensing authority, country, city, bank, currency, business
 * model or licensed branches — under one sentence that named none of them.
 *
 * Measured before writing this: **11 of the 13 screens that use `Promise.all` have that same discard
 * shape** (`scripts/measurements/all-or-nothing-loaders.py`). That makes it a rule rather than a
 * repair, which is why the fix is a shared loader with one home for the behaviour.
 *
 * ## THE TWO PROPERTIES, AND BOTH ARE LOAD-BEARING
 *
 * 1. **RENDER WHAT RESOLVED.** A refused list must not take down the lists that arrived. Eight empty
 *    pickers is worse than seven full ones and a sentence, because the first teaches a person the
 *    screen is broken and the second tells them which part is.
 *
 * 2. **NAME WHAT DID NOT.** Every entry carries a `label`, and the failure report names it. A generic
 *    "could not load" leaves somebody staring at the form with no idea which call refused — which is
 *    the half that cost the owner her session, not the refusal itself.
 *
 * ## IT DOES NOT DECIDE WHAT A SCREEN DOES WITH A PARTIAL LOAD
 *
 * Deliberately. A form whose ONE list failed may still be usable; a form whose every list failed is
 * not; and a screen that needs all of them to mean anything should say so in its own words. So this
 * returns the results and the failures and renders nothing itself — the alternative is a loader that
 * decides a screen's empty state from one layer away, which is how a shared helper starts making
 * product decisions nobody reviewed.
 */

export interface IndependentLoad<T> {
  /** What this list IS, in the reader's language — it goes into the sentence a person reads. */
  label: string;
  /** A stable key for the screen to look its result up by. */
  key: string;
  load: () => Promise<T>;
}

export interface IndependentLoadFailure {
  key: string;
  label: string;
  error: unknown;
}

export interface IndependentLoadResult {
  /** Keyed by `key`, holding only what resolved. A key absent here is a key that failed. */
  values: Record<string, unknown>;
  /** Empty when everything resolved. */
  failures: IndependentLoadFailure[];
}

/**
 * `Promise.allSettled`, not `all` — that single word is the whole mechanism, and the reason this
 * helper can exist at all.
 */
export async function loadIndependently(
  loads: readonly IndependentLoad<unknown>[],
): Promise<IndependentLoadResult> {
  const settled = await Promise.allSettled(loads.map((l) => l.load()));
  const values: Record<string, unknown> = {};
  const failures: IndependentLoadFailure[] = [];
  settled.forEach((outcome, i) => {
    const entry = loads[i];
    if (outcome.status === 'fulfilled') {
      values[entry.key] = outcome.value;
    } else {
      failures.push({
        key: entry.key,
        label: entry.label,
        error: outcome.reason,
      });
    }
  });
  return { values, failures };
}

/**
 * The sentence a person reads when some lists did not arrive.
 *
 * It NAMES them. `join` rather than one line per failure because a form with three refused lists
 * should read as one problem with three parts, not three problems — and because a screen that stacks
 * three alerts above a form pushes the form off the first screenful.
 *
 * The caller supplies the frame so the wording stays in the dictionary and in both languages; this
 * only assembles the list of names, which is the part that cannot live in a static string.
 */
export function namedFailures(
  failures: readonly IndependentLoadFailure[],
): string {
  return failures.map((f) => f.label).join(' · ');
}
