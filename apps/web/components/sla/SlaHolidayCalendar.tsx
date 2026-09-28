'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import {
  addFixedHolidaysForYear,
  addMovingOccasion,
  createSlaHoliday,
  getHolidayYear,
  holidayDateIsValid,
  holidayNameIsValid,
  SLA_CALENDAR_TYPES,
  type HolidayYearView,
  type SlaCalendarType,
} from '../../lib/sla/sla-holiday-api';
import { ApiError } from '../../lib/auth/api-client';
import { useAuth } from '../../lib/auth/auth-context';
import { useLanguage } from '../../lib/i18n/language-context';
import { hasPermission } from '../../lib/auth/permissions';
import { errorStyle } from '../auth/auth-form.styles';

/*
 * THE NON-WORKING-DAY CALENDAR, ONE YEAR AT A TIME.
 *
 * Every business-day deadline in the system is counted against this. `GET`/`POST
 * /sla/holidays` had no screen at all (IMPROVEMENTS § 1.44, § 1.57), and the error has a
 * direction: a deadline computed without the office's holidays lands EARLIER than the
 * real one, so a breach is reported before it happened and work finished inside the true
 * window is recorded late. The brokerage's own compliance figures overstate its lateness,
 * against itself.
 *
 * ## WHY IT IS PER YEAR
 *
 * Jordan's holidays split in two (Ministry of Foreign Affairs,
 * https://www.mfa.gov.jo/content/public-holidays):
 *
 *   FIXED    1 Jan · 1 May · 25 May · 25 Dec — same date every year, seeded and fillable
 *   MOVING   Islamic New Year · Prophet's Birthday · Eid al-Fitr (4d) · Eid al-Adha (5d)
 *
 * **The moving dates are never computed, and that is the whole reason this screen is
 * shaped around a year.** In Jordan the actual holiday is set by official announcement
 * and can differ by a day from any calendar conversion; a computed Hijri calendar would
 * be wrong most years and nobody would know why, because every deadline would simply be
 * off and the error would look like arithmetic rather than a wrong input.
 *
 * So the screen's job is to say what the selected year is still MISSING. A calendar that
 * only lists what is present cannot do that, and "what do we still owe after this year's
 * announcement" is the question an office actually has.
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
const muted: CSSProperties = {
  fontSize: '0.8rem',
  color: 'var(--ink-secondary)',
  margin: 0,
};
const fieldStyle: CSSProperties = { display: 'grid', gap: '0.2rem' };

/** The stored value is a whole UTC day; render the day, never a local-time conversion
 * that can show the day before. */
function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

