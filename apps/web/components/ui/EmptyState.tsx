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

/**
 * `data-*` IS FORWARDED, AND THE TYPE IS WHAT MAKES THAT VISIBLE.
 *
 * Both components started with `data-testid` named explicitly, after the pilot found three hooks
 * silently dropped. THAT WAS NOT ENOUGH: a screen hangs its OWN hook on a refusal —
 * `data-line-error`, `data-permission-refusal` — and TypeScript exempts hyphen-containing JSX
 * attributes from excess-property checking, so every one of those type-checks and goes NOWHERE.
 *
 * It cost a real test. Converting `/insurer-directory`'s error paragraph carried its
 * `data-line-error` across faithfully, into a component that dropped it, and the only thing that
 * said so was a Playwright assertion looking for the attribute — `tsc` was clean and the screen
 * rendered perfectly. The index signature accepts the family and the spread forwards it, so the
 * support is a property of the SIGNATURE rather than a list of names somebody has to extend.
 */
type DataAttributes = { [key: `data-${string}`]: string | undefined };

export function EmptyState({
  title,
  description,
  action,
  style,
  ...dataAttributes
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  style?: CSSProperties;
} & DataAttributes) {
  return (
    <div style={{ ...WRAP, ...style }} {...dataAttributes}>
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
  ...dataAttributes
}: {
  title: ReactNode;
  /**
   * What went wrong, in the employee's own terms. Never a stack trace, a
   * table name or raw exception text (directive §2).
   */
  description?: ReactNode;
  action?: ReactNode;
  style?: CSSProperties;
} & DataAttributes) {
  return (
    <div
      role="alert"
      {...dataAttributes}
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
