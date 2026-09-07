import type { CSSProperties } from 'react';

export const listGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(16rem, 1fr))',
  gap: '1rem',
  marginTop: '1rem',
};

export const profileGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(14rem, 1fr))',
  gap: '1.25rem',
  marginTop: '1.5rem',
};

export const profileFieldLabelStyle: CSSProperties = {
  fontSize: '0.75rem',
  opacity: 0.6,
  textTransform: 'uppercase',
  letterSpacing: '0.02em',
};

export const profileFieldValueStyle: CSSProperties = {
  fontSize: '1rem',
  marginTop: '0.2rem',
};
