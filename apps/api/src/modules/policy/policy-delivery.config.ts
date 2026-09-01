import type { Prisma } from '@ibms/db';

/**
 * Process 21 — Policy Delivery (backlog Part C #21, Domain B). The small pure
 * bits: the delivery-method vocabulary and the audit `afterValue` snapshots.
 *
 * `ibms-brain/meta/context/policy-lifecycle.md` § "The shapes":
 *   ... Verified → Delivered → Active
 * Recording delivery moves the `Policy` `VERIFIED → DELIVERED` through the
 * workflow engine; the client's receipt acknowledgement moves it
 * `DELIVERED → ACTIVE` (best-effort). `DeliveryRecord` itself has no workflow
 * `status` — its lifecycle is the parent `Policy`'s status.
 */

/** How the issued policy document reached the client (the `DeliveryRecord.method`
 * comment enumerates exactly these). */
export const DELIVERY_METHODS = [
  'email',
  'portal',
  'courier',
  'in_person',
] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

/** CREATE audit `afterValue` for a recorded delivery — the delivery is an
 * accountability record ("we sent the policy to X, this way, on this date"),
 * so `method` / `recipient` / `deliveredAt` belong in the trail. No free
 * text. */
export function deliveryAuditSnapshot(row: {
  policyId: string;
  method: string;
  recipient: string;
  deliveredAt: Date;
}): Prisma.InputJsonObject {
  return {
    policyId: row.policyId,
    method: row.method,
    recipient: row.recipient,
    deliveredAt: row.deliveredAt.toISOString(),
  };
}

/** UPDATE audit `afterValue` for the client's receipt acknowledgement. */
export function receiptAckAuditSnapshot(row: {
  policyId: string;
  deliveryRecordId: string;
  receiptAcknowledgedAt: Date;
}): Prisma.InputJsonObject {
  return {
    policyId: row.policyId,
    deliveryRecordId: row.deliveryRecordId,
    receiptAcknowledgedAt: row.receiptAcknowledgedAt.toISOString(),
  };
}
