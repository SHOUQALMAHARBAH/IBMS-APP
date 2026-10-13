/**
 * The permissions that put their holder on the CHECKER side of a maker/checker
 * pair.
 *
 * Derived from the table in `ibms-brain/meta/lex/maker-checker-segregation.md`
 * and the pair list in `common/maker-checker.util.ts` — one code per pair whose
 * checker half this system actually enforces:
 *
 *   | Entity                    | Checker half                    | Permission                      |
 *   |---------------------------|---------------------------------|---------------------------------|
 *   | PolicyChecking            | checkedByUserId                 | policy.check                    |
 *   | KYCRecord                 | approvedByUserId                | kyc.approve                     |
 *   | Refund                    | approvedByUserId                | refund.approve                  |
 *   | Settlement                | secondApproverUserId            | claim.settle.second-approve     |
 *   | CommissionLedgerEntry     | overrideApprovedByUserId        | commission-override.approve     |
 *   | Recommendation            | approvedByUserId                | recommendation.approve          |
 *   | Complaint                 | closureApprovedByUserId         | complaint.close                 |
 *   | DisposalBatch             | dpoApprovedByUserId             | retention.dispose.approve       |
 *   | DataSharingApproval       | approvedByUserId                | data-sharing.approve            |
 *   | DataProcessingAgreement   | dpoApprovedByUserId             | dpa.approve                     |
 *   | DataSubjectRequest        | closed by a second DPO officer  | dsr.close                       |
 *   | IncidentReport            | seniorManagementCoSignUserId    | incident.classification.co-sign |
 *   | AccessRecertificationItem | reviewerUserId                  | access-recertification.review   |
 *
 * ## Why this is permissions now and not role names
 *
 * Until Phase 2 this was six role NAMES. Office-scoped custom roles made a name
 * meaningful only inside one office, so a role an office defines — "Reviewer",
 * say, holding `policy.check` — could be granted with no signal at all. The
 * detective control would have gone quiet exactly when offices started building
 * their own roles.
 *
 * Keyed on permissions, the six legacy roles still trigger for the same reasons
 * they did before, and nothing else among the eleven starts triggering:
 * `checker-roles.config.spec.ts` asserts that scope is unchanged.
 *
 * ## The control this is a detective for
 *
 * `assertDifferentActors` enforces maker != checker on ONE identity. It cannot
 * see that one human holds two identities. A `user.manage` holder can provision
 * a second account carrying the other half of any pair above and then work both
 * sides single-handed, with no dual control and nothing in the system that looks
 * unusual.
 *
 * That is not a gap in the lex — the lex is explicit that "admin consoles and
 * back-office override tools" are NOT exempt from maker/checker. It is a gap in
 * what the system can SEE.
 *
 * This module deliberately does NOT block the grant, and re-keying it must not
 * change that. Blocking would invent a dual-control policy for provisioning that
 * the business has not agreed to, and would be the wrong call to make
 * unilaterally on a regulated control. What it does instead is make the grant
 * impossible to make quietly: a distinct, queryable audit row plus a log line
 * Compliance can alert on. A detective control is a real control; a silent one
 * is not.
 */
export const CHECKER_PERMISSIONS: readonly string[] = [
  'policy.check',
  'kyc.approve',
  'refund.approve',
  'claim.settle.second-approve',
  'commission-override.approve',
  'recommendation.approve',
  'complaint.close',
  'retention.dispose.approve',
  'data-sharing.approve',
  'dpa.approve',
  'dsr.close',
  'incident.classification.co-sign',
  'access-recertification.review',
  /*
   * FOUND 2026-10-13, and the way it was found is the point.
   *
   * This code is the checker half of a registered maker/checker pair on `NeedsAssessment`, and it
   * was missing here — so a role holding it ALONGSIDE the maker code was never reported by the
   * duty-segregation readiness signal. The pair's database CHECK still refused a silent
   * self-approval; what was absent was the DETECTION that an office had granted one role both
   * halves, which is the whole purpose of this list.
   *
   * The spec's own comment had said for months: "a pair added to `maker-checker.util.ts` without a
   * code here is a pair whose checker half can be handed out silently." It was right, and the test
   * beneath it could not see it, because that test asserted `toHaveLength(13)` — a hardcoded count,
   * satisfied by any thirteen strings. It now derives the expected number from
   * `MAKER_CHECKER_REGISTRY`, and derived, it failed immediately: `expected 13 to be 14`.
   */
  'needs-assessment.approve',
];

/** One role being granted, with what it actually grants. The caller resolves the
 *  codes (`PermissionsService.getCodesForRoles`), so this module stays pure and
 *  has no dependency on the permission cache. */
export interface GrantedRole {
  name: string;
  permissions: ReadonlySet<string>;
}

/** Every checker permission this role carries, in the catalogue's order so the
 *  result is stable regardless of set iteration order. */
export function checkerPermissionsIn(
  permissions: ReadonlySet<string>,
): string[] {
  return CHECKER_PERMISSIONS.filter((code) => permissions.has(code));
}

/** What the segregation-relevant audit row and log line say happened. */
export interface SegregationSignal {
  /** The granted roles that carry at least one checker permission, by name —
   *  what a human reads in the log line. A name is not an identity any more, but
   *  it is still what an administrator sees on screen. */
  checkerRoles: string[];
  /** WHY each of those roles triggered. The name alone is no longer enough to
   *  reconstruct that, since two offices may each define a "Reviewer" granting
   *  different things. */
  checkerPermissions: string[];
  /** The administrator granted a checker permission to THEMSELVES.
   *  Distinguished because it is the shape that needs no second account at all,
   *  and is the strongest single indicator of privilege escalation on this
   *  surface. */
  selfGrant: boolean;
}

export function segregationSignal(input: {
  roles: readonly GrantedRole[];
  subjectUserId: string;
  actorUserId: string;
}): SegregationSignal | null {
  const checkerRoles: string[] = [];
  const checkerPermissions = new Set<string>();
  for (const role of input.roles) {
    const codes = checkerPermissionsIn(role.permissions);
    if (codes.length === 0) continue;
    checkerRoles.push(role.name);
    for (const code of codes) checkerPermissions.add(code);
  }
  if (checkerRoles.length === 0) return null;

  return {
    checkerRoles,
    checkerPermissions: CHECKER_PERMISSIONS.filter((code) =>
      checkerPermissions.has(code),
    ),
    selfGrant: input.subjectUserId === input.actorUserId,
  };
}
