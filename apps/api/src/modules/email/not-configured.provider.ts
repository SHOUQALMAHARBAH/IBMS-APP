import type {
  EmailProvider,
  EmailProviderHealth,
  EmailSendResult,
} from './email-provider.types';

/**
 * Part I §6 — the null object for an office that has connected no mailbox.
 *
 * It reports `NOT_CONFIGURED`. It does not throw, and — the part that matters —
 * it does not pretend. There is deliberately **no fallback to a shared platform
 * mailbox**, for the same reason the screening registry refuses to fall back to
 * the built-in watchlist when an external provider is misconfigured: a
 * fallback makes a misconfiguration invisible, and here it would also send mail
 * from an address the recipient has never heard of, which is exactly what §6
 * exists to prevent.
 *
 * The caller's job is to treat this as the failure it is. `OutboundEmailService`
 * records it and surfaces it; nothing reports the message as sent.
 */
export class NotConfiguredEmailProvider implements EmailProvider {
  readonly kind = 'not_configured' as const;
  readonly fromAddress = null;

  private readonly reason =
    'This office has not connected a mailbox, so no message can be sent from its own address. ' +
    'Connect one under Settings → Email integration.';

  send(): Promise<EmailSendResult> {
    return Promise.resolve({
      outcome: 'NOT_CONFIGURED',
      detail: this.reason,
    });
  }

  verify(): Promise<EmailProviderHealth> {
    return Promise.resolve({
      kind: this.kind,
      operational: false,
      fromAddress: null,
      detail: this.reason,
    });
  }
}
