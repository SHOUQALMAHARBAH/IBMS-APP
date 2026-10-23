/**
 * The name to SHOW for an account.
 *
 * Two names exist per person and they are not interchangeable. `User.fullName`
 * is free text, typed once at signup or provisioning. `Employee.fullName` is
 * derived server-side by `composeFullName()` from the four parts the Jordanian
 * national-ID convention uses (given / father / grandfather / family) and
 * cannot be supplied directly — see the DTOs, which refuse it.
 *
 * So the HR record is the real identity wherever one is linked, and
 * `User.fullName` is the fallback for an account that has none. Before the
 * link had a writer at all, every account was in that fallback state; in the
 * demo data all sixteen linked accounts DISAGREED, with the user row holding
 * an English role label and the employee row holding the actual person.
 * RE-MEASURED 2026-10-23: dev now holds 18 linked accounts and ALL 18 still
 * disagree, and db-test holds 25 of which 23 do. The figure moved; the claim
 * did not, and it is corrected here rather than quietly left at sixteen.
 *
 * ## THE ONE PLACE THAT ANSWERS "WHO DID THIS" IS `UserRepository` — decision 48
 *
 * This file holds the RULE and nothing else. The one place that APPLIES it to
 * a register is `UserRepository.displayNamesForUserIds` (and its single-id
 * sibling), which takes IDS rather than a relation — measured, 96 of this
 * schema's 115 `*UserId` columns have no `User` relation at all, so an
 * include-based resolver could not serve them. Eleven call sites were reading
 * raw `User.fullName` and bypassing this rule, including both registers built
 * to hold a person accountable and the self-approval report; all eleven go
 * through the resolver now.
 *
 * Never restate the rule at a call site. One of the eleven had already done
 * exactly that, with a comment saying it "deliberately mirrors rather than
 * re-decides" — and a mirror is a copy that can stop mirroring.
 *
 * ## THE BOUNDARY, IN BOTH DIRECTIONS
 *
 *   a register answering "who did this, for a human to read"  ->  the resolver
 *   an audit-trail row                                        ->  raw, as stored
 *
 * Deliberately not applied to audit entries: those record what was stored, not
 * what a screen displayed, and rewriting them through a display rule would
 * make the trail disagree with the row it describes — and would make a
 * historical entry change its answer whenever an HR record is corrected.
 *
 * BOTH SIDES ARE PINNED BY ONE TEST, because one assertion only pins half of a
 * boundary: `conflict-of-interest.e2e-spec.ts`'s "a register names the HR
 * record and the audit trail keeps the stored name" drives a LINKED account
 * whose two names differ and asserts each side, and the two committed plants
 * in `scripts/plants/display-name-boundary.json` break one half each.
 */
export function resolveDisplayName(account: {
  fullName: string;
  employee?: { fullName: string } | null;
}): string {
  const official = account.employee?.fullName?.trim();
  return official && official.length > 0 ? official : account.fullName;
}
