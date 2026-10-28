import type { CSSProperties } from 'react';

// The authenticated app shell: a fixed-width sidebar + a flexible content
// column. Every `app/(app)/*` page renders its own `<main style={pageStyle}>`
// (see components/lead/lead.styles.ts) into `contentStyle`, so this file must
// never add a second `<main>` landmark of its own.
//
// The sidebar carries the navy from the approved design's hero panel
// (--nav-gradient-*), which is what makes the shell read as one product
// rather than a default admin template. All values are tokens from
// globals.css; nothing here hard-codes a colour.

/** The whole authenticated frame: navbar across the top, then everything
 *  else. The inner row is `shellRowStyle`. */
export const shellStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: '100vh',
};

/** Sidebar + content. Was `shellStyle` itself until the navbar landed above
 *  it; a plain `flex-direction: row` is still what mirrors the sidebar to the
 *  opposite screen edge under `dir="rtl"` for free. */
export const shellRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  flex: '1 1 auto',
  minHeight: 0,
};

/**
 * The navbar's own height, as a token rather than a literal, because THREE
 * things have to agree on it: the bar itself, the sidebar's sticky offset, and
 * the sidebar's max-height. Get them out of step and the sidebar either slides
 * under the bar or grows a phantom scrollbar exactly one bar tall.
 */
export const NAVBAR_HEIGHT = '3.5rem';

export const navbarStyle: CSSProperties = {
  flex: `0 0 ${NAVBAR_HEIGHT}`,
  height: NAVBAR_HEIGHT,
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-3)',
  padding: '0 var(--space-4)',
  background: 'var(--nav-bg)',
  color: 'var(--nav-ink)',
  // Logical: the divider belongs on the edge touching the content below,
  // which is the same reasoning as `sidebarStyle`'s borderInlineEnd.
  borderBlockEnd: '1px solid var(--nav-divider)',
  position: 'sticky',
  top: 0,
  zIndex: 20,
};

/*
 * THE BREADCRUMB — what the top bar's leading edge carries now that the brand has moved.
 *
 * The brand used to live here and is now the RAIL's header, which is where the owner named it
 * ("the sidebar header") and where the approved reference screen puts it. That left this edge
 * empty, and the reference answers the question it leaves behind: its top bar reads
 * «الالتزام والمخاطر ⟵ الحوادث» — the group, then the screen. It is derived from the destination
 * catalogue at render, never a per-screen prop, so it cannot go stale against the nav.
 */
export const crumbStyle: CSSProperties = {
  color: 'var(--nav-ink-muted)',
  fontSize: 'var(--text-sm)',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

export const crumbCurrentStyle: CSSProperties = {
  color: 'var(--nav-ink)',
  fontWeight: 'var(--weight-medium)' as CSSProperties['fontWeight'],
};

/** Pushed to the trailing edge by `margin-inline-start: auto` — logical, so
 *  it lands on the correct side in both directions. */
export const trailingGroupStyle: CSSProperties = {
  marginInlineStart: 'auto',
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-3)',
};

/**
 * The notifications slot — reserved, not working. No hover, no focus, no
 * pointer cursor: every one of those would promise behaviour that does not
 * exist yet. `--nav-ink-muted` on the nav ground is the same pairing the
 * sidebar's group headings use.
 */
export const navbarToggleStyle: CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 'var(--text-sm)',
  padding: 'var(--space-1) var(--space-2)',
  borderRadius: 'var(--radius-md)',
  // The fix for the grey chrome: these were `navLinkStyle` buttons, which set
  // no background at all, so the browser painted its own default button face
  // on the navy rail.
  background: 'transparent',
  // LONGHAND, DELIBERATELY, and never the `border` shorthand: the variant below
  // overrides `borderColor`, and React refuses to update a longhand on a rerender when the
  // shorthand is also set — *"can lead to styling bugs"*, which is its own warning
  // and not a style preference. Measured across the web tree: FOUR pairs had this
  // shape, and `style-shorthand-conflict.test.ts` refuses a fifth.
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'var(--nav-divider)',
  color: 'var(--nav-ink)',
  cursor: 'pointer',
  transition: 'background var(--transition-fast)',
};

