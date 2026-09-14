import type { CSSProperties, ReactNode } from 'react';

/*
 * The standard content container. A Card carries a title only when the title
 * says something the content does not — frontend directive §3, nothing on a
 * page that is not earning its place.
 */
export function Card({
  title,
  description,
  actions,
  children,
  padded = true,
  style,
}: {
  title?: ReactNode;
  description?: ReactNode;
  /** Right-aligned (inline-end) controls in the header, e.g. an Export button. */
  actions?: ReactNode;
  children?: ReactNode;
  padded?: boolean;
  style?: CSSProperties;
}) {
  const hasHeader = Boolean(title || description || actions);
  return (
    <section
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
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 'var(--space-4)',
        flexWrap: 'wrap',
        marginBottom: 'var(--space-6)',
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
