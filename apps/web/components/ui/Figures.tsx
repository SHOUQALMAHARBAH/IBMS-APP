import type { CSSProperties, ReactNode } from 'react';
import type { DataAttributes } from './data-attributes';

/*
 * THE GEOMETRIC FIGURES — a ring, a ranked bar list, and one segmented bar.
 *
 * The owner asked for these by name: *«الداش بوردز تعون كل المستخدمين بالاخص المزود يكون فيها
 * اشكال هندسية حسابات نسب البرسنتيج رينغ»*. Reference page B implements all three and this file is
 * that implementation.
 *
 * PICK THE FORM FROM THE JOB, NEVER FROM THE MOOD:
 *
 *   one proportion of one whole                  -> Ring
 *   ranked quantities across categories          -> BarList, with the value printed directly
 *   parts of one whole                           -> SegmentedBar, with a legend
 *
 * Never a pie with many slices, and never two y-axes on one chart.
 *
 * THE PALETTE IS FIXED, VALIDATED AND ASSIGNED IN ORDER — `--chart-1` … `--chart-4`, NEVER cycled.
 * A screen that needs a fifth series does not need a fifth colour: fold the tail into "أخرى", or
 * split it into two charts. **The brand amber is deliberately not among them**, and that is a
 * measurement rather than a preference — 1.99:1 on a light surface, and outside the lightness band
 * the dark surface needs. It stays the brand's own mark.
 *
 * STATUS COLOURS STAY RESERVED. Good / warning / bad are for STATE, never for "series 4", and they
 * always ship with a word beside them — never colour alone, which is WCAG 1.4.1 and is also just
 * unreadable for one reader in twelve.
 */

export type ChartSlot = 1 | 2 | 3 | 4;

function slotColour(slot: ChartSlot): string {
  return `var(--chart-${slot})`;
}

/**
 * ONE PROPORTION OF ONE WHOLE.
 *
 * THE ARC IS COMPUTED FROM THE CIRCUMFERENCE (2πr) and never from a hand-tuned dash: a dash array
 * somebody eyeballed is a figure that is wrong by a few per cent forever, on a screen whose whole
 * job is to be checkable.
 *
 * `caption` IS REQUIRED, AND THAT IS THE POINT OF THE COMPONENT. A percentage that hides its
 * denominator is a figure a person cannot check — *٨٦٪* of what? — and this product has already
 * paid for a bare figure once (owner decision 58). Making the raw count a required prop is the
 * form that cannot express the mistake, rather than a convention somebody has to remember. Both
 * strings are formatted BY THE CALLER through `formatNumber`, so the numerals follow the reader's
 * language rather than being decided here.
 *
 * AND IT IS DRAWN BESIDE THE RING, NOT INSIDE IT. It used to be an SVG `<text>` under the
 * percentage at roughly 9px, which suits the `٣١ من ٣٦` shape this header first imagined and
 * breaks for a caption written as a sentence — the owner's first one spilled past both edges of
 * the circle. Beside the label it has the card's width and a readable size. Do not move it back
 * to make a short caption look tidier; the short case reads perfectly well out here too.
 */
