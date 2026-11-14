import type { CSSProperties } from 'react';

export const rfqCardStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'start',
  padding: '1rem',
  border: '1px solid var(--border-default)',
  borderRadius: '0.5rem',
  cursor: 'pointer',
  marginBottom: '0.75rem',
};

export const rfqPanelStyle: CSSProperties = {
  marginTop: '1rem',
  padding: '1rem',
  border: '1px solid var(--border-default)',
  borderRadius: '0.5rem',
  background: 'var(--surface-sunken)',
};

export const rfqTableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  marginTop: '1rem',
};

export const rfqCellStyle: CSSProperties = {
  textAlign: 'start',
  padding: '0.5rem 0.6rem',
  borderBottom: '1px solid var(--border-subtle)',
  verticalAlign: 'top',
};

export const rfqBadgeStyle: CSSProperties = {
  display: 'inline-block',
  padding: '0.1rem 0.5rem',
  borderRadius: '0.75rem',
  fontSize: '0.8rem',
  border: '1px solid var(--border-strong)',
};

export const rfqActionsStyle: CSSProperties = {
  display: 'flex',
  gap: '0.75rem',
  flexWrap: 'wrap',
  marginTop: '1.5rem',
  alignItems: 'flex-start',
};

export const insurerPickerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.4rem',
  marginTop: '0.5rem',
  maxHeight: '16rem',
  overflowY: 'auto',
  border: '1px solid var(--border-default)',
  borderRadius: '0.5rem',
  padding: '0.75rem',
};

export const rfqFieldStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
  marginBottom: '0.75rem',
  maxWidth: '32rem',
};

export const commBodyStyle: CSSProperties = {
  whiteSpace: 'pre-wrap',
  margin: '0.25rem 0 0',
};

/* ───────────────────────────────────────────────────────────────────────────────────────────
 * ART. 15/d's WINDOW — OWNER DECISIONS 126, 129, 130 and 133.
 *
 * Here rather than in the component because `check:screen-pass` counts inline style sites and
 * refused the first version at 1089 against a budget of 1083, with its own message: compose from
 * `components/ui/` or move the declaration into a `*.styles.ts`. It was right — these are six
 * reusable surfaces, not one-offs.
 * ─────────────────────────────────────────────────────────────────────────────────────────── */

export const a15dSectionStyle: CSSProperties = {
  marginTop: '1.5rem',
  padding: 'var(--space-3)',
  border: '1px solid var(--warning-border, var(--line))',
  borderRadius: 'var(--radius-md)',
  background: 'var(--warning-bg, var(--surface-raised))',
};

export const a15dQuestionStyle: CSSProperties = {
  margin: 0,
  fontWeight: 600,
};

export const a15dOptionStyle: CSSProperties = {
  display: 'flex',
  gap: '0.5rem',
  alignItems: 'flex-start',
  marginTop: '0.6rem',
  lineHeight: 1.6,
};

export const a15dWindowStyle: CSSProperties = {
  marginTop: '1rem',
  padding: 'var(--space-3)',
  border: '1px solid var(--danger-border, var(--line))',
  borderRadius: 'var(--radius-md)',
  background: 'var(--danger-bg, var(--surface-raised))',
};

export const a15dWindowTitleStyle: CSSProperties = {
  margin: 0,
  fontWeight: 700,
  color: 'var(--danger-ink, var(--ink-primary))',
};

export const a15dProseStyle: CSSProperties = {
  margin: '0.6rem 0 0',
  lineHeight: 1.7,
};

export const a15dFieldStyle: CSSProperties = {
  display: 'block',
  marginTop: '0.75rem',
};

/** The bold label above an art. 15/d field. */
export const a15dFieldLabelStyle: CSSProperties = {
  display: 'block',
  fontWeight: 600,
};

/** The expected-annual-premium input. Narrow: it holds a figure, not a sentence. */
export const a15dPremiumInputStyle: CSSProperties = {
  marginTop: '0.35rem',
  minWidth: '12rem',
};

/** The evidence radio list. */
export const a15dEvidenceListStyle: CSSProperties = {
  marginTop: '0.35rem',
};

/** The written-reason box. Full width: it holds prose, and the floor is ten characters. */
export const a15dReasonInputStyle: CSSProperties = {
  marginTop: '0.35rem',
  width: '100%',
};
