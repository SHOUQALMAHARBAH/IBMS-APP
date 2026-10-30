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

/**
 * `data-*` ATTRIBUTES ARE FORWARDED, AND THIS TYPE IS WHY THAT IS SAFE.
 *
 * TypeScript exempts hyphen-containing JSX attributes from excess-property checking, so
 * `<Badge data-claim-status={…}>` type-checks against ANY component and then goes NOWHERE unless
 * the component spreads it. That silent drop already killed three test hooks in this batch with
 * `tsc` clean and the screens rendering perfectly — the only thing that caught it was a screenshot
 * capture failing to find a selector.
 *
 * A status pill is exactly where a screen hangs its machine hook (`data-claim-status`,
 * `data-rfq-state`, …), so naming one attribute the way `EmptyState` names `data-testid` would not
 * be enough: every screen uses its own. The template-literal index signature accepts the whole
 * family and the spread forwards it, which makes the support a PROPERTY OF THE SIGNATURE rather
 * than something a reader has to go and verify in the body.
 */
type DataAttributes = { [key: `data-${string}`]: string | undefined };

export function Badge({
  tone = 'neutral',
  children,
  style,
  ...dataAttributes
}: {
  tone?: BadgeTone;
  children: ReactNode;
  style?: CSSProperties;
} & DataAttributes) {
  return (
    <span
      {...dataAttributes}
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
