'use client';

import { useLanguage } from '../../lib/i18n/language-context';
import { formatNumber } from '../../lib/i18n/format';
import type { TranslationKey } from '../../lib/i18n/translations';
import type {
  Article15DAlert,
  Article15DExemption,
  Article15DExemptionRecord,
} from '../../lib/rfq/rfq-api';
import {
  a15dOptionStyle,
  a15dProseStyle,
  a15dQuestionStyle,
  a15dSectionStyle,
  a15dWindowStyle,
  a15dWindowTitleStyle,
} from './rfq.styles';

/**
 * WHAT THIS REQUEST RESTS ON — ART. 15/d, ON THE RECORD.
 *
 * The owner's own flow: «الإعفاء يُخزَّن مع الطلب، و«اختاره:» واسم الموظف» — the exemption is
 * stored WITH the request, and the record names who chose it. ⟶ A row nobody can see is not a
 * record: the whole value of the exemption is that an inspector, and the office itself, can read
 * what the request was sent under.
 *
 * ## RENDERS NOTHING ON 84.3% OF REQUESTS
 *
 * No exemption means the request reached three insurers or more, which is OWNER DECISION 130
 * ruling 1 — the law being complied with. ⛔ Not «no exemption needed», not a green tick, not a
 * reassurance: a note on every request would bury the minority that actually has one, which is
 * the same argument that keeps the window off the routine.
 *
 * ## AND THE ALERT IS SHOWN WHERE THE EXEMPTION IS, DELIBERATELY
 *
 * An art. 15/d/4 warning is about THIS exemption — a quotation came back above the ceiling it was
 * recorded under. Shown anywhere else it would read as a problem with the quotation, which is
 * exactly what OWNER DECISION 126 says it is not: the quote stands, the exemption stands, and
 * what changed is that the office now knows the two no longer agree.
 */

const EXEMPTION_LABEL_KEY: Record<Article15DExemption, TranslationKey> = {
  INDIVIDUAL_MEDICAL_RENEWAL: 'a15dExemption1',
  GROUP_MEDICAL_RENEWAL_UP_TO_THREE_YEARS: 'a15dExemption2',
  DEFINED_BENEFIT_CONTRACT: 'a15dExemption3',
  LOW_PREMIUM_MOTOR_MEDICAL_OR_TRANSIT: 'a15dExemption4',
  AT_CUSTOMER_REQUEST: 'a15dExemption5',
};

export function Article15DRecord({
  exemption,
  alerts = [],
}: {
  exemption: Article15DExemptionRecord | null | undefined;
  alerts?: Article15DAlert[];
}) {
  const { t, language } = useLanguage();

  if (!exemption) return null;

  const ceiling = exemption.ceilingValueJod
    ? formatNumber(Number(exemption.ceilingValueJod), language)
    : null;

  return (
    <section style={a15dSectionStyle} data-article-15-d="record">
      <p style={a15dQuestionStyle}>
        {exemption.exemption === 'LOW_PREMIUM_MOTOR_MEDICAL_OR_TRANSIT' &&
        ceiling !== null
          ? t('a15dExemption4', { ceiling })
          : t(EXEMPTION_LABEL_KEY[exemption.exemption])}
      </p>

      {/*
        DECISION 129's CRITERION 7, ON SCREEN: «اختاره: » and the employee's name, or «حدّده
        النظام». The label carries her colon and the NAME follows it — appended rather than
        interpolated, because the name is the record's and is not part of what she ratified.

        ⚠️ `TAGGED_BY_SYSTEM` is unreachable today (measured: the system can tag none of the
        five) and the branch is here anyway. It must not be dropped: the day an exemption becomes
        taggable, a screen that could only say «اختاره» would attribute the system's own tag to
        whichever person happened to be sending the request.
      */}
      <p style={a15dProseStyle} data-article-15-d="chosen-by">
        {exemption.basis === 'CHOSEN_BY_PERSON'
          ? `${t('a15dChosenBy')}${exemption.chosenByNameShown ?? ''}`
          : t('a15dTaggedBySystem')}
      </p>

      {/* Exemption 4's declared premium, beside the ceiling it was measured against. Both are
          ON the row rather than joined, so this reads correctly even after the table moves. */}
      {exemption.declaredAnnualPremiumJod !== null ? (
        <p style={a15dProseStyle}>
          {t('a15dPremiumLabel')}
          {': '}
          {formatNumber(Number(exemption.declaredAnnualPremiumJod), language)}
        </p>
      ) : null}

      {alerts.map((alert) => (
        <div
          key={alert.id}
          style={a15dWindowStyle}
          role="status"
          data-article-15-d="alert"
        >
          <p style={a15dWindowTitleStyle}>
            {t('a15dPremiumAlert', {
              ceiling: formatNumber(Number(alert.ceilingValueJod), language),
            })}
          </p>
          <p style={a15dOptionStyle}>
            {formatNumber(Number(alert.quotedPremiumJod), language)}
          </p>
        </div>
      ))}
    </section>
  );
}
