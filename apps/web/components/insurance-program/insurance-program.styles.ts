import type { CSSProperties } from 'react';

export const programTableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  marginTop: '1rem',
};

export const programCellStyle: CSSProperties = {
  textAlign: 'left',
  padding: '0.5rem 0.6rem',
  borderBottom: '1px solid rgba(128,128,128,0.2)',
  verticalAlign: 'top',
};

export const programCellNumStyle: CSSProperties = {
  ...programCellStyle,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
};

export const programPanelStyle: CSSProperties = {
  marginTop: '1rem',
  padding: '1rem',
  border: '1px solid rgba(128,128,128,0.3)',
  borderRadius: '0.5rem',
  background: 'rgba(128,128,128,0.05)',
};

export const programListCardStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '1rem',
  border: '1px solid rgba(128,128,128,0.3)',
  borderRadius: '0.5rem',
  cursor: 'pointer',
  marginBottom: '0.75rem',
};

export const programActionsStyle: CSSProperties = {
  display: 'flex',
  gap: '0.75rem',
  flexWrap: 'wrap',
  marginTop: '1.5rem',
};
