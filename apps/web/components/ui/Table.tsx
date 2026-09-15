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

export function Tr({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <tr style={style}>{children}</tr>;
}
