import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * What the notification bell is allowed to tell each reader.
 *
 * The endpoint itself needs no permission — a notification centre that 403s
 * for most roles is not a notification centre. The CONTENT is what is gated,
 * and the rule is one line: **you are only notified about work you could
 * already open**. Each source below names the permission that guards its own
 * screen, and a reader without it simply does not get that source.
 *
 * That is deliberately stricter than "your role sounds relevant". A Sales
 * Officer holds no `aml.monitor`, so an AML alert never reaches their bell —
 * not even as a count, because a count of open AML alerts is itself a signal
 * about the book.
 */

/** A source of notifications, as the API describes it. The wording lives in
 *  the web dictionaries: this returns a stable `kind` and a number, never a
 *  sentence, so the same payload serves both languages. */
export interface NotificationItem {
  /** Stable key the web maps to a translation and an icon. */
  kind: NotificationKind;
  /** How many things of this kind need attention. Never zero — an empty
   *  source is omitted rather than reported as "0 things to do". */
  count: number;
  severity: 'action' | 'warning';
  /** Where the reader goes to act on it. A real screen that exists today. */
  href: string;
}

export const NOTIFICATION_KINDS = [
  'sla_overdue',
  'claim_followup',
  'aml_alert',
  'screening_match',
  'service_request_assigned',
  'customer_pending_kyc',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/**
 * The four SLA escalation targets that name a real `RoleName`.
 *
 * `SlaTimer.escalatedTo` is free text. `GENERAL_MANAGER`, `IT_MANAGEMENT`,
 * `CUSTOMER_RETENTION` and `DPO_AND_LEGAL_COUNSEL` name functions this system
 * has no RBAC role for, so a timer escalated to one of them cannot be
 * delivered to anybody — see README § Known gaps. Rather than guess a
 * recipient, those timers are shown to nobody through the bell; they remain
 * visible on the SLA dashboard, which is book-wide.
 */
export const SLA_ESCALATION_ROLES = [
  'BRANCH_DEPARTMENT_MANAGER',
  'CLAIMS_OFFICER',
  'COMPLIANCE_OFFICER',
  'DATA_PROTECTION_OFFICER',
] as const;

/** Sources that are about the whole book, and the permission each needs. */
export const BOOK_WIDE_SOURCES: {
  kind: NotificationKind;
  permission: string;
  href: string;
  severity: NotificationItem['severity'];
}[] = [
  {
    kind: 'claim_followup',
    permission: 'claim.followup.manage',
    href: '/opportunities',
    severity: 'warning',
  },
  {
    kind: 'aml_alert',
    permission: 'aml.monitor',
    href: '/transaction-monitoring',
    severity: 'warning',
  },
  {
    kind: 'screening_match',
    permission: 'sanctions-pep.screen',
    href: '/screening-matches',
    severity: 'action',
  },
];

/** The escalation targets this reader may be notified about: the intersection
 *  of their roles and the four that map to a real role at all.
 *
 *  Roles, not permissions: `SlaTimer.escalatedTo` names a ROLE, so this is a
 *  direct comparison rather than a permission lookup. */
export function slaTargetsFor(user: AuthenticatedUser): string[] {
  return SLA_ESCALATION_ROLES.filter((r) =>
    (user.roles as readonly string[]).includes(r),
  );
}
