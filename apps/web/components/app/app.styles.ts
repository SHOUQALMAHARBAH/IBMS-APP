import type { CSSProperties } from 'react';

// The authenticated app shell: a fixed-width sidebar + a flexible content
// column. Every `app/(app)/*` page renders its own `<main style={pageStyle}>`
// (see components/lead/lead.styles.ts) into `contentStyle`, so this file must
// never add a second `<main>` landmark of its own.
//
// The sidebar carries the navy from the approved design's hero panel
// (--nav-gradient-*), which is what makes the shell read as one product
// rather than a default admin template. All values are tokens from
// globals.css; nothing here hard-codes a colour.

export const shellStyle: CSSProperties = {
  display: 'flex',
  minHeight: '100vh',
  alignItems: 'stretch',
};

export const sidebarStyle: CSSProperties = {
  flex: `0 0 var(--sidebar-width)`,
  width: 'var(--sidebar-width)',
  // Logical, not `borderRight` — `shellStyle`'s plain `flex-direction: row`
  // already mirrors the sidebar to the opposite screen edge for free under
  // `dir="rtl"` (Part F item #1's `<html dir>`); a physical `borderRight`
  // would then land on the OUTER edge instead of the one touching
  // `contentStyle`, which is what this separator is actually for.
  borderInlineEnd: '1px solid var(--nav-divider)',
  background: 'linear-gradient(180deg, var(--nav-gradient-from) 0%, var(--nav-gradient-to) 100%)',
  color: 'var(--nav-ink)',
  padding: 'var(--space-5) var(--space-3)',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.1rem',
  // The nav is taller than the viewport for a broadly-permissioned role, so
  // it scrolls itself rather than the page.
  position: 'sticky',
  top: 0,
  maxHeight: '100vh',
  overflowY: 'auto',
};

export const brandStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  fontWeight: 'var(--weight-bold)' as CSSProperties['fontWeight'],
  fontSize: 'var(--text-lg)',
  letterSpacing: '0.02em',
  color: 'var(--nav-ink)',
  padding: '0 var(--space-2)',
  marginBottom: 'var(--space-5)',
};

/** The section heading above each group of links. */
export const navGroupLabelStyle: CSSProperties = {
  padding: 'var(--space-4) var(--space-2) var(--space-1)',
  fontSize: 'var(--text-xs)',
  fontWeight: 'var(--weight-semibold)' as CSSProperties['fontWeight'],
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--nav-ink-muted)',
};

/*
 * The same heading, now as a <summary>. `display` is deliberately left alone:
 * <summary> is `display: list-item`, and overriding it (to flex, say, for a
 * count badge on the end) REMOVES the disclosure marker in Chrome. Keeping the
 * marker is worth more than the badge — the browser draws it, and it points
 * the correct way under `dir="rtl"` with no work from us, which a
 * hand-rolled chevron would not. Focus comes from globals.css's single
 * `:focus-visible` rule.
 */
export const navGroupSummaryStyle: CSSProperties = {
  ...navGroupLabelStyle,
  cursor: 'pointer',
  // `outside` (the default for a list-item) puts the marker in the margin,
  // where it clips against the rail edge in RTL and forces an indent so deep
  // that the group's own items end up further LEFT than their heading —
  // hierarchy read backwards. `inside` makes the marker the first inline box,
  // so the heading starts just after it and navGroupItemsStyle can sit a
  // hair further in, which is the way round a reader expects.
  listStylePosition: 'inside',
  // A group header is not a text selection target — double-clicking one to
  // open it should not leave the label highlighted.
  userSelect: 'none',
};

/** Holds a group's links, indented just past its heading text so the nesting
 *  reads as nesting. */
export const navGroupItemsStyle: CSSProperties = {
  paddingInlineStart: 'var(--space-3)',
};

/** Wraps the search field. Full-bleed inside the rail's own padding. */
export const navSearchWrapStyle: CSSProperties = {
  padding: '0 var(--space-2)',
  marginBottom: 'var(--space-3)',
};

/*
 * The app's standard control surface on the navy rail, rather than a
 * transparent input tinted with `--nav-ink`. Two reasons, both measured
 * rather than aesthetic: `--surface-card` is the ground the global
 * `::placeholder` colour (`--ink-muted`) was contrast-checked against in
 * both themes, and a transparent input would need a border token of its own
 * to clear WCAG 1.4.11 against the gradient — the same problem the auth card
 * hit, which took `--ink-muted` at 4.99:1 to solve.
 */
export const navSearchInputStyle: CSSProperties = {
  width: '100%',
  fontSize: 'var(--text-sm)',
  padding: 'var(--space-2) var(--space-3)',
};

/** The "N matches" / no-results line under the field. */
export const navSearchStatusStyle: CSSProperties = {
  padding: 'var(--space-1) var(--space-2) 0',
  fontSize: 'var(--text-xs)',
  color: 'var(--nav-ink-muted)',
};

export const navLinkStyle: CSSProperties = {
  display: 'block',
  padding: 'var(--space-2) var(--space-3)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--text-base)',
  color: 'var(--nav-ink)',
  opacity: 0.85,
  transition: 'background var(--transition-fast), opacity var(--transition-fast)',
  // Long module names wrap rather than overflow the fixed-width rail.
  overflowWrap: 'anywhere',
};

export const navLinkActiveStyle: CSSProperties = {
  ...navLinkStyle,
  background: 'var(--nav-item-active)',
  opacity: 1,
  fontWeight: 'var(--weight-semibold)' as CSSProperties['fontWeight'],
};

export const contentStyle: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  background: 'var(--surface-page)',
};

export const sidebarFooterStyle: CSSProperties = {
  marginTop: 'auto',
  paddingTop: 'var(--space-4)',
  marginInline: 'var(--space-2)',
  borderTop: '1px solid var(--nav-divider)',
  fontSize: 'var(--text-xs)',
  color: 'var(--nav-ink-muted)',
};

export const signOutButtonStyle: CSSProperties = {
  marginTop: 'var(--space-3)',
  width: '100%',
  padding: 'var(--space-2)',
  fontFamily: 'inherit',
  fontSize: 'var(--text-sm)',
  fontWeight: 'var(--weight-medium)' as CSSProperties['fontWeight'],
  color: 'var(--nav-ink)',
  background: 'rgba(255, 255, 255, 0.1)',
  border: '1px solid var(--nav-divider)',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
};

// Home page — a responsive grid of module entry-point cards.
export const homeGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(16rem, 1fr))',
  gap: 'var(--space-4)',
  marginTop: 'var(--space-8)',
};

export const homeCardStyle: CSSProperties = {
  display: 'block',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-lg)',
  padding: 'var(--space-4)',
  background: 'var(--surface-card)',
  boxShadow: 'var(--shadow-sm)',
  transition: 'box-shadow var(--transition-fast), border-color var(--transition-fast)',
};

export const homeCardBlurbStyle: CSSProperties = {
  display: 'block',
  marginTop: 'var(--space-1)',
  fontSize: 'var(--text-sm)',
  color: 'var(--ink-secondary)',
};
