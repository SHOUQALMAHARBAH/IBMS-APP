import type { InteractionChannel } from '@prisma/client';

/**
 * ART. 22/s — «وسائل التبليغ المعتمدة», AND WHICH `InteractionChannel` CARRIES EACH.
 *
 * «لغايات هذه التعليمات يعد أي مما يلي من وسائل التبليغ المعتمدة» — four means, sliced from the
 * instrument (source lines 665-668):
 *
 *   1  «التبليغ الخطي.»
 *   2  «البريد الالكتروني والقنوات الالكترونية الخاصة بوسيط التأمين.»
 *   3  «الرسائل النصية عن طريق الهاتف الخلوي.»
 *   4  «اي وسيلة يتم الاتفاق عليها خطياً بين الاطراف ذات العلاقة أو معتمدة وفقاً للتشريعات ذات
 *      العلاقة.»
 *
 * This is where art. 15/d's EXEMPTION 5 rests: «بناءً على طلب العميل وفق وسائل التبليغ المعتمدة»
 * — at the customer's request, through the approved means. So the question *is this channel a
 * means* decides whether a piece of evidence counts, which makes it a legal mapping and not a
 * display concern.
 *
 * ## 🔴 A DECLARED MAP, NEVER INFERRED FROM THE MEMBER'S NAME
 *
 * Two members make that impossible, and they pull in opposite directions:
 *
 *   `WHATSAPP`  is an electronic channel by any reading, and is REFUSED BY NAME — OWNER
 *               DECISION 44, 9 October. It is not «القنوات الالكترونية الخاصة بوسيط التأمين»
 *               either: those are the broker's OWN channels, and WhatsApp is a third party's.
 *   `CALL`      is the nearest member to `SMS` and is NOT a means. Art. 22/s names «الرسائل
 *               النصية عن طريق الهاتف الخلوي» — the text message, not the telephone — and a
 *               spoken call leaves no text to BE the evidence exemption 5 requires.
 *
 * ⟶ Any rule that read the names would get both of those backwards. The mapping is the owner's
 *   (decision 132 ruling 2, extended by decision 133 §3) and is written out, member by member,
 *   with every non-means stated rather than left to fall through a default. `approved-means.
 *   config.spec.ts` asserts the map is TOTAL over the database enum, so a fourteenth member
 *   cannot be silently admitted or silently refused.
 */

/** Which of art. 22/s's four means a channel carries, or `null` when it carries none. */
export type ApprovedMeans = 1 | 2 | 3 | 4;

export interface MeansMapping {
  means: ApprovedMeans | null;
  /**
   * TRUE when the channel counts only with evidence of a written agreement — means 4's own
   * condition, «يتم الاتفاق عليها خطياً». Only `OTHER` is conditional.
   */
  needsWrittenAgreement: boolean;
  /** Why, for the report and for the screen. Never a bare verdict. */
  because: string;
}

export const APPROVED_MEANS: Readonly<
  Record<InteractionChannel, MeansMapping>
> = {
  // ── means 1 ──────────────────────────────────────────────────────────────────────────────
  WRITTEN_NOTICE: {
    means: 1,
    needsWrittenAgreement: false,
    because:
      "written notice — art. 22/s's first means, «التبليغ الخطي». Added by OWNER DECISION 133 §3 ruling 2, because until then a paper notice could only be filed as OTHER, which is the conditional case: the strongest means treated as the weakest",
  },
  // ── means 2 ──────────────────────────────────────────────────────────────────────────────
  EMAIL: {
    means: 2,
    needsWrittenAgreement: false,
    because: '«البريد الالكتروني» — named explicitly by art. 22/s',
  },
  PORTAL: {
    means: 2,
    needsWrittenAgreement: false,
    because:
      "«القنوات الالكترونية الخاصة بوسيط التأمين» — the broker's own electronic channels. RATIFIED by OWNER DECISION 133 §3 ruling 1 and no longer a reading: her reason is whose channel it is rather than whose software runs it — «قناة المكتب مع عميله وباسمه»",
  },
  // ── means 3 ──────────────────────────────────────────────────────────────────────────────
  SMS: {
    means: 3,
    needsWrittenAgreement: false,
    because:
      '«الرسائل النصية عن طريق الهاتف الخلوي» — named explicitly by art. 22/s',
  },
  // ── means 4, CONDITIONALLY ───────────────────────────────────────────────────────────────
  OTHER: {
    means: 4,
    needsWrittenAgreement: true,
    because:
      '«اي وسيلة يتم الاتفاق عليها خطياً بين الاطراف ذات العلاقة» — so it counts ONLY with evidence of a written agreement. A bare OTHER with no such evidence is not a means',
  },
  // ── refused by name ──────────────────────────────────────────────────────────────────────
  WHATSAPP: {
    means: null,
    needsWrittenAgreement: false,
    because:
      "OWNER DECISION 44, 9 October — not approved. And it is not «القنوات الالكترونية الخاصة بوسيط التأمين» either: those are the broker's OWN channels and WhatsApp is a third party's",
  },
  // ── not means at all ─────────────────────────────────────────────────────────────────────
  CALL: {
    means: null,
    needsWrittenAgreement: false,
    because:
      'the nearest of the four is SMS and a call is not an SMS — art. 22/s names the TEXT message, not the telephone. A spoken call also leaves no text to be the evidence exemption 5 requires',
  },
  MEETING: {
    means: null,
    needsWrittenAgreement: false,
    because:
      'a meeting is where something is said, not a channel it is notified through. None of the four names it',
  },
  VISIT: {
    means: null,
    needsWrittenAgreement: false,
    because: 'same as MEETING — a place, not a channel',
  },
  PROPOSAL: {
    means: null,
    needsWrittenAgreement: false,
    because: 'a document type, not a channel',
  },
  RENEWAL: {
    means: null,
    needsWrittenAgreement: false,
    because: 'a case type, not a channel',
  },
  CLAIM: {
    means: null,
    needsWrittenAgreement: false,
    because: 'a case type, not a channel',
  },
  COMPLAINT: {
    means: null,
    needsWrittenAgreement: false,
    because: 'a case type, not a channel',
  },
};

/**
 * Does evidence arriving on this channel count as an approved means?
 *
 * `hasWrittenAgreement` is the caller's answer to means 4's own condition, and it is REQUIRED
 * with no default — a default of `false` would quietly refuse every legitimate `OTHER`, and a
 * default of `true` would admit every illegitimate one. The compiler asks.
 *
 * ⛔ FAILS CLOSED on a channel the map does not hold, which cannot happen while the spec asserts
 * totality — and if the spec were ever deleted, refusing is the safe direction: art. 15/d's
 * exemption 5 would stop being available rather than start accepting anything.
 */
export function isApprovedMeans(
  channel: InteractionChannel,
  hasWrittenAgreement: boolean,
): boolean {
  const mapping = APPROVED_MEANS[channel];
  if (!mapping || mapping.means === null) return false;
  return mapping.needsWrittenAgreement ? hasWrittenAgreement : true;
}

/** The channels that can carry exemption 5's evidence with no further condition — what the
 *  screen offers. `OTHER` is deliberately absent: it needs the written agreement beside it. */
export const UNCONDITIONAL_APPROVED_CHANNELS: readonly InteractionChannel[] =
  Object.entries(APPROVED_MEANS)
    .filter(([, m]) => m.means !== null && !m.needsWrittenAgreement)
    .map(([channel]) => channel as InteractionChannel);
