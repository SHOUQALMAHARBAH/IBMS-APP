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
export function Table({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ width: '100%', overflowX: 'auto', ...style }}>
      <table
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
  style,
}: {
  children?: ReactNode;
  /** Right-aligns in LTR and left-aligns in RTL, via logical `end`. */
  numeric?: boolean;
  style?: CSSProperties;
}) {
  return (
    <th
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
  style,
}: {
  children?: ReactNode;
  numeric?: boolean;
  style?: CSSProperties;
}) {
  return (
    <td
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
 * A ROW, AND IT FORWARDS `data-testid` EXPLICITLY — which is not a convenience.
 *
 * TypeScript exempts hyphen-containing JSX attributes from excess-property checking, so
 * `data-anything` on ANY custom component type-checks and then goes nowhere. That is how moving a
 * screen's `<tr data-testid=…>` onto this component silently killed two hooks
 * `self-approval-report.spec.ts` reads — with `tsc` clean, the screen rendering perfectly, and the
 * spec that covers the SAME SCREEN still green because it happens not to use them.
 *
 * It is declared as a named prop rather than absorbed by a props spread, so the support is
 * visible in the signature. A row that needs more than this should render a plain `<tr>`.
 */
export function Tr({
  children,
  style,
  'data-testid': testId,
}: {
  children: ReactNode;
  style?: CSSProperties;
  'data-testid'?: string;
}) {
  return (
    <tr style={style} data-testid={testId}>
      {children}
    </tr>
  );
}
