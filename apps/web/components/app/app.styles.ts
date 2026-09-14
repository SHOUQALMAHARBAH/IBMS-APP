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
