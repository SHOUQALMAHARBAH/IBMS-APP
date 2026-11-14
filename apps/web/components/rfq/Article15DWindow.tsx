'use client';

import { useLanguage } from '../../lib/i18n/language-context';
import { formatNumber } from '../../lib/i18n/format';
import type { TranslationKey } from '../../lib/i18n/translations';
import { permissionRefusal } from '../../lib/i18n/permission-refusal';
import type {
  Article15DChoice,
  Article15DExemption,
  Article15DOptions,
} from '../../lib/rfq/rfq-api';
import {
  a15dEvidenceListStyle,
  a15dFieldLabelStyle,
  a15dFieldStyle,
  a15dOptionStyle,
  a15dPremiumInputStyle,
  a15dProseStyle,
  a15dQuestionStyle,
  a15dReasonInputStyle,
  a15dSectionStyle,
  a15dWindowStyle,
  a15dWindowTitleStyle,
} from './rfq.styles';

/**
 * ART. 15/d — «التواصل مع ثلاث شركات تأمين»: THE QUESTION, THE EXEMPTIONS, AND THE WINDOW.
 *
 * OWNER DECISION 130 ruling 1: the office sends to three or more BECAUSE THAT IS WHAT THE LAW
 * SAYS. So this component renders NOTHING at all on the 84.3% of requests that reach the
 * minimum — decision 123's own test is to count the clicks added to the most frequent
 * transaction, and the answer here is zero.
 *
 * ## WHAT AN EMPLOYEE MEETS, in order
 *
 *   1. the question, once the shortlist is below the minimum (OWNER DECISION 133)
 *   2. only the exemptions that CAN apply to this request's line — the server decides which
 *   3. exemption 4 ⟶ the expected-premium field, checked against the ceiling at the request's date
 *   4. exemption 5 ⟶ the evidence picker, approved means only
 *   5. NO exemption chosen ⟶ the adviser's window, with the reason and the acknowledgement
 *
 * ## ⛔ THERE IS NO «NONE OF THESE» OPTION, AND THAT IS DELIBERATE
 *
 * A "none applies" control would need a word nobody has ratified, and this batch may not invent
 * one. It is not needed: the exemptions are RADIO options that start unselected, so an employee
 * who proceeds without choosing one has said «no exemption» by proceeding — which is exactly
 * what the owner's flow describes («No exemption ⟶ the window»). The adviser's own title then
 * explains what proceeding means.
 *
 * ## AND THE ADVISER'S FOUR STRINGS COME FROM THE SERVER, NEVER FROM A DICTIONARY
 *
 * The record stores what the employee was SHOWN (element 1), and that holds by construction only
 * while the screen renders the same constant the server stores. `options.window` is that
 * constant, re-sliced from his own file byte for byte by `declared-act.config.spec.ts`. It is
 * also the one Arabic in this product that is NOT translated: an English rendering of a
 * regulatory acknowledgement would be a sentence he never drafted and the record never stored.
 */

const EXEMPTION_LABEL_KEY: Record<Article15DExemption, TranslationKey> = {
  INDIVIDUAL_MEDICAL_RENEWAL: 'a15dExemption1',
  GROUP_MEDICAL_RENEWAL_UP_TO_THREE_YEARS: 'a15dExemption2',
  DEFINED_BENEFIT_CONTRACT: 'a15dExemption3',
  LOW_PREMIUM_MOTOR_MEDICAL_OR_TRANSIT: 'a15dExemption4',
  AT_CUSTOMER_REQUEST: 'a15dExemption5',
};

/**
 * The four channels that can carry exemption 5's evidence, by their shipping labels.
 *
 * ⚠️ A LOOKUP RATHER THAN A `Record` OVER THE CHANNEL UNION, deliberately: the server already
 * filters to the approved means, so this only ever sees four of the thirteen — and a total
 * `Record` would have to name nine channels that can never appear here, each of which would
 * then look like a channel this screen accepts.
 */
