import type { CSSProperties } from 'react';

/**
 * Styles for the office-administration screens' permission matrix.
 *
 * Tokens only — the matrix is 186 rows of dense text in two scripts, and a hard-coded colour here
 * would be the one place the dark theme fails while every other screen holds.
 */

/** The permanent "N of 186" line above the matrix: the answer to "what can this role do?" without
 *  expanding anything. */
export const matrixSummaryStyle: CSSProperties = {
  margin: '0.25rem 0 0.75rem',
  fontSize: '0.9rem',
  fontWeight: 600,
  color: 'var(--ink-secondary)',
};

export const matrixSearchStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  maxWidth: '22rem',
  margin: '0.25rem 0 1rem',
  padding: '0.4rem 0.55rem',
  background: 'var(--surface-card)',
  color: 'var(--ink-primary)',
  border: '1px solid var(--border-default)',
  borderRadius: '0.35rem',
};

/** One collapsible module. `details`/`summary` rather than a custom disclosure: it is keyboard- and
 *  screen-reader-operable without any of our own state, and the accessibility gate covers it. */
export const matrixModuleStyle: CSSProperties = {
  margin: '0 0 0.5rem',
  padding: '0.5rem 0.65rem',
  background: 'var(--surface-sunken)',
  border: '1px solid var(--border-subtle)',
  borderRadius: '0.4rem',
};

/** The count beside a module name — how many of its permissions this role holds. */
export const matrixCountStyle: CSSProperties = {
  marginInlineStart: '0.5rem',
  padding: '0.05rem 0.4rem',
  background: 'var(--surface-card)',
  border: '1px solid var(--border-default)',
  borderRadius: '999px',
  fontSize: '0.8rem',
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--ink-secondary)',
};

export const matrixRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  gap: '0.4rem 0.6rem',
  padding: '0.3rem 0',
  borderTop: '1px solid var(--border-subtle)',
  fontSize: '0.875rem',
};

/** The five states on a CRUD-shaped family, kept on one line so the row reads as one decision. */
export const matrixVerbStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.15rem 0.85rem',
  marginInlineStart: 'auto',
};

/** The generated machine name, shown read-only beside the English name it comes from. Monospace and
 *  LTR because it is an identifier, on a page that is otherwise right-to-left. */
export const generatedNameStyle: CSSProperties = {
  display: 'block',
  margin: '0.2rem 0',
  padding: '0.35rem 0.5rem',
  background: 'var(--surface-sunken)',
  border: '1px dashed var(--border-strong)',
  borderRadius: '0.3rem',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: '0.9rem',
  direction: 'ltr',
  textAlign: 'start',
  color: 'var(--ink-primary)',
};

/** The matrix inside the creation form — set apart so the form reads as "identity, then powers". */
export const createMatrixStyle: CSSProperties = {
  margin: '1rem 0',
  padding: '0.75rem',
  border: '1px solid var(--border-default)',
  borderRadius: '0.45rem',
};

/** The one-line explanation beneath a permission's name. Muted and on its own line: the owner's
 *  finding is that a code is not an explanation, and an em-dash continuation reads as part of the
 *  identifier rather than as prose about it. */
export const matrixDescriptionStyle: CSSProperties = {
  display: 'block',
  marginTop: '0.1rem',
  fontSize: '0.8rem',
  lineHeight: 1.5,
  color: 'var(--ink-secondary)',
};

/** The section-level select-all, in the module's summary line. */
export const matrixSectionAllStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.3rem',
  marginInlineStart: '0.75rem',
  fontSize: '0.8rem',
  fontWeight: 400,
  color: 'var(--ink-secondary)',
  cursor: 'pointer',
};

/** Departments and branches side by side: two short lists, not a page each. */
export const orgUnitGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(19rem, 1fr))',
  gap: '1.25rem',
  marginTop: '1.25rem',
};

export const orgUnitColumnStyle: CSSProperties = {
  padding: '0.9rem 1rem',
  background: 'var(--surface-card)',
  border: '1px solid var(--border-subtle)',
  borderRadius: '0.5rem',
};

export const orgUnitRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '0.5rem',
  padding: '0.45rem 0',
  borderTop: '1px solid var(--border-subtle)',
};
