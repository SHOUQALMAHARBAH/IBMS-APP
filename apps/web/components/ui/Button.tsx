'use client';

import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';

/*
 * The one button in the system. Frontend directive §6: the same action is
 * styled the same way in every module, so a variant is chosen by what the
 * action MEANS, never by which screen it happens to be on.
 *
 *   primary   the single main action on a screen (Submit, Approve, Save)
 *   secondary a real but non-primary action (Cancel, Export, Back)
 *   danger    destructive or refusing (Delete, Reject) — always paired with
 *             a confirmation step, never a one-click destroy
 *   ghost     low-emphasis, typically inside a table row or card header
 */
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md';

const BASE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--space-2)',
  fontFamily: 'inherit',
  fontWeight: 'var(--weight-medium)' as CSSProperties['fontWeight'],
  borderRadius: 'var(--radius-md)',
  border: '1px solid transparent',
  cursor: 'pointer',
  transition: 'background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast)',
  whiteSpace: 'nowrap',
  textDecoration: 'none',
};

const SIZES: Record<ButtonSize, CSSProperties> = {
  sm: { padding: 'var(--space-1) var(--space-3)', fontSize: 'var(--text-sm)', minHeight: '1.875rem' },
  md: { padding: 'var(--space-2) var(--space-4)', fontSize: 'var(--text-base)', minHeight: '2.25rem' },
};

const VARIANTS: Record<ButtonVariant, CSSProperties> = {
  primary: {
    background: 'var(--brand-600)',
    borderColor: 'var(--brand-600)',
    color: '#ffffff',
  },
  secondary: {
    background: 'var(--surface-card)',
    borderColor: 'var(--border-default)',
    color: 'var(--ink-primary)',
  },
  danger: {
    background: 'var(--danger-bg)',
    borderColor: 'var(--danger-border)',
    color: 'var(--danger-ink)',
  },
  ghost: {
    background: 'transparent',
    borderColor: 'transparent',
    color: 'var(--ink-brand)',
  },
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Renders the button inert with a busy cursor and blocks the click. */
  loading?: boolean;
  fullWidth?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  fullWidth = false,
  disabled,
  style,
  children,
  ...rest
}: ButtonProps) {
  const isInert = disabled || loading;
  return (
    <button
      {...rest}
      disabled={isInert}
      aria-busy={loading || undefined}
      style={{
        ...BASE,
        ...SIZES[size],
        ...VARIANTS[variant],
        ...(fullWidth ? { width: '100%' } : null),
        ...(isInert ? { opacity: 0.55, cursor: loading ? 'progress' : 'not-allowed' } : null),
        ...style,
      }}
    >
      {children}
    </button>
  );
}
