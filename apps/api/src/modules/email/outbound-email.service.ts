import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { LanguagePreference } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import { EmailProviderRegistry } from './email-provider.registry';
import { OrganizationEmailIntegrationRepository } from '../../repositories/organization-email-integration.repository';
import {
  renderNotification,
  type NotificationTemplate,
} from './email-templates';
import type { EmailSendResult } from './email-provider.types';

export interface SendNotificationInput {
  to: string;
  language: LanguagePreference;
  template: NotificationTemplate;
  /** Who the send is attributable to. For a pre-authentication flow such as
   * password reset this is the account the message is about — the send happens
   * on their behalf, and the audit trail should say so. */
  actorUserId: string;
}

/**
 * Part I §6 — the single outbound path.
 *
 * Nothing else in this system calls a mail provider. Every message goes from
 * the Organization in context, through that office's own connected mailbox,
 * rendered from a reviewed template rather than from caller-supplied text.
 *
 * ## The rule
 *
 * **A message that was not sent is never reported as sent.** The return value
 * carries the real outcome, an unsuccessful one is recorded on the integration
 * row where an administrator will see it, and the audit entry records what
 * actually happened. A caller that ignores the result is choosing to, rather
 * than being misled by a `void`.
 *
 * ## What the audit entry does and does not contain
 *
 * It records the recipient, the template kind and the outcome — enough to
 * answer "was this person notified, and when". It does NOT record the rendered
 * body: a notification subject can itself identify a customer, and the body may
 * carry a single-use reset link that must not survive in a log
 * (`ibms-brain/meta/lex/sensitive-data-handling.md`).
 */
@Injectable()
export class OutboundEmailService {
  private readonly logger = new Logger(OutboundEmailService.name);

  constructor(
    private readonly registry: EmailProviderRegistry,
    private readonly integrations: OrganizationEmailIntegrationRepository,
    private readonly audit: AuditService,
  ) {}

  /** The deployment base URL, so callers build deep links consistently. */
  get appBaseUrl(): string {
    return this.registry.appBaseUrl;
  }

  async send(input: SendNotificationInput): Promise<EmailSendResult> {
    const correlationId = randomUUID();
    const { provider, integration } = await this.registry.resolve(
      input.actorUserId,
    );
    const rendered = renderNotification(input.template, input.language);

    const result = await provider.send(
      { to: [input.to], ...rendered },
      correlationId,
    );

    if (integration) {
      // Recorded even on success, so "the mailbox last worked at" is a real
      // answer rather than an inference from the absence of errors.
      const rows = await this.integrations.recordOutcome(
        integration.id,
        result.outcome === 'SENT'
          ? { ok: true }
          : {
              ok: false,
              // A rejected credential is a different instruction to the
              // administrator than a transient failure: one needs the mailbox
              // reconnected, the other needs nothing.
              status:
                result.outcome === 'CREDENTIAL_REJECTED' ? 'ERROR' : 'ACTIVE',
              error: result.detail ?? result.outcome,
            },
      );
      if (rows === 0) {
        // Part V item 6: a status write that matched nothing means the row was
        // not visible to this session, which is a scoping fault, not a no-op.
        this.logger.error(
          `Email send outcome for integration ${integration.id} updated zero rows — the row was not visible to this session.`,
        );
      }
    }

    await this.audit.record({
      userId: input.actorUserId,
      action: 'CREATE',
      entityType: 'OutboundEmail',
      entityId: correlationId,
      afterValue: {
        to: input.to,
        template: input.template.kind,
        language: input.language,
        outcome: result.outcome,
        fromAddress: result.fromAddress ?? null,
        // Deliberately no subject and no body — see the class comment.
      },
    });

    if (result.outcome !== 'SENT') {
      this.logger.warn(
        `Notification "${input.template.kind}" was NOT sent (${result.outcome}): ${result.detail ?? 'no detail'}`,
      );
    }
    return result;
  }
}
