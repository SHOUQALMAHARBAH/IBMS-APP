import type { CSSProperties } from 'react';

export const rfqCardStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '1rem',
  border: '1px solid rgba(128,128,128,0.3)',
  borderRadius: '0.5rem',
  cursor: 'pointer',
  marginBottom: '0.75rem',
};

export const rfqPanelStyle: CSSProperties = {
  marginTop: '1rem',
  padding: '1rem',
  border: '1px solid rgba(128,128,128,0.3)',
  borderRadius: '0.5rem',
  background: 'rgba(128,128,128,0.05)',
};

export const rfqTableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  marginTop: '1rem',
};

export const rfqCellStyle: CSSProperties = {
  textAlign: 'left',
  padding: '0.5rem 0.6rem',
  borderBottom: '1px solid rgba(128,128,128,0.2)',
  verticalAlign: 'top',
};

export const rfqBadgeStyle: CSSProperties = {
  display: 'inline-block',
  padding: '0.1rem 0.5rem',
  borderRadius: '0.75rem',
  fontSize: '0.8rem',
  border: '1px solid rgba(128,128,128,0.4)',
};

export const rfqActionsStyle: CSSProperties = {
  display: 'flex',
  gap: '0.75rem',
  flexWrap: 'wrap',
  marginTop: '1.5rem',
  alignItems: 'flex-start',
};

export const insurerPickerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.4rem',
  marginTop: '0.5rem',
  maxHeight: '16rem',
  overflowY: 'auto',
  border: '1px solid rgba(128,128,128,0.3)',
  borderRadius: '0.5rem',
  padding: '0.75rem',
};

export const rfqFieldStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
  marginBottom: '0.75rem',
  maxWidth: '32rem',
};

export const commBodyStyle: CSSProperties = {
  whiteSpace: 'pre-wrap',
  margin: '0.25rem 0 0',
};
