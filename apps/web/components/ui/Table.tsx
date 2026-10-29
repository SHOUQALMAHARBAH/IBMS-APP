import type { CSSProperties, ReactNode } from 'react';

/*
 * The standard list table. Frontend directive §6: a user who has learned one
 * list screen already knows how every other one works, so the structure
 * (header treatment, row separators, alignment, empty handling) is defined
 * once here and never re-invented per module.
 *
 * The wrapper scrolls horizontally on its own rather than letting the page
 * scroll sideways — a wide financial table must not push the whole layout.
 */
/**
 * `data-*` IS FORWARDED BY EVERY PART OF THIS TABLE, and the type is what makes that visible.
 *
 * TypeScript exempts hyphen-containing JSX attributes from excess-property checking, so
 * `data-anything` on any custom component type-checks and then goes NOWHERE. A table cell is
 * exactly where a screen hangs its machine hook, and naming one attribute the way `Tr` names
 * `data-testid` is not enough because every screen uses its own. The template-literal index
 * signature accepts the family and the spread forwards it.
 */
type DataAttributes = { [key: `data-${string}`]: string | undefined };

export function Table({
  children,
  style,
  ...dataAttributes
}: { children: ReactNode; style?: CSSProperties } & DataAttributes) {
  return (
    <div
      /*
       * A SCROLLABLE REGION MUST BE REACHABLE BY KEYBOARD. Without this, a table wider than its
       * column is content a keyboard user cannot scroll to at all — axe's
       * `scrollable-region-focusable`, 52 violations on `/retention-disposal` the moment its six
       * hand-rolled tables became six of these. Every one of those had the same defect; what
       * changed is that one component now holds the fix for all of them.
       *
       * The focus ring is not decoration: a thing that takes focus and does not show it leaves a
       * keyboard user with no idea where they are.
       */
      tabIndex={0}
      style={{
        width: '100%',
        overflowX: 'auto',
        borderRadius: 'var(--radius-md)',
        ...style,
      }}
      onFocus={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.style.boxShadow = 'var(--focus-ring)';
      }}
      onBlur={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.style.boxShadow = 'none';
      }}
    >
      <table
        {...dataAttributes}
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 'var(--text-base)',
          textAlign: 'start',
        }}
      >
        {children}
      </table>
    </div>
  );
}

export function Th({
  children,
  numeric = false,
  colSpan,
  style,
  ...dataAttributes
}: {
  colSpan?: number;
  children?: ReactNode;
  /** Right-aligns in LTR and left-aligns in RTL, via logical `end`. */
  numeric?: boolean;
  style?: CSSProperties;
} & DataAttributes) {
  return (
    <th
      {...dataAttributes}
      colSpan={colSpan}
      scope="col"
      style={{
        padding: 'var(--space-3) var(--space-4)',
        textAlign: numeric ? 'end' : 'start',
        fontSize: 'var(--text-xs)',
        fontWeight: 'var(--weight-semibold)' as CSSProperties['fontWeight'],
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        color: 'var(--ink-muted)',
        background: 'var(--surface-sunken)',
        borderBottom: '1px solid var(--border-default)',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  numeric = false,
  colSpan,
  style,
  ...dataAttributes
}: {
  children?: ReactNode;
  numeric?: boolean;
  /*
   * A CELL THAT SPANS THE TABLE — which is how several screens render *nothing matched* INSIDE
   * the table rather than above it, so the message lands under the headings it belongs to
   * instead of floating beside them. Without this the attribute type-checks (it is a plain prop,
   * not a `data-`) and is simply dropped, leaving a one-column cell in a five-column table.
   */
  colSpan?: number;
  style?: CSSProperties;
} & DataAttributes) {
  return (
    <td
      {...dataAttributes}
      colSpan={colSpan}
      /*
       * Numbers stay LTR even in an Arabic layout — a premium or a policy
       * number reads identically in both languages (see globals.css).
       */
      data-numeric={numeric ? '' : undefined}
      style={{
        padding: 'var(--space-3) var(--space-4)',
        textAlign: numeric ? 'end' : 'start',
        borderBottom: '1px solid var(--border-subtle)',
        color: 'var(--ink-primary)',
        verticalAlign: 'top',
        ...style,
      }}
    >
      {children}
    </td>
  );
}

/*
 * A ROW, AND IT FORWARDS THE WHOLE `data-*` FAMILY — which is not a convenience.
 *
 * TypeScript exempts hyphen-containing JSX attributes from excess-property checking, so
 * `data-anything` on ANY custom component type-checks and then goes nowhere. That is how moving a
 * screen's `<tr data-testid=…>` onto this component silently killed two hooks
 * `self-approval-report.spec.ts` reads — with `tsc` clean, the screen rendering perfectly, and the
 * spec that covers the SAME SCREEN still green because it happens not to use them.
 *
 * NAMING `data-testid` WAS THE FIRST FIX AND IT WAS ONE NAME SHORT — the fourth time that has been
 * true in this batch. `/retention-disposal` hangs `data-notice-for` on its rows, `/claims` hangs
 * `data-claim-status` on a pill, `/insurer-directory` hangs `data-line-error` on a refusal: every
 * screen uses its own, so a list of names is always missing the next one. The index signature
 * accepts the family and the spread forwards it, which makes the support a property of the
 * SIGNATURE rather than something a reader has to go and check in the body.
 */
export function Tr({
  children,
  variant = 'default',
  style,
  ...dataAttributes
}: {
  children: ReactNode;
  /*
   * A TOTALS ROW IS A DIFFERENT KIND OF ROW AND SHOULD LOOK LIKE ONE.
   *
   * Screens here hand-rolled it per CELL — `{ ...cellStyle, fontWeight: 600 }` repeated once per
   * column — so a six-column total carried six inline style objects, and no two screens agreed on
   * the weight or on whether a rule sat above it. It is one property of the ROW, so it belongs on
   * the row: a rule to separate it from the data, a heavier weight, and the sunken surface the
   * rest of the product already uses to mean *this is not one of the things in the list*.
   */
  variant?: 'default' | 'total';
  style?: CSSProperties;
} & DataAttributes) {
  return (
    <tr
      {...dataAttributes}
      style={
        variant === 'total'
          ? {
              background: 'var(--surface-sunken)',
              fontWeight: 'var(--weight-semibold)' as CSSProperties['fontWeight'],
              borderTop: '2px solid var(--border-default)',
              ...style,
            }
          : style
      }
    >
      {children}
    </tr>
  );
}
