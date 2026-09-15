import type { LanguagePreference } from '@ibms/db';
import type { OutboundMessage } from './email-provider.types';

/**
 * Part I §6 — the complete set of messages this platform may send.
 *
 * ## Why templates, and not a `body: string` parameter
 *
 * §6 requires that sensitive content — KYC documents, quotations with pricing,
 * policy documents — is NEVER placed in an email body: the message is a
 * notification carrying a link back into the platform, where access is
 * authenticated and audited. A `sendEmail(to, subject, body)` API makes
 * violating that a one-line mistake in any future module.
 *
 * A closed set of templates makes it a reviewable change to THIS file instead.
 * Nothing in the send path accepts free-form body text, and
 * `OutboundMessage` has no attachment field and no HTML field, so the common
 * violations are unrepresentable rather than merely discouraged.
 *
 * ## Language
 *
 * The platform's primary language is Arabic; English is the secondary. Each
 * template renders in the recipient's own `languagePreference`, Arabic by
 * default (it is the schema default for `User` too), and every template must
 * supply both — a missing Arabic body would leave the main audience reading
 * English, which is the wrong way round for this system.
 */

export interface PasswordResetParams {
  recipientName: string;
  resetUrl: string;
  expiresInMinutes: number;
}

export interface MailboxTestParams {
  organizationName: string;
  connectedEmail: string;
}

/** Every message kind the platform can send. */
export type NotificationTemplate =
  | { kind: 'password_reset'; params: PasswordResetParams }
  | { kind: 'mailbox_test'; params: MailboxTestParams };

export type NotificationKind = NotificationTemplate['kind'];

function passwordReset(
  p: PasswordResetParams,
  language: LanguagePreference,
): Omit<OutboundMessage, 'to'> {
  if (language === 'EN') {
    return {
      subject: 'Reset your IBMS password',
      bodyText: [
        `Hello ${p.recipientName},`,
        '',
        'A password reset was requested for your account. Open the link below to choose a new password:',
        '',
        p.resetUrl,
        '',
        `The link stops working after ${p.expiresInMinutes} minutes.`,
        'If you did not request this, you can ignore this message — your password has not changed.',
      ].join('\n'),
    };
  }
  return {
    subject: 'إعادة تعيين كلمة المرور — نظام إدارة الوساطة التأمينية',
    bodyText: [
      `مرحباً ${p.recipientName}،`,
      '',
      'تم طلب إعادة تعيين كلمة المرور لحسابك. افتح الرابط التالي لاختيار كلمة مرور جديدة:',
      '',
      p.resetUrl,
      '',
      `ينتهي عمل الرابط بعد ${p.expiresInMinutes} دقيقة.`,
      'إذا لم تكن أنت من طلب ذلك، يمكنك تجاهل هذه الرسالة — لم تتغيّر كلمة المرور.',
    ].join('\n'),
  };
}

function mailboxTest(
  p: MailboxTestParams,
  language: LanguagePreference,
): Omit<OutboundMessage, 'to'> {
  if (language === 'EN') {
    return {
      subject: 'IBMS mailbox connection test',
      bodyText: [
        `This is a test message from IBMS for ${p.organizationName}.`,
        '',
        `It was sent from your own connected mailbox, ${p.connectedEmail}.`,
        'Receiving it confirms the connection works and that outbound mail will',
        "show your office's address as the sender.",
      ].join('\n'),
    };
  }
  return {
    subject: 'اختبار الاتصال ببريد المكتب — نظام إدارة الوساطة التأمينية',
    bodyText: [
      `هذه رسالة اختبار من النظام لمكتب ${p.organizationName}.`,
      '',
      `أُرسلت من صندوق بريد المكتب نفسه: ${p.connectedEmail}.`,
      'وصولها يؤكد نجاح الاتصال وأن الرسائل الصادرة ستظهر باسم عنوان مكتبكم.',
    ].join('\n'),
  };
}

export function renderNotification(
  template: NotificationTemplate,
  language: LanguagePreference,
): Omit<OutboundMessage, 'to'> {
  switch (template.kind) {
    case 'password_reset':
      return passwordReset(template.params, language);
    case 'mailbox_test':
      return mailboxTest(template.params, language);
  }
}
