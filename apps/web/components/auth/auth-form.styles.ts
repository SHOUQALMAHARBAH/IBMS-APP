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
  padding: 'var(--space-5)',
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
  padding: 'var(--space-5)',
  background: 'var(--surface-card)',
  // LONGHAND, DELIBERATELY, and never the `border` shorthand: the variant below
  // overrides `borderColor`, and React refuses to update a longhand on a rerender when the
  // shorthand is also set — *"can lead to styling bugs"*, which is its own warning
  // and not a style preference. Measured across the web tree: FOUR pairs had this
  // shape, and `style-shorthand-conflict.test.ts` refuses a fifth.
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'var(--border-default)',
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
  marginTop: 'var(--space-4)',
  width: '100%',
  padding: 'var(--space-2) var(--space-4)',
  fontFamily: 'inherit',
  fontSize: 'var(--text-base)',
  fontWeight: 'var(--weight-medium)' as CSSProperties['fontWeight'],
  // `--on-brand`, NOT a literal white, and the arithmetic is the reason: the dark theme flips
  // `--brand-600` to a light blue (#6bb0e6), where white measures 2.34:1 against the 7.70:1
  // the token gives. `Button`'s own `primary` variant already carried this exact note by name
  // and this file kept the literal — on the sign-in button, which is the first thing the
  // product shows anybody. Invisible to `literal-colours.py` until it read `.ts` as well as
  // `.tsx`, and invisible to axe because Playwright runs one theme.
  color: 'var(--on-brand)',
  background: 'var(--brand-600)',
  border: '1px solid var(--brand-600)',
  borderRadius: 'var(--radius-md)',
  minHeight: '2.5rem',
  cursor: 'pointer',
};

/*
 * Inline styles cannot express `:disabled`, and the auth screens have no
 * class hook — so a disabled submit button looked exactly like a live one.
 * That was tolerable while the only disabled window was the half-second of
 * submitting (the label changes to "Saving…", which says it), and is not
 * tolerable on the password screens, where the button stays disabled for as
 * long as the policy is unmet: the user sees a button that appears ready and
 * does nothing when clicked.
 *
 * Matches components/ui/Button.tsx's own inert treatment (opacity 0.55), the
 * one place `opacity` is still correct for muting — axe exempts disabled
 * controls from contrast, precisely because they are not actionable.
 */
export const buttonDisabledStyle: CSSProperties = {
  ...buttonStyle,
  opacity: 0.55,
  cursor: 'not-allowed',
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

/**
 * The manual-entry MFA key on `/settings/security` — the secret the QR encodes, shown as text for
 * anyone whose authenticator is on this device or who cannot scan. Monospace and selectable,
 * because it exists to be read and copied.
 */
export const manualKeyStyle: CSSProperties = {
  display: 'block',
  margin: '0.35rem 0',
  padding: '0.5rem 0.6rem',
  background: 'var(--surface-sunken)',
  border: '1px solid var(--border-default)',
  borderRadius: '0.35rem',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: '0.95rem',
  letterSpacing: '0.06em',
  userSelect: 'all',
  // A long key must wrap rather than widen the card.
  overflowWrap: 'anywhere',
  direction: 'ltr',
};

/*
 * THE PRE-SIGN-IN FORM, inside `AuthFrame`'s form panel.
 *
 * These three live here rather than inline on the screen for the reason the inline-style ratchet
 * exists: five auth screens share this shape, and five copies of `display: grid; gap` are five
 * chances for them to stop agreeing. `--space-4` is the scale's 16px step.
 */
export const authFormStyle: CSSProperties = {
  display: 'grid',
  gap: 'var(--space-4)',
};

export const authHeadingStyle: CSSProperties = {
  fontSize: 'var(--text-xl)',
};

/** A line of guidance above a field — never `opacity`, which globals.css forbids for text. */
export const authPromptStyle: CSSProperties = {
  fontSize: 'var(--text-sm)',
  color: 'var(--ink-secondary)',
};
