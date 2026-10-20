import { Injectable, Logger } from '@nestjs/common';
import type { LanguagePreference } from '@ibms/db';
import { OrgContextService } from '../../common/org-context/org-context.service';
import { PasswordResetTokenRepository } from '../../repositories/password-reset-token.repository';
import { TokenService } from '../auth/services/token.service';
import { OutboundEmailService } from '../email/outbound-email.service';
import type { EmailSendOutcome } from '../email/email-provider.types';

/**
 * DECISION 25 — THE INVITATION CHANNEL. The only door into a brand-new organization.
 *
 * ## THE MEASUREMENT THAT MADE THIS NECESSARY, AND THE CLAIM IT CORRECTED
 *
 * `office-administrator-invitation.service.ts` asserted in its own header that "NO EMAIL IS SENT.
 * There is no mail sender wired to anything in this product". BOTH HALVES WERE FALSE.
 * `apps/api/src/modules/email/` is fifteen files: a Microsoft 365 provider, a Google Workspace
 * provider, a registry, `OutboundEmailService`, a closed template set and a NotConfigured null
 * object; `/settings/email` exists and is linked on `email.integration.read`; and
 * `AuthService.forgotPassword` already sends the `password_reset` template through it today. That
 * comment is corrected in the same commit as this file.
 *
 * What IS true is narrower and worse: **the reset route cannot reach the first administrator of a
 * new organization.** `EmailProviderRegistry.resolve()` reads `integrations.find()` — the
 * integration of the organization IN TENANT CONTEXT — and `forgotPassword` adopts the user's own
 * organization before resolving. A freshly registered office has connected no mailbox, so it
 * resolves `NotConfiguredEmailProvider` and nothing is sent. The documented way in ("sign in by
 * requesting a password reset") is therefore unreachable for exactly the accounts that need it.
 *
 * ## SO THE SENDER IS THE PROVIDER'S MAILBOX, AND THAT IS A CALL-SITE PROPERTY
 *
 * The account is created inside `runAs(organizationId)`. A send placed inside that block resolves
 * the INVITED organization's (absent) mailbox and sends nothing. So:
 *
 *   * the TOKEN is written inside `runAs(organizationId)`, because `PasswordResetToken` carries
 *     `organizationId` and the row belongs to the invited user's organization;
 *   * the SEND happens after that block closes, in the PROVIDER's own context, which is also where
 *     both invitation services already write their audit row for the same reason.
 *
 * A test asserts the resolved `fromAddress` is the provider's connected address rather than
 * asserting where the call sits — a call site can move, an address cannot be mistaken.
 *
 * ## THE TOKEN IS THE PASSWORD-RESET TOKEN, REUSED RATHER THAN RE-INVENTED
 *
 * Measured against what decision 25 requires, `PasswordResetToken` already has every property:
 *
 *   * the raw value is never stored — only `tokenHash`;
 *   * it is never logged (`forgotPassword`'s own comment says so, and this file obeys the same
 *     rule — see `deliver`'s return, which is the ONLY place a raw value appears, behind the
 *     double gate);
 *   * single use is a STATUS-CONDITIONAL WRITE: `markUsed(id)` is an `updateMany` on
 *     `usedAt: null` returning a boolean, so two concurrent uses cannot both win and the loser
 *     gets `Invalid or expired reset token` — the SAME rejection an expired token gets, which is
 *     what stops the difference being an oracle;
 *   * expiry is enforced on read;
 *   * `invalidateAllForUser` is what makes re-inviting safe.
 *
 * A weaker sibling table would have been a second answer to "is this link still good", and the
 * copy is the one that drifts. So the invitation link lands on the SAME `/reset-password` screen,
 * and the only thing that differs is the message that carries it.
 *
 * ## AN UNSENT INVITATION IS NEVER REPORTED AS SENT
 *
 * `OutboundEmailService`'s own rule, and here it has teeth: if the PROVIDER has connected no
 * mailbox, the account WAS created and the invitation was NOT sent. `deliver` returns that outcome
 * verbatim and the route hands it to the screen, which names the fix. There is no console line
 * standing in for a delivery and NO FALLBACK to a shared or platform sender — sending from an
 * address the recipient does not recognise is the specific failure Part I §6 exists to prevent.
 */
@Injectable()
export class InvitationChannelService {
  private readonly logger = new Logger(InvitationChannelService.name);

