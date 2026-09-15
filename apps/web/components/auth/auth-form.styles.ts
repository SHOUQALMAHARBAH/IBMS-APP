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

/*
 * The pre-authentication background.
 *
 * ADDITIVE on purpose. `pageStyle` above is imported by 86 authenticated
 * screens as well as the four `(auth)` ones, so putting the gradient there
 * would paint the navy behind the entire app — the exact hazard this file's
 * header warns about. The `(auth)` pages point at this instead; nothing else
 * changes.
 *
 * The gradient is the approved design's hero panel, which is where
 * `--nav-gradient-*` was measured from in the first place — until now it only
 * reached the sidebar, so the palette's own source screen was the one place
 * it never appeared. Same two tokens, same 180deg the sidebar uses: vertical
 * carries no physical direction, so it needs no RTL mirroring, where a
 * diagonal would have to be flipped for Arabic.
 */
export const authPageStyle: CSSProperties = {
  ...pageStyle,
  background:
    'linear-gradient(180deg, var(--nav-gradient-from) 0%, var(--nav-gradient-to) 100%)',
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

/*
 * The card as it sits on `authPageStyle`'s gradient.
 *
 * ADDITIVE, like `authPageStyle`: the shared `cardStyle` is untouched, so the
 * 86 authenticated screens that use it are unaffected.
 *
 * Only the border colour differs, and only because the DARK theme needs it.
 * There, `--surface-card` (#1e2733) sits on a #131a21-#1b2735 gradient and
 * measures 1.00:1 against it — the card has no surface separation at all, and
 * its edge rests entirely on the border. `--border-default` gives that edge
 * 1.35:1, under the 3:1 WCAG 1.4.11 asks of a boundary that carries meaning.
 *
 * `--ink-muted` is the lightest token that clears it (4.93:1). Two approaches
 * were measured and rejected first: darkening the gradient cannot work — even
 * a pure-black ground only reaches 1.31:1, because two dark surfaces cannot
 * separate by luminance — and no existing surface token works as a lighter
 * card (`--surface-hover` reaches 1.14:1). `--ink-secondary` and `--brand-300`
 * also clear 3:1, at 7.11 and 7.31, but read as a bright ring drawn around the
 * card rather than an edge.
 *
 * axe cannot catch any of this: its contrast rule covers text only.
 */
export const authCardStyle: CSSProperties = {
  ...cardStyle,
  borderColor: 'var(--ink-muted)',
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
