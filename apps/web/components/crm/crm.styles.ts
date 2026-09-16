import type { CSSProperties } from 'react';

export const crmPanelStyle: CSSProperties = {
  marginTop: '1rem',
  padding: '1rem',
  border: '1px solid var(--border-default)',
  borderRadius: '0.5rem',
  background: 'var(--surface-sunken)',
};

export const crmFormRowStyle: CSSProperties = {
  display: 'flex',
  gap: '0.75rem',
  flexWrap: 'wrap',
  alignItems: 'flex-end',
  marginTop: '1rem',
};

export const crmCountRowStyle: CSSProperties = {
  display: 'flex',
  gap: '1.5rem',
  flexWrap: 'wrap',
  marginTop: '0.5rem',
  opacity: 0.85,
  fontVariantNumeric: 'tabular-nums',
};

export const crmTimelineItemStyle: CSSProperties = {
  display: 'flex',
  gap: '0.9rem',
  padding: '0.75rem 0',
  borderTop: '1px solid var(--border-subtle)',
};

export const crmKindBadgeStyle: CSSProperties = {
  display: 'inline-block',
  padding: '0.1rem 0.5rem',
  borderRadius: '0.75rem',
  fontSize: '0.7rem',
  letterSpacing: '0.03em',
  border: '1px solid var(--border-strong)',
  whiteSpace: 'nowrap',
  alignSelf: 'flex-start',
};

export const crmTimelineWhenStyle: CSSProperties = {
  fontSize: '0.75rem',
  opacity: 0.7,
  marginTop: '0.15rem',
};