export const navbarToggleActiveStyle: CSSProperties = {
  ...navbarToggleStyle,
  background: 'var(--nav-item-active)',
  borderColor: 'var(--nav-item-active)',
  fontWeight: 'var(--weight-semibold)' as CSSProperties['fontWeight'],
};

export const profileSummaryStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  cursor: 'pointer',
  padding: 'var(--space-1) var(--space-2)',
  borderRadius: 'var(--radius-md)',
  listStyle: 'none',
  maxWidth: '14rem',
};

export const avatarStyle: CSSProperties = {
  flex: '0 0 auto',
  width: '2rem',
  height: '2rem',
  borderRadius: 'var(--radius-full)',
  background: 'var(--nav-item-active)',
  color: 'var(--nav-ink)',
  display: 'grid',
  placeItems: 'center',
  fontSize: 'var(--text-sm)',
  fontWeight: 'var(--weight-semibold)' as CSSProperties['fontWeight'],
};

export const profileNameStyle: CSSProperties = {
  fontSize: 'var(--text-sm)',
  fontWeight: 'var(--weight-medium)' as CSSProperties['fontWeight'],
  color: 'var(--nav-ink)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

export const profileDeptStyle: CSSProperties = {
  fontSize: 'var(--text-xs)',
  color: 'var(--nav-ink-muted)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

/** Anchored to the trailing edge with a logical offset so it opens inward in
 *  both directions rather than off the side of the screen in Arabic. */
export const profileMenuStyle: CSSProperties = {
  position: 'absolute',
  insetInlineEnd: 0,
  top: 'calc(100% + var(--space-2))',
  minWidth: '12rem',
  background: 'var(--surface-card)',
  color: 'var(--ink-primary)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  boxShadow: 'var(--shadow-md)',
  padding: 'var(--space-1)',
  display: 'grid',
  gap: '2px',
  zIndex: 30,
};

export const profileMenuItemStyle: CSSProperties = {
  display: 'block',
  padding: 'var(--space-2) var(--space-3)',
  borderRadius: 'var(--radius-sm)',
  fontFamily: 'inherit',
  fontSize: 'var(--text-sm)',
  color: 'var(--ink-primary)',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
};



export const sidebarStyle: CSSProperties = {
  flex: `0 0 var(--sidebar-width)`,
  width: 'var(--sidebar-width)',
  // Logical, not `borderRight` — `shellStyle`'s plain `flex-direction: row`
  // already mirrors the sidebar to the opposite screen edge for free under
  // `dir="rtl"` (Part F item #1's `<html dir>`); a physical `borderRight`
  // would then land on the OUTER edge instead of the one touching
  // `contentStyle`, which is what this separator is actually for.
  borderInlineEnd: '1px solid var(--nav-divider)',
  background: 'linear-gradient(180deg, var(--nav-gradient-from) 0%, var(--nav-gradient-to) 100%)',
  color: 'var(--nav-ink)',
  padding: 'var(--space-5) var(--space-3)',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.1rem',
  // The nav is taller than the viewport for a broadly-permissioned role, so
  // it scrolls itself rather than the page.
  position: 'sticky',
  // Not 0: the navbar is sticky at the top of the same scroll container, so a
  // zero offset parks the rail underneath it. Both values are derived from
  // NAVBAR_HEIGHT rather than restating it — the height exists in one place.
  top: NAVBAR_HEIGHT,
  maxHeight: `calc(100vh - ${NAVBAR_HEIGHT})`,
  overflowY: 'auto',
};

/*
 * THE RAIL'S HEADER — the mark, the product's name, and the office you are signed in to.
 *
 * It came back here from the top bar. The note that moved it away said two brand marks stacked
 * diagonally is what the alternative looks like, and that was right — what changed is that there
 * is only ONE now, and the owner named this as its place: *"where the shell names the application
 * (the sidebar header, the login screen, the browser tab title)"*. The approved reference screen
 * is the same arrangement: brand in the rail, where-you-are in the bar.
 */
export const brandStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  color: 'var(--nav-ink)',
  padding: '0 var(--space-2) var(--space-4)',
  marginBottom: 'var(--space-3)',
  borderBottom: '1px solid var(--nav-divider)',
};

/** The section heading above each group of links. */
export const navGroupLabelStyle: CSSProperties = {
  padding: 'var(--space-4) var(--space-2) var(--space-1)',
  fontSize: 'var(--text-xs)',
  fontWeight: 'var(--weight-semibold)' as CSSProperties['fontWeight'],
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--nav-ink-muted)',
};

