import type { CSSProperties, ReactNode } from 'react';
import type { DataAttributes } from './data-attributes';

/*
 * The standard content container. A Card carries a title only when the title
 * says something the content does not — frontend directive §3, nothing on a
 * page that is not earning its place.
 *
 * It forwards `data-*` — see `data-attributes.ts` for why a named `data-testid` was not enough.
 * `/retention-disposal` hangs `data-testid` on two of its sections, and before this those two
 * hooks type-checked and went nowhere.
 */
export function Card({
  title,
  description,
  actions,
  children,
  padded = true,
  style,
  ...dataAttributes
}: {
  title?: ReactNode;
  description?: ReactNode;
  /** Right-aligned (inline-end) controls in the header, e.g. an Export button. */
  actions?: ReactNode;
  children?: ReactNode;
  padded?: boolean;
  style?: CSSProperties;
} & DataAttributes) {
  const hasHeader = Boolean(title || description || actions);
  return (
    <section
      {...dataAttributes}
      style={{
        background: 'var(--surface-card)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        overflow: 'hidden',
        ...style,
      }}
    >
      {hasHeader ? (
        <header
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 'var(--space-4)',
            padding: 'var(--space-4) var(--space-5)',
            borderBottom: children ? '1px solid var(--border-subtle)' : 'none',
          }}
        >
          <div style={{ minWidth: 0 }}>
            {title ? (
              <h3 style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--weight-semibold)' as CSSProperties['fontWeight'] }}>
                {title}
              </h3>
            ) : null}
            {description ? (
              <p style={{ marginTop: 'var(--space-1)', fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)' }}>
                {description}
              </p>
            ) : null}
          </div>
          {actions ? <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>{actions}</div> : null}
        </header>
      ) : null}
      {children ? <div style={padded ? { padding: 'var(--space-5)' } : undefined}>{children}</div> : null}
    </section>
  );
}

/** Page title block. One per screen, above the content. */
export function PageHeader({
  title,
  description,
  actions,
  ...dataAttributes
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
} & DataAttributes) {
  return (
    <header
      {...dataAttributes}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 'var(--space-4)',
        flexWrap: 'wrap',
        /*
         * NO BOTTOM MARGIN. `pageStackStyle` spaces a page's children with one gap, so a margin
         * here is a second answer to the same question — and it was 22px against the page's own
         * step, which is how a heading ends up fractionally further from its content on every
         * screen than the sections below it are from each other.
         */
      }}
    >
      <div style={{ minWidth: 0 }}>
        <h1 style={{ fontSize: 'var(--text-2xl)' }}>{title}</h1>
        {description ? (
          <p
            style={{
              marginTop: 'var(--space-2)',
              fontSize: 'var(--text-base)',
              color: 'var(--ink-secondary)',
              maxWidth: '60ch',
            }}
          >
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>{actions}</div> : null}
    </header>
  );
}
