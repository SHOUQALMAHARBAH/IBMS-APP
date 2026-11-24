import { DESTINATION_GROUPS } from '../../components/app/destinations';
import { describePermission } from '../admin/permission-descriptions';
import { permissionNameAr } from '../admin/permission-names';
import type { Language, TranslationKey } from '../i18n/translations';
import type { NewPermissionNotice } from './notification-api';

/**
 * OWNER DECISION 131's NOTIFICATION, composed from the owner's own ratified sentence.
 *
 * «صلاحية جديدة في النظام: [اسمها]. [شرحها]. تتحكّم في: [الشاشة أو الزر]. لم تُعطَ لأحد بعد —
 * قرّر لمن تعطيها من مصفوفة الصلاحيات.» — OWNER DECISION 133.
 *
 * Her three bracketed slots are the three things this file resolves, and each resolves from
 * something that already ships. Nothing here is authored.
 */

/**
 * 🔴 THE PERMISSION NAMES — OWNER DECISION 127, AND THEY ARE BUILT NOW.
 *
 * This file used to carry `OWNER_SUPPLIED_PERMISSION_NAMES`, a one-row map holding the single
 * name the owner had written out by hand while the other 233 were still owed. It is DELETED
 * rather than extended: all 196 names are ratified and they live in
 * `lib/admin/permission-names.ts`, which is their one home. A second map here would be a second
 * home for a name, and two homes disagree the first time one of them moves.
 *
 * Its one row is not lost — `retention.archive.retrieve` is annex 144 §٣'s «كلمة الإدارة» row,
 * byte-identical to what stood here, and `permission-names.test.ts` pins it with the other 195.
 */

/**
 * What the code controls, for the «تتحكّم في» slot — OR `null`, which is her ruling.
 *
 * A SCREEN where the nav map names the code — rendered as that screen's own already-shipping
 * title, so no Arabic is invented and both languages are served.
 *
 * 🔴 OWNER DECISION 160 RULING 2 — AND OTHERWISE THERE IS NOTHING TO SAY, SO NOTHING IS SAID.
 *
 * This used to return `notice.routes.join(…)`, on the reasoning that «a route is weaker than a
 * screen name and it is the honest answer when no screen exists». The final walk measured what
 * that produces on the screen the presenter opens: «تتحكّم في: POST /rfqs (the art. 15/d
 * declaration branch)» — an English api route, with a parenthetical about a code branch, inside
 * an Arabic sentence, read by an office administrator deciding who may swear to a licence
 * renewal. Her ruling: «الجملة العربية لا تحمل عنوان خادم ولا رمزاً ولا كلمة لاتينية.»
 *
 * ⟶ `null` means «this sentence has no «تتحكّم في:» clause», and `newPermissionSentence` picks
 *   a template that does not carry one. ⛔ Not an empty string into the old template, which
 *   would render «تتحكّم في: .» — a clause with nothing in it is worse than no clause.
 *
 * ⚠️ AND THE href FALLBACK IS GONE FOR THE SAME REASON. A screen the api named and the nav map
 * does not have has no Arabic title either, so printing its path would be the same defect by a
 * different route. The api-side spec still fails on that state, which is where it is fixed.
 */
export function controlsLabel(
  notice: NewPermissionNotice,
  t: (key: TranslationKey, vars?: Record<string, string>) => string,
): string | null {
  if (notice.screen) {
    const destination = DESTINATION_GROUPS.flatMap((g) => g.items).find(
      (d) => d.href === notice.screen,
    );
    if (destination) return t(destination.labelKey);
  }
  return null;
}

/**
 * OWNER DECISION 156 RULING 2's second half — «الشرح الذي ينتهي بنقطة لا تُضاف بعده نقطة ثانية».
 *
 * Her template writes its own full stop after the description slot, and 17 of the 234 Arabic
 * descriptions already end in one, so the bell printed «…إصدار الوثائق.. تتحكّم في».
 *
 * ⛔ The TEMPLATE is not edited — not one word of hers moves. The description is handed over
 * without the stop it already carries, so the one the template writes is the only one rendered.
 */
