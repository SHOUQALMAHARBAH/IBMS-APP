/**
 * Process 67 (backlog Part C #67, Domain H) — Procurement. The backlog's
 * own text carries a scope warning: the two source documents give
 * Procurement no more than a one-line general description ("purchase
 * requests and vendor selection for non-insurance operational needs"), with
 * no field-level detail or defined workflow — "the only task actually
 * executable from the source directly: use `Vendor` (with `vendorType=
 * other`) as the general vendor record for this purpose, without inventing
 * a purchase-request model that isn't in the text." No `PurchaseRequest`
 * model or approval workflow is built here — this process is satisfied
 * entirely by a basic `Vendor` CRUD.
 *
 * `Vendor` itself (`packages/db/prisma/schema.prisma`) is a genuinely
 * SHARED register — its own doc comment: "Merges Process 71 (Vendor
 * Management) and PDPL third-party governance — both describe the same
 * register." #67 builds the FOUNDATIONAL CRUD (name, vendorType); #71
 * (Vendor Management, not built here) will layer risk tiering, mandatory
 * DPAs, and the annual-review SLA on the SAME model and module later —
 * `riskTier`/`annualReviewDueAt`/`terminationDataReturnConfirmedAt`/
 * `accessRevokedAt` are deliberately NOT exposed by this process's DTOs.
 */

/** The exact 7-value set from `Vendor.vendorType`'s own schema doc comment
 * — validated here so a caller can't write an arbitrary string into a
 * column with no DB-level enum. `'other'` is the value #67's own
 * procurement use case maps to (non-insurance operational vendors);
 * the other six are #71's/Part D's insurance-side and outsourced-function
 * vendor types. */
export const VENDOR_TYPES = [
  'insurer',
  'reinsurer',
  'loss_adjuster',
  'it_cloud',
  'printing_archiving',
  'marketing_call_centre',
  'other',
] as const;

export type VendorType = (typeof VENDOR_TYPES)[number];
