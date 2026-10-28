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

/**
 * DECISION 25 — the invitation that is the ONLY DOOR into a brand-new organization.
 *
 * ## One kind for both routes, because it is one act
 *
 * The office route and the insurance-company route are separate because their permission codes and
 * their refusals are separate. The MESSAGE is not: "you have been given the first account in this
 * organization, here is how to set your password". The organization's name is a parameter, so the
 * two share this kind rather than drifting into two wordings of one sentence.
 *
 * ## Why this message is load-bearing rather than a courtesy
 *
 * The invited account is created with a `randomBytes(32)` hash nobody holds, so the documented way
 * in is a password reset. MEASURED: `forgotPassword` resolves the mailbox of the organization in
 * context, and a freshly registered office has connected none — so it resolves
 * `NotConfiguredEmailProvider` and sends nothing. The reset route therefore cannot reach the first
 * administrator of any new office. This message, sent from the PROVIDER's own mailbox at the moment
 * of invitation, is the only route into that organization that exists.
 *
 * ## What the body carries, and what it may never carry
 *
 * The link and the expiry. Not a password — there is none to send, and the owner's rule is that
 * nobody handles a credential. Not the token as readable text beside the link, because a token
 * printed as text is a token somebody forwards. `OutboundMessage` has no attachment field and no
 * HTML field and must keep neither.
 */
export interface OrganizationInvitationParams {
  recipientName: string;
  /** The organization the account was created in — the office or the insurance company. */
  organizationName: string;
  setPasswordUrl: string;
  expiresInMinutes: number;
}

/** Every message kind the platform can send. */
export type NotificationTemplate =
  | { kind: 'password_reset'; params: PasswordResetParams }
  | { kind: 'mailbox_test'; params: MailboxTestParams }
  | {
      kind: 'organization_administrator_invitation';
      params: OrganizationInvitationParams;
    };

export type NotificationKind = NotificationTemplate['kind'];

function passwordReset(
  p: PasswordResetParams,
  language: LanguagePreference,
): Omit<OutboundMessage, 'to'> {
  if (language === 'EN') {
    return {
      subject: 'Reset your WASEET 360 password',
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
      subject: 'WASEET 360 mailbox connection test',
      bodyText: [
        `This is a test message from WASEET 360 for ${p.organizationName}.`,
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

function organizationAdministratorInvitation(
  p: OrganizationInvitationParams,
  language: LanguagePreference,
): Omit<OutboundMessage, 'to'> {
  if (language === 'EN') {
    return {
      subject: `You have been given the first account for ${p.organizationName} on WASEET 360`,
      bodyText: [
        `Hello ${p.recipientName},`,
        '',
        `An account has been created for you as the first administrator of ${p.organizationName}.`,
        '',
        'No password was set for it, and nobody has one to give you. Open the link below to choose',
        'your own:',
        '',
        p.setPasswordUrl,
        '',
        `The link stops working after ${p.expiresInMinutes} minutes. If it expires, ask whoever`,
        'invited you to send another — a new link can always be issued.',
      ].join('\n'),
    };
  }
  return {
    subject: `حساب الإدارة الأول لـ ${p.organizationName} — نظام إدارة الوساطة التأمينية`,
    bodyText: [
      `مرحباً ${p.recipientName}،`,
      '',
      `أُنشئ لك حساب كأول مسؤول إداري لـ ${p.organizationName}.`,
      '',
      'لم تُحدَّد له كلمة مرور، ولا يملك أحدٌ كلمةً يعطيك إيّاها. افتح الرابط التالي لاختيار كلمة',
      'المرور الخاصة بك:',
      '',
      p.setPasswordUrl,
      '',
      `ينتهي عمل الرابط بعد ${p.expiresInMinutes} دقيقة. وإذا انتهى، اطلب من الذي دعاك إرسال رابط`,
      'جديد — يمكن إصدار رابط آخر في أي وقت.',
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
    case 'organization_administrator_invitation':
      return organizationAdministratorInvitation(template.params, language);
  }
}
