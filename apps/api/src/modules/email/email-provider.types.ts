import type { EmailProviderKind } from '@ibms/db';

/**
 * Part I §6 — the outbound email contract.
 *
 * The governing rule, and the reason this file exists at all: **a message that
 * was not sent is never reported as sent.** It is the same rule Part B applies
 * to screening ("a screening that did not happen is never reported as a clear
 * one"), for the same reason — silence about a failure is worse than the
 * failure. A password-reset mail that quietly vanished looks identical, from
 * inside this system, to one the recipient simply ignored.
 */

/** Only `SENT` means the provider accepted the message. */
export type EmailSendOutcome =
  /** The provider accepted it for delivery. */
  | 'SENT'
  /** The office has connected no mailbox, so there is nothing to send from. */
  | 'NOT_CONFIGURED'
  /** A mailbox is connected but the provider rejected the credential —
   * consent withdrawn, mailbox deleted, token invalidated at their end. */
  | 'CREDENTIAL_REJECTED'
  /** Reached the provider, but it refused or failed the send. */
  | 'SEND_FAILED';

export interface EmailSendResult {
  outcome: EmailSendOutcome;
  /** The address the message actually left from — the office's own mailbox,
   * never a platform address. Absent when nothing was sent. */
  fromAddress?: string;
  /** The provider's own id for the message, for tracing a delivery complaint
   * back to their logs. */
  providerMessageId?: string;
  /** Human-readable, safe to log and to store on the integration row. Never
   * contains a token or a message body. */
  detail?: string;
}

/**
 * What may be sent.
 *
 * Deliberately narrow. §6 requires that sensitive content — KYC documents,
 * quotations with pricing, policy documents — is NEVER placed in the body: the
 * message is a notification carrying a link back into the platform, where
 * access is authenticated and audited. A contract with no attachment field and
 * no HTML body makes the common violation impossible to express, rather than
 * relying on every caller to remember.
 */
export interface OutboundMessage {
  to: string[];
  subject: string;
  /** Plain text only. */
  bodyText: string;
}

export interface EmailProviderHealth {
  kind: EmailProviderKind | 'not_configured';
  /** Whether this office can actually send right now. */
  operational: boolean;
  fromAddress: string | null;
  detail: string;
}

export interface EmailProvider {
  readonly kind: EmailProviderKind | 'not_configured';
  /** The mailbox messages leave from, or null when none is connected. */
  readonly fromAddress: string | null;
  send(
    message: OutboundMessage,
    correlationId: string,
  ): Promise<EmailSendResult>;
  /** Proves the stored credential still works, without sending to a third
   * party. Used by the administrator-facing connection test. */
  verify(correlationId: string): Promise<EmailProviderHealth>;
}
