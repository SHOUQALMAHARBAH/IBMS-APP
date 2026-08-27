// Process 10 — Relationship Management (CRM) (backlog Part C #10). Talks to
// apps/api's crm module (crm.controller.ts). Every customer touchpoint is
// logged as an Interaction; the 360° view merges the interaction log with
// the customer's policies, claims and complaints into one timeline. The
// Policy / Claim / Complaint modules are not built yet, so those three
// collections are empty until Domains B / C / E land.

import { apiGet, apiPost } from '../auth/api-client';

export type InteractionChannel =
  | 'MEETING'
  | 'CALL'
  | 'EMAIL'
  | 'WHATSAPP'
  | 'VISIT'
  | 'PROPOSAL'
  | 'RENEWAL'
  | 'CLAIM'
  | 'COMPLAINT'
  | 'PORTAL'
  | 'SMS'
  | 'OTHER';

export const INTERACTION_CHANNELS: InteractionChannel[] = [
  'MEETING',
  'CALL',
  'EMAIL',
  'WHATSAPP',
  'VISIT',
  'PROPOSAL',
  'RENEWAL',
  'CLAIM',
  'COMPLAINT',
  'PORTAL',
  'SMS',
  'OTHER',
];

export interface Interaction {
  id: string;
  customerId: string;
  channel: InteractionChannel;
  summary: string;
  occurredAt: string;
  loggedByUserId: string;
  createdAt: string;
}

export type TimelineEventKind = 'INTERACTION' | 'POLICY' | 'CLAIM' | 'COMPLAINT';

export interface TimelineEvent {
  kind: TimelineEventKind;
  refId: string;
  at: string;
  title: string;
  detail: string | null;
  status: string | null;
}

export interface TimelinePolicy {
  id: string;
  policyNumber: string | null;
  insuranceLine: string;
  status: string;
  inceptionDate: string | null;
  expiryDate: string | null;
  createdAt: string;
}

export interface TimelineClaim {
  id: string;
  claimNumber: string | null;
  status: string;
  lossDate: string;
  createdAt: string;
}

export interface TimelineComplaint {
  id: string;
  issue: string;
  category: string | null;
  status: string;
  createdAt: string;
  closedAt: string | null;
}

export interface Customer360View {
  customer: {
    id: string;
    legalName: string;
    customerType: string;
    status: string;
    ownerUserId: string;
  };
  interactions: Interaction[];
  policies: TimelinePolicy[];
  claims: TimelineClaim[];
  complaints: TimelineComplaint[];
  timeline: TimelineEvent[];
  counts: {
    interactions: number;
    policies: number;
    claims: number;
    complaints: number;
  };
}

export interface LogInteractionInput {
  channel: InteractionChannel;
  summary: string;
  occurredAt?: string;
}

export function getCustomer360(customerId: string): Promise<Customer360View> {
  return apiGet(`/customers/${customerId}/360-view`);
}

export function listInteractions(customerId: string): Promise<Interaction[]> {
  return apiGet(`/customers/${customerId}/interactions`);
}

export function logInteraction(
  customerId: string,
  input: LogInteractionInput,
): Promise<Interaction> {
  return apiPost(`/customers/${customerId}/interactions`, input);
}
