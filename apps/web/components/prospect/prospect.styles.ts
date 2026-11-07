import type { CSSProperties } from 'react';

export const listGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(16rem, 1fr))',
  gap: '1rem',
  marginTop: '1rem',
};

export const profileGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(14rem, 1fr))',
  gap: '1.25rem',
  marginTop: '1.5rem',
};

export const profileFieldLabelStyle: CSSProperties = {
  fontSize: '0.75rem',
  color: 'var(--ink-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.02em',
};

export const profileFieldValueStyle: CSSProperties = {
  fontSize: '1rem',
  marginTop: '0.2rem',
};

/**
 * A detail-page section block. Added 2026-11-06 (module 0-c batch 6) because the SCREEN ratchet
 * refused a new `style={{ marginBottom: '2rem' }}` on `/policies/[id]` at 1084 against 1083 — and
 * that budget may only FALL, so the honest move is a named style rather than a raised ceiling.
 *
 * The value is the one `/policies/[id]` already used inline for exactly this, so nothing about the
 * rendering changes; this gives the spacing one name instead of repeating the literal.
 */
export const detailSectionStyle: CSSProperties = {
  marginBottom: '2rem',
};

/**
 * A block-level attestation row — a checkbox and the sentence it governs on one line of its own.
 * Added 2026-11-07 (module 0-c batch 6b) because the SCREEN ratchet refused a new inline
 * `style={{ display: "block", marginBottom: "0.5rem" }}` on `/vendors/[id]` at 1084 against 1083,
 * and that budget may only FALL — so the honest move is a named style, not a raised ceiling. Second
 * time this batch family has made that trade; the first was `detailSectionStyle` above.
 */
export const attestationRowStyle: CSSProperties = {
  display: "block",
  marginBottom: "0.5rem",
};
