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
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface NotificationItem {
  kind: NotificationKind;
  /** How many things of this kind need attention. Never zero — the api omits
   *  an empty source rather than reporting "0 things to do". */
  count: number;
  severity: 'action' | 'warning';
  href: string;
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
