'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import {
  createSlaHoliday,
  holidayDateIsValid,
  holidayNameIsValid,
  listSlaHolidays,
  SLA_CALENDAR_TYPES,
  type SlaCalendarType,
  type SlaHoliday,
} from '../../lib/sla/sla-holiday-api';
import { ApiError } from '../../lib/auth/api-client';
import { useAuth } from '../../lib/auth/auth-context';
import { useLanguage } from '../../lib/i18n/language-context';
import { hasPermission } from '../../lib/auth/permissions';
import { errorStyle } from '../auth/auth-form.styles';

/*
 * THE NON-WORKING-DAY CALENDAR — the thing every business-day deadline is
 * counted against, and which had no screen at all (IMPROVEMENTS § 1.44, § 1.57).
 *
 * The empty-calendar warning is the point of this section, not decoration. The
 * dev database holds ZERO holiday rows, so the error is live, and it has a
 * direction: a deadline computed without the office's holidays lands EARLIER than
 * the real one, so a breach is reported before it happened and work finished
 * inside the true window is recorded late. The brokerage's own compliance
 * figures currently overstate its lateness, against itself — which is why the
 * warning says so in those terms rather than "no data".
 *
 * It lives on `/sla-policies` rather than behind its own nav entry, and that is
 * measured: every role holding `sla.holiday.create` (Manager, Compliance,
 * Executive) also holds `sla.policy.read`, so the control sits on a screen every
 * holder of its permission can open — § 1.61's rule, which is easy to break by
 * putting a control somewhere reasonable-looking.
 */

const cell: CSSProperties = {
  padding: '0.35rem 0.75rem',
  borderBottom: '1px solid var(--border-subtle)',
  textAlign: 'start',
};
const head: CSSProperties = {
  ...cell,
  fontWeight: 600,
  borderBottom: '2px solid var(--border-default)',
};

/** The stored value is a whole UTC day; render the day, never a local-time
 * conversion that can show the day before. */
function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

export function SlaHolidayCalendar() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const canCreate = hasPermission(user, 'sla.holiday.create');

  const [rows, setRows] = useState<SlaHoliday[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [day, setDay] = useState('');
  const [name, setName] = useState('');
  const [calendar, setCalendar] = useState<SlaCalendarType | ''>('');

  const load = useCallback(async () => {
    try {
      setRows(await listSlaHolidays());
      setLoadError(null);
    } catch (err) {
      setRows(null);
      setLoadError(
        err instanceof ApiError ? err.message : t('slapHolidayLoadError'),
      );
    }
  }, [t]);

  useEffect(() => {
    if (!user) return;
    // The house async-IIFE form. `void load()` here is a lint error: calling
    // setState synchronously inside an effect can cascade renders.
    void (async () => {
      await load();
    })();
  }, [user, load]);

  const add = useCallback(async () => {
    setBusy(true);
    setAddError(null);
    try {
      await createSlaHoliday({
        observedOn: day,
        name,
        ...(calendar === '' ? {} : { calendarType: calendar }),
      });
      setDay('');
      setName('');
      setCalendar('');
      await load();
    } catch (err) {
      // The API's own sentence when it has one: a duplicate date comes back as a
      // 409 naming the day, which is more useful than a generic failure.
      setAddError(
        err instanceof ApiError ? err.message : t('slapHolidayAddError'),
      );
    } finally {
      setBusy(false);
    }
  }, [day, name, calendar, load, t]);

  return (
    <section style={{ margin: '2rem 0' }} data-testid="sla-holidays">
      <h2>{t('slapHolidaysHeading')}</h2>
      <p style={{ opacity: 0.75, maxWidth: '50rem' }}>
        {t('slapHolidaysIntro')}
      </p>

      {/* An EMPTY calendar is not an empty state, it is a wrong-answer state, so
        * it is an alert rather than a muted line. Rendered only once the list has
        * actually loaded: "we do not know yet" must not read as "there are
        * none". */}
      {rows != null && rows.length === 0 && (
        <p
          role="alert"
          data-testid="sla-holidays-empty-warning"
          style={{
            ...errorStyle,
            padding: '0.75rem',
            border: '1px solid currentColor',
            borderRadius: 4,
            maxWidth: '50rem',
          }}
        >
          {t('slapHolidaysEmptyWarning')}
        </p>
      )}

      {loadError && (
        <p role="alert" style={errorStyle}>
          {loadError}
        </p>
      )}
      {addError && (
        <p role="alert" style={errorStyle} data-testid="sla-holiday-add-error">
          {addError}
        </p>
      )}

      {canCreate ? (
        <div
          style={{
            display: 'flex',
            gap: '0.5rem',
            alignItems: 'end',
            flexWrap: 'wrap',
            margin: '0.75rem 0',
          }}
        >
          <label style={{ display: 'grid', gap: '0.2rem' }}>
            <span style={{ fontSize: '0.8rem' }}>{t('slapHolidayDate')}</span>
            <input
              type="date"
              data-testid="sla-holiday-date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </label>
          <label style={{ display: 'grid', gap: '0.2rem' }}>
            <span style={{ fontSize: '0.8rem' }}>{t('slapHolidayName')}</span>
            <input
              type="text"
              data-testid="sla-holiday-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label style={{ display: 'grid', gap: '0.2rem' }}>
            <span style={{ fontSize: '0.8rem' }}>
              {t('slapHolidayCalendar')}
            </span>
            <select
              data-testid="sla-holiday-calendar"
              value={calendar}
              onChange={(e) =>
                setCalendar(e.target.value as SlaCalendarType | '')
              }
            >
              {/* The DEFAULT is every calendar, because a national holiday is
                * the ordinary case and the narrower choice should be the one a
                * reader has to make deliberately. */}
              <option value="">{t('slapHolidayAllCalendars')}</option>
              {SLA_CALENDAR_TYPES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            data-testid="sla-holiday-add"
            disabled={busy || !holidayDateIsValid(day) || !holidayNameIsValid(name)}
            onClick={() => void add()}
          >
            {t('slapHolidayAdd')}
          </button>
        </div>
      ) : (
        <p style={{ fontSize: '0.8rem', color: 'var(--ink-secondary)' }}>
          {t('slapHolidayReadOnly')}
        </p>
      )}

      {rows == null ? (
        loadError ? null : (
          <p>{t('slapHolidayLoading')}</p>
        )
      ) : rows.length > 0 ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', minWidth: '32rem' }}>
            <thead>
              <tr>
                <th style={head}>{t('slapHolidayDate')}</th>
                <th style={head}>{t('slapHolidayName')}</th>
                <th style={head}>{t('slapHolidayCalendar')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.id} data-testid={`sla-holiday-${h.id}`}>
                  <td style={cell}>{dayOf(h.observedOn)}</td>
                  <td style={cell}>{h.name}</td>
                  <td style={cell}>
                    {h.calendarType ?? t('slapHolidayAllCalendars')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
