import { ConflictException } from '@nestjs/common';

/**
 * REFUSAL 3, AND THE ONE OPENING IN IT — the lockout cure, in ONE place for both invite routes.
 *
 * ## THE LOCKOUT THIS EXISTS TO CURE, spelled out because it is worse than "an expired link"
 *
 *   * The invitation token lives 120 minutes. The invited person opens their mail the next
 *     morning: the link is dead.
 *   * They try forgot-password. `AuthService.forgotPassword` adopts THEIR organization before
 *     resolving the mailbox, their organization has connected none, so `NotConfiguredEmailProvider`
 *     returns and nothing is sent.
 *   * The provider re-invites: refusal 3 answers 409.
 *   * The organization is permanently unreachable, and no screen in this product cures it.
 *
 * And the likelier trigger is not delay but a MISTYPED ADDRESS: the account is created on an
 * address that does not exist, and the organization is dead from the moment it was registered. The
 * dev gate hides all of it — a local walk gets the raw token back and never meets the expiry.
 *
 * ## THE DECISION, AND WHAT IT DELIBERATELY DOES NOT TOUCH
 *
 * Refusal 3 exists so the provider does not become a standing capability to add accounts to a LIVE
 * organization. An organization NO HUMAN HAS EVER ENTERED is not live — it is a registration that
 * did not complete. So that one case re-opens, to the same address or a corrected one, and
 * everything else refuses exactly as before with the same message.
 *
 * ## "NEVER ENTERED" IS TWO STORED FACTS, AND NEITHER IS `mustChangePassword`
 *
 * MEASURED before anything was keyed on it.
 *
 * `User.lastLoginAt` — one write (`UserRepository.recordSuccessfulLogin`), one caller
 * (`AuthService.issueSession`). So it is set on SESSION CREATION, not on password proof: the
 * `mustChangePassword` gate and the MFA challenge both return BEFORE `issueSession`, so somebody
 * who proved a password and then failed MFA reads as NOT entered. That is the failure direction the
 * design was worried about, and it does not occur.
 *
 * `User.passwordUpdatedAt` — nullable with NO default (measured off the database, not the schema
 * file). The invitation services create their account through `tx.user.create` and do not write it,
 * so it is null for an invited account; `UserRepository.updatePassword`, which is what
 * `resetPassword` calls, writes it the instant the link is used. It closes a window
 * `lastLoginAt` alone leaves open: somebody who opens the link and sets a password but has not yet
 * signed in would otherwise read as never-entered, and a re-invitation to a CORRECTED address
 * would silently cost them the password they had just chosen — recoverable, but silent, and the
 * provider would have no way to know they had done it.
 *
 * An account provisioned through `POST /admin/users` gets `passwordUpdatedAt` at creation
 * (`UserRepository.provision`), and that is CORRECT for this purpose: an organization that has
 * provisioned accounts is live and is not the provider's to bootstrap.
 *
 * **NOT `mustChangePassword`.** `UserRepository.markOnboardingRequired(id)` sets it on ANY existing
 * account by id, so a condition keyed on that flag would open this route into a LIVE organization
 * whose administrator happens to be re-enrolling a second factor — the exact case refusal 3 exists
 * to prevent, reached through the cure for a different problem.
 *
 * ## THE CONDITION IS ABOUT THE ORGANIZATION, NOT THE INVITED ROW
 *
 * An organization where a SECOND person has signed in is live even if the first administrator never
 * did, and an opening keyed on the invited account alone would reach exactly that. So the count is
 * over every account in the organization.
 */

/** What the caller should do, having been told the organization is in a state that allows it. */
export type InvitationTarget =
  | { mode: 'CREATE' }
  /** Re-invite the account that is already there: no second account, no second role assignment. */
  | { mode: 'REINVITE'; userId: string };

/**
 * The minimum of the tenancy-scoped client this needs. Typed structurally rather than as
 * `Prisma.TransactionClient` so the two services can pass their own `tx` without this file
 * depending on either module.
 */
export interface InvitationTargetReader {
  user: {
    count: (args?: {
      where?: {
        OR?: {
          lastLoginAt?: { not: null };
          passwordUpdatedAt?: { not: null };
        }[];
      };
    }) => Promise<number>;
    findFirst: (args: {
      select: { id: true };
    }) => Promise<{ id: string } | null>;
  };
}

/**
 * MUST be called inside `runAs(organizationId)`: every count here is tenancy-scoped, which is what
 * makes `count({})` mean "in this organization" rather than "on the platform".
 *
 * @param organizationLabel how the refusal should name the organization, e.g. `Office <id>` —
 *   each route keeps its own wording, because the sentence a provider reads is what tells them this
 *   is not a capability they have rather than a transient failure to retry.
 */
export async function resolveInvitationTarget(
  tx: InvitationTargetReader,
  organizationLabel: string,
  selfAdministrationSentence: string,
): Promise<InvitationTarget> {
  const existing = await tx.user.count({});
  if (existing === 0) return { mode: 'CREATE' };

  const entered = await tx.user.count({
    where: {
      OR: [
        { lastLoginAt: { not: null } },
        { passwordUpdatedAt: { not: null } },
      ],
    },
  });

  if (entered > 0) {
    // REFUSAL 3, unchanged in meaning and in wording.
    throw new ConflictException(
      `${organizationLabel} already has ${existing} account(s), so it is not waiting for its FIRST administrator. ` +
        selfAdministrationSentence +
        ' This route bootstraps an empty organization once and deliberately does not become a standing provider capability to add accounts to a live one.',
    );
  }

  /*
   * NEVER ENTERED, so this is a registration that did not complete — but only ONE account may be
   * re-invited, and that is narrower than the decision strictly required.
   *
   * Two or more unentered accounts cannot be reconciled into "exactly one active account holding
   * exactly one role assignment", which is what the decision asks the state to be afterwards. A
   * route that picked one of them would be choosing which colleague keeps the organization, and
   * nothing here knows that. So it refuses and says what it found.
   */
  if (existing > 1) {
    throw new ConflictException(
      `${organizationLabel} has ${existing} account(s) and none of them has ever been used, which this route cannot reconcile: re-inviting may leave exactly one account with exactly one role, and choosing WHICH of several to keep is not a decision this route can make. ` +
        'Remove the accounts that should not exist, or add the person through POST /admin/users from inside the organization.',
    );
  }

  const already = await tx.user.findFirst({ select: { id: true } });
  if (!already) {
    // Unreachable: `existing === 1` was just counted on the same tenancy-scoped client. Loud
    // rather than silent, because a null here would mean the count and the read disagree.
    throw new ConflictException(
      `${organizationLabel} counted one account and then returned none — the count and the read disagree, which is a scoping fault rather than a state this route should guess at.`,
    );
  }
  return { mode: 'REINVITE', userId: already.id };
}
