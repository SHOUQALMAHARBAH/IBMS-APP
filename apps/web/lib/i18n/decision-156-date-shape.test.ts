import { describe, expect, it } from 'vitest';

import { formatDate, formatDateTime, formatPeriodLabel } from './format';

/**
 * 🔴 OWNER DECISION 156 RULING 1 — ONE DATE SHAPE ON SCREENS.
 *
 * «كل تاريخ على شاشة يُطبَع بالشكل الشغّال في معظم الشاشات: «31/12/2028».» The dashboards and
 * the licence screen cut the characters out of the ISO string the api sent — `.slice(0, 10)`
 * for a day, `.replace('T', ' ').slice(0, 16)` for a stamp — so a reader met «2026-11-19» there
 * and «19/11/2026» on every other screen in the product.
 *
 * ⛔ The paper certificate and the four documents keep their written month name
 * («31 كانون الأول 2028»), which her ruling says in its own words. They go through
 * `formatDocumentDate` on the api side and never through this file.
 *
 * ## The slice was not only a second SHAPE, it was a second DAY
 *
 * `.slice(0, 10)` prints the UTC day. Amman is UTC+3, so an instant between midnight and 03:00
 * local printed YESTERDAY. That is asserted below against an explicitly-zoned formatter, so the
 * claim holds whatever zone this suite happens to run in.
 */

/** Amman, stated explicitly — the product uses the READER's zone, and this is the office's. */
const AMMAN = 'Asia/Amman';

function ammanDay(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone: AMMAN }).format(
    new Date(iso),
  );
}

describe('owner decision 156 ruling 1 — the one date shape', () => {
  it('renders a day as DD/MM/YYYY in both languages, never as YYYY-MM-DD', () => {
    const iso = '2026-11-19T10:15:42.482Z';
    for (const language of ['AR', 'EN'] as const) {
      const shown = formatDate(iso, language);
      // The shipping shape her ruling points at. Arabic carries U+200F marks around the
      // separators, which is `Intl` isolating a Latin-digit run inside an RTL string — so the
      // digits are matched rather than the whole string compared.
      expect(shown.replace(/‏/g, '')).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
      expect(shown).not.toMatch(/^\d{4}-\d{2}-\d{2}/);
    }
  });

  /*
   * THE DAY-BOUNDARY CLASS, which is the half a reader would never have reported as a bug: the
   * date was simply wrong by one, overnight, and only overnight.
   */
  it('does not print yesterday for an instant in Amman’s small hours', () => {
    const iso = '2026-11-20T01:30:00.000Z';
    // What the old code did, stated so the test says what it replaced.
    expect(iso.slice(0, 10)).toBe('2026-11-20');
    // 01:30 UTC is 04:30 in Amman on the 20th, so both agree here...
    expect(ammanDay(iso, 'en-GB')).toBe('20/11/2026');

    // ...and here they do NOT: 22:30 UTC on the 19th is already 01:30 on the 20th in Amman.
    const late = '2026-11-19T22:30:00.000Z';
    expect(late.slice(0, 10)).toBe('2026-11-19');
    expect(ammanDay(late, 'en-GB')).toBe('20/11/2026');
    // So the slice and the office's own day disagree, which is the defect in one line.
    expect(ammanDay(late, 'en-GB')).not.toContain(late.slice(0, 10));
  });

  /*
   * ⚠️ THE EXACT ARABIC STRING `formatDateTime` RENDERS, pinned so the owner can read it in the
   * report and rule on it. Her paper asked for exactly this: «شكلها بالحرف لم يُرَ بعد: المهندس
   * يكتب في تقريره ما تطبعه الدالّة الشغّالة».
   *
   * It carries SECONDS and the Arabic day-period marker «م». That is the shipping function's own
   * output and it is what ships; it is REPORTED as a possible empty cell rather than reshaped
   * here, because inventing a shorter format would be deciding something she has not.
   */
  it('renders a date-with-time as DD/MM/YYYY، h:mm:ss am/pm in Arabic', () => {
    const shown = formatDateTime('2026-11-19T10:15:42.482Z', 'AR');
    const bare = shown.replace(/‏/g, '');
    expect(bare).toMatch(/^\d{2}\/\d{2}\/\d{4}، \d{1,2}:\d{2}:\d{2} [صم]$/);
    // Western digits throughout — decision 146 ruling 1, which `ar-JO-u-nu-latn` is chosen for.
    expect(bare).not.toMatch(/[٠-٩۰-۹]/);
  });

  it('renders a raw YYYY-MM period label as a month name, not as itself', () => {
    expect(formatPeriodLabel('2026-11', 'EN')).toBe('November 2026');
    expect(formatPeriodLabel('2026-11', 'AR')).toContain('2026');
    // Western digits in the Arabic month label too.
    expect(formatPeriodLabel('2026-11', 'AR')).not.toMatch(/[٠-٩]/);
  });
});
