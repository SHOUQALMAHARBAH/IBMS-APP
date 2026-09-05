import type { CSSProperties } from 'react';

export const comparisonScrollStyle: CSSProperties = {
  overflowX: 'auto',
  marginTop: '1rem',
};

export const comparisonCalloutStyle: CSSProperties = {
  marginTop: '0.75rem',
  padding: '0.6rem 0.9rem',
  border: '1px solid rgba(128,128,128,0.3)',
  borderRadius: '0.5rem',
  fontSize: '0.9rem',
};

export const comparisonScoreGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(8rem, 1fr) 7rem 7rem',
  gap: '0.4rem 0.75rem',
  alignItems: 'center',
  marginTop: '0.5rem',
  maxWidth: '30rem',
};

export const comparisonPreStyle: CSSProperties = {
  whiteSpace: 'pre-wrap',
  margin: 0,
  fontSize: '0.82rem',
  maxWidth: '18rem',
};
