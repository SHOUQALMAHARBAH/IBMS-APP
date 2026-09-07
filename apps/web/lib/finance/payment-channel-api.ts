// Process 38 — Payment Processing (backlog Part C #38, Domain D). Reads
// apps/api's /payment-channels endpoints: the approved payment-channel list for
// customers and insurers, maintained by Finance (payment-channel.manage). #32's
// collection cycle references a channel on a Receipt / Remittance.

import { apiGet, apiPost } from '../auth/api-client';

export interface PaymentChannel {
  id: string;
  ownerType: string;
  customerId: string | null;
  insurerId: string | null;
  channelType: string;
  label: string;
  bankName: string | null;
  /** Masked account fragment — never a full number. */
  accountLast4: string | null;
  currency: string;
  status: string;
  isActive: boolean;
  disabledAt: string | null;
  createdAt: string;
}

export function listPaymentChannels(
  opts: {
    ownerType?: string;
    customerId?: string;
    insurerId?: string;
    status?: string;
  } = {},
): Promise<PaymentChannel[]> {
  const params = new URLSearchParams();
  if (opts.ownerType) params.set('ownerType', opts.ownerType);
  if (opts.customerId) params.set('customerId', opts.customerId);
  if (opts.insurerId) params.set('insurerId', opts.insurerId);
  if (opts.status) params.set('status', opts.status);
  const qs = params.toString();
  return apiGet(`/payment-channels${qs ? `?${qs}` : ''}`);
}

export function createPaymentChannel(body: {
  ownerType: string;
  customerId?: string;
  insurerId?: string;
  channelType: string;
  label: string;
  bankName?: string;
  accountLast4?: string;
  currency?: string;
}): Promise<PaymentChannel> {
  return apiPost('/payment-channels', body);
}

export function disablePaymentChannel(id: string): Promise<PaymentChannel> {
  return apiPost(`/payment-channels/${id}/disable`, {});
}
