import type { CSSProperties } from 'react';

export const pageStyle: CSSProperties = {
  maxWidth: '75rem',
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

export const checkboxRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  marginTop: '1rem',
};

export const boardStyle: CSSProperties = {
  display: 'flex',
  gap: '1rem',
  marginTop: '1rem',
  overflowX: 'auto',
  paddingBottom: '0.5rem',
};

export const columnStyle: CSSProperties = {
  flex: '1 1 12rem',
  minWidth: '14rem',
  border: '1px solid rgba(128,128,128,0.3)',
  borderRadius: '0.5rem',
  padding: '0.75rem',
  background: 'rgba(128,128,128,0.05)',
};

export const columnHeaderStyle: CSSProperties = {
  fontSize: '0.85rem',
  fontWeight: 'bold',
  opacity: 0.8,
  marginBottom: '0.75rem',
  display: 'flex',
  justifyContent: 'space-between',
};

export const cardStyle: CSSProperties = {
  border: '1px solid rgba(128,128,128,0.3)',
  borderRadius: '0.4rem',
  padding: '0.6rem',
  marginBottom: '0.6rem',
  background: 'var(--background)',
};

export const cardMetaStyle: CSSProperties = {
  fontSize: '0.75rem',
  opacity: 0.7,
  marginTop: '0.2rem',
};

export const cardActionsStyle: CSSProperties = {
  display: 'flex',
  gap: '0.4rem',
  flexWrap: 'wrap',
  marginTop: '0.5rem',
};

export const smallButtonStyle: CSSProperties = {
  padding: '0.3rem 0.6rem',
  fontSize: '0.8rem',
  cursor: 'pointer',
};

export const emptyColumnStyle: CSSProperties = {
  fontSize: '0.8rem',
  opacity: 0.6,
};
