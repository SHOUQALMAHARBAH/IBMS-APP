import type { InputHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/*
 * A LABELLED FIELD WITH ITS ICON INSIDE THE CONTROL — the pre-sign-in form's field shape, and the
 * one reference page B uses.
 *
 * The border lives on the WRAPPER and the input itself is borderless, which is what lets the whole
 * control light up on focus rather than only the text box inside it: `:focus-within` on the
 * wrapper. That is also why the focus treatment is in `globals.css` as a `:focus-visible` rule and
 * this file sets none of its own — one focus style for the whole app, which the accessibility suite
 * asserts on.
 *
 * THE ICON IS DECORATIVE AND THE LABEL IS THE NAME. `Icon` is `aria-hidden`, the `<label>` is tied
 * to the control by `htmlFor`, and the icon adds nothing to the accessible name — an envelope
 * beside the word *Email* is a cue for a sighted reader and noise for a screen reader.
 *
 * `dir` is passed through rather than guessed: an email address and a password are LATIN whatever
 * language the interface is in, so the login screen sets `dir="ltr"` on them. A six-digit
 * authenticator code is also Latin. Guessing from the interface language would put the cursor at
 * the wrong end of an email field for every Arabic reader.
 */
export function IconField({
  id,
  label,
  icon,
  hint,
  ...input
}: {
  id: string;
  label: ReactNode;
  icon: IconName;
  /** Guidance shown before the reader makes a mistake — cheaper than an error. */
  hint?: ReactNode;
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div style={{ display: 'grid', gap: 'var(--space-1)', minWidth: 0 }}>
      <label htmlFor={id} style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)' }}>
        {label}
      </label>
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--surface-sunken)',
          padding: '0 var(--space-3)',
          transition: 'border-color var(--transition-base), background var(--transition-base)',
          minWidth: 0,
        }}
      >
        <Icon name={icon} size={16} style={{ color: 'var(--ink-muted)' }} />
        <input
          {...input}
          id={id}
          style={{
            border: 'none',
            background: 'none',
            outline: 'none',
            padding: 'var(--space-3) 0',
            width: '100%',
            minWidth: 0,
            fontFamily: 'inherit',
            fontSize: 'var(--text-base)',
            color: 'var(--ink-primary)',
          }}
        />
      </span>
      {hint ? (
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-muted)' }}>{hint}</span>
      ) : null}
    </div>
  );
}
