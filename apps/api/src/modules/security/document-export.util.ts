import { ForbiddenException } from '@nestjs/common';
import type { DataClassification } from '@ibms/db';

/**
 * Part 10.6 — "any export, print, or download feature touching a Highly
 * Confidential field without watermarking/DLP controls" triggers
 * ibms-brain/meta/lex/sensitive-data-handling.md. A file combining multiple
 * classification levels is classified at the highest present (Part 6.1
 * §6.7; `Document.classification` already carries this per-file, not
 * per-field), so watermarking is decided from that one field.
 */
const CLASSIFICATIONS_REQUIRING_WATERMARK: readonly DataClassification[] = [
  'HIGHLY_CONFIDENTIAL',
];

export function requiresWatermark(classification: DataClassification): boolean {
  return CLASSIFICATIONS_REQUIRING_WATERMARK.includes(classification);
}

/**
 * The watermark text a Highly Confidential export/print must carry.
 * Deliberately identifies the classification tier and who/when, never the
 * document's content — logging/marking that a document *is* Highly
 * Confidential is fine, marking its content is not (sensitive-data-handling.md
 * "What does NOT trigger this rule").
 */
export function buildWatermarkText(input: {
  classification: DataClassification;
  userId: string;
  exportedAt?: Date;
}): string {
  const timestamp = (input.exportedAt ?? new Date()).toISOString();
  return `${input.classification} — exported by ${input.userId} at ${timestamp}`;
}

/**
 * Call before an export/print/download actually happens (or before
 * releasing generated file bytes to the caller). No document-rendering or
 * object-storage pipeline exists yet behind `Document.storageRef` (same gap
 * as A.3 — see README § Known gaps), so this enforces the business rule and
 * gives the caller the exact watermark text to stamp; it does not itself
 * manipulate a PDF/image.
 */
export function assertExportAllowed(input: {
  classification: DataClassification;
  watermarkApplied: boolean;
}): void {
  if (requiresWatermark(input.classification) && !input.watermarkApplied) {
    throw new ForbiddenException(
      `${input.classification} documents cannot be exported, printed, or downloaded without a watermark applied (Part 10.6)`,
    );
  }
}