function stripTrailingStop(description: string): string {
  const trimmed = description.trimEnd();
  return trimmed.endsWith('.') ? trimmed.slice(0, -1) : trimmed;
}

/**
 * Her sentence, with the slots filled.
 *
 * The DESCRIPTION comes from `describePermission`, which is the same text the permission matrix
 * shows — so an administrator reads the identical sentence in the bell and on the screen they
 * are sent to. Two different wordings for one permission is how a matrix stops being trusted.
 */
export function newPermissionSentence(
  notice: NewPermissionNotice,
  t: (key: TranslationKey, vars?: Record<string, string>) => string,
  language: Language,
): string {
  /*
   * ⛔ THE NAME SLOT IS FILLED IN ARABIC ONLY, and that is what English rendered already.
   *
   * Every ratified name is Arabic and no ruling says what an English reader should see, so
   * putting `permissionNameAr` into the English template would drop an Arabic phrase into an
   * English sentence. Measured on what shipped: 233 of the 234 codes had no name at all and so
   * took the no-name template in BOTH languages — English keeps exactly that. The 234th,
   * `retention.archive.retrieve`, did render its Arabic name inside the English sentence, and
   * that was a defect rather than a behaviour worth preserving.
   */
  const name = language === 'AR' ? permissionNameAr(notice.code) : '';
  const description = stripTrailingStop(
    describePermission(notice.code, language) ?? '',
  );
  const controls = controlsLabel(notice, t);

  /*
   * 🔴 OWNER DECISION 156 RULING 2 — THE SENTENCE DOES NOT SAY THE SAME WORDS TWICE.
   *
   * Her sentence has a NAME slot and a DESCRIPTION slot, and 158 of the 196 names are sliced
   * out of the very description that follows them. So the bell read:
   *
   *   «صلاحية جديدة في النظام: يُقرّ بأن ترخيص المكتب قيد التجديد. يُقرّ بأن ترخيص المكتب قيد
   *    التجديد، وأنه لم يصله…»
   *
   * ⟶ Where the description CONTAINS the name, the already-ratified no-name template is the
   *   right one — the same template that served every unnamed code before the names existed.
   *   ⛔ Neither template's words change; which of the two is chosen is all that moved.
   *
   * MEASURED against the shipping Arabic rather than assumed, and it reproduces her own table:
   * 158 contained · 17 owner-worded singles · 59 family names, which are «اسم العائلة · الفعل»
   * and so are never in a description. A name that is not in its description still gets the
   * name, which is why `retention.archive.retrieve` still reads name-then-description.
   */
  /*
   * 🔴 OWNER DECISION 160 RULING 2 — FOUR TEMPLATES NOW, AND THE CHOICE IS TWO INDEPENDENT
   * QUESTIONS.
   *
   * Does the description already say the name (decision 156 ruling 2)? And is there a screen
   * this permission opens that already has an Arabic title (decision 160 ruling 2)? The two are
   * unrelated — `license-renewal.declare` answers «yes» to the first and «no» to the second —
   * so collapsing them into one three-way choice would have left one combination unreachable.
   *
   * ⛔ NO TEMPLATE'S WORDS CHANGE. The two new ones are the two old ones with exactly her ruled
   * clause deleted, which `new-permission-sentence.test.ts` derives and checks.
   */
  const noName = name === '' || description.includes(name);
  if (controls === null) {
    return noName
      ? t('notifNewPermissionSentenceNoNameNoScreen', { description })
      : t('notifNewPermissionSentenceNoScreen', { name, description });
  }
  return noName
    ? t('notifNewPermissionSentenceNoName', { description, controls })
    : t('notifNewPermissionSentence', { name, description, controls });
}
