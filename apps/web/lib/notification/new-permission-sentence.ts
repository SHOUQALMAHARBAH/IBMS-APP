import { DESTINATION_GROUPS } from '../../components/app/destinations';
import { describePermission } from '../admin/permission-descriptions';
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
 * 🔴 THE PERMISSION NAMES — OWNER DECISION 127, AND THE TABLE IS NOT BUILT.
 *
 * «ما في رمز صلاحية يظهر للمستخدم في أي شاشة أو رسالة: لكل صلاحية اسم عربي قصير صريح مقتطَع من
 * شرحها.» Every permission is to have a short plain Arabic name, and the CODE is never shown.
 *
 * Measured 2026-11-14: exactly ONE name exists — `retention.archive.retrieve` ⟶
 * «استخراج سجل مؤرشف/محجوب», which she supplied herself on 2026-11-10. The derivation pass over
 * the other 231 is deferred (message 38 §4 puts it after message 39) and a name is HERS, so the
 * two codes that can actually be marked today have none.
 *
 * ⟶ WHICH IS WHY `newPermissionSentence` HAS A NO-NAME BRANCH. The three options were: show the
 *   code (decision 127 forbids it, in those words), invent a name (the standing rule forbids it,
 *   and it is hers), or render her sentence without the clause it has no value for. Only the
 *   third neither lies nor invents. It is reported rather than quietly shipped.
 *
 * ⚠️ This map is NOT a place to add a name you derived. A row here is a row she gave.
 */
export const OWNER_SUPPLIED_PERMISSION_NAMES: Readonly<Record<string, string>> =
  {
    // Hers, 2026-11-10 — decision 127's first and so far only row.
    'retention.archive.retrieve': 'استخراج سجل مؤرشف/محجوب',
  };

/**
 * What the code controls, for the «تتحكّم في» slot.
 *
 * A SCREEN where the nav map names the code — rendered as that screen's own already-shipping
 * title, so no Arabic is invented and both languages are served. Otherwise the ROUTES, verbatim.
 *
 * ⟶ A route is weaker than a screen name and it is the honest answer when no screen exists:
 *   naming a screen that is not built would be a guess, in the one sentence an administrator
 *   reads before deciding who may do something.
 */
export function controlsLabel(
  notice: NewPermissionNotice,
  t: (key: TranslationKey, vars?: Record<string, string>) => string,
): string {
  if (notice.screen) {
    const destination = DESTINATION_GROUPS.flatMap((g) => g.items).find(
      (d) => d.href === notice.screen,
    );
    if (destination) return t(destination.labelKey);
    // A screen the api named and the nav map does not have. Fall through to the href rather
    // than inventing a title for it — and the api-side spec fails on exactly this state.
    return notice.screen;
  }
  return notice.routes.join('  ·  ');
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
  const name = OWNER_SUPPLIED_PERMISSION_NAMES[notice.code];
  const description = describePermission(notice.code, language) ?? '';
  const controls = controlsLabel(notice, t);

  return name
    ? t('notifNewPermissionSentence', { name, description, controls })
    : t('notifNewPermissionSentenceNoName', { description, controls });
}
