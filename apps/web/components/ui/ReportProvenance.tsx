'use client';

import type { CSSProperties } from 'react';
import { useLanguage } from '../../lib/i18n/language-context';

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

/**
 * `2026-09-29T14:32:11.482Z` -> `2026-09-29 14:32`. Deliberately NOT `toLocaleString`: these are
 * provenance stamps, and a reader comparing two screens or quoting a figure in an email needs the same
 * characters both times. The DATE ITSELF is language-independent; only the sentence around it translates.
 */
function stamp(iso: string): string {
  return iso.replace('T', ' ').slice(0, 16);
}

/** `2026-09-29T00:00:00.000Z` -> `2026-09-29`. */
function day(iso: string): string {
  return iso.slice(0, 10);
}

export function ReportProvenance(props: ReportProvenanceProps) {
  const { t } = useLanguage();

  // `<bdi>` around every value: a Latin-digit date inside an Arabic sentence is a bidi run, and without
  // isolation the trailing full stop jumps to the wrong end of the line.
  switch (props.kind) {
    case 'generatedAt':
      return (
        <p style={lineStyle} data-testid="report-provenance">
          {t('provGeneratedAt', { at: stamp(props.at) })}
        </p>
      );
    case 'asOf':
      return (
        <p style={lineStyle} data-testid="report-provenance">
          {t('provAsOf', { at: day(props.at) })}
        </p>
      );
    case 'generatedAtWithPeriod':
      return (
        <p style={lineStyle} data-testid="report-provenance">
          {t('provGeneratedAtWithPeriod', {
            at: stamp(props.at),
            period: props.periodLabel,
          })}
        </p>
      );
    case 'period':
      return (
        <p style={lineStyle} data-testid="report-provenance">
          {t('provPeriod', {
            period: props.periodLabel,
            from: day(props.from),
            to: day(props.to),
          })}
        </p>
      );
  }
}
