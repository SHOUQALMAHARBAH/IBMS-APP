// Process 2 — Prospect Management. Talks to apps/api's prospect module
// (prospect.controller.ts). Mirrors lib/lead/lead-api.ts's conventions.

import { apiGet, apiPost } from '../auth/api-client';

export interface Prospect {
  id: string;
  leadId: string | null;
  companyName: string;
  sector: string | null;
  activity: string | null;
  employeeCount: number | null;
  businessSize: string | null;
  location: string | null;
  contactPerson: string | null;
  productsOfInterest: string[];
  expectedPremium: string | null;
  salesOwnerUserId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConvertLeadToProspectInput {
  leadId: string;
  companyName: string;
  sector?: string;
  activity?: string;
  employeeCount?: number;
  businessSize?: string;
  location?: string;
  contactPerson?: string;
  productsOfInterest?: string[];
  expectedPremium?: string;
}

export interface ListProspectsFilter {
  salesOwnerUserId?: string;
}

export function convertLeadToProspect(
  input: ConvertLeadToProspectInput,
): Promise<Prospect> {
  return apiPost('/prospects', input);
}

export function listProspects(filter: ListProspectsFilter = {}): Promise<Prospect[]> {
  const params = new URLSearchParams();
  if (filter.salesOwnerUserId) params.set('salesOwnerUserId', filter.salesOwnerUserId);
  const qs = params.toString();
  return apiGet(`/prospects${qs ? `?${qs}` : ''}`);
}

export function getProspect(id: string): Promise<Prospect> {
  return apiGet(`/prospects/${id}`);
}