const CHANNEL_LABEL_KEY: Record<string, TranslationKey | undefined> = {
  WRITTEN_NOTICE: 'rfqCommChannelWrittenNotice',
  EMAIL: 'rfqCommChannelEmail',
  PORTAL: 'rfqCommChannelPortal',
  SMS: 'crmChannelSms',
};

export function Article15DWindow({
  options,
  choice,
  onChange,
  disabled = false,
}: {
  options: Article15DOptions;
  choice: Article15DChoice;
  onChange: (next: Article15DChoice) => void;
  disabled?: boolean;
}) {
  const { t, language } = useLanguage();

  // NOTHING on a request that reaches the minimum. Not a reassurance, not a tick — nothing.
  if (!options.required) return null;

  /** The ceiling, rendered INTO her own ratified sentence. Never typed into the string. */
  const ceiling = formatNumber(Number(options.premiumCeilingJod), language);

  function pick(exemption: Article15DExemption | undefined) {
    // Switching exemption clears the fields that belonged to the previous one. Otherwise an
    // employee who typed a premium, changed their mind and chose exemption 5 would send both —
    // which the server refuses by name, and the database refuses again by CHECK.
    onChange({ exemption, declaration: choice.declaration });
  }

  const noExemption = choice.exemption === undefined;

  return (
    <section style={a15dSectionStyle} data-article-15-d="question">
      <p style={a15dQuestionStyle}>{t('a15dQuestion')}</p>

      {options.exemptions.map((offer) => (
        <label key={offer.exemption} style={a15dOptionStyle}>
          <input
            type="radio"
            name="article-15-d-exemption"
            value={offer.exemption}
            data-exemption={offer.exemption}
            checked={choice.exemption === offer.exemption}
            disabled={disabled}
            onChange={() => pick(offer.exemption)}
          />
          <span>
            {offer.exemption === 'LOW_PREMIUM_MOTOR_MEDICAL_OR_TRANSIT'
              ? t('a15dExemption4', { ceiling })
              : t(EXEMPTION_LABEL_KEY[offer.exemption])}
          </span>
        </label>
      ))}

      {/* Exemption 4 — the premium the employee EXPECTS and declares, never one a quote
          returned. Her label says «المتوقَّع» for exactly that reason. */}
      {choice.exemption === 'LOW_PREMIUM_MOTOR_MEDICAL_OR_TRANSIT' ? (
        <label style={a15dFieldStyle}>
          <span style={a15dFieldLabelStyle}>
            {t('a15dPremiumLabel')}
          </span>
          <input
            type="text"
            inputMode="decimal"
            data-article-15-d="premium"
            value={choice.declaredAnnualPremiumJod ?? ''}
            disabled={disabled}
            onChange={(e) =>
              onChange({
                ...choice,
                declaredAnnualPremiumJod: e.target.value,
              })
            }
            style={a15dPremiumInputStyle}
          />
        </label>
      ) : null}

      {/* Exemption 5 — the customer's own request, arriving by an approved means. The picker
          carries WHEN and HOW and nothing else: a communication's text is Confidential, and
          this list is read by whoever may create a quote request. */}
      {choice.exemption === 'AT_CUSTOMER_REQUEST' ? (
        <label style={a15dFieldStyle}>
          <span style={a15dFieldLabelStyle}>
            {t('a15dEvidenceLabel')}
          </span>
          {/*
            RADIO OPTIONS AND NOT A `<select>`, for a reason that is the owner's rather than a
            matter of taste. A select needs a first option standing for "none chosen yet", and
            the only such string shipping anywhere is `customerPickerNonePlaceholder`, which
            carries an EM DASH — and OWNER DECISION 125 removed the dash from the system
            entirely, «including as a select option». The alternatives were to invent a word,
            which this batch may not, or to reuse a struck one. Radios start unselected with no
            placeholder at all, so neither is needed.
          */}
          <div style={a15dEvidenceListStyle}>
            {options.evidence.map((item) => (
              <label key={item.id} style={a15dOptionStyle}>
                <input
                  type="radio"
                  name="article-15-d-evidence"
                  data-article-15-d="evidence"
                  data-evidence-id={item.id}
                  checked={choice.evidenceCommunicationLogId === item.id}
                  disabled={disabled}
                  onChange={() =>
                    onChange({
                      ...choice,
                      evidenceCommunicationLogId: item.id,
                    })
                  }
                />
                <span>
                  {new Date(item.sentAt).toLocaleDateString(
                    language === 'AR' ? 'ar-JO' : 'en-JO',
                  )}
                  {' · '}
                  {t(CHANNEL_LABEL_KEY[item.channel] ?? 'a15dEvidenceLabel')}
                </span>
              </label>
            ))}
          </div>
        </label>
      ) : null}

      {/* NO EXEMPTION ⟶ THE ADVISER'S WINDOW. His text, from the server, verbatim. */}
      {noExemption ? (
        <div style={a15dWindowStyle} data-article-15-d="window">
          <p style={a15dWindowTitleStyle}>{options.window.title}</p>
          <p style={a15dProseStyle}>{options.window.text}</p>

          {/*
            🔴 AND IF THE OFFICE HAS NOT GRANTED THE DECLARATION PERMISSION, THE WINDOW SAYS SO
            INSTEAD OF TAKING A REASON NOBODY CAN FILE.

            OWNER DECISION 131 grants a new code to nobody, so this is the state every office
            starts in. Showing the fields and refusing on submit would make an employee write a
            justification into a form that was never going to be accepted — the refusal belongs
            BEFORE the work, with the remedy named. The sentence is the standing permission
            vocabulary the owner set on 30 September: the act in plain business words and
            «اطلبها ممن يدير الصلاحيات في مكتبك».

            ⚠️ AND THE WORDING OF THAT ATTRIBUTION IS DELIBERATE. Putting the word for a ruling
            immediately before the day of the month makes `check:decision-index` read the DAY as
            a decision number — that gate deliberately WALKS a multi-number citation, and it
            refused this very comment for citing a decision that has no file. It is the same
            phantom class as the 2026 date the decision register's own header records its first
            count having misread as a three-digit decision number.

            ⟶ So the day is attached to a verb instead. ⛔ AND NEITHER THE OFFENDING PHRASING NOR
              THAT PHANTOM NUMBER IS WRITTEN HERE, only described: a comment reproducing either
              fails the same gate. This comment did it TWICE before getting it right — the
              comment-quotes-the-pattern blindness, twice inside the sentence warning about it.
          */}
          {options.mayDeclare ? (
            <>
              <label style={a15dFieldStyle}>
                <span style={a15dFieldLabelStyle}>
                  {options.window.reasonHint}
                </span>
                <textarea
                  data-article-15-d="reason"
                  rows={3}
                  value={choice.declaration?.reason ?? ''}
                  disabled={disabled}
                  onChange={(e) =>
                    onChange({
                      ...choice,
                      declaration: {
                        reason: e.target.value,
                        acknowledged: choice.declaration?.acknowledged ?? false,
                      },
                    })
                  }
                  style={a15dReasonInputStyle}
                />
              </label>

              {/* ELEMENT 4: the acknowledgement is TICKED BY HAND. The service refuses an
                  unticked one by name — an unticked acknowledgement is not a weaker
                  declaration, it is no declaration. */}
              <label style={a15dOptionStyle}>
                <input
                  type="checkbox"
                  data-article-15-d="acknowledge"
                  checked={choice.declaration?.acknowledged ?? false}
                  disabled={disabled}
                  onChange={(e) =>
                    onChange({
                      ...choice,
                      declaration: {
                        reason: choice.declaration?.reason ?? '',
                        acknowledged: e.target.checked,
                      },
                    })
                  }
                />
                <span>{options.window.acknowledgement}</span>
              </label>
            </>
          ) : (
            <p
              style={a15dProseStyle}
              role="status"
              data-article-15-d="refusal"
            >
              {permissionRefusal(
                t,
                'a15dDeclareRefusalAct',
                'declared-act.article-15-d.declare',
              )}
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