/*
 * The same heading, now as a <summary>. `display` is deliberately left alone:
 * <summary> is `display: list-item`, and overriding it (to flex, say, for a
 * count badge on the end) REMOVES the disclosure marker in Chrome. Keeping the
 * marker is worth more than the badge — the browser draws it, and it points
 * the correct way under `dir="rtl"` with no work from us, which a
 * hand-rolled chevron would not. Focus comes from globals.css's single
 * `:focus-visible` rule.
 */
export const navGroupSummaryStyle: CSSProperties = {
  ...navGroupLabelStyle,
  cursor: 'pointer',
  // `outside` (the default for a list-item) puts the marker in the margin,
  // where it clips against the rail edge in RTL and forces an indent so deep
  // that the group's own items end up further LEFT than their heading —
  // hierarchy read backwards. `inside` makes the marker the first inline box,
  // so the heading starts just after it and navGroupItemsStyle can sit a
  // hair further in, which is the way round a reader expects.
  listStylePosition: 'inside',
  // A group header is not a text selection target — double-clicking one to
  // open it should not leave the label highlighted.
  userSelect: 'none',
};

/** Holds a group's links, indented just past its heading text so the nesting
 *  reads as nesting. */
export const navGroupItemsStyle: CSSProperties = {
  paddingInlineStart: 'var(--space-3)',
};

/** Wraps the search field. Full-bleed inside the rail's own padding. */
export const navSearchWrapStyle: CSSProperties = {
  padding: '0 var(--space-2)',
  marginBottom: 'var(--space-3)',
};

/*
 * The app's standard control surface on the navy rail, rather than a
 * transparent input tinted with `--nav-ink`. Two reasons, both measured
 * rather than aesthetic: `--surface-card` is the ground the global
 * `::placeholder` colour (`--ink-muted`) was contrast-checked against in
 * both themes, and a transparent input would need a border token of its own
 * to clear WCAG 1.4.11 against the gradient — the same problem the auth card
 * hit, which took `--ink-muted` at 4.99:1 to solve.
 */
export const navSearchInputStyle: CSSProperties = {
  width: '100%',
  fontSize: 'var(--text-sm)',
  padding: 'var(--space-2) var(--space-3)',
};

/** The "N matches" / no-results line under the field. */
export const navSearchStatusStyle: CSSProperties = {
  padding: 'var(--space-1) var(--space-2) 0',
  fontSize: 'var(--text-xs)',
  color: 'var(--nav-ink-muted)',
};

/*
 * A RAIL LINK, WITH ITS ICON.
 *
 * TWO THINGS CHANGED AND BOTH ARE CORRECTIONS RATHER THAN RESTYLINGS.
 *
 * `opacity: 0.85` IS GONE. globals.css's own header forbids muting text that way — it composites
 * toward whatever is behind the element, so the rendered colour is one no token declared and axe
 * measures the blend, not the token. These links sat on a gradient, which makes the blend
 * different at the top of the rail from the bottom. Every link now carries full `--nav-ink`
 * (9.58:1), and the ACTIVE one is distinguished by three things that are not brightness: a
 * background, the weight, and the amber marker. That is a stronger distinction than a dimmer
 * neighbour, and it is the one the reference screen makes.
 *
 * THE AMBER MARKER IS LOGICAL, NOT PHYSICAL. The reference spells it `border-right` inside an RTL
 * document, where the rail sits at the screen's right edge — so the marker is on the rail's OUTER
 * edge. `borderInlineStart` reproduces that in both directions: it is the right edge in Arabic and
 * the left edge in English, which is the outer edge either way. A physical `borderLeft` would jump
 * to the inner edge the moment the reader switched language.
 *
 * This is the amber's one job on this surface — a mark, never a ground — and `--accent on
 * --nav-bg` is a declared pairing at 5.48:1.
 */
