'use client';

import type { CSSProperties } from 'react';
import { useLanguage } from '../../lib/i18n/language-context';
import { formatNumber } from '../../lib/i18n/format';

/*
 * The page control for the five lists that grow without bound — customers,
 * policies, claims, invoices, the audit trail.
 *
 * One component, so those five behave identically. Previous/Next rather than
 * numbered pages: the endpoints are offset-paginated and ordered newest-first,
 * and a person working a queue moves through it rather than jumping to page
 * 47. Numbered pages can be added here later without touching five screens.
 *
 * The range reads "1–50 of 312" rather than "312 results", which avoids a
 * plural entirely — a count would need all six Arabic forms, and a range needs
 * none. Numbers go through `formatNumber` so they are grouped the way every
 * other figure in the app is.
 */

const barStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--space-3)',
  marginTop: 'var(--space-3)',
  flexWrap: 'wrap',
};

const buttonStyle: CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 'var(--text-sm)',
  padding: 'var(--space-1) var(--space-3)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-default)',
  background: 'var(--surface-card)',
  color: 'var(--ink-primary)',
  cursor: 'pointer',
};

const disabledStyle: CSSProperties = {
  ...buttonStyle,
  // Matches components/ui/Button.tsx's inert treatment. `opacity` is correct
  // here and nowhere else: axe exempts disabled controls from contrast,
  // precisely because they are not actionable.
  opacity: 0.55,
  cursor: 'not-allowed',
};

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  busy = false,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (next: number) => void;
  busy?: boolean;
}) {
  const { language, t } = useLanguage();

  // Nothing to page through: one page of results needs no control, and an
  // empty list already says so in its own empty state.
  if (total <= pageSize) return null;

  const from = page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, total);
  const isFirst = page === 0;
  const isLast = to >= total;

  return (
    <nav aria-label={t('pagingAria')} style={barStyle}>
      <span aria-live="polite" style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)' }}>
        {t('pagingRange', {
          from: formatNumber(from, language),
          to: formatNumber(to, language),
          total: formatNumber(total, language),
        })}
      </span>
      <span style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={isFirst || busy}
          style={isFirst || busy ? disabledStyle : buttonStyle}
        >
          {t('pagingPrevious')}
        </button>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={isLast || busy}
          style={isLast || busy ? disabledStyle : buttonStyle}
        >
          {t('pagingNext')}
        </button>
      </span>
    </nav>
  );
}
