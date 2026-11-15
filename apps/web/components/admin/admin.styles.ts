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

/**
 * 🔴 OWNER DECISION 131's «جديدة» BADGE — «معلم عليها بالاخضر ع انها جديدة».
 *
 * GREEN is hers and it is the only colour she named for it. The `--success-*` trio is the
 * product's declared green and already carries a dark-theme definition, so the badge reads in
 * both themes without a new token — `check:screen-pass` counts undeclared colours and a literal
 * here would be one.
 *
 * ⚠️ COLOUR IS NOT THE ONLY SIGNAL. The badge carries the WORD «جديدة» as its text and as its
 * accessible name, so a reader who cannot distinguish the green is told the same thing. A badge
 * that was only a colour would be a mark half the readers cannot see.
 */
export const matrixNewBadgeStyle: CSSProperties = {
  display: 'inline-block',
  marginInlineStart: '0.4rem',
  padding: '0.05rem 0.35rem',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--success-bg)',
  color: 'var(--success-ink)',
  border: '1px solid var(--success-border)',
  fontSize: '0.7rem',
  lineHeight: 1.6,
  verticalAlign: 'middle',
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

/*
 * The two rename inputs — the Latin name and the Arabic one — STACKED, in one cell of
 * `orgUnitRowStyle`'s flex row.
 *
 * A COLUMN deliberately, and measured rather than assumed. `inputStyle` is `width: 100%`, so two of
 * them in a flex ROW each demand the full cell and wrap anyway — the stacking would have happened
 * by accident, with a comment claiming otherwise. And side by side is the wrong answer here even
 * where it fits: `orgUnitGridStyle` is `minmax(19rem, 1fr)`, so each field would get roughly 7rem
 * minus padding, which is not enough of an Arabic department name to proof-read.
 *
 * `minWidth: 0` lets the pair shrink instead of pushing the Rename/Save/Retire buttons off the row.
 * A named constant because `check:screen-pass` ratchets inline styles downward only.
 */
export const orgUnitRenameFieldsStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
  flex: '1 1 14rem',
  minWidth: 0,
};
