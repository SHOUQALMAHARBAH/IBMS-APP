import type { CSSProperties } from 'react';

export const programTableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  marginTop: '1rem',
};

export const programCellStyle: CSSProperties = {
  textAlign: 'start',
  padding: '0.5rem 0.6rem',
  borderBottom: '1px solid var(--border-subtle)',
  verticalAlign: 'top',
};

export const programCellNumStyle: CSSProperties = {
  ...programCellStyle,
  textAlign: 'end',
  fontVariantNumeric: 'tabular-nums',
};

export const programPanelStyle: CSSProperties = {
  marginTop: '1rem',
  padding: '1rem',
  border: '1px solid var(--border-default)',
  borderRadius: '0.5rem',
  background: 'var(--surface-sunken)',
};

export const programListCardStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'start',
  padding: '1rem',
  border: '1px solid var(--border-default)',
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
