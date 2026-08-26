import type { CSSProperties } from 'react';

export const pageStyle: CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '2rem',
};

export const cardStyle: CSSProperties = {
  width: '24rem',
  maxWidth: '100%',
  padding: '2rem',
  border: '1px solid rgba(128,128,128,0.3)',
  borderRadius: '0.5rem',
};

export const labelStyle: CSSProperties = { display: 'block', marginTop: '1rem', marginBottom: '0.25rem' };
export const inputStyle: CSSProperties = { width: '100%', padding: '0.5rem', boxSizing: 'border-box' };
export const buttonStyle: CSSProperties = { marginTop: '1.5rem', width: '100%', padding: '0.6rem', cursor: 'pointer' };
export const errorStyle: CSSProperties = { color: '#d33', fontSize: '0.9rem' };
export const successStyle: CSSProperties = { color: '#2a8', fontSize: '0.9rem' };
export const helperLinkStyle: CSSProperties = { marginTop: '1rem', fontSize: '0.9rem', textAlign: 'center' };