  /**
   * Shorter than the password-reset TTL would be wrong and longer would be worse.
   *
   * A reset is requested by somebody sitting at the screen; an invitation is sent to somebody who
   * may not be at their desk, and the provider cannot see whether they opened it. Two hours is long
   * enough for a person to read their mail in an ordinary working day and short enough that a
   * forwarded message is not a standing key. Re-inviting always issues a fresh one, so the cost of
   * it expiring is one click.
   */
  static readonly INVITATION_TTL_MINUTES = 120;

  constructor(
    private readonly orgContext: OrgContextService,
    private readonly passwordResetTokens: PasswordResetTokenRepository,
    private readonly tokens: TokenService,
    private readonly outboundEmail: OutboundEmailService,
  ) {}

  /**
   * MUST BE CALLED FROM THE PROVIDER'S OWN CONTEXT, after the invited organization's `runAs` block
   * has closed. The token write re-enters that organization for itself; the send must not, or it
   * resolves a mailbox that does not exist.
   */
  async deliver(input: {
    organizationId: string;
    organizationName: string;
    userId: string;
    email: string;
    fullName: string;
    language: LanguagePreference;
    /** The provider operator doing the inviting — who the send is attributable to. */
    actorUserId: string;
  }): Promise<{
    outcome: EmailSendOutcome;
    fromAddress: string | null;
    /** Present ONLY under the existing dev gate. See the bottom of this method. */
    devInvitationToken?: string;
  }> {
    const token = this.tokens.issueOpaqueSecret();
    const expiresAt = new Date(
      Date.now() + InvitationChannelService.INVITATION_TTL_MINUTES * 60 * 1000,
    );

    /*
     * RE-INVITING THE SAME PERSON MUST WORK, and `invalidateAllForUser` is the whole of it: an
     * invitation that expired unused must not lock an organization out permanently, so a second
     * invitation issues a fresh token and kills the earlier one. It creates no second account and
     * no second role assignment, because the ROUTE refuses once the organization has any account —
     * so a re-invitation is a re-invitation of the same user row, by construction.
     */
    await this.orgContext.runAs(input.organizationId, async () => {
      await this.passwordResetTokens.invalidateAllForUser(input.userId);
      await this.passwordResetTokens.create({
        userId: input.userId,
        tokenHash: token.hash,
        expiresAt,
      });
    });

    /*
     * OUTSIDE the block above, deliberately — this is the line the whole design turns on. We are
     * back in the provider's context, so `resolve()` reads the PROVIDER's integration and the
     * message leaves the provider's own connected address.
     */
    const result = await this.outboundEmail.send({
      to: input.email,
      language: input.language,
      actorUserId: input.actorUserId,
      template: {
        kind: 'organization_administrator_invitation',
        params: {
          recipientName: input.fullName,
          organizationName: input.organizationName,
          setPasswordUrl: `${this.outboundEmail.appBaseUrl}/reset-password?token=${encodeURIComponent(token.raw)}`,
          expiresInMinutes: InvitationChannelService.INVITATION_TTL_MINUTES,
        },
      },
    });

    if (result.outcome !== 'SENT') {
      /*
       * Logged WITHOUT the token and WITHOUT the link. The outcome is what an administrator needs
       * in order to act; the link is the credential-equivalent and belongs only in the message.
       */
      this.logger.warn(
        `Invitation for ${input.email} in organization ${input.organizationId} was NOT sent (${result.outcome}). ` +
          'The account exists and the link was issued; connect the provider mailbox and re-invite.',
      );
    }

    /*
     * THE SAME DOUBLE GATE `forgotPassword` ALREADY USES, and not a second flag: the owner will
     * walk this locally with no OAuth application registered, so the raw token has to be reachable
     * somehow or the walk is impossible. `NODE_ENV !== 'production'` is a HARD OVERRIDE on top of
     * the flag rather than the primary gate, so a flag set in production by mistake still cannot
     * leak one.
     *
     * This is the ONLY place in this file where a raw token value appears, and it is never logged.
     */
    if (
      process.env.ENABLE_DEV_RESET_TOKEN === 'true' &&
      process.env.NODE_ENV !== 'production'
    ) {
      return {
        outcome: result.outcome,
        fromAddress: result.fromAddress ?? null,
        devInvitationToken: token.raw,
      };
    }
    return {
      outcome: result.outcome,
      fromAddress: result.fromAddress ?? null,
    };
  }
}
