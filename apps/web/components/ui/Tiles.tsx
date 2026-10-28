import type { CSSProperties, ReactNode } from 'react';
import { IconBadge, type IconName } from './Icon';

/*
 * THE SUMMARY ROW — the thing the owner singled out on the reference screen.
 *
 * Her words for why it is there: *«أشيك للموظف في شغله و بكون عنده زي مختصر للمعلومات»* — it is
 * smarter for an employee at work, and gives them a short form of the information. So a screen
 * with figures worth a glance OPENS with them, and the list comes after: summary above detail.
 *
 * TWO RULES THAT MATTER MORE THAN THE LAYOUT.
 *
 *   1. **A TILE SHOWS SOMETHING THE SCREEN'S OWN API ALREADY RETURNS.** Never invent a figure to
 *      fill a fourth slot. A screen whose API returns nothing worth a tile opens with its content
 *      instead, and `Tiles` simply is not rendered — which is why the grid is `auto-fit` rather
 *      than a hard `repeat(4, 1fr)`: three honest tiles must not leave a hole where a fourth
 *      would have gone.
 *
 *   2. **A FIGURE CARRIES ITS OWN DENOMINATOR OR ITS OWN PERIOD.** `meta` is not decoration: the
 *      reference's own tiles read *"٣ حوادث مفتوحة · من أصل ٣٠ هذا العام"* and *"١ تجاوزت مهلة
 *      الاحتواء · أربع ساعات للخطورة الحرجة"*. A bare number is the defect owner decision 58
 *      exists to remove, and this product has paid for it before. Where the figure obeys a period
 *      filter, the period clause comes from the api's own `metricScope` through `FigurePeriod` —
 *      never decided by the screen.
 */

export function Tiles({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        display: 'grid',
        /*
         * `auto-fit` with a floor, not `repeat(4, 1fr)`. Three tiles fill the row; five wrap; and
         * at phone width every one of them gets its own line without a media query. The floor is
         * wide enough for a five-digit figure beside its icon badge in both languages.
         */
        gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))',
        gap: 'var(--space-3)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Tile({
  icon,
  value,
  label,
  meta,
  tone = 'plain',
  style,
}: {
  icon: IconName;
  /** The figure itself. Already formatted — `formatNumber` decides the numerals, not this file. */
  value: ReactNode;
  /** What the figure COUNTS, in words. */
  label: ReactNode;
  /** The denominator, the period, or the rule behind the figure. See rule 2 above. */
  meta?: ReactNode;
  /**
   * `alarm` is for a tile REPORTING A PROBLEM — a passed statutory deadline, a breach. It is the
   * warning triple, which the accessibility gate already contrast-checks in both themes, and it
   * never carries the amber as a ground: `--accent` on a light surface is 1.99:1.
   */
  tone?: 'plain' | 'alarm';
  style?: CSSProperties;
}) {
  const alarm = tone === 'alarm';
  return (
    <div
      style={{
        background: alarm ? 'var(--warning-bg)' : 'var(--surface-card)',
        border: `1px solid ${alarm ? 'var(--warning-border)' : 'var(--border-default)'}`,
        borderRadius: 'var(--radius-xl)',
        padding: 'var(--space-4)',
        display: 'flex',
        gap: 'var(--space-3)',
        alignItems: 'flex-start',
        minWidth: 0,
        ...style,
      }}
    >
      <IconBadge name={icon} tone={alarm ? 'warning' : 'brand'} />
      <span style={{ minWidth: 0 }}>
        <span
          style={{
            display: 'block',
            fontSize: 'var(--text-2xl)',
            fontWeight: 'var(--weight-bold)' as CSSProperties['fontWeight'],
            lineHeight: 1.15,
            color: alarm ? 'var(--warning-ink)' : 'var(--brand-800)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {value}
        </span>
        <span
          style={{
            display: 'block',
            fontSize: 'var(--text-sm)',
            color: alarm ? 'var(--warning-ink)' : 'var(--ink-secondary)',
          }}
        >
          {label}
        </span>
        {meta ? (
          <span
            style={{
              display: 'block',
              fontSize: 'var(--text-xs)',
              color: alarm ? 'var(--warning-ink)' : 'var(--ink-muted)',
            }}
          >
            {meta}
          </span>
        ) : null}
      </span>
    </div>
  );
}
