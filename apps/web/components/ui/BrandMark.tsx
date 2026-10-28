import type { CSSProperties, ReactNode } from 'react';

/*
 * THE WASEET 360 MARK, AND THE GEOMETRY IS THE OWNER'S FILE RATHER THAN A REDRAWING.
 *
 * Every coordinate below is copied byte-for-byte out of
 * `WASEET360_Final/02_Logo_Pack/05_Symbol/FullColor/…Transparent.svg` — the arc's `r="48"`, its
 * `stroke-dasharray="250 52"` and `rotate(-60 60 60)`, the three nodes at (60,36), (39,73) and
 * (81,73), the hub at r="11" and the amber point at (60,12). Redrawing a logo by eye is how a
 * company ends up with two logos, and the arc's dash pattern in particular is not guessable: it
 * is what leaves the gap the amber point sits in.
 *
 * WHAT IS NOT COPIED IS THE COLOUR, and that is deliberate. The file ships three lockup variants
 * (FullColor, Mono-Navy, Reverse-White) and a component cannot pick one for every ground, so the
 * strokes take `currentColor` and the caller sets the colour by context: the navy rail and the
 * sign-in hero get the reverse-white treatment, a light surface gets the brand blue. The amber
 * stays amber in all of them — it is the brand's one mark, and `--accent` is legible on every
 * ground this product has (5.48:1 on the rail, 7.57:1 on a dark card).
 *
 * THE MOTION IS OPT-IN AND OFF BY DEFAULT. `animate` is false everywhere but the sign-in screen,
 * because a mark that draws itself in on all 111 screens is a product that performs at somebody
 * ten times a day. The resting mark carries no animation and no hidden state — see rule 2 in
 * globals.css's motion section — so the static case cannot fail to appear.
 *
 * It is `aria-hidden` and carries no title: the wordmark beside it is the accessible name, and an
 * SVG that announces "WASEET 360" next to text saying the same thing reads it twice.
 */
export function BrandMark({
  size = 34,
  animate = false,
  style,
}: {
  size?: number;
  /**
   * Draw the mark in on load. TRUE ONLY ON THE SIGN-IN SCREEN — the one place a person arrives
   * once and the first thing a client is shown.
   */
  animate?: boolean;
  style?: CSSProperties;
}) {
  return (
    <svg
      className="waseet-mark"
      data-animate={animate ? 'true' : undefined}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      aria-hidden="true"
      focusable="false"
      style={{ flex: 'none', ...style }}
    >
      <circle
        className="waseet-mark-arc"
        cx="60"
        cy="60"
        r="48"
        fill="none"
        stroke="currentColor"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray="250 52"
        transform="rotate(-60 60 60)"
      />
      <circle className="waseet-mark-point" cx="60" cy="12" r="7" fill="var(--accent)" />
      <path
        className="waseet-mark-spoke"
        d="M60 60 L60 45 M60 60 L46.6 68.3 M60 60 L73.4 68.3"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <circle
        className="waseet-mark-node waseet-mark-node-1"
        cx="60"
        cy="36"
        r="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />
      <circle
        className="waseet-mark-node waseet-mark-node-2"
        cx="39"
        cy="73"
        r="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />
      <circle
        className="waseet-mark-node waseet-mark-node-3"
        cx="81"
        cy="73"
        r="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />
      <circle className="waseet-mark-hub" cx="60" cy="60" r="11" fill="var(--accent)" />
    </svg>
  );
}

/**
 * The mark with the product's name beside it — the bilingual lockup, in the order the logo's own
 * primary lockup uses: Arabic, then the Latin form.
 *
 * `subtitle` is what the surface has to say under the name. On the rail that is the signed-in
 * office, which is a fact about who you are rather than somewhere to go; on the sign-in screen it
 * is the Latin wordmark, because there is no office yet.
 */
export function BrandLockup({
  size = 34,
  animate = false,
  subtitle,
  style,
}: {
  size?: number;
  animate?: boolean;
  /*
   * A NODE rather than a string, so the CALLER owns what the subtitle MEANS. The rail passes the
   * office's name wrapped in a `<bdi>` carrying `data-organization-name` — the `bdi` because an
   * Arabic organization name beside a Latin wordmark is exactly the bidirectional neighbour that
   * reorders a line without it, and the attribute because that is what the shell's own spec reads.
   * The sign-in screen passes the Latin wordmark, which is not an organization and must not be
   * labelled as one.
   */
  subtitle?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0, ...style }}>
      <BrandMark size={size} animate={animate} />
      <span style={{ lineHeight: 1.2, minWidth: 0 }}>
        <strong
          style={{
            display: 'block',
            fontSize: 'var(--text-md)',
            fontWeight: 'var(--weight-bold)' as CSSProperties['fontWeight'],
            letterSpacing: '0.02em',
            color: 'inherit',
          }}
        >
          وسيط 360
        </strong>
        {subtitle ? (
          <span
            style={{
              display: 'block',
              fontSize: 'var(--text-xs)',
              /*
               * `--nav-ink-muted`, NOT an opacity. globals.css's own header forbids muting text
               * with opacity: it composites toward whatever is behind the element, so the rendered
               * colour is one no token declared and axe measures the blend. Both grounds this
               * lockup appears on are the navy — the rail and the sign-in hero — so one token
               * serves both, and the pairing is declared in `token-contrast.py` at 5.48:1.
               */
              color: 'var(--nav-ink-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {subtitle}
          </span>
        ) : null}
      </span>
    </span>
  );
}
