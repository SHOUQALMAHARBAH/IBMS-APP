'use client';

import { type CSSProperties } from 'react';
import { useLanguage } from '../../lib/i18n/language-context';
import { rfqBadgeStyle } from '../rfq/rfq.styles';

/**
 * Marks an insurer the office has stopped dealing with, wherever one can still be
 * chosen.
 *
 * ## Why this exists
 *
 * Capturing a quotation from a deactivated insurer is deliberately still allowed:
 * a recorded premium is a factual event, and `quotation.service.ts` refuses
 * nothing for a late quote landing after the business went elsewhere. You cannot
 * solicit anything NEW from a deactivated insurer — the RFQ picker will not offer
 * them and an existing RFQ will not take them — but you can record what they said
 * in response to something you already solicited.
 *
 * The consequence is that such a quote reaches the comparison matrix and can be
 * recommended. Without a marker a broker could present it, a client could choose
 * it, and nobody would discover the problem until placement refused — which is a
 * worse failure than not recording the quote at all. So every surface where an
 * insurer is compared or recommended says so.
 *
 * One component rather than three inline spans, for the same reason
 * `insurer-identity.ts` is one definition: three copies of a safety-relevant label
 * drift, and the wording matters here — it has to say the quote is still real and
 * the insurer is not.
 */
export function DeactivatedInsurerBadge({
  isActive,
  style,
}: {
  isActive: boolean;
  /** Extra positioning only. The badge's own appearance is fixed so it reads the
   *  same on a table row and in a recommendation paragraph. */
  style?: CSSProperties;
}) {
  const { t } = useLanguage();
  if (isActive) return null;
  return (
    <span
      style={{ ...rfqBadgeStyle, marginInlineStart: '0.4rem', ...style }}
      // An untranslated hook: the label is bilingual and every badge on the page
      // carries the same shared style, so a test cannot find this one by either.
      data-deactivated-insurer=""
      title={t('insurerDeactivatedExplain')}
    >
      {t('insurerDeactivatedBadge')}
    </span>
  );
}