export function Ring({
  value,
  total,
  percentText,
  caption,
  label,
  meta,
  slot = 1,
  size = 84,
  ariaLabel,
  style,
  ...dataAttributes
}: {
  /** The numerator. Used for the arc, so the drawing and the text cannot disagree. */
  value: number;
  /** The denominator. A zero total draws an empty ring rather than dividing by zero. */
  total: number;
  /** The percentage, already formatted — e.g. `٨٦٪`. */
  percentText: ReactNode;
  /** THE RAW COUNT, already formatted — e.g. `٣١ من ٣٦`. Required: see above. */
  caption: ReactNode;
  /** What the proportion is OF, in words. */
  label: ReactNode;
  /** The remainder, or the rule behind the figure. */
  meta?: ReactNode;
  slot?: ChartSlot;
  size?: number;
  /** The whole figure as one sentence, for a reader who cannot see the ring. */
  ariaLabel: string;
  style?: CSSProperties;
} & DataAttributes) {
  const stroke = Math.max(6, Math.round(size * 0.107));
  const radius = (size - stroke) / 2 - 1;
  const centre = size / 2;
  const circumference = 2 * Math.PI * radius;
  const fraction = total > 0 ? Math.min(1, Math.max(0, value / total)) : 0;
  const offset = circumference * (1 - fraction);

  return (
    <div
      {...dataAttributes}
      style={{
        background: 'var(--surface-card)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-xl)',
        padding: 'var(--space-4)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-4)',
        minWidth: 0,
        ...style,
      }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={ariaLabel}>
        <circle
          cx={centre}
          cy={centre}
          r={radius}
          fill="none"
          stroke="var(--track)"
          strokeWidth={stroke}
        />
        <circle
          cx={centre}
          cy={centre}
          r={radius}
          fill="none"
          stroke={slotColour(slot)}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${centre} ${centre})`}
        />
        <text
          x={centre}
          y={centre - 1}
          textAnchor="middle"
          dominantBaseline="middle"
          style={{
            fontSize: `${Math.round(size * 0.2)}px`,
            fontWeight: 700,
            fill: 'var(--brand-800)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {percentText}
        </text>
      </svg>
      <span style={{ minWidth: 0 }}>
        <span
          style={{
            display: 'block',
            fontSize: 'var(--text-base)',
            fontWeight: 'var(--weight-medium)' as CSSProperties['fontWeight'],
            color: 'var(--ink-secondary)',
          }}
        >
          {label}
        </span>
        {/*
          THE CAPTION SITS HERE RATHER THAN INSIDE THE RING, and that is a correction.

          It used to be an SVG `<text>` centred under the percentage at `size * 0.107` — about 9px
          on the default ring. That holds for the example in this file's own header, `٣١ من ٣٦`,
          and it does NOT hold for a caption written as a sentence: the owner's first one reads
          «14 مطالبة مفتوحة من 66» and spilled past both edges of the circle, overlapping the arc,
          which is what the design-pass capture showed.

          Out here it has the width of the card, reads at `--text-sm` instead of 9px, and uses
          `--ink-secondary` rather than `--ink-muted` — a token this product has already recorded
          as failing contrast wherever it is weakened. The figure now reads in the order a person
          says it: the percentage, what it is of, then the raw count.
        */}
        <span
          style={{
            display: 'block',
            fontSize: 'var(--text-sm)',
            color: 'var(--ink-secondary)',
          }}
        >
          {caption}
        </span>
        {meta ? (
          <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--ink-muted)' }}>{meta}</span>
        ) : null}
      </span>
    </div>
  );
}

/**
 * RANKED QUANTITIES, highest first, with the value printed directly beside each bar rather than
 * read off an axis.
 *
 * Every bar takes the SAME slot colour: these are one measure across categories, not four series,
 * and four colours on one measure invites a reader to look for a meaning that is not there. The
 * widths are proportions of the LARGEST value, so the longest bar fills the track — which is what
 * makes the ranking readable at a glance.
 */
export function BarList({
  rows,
  slot = 1,
  style,
  ...dataAttributes
}: {
  rows: Array<{ name: ReactNode; value: number; valueText: ReactNode }>;
  slot?: ChartSlot;
  style?: CSSProperties;
} & DataAttributes) {
  const largest = rows.reduce((max, row) => Math.max(max, row.value), 0);
  return (
    <ul
      {...dataAttributes}
      style={{ display: 'grid', gap: 'var(--space-3)', margin: 0, padding: 0, listStyle: 'none', ...style }}
    >
      {rows.map((row, index) => (
        <li
          key={index}
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(5rem, 7.5rem) 1fr auto',
            gap: 'var(--space-3)',
            alignItems: 'center',
            fontSize: 'var(--text-base)',
            minWidth: 0,
          }}
        >
          <span
            style={{
              color: 'var(--ink-secondary)',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {row.name}
          </span>
          <span
            style={{
              background: 'var(--track)',
              borderRadius: 'var(--radius-full)',
              height: '0.625rem',
              overflow: 'hidden',
            }}
          >
            <span
              style={{
                display: 'block',
                height: '100%',
                borderRadius: 'var(--radius-full)',
                background: slotColour(slot),
                width: largest > 0 ? `${(row.value / largest) * 100}%` : '0%',
              }}
            />
          </span>
          <span
            style={{
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--ink-primary)',
              fontWeight: 'var(--weight-medium)' as CSSProperties['fontWeight'],
              minWidth: '2.6rem',
              textAlign: 'end',
            }}
          >
            {row.valueText}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * PARTS OF ONE WHOLE — one bar, up to four segments, and a legend that names each one in words.
 *
 * The legend is not optional and the colour never stands alone: a reader who cannot distinguish
 * two hues still has the word, and so does a reader using a screen reader, through `ariaLabel`.
 */
export function SegmentedBar({
  segments,
  ariaLabel,
  style,
  ...dataAttributes
}: {
  segments: Array<{ name: ReactNode; value: number; slot: ChartSlot }>;
  /** The whole distribution as one sentence — e.g. `سارٍ ٢٦، ينتهي قريباً ٧، منتهٍ ٢، موقوف ١`. */
  ariaLabel: string;
  style?: CSSProperties;
} & DataAttributes) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  return (
    <div {...dataAttributes} style={{ display: 'grid', gap: 'var(--space-3)', minWidth: 0, ...style }}>
      <div
        role="img"
        aria-label={ariaLabel}
        style={{
          display: 'flex',
          height: '0.8125rem',
          borderRadius: 'var(--radius-full)',
          overflow: 'hidden',
          background: 'var(--track)',
          gap: '2px',
        }}
      >
        {segments.map((segment, index) => (
          <span
            key={index}
            style={{
              display: 'block',
              height: '100%',
              background: slotColour(segment.slot),
              width: total > 0 ? `${(segment.value / total) * 100}%` : '0%',
            }}
          />
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--space-3)',
          fontSize: 'var(--text-xs)',
          color: 'var(--ink-secondary)',
        }}
      >
        {segments.map((segment, index) => (
          <span key={index} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span
              aria-hidden="true"
              style={{
                width: '0.5625rem',
                height: '0.5625rem',
                borderRadius: 'var(--radius-sm)',
                background: slotColour(segment.slot),
                flex: 'none',
              }}
            />
            {segment.name}
          </span>
        ))}
      </div>
    </div>
  );
}
