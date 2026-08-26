/**
 * Partial masking for list-view display of Highly Confidential fields
 * (national ID, bank account/card number — Part 10.6;
 * ibms-brain/meta/lex/sensitive-data-handling.md "List views showing a full
 * national ID, full card number, or full bank account number instead of a
 * masked value"). Full reveal happens only through a justified drill-down —
 * see SensitiveFieldRevealService
 * (apps/api/src/modules/security/sensitive-field-reveal.service.ts), which
 * wraps this together with EncryptionService.decrypt() and an audited
 * justification. This file is the pure masking logic only — no I/O, no
 * decryption — so it's usable anywhere a plaintext value needs a masked
 * display form, not just from that service.
 */

/** Digits/letters shown at the end of a masked value; the rest becomes `*`. */
export const DEFAULT_VISIBLE_SUFFIX_LENGTH = 4;

/**
 * Masks all but the last `visibleSuffixLength` characters of `value`. A
 * value at or below that length masks in full — there's nothing left to
 * distinguish it from its own mask otherwise, which would defeat the
 * purpose of a "masked but still identifiable" list-view display.
 */
export function maskTrailing(
  value: string,
  visibleSuffixLength: number = DEFAULT_VISIBLE_SUFFIX_LENGTH,
): string {
  if (value.length <= visibleSuffixLength) {
    return '*'.repeat(value.length);
  }
  const maskedLength = value.length - visibleSuffixLength;
  return '*'.repeat(maskedLength) + value.slice(-visibleSuffixLength);
}
