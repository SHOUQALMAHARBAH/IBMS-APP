import type { CSSProperties } from 'react';

export const pageStyle: CSSProperties = {
  maxWidth: '60rem',
  margin: '0 auto',
  padding: '2rem',
};

export const sectionStyle: CSSProperties = {
  marginTop: '2rem',
  padding: '1.5rem',
  border: '1px solid rgba(128,128,128,0.3)',
  borderRadius: '0.5rem',
};

export const formRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '1rem',
  alignItems: 'flex-end',
  marginTop: '1rem',
};

export const fieldStyle: CSSProperties = { flex: '1 1 12rem' };

export const inlineButtonStyle: CSSProperties = {
  padding: '0.5rem 1rem',
  cursor: 'pointer',
};

export const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  marginTop: '1rem',
};

export const thStyle: CSSProperties = {
  textAlign: 'start',
  padding: '0.5rem',
  borderBottom: '1px solid rgba(128,128,128,0.3)',
  fontSize: '0.85rem',
  opacity: 0.75,
};

export const tdStyle: CSSProperties = {
  padding: '0.5rem',
  borderBottom: '1px solid rgba(128,128,128,0.15)',
  verticalAlign: 'top',
};

export const roleBadgeStyle: CSSProperties = {
  display: 'inline-block',
  fontSize: '0.75rem',
  padding: '0.15rem 0.5rem',
  borderRadius: '999px',
  border: '1px solid rgba(128,128,128,0.4)',
  marginInlineEnd: '0.25rem',
  marginBottom: '0.25rem',
};

export const adminBadgeStyle: CSSProperties = {
  ...roleBadgeStyle,
  borderColor: '#d33',
  color: '#d33',
  fontWeight: 'bold',
};

export const decisionButtonRowStyle: CSSProperties = {
  display: 'flex',
  gap: '0.5rem',
  flexWrap: 'wrap',
};

export const decidedTagStyle: CSSProperties = {
  fontSize: '0.85rem',
  fontWeight: 'bold',
};

export const emptyStateStyle: CSSProperties = {
  marginTop: '1.5rem',
  opacity: 0.75,
};
