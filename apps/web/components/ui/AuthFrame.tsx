import type { ReactNode } from 'react';
import { BrandLockup } from './BrandMark';

/*
 * THE PRE-SIGN-IN FRAME — a brand panel and a form panel.
 *
 * The owner asked for the sign-in screen by name and asked for it first: it is the first thing a
 * client will see, and her instruction was creative, carrying the logo, with movement —
 * *«مش تكون بيسك هيك اشي عادي ولا انها تبين اوفر»*. Reference page B is that screen and this is
 * its implementation.
 *
 * THE PANEL'S PROSE IS THE OWNER'S BRAND PACK, AND IT ARRIVED AFTER THE PILOT.
 *
 * The pilot shipped this panel with the mark and the name and no prose, and recorded why: the
 * reference page's sentence and chips were drafted for her to LOOK AT, the i18n tree held no
 * product tagline to slice, and a sentence written here on the first screen a client reads is
 * exactly what rule 8(d) exists to prevent. That reasoning held, and she answered it by pointing
 * at the source it was missing: her own bilingual flyers, and reference page B, which composes
 * three of their capability lines into this panel. `BrandPitch` carries the provenance.
 *
 * `pitch` STAYS OPTIONAL. The other four `(auth)` screens — forgot-password, reset-password,
 * sign-up and the invitation — are not a product pitch: a reader who is already resetting a
 * password does not need selling to, and the panel there is the mark alone.
 *
 * THE MOTION IS THE MARK'S OWN and runs once on load, with one slow ambient loop — the amber point
 * — plus the two glows, which are the only continuously-moving thing in the whole product and are
 * confined to this screen. `prefers-reduced-motion` disables every bit of it and shows the final
 * state immediately; see globals.css's motion section, where the four rules are written down.
 */
export function AuthFrame({
  children,
  pitch,
}: {
  /** The form panel's content. */
  children: ReactNode;
  /** Reserved for the owner's own sentence and capability chips. Renders nothing until it exists. */
  pitch?: ReactNode;
}) {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--space-5)',
        background: 'var(--surface-page)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '58rem',
          display: 'grid',
          /*
           * `auto-fit` with a floor rather than two fixed fractions: the two panels sit side by
           * side on a desktop and stack on a phone with no media query, and the floor is wide
           * enough that the form's own fields never compress.
           */
          gridTemplateColumns: 'repeat(auto-fit, minmax(19rem, 1fr))',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-xl)',
          overflow: 'hidden',
          boxShadow: 'var(--shadow-lg)',
          background: 'var(--surface-card)',
        }}
      >
        <div
          style={{
            position: 'relative',
            overflow: 'hidden',
            /*
             * `--nav-gradient-*`, NOT `--brand-800/900`, AND THE SCREENSHOT IS WHAT CAUGHT IT.
             *
             * The first version used the ramp steps — and the ramp INVERTS in dark mode, which is
             * the whole point of a ramp: `--brand-800` is the navy `#1a3e66` in light and the pale
             * `#d7e7f5` in dark. So the brand panel rendered almost WHITE in the dark theme, with
             * white logo strokes on it and a `--nav-ink-muted` subtitle that vanished entirely.
             *
             * The light theme looked perfect, which is exactly how this class ships: a design pass
             * breaks things silently and only a picture of the other theme shows it. The nav
             * gradient is the right token because it is the one pair in the system that is
             * DELIBERATELY dark in both themes — the rail is navy whichever way the reader sets
             * their machine, and this panel is the same surface wearing a different shape.
             *
             * THE RULE THIS EARNED: a surface that must stay dark in both themes takes
             * `--nav-*`. A ramp step is for something that should follow the theme.
             */
            background:
              'linear-gradient(155deg, var(--nav-gradient-from) 0%, var(--nav-gradient-to) 100%)',
            color: 'var(--nav-ink)',
            padding: 'var(--space-5)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: 'var(--space-5)',
            minHeight: '17rem',
          }}
        >
          {/* The two ambient glows. `aria-hidden`, pointer-events irrelevant (they sit behind),
              and they are the product's ONLY continuous motion. */}
          <span
            aria-hidden="true"
            className="waseet-glow-a"
            style={{
              position: 'absolute',
              inset: '-30% -20% auto auto',
              width: '28rem',
              height: '28rem',
              borderRadius: 'var(--radius-full)',
              background:
                'radial-gradient(circle, rgba(32, 114, 184, 0.55), rgba(32, 114, 184, 0) 68%)',
            }}
          />
          <span
            aria-hidden="true"
            className="waseet-glow-b"
            style={{
              position: 'absolute',
              inset: 'auto auto -28% -16%',
              width: '20rem',
              height: '20rem',
              borderRadius: 'var(--radius-full)',
              background:
                'radial-gradient(circle, rgba(244, 169, 33, 0.3), rgba(244, 169, 33, 0) 70%)',
            }}
          />

          <div style={{ position: 'relative' }}>
            <BrandLockup size={46} animate subtitle="WASEET 360" />
          </div>
          {pitch ? <div style={{ position: 'relative' }}>{pitch}</div> : null}
        </div>

        <div
          style={{
            padding: 'var(--space-5)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: 'var(--space-4)',
            background: 'var(--surface-card)',
            minWidth: 0,
          }}
        >
          {children}
        </div>
      </div>
    </main>
  );
}
