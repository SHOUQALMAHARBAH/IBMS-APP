/**
 * Part 10.6 — "Privacy-by-default form design: no pre-filled or
 * pre-selected sensitive fields"
 * (ibms-brain/meta/lex/sensitive-data-handling.md). Call this from a form's
 * initial-values builder before rendering, listing the field names that
 * hold Highly Confidential/Confidential data for that form (national ID,
 * bank account, medical fields, etc.) — it throws if any of them arrives
 * pre-populated, so a form can't silently ship a default the reviewer never
 * noticed.
 *
 * No business form exists in this repo yet to call it from (same
 * "built ahead of the consumer" gap as the backend security utilities) —
 * see README § Known gaps, A.9.
 */
export function assertNoPresetSensitiveDefaults(
  initialValues: Record<string, unknown>,
  sensitiveFieldNames: readonly string[],
): void {
  const violations = sensitiveFieldNames.filter((name) => {
    const value = initialValues[name];
    if (value === undefined || value === null || value === '') return false;
    if (Array.isArray(value) && value.length === 0) return false;
    return true;
  });
  if (violations.length > 0) {
    throw new Error(
      `Privacy-by-default violation: sensitive field(s) ${violations.join(', ')} have a pre-filled/pre-selected value (Part 10.6) — initialize sensitive fields empty and require the user to enter them`,
    );
  }
}
