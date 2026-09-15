import type { CSSProperties, ReactNode } from 'react';

/*
 * A status pill. Tone is chosen by MEANING, not by which module renders it —
 * a workflow state that blocks progress is `warning` in Claims and in Policy
 * alike (frontend directive §6, same-meaning-same-appearance).
 */
export type BadgeTone = 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'danger';

const TONES: Record<BadgeTone, CSSProperties> = {
  neutral: { background: 'var(--surface-sunken)', color: 'var(--ink-secondary)', borderColor: 'var(--border-default)' },
  brand: { background: 'var(--brand-50)', color: 'var(--brand-700)', borderColor: 'var(--brand-200)' },
  info: { background: 'var(--info-bg)', color: 'var(--info-ink)', borderColor: 'var(--info-border)' },
  success: { background: 'var(--success-bg)', color: 'var(--success-ink)', borderColor: 'var(--success-border)' },
  warning: { background: 'var(--warning-bg)', color: 'var(--warning-ink)', borderColor: 'var(--warning-border)' },
  danger: { background: 'var(--danger-bg)', color: 'var(--danger-ink)', borderColor: 'var(--danger-border)' },
};

export function Badge({
  tone = 'neutral',
  children,
  style,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-1)',
        padding: '0.125rem var(--space-2)',
        borderRadius: 'var(--radius-full)',
        border: '1px solid',
        fontSize: 'var(--text-xs)',
        fontWeight: 'var(--weight-medium)' as CSSProperties['fontWeight'],
        lineHeight: 1.6,
        whiteSpace: 'nowrap',
        ...TONES[tone],
        ...style,
      }}
    >
      {children}
    </span>
  );
}
