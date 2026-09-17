import type { CSSProperties } from 'react';

export const stepIndicatorStyle: CSSProperties = {
  display: 'flex',
  gap: '0.5rem',
  marginBottom: '1.5rem',
  fontSize: '0.85rem',
  flexWrap: 'wrap',
};

export const stepPillStyle = (active: boolean, done: boolean): CSSProperties => ({
  padding: '0.3rem 0.7rem',
  borderRadius: '999px',
  border: '1px solid var(--border-strong)',
  opacity: active ? 1 : done ? 0.8 : 0.5,
  background: active ? 'var(--surface-sunken)' : done ? 'var(--success-bg)' : 'transparent',
  fontWeight: active ? 'bold' : 'normal',
});

export const wizardNavStyle: CSSProperties = {
  display: 'flex',
  gap: '0.75rem',
  marginTop: '1.5rem',
};

export const repeatableRowStyle: CSSProperties = {
  border: '1px solid var(--border-default)',
  borderRadius: '0.4rem',
  padding: '0.75rem',
  marginTop: '0.75rem',
};

export const badgeStyle = (tone: 'neutral' | 'warn' | 'good' | 'bad'): CSSProperties => {
  // The four semantic surfaces, not four hand-mixed washes. Only `neutral`
  // was in the grey sweep's scope, but a tone map with one token and three
  // literals is worse than either extreme, and these map one-to-one.
  const colors: Record<typeof tone, string> = {
    neutral: 'var(--surface-sunken)',
    warn: 'var(--warning-bg)',
    good: 'var(--success-bg)',
    bad: 'var(--danger-bg)',
  };
  return {
    display: 'inline-block',
    padding: '0.15rem 0.5rem',
    borderRadius: '0.3rem',
    fontSize: '0.75rem',
    background: colors[tone],
  };
};

export const queueTableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  marginTop: '1rem',
  fontSize: '0.9rem',
};

export const queueCellStyle: CSSProperties = {
  padding: '0.5rem',
  borderBottom: '1px solid var(--border-subtle)',
  textAlign: 'start',
  verticalAlign: 'top',
};
