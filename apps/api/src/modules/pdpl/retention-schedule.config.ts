import { Prisma } from '@ibms/db';
import { floorForCategory } from './retention-floors.config';
import type { CombinedDutyAct } from '@ibms/db';
import {
  combinedDutyActView,
  type CombinedDutyActView,
} from '../../common/duty-segregation.view';

/**
 * M06 — Data Retention (backlog Part D §5.1, Process #52). The
 * `RetentionScheduleItem` table itself: "a documented retention-period
 * table" per record category, pending Legal Counsel confirmation.
 *
 * **No specific per-category retention period is sourced anywhere in this
 * brain today.** `PRIV-STD-03` (the governing document — see
 * `ibms-brain/meta/context/pcms-privacy-modules.md`'s M06 row) is where the
 * real table lives; engineering has never been handed its contents. The one
 * existing seed row (`recordCategory: "AuditLogEntry"`, 120 months) is a
 * documented ENGINEERING-INVENTED DRAFT pending a real citation — see
 * `packages/db/prisma/seed-data/retention-schedule.ts`'s own header comment
 * and `ibms-brain/meta/context/data-retention-and-disposal.md`. This module
 * does not invent any more draft figures than that one already-flagged
 * row — it only builds the CRUD so Compliance/DPO staff can add real rows
 * and confirm them once the table exists, which is exactly what "needs
 * Legal Counsel confirmation as a pending input" (the backlog's own phrase)
 * describes.
 */

export interface RetentionScheduleItemRow {
  id: string;
  recordCategory: string;
  /**
   * NULL where a statutory floor governs the category and the office has not yet set its own
   * period — the shipped template's deliberate state (decisions 32 and 33: a period beside an
   * article number reads as a legal opinion we do not have). Never a sentinel: 0 would read as
   * "destroy immediately". A row with no period is INERT — see `periodIsActionable`.
   */
  retentionPeriodMonths: number | null;
  legalBasis: string | null;
  confirmedByLegalCounselAt: Date | null;
  /**
   * THE SIXTEENTH PAIR'S ESCAPE COLUMN, as a RELATION rather than an id — "writes the column" was
   * read as "reads the relation" three times in this feature's history, which is why the
   * measurement that found this pair unprojected keys on the CALL SITE and not on a field name.
   */
  combinedDutyAct: CombinedDutyAct | null;
  /** Batch 5 group 6 — the no-floor declaration, all five or none by CHECK. */
  noFloorNoticeShown: string | null;
  noFloorReason: string | null;
  noFloorAcknowledgedAt: Date | null;
  noFloorAcknowledgedByUserId: string | null;
  noFloorAcknowledgedMonths: number | null;
}

export interface RetentionScheduleItemView {
  id: string;
  recordCategory: string;
  /** NULL where the category ships floored and unset — see the row type above. The screen renders
   *  the ARTICLE and the FLOOR in its place rather than an em dash, because "no period yet, and
   *  here is the minimum the law sets" is actionable where a blank is not. */
  retentionPeriodMonths: number | null;
  /**
   * THE FLOOR GOVERNING THIS CATEGORY, or null — and the screen NEEDS it rather than merely
   * liking it.
   *
   * A floored category ships with no period on purpose, so without this the row would read "no
   * period set" and stop, which tells an office nothing it can act on. With it the row reads "no
   * period set; this article sets a minimum of N months; set yours above it" — the difference
   * between a blank and an instruction.
   *
   * READ THROUGH `floorForCategory`, never restated, so a screen cannot name a different statute
   * from the one that refused a shorter period an hour earlier. `floorMonths` is carried here where
   * the NOTICE's own `floor` field omits it: the notice explains a count that already happened, and
   * this explains a number the office still has to choose.
   */
  floor: {
    instrument: string;
    article: string;
    operativeText: string;
    floorMonths: number;
  } | null;
  legalBasis: string | null;
  confirmedByLegalCounselAt: string | null;
  /** `confirmedByLegalCounselAt !== null` — a plain convenience flag so a
   * caller never has to derive "is this confirmed?" from a nullable
   * timestamp itself. */
  isConfirmed: boolean;
  /**
   * ON THE RECORD, not only in the report at `/internal-controls`. A reader looking at a confirmed
   * retention period has to be able to see that nobody else signed it without going to find a
   * report — rule 4 of the duty-segregation design, and the one thing this pair was missing.
   *
   * FOUND BY A MEASUREMENT, not by reading: `combined-duty-projection.py` reported this pair as
   * the one of sixteen WRITING the act and showing nobody, the moment a dead assertion stopped
   * killing that script before it measured anything.
   */
  combinedDutyAct: CombinedDutyActView | null;
  /**
   * THE DECLARATION, ON THE RECORD — the sentence the office was shown and the reason it wrote,
   * verbatim. Not the word "acknowledged": the owner's rule is that what the person was TOLD is
   * part of the record, because a year from now the question is what they saw.
   *
   * Null on every category that has a known floor, and on every row nobody has had to declare for.
   */
  noFloorDeclaration: {
    noticeShown: string;
    reason: string;
    acknowledgedAt: string;
    acknowledgedByUserId: string;
    acknowledgedMonths: number;
  } | null;
}

/** The floor as the screen needs it, or null. A thin projection so the view never hands a screen
 *  the config object itself — the `categories` list on it is internal and has no business on a
 *  wire. */
function floorView(recordCategory: string) {
  const f = floorForCategory(recordCategory);
  return f === null
    ? null
    : {
        instrument: f.instrument,
        article: f.article,
        operativeText: f.operativeText,
        floorMonths: f.floorMonths,
      };
}

export function deriveRetentionScheduleItemView(
  row: RetentionScheduleItemRow,
): RetentionScheduleItemView {
  return {
    id: row.id,
    recordCategory: row.recordCategory,
    retentionPeriodMonths: row.retentionPeriodMonths,
    legalBasis: row.legalBasis,
    confirmedByLegalCounselAt: row.confirmedByLegalCounselAt
      ? row.confirmedByLegalCounselAt.toISOString()
      : null,
    isConfirmed: row.confirmedByLegalCounselAt !== null,
    floor: floorView(row.recordCategory),
    combinedDutyAct: combinedDutyActView(row.combinedDutyAct),
    /*
     * ALL FIVE OR NOTHING, mirroring the database CHECK rather than trusting it: a partial
     * declaration cannot exist, so reading one field as present and another as missing would be a
     * state the schema refuses — and a view that emitted a half-declaration would put a legal
     * notice on screen with nobody's name against it.
     */
    noFloorDeclaration:
      row.noFloorNoticeShown !== null &&
      row.noFloorReason !== null &&
      row.noFloorAcknowledgedAt !== null &&
      row.noFloorAcknowledgedByUserId !== null &&
      row.noFloorAcknowledgedMonths !== null
        ? {
            noticeShown: row.noFloorNoticeShown,
            reason: row.noFloorReason,
            acknowledgedAt: row.noFloorAcknowledgedAt.toISOString(),
            acknowledgedByUserId: row.noFloorAcknowledgedByUserId,
            acknowledgedMonths: row.noFloorAcknowledgedMonths,
          }
        : null,
  };
}

export function retentionScheduleItemAuditSnapshot(
  row: RetentionScheduleItemRow,
): Prisma.InputJsonObject {
  return {
    retentionScheduleItemId: row.id,
    recordCategory: row.recordCategory,
    retentionPeriodMonths: row.retentionPeriodMonths,
    isConfirmed: row.confirmedByLegalCounselAt !== null,
  };
}
