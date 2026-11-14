/**
 * THE «جديدة» MARK AND WHAT THE NOTIFICATION SAYS — OWNER DECISION 131.
 *
 * «إحنا بنطلّع كل صلاحيات النظام بالمصفوفة وما بنعطي ولا وحدة لحدا؛ الصلاحية الجديدة بتنزل معلَّمة
 * بالأخضر إنها جديدة ويوصل إشعار للأدمن، وهو بيقرر لمين يعطيها وعلى أي دور.»
 *
 * Pure functions and one declared map. No database, no clock — the date and the office's own
 * `createdAt` are PARAMETERS, for the same reason `article-15-d.config.ts` takes its figures:
 * a rule that reads `new Date()` cannot be asked what an office saw last week.
 */

/**
 * Is this code marked «جديدة» for this office?
 *
 * THREE CONDITIONS, and each exists because of something that would otherwise go wrong:
 *
 *   1. the code HAS an arrival date and it is later than the office's own `createdAt`.
 *      Without the second half, an office registered today meets its whole 232-code catalogue
 *      as "new" on its first login, which teaches its administrator to dismiss the mark — and
 *      the mark only works while it is rare.
 *
 *   2. NO role in this office holds it. Granting it to a role is one of the two ways the owner
 *      named to decide («يعطيها لدور»), and it is already recorded as a `RolePermission` row,
 *      so it needs no second record. ⟶ This is also criterion 4, for free: the moment the
 *      administrator grants the code, `grantedHere` goes true and the mark clears — in THIS
 *      office, because `RolePermission` is tenant-scoped.
 *
 *   3. NO dismissal row. The other way she named, «أو يقرّر فيها»: the administrator looked and
 *      chose not to grant it. That is the one state nothing else in the schema can express.
 *
 * ⚠️ `introducedAt` NULL means the code PREDATES the mark, and that is never «new» for anybody.
 */
export function isMarkedNew(input: {
  introducedAt: Date | null;
  officeCreatedAt: Date;
  grantedHere: boolean;
  dismissedHere: boolean;
}): boolean {
  if (input.introducedAt === null) return false;
  if (input.introducedAt.getTime() <= input.officeCreatedAt.getTime()) {
    return false;
  }
  if (input.grantedHere) return false;
  if (input.dismissedHere) return false;
  return true;
}

/**
 * WHAT A CODE CONTROLS — the «تتحكّم في: [الشاشة أو الزر]» slot of decision 133's sentence.
 *
 * ## 🔴 WHY THIS IS A DECLARED MAP AND NOT A DERIVATION AT RUNTIME
 *
 * `scripts/measurements/screen-route-permission-fit.py` already derives route↔permission pairs by
 * reading the controllers, and the nav map in `apps/web/components/app/destinations.ts` already
 * carries screen↔permission. Both are the right sources and NEITHER is readable at runtime: the
 * api cannot read a web source file (the docker image does not contain `apps/web`), and a
 * decorator is not introspectable as a route table without booting Nest.
 *
 * So the map is DECLARED here and CHECKED against those two sources by
 * `new-permission-mark.config.spec.ts`, which re-derives both and fails on any disagreement. That
 * is the same arrangement `permission-catalogue-parity.spec.ts` uses to stop the web fixture
 * drifting from the seed: declared where it is needed, proven against where it is defined.
 *
 * ⚠️ AND IT ONLY COVERS CODES THAT CAN BE MARKED. A code with no `introducedAt` is never shown
 * in this sentence, so an entry for it would be a line nobody reads that still has to be
 * maintained. The spec asserts the map's key set is EXACTLY the dated codes, in both directions.
 *
 * ## THE SCREEN AND THE ROUTE ARE DIFFERENT ANSWERS AND THE DIFFERENCE IS REPORTED, NOT HIDDEN
 *
 * Decision 131 §5 asks for «أيّ شاشة أو زرّ» — which screen or button. Where a screen's nav entry
 * names the code, that IS the answer and `screen` carries its href; the web renders that screen's
 * own already-shipping title, so no Arabic is invented.
 *
 * Where no screen names it, `screen` is null and the notification says the ROUTE instead. That is
 * weaker and it is honest: naming a screen that does not exist would be a guess, and this is the
 * one sentence an administrator reads before deciding who may do something.
 *
 * ⟶ MEASURED 2026-11-14: BOTH codes that can be marked today are route-only. `legal-value.read`
 *   and `legal-value.declare` have no entry in `destinations.ts` at all, because module 1 built
 *   the legal-values API and its screen is not built. So the first two marks this product ever
 *   shows will both say a route. `docs/module-1-new-permission-mark.md` records that by name.
 */
export interface PermissionControls {
  /** The screen's href, when a nav entry names this code. NULL when none does. */
  screen: string | null;
  /** The api routes this code guards, `METHOD /path`. Never empty — a code that guards no route
   *  and no screen controls nothing, and the spec refuses one. */
  routes: readonly string[];
}

export const PERMISSION_CONTROLS: Readonly<Record<string, PermissionControls>> =
  {
    'legal-value.read': {
      // No screen: `/legal-values` is not built. See the note above.
      screen: null,
      routes: ['GET /legal-values', 'GET /legal-values/:code/history'],
    },
    'legal-value.declare': {
      screen: null,
      routes: ['POST /legal-values'],
    },
  };

/** The item the bell carries for one marked code. The api returns KEYS and never a sentence —
 *  `notification.config.ts`'s own rule, so one payload serves both languages. */
export interface NewPermissionNotice {
  code: string;
  /** The screen's href, or null when the notification must fall back to the route. */
  screen: string | null;
  /** Rendered by the web only when `screen` is null. */
  routes: readonly string[];
}

/** Build the notice for a marked code. A code with no declared controls still produces a notice —
 *  with no screen and no routes — because leaving it OUT of the bell entirely would mean an
 *  administrator is never told the code exists, which is the one outcome decision 131 forbids. */
export function noticeFor(code: string): NewPermissionNotice {
  const controls = PERMISSION_CONTROLS[code];
  return {
    code,
    screen: controls?.screen ?? null,
    routes: controls?.routes ?? [],
  };
}
