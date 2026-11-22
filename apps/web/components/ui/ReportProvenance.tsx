'use client';

import type { CSSProperties } from 'react';
import { useLanguage } from '../../lib/i18n/language-context';
import {
  formatDate,
  formatDateTime,
  formatPeriodLabel,
} from '../../lib/i18n/format';

/**
 * THE LINE THAT SAYS WHEN A REPORT'S FIGURES ARE FROM — one component, both languages.
 *
 * Item 5 batch 1, violation 1. Eight of the sixteen reporting screens wrote this sentence in HARDCODED
 * ENGLISH, so an Arabic reader saw `Generated 2026-09-29 14:32` and `As of 2026-09-29` across half the
 * reporting surface. That is the oldest standing rule in this project broken on the most-read screens.
 *
 * ONE component rather than eight translated strings, for the reason `CombinedDutyReasonField` and
 * `CombinedDutyOnRecord` are single: eight copies are eight places for the WORDING to drift, and the
 * wording here is load-bearing — "generated at" and "as of" are different claims. "Generated" is when the
 * report was COMPUTED; "as of" is the date the figures are measured TO. A screen that swaps them tells the
 * reader a Tuesday report covers Tuesday when it covers the previous month.
 *
 * ## A discriminated union, so a new shape cannot fall through
 *
 * Four shapes existed across the eight screens. They are a union rather than a bag of optional props: a
 * fifth shape is then a compile error at the call site, where an optional-props component would silently
 * render one of the existing sentences with a missing value in it.
 *
 * ## The guard
 *
 * `apps/web/test/report-provenance.test.ts` fails if any reporting screen renders a `generatedAt`, `asOf`
 * or period date in its own JSX. A component is only the single source while nothing bypasses it, and the
 * eight strings this replaces are proof that the convention alone does not hold.
 */

export type ReportProvenanceProps =
  /** When the report was COMPUTED. */
  | { kind: 'generatedAt'; at: string }
  /** The date the figures are measured TO — a different claim from `generatedAt`. */
  | { kind: 'asOf'; at: string }
  /** Computed at, for a named market period. */
  | { kind: 'generatedAtWithPeriod'; at: string; periodLabel: string }
  /** A named period with its own bounds, where there is no separate generation time. */
  | { kind: 'period'; periodLabel: string; from: string; to: string };

const lineStyle: CSSProperties = {
  color: 'var(--ink-secondary)',
  fontSize: '0.85rem',
};

/*
 * 🔴 OWNER DECISION 156 RULING 1 — ONE DATE SHAPE ON SCREENS, AND THIS FILE IS WHY IT IS SMALL.
 *
 * These two helpers used to cut the characters out of the ISO string the api sent:
 * `.replace('T', ' ').slice(0, 16)` and `.slice(0, 10)`, giving «2026-11-19 10:15» and
 * «2026-11-19». Every other screen in the product renders «19/11/2026» through `formatDate`, so
 * the dashboards and the licence screen were a second shape for one thing.
 *
 * ⟶ They go through the shipping formatters now. ⛔ The paper certificate and the four documents
 *   keep their written month name — her ruling says so in its own words — and they do not come
 *   through here.
 *
 * ## The comment that stood here said the slicing was DELIBERATE, and it was
 *
 * It argued that a provenance stamp should give two readers comparing two screens the same
 * characters, and that the date itself is language-independent. Her ruling replaces that
 * judgement: a reader who meets «19/11/2026» everywhere else in the product and «2026-11-19»
 * here is being shown two systems.
 *
 * ## And the slicing was not only a different shape, it was a different DAY
 *
 * `.slice(0, 10)` prints the UTC day. Amman is UTC+3, so an instant between midnight and 03:00
 * local printed YESTERDAY's date — measured: `2026-11-20T01:30:00Z` sliced to «2026-11-19» while
 * Amman was already on the 20th. The formatters use the reader's own zone, so that class is gone
 * rather than reshaped.
 */

export function ReportProvenance(props: ReportProvenanceProps) {
  const { t, language } = useLanguage();

  // `<bdi>` around every value: a Latin-digit date inside an Arabic sentence is a bidi run, and without
  // isolation the trailing full stop jumps to the wrong end of the line.
  switch (props.kind) {
    case 'generatedAt':
      return (
        <p style={lineStyle} data-testid="report-provenance">
          {t('provGeneratedAt', { at: formatDateTime(props.at, language) })}
        </p>
      );
    case 'asOf':
      return (
        <p style={lineStyle} data-testid="report-provenance">
          {t('provAsOf', { at: formatDate(props.at, language) })}
        </p>
      );
    case 'generatedAtWithPeriod':
      return (
        <p style={lineStyle} data-testid="report-provenance">
          {t('provGeneratedAtWithPeriod', {
            at: formatDateTime(props.at, language),
            period: formatPeriodLabel(props.periodLabel, language),
          })}
        </p>
      );
    case 'period':
      return (
        <p style={lineStyle} data-testid="report-provenance">
          {t('provPeriod', {
            period: formatPeriodLabel(props.periodLabel, language),
            from: formatDate(props.from, language),
            to: formatDate(props.to, language),
          })}
        </p>
      );
  }
}
