// Process 51/Part 7.1 — the broker's own CBJ license record (backlog Part C
// #51's first checkbox: "automatically block new business issuance once the
// license lapses"). Reads/writes apps/api's /broker-license endpoints — a
// singleton resource, license.manage (Compliance).

import { apiGet, apiPost } from '../auth/api-client';

export interface BrokerLicense {
  id: string;
  licenseNumber: string;
  scopeOfAuthorization: string | null;
  issuedAt: string | null;
  expiresAt: string;
  status: string;
  isCurrentlyLapsed: boolean;
}

export interface CreateOrRenewBrokerLicenseInput {
  licenseNumber: string;
  scopeOfAuthorization?: string;
  issuedAt?: string;
  expiresAt: string;
}

export function getBrokerLicense(): Promise<BrokerLicense> {
  return apiGet('/broker-license');
}

export function createBrokerLicense(
  input: CreateOrRenewBrokerLicenseInput,
): Promise<BrokerLicense> {
  return apiPost('/broker-license', input);
}

export function renewBrokerLicense(
  input: CreateOrRenewBrokerLicenseInput,
): Promise<BrokerLicense> {
  return apiPost('/broker-license/renew', input);
}

export function markBrokerLicenseLapsed(): Promise<BrokerLicense> {
  return apiPost('/broker-license/mark-lapsed', {});
}
