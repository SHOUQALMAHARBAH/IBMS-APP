import type { CSSProperties, ReactNode } from 'react';

/*
 * What an act is DOING, and what it DID. One home for both.
 *
 * ## WHY THIS EXISTS — the owner pressed buttons and concluded they were broken
 *
 * On her walk she wrote, of `/watchlist-sync`: «الأزرار الي فيها مش شغالة، بضغط
 * عليها ما بيظهر الي اشي» — the buttons do not work, I press them and nothing
 * appears. And of `/customers/kyc-queue`: «الموظف رح يشعر بالضياع لأن فش اشي
 * بيظهر اله ولا كأنه عمل اشي» — the employee will feel lost, because nothing
 * appears to him, as though he had done nothing.
 *
 * Both acts RAN. Measured: `runWatchlistSync` fetches `treasury.gov` and
 * `scsanctions.un.org` with a 120-second timeout and two retries per source
 * (`watchlist-fetchers.ts#downloadOptions`), so the button can legitimately be
 * in flight for **about six minutes** — and the only thing on screen that
 * changed was `disabled`. `KycQueue.run()` reloads the row and the screening
 * hold, so a cell three columns over changes and nothing says why.
 *
 * So the defect is not the act. It is that a screen which says nothing is
 * indistinguishable from a screen that is broken, and the reasonable
 * conclusion — the one she drew — is the wrong one.
 *
 * ## MEASURED, BECAUSE HER THREE SCREENS ARE A SAMPLE
 *
 * `scripts/measurements/silent-acts.py`: of the 86 files that gate a control on
 * a busy flag, **52 render no pending text at all**, and **41 run an act whose
 * only outcome is a reload or a parent callback** — a cell changes somewhere and
 * nothing states what happened. Six more screens she reported under OTHER
 * headings (`/complaints`, `/service-requests`, `/internal-audit-findings`,
 * `/transaction-monitoring`, `/retention-disposal`, `/incidents`) are in that
 * second list, which is the reason this is a component and not three edits.
 *
 * ## THE THREE STATES ARE NOT INTERCHANGEABLE
 *
 * 1. `pending` — the act is in flight. `role="status"`, so it is announced
 *    politely rather than interrupting. Without this a slow act is a dead
 *    button; with it, a six-minute wait is at least a wait.
 * 2. `outcome` — the act finished and this is WHAT IT DID. Never the bare word
 *    "done": a success line that says nothing is the silence it replaced with
 *    extra steps. Name the state the record is now in, or the figures the act
 *    produced.
 * 3. `error` — `role="alert"`, assertive, and a sibling rather than a tone on
 *    the other two, for `EmptyState`/`ErrorState`'s own stated reason: an
 *    error is not a quieter kind of success and conflating them is how a
 *    failure gets rendered in the colour of a confirmation.
 *
 * Precedence is pending > error > outcome. While an act is in flight the
 * PREVIOUS act's error must not still be on screen claiming to describe it.
 *
 * ## WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It does not own the state. 86 files already hold their own `busy`/`error`,
 * and `KycQueue` holds them PER ROW while `/watchlist-sync` holds them per
 * screen — one hook cannot be both without a shape that fits neither. What
 * must not drift across 86 sites is the ARIA roles, the precedence and the
 * tone, and that is all this owns.
 *
 * It also mounts the live region only when there is something to say, matching
 * what every existing screen here does. A permanently-mounted empty region
 * announces slightly more reliably in some screen readers; deviating from 93
 * sibling call sites to buy that is the worse trade, and the difference is
 * recorded here rather than discovered later.
 *
 * The PENDING LABEL is not this component's business either: `busy ?
 * t('commonWorking') : t('…')` on the button is already this repo's own
 * pattern (`insurance-programs/[id]`, `insurers/[id]`, `operational-pi-risk`,
 * `retention-disposal`), and both words ship in both languages. Screens
 * missing it are not missing a mechanism, they are missing the convention.
 */

const LINE: CSSProperties = {
  margin: 'var(--space-2) 0 0',
  fontSize: 'var(--text-base)',
};

export function ActionStatus({
  pending,
  outcome,
  error,
  testId,
  style,
}: {
  /** The act is in flight. Outranks both of the others. */
  pending?: ReactNode;
  /** What the act DID — the resulting state or figures, never "done". */
  outcome?: ReactNode;
  /** Why it failed, in the employee's own terms. */
  error?: ReactNode;
  testId?: string;
  style?: CSSProperties;
}) {
  if (pending) {
    return (
      <p
        role="status"
        data-testid={testId ? `${testId}-pending` : undefined}
        style={{ ...LINE, color: 'var(--ink-secondary)', ...style }}
      >
        {pending}
      </p>
    );
  }
  if (error) {
    return (
      <p
        role="alert"
        data-testid={testId ? `${testId}-error` : undefined}
        style={{ ...LINE, color: 'var(--danger-ink)', ...style }}
      >
        {error}
      </p>
    );
  }
  if (outcome) {
    return (
      <p
        role="status"
        data-testid={testId ? `${testId}-outcome` : undefined}
        style={{ ...LINE, color: 'var(--ink-secondary)', ...style }}
      >
        {outcome}
      </p>
    );
  }
  return null;
}
