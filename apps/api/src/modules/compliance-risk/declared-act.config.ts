import { DECLARATION_REASON_MIN_LENGTH } from '../../common/declaration-reason';

/**
 * THE DECLARED-ACT TEXTS — OWNER DECISION 126, module-1 paper §٨.
 *
 * ⛔ EVERY ARABIC STRING IN THIS FILE WAS SLICED FROM ITS SOURCE BY SCRIPT AND NEVER RETYPED, and
 * `declared-act.config.spec.ts` re-slices each one from the same source and asserts byte equality.
 * So the day somebody edits a sentence here, the build fails and names the source it drifted from.
 *
 *   the article text and the acknowledgement  <- the legal ADVISER, `docs/answers/`
 *   the responsibility sentence (element 6)   <- the OWNER, module-1 paper §٨.١ item 6
 *   the limit on the release (element 9)      <- the OWNER, module-1 paper §٨.١ item 9
 *
 * The two answer files each carry the adviser's art. 15/d text and they are byte-identical, so
 * "byte-identical from `docs/answers/`" is unambiguous — asserted, not assumed.
 *
 * ## 🔴 ELEMENT 9 IS ONE STRING, DELIBERATELY
 *
 * «ومعه حدُّه الذي قاله المستشارُ بجانبِه ولا يُفصَل عنه» — the release and its limit are never
 * separated. The only way to make that structurally true is for them to be ONE value: a second
 * field could be rendered without the first, or omitted by a template, and nothing would say so.
 *
 * ## 🔴 AND ONLY THE ART. 15/d ACKNOWLEDGEMENT CARRIES A RELEASE AT ALL — measured 2026-11-12
 *
 * Of the adviser's three drafted acknowledgements, only this one contains «إبراء ذمة الشركة
 * المطورة». The art. 19/أ/3 and art. 16/ي/8 drafts place full liability on the office and say
 * nothing about releasing the developing company, so element 9 is not satisfiable for those two
 * from his text as it stands. That is REPORTED to the owner rather than fixed here: those are the
 * adviser's words, and `docs/answers/` is a source transcription — reported, never corrected in
 * place. It is why the database CHECK asserts the acknowledgement is PRESENT rather than asserting
 * a release phrase it would have to refuse for two of the seven sites.
 */

/** Art. 15/d — a quote request reaching fewer than three insurance companies. The ONE site wired
 *  in message 36; the other six are listed in `docs/module-1-declared-act-callers.md` with the
 *  module paper that owns each. */
export const ARTICLE_15_D = {
  site: 'ARTICLE_15_D_FEWER_THAN_THREE_INSURERS',
  /** Grouping only. Element 1 is explicit that the NUMBER is not what the person is shown. */
  articleRef: '15/d',
  /** The adviser's text, shown verbatim. Element 1. */
  articleText:
    'إن قيام المكتب بالتعامل مع أقل من ثلاث شركات تأمين يُعد مخالفة صريحة لأحكام المادة (15/د) من تعليمات ترخيص وسيط التأمين وتنظيم أعماله ومسؤولياته رقم (9) لسنة 2026 الصادرة عن البنك المركزي الأردني، ما لم تكن الحركة مشمولة بأحد الاستثناءات القانونية (مثل كون قيمة القسط 2000 دينار أو أقل).',
  /** The adviser's acknowledgement, with the owner's limit joined to it. Elements 4 and 9. */
  acknowledgementText:
    'أقر أنا بصفتي مفوضاً عن المكتب بأن المتابعة في هذا الإجراء تتم على مسؤولية المكتب التنظيمية الكاملة، وبأننا على علم بالتبعات القانونية لمخالفة التعليمات، مع إبراء ذمة الشركة المطورة للنظام إبراءً مطلقاً. الإقرارُ لا يُسقِط المسؤوليةَ الجزائية.',
  /** Element 6, as a sentence rather than an inference. */
  responsibilitySentence: 'المسؤوليةُ التنظيميةُ على المكتب',
  /**
   * Element 3 — this site's OWN permission, separate from the permission to SEND the request.
   * Module paper §٤.١: whoever can act is not thereby able to declare, which is why a placement
   * officer who sends quote requests all day cannot declare one under art. 15/d.
   *
   * ⚠️ THIS CODE IS NOT IN THE CATALOGUE YET, DELIBERATELY. Minting an OFFICE-scope code means
   * granting it to at least one role — `permissions.spec.ts` refuses `roles: []` for an
   * office-scoped code, on the sound ground that *a code granted to nobody is a checkbox that
   * removes nothing* — and that grant comes to the owner for ratification, as `legal-value.*` did.
   * It also moves the catalogue total, which is pinned in four places and a generated fixture.
   *
   * So it is minted in message 36 §4, with the route that enforces it, rather than here: a code
   * that exists and is enforced nowhere is the shape `permission-enforcement` already tracks three
   * of. The string is named now because the RECORD has to say which permission was used, and
   * `declared-act.service.spec.ts` asserts the recorded code is this one and is NOT `rfq.create`.
   */
  permissionCode: 'declared-act.article-15-d.declare',
} as const;

/** The adviser's release clause and the owner's limit, as separate anchors — so a test can assert
 *  BOTH survive in the composed acknowledgement, which is what "never separated" means in code. */
export const ARTICLE_15_D_RELEASE_ANCHOR = 'إبراء ذمة الشركة المطورة';
export const ARTICLE_15_D_LIMIT = 'الإقرارُ لا يُسقِط المسؤوليةَ الجزائية';

/** The one shared floor, re-exported so a caller never writes the number. Two SQL CHECKs and
 *  `DeclaredAct_reason_meets_the_shared_floor` enforce the same ten. OWNER DECISION 87 set fifteen
 *  and the owner struck it on that point (decision 129 §5). */
export const DECLARED_ACT_REASON_MIN_LENGTH = DECLARATION_REASON_MIN_LENGTH;

/**
 * THE SHOWN TEXTS ARE PROSE, NOT A TOKEN — and this is a DIFFERENT number from the reason floor,
 * deliberately, with its own home here.
 *
 * The adviser's requirement is «النصُّ الحرفيُّ للإقرارِ والسببِ لا كلمةُ «نعم»» — the verbatim
 * text, not the word «yes». `DeclaredAct_shown_texts_are_prose` enforces it in SQL for all three
 * stored texts, and `check:declaration-floor` keeps that CHECK equal to this constant.
 *
 * ⛔ IT IS NOT `DECLARATION_REASON_MIN_LENGTH` AND MUST NOT BE POINTED AT IT. Ten characters of a
 * written REASON is a reason somebody typed; ten characters of statutory ARTICLE TEXT is a
 * different defect, and conflating them would mean one number governing two concepts — which is
 * the drift `declaration-reason.ts` exists to prevent, in the other direction.
 *
 * TWENTY and not forty, which the first version used for the two long texts: the owner's
 * responsibility sentence is 32 characters, so a forty-character floor applied to all three by
 * symmetry would refuse HER OWN SENTENCE. One number that fits every one of the three is safer
 * than two numbers that each fit some of them.
 */
export const DECLARED_ACT_SHOWN_TEXT_MIN_LENGTH = 20;
