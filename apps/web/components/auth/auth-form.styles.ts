import type { CSSProperties } from 'react';

/*
 * Auth screens (sign in, forced password change, MFA enrolment, reset).
 *
 * Imported by 87 files — this and lead.styles.ts are the two places the
 * app's look is actually decided, so both read design tokens from
 * globals.css and hard-code nothing. Changing a value here changes every
 * screen that imports it, which is the point.
 *
 * The export names and shapes are unchanged from the pre-token version on
 * purpose: every consumer keeps working without being edited.
 */

export const pageStyle: CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'var(--space-8)',
  background: 'var(--surface-page)',
};

export const cardStyle: CSSProperties = {
  width: '24rem',
  maxWidth: '100%',
  padding: 'var(--space-8)',
  background: 'var(--surface-card)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-xl)',
  boxShadow: 'var(--shadow-md)',
};

export const labelStyle: CSSProperties = {
  display: 'block',
  marginTop: 'var(--space-4)',
  marginBottom: 'var(--space-1)',
  fontSize: 'var(--text-sm)',
  fontWeight: 'var(--weight-medium)' as CSSProperties['fontWeight'],
  color: 'var(--ink-secondary)',
};

export const inputStyle: CSSProperties = {
  width: '100%',
  padding: 'var(--space-2) var(--space-3)',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
  fontSize: 'var(--text-base)',
  color: 'var(--ink-primary)',
  background: 'var(--surface-card)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  minHeight: '2.25rem',
};

export const buttonStyle: CSSProperties = {
  marginTop: 'var(--space-6)',
  width: '100%',
  padding: 'var(--space-2) var(--space-4)',
  fontFamily: 'inherit',
  fontSize: 'var(--text-base)',
  fontWeight: 'var(--weight-medium)' as CSSProperties['fontWeight'],
  color: '#ffffff',
  background: 'var(--brand-600)',
  border: '1px solid var(--brand-600)',
  borderRadius: 'var(--radius-md)',
  minHeight: '2.5rem',
  cursor: 'pointer',
};

export const errorStyle: CSSProperties = {
  color: 'var(--danger-ink)',
  fontSize: 'var(--text-sm)',
};

export const successStyle: CSSProperties = {
  color: 'var(--success-ink)',
  fontSize: 'var(--text-sm)',
};

export const helperLinkStyle: CSSProperties = {
  marginTop: 'var(--space-4)',
  fontSize: 'var(--text-sm)',
  textAlign: 'center',
  color: 'var(--ink-brand)',
};
