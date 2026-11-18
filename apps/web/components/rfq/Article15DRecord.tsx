'use client';

import { useCallback, useEffect, useState } from 'react';

import { useLanguage } from '../../lib/i18n/language-context';
import { formatDate, formatNumber } from '../../lib/i18n/format';
import type { TranslationKey } from '../../lib/i18n/translations';
import {
  attachArticle15DEvidence,
  listArticle15DEvidenceOptions,
} from '../../lib/rfq/rfq-api';
import type {
  Article15DAlert,
  Article15DEvidenceOption,
  Article15DExemption,
  Article15DExemptionRecord,
} from '../../lib/rfq/rfq-api';
import {
  a15dAttachButtonStyle,
  a15dEvidenceListStyle,
  a15dOptionStyle,
  a15dProseStyle,
  a15dQuestionStyle,
  a15dSectionStyle,
  a15dWindowStyle,
  a15dWindowTitleStyle,
} from './rfq.styles';
import { CHANNEL_LABEL_KEY } from './Article15DWindow';

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
  rfqId,
  canAttachEvidence = false,
  onEvidenceAttached,
}: {
  exemption: Article15DExemptionRecord | null | undefined;
  alerts?: Article15DAlert[];
  /** The request this record belongs to — the attach addresses the RFQ, not the exemption row. */
  rfqId?: string;
  /**
   * OWNER DECISION 143 + `frontend-ux-directive.md` — a control a role cannot use does not exist
   * on their screen. `rfq.communication.log` is the code, the SAME one the route carries, so the
   * button is absent for a compliance reader who may see the mark and may not clear it.
   */
  canAttachEvidence?: boolean;
  /**
   * Reload the request, so `lacksEvidence` comes back FROM THE SERVER rather than being switched
   * off locally. The mark is DERIVED and this screen must not derive it.
   */
  onEvidenceAttached?: () => void;
}) {
  const { t, language } = useLanguage();

  /*
   * 🔴 OWNER DECISION 143 — «إرفاق المراسلة», and its four states.
   *
   * ⚠️ THESE HOOKS RUN FOR EVERY RENDER, including the 84.3% of requests that carry no exemption
   * at all, and they must stay ABOVE the `if (!exemption) return null` below. React's hook order
   * is positional, so a hook placed after that early return would change order the moment a
   * request with no exemption rendered where one with an exemption had been. The effect itself
   * does nothing unless there is a mark to clear.
   */
  const [candidates, setCandidates] =
    useState<Article15DEvidenceOption[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  /*
   * THE ERROR STATE HOLDS A KEY, AND ONE OF THE TWO WAS AN EMPTY CELL UNTIL SHE RULED IT.
   *
   * Message 42 reported that no decision ratified a sentence for «the attach failed», so both
   * branches borrowed the nearest sentence LITERALLY TRUE of what failed and ALREADY SHIPPING ON
   * THIS SAME SCREEN — decision 125's own rule for where a word may come from. OWNER DECISION
   * 145(ب) filled the cell on 2026-11-16:
   *
   *   the candidate list failed to load ⟶ «تعذر تحميل سجل المراسلات» — STILL BORROWED, by her
   *       ruling: «هي صادقة على ما فشل». The list is what failed, and that sentence says so.
   *   the attach itself failed          ⟶ «تعذّر إرفاق المراسلة.» — HERS, sliced from
   *       decision 145 §٣ and re-sliced byte-for-byte by `article-15-d.strings.test.ts`.
   *
   * ⛔ Neither is invented and neither is a translation of ours. The list's sentence is NOT a
   * leftover to be «fixed» to match: she ruled it stays.
   */
  const [attachError, setAttachError] = useState<TranslationKey | null>(null);
  const [attaching, setAttaching] = useState(false);

  const lacksEvidence = exemption?.lacksEvidence === true;
  const mayAttach = lacksEvidence && canAttachEvidence && rfqId !== undefined;

  useEffect(() => {
    if (!mayAttach || rfqId === undefined) return;
    let live = true;
    /*
     * ⚠️ THE ERROR IS CLEARED ON SUCCESS, NOT BEFORE THE REQUEST. A synchronous `setState` in an
     * effect body is a cascading render (eslint names it, and it failed the gate here) — and
     * resolving it this way is the better behaviour anyway: an optimistic clear blanks a real
     * failure for however long the retry takes, so the screen reads as fine while it is not.
     */
    listArticle15DEvidenceOptions(rfqId)
      .then((rows) => {
        if (!live) return;
        setCandidates(rows);
        setAttachError(null);
      })
      .catch(() => {
        if (live) setAttachError('rfqDetailCommsLoadError');
      });
    return () => {
      live = false;
    };
  }, [mayAttach, rfqId]);

  const attach = useCallback(async () => {
    if (rfqId === undefined || chosen === null) return;
    setAttaching(true);
    setAttachError(null);
    try {
      await attachArticle15DEvidence(rfqId, chosen);
      /*
       * ⛔ THE MARK IS NOT SWITCHED OFF HERE. `lacksEvidence` is derived by the api and sent;
       * clearing it locally would be a second home for the rule, and it would also lie if this
       * write lost a race to another employee's message. The parent reloads; the server answers.
       */
      onEvidenceAttached?.();
    } catch {
      setAttachError('a15dAttachEvidenceError');
    } finally {
      setAttaching(false);
    }
  }, [rfqId, chosen, onEvidenceAttached]);

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

      {/*
        🔴 OWNER DECISION 139 ruling 2 — «بلا إثبات», ON THE REQUEST, until the message is
        attached.

        «لا إعفاء على الورق بلا دليل إلا ظاهراً، ويراه المفتّش.» This mark is what stops the
        decision becoming a hole: the server no longer refuses exemption 5 without evidence, so
        the only thing standing between «the customer asked» and an unproven claim on the record
        is that the gap is VISIBLE — to the office, and to an inspector reading the same screen.

        ⛔ `lacksEvidence` is DERIVED BY THE API and read here, never recomputed. Both facts it
        rests on are in this payload, so deriving it locally would compile and would be a second
        home for the rule.

        No timer and no deadline — decision 139 ruling 3. It simply stays until evidence arrives.
      */}
      {lacksEvidence ? (
        <p style={a15dProseStyle} data-article-15-d="lacks-evidence">
          {t('a15dExemptionLacksEvidence')}
        </p>
      ) : null}

      {/*
        🔴 OWNER DECISION 143 — «إرفاق المراسلة», THE WAY IN THE ROUTE DID NOT HAVE.

        `POST /rfqs/:id/article-15-d/evidence` shipped built, enforced and e2e-tested on
        2026-11-15 with no control anywhere on any screen, because the label did not exist and
        decision 125 forbids composing one: «إرفاق» ships only on the DOCUMENTS screens and
        «المراسلة» only in the plural here. `unreachable-routes.py` carried it as a
        declared-unreached route with this creditor named. She ratified the proposal whole, and
        this is the payment.

        ## FOUR STATES, AND THE EMPTY ONE IS HER SENTENCE RATHER THAN OURS

        loading · error, with the control still there to retry through · EMPTY, which renders
        decision 139 ruling 6's own sentence through the SAME key the creation window uses, so
        the employee told «يمكنك المتابعة» when the request was sent meets those same words when
        they come back to prove it · and the candidates.

        ## AND THE LIST IS NOT FILTERED HERE

        What clears the mark is decided by the server — INBOUND, this customer, an approved
        means. ⛔ A filter here would be a second answer to decision 139's conditions, and the
        first time decision 132's list of approved means moved, the screen would offer a message
        the server then refused: the screen contradicting the server on the one screen that must
        not.

        ## THE ATTACH IS WRITE-ONCE, WHICH IS WHY CHOOSING IS NOT ATTACHING

        The row permits exactly ONE transition and no permission takes it back, so a radio that
        attached on selection would make a misclick permanent and visible to an inspector for
        ever. The candidate is CHOSEN, and then the button acts.
      */}
      {mayAttach ? (
        <div data-article-15-d="attach">
          {attachError !== null ? (
            <p style={a15dProseStyle} data-article-15-d="attach-error">
              {t(attachError)}
            </p>
          ) : candidates === null ? (
            <p style={a15dProseStyle} data-article-15-d="attach-loading">
              {t('commonLoading')}
            </p>
          ) : candidates.length === 0 ? (
            <p style={a15dProseStyle} data-article-15-d="attach-none">
              {t('a15dEvidenceNoneYet')}
            </p>
          ) : (
            <div style={a15dEvidenceListStyle}>
              {candidates.map((item) => (
                <label key={item.id} style={a15dOptionStyle}>
                  <input
                    type="radio"
                    name="article-15-d-attach-evidence"
                    data-article-15-d="attach-candidate"
                    data-evidence-id={item.id}
                    checked={chosen === item.id}
                    disabled={attaching}
                    onChange={() => setChosen(item.id)}
                  />
                  <span>
                    {formatDate(item.sentAt, language)}
                    {' · '}
                    {t(
                      CHANNEL_LABEL_KEY[item.channel] ??
                        'a15dEvidenceLabel',
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}

          {/*
            The button stands wherever the mark does — over the candidates, over the empty list
            and over a failed load. Pressing it with nothing chosen does nothing, and a control
            that vanished with its list would leave an employee unable to tell «there is nothing
            to attach» from «this screen cannot attach at all».

            `type="button"` so it can never submit an ancestor form, which is the defect the
            dismiss button records on the role matrix.
          */}
          <button
            type="button"
            style={a15dAttachButtonStyle}
            data-article-15-d="attach-button"
            disabled={chosen === null || attaching}
            onClick={() => void attach()}
          >
            {t('a15dAttachEvidenceButton')}
          </button>
        </div>
      ) : null}

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