export const navLinkStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  padding: 'var(--space-2) var(--space-3)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--text-base)',
  color: 'var(--nav-ink)',
  // LONGHAND, never the `border` shorthand: the active variant overrides only the colour, and
  // React refuses to update a longhand on a rerender when the shorthand is also set.
  borderInlineStartWidth: '3px',
  borderInlineStartStyle: 'solid',
  borderInlineStartColor: 'transparent',
  transition: 'background var(--transition-fast)',
  // Long module names wrap rather than overflow the fixed-width rail.
  overflowWrap: 'anywhere',
};

/** The link's own words, beside its icon. `minWidth: 0` is what lets a long module name wrap
 *  inside the fixed-width rail instead of pushing the icon out of it. */
export const navLinkLabelStyle: CSSProperties = {
  minWidth: 0,
};

export const navLinkActiveStyle: CSSProperties = {
  ...navLinkStyle,
  background: 'var(--nav-item-active)',
  borderInlineStartColor: 'var(--accent)',
  fontWeight: 'var(--weight-semibold)' as CSSProperties['fontWeight'],
};

export const contentStyle: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  background: 'var(--surface-page)',
};

export const sidebarFooterStyle: CSSProperties = {
  marginTop: 'auto',
  paddingTop: 'var(--space-4)',
  marginInline: 'var(--space-2)',
  borderTop: '1px solid var(--nav-divider)',
  fontSize: 'var(--text-xs)',
  color: 'var(--nav-ink-muted)',
};


// Home page — a responsive grid of module entry-point cards.
export const homeGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(16rem, 1fr))',
  gap: 'var(--space-4)',
  marginTop: 'var(--space-5)',
};

export const homeCardStyle: CSSProperties = {
  display: 'block',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-lg)',
  padding: 'var(--space-4)',
  background: 'var(--surface-card)',
  boxShadow: 'var(--shadow-sm)',
  transition: 'box-shadow var(--transition-fast), border-color var(--transition-fast)',
};

export const homeCardBlurbStyle: CSSProperties = {
  display: 'block',
  marginTop: 'var(--space-1)',
  fontSize: 'var(--text-sm)',
  color: 'var(--ink-secondary)',
};

/**
 * The forced-MFA-enrolment banner in `app/(app)/layout.tsx`.
 *
 * Built on the existing `--warning-*` triple rather than new colours: that trio is already
 * contrast-checked in both themes by the accessibility gate, and an attention strip that invents
 * its own amber is exactly the kind of one-off that gets past the light theme and fails the dark
 * one. It sits inside `contentStyle`, so it inherits the page gutter and needs only its own
 * bottom gap.
 */
export const mfaBannerStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  gap: '0.5rem 0.75rem',
  marginBottom: '1.25rem',
  padding: '0.875rem 1rem',
  background: 'var(--warning-bg)',
  color: 'var(--warning-ink)',
  border: '1px solid var(--warning-border)',
  borderRadius: '0.5rem',
  lineHeight: 1.6,
};

export const mfaBannerTitleStyle: CSSProperties = {
  fontSize: '0.95rem',
  fontWeight: 600,
};

export const mfaBannerBodyStyle: CSSProperties = {
  fontSize: '0.875rem',
};

export const mfaBannerCtaStyle: CSSProperties = {
  fontSize: '0.875rem',
  fontWeight: 600,
  color: 'var(--warning-ink)',
  textDecoration: 'underline',
  // Never `nowrap` on the Arabic string, which is the longer of the two.
  whiteSpace: 'normal',
};

/** Group heading on the home launcher, which now groups what it offers by module. */
export const homeGroupHeadingStyle: CSSProperties = {
  fontSize: '0.8rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--ink-secondary)',
  margin: '0 0 0.6rem',
};
