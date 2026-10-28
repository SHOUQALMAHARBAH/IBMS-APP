import type { CSSProperties, ReactNode } from 'react';

/*
 * THE ICON LANGUAGE, AND IT IS THE OWNER'S OWN.
 *
 * Her flyer uses line icons at ONE stroke weight with round caps and joins — matching the logo's
 * own round caps — in the brand blue, often inside a pale-blue circle. That is what this file
 * implements, and the approved reference pages implement it the same way: inline SVG, and
 * **no icon library** — no npm package, no CDN, no icon font. Three reasons, in order of weight:
 *
 *   * an icon font or a CDN is a network request on a screen that must render for a broker on a
 *     Jordanian office connection, and this app's CSP-free deployment story does not need another
 *     third-party origin;
 *   * a library ships hundreds of glyphs at whatever weights its own designer chose, so "one
 *     stroke weight" stops being enforceable the moment somebody imports a second one;
 *   * the paths below are the exact ones the owner looked at and approved.
 *
 * SO THE STROKE WEIGHT IS ENFORCED HERE, ONCE. Each entry in `PATHS` is geometry only — no
 * `stroke`, no `stroke-width`, no caps — and `Icon` supplies all of it. A path that carried its
 * own stroke-width would be a second answer to a question this file exists to answer once.
 *
 * AN ICON NEVER CARRIES MEANING ALONE. Every one of these is `aria-hidden` and sits beside its own
 * label; a control whose only content is an icon needs an `aria-label` on the CONTROL, not a
 * decorative title inside the glyph. That is not a preference — the frontend directive's §2 and
 * the accessibility suite both read the label, and a screen reader cannot read a path.
 *
 * Geometry is 24×24 with stroke 2, the proportion the reference pages use; `size` scales the
 * rendered box and leaves the stroke proportional, which is what keeps a 13px icon in a section
 * heading and a 17px icon in a summary tile looking like the same family.
 */

export type IconName = keyof typeof PATHS;

/**
 * Geometry only. Keep each entry to `d` attributes and primitive shapes, and keep the list
 * alphabetical so two people adding an icon in the same week collide in the diff rather than
 * silently shipping two spellings of the same glyph.
 */
const PATHS = {
  /** A statutory or regulatory deadline that has passed. */
  alert: (
    <>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>
  ),
  /** Ranked quantities — a report, a dashboard. */
  bars: (
    <>
      <path d="M12 20V10" />
      <path d="M18 20V4" />
      <path d="M6 20v-4" />
    </>
  ),
  /** An office, a counterparty, a vendor. */
  building: (
    <>
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M9 22v-4h6v4" />
      <path d="M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01" />
    </>
  ),
  /** A date, a period, a calendar. */
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M8 2v4M16 2v4M3 10h18" />
    </>
  ),
  /** Done, agreed, approved. */
  check: <path d="M20 6 9 17l-5-5" />,
  /** A review that has been worked through — KYC, a checklist. */
  checklist: (
    <>
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </>
  ),
  /** Disclosure, in the reading direction the browser decides. */
  chevron: <path d="m9 18 6-6-6-6" />,
  /** Elapsed time, an open clock, a pending state. */
  clock: (
    <>
      <path d="M12 8v5l3 2" />
      <circle cx="12" cy="12" r="9" />
    </>
  ),
  /** Money — a premium, a commission, a receipt. */
  coins: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2" />
      <path d="M6 12h.01M18 12h.01" />
    </>
  ),
  /** Export, or save a copy. */
  download: (
    <>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </>
  ),
  /** A document, a record, a file. */
  file: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </>
  ),
  /** Something worth reading before acting — never a refusal. */
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-4M12 8h.01" />
    </>
  ),
  /** The layout of a screen itself. */
  layout: (
    <>
      <path d="M3 3h18v18H3z" />
      <path d="M3 9h18M9 21V9" />
    </>
  ),
  /** Privacy, a consent record, something withheld. */
  lock: (
    <>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
  /** Correspondence. */
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </>
  ),
  /** Add the one thing this screen is for. */
  plus: <path d="M12 5v14M5 12h14" />,
  /** Search, or look one record up. */
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  /** Configuration — the levers an administrator sets. */
  settings: (
    <>
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
      <path d="M1 14h6M9 8h6M17 16h6" />
    </>
  ),
  /** Cover, protection, a claim. */
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  /** Performance over time. */
  trend: (
    <>
      <path d="m22 7-8.5 8.5-5-5L2 17" />
      <path d="M16 7h6v6" />
    </>
  ),
  /** A person, or the people in an office. */
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    </>
  ),
} as const;

export function Icon({
  name,
  size = 16,
  style,
}: {
  name: IconName;
  /** Rendered box in px. The stroke stays proportional, which is what keeps the family coherent. */
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flex: 'none', ...style }}
    >
      {PATHS[name]}
    </svg>
  );
}

/**
 * An icon inside a pale-blue circle — the treatment the owner's flyer uses, and the one the
 * reference screen's summary tiles and section headings use.
 *
 * `tone` exists because a tile that is REPORTING A PROBLEM must not wear the calm brand badge: the
 * reference screen's overdue-containment tile carries a warning ground. Both tones are declared
 * pairings in `token-contrast.py`; never write a colour here.
 */
export function IconBadge({
  name,
  size = 34,
  iconSize = 17,
  tone = 'brand',
  style,
}: {
  name: IconName;
  size?: number;
  iconSize?: number;
  tone?: 'brand' | 'warning';
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 'var(--radius-full)',
        background: tone === 'warning' ? 'var(--warning-bg)' : 'var(--brand-50)',
        color: tone === 'warning' ? 'var(--warning-ink)' : 'var(--ink-brand)',
        display: 'grid',
        placeItems: 'center',
        flex: 'none',
        ...style,
      }}
    >
      <Icon name={name} size={iconSize} />
    </span>
  );
}

/** A label with its icon — the shape that keeps the two together so neither ships alone. */
export function IconLabel({
  name,
  children,
  size = 14,
  style,
}: {
  name: IconName;
  children: ReactNode;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        minWidth: 0,
        ...style,
      }}
    >
      <Icon name={name} size={size} />
      {children}
    </span>
  );
}
