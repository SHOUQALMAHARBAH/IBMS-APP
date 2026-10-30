'use client';

import type { CSSProperties } from 'react';
import { useLanguage } from '../../lib/i18n/language-context';
import { formatPeriodLabel } from '../../lib/i18n/format';
import type { FigureScope } from '../../lib/management-reporting/sales-dashboard-api';

/**
 * THE PERIOD BESIDE THE FIGURE — owner decision 58, one component for every dashboard.
 *
 * ## WHY THIS EXISTS — she read a true screen as a broken one
 *
 * Her words about `/dashboards/sales`: «قسم العملاء المحتملون بيطلع 0 مع إنه في عملاء
 * محتملون جدد و عملاء محوّلون» — the new-leads section shows 0 when there ARE new and
 * converted leads. Measured at the time: 120 leads, every one created 6–17 October,
 * against a default window of the PREVIOUS calendar month. September held zero. The
 * screen was telling the truth about a month she had not asked about.
 *
 * **And that screen already printed its period**, once, at the top, through
 * `ReportProvenance`'s `period` shape. She still read it as broken — which is the
 * evidence that a line at the top is not enough. A figure and the period it belongs to
 * have to be in the same glance, which is her own instruction: «١٢٠ خلال تشرين الأول»,
 * never a bare «١٢٠».
 *
 * ## THE SECOND CLAUSE IS WHAT KEEPS THE FIRST HONEST
 *
 * «beside EVERY figure» taken literally would have been a NEW false claim.
 * `/dashboards/policy` has two metrics that IGNORE the period filter completely — its
 * own config calls this «a deliberate asymmetry, not an oversight»: active and expiring
 * counts read `Policy.status` / `Policy.expiryDate` as of now whatever window is chosen,
 * because they answer *what does the book look like right now*. A period printed beside
 * one of those is a confident statement about a figure that does not obey it.
 *
 * So there are two clauses and the api says which: `scope` comes from `metricScope` on
 * the wire. **This component must never decide it.** The api is the only thing that
 * knows which of its own queries apply the window, and a screen holding its own copy of
 * that classification is a copy free to stop matching — at which point the label looks
 * like the fix and is the defect.
 *
 * ## WHY A COMPONENT RATHER THAN SIXTEEN INLINE TERNARIES
 *
 * `ReportProvenance`'s own stated reason, one level down: sixteen copies are sixteen
 * places for the WORDING to drift, and the wording is load-bearing here too — «خلال»
 * and «كما في» are different claims, and swapping them tells a reader that a live count
 * covers a month or that a month's count is current.
 *
 * Both Arabic clauses are slices of strings already in `translations/dashboards.ts`, and
 * the MONTH NAME comes from ICU under `ar-JO-u-nu-latn` rather than being typed — see
 * `formatPeriodLabel`, where the measurement is recorded.
 */

const clauseStyle: CSSProperties = {
  color: 'var(--ink-secondary)',
  fontSize: '0.78rem',
};

export function FigurePeriod({
  scope,
  periodLabel,
  generatedAt,
  testId,
}: {
  /** From the api's `metricScope`. Never decided by the screen. */
  scope: FigureScope;
  /** The api's own `periodLabel` (`YYYY-MM`), so there is no second idea of the window. */
  periodLabel: string;
  /** When the report was computed — what an `'asOf'` figure is current to. */
  generatedAt: string;
  testId?: string;
}) {
  const { t, language } = useLanguage();
  return (
    <div style={clauseStyle} data-testid={testId} data-figure-scope={scope}>
      {/* `<bdi>` because a Latin-digit year inside an Arabic clause is a bidi run, and
          without isolation it lands at the wrong end of the line — `ReportProvenance`
          made the same call for the same reason. */}
      <bdi>
        {scope === 'period'
          ? t('dashFigureDuringPeriod', {
              period: formatPeriodLabel(periodLabel, language),
            })
          : t('dashFigureAsOf', { at: generatedAt.slice(0, 10) })}
      </bdi>
    </div>
  );
}
