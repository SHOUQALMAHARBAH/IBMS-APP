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
 *
 * Deliberately not applied to audit entries: those record what was stored, not
 * what a screen displayed, and rewriting them through a display rule would
 * make the trail disagree with the row it describes.
 */
export function resolveDisplayName(account: {
  fullName: string;
  employee?: { fullName: string } | null;
}): string {
  const official = account.employee?.fullName?.trim();
  return official && official.length > 0 ? official : account.fullName;
}
