// Process 1 — Lead Management. Talks to apps/api's lead module
// (lead.controller.ts). Mirrors lib/auth/auth-api.ts's conventions (thin
// typed wrappers over apiGet/apiPost).

import { apiGet, apiPost } from '../auth/api-client';

// Mirrors apps/api/src/modules/lead/lead.constants.ts's LEAD_SOURCES — kept
// in sync by hand (no shared package between web and api for this), same as
// access-recertification-api.ts's CAN_START_CYCLE_ROLES being a client-side
// hint the backend independently re-validates.
export const LEAD_SOURCES = [
  'referral',
  'website',
  'social_media',
  'campaign',
  'tender',
  'bank_partner',
  'strategic_partner',
  'ex_customer',
  'renewal',
] as const;

export type LeadSource = (typeof LEAD_SOURCES)[number];

export type LeadStatus = 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'CONVERTED_TO_PROSPECT' | 'DISQUALIFIED';

// Pipeline-board column order. Mirrors apps/api's WORKFLOW_TRANSITIONS.Lead
// (workflow-transitions.config.ts) for which forward move is offered per
// column — kept in sync by hand, same caveat as LEAD_SOURCES above.
export const LEAD_STATUSES: LeadStatus[] = ['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED_TO_PROSPECT', 'DISQUALIFIED'];

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  QUALIFIED: 'Qualified',
  CONVERTED_TO_PROSPECT: 'Converted to prospect',
  DISQUALIFIED: 'Disqualified',
};

/** The next status a Sales Officer can move a lead to from each stage —
 * mirrors WORKFLOW_TRANSITIONS.Lead server-side; the backend independently
 * re-validates every move regardless of what this offers in the UI. */
export const LEAD_NEXT_STATUSES: Record<LeadStatus, LeadStatus[]> = {
  NEW: ['CONTACTED', 'DISQUALIFIED'],
  CONTACTED: ['QUALIFIED', 'DISQUALIFIED'],
  QUALIFIED: ['CONVERTED_TO_PROSPECT', 'DISQUALIFIED'],
  CONVERTED_TO_PROSPECT: [],
  DISQUALIFIED: [],
};

export interface Lead {
  id: string;
  fullName: string;
  source: LeadSource;
  ownerUserId: string;
  status: LeadStatus;
  contactPhone: string | null;
  contactEmail: string | null;
  marketingConsentGranted: boolean;
  firstContactAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLeadInput {
  fullName: string;
  source: LeadSource;
  contactPhone?: string;
  contactEmail?: string;
  marketingConsentGranted: boolean;
}

export interface ListLeadsFilter {
  source?: LeadSource;
  ownerUserId?: string;
  status?: LeadStatus;
}

// POST .../transition returns only { id, status } (WorkflowTransitionService's
// generic return shape) — NOT the full Lead. Deliberately narrower than Lead
// so a caller can't assume fields it doesn't have; see
// access-recertification-api.ts's RecertificationDecisionResult for the same
// lesson learned the hard way there.
export interface LeadTransitionResult {
  id: string;
  status: LeadStatus;
}

export function createLead(input: CreateLeadInput): Promise<Lead> {
  return apiPost('/leads', input);
}

export function listLeads(filter: ListLeadsFilter = {}): Promise<Lead[]> {
  const params = new URLSearchParams();
  if (filter.source) params.set('source', filter.source);
  if (filter.ownerUserId) params.set('ownerUserId', filter.ownerUserId);
  if (filter.status) params.set('status', filter.status);
  const qs = params.toString();
  return apiGet(`/leads${qs ? `?${qs}` : ''}`);
}

export function transitionLead(leadId: string, toStatus: LeadStatus): Promise<LeadTransitionResult> {
  return apiPost(`/leads/${leadId}/transition`, { toStatus });
}
