// The notification bell. Talks to apps/api's notification module
// (notification.controller.ts): GET /notifications.
//
// The payload carries a stable `kind` and a number — never a sentence, and
// never a customer name or a claim narrative. Wording is this app's job (see
// components/app/NotificationBell.tsx), which is what lets one response serve
// both languages; the absence of record detail is a deliberate privacy
// choice on the api side, not an oversight.

import { apiGet } from '../auth/api-client';

export const NOTIFICATION_KINDS = [
  'sla_overdue',
  'claim_followup',
  'aml_alert',
  'screening_match',
  'service_request_assigned',
  'customer_pending_kyc',
  'kyc_awaiting_decision',
  /** OWNER DECISION 131 — a permission arrived and this office has not decided on it. */
  'new_permission',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** OWNER DECISION 131 — one arrived permission, as the api describes it. */
export interface NewPermissionNotice {
  code: string;
  /** The screen the code guards, when one names it. NULL when no screen does, and the
   *  notification falls back to naming the route — see `routes`. */
  screen: string | null;
  /** `METHOD /path`, rendered only when `screen` is null. Not a sentence and not translated:
   *  it is the route as the api declares it, which is the honest answer when no screen exists. */
  routes: readonly string[];
}

export interface NotificationItem {
  kind: NotificationKind;
  /** How many things of this kind need attention. Never zero — the api omits
   *  an empty source rather than reporting "0 things to do". */
  count: number;
  severity: 'action' | 'warning';
  href: string;
  /**
   * OWNER DECISION 131 — present only on `new_permission`, and the only item that carries more
   * than a number.
   *
   * The ratified sentence has slots: «صلاحية جديدة في النظام: [اسمها]. [شرحها]. تتحكّم في:
   * [الشاشة أو الزر]…» — so the bell has to name WHICH permissions arrived. The name and the
   * description still come from this app's own dictionaries in both languages; what the api
   * supplies is the CODE and what it controls. A permission code is catalogue metadata and not
   * customer data, so this does not reach the privacy choice described above.
   */
  newPermissions?: readonly NewPermissionNotice[];
}

export interface NotificationFeed {
  items: NotificationItem[];
  /** The number of THINGS needing attention, not the number of sources: three
   *  sources holding seven pieces of work between them reads 7. */
  total: number;
}

export function listNotifications(): Promise<NotificationFeed> {
  return apiGet('/notifications');
}
