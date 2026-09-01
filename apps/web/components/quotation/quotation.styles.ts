import type { CSSProperties } from 'react';

export const quoteChainCardStyle: CSSProperties = {
  padding: '1rem',
  border: '1px solid rgba(128,128,128,0.3)',
  borderRadius: '0.5rem',
  marginBottom: '0.75rem',
};

export const quoteTermGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))',
  gap: '0.5rem 1.5rem',
  marginTop: '0.5rem',
};

export const quoteTermLabelStyle: CSSProperties = {
  display: 'block',
  fontSize: '0.75rem',
  opacity: 0.6,
  textTransform: 'uppercase',
  letterSpacing: '0.02em',
};

export const quoteTermValueStyle: CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
};

export const quoteFieldStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
  marginBottom: '0.6rem',
};

export const quoteFormGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))',
  gap: '0 1rem',
};

export const quoteHistoryPreStyle: CSSProperties = {
  whiteSpace: 'pre-wrap',
  margin: '0.25rem 0 0',
  fontSize: '0.85rem',
};
