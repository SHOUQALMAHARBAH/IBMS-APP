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
  padding: 'var(--space-5)',
  border: '1px dashed var(--border-strong)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--surface-card)',
};

export function EmptyState({
  title,
  description,
  action,
  style,
  'data-testid': testId,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  style?: CSSProperties;
  /*
   * FORWARDED EXPLICITLY. TypeScript exempts hyphen-containing JSX attributes from
   * excess-property checking, so `data-testid` on a custom component type-checks and then
   * goes NOWHERE — which is how moving a screen's markup onto these primitives silently
   * killed three test hooks with `tsc` clean and the screens rendering perfectly. Named
   * rather than absorbed by a props spread, so the support is visible in the signature.
   */
  'data-testid'?: string;
}) {
  return (
    <div style={{ ...WRAP, ...style }} data-testid={testId}>
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
  'data-testid': testId,
}: {
  title: ReactNode;
  /**
   * What went wrong, in the employee's own terms. Never a stack trace, a
   * table name or raw exception text (directive §2).
   */
  description?: ReactNode;
  action?: ReactNode;
  style?: CSSProperties;
  /** Forwarded explicitly — see the note on `EmptyState` above. */
  'data-testid'?: string;
}) {
  return (
    <div
      role="alert"
      data-testid={testId}
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
