import type { CSSProperties } from 'react';

export const questionRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.75rem',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  padding: '0.75rem 0',
  borderBottom: '1px solid rgba(128,128,128,0.2)',
};

export const questionPromptStyle: CSSProperties = {
  flex: '1 1 20rem',
};

export const coveragePreviewStyle: CSSProperties = {
  marginTop: '1.5rem',
  padding: '1rem',
  border: '1px solid rgba(128,128,128,0.3)',
  borderRadius: '0.5rem',
  background: 'rgba(128,128,128,0.05)',
};

export const coverageTagListStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.5rem',
  marginTop: '0.5rem',
  listStyle: 'none',
  padding: 0,
};

export const coverageTagStyle: CSSProperties = {
  padding: '0.25rem 0.6rem',
  fontSize: '0.85rem',
  border: '1px solid rgba(128,128,128,0.4)',
  borderRadius: '999px',
};

export const listGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(18rem, 1fr))',
  gap: '1rem',
  marginTop: '1rem',
};

export const reviewPanelStyle: CSSProperties = {
  marginTop: '2rem',
  padding: '1.5rem',
  border: '1px solid rgba(128,128,128,0.3)',
  borderRadius: '0.5rem',
};

export const reviewActionsStyle: CSSProperties = {
  display: 'flex',
  gap: '0.6rem',
  flexWrap: 'wrap',
  marginTop: '1rem',
};
