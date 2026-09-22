import type { CSSProperties } from 'react';

/**
 * The insurer screens' own styles, in one place.
 *
 * Every value here is a design token, never a literal colour: the palette has TWO chokepoints in
 * this app, and a hard-coded hex in a screen file is how a theme change silently stops applying to
 * one page. The dark theme is a token swap, so a literal would survive it and read wrong.
 */

export const listGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(18rem, 1fr))',
  gap: '1rem',
  marginTop: '1rem',
};

/** A field group on the detail page. Used for BOTH the company block and the relationship block —
 *  the difference between them is stated in words and by heading, not by styling them
 *  differently, because a visual cue is not a boundary. */
export const detailGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(15rem, 1fr))',
  gap: '1rem',
  marginTop: '0.75rem',
};

export const fieldLabelStyle: CSSProperties = {
  fontSize: '0.75rem',
  color: 'var(--ink-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.02em',
};

export const fieldValueStyle: CSSProperties = {
  fontSize: '1rem',
  marginTop: '0.2rem',
};

/**
 * The impact panel shown before a deactivation is confirmed.
 *
 * Deliberately not styled as a warning banner. Deactivating is a legitimate act that the system
 * ALLOWS AND RECORDS — it never refuses because an obligation exists, since refusing would not
 * settle one. Dressing the counts as an error would tell an administrator they are doing something
 * wrong when they are doing something consequential, which are different things.
 */
export const impactPanelStyle: CSSProperties = {
  border: '1px solid var(--border-default)',
  borderRadius: '0.5rem',
  padding: '0.75rem 1rem',
  marginTop: '0.75rem',
  background: 'var(--surface-raised)',
};

export const impactRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '1rem',
  padding: '0.2rem 0',
};

/** The number in an impact row. `tabular-nums` so five stacked counts line up and can be compared
 *  down the column rather than read one at a time. */
export const impactCountStyle: CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  fontWeight: 600,
};

/** The count that should give an administrator pause — policies where the INSURER still owes an
 *  action. Emphasised because it is the one the API reports separately for exactly that reason. */
export const impactCountAttentionStyle: CSSProperties = {
  ...impactCountStyle,
  color: 'var(--status-warning-ink, var(--ink-primary))',
};

export const lineChipStyle: CSSProperties = {
  display: 'inline-block',
  border: '1px solid var(--border-subtle)',
  borderRadius: '999px',
  padding: '0.1rem 0.6rem',
  marginInlineEnd: '0.3rem',
  marginBottom: '0.3rem',
  fontSize: '0.8rem',
};

/** An office's OWN added line, marked so it reads as local vocabulary rather than a platform
 *  line. The distinction is real: only a catalogue line has a code, and only a catalogue line can
 *  be referenced by anything outside this office. */
export const lineChipOfficeStyle: CSSProperties = {
  ...lineChipStyle,
  borderStyle: 'dashed',
};
