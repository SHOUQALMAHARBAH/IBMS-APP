/**
 * Part II §4.1.2 vs §4.2.2 — the single answer to "which Department is this
 * person in?" when two columns can both hold one.
 *
 * `Employee.departmentId` (§4.1.2) is the org-chart record of a real person.
 * `User.departmentId` (§4.2.2) is what an administrator picked on the
 * provisioning form, which happens before an `Employee` row usually exists.
 * Both are legitimate, and both are nullable, so a caller reaching for either
 * column by hand will eventually reach for the wrong one.
 *
 * The rule: **the Employee record wins once it states a department.** A
 * person's functional grouping is a property of the person, not of their login
 * credential, and HR owns the org chart. The provisioning value is what stands
 * until an `Employee` row exists to overrule it.
 *
 * `EmployeeRepository.linkUser` keeps the two from silently diverging in the
 * first place (it copies the account's value down when the employee has none,
 * and refuses the link outright when both are set and disagree). This accessor
 * is the read-side half of the same rule: every consumer goes through it, so
 * no future caller has to remember which column to prefer.
 */
export interface DepartmentBearingUser {
  departmentId: string | null;
  /** The linked `Employee`, when the caller selected it. Absent (or null) for
   * an account with no employee record — the common case for a freshly
   * provisioned user. */
  employee?: { departmentId: string | null } | null;
}

export function effectiveDepartmentId(
  user: DepartmentBearingUser,
): string | null {
  // `??`, deliberately, not `||`: an Employee row whose own departmentId is
  // null has not "stated" a department, so it does not overrule the
  // provisioning value — it falls through to it.
  return user.employee?.departmentId ?? user.departmentId;
}
