import type { CSSProperties, ReactNode } from 'react';

/*
 * The EMPTY and ERROR states of the four every data screen must implement
 * (frontend directive §2).
 *
 * The directive is specific about the copy, and these components are shaped
 * to make the right thing the easy thing:
 *
 *   - `title` says what belongs here, never "No data".
 *   - `action` is the ONE thing that would fill it, and is optional because
 *     a role without permission to create the missing thing must not be
 *     offered a control it cannot use (directive §1).
 *
 * ErrorState is deliberately a sibling rather than a `tone` prop: an error
 * is not an empty list, it needs a retry affordance, and conflating them is
 * how "No data" ends up shown for a failed request.
 */
const WRAP: CSSProperties = {
  display: 'grid',
  justifyItems: 'center',
  textAlign: 'center',
  gap: 'var(--space-2)',
  padding: 'var(--space-10) var(--space-6)',
  border: '1px dashed var(--border-strong)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--surface-card)',
};

export function EmptyState({
  title,
  description,
  action,
  style,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div style={{ ...WRAP, ...style }}>
      <p style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--weight-semibold)' as CSSProperties['fontWeight'] }}>
        {title}
      </p>
      {description ? (
        <p style={{ fontSize: 'var(--text-base)', color: 'var(--ink-secondary)', maxWidth: '48ch' }}>{description}</p>
      ) : null}
      {action ? <div style={{ marginTop: 'var(--space-3)' }}>{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title,
  description,
  action,
  style,
}: {
  title: ReactNode;
  /**
   * What went wrong, in the employee's own terms. Never a stack trace, a
   * table name or raw exception text (directive §2).
   */
  description?: ReactNode;
  action?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      role="alert"
      style={{
        ...WRAP,
        border: '1px solid var(--danger-border)',
        background: 'var(--danger-bg)',
        ...style,
      }}
    >
      <p
        style={{
          fontSize: 'var(--text-md)',
          fontWeight: 'var(--weight-semibold)' as CSSProperties['fontWeight'],
          color: 'var(--danger-ink)',
        }}
      >
        {title}
      </p>
      {description ? (
        <p style={{ fontSize: 'var(--text-base)', color: 'var(--danger-ink)', maxWidth: '48ch' }}>{description}</p>
      ) : null}
      {action ? <div style={{ marginTop: 'var(--space-3)' }}>{action}</div> : null}
    </div>
  );
}
