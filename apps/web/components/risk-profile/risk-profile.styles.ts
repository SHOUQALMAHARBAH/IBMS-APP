import type { CSSProperties } from 'react';

export const summaryPanelStyle: CSSProperties = {
  marginTop: '1rem',
  padding: '1rem',
  border: '1px solid rgba(128,128,128,0.3)',
  borderRadius: '0.5rem',
  background: 'rgba(128,128,128,0.05)',
};

export const summaryGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))',
  gap: '0.75rem',
  marginTop: '0.5rem',
};

export const summaryFigureLabelStyle: CSSProperties = {
  fontSize: '0.8rem',
  opacity: 0.7,
};

export const summaryFigureValueStyle: CSSProperties = {
  fontSize: '1.05rem',
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
};

export const assetTableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  marginTop: '1rem',
};

export const assetCellStyle: CSSProperties = {
  textAlign: 'left',
  padding: '0.5rem 0.6rem',
  borderBottom: '1px solid rgba(128,128,128,0.2)',
  verticalAlign: 'top',
};

export const assetFormStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.75rem',
  alignItems: 'flex-end',
  marginTop: '1rem',
  padding: '1rem',
  border: '1px solid rgba(128,128,128,0.3)',
  borderRadius: '0.5rem',
};

export const assetFieldStyle: CSSProperties = { flex: '1 1 10rem' };

export const siteCardStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '1rem',
  border: '1px solid rgba(128,128,128,0.3)',
  borderRadius: '0.5rem',
  cursor: 'pointer',
  marginBottom: '0.75rem',
};
