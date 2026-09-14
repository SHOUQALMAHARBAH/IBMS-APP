'use client';

import { useId } from 'react';
import type { CSSProperties, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

/*
 * Form field primitives.
 *
 * The error text is wired to the control with `aria-describedby` and
 * `aria-invalid` rather than merely rendered next to it, so the message a
 * sighted user reads is the same one a screen-reader user hears — the
 * directive's "name the exact field and the exact problem" (§2) only holds
 * if the association is real.
 */
const CONTROL: CSSProperties = {
  width: '100%',
  padding: 'var(--space-2) var(--space-3)',
  fontFamily: 'inherit',
  fontSize: 'var(--text-base)',
  color: 'var(--ink-primary)',
  background: 'var(--surface-card)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  minHeight: '2.25rem',
  transition: 'border-color var(--transition-fast), box-shadow var(--transition-fast)',
};

function controlStyle(invalid: boolean, extra?: CSSProperties): CSSProperties {
  return { ...CONTROL, ...(invalid ? { borderColor: 'var(--danger-border)' } : null), ...extra };
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
  style,
}: {
  label: ReactNode;
  /** Guidance shown before the user makes a mistake — cheaper than an error. */
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  /** Receives `id`, `aria-invalid` and `aria-describedby`. */
  children: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby': string | undefined }) => ReactNode;
  style?: CSSProperties;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div style={{ display: 'grid', gap: 'var(--space-1)', ...style }}>
      <label
        htmlFor={id}
        style={{
          fontSize: 'var(--text-sm)',
          fontWeight: 'var(--weight-medium)' as CSSProperties['fontWeight'],
          color: 'var(--ink-secondary)',
        }}
      >
        {label}
        {required ? (
          <span aria-hidden="true" style={{ color: 'var(--danger-ink)', marginInlineStart: '0.15rem' }}>
            *
          </span>
        ) : null}
      </label>
      {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': describedBy })}
      {hint ? (
        <p id={hintId} style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-muted)' }}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} style={{ fontSize: 'var(--text-xs)', color: 'var(--danger-ink)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TextInput({
  invalid = false,
  style,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input {...rest} style={controlStyle(invalid, style)} />;
}

export function Select({
  invalid = false,
  style,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select {...rest} style={controlStyle(invalid, style)}>
      {children}
    </select>
  );
}

export function TextArea({
  invalid = false,
  style,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea {...rest} style={controlStyle(invalid, { minHeight: '5rem', resize: 'vertical', ...style })} />;
}
