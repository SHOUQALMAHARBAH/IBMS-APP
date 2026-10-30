'use client';

import { useId } from 'react';
import type { CSSProperties, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

import { formatDate } from '../../lib/i18n/format';
import { useLanguage } from '../../lib/i18n/language-context';

/*
 * Form field primitives.
 *
 * The error text is wired to the control with `aria-describedby` and
 * `aria-invalid` rather than merely rendered next to it, so the message a
 * sighted user reads is the same one a screen-reader user hears — the
 * directive's "name the exact field and the exact problem" (§2) only holds
 * if the association is real.
 */
/**
 * THE ONE CONTROL APPEARANCE, exported so the picker can wear it too.
 *
 * `EntitySearch` rendered a bare `<input>` with no style at all and therefore the browser's own
 * control chrome — beside one of these, two controls from two different applications, and on a
 * dark screen a light UA-painted box. Exporting it is what makes "an input looks like an input"
 * one fact rather than two.
 */
export const CONTROL: CSSProperties = {
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

/**
 * A hint's appearance and its id, in ONE place.
 *
 * Exported because NOT ONE of the nine sites the owner wrote hints for goes through `Field` --
 * every one is a raw `<label>` wrapper -- so without this each would hand-roll a `<p>` and the
 * product would have nine answers to what guidance looks like. The caller supplies the `id` and
 * points its control's `aria-describedby` at it: the association has to be real, which is the same
 * reason `Field` wires its error text rather than merely rendering it beside the control.
 */
export function Hint({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-muted)' }}>
      {children}
    </p>
  );
}

/**
 * The date the system UNDERSTOOD, echoed back under the field.
 *
 * `<input type="date">` renders its placeholder in the user agent's own order, which on this
 * machine is MONTH-FIRST: `03/04` meaning 3 April is stored as 4 March, a valid date that is
 * silently wrong. A hint cannot carry the format -- the format is not ours and differs per
 * machine -- so the echo shows what was read instead of claiming what to type.
 *
 * `aria-hidden` and deliberately NOT in `aria-describedby`: the input already announces its own
 * value, so an echo in the accessibility tree is the same fact twice on every focus.
 */
export function DateEcho({ value }: { value: string }) {
  const { language } = useLanguage();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) {
    return null;
  }
  // LOCAL midnight, never `new Date(value)`: that is UTC midnight, and `toLocaleDateString`
  // renders in local time, so west of UTC the echo would show the day before -- an off-by-one in
  // the one control whose whole job is confirming which day was understood.
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return (
    <p
      aria-hidden="true"
      data-date-echo={value}
      style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-secondary)' }}
    >
      {formatDate(d, language)}
    </p>
  );
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
      {hint && hintId ? <Hint id={hintId}>{hint}</Hint> : null}
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
