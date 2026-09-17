import type { CSSProperties } from 'react';

/*
 * The LOADING state of the four every data screen must implement (frontend
 * directive §2). A skeleton stands in for the shape that is coming, so the
 * layout does not jump when it arrives.
 *
 * It is aria-hidden and paired with a visually-hidden live message by
 * `SkeletonList`, so a screen reader hears "Loading" once rather than
 * reading out a dozen empty boxes.
 */
export function Skeleton({
  width = '100%',
  height = '1rem',
  radius = 'var(--radius-sm)',
  style,
}: {
  width?: string;
  height?: string;
  radius?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'block',
        width,
        height,
        borderRadius: radius,
        background: 'var(--surface-sunken)',
        animation: 'ibms-skeleton-pulse 1.4s ease-in-out infinite',
        ...style,
      }}
    />
  );
}

export function SkeletonList({ rows = 4, label }: { rows?: number; label: string }) {
  return (
    <div role="status" aria-live="polite" style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <span
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          style={{
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--space-4)',
            background: 'var(--surface-card)',
            display: 'grid',
            gap: 'var(--space-2)',
          }}
        >
          <Skeleton width="40%" height="0.875rem" />
          <Skeleton width="65%" height="0.75rem" />
        </div>
      ))}
    </div>
  );
}
