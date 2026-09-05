// Process 44 — Customer Communication (backlog Part C #44, Domain E). Reads
// apps/api's /communications endpoints: log an outbound customer communication
// (channel + language taken from the customer record; a marketing send gated
// on the customer's MARKETING ConsentRecord), check consent status, and list
// the log. `communication.send` (Sales, Placement, Claims, Finance).

import { apiGet, apiPost } from '../auth/api-client';

export const COMMUNICATION_CHANNELS = [
  'EMAIL',
  'SMS',
  'WHATSAPP',
  'CALL',
  'PORTAL',
  'OTHER',
] as const;

export interface Communication {
  id: string;
  customerId: string | null;
  channel: string;
  templateId: string | null;
  languageUsed: string | null;
  direction: string;
  subject: string | null;
  body: string | null;
  isMarketing: boolean;
  respectedConsent: boolean;
  consentRecordId: string | null;
  loggedByUserId: string | null;
  sentAt: string;
  createdAt: string;
}

export interface MarketingConsentStatus {
  customerId: string;
  marketing: {
    allowed: boolean;
    reason: 'granted' | 'no_record' | 'not_granted' | 'withdrawn';
    consentRecordId: string | null;
  };
}

export function listCommunications(
  opts: {
    customerId?: string;
    channel?: string;
    isMarketing?: boolean;
    direction?: string;
  } = {},
): Promise<Communication[]> {
  const params = new URLSearchParams();
  if (opts.customerId) params.set('customerId', opts.customerId);
  if (opts.channel) params.set('channel', opts.channel);
  if (opts.isMarketing !== undefined)
    params.set('isMarketing', String(opts.isMarketing));
  if (opts.direction) params.set('direction', opts.direction);
  const qs = params.toString();
  return apiGet(`/communications${qs ? `?${qs}` : ''}`);
}

export function getMarketingConsentStatus(
  customerId: string,
): Promise<MarketingConsentStatus> {
  return apiGet(
    `/communications/consent-status?customerId=${encodeURIComponent(customerId)}`,
  );
}

export function createCommunication(body: {
  customerId: string;
  body: string;
  channel?: string;
  languageUsed?: string;
  isMarketing?: boolean;
  templateId?: string;
  subject?: string;
}): Promise<Communication> {
  return apiPost('/communications', body);
}
