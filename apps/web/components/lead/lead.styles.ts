import type { CSSProperties } from 'react';

/*
 * Originally the Lead module's own styles; imported by 83 files across the
 * whole app, which made it the de-facto design system by accident. Rather
 * than leave that undeclared, it is now an explicit token consumer: every
 * value below reads a variable from globals.css, so the pages that already
 * import `pageStyle`/`cardStyle`/`sectionStyle` inherit the real design
 * without being edited one by one.
 *
 * New screens should compose `components/ui` primitives instead of importing
 * these; these exist to carry the existing 83 consumers, and the export
 * names and shapes are deliberately unchanged so none of them break.
 */

/*
 * THE PAGE FRAME every `app/(app)/*` screen renders into.
 *
 * `--space-5` (22px) rather than `--space-8` (32px): the owner's spacing scale is five steps —
 * 4 · 8 · 12 · 16 · 22 — and 32 is not one of them. This is the single highest-leverage spacing
 * change in the batch, because 110 screens read this one constant, so all of them land on the
 * scale at once rather than one at a time. It is also the value the approved reference screen
 * uses for its own page padding.
 *
 * `pageStackStyle` is the other half, and it is what actually makes boxes line up: a column with
 * ONE gap, so the space between a page header and its summary row is the same as between the
 * summary row and the table, on every screen, without any of them deciding. A per-element margin
 * is how a scale stops being a scale.
 */
export const pageStyle: CSSProperties = {
  maxWidth: 'var(--content-max)',
  margin: '0 auto',
  padding: 'var(--space-5)',
};

export const pageStackStyle: CSSProperties = {
  maxWidth: 'var(--content-max)',
  margin: '0 auto',
  padding: 'var(--space-5)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-5)',
  minWidth: 0,
};

export const sectionStyle: CSSProperties = {
  // Both on the five-step scale now — 22 and 16, where they were 32 and 24.
  marginTop: 'var(--space-5)',
  padding: 'var(--space-4)',
  background: 'var(--surface-card)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-sm)',
};

export const formRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--space-4)',
  alignItems: 'flex-end',
  marginTop: 'var(--space-4)',
};

export const fieldStyle: CSSProperties = { flex: '1 1 12rem' };

export const checkboxRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  marginTop: 'var(--space-4)',
};

export const boardStyle: CSSProperties = {
  display: 'flex',
  gap: 'var(--space-4)',
  marginTop: 'var(--space-4)',
  overflowX: 'auto',
  paddingBottom: 'var(--space-2)',
};

export const columnStyle: CSSProperties = {
  flex: '1 1 12rem',
  minWidth: '14rem',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-lg)',
  padding: 'var(--space-3)',
  background: 'var(--surface-sunken)',
};

export const columnHeaderStyle: CSSProperties = {
  fontSize: 'var(--text-xs)',
  fontWeight: 'var(--weight-semibold)' as CSSProperties['fontWeight'],
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--ink-muted)',
  marginBottom: 'var(--space-3)',
  display: 'flex',
  justifyContent: 'space-between',
};

export const cardStyle: CSSProperties = {
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-3)',
  marginBottom: 'var(--space-2)',
  background: 'var(--surface-card)',
  boxShadow: 'var(--shadow-sm)',
};

export const cardMetaStyle: CSSProperties = {
  fontSize: 'var(--text-xs)',
  color: 'var(--ink-muted)',
  marginTop: 'var(--space-1)',
};

export const cardActionsStyle: CSSProperties = {
  display: 'flex',
  gap: 'var(--space-2)',
  flexWrap: 'wrap',
  marginTop: 'var(--space-2)',
};

export const smallButtonStyle: CSSProperties = {
  padding: 'var(--space-1) var(--space-3)',
  fontFamily: 'inherit',
  fontSize: 'var(--text-sm)',
  fontWeight: 'var(--weight-medium)' as CSSProperties['fontWeight'],
  color: 'var(--ink-primary)',
  background: 'var(--surface-card)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
};

export const emptyColumnStyle: CSSProperties = {
  fontSize: 'var(--text-sm)',
  color: 'var(--ink-muted)',
};
