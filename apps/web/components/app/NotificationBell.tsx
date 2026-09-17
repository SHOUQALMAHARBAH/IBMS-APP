'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '../../lib/i18n/language-context';
import { formatNumber } from '../../lib/i18n/format';
import {
  listNotifications,
  type NotificationFeed,
  type NotificationKind,
} from '../../lib/notification/notification-api';
import type { TranslationKey } from '../../lib/i18n/translations';

/*
 * The bell. Replaces the `<span aria-hidden>` placeholder that held this slot,
 * and becomes a real button with a badge in the same change — which is what
 * that placeholder's own comment said would happen.
 *
 * It shows LIVE WORK, not a history: each row is a count taken at read time,
 * and an item disappears the moment the work behind it is done. There is no
 * read/unread state, on this device or any other, because there is nothing
 * stored to mark as read. See README § Known gaps before assuming otherwise.
 *
 * The panel is a `<details>`-free popover driven by state, because it has to
 * close on Escape and on outside click — behaviour `<details>` does not give
 * us. The trigger keeps `aria-expanded` so a screen reader knows the panel
 * exists and whether it is open.
 */

const LABEL_KEY: Record<NotificationKind, TranslationKey> = {
  sla_overdue: 'notifSlaOverdue',
  claim_followup: 'notifClaimFollowup',
  aml_alert: 'notifAmlAlert',
  screening_match: 'notifScreeningMatch',
  service_request_assigned: 'notifServiceRequestAssigned',
  customer_pending_kyc: 'notifCustomerPendingKyc',
};

const triggerStyle: CSSProperties = {
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--space-1)',
  background: 'none',
  border: '1px solid transparent',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-1)',
  color: 'var(--nav-ink-muted)',
  fontSize: 'var(--text-md)',
  lineHeight: 1,
  cursor: 'pointer',
};

const badgeStyle: CSSProperties = {
  minWidth: '1.15rem',
  padding: '0 0.25rem',
  borderRadius: '999px',
  background: 'var(--danger-solid, #b42318)',
  color: '#fff',
  fontSize: '0.7rem',
  lineHeight: '1.15rem',
  textAlign: 'center',
  fontVariantNumeric: 'tabular-nums',
};

const panelStyle: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + var(--space-1))',
  // Logical, so the panel opens INWARD under RTL instead of off the screen —
  // the same reason the profile menu next to it uses insetInlineEnd.
  insetInlineEnd: 0,
  minWidth: '18rem',
  background: 'var(--surface-card)',
  color: 'var(--ink-primary)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-md, 0 8px 24px rgba(0,0,0,0.18))',
  padding: 'var(--space-2)',
  zIndex: 40,
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--space-3)',
  width: '100%',
  padding: 'var(--space-2)',
  background: 'none',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  color: 'inherit',
  font: 'inherit',
  textAlign: 'start',
  cursor: 'pointer',
};

const countStyle: CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--ink-secondary)',
};

export function NotificationBell() {
  const { language, t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [feed, setFeed] = useState<NotificationFeed | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    // `.then`, not an awaited helper: `set-state-in-effect` traces into the
    // callee. The flag closes the unmount race while we are here.
    listNotifications()
      .then((f) => {
        if (!cancelled) setFeed(f);
      })
      .catch(() => {
        // A bell that cannot load is silent, never an error banner across the
        // top of every screen in the app.
        if (!cancelled) setFeed({ items: [], total: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  // Defensive about SHAPE, not just null: a payload that is not the envelope
  // this expects must render an empty bell, never crash the whole app shell.
  const items = Array.isArray(feed?.items) ? feed.items : [];
  const total = typeof feed?.total === 'number' ? feed.total : 0;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        style={triggerStyle}
        aria-expanded={open}
        // The count is IN the accessible name: "Notifications, 7 items need
        // attention" tells a screen-reader user what the badge tells everyone
        // else, which a bare "Notifications" would not.
        aria-label={
          total > 0
            ? t('notifBellAriaWithCount', { count: formatNumber(total, language) })
            : t('notifBellAriaEmpty')
        }
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">🔔</span>
        {total > 0 ? (
          <span aria-hidden="true" style={badgeStyle}>
            {formatNumber(total, language)}
          </span>
        ) : null}
      </button>

      {open ? (
        <div style={panelStyle} role="group" aria-label={t('notifPanelAria')}>
          {items.length > 0 ? (
            items.map((item) => (
              <button
                key={item.kind}
                type="button"
                style={rowStyle}
                onClick={() => {
                  setOpen(false);
                  router.push(item.href);
                }}
              >
                <span>{t(LABEL_KEY[item.kind])}</span>
                <span style={countStyle}>{formatNumber(item.count, language)}</span>
              </button>
            ))
          ) : (
            <p style={{ margin: 0, padding: 'var(--space-2)', color: 'var(--ink-secondary)' }}>
              {t('notifNothingToDo')}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
