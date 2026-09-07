import type { CSSProperties } from 'react';

// The authenticated app shell: a fixed-width sidebar + a flexible content
// column. Every `app/(app)/*` page renders its own `<main style={pageStyle}>`
// (see components/lead/lead.styles.ts) into `contentStyle`, so this file must
// never add a second `<main>` landmark of its own.

export const shellStyle: CSSProperties = {
  display: 'flex',
  minHeight: '100vh',
  alignItems: 'stretch',
};

export const sidebarStyle: CSSProperties = {
  flex: '0 0 15rem',
  borderRight: '1px solid rgba(128,128,128,0.3)',
  padding: '1.5rem 1rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.15rem',
};

export const brandStyle: CSSProperties = {
  fontWeight: 'bold',
  fontSize: '1.1rem',
  padding: '0 0.75rem',
  marginBottom: '1.25rem',
};

export const navLinkStyle: CSSProperties = {
  display: 'block',
  padding: '0.5rem 0.75rem',
  borderRadius: '0.4rem',
  fontSize: '0.9rem',
};

export const navLinkActiveStyle: CSSProperties = {
  ...navLinkStyle,
  background: 'rgba(128,128,128,0.15)',
  fontWeight: 'bold',
};

export const contentStyle: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
};

export const sidebarFooterStyle: CSSProperties = {
  marginTop: 'auto',
  paddingTop: '1rem',
  borderTop: '1px solid rgba(128,128,128,0.2)',
  fontSize: '0.8rem',
  opacity: 0.8,
};

export const signOutButtonStyle: CSSProperties = {
  marginTop: '0.6rem',
  width: '100%',
  padding: '0.4rem',
  fontSize: '0.85rem',
  cursor: 'pointer',
};

// Home page — a responsive grid of module entry-point cards.
export const homeGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(16rem, 1fr))',
  gap: '1rem',
  marginTop: '2rem',
};

export const homeCardStyle: CSSProperties = {
  display: 'block',
  border: '1px solid rgba(128,128,128,0.3)',
  borderRadius: '0.5rem',
  padding: '1rem',
  background: 'var(--background)',
};

export const homeCardBlurbStyle: CSSProperties = {
  display: 'block',
  marginTop: '0.35rem',
  fontSize: '0.85rem',
  opacity: 0.75,
};
