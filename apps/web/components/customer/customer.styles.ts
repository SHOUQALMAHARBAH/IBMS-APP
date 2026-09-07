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
  border: '1px solid rgba(128,128,128,0.4)',
  opacity: active ? 1 : done ? 0.8 : 0.5,
  background: active ? 'rgba(128,128,128,0.15)' : done ? 'rgba(40,170,120,0.12)' : 'transparent',
  fontWeight: active ? 'bold' : 'normal',
});

export const wizardNavStyle: CSSProperties = {
  display: 'flex',
  gap: '0.75rem',
  marginTop: '1.5rem',
};

export const repeatableRowStyle: CSSProperties = {
  border: '1px solid rgba(128,128,128,0.25)',
  borderRadius: '0.4rem',
  padding: '0.75rem',
  marginTop: '0.75rem',
};

export const badgeStyle = (tone: 'neutral' | 'warn' | 'good' | 'bad'): CSSProperties => {
  const colors: Record<typeof tone, string> = {
    neutral: 'rgba(128,128,128,0.2)',
    warn: 'rgba(220,170,20,0.2)',
    good: 'rgba(40,170,120,0.2)',
    bad: 'rgba(210,50,50,0.2)',
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
  borderBottom: '1px solid rgba(128,128,128,0.2)',
  textAlign: 'left',
  verticalAlign: 'top',
};