export function SlaHolidayCalendar() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const canCreate = hasPermission(user, 'sla.holiday.create');

  const [year, setYear] = useState(() => new Date().getUTCFullYear());
  const [view, setView] = useState<HolidayYearView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // One-off entry, for a closure this vocabulary does not know about.
  const [day, setDay] = useState('');
  const [name, setName] = useState('');
  const [calendar, setCalendar] = useState<SlaCalendarType | ''>('');

  // A moving occasion from the announcement.
  const [occasion, setOccasion] = useState('');
  const [startDay, setStartDay] = useState('');

  const load = useCallback(
    async (y: number) => {
      try {
        setView(await getHolidayYear(y));
        setLoadError(null);
      } catch (err) {
        setView(null);
        setLoadError(
          err instanceof ApiError ? err.message : t('slapHolidayLoadError'),
        );
      }
    },
    [t],
  );

  useEffect(() => {
    if (!user) return;
    void (async () => {
      await load(year);
    })();
  }, [user, year, load]);

  const run = useCallback(
    async (work: () => Promise<unknown>, fallbackKey: 'slapHolidayAddError' | 'slapHolidayOccasionError') => {
      setBusy(true);
      setActionError(null);
      try {
        await work();
        await load(year);
      } catch (err) {
        // The API's own sentence when it has one: a duplicate date comes back as a 409
        // naming the day, which is more useful than a generic failure.
        setActionError(err instanceof ApiError ? err.message : t(fallbackKey));
      } finally {
        setBusy(false);
      }
    },
    [load, year, t],
  );

  const owes =
    view != null &&
    (view.missingFixed.length > 0 || view.missingOccasions.length > 0);

  return (
    <section style={{ margin: '2rem 0' }} data-testid="sla-holidays">
      <h2>{t('slapHolidaysHeading')}</h2>
      <p style={{ opacity: 0.75, maxWidth: '50rem' }}>
        {t('slapHolidaysIntro')}
      </p>

      <label style={{ display: 'inline-flex', gap: '0.5rem', margin: '0.5rem 0' }}>
        {t('slapHolidayYear')}
        <select
          aria-label={t('slapHolidayYear')}
          data-testid="sla-holiday-year"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        >
          {/* Last year through three ahead: an office corrects the year just gone and
            * enters the one just announced. A longer list is a guess about how far
            * ahead anybody plans. */}
          {[-1, 0, 1, 2, 3].map((offset) => {
            const y = new Date().getUTCFullYear() + offset;
            return (
              <option key={y} value={y}>
                {y}
              </option>
            );
          })}
        </select>
      </label>

      {/* An EMPTY year is not an empty state, it is a wrong-answer state — every
        * business-day deadline in it is computed as though Fridays were the only
        * non-working days. Rendered only once the year has loaded: "we do not know yet"
        * must not read as "there are none". */}
      {view != null && view.holidays.length === 0 && (
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
      {actionError && (
        <p role="alert" style={errorStyle} data-testid="sla-holiday-add-error">
          {actionError}
        </p>
      )}

      {view != null && !owes && (
        <p style={muted} data-testid="sla-holiday-year-complete">
          {t('slapHolidayYearComplete')}
        </p>
      )}

      {view != null && owes && (
        <div data-testid="sla-holiday-year-owes" style={{ margin: '0.75rem 0' }}>
          <strong>{t('slapHolidayYearOwes')}</strong>

          {view.missingFixed.length > 0 && (
            <div style={{ margin: '0.4rem 0' }}>
              <div style={muted}>{t('slapHolidayFixedMissing')}</div>
              <ul style={{ margin: '0.2rem 0', paddingInlineStart: '1.1rem' }}>
                {view.missingFixed.map((f) => (
                  <li key={f.observedOn} style={{ fontSize: '0.85rem' }}>
                    {f.observedOn} · {f.nameEn}
                  </li>
                ))}
              </ul>
              {canCreate && (
                <button
                  type="button"
                  data-testid="sla-holiday-add-fixed"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => addFixedHolidaysForYear(year),
                      'slapHolidayAddError',
                    )
                  }
                >
                  {t('slapHolidayAddFixed')}
                </button>
              )}
              <p style={{ ...muted, maxWidth: '44rem' }}>
                {t('slapHolidayFixedNote')}
              </p>
            </div>
          )}

          {view.missingOccasions.length > 0 && (
            <div style={{ margin: '0.4rem 0' }}>
              <div style={muted}>{t('slapHolidayMovingHeading')}</div>
              <ul style={{ margin: '0.2rem 0', paddingInlineStart: '1.1rem' }}>
                {view.missingOccasions.map((o) => (
                  <li
                    key={o.key}
                    style={{ fontSize: '0.85rem' }}
                    data-testid={`sla-holiday-missing-${o.key}`}
                  >
                    {o.nameEn} · {o.days} {t('slapHolidayDays')}
                  </li>
                ))}
              </ul>
              <p style={{ ...muted, maxWidth: '44rem' }}>
                {t('slapHolidayMovingNote')}
              </p>

              {canCreate && (
                <div
                  style={{
                    display: 'flex',
                    gap: '0.5rem',
                    alignItems: 'end',
                    flexWrap: 'wrap',
                  }}
                >
                  <label style={fieldStyle}>
                    <span style={{ fontSize: '0.8rem' }}>
                      {t('slapHolidayOccasion')}
                    </span>
                    <select
                      data-testid="sla-holiday-occasion"
                      value={occasion}
                      onChange={(e) => setOccasion(e.target.value)}
                    >
                      <option value="">{t('slapHolidayOccasion')}</option>
                      {view.missingOccasions.map((o) => (
                        <option key={o.key} value={o.key}>
                          {o.nameEn} ({o.days})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={fieldStyle}>
                    <span style={{ fontSize: '0.8rem' }}>
                      {t('slapHolidayStartDate')}
                    </span>
                    <input
                      type="date"
                      data-testid="sla-holiday-occasion-start"
                      value={startDay}
                      onChange={(e) => setStartDay(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    data-testid="sla-holiday-add-occasion"
                    // Only the START date is collected — the server supplies the length
                    // from the occasion, so a five-day Eid cannot be entered as four.
                    disabled={
                      busy || occasion === '' || !holidayDateIsValid(startDay)
                    }
                    onClick={() =>
                      void run(
                        () => addMovingOccasion(occasion, startDay),
                        'slapHolidayOccasionError',
                      )
                    }
                  >
                    {t('slapHolidayAddOccasion')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
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
          <label style={fieldStyle}>
            <span style={{ fontSize: '0.8rem' }}>{t('slapHolidayDate')}</span>
            <input
              type="date"
              data-testid="sla-holiday-date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </label>
          <label style={fieldStyle}>
            <span style={{ fontSize: '0.8rem' }}>{t('slapHolidayName')}</span>
            <input
              type="text"
              data-testid="sla-holiday-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label style={fieldStyle}>
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
              {/* The DEFAULT is every calendar, because a national holiday is the
                * ordinary case and the narrower choice should be the deliberate one. */}
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
            onClick={() =>
              void run(
                async () => {
                  await createSlaHoliday({
                    observedOn: day,
                    name,
                    ...(calendar === '' ? {} : { calendarType: calendar }),
                  });
                  setDay('');
                  setName('');
                  setCalendar('');
                },
                'slapHolidayAddError',
              )
            }
          >
            {t('slapHolidayAdd')}
          </button>
        </div>
      ) : (
        <p style={{ fontSize: '0.8rem', color: 'var(--ink-secondary)' }}>
          {t('slapHolidayReadOnly')}
        </p>
      )}

      {view == null ? (
        loadError ? null : (
          <p>{t('slapHolidayLoading')}</p>
        )
      ) : view.holidays.length > 0 ? (
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
              {view.holidays.map((h) => (
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
