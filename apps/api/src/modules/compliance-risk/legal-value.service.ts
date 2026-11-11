import { Injectable } from '@nestjs/common';
import type { LegalValue } from '@ibms/db';
import { parseCalendarDate } from '../../common/calendar-date.util';
import { LegalValueRepository } from '../../repositories/legal-value.repository';
import type { DeclareLegalValueDto } from './dto/declare-legal-value.dto';
import {
  licenceFiguresFrom,
  type LicenceLegalFigures,
} from './legal-figures.config';

/**
 * THE ONE PLACE A LEGAL FIGURE IS READ — module 1, OWNER DECISION 123.
 *
 * ## WHY IT IS A SERVICE AND NOT A CONSTANT, WHICH IS THE WHOLE OF THE DECISION
 *
 * Before this, art. 4/a's five capital figures, art. 11's 45 days and art. 14/c's two years were
 * `const`s in three source files. A regulation that moved needed a code change, a review, a build
 * and a deploy — and an office could not supply a figure the instrument defers to a ruling the
 * Central Bank has not issued, because there was nowhere to put it. `check:legal-numbers` declared
 * all three with their reasons and its own message said to delete the declaration when the figure
 * moved into the table. This is where they moved to.
 *
 * ## `at` IS REQUIRED EVERYWHERE, AND THAT IS CRITERION 3
 *
 * *Read an old transaction and it computes at the value in force on its own day.* A default of
 * `new Date()` would compile at every call site and silently answer with today's row — which is
 * exactly the defect found in `sla-timer.service.ts` and fixed in this same batch. So every method
 * takes the date, and the repository applies the effective dating so no caller can forget it.
 *
 * ## NO CACHE, DELIBERATELY
 *
 * A cached figure is a second answer, and this is the table whose whole purpose is that there is
 * one. `LicenseGateService`'s own header makes the same call for the same reason — *a cached answer
 * is a fourth answer* — and the cost here is one indexed read per licence question.
 */
@Injectable()
export class LegalValueService {
  constructor(private readonly rows: LegalValueRepository) {}

  /**
   * Every figure the licence rules need, as at `at`.
   *
   * ONE query for all of them rather than one per figure: five round trips for one answer is five
   * chances to straddle midnight and read two different days, and the licence derivation needs
   * art. 4/a's five, art. 11's one and art. 14/c's one together.
   *
   * Refuses, naming the code, when a provider figure is absent — see `licenceFiguresFrom`. A
   * default would make an office's renewal deadline correct by coincidence.
   */
  async licenceFigures(at: Date): Promise<LicenceLegalFigures> {
    return licenceFiguresFrom(await this.rows.findAllInForce(at));
  }

  /**
   * One row, or null.
   *
   * Null is a real answer: a DORMANT office-supplied value (criterion 6 — nothing may rest on it,
   * no exemption, no refusal, no alert) and a code with no row read the same way, and a caller
   * must say what it does with the absence rather than defaulting it to a figure.
   */
  async findInForce(code: string, at: Date): Promise<LegalValue | null> {
    return this.rows.findInForce(code, at);
  }

  /** Every value in force on `at` — the provider's and this office's. */
  async listInForce(at: Date): Promise<LegalValue[]> {
    return this.rows.findAllInForce(at);
  }

  /** One code's whole dated history, newest window first. */
  async history(code: string): Promise<LegalValue[]> {
    return this.rows.findHistory(code);
  }

  /**
   * An office declares a value the instrument defers — decision 123.
   *
   * ## WHAT THIS METHOD DELIBERATELY DOES NOT CHECK
   *
   * That the code is one the instrument DEFERS rather than one it STATES. That is criterion 7, and
   * decision 123 says it is enforced by *a CHECK and an RLS policy, not application logic*:
   *
   *   * the RLS policy refuses this role any write to a provider (NULL-org) row, so an office can
   *     never edit the instrument's own figure;
   *   * the CHECK ties `sourceType` to the ownership, so an office row cannot claim the
   *     instrument's authority even when it names an instrument code.
   *
   * What remains possible is an office declaring a row for a code the instrument states, BESIDE
   * the provider's. The database cannot know which codes those are — the catalogue does, and
   * `packages/db` is unreachable from here — so the read REFUSES when both exist and names the
   * code (`pickOneOwner`). Loud on first use beats a figure whose authority depends on which row
   * happened to exist.
   *
   * ## AND THE DATES ARE PARSED AS CALENDAR DAYS
   *
   * `effectiveFrom` is `@db.Date`. Parsing with the shared helper rather than `new Date(string)`
   * keeps a value entered in Amman from landing on the previous day in UTC, which is the class of
   * error that moves a legal threshold by a day and looks like arithmetic.
   */
  async declare(
    dto: DeclareLegalValueDto,
    actor: { id: string },
  ): Promise<LegalValue> {
    return this.rows.declare({
      code: dto.code,
      name: dto.name,
      kind: dto.kind,
      // The CHECK refuses a figure in the wrong column; this puts it in the right one so the
      // refusal is reserved for a real contradiction rather than a shape mistake.
      numericValue: dto.kind === 'DATE' ? null : (dto.numericValue ?? null),
      dateValue:
        dto.kind === 'DATE' && dto.dateValue
          ? parseCalendarDate(dto.dateValue, 'dateValue')
          : null,
      sourceReference: dto.sourceReference,
      effectiveFrom: parseCalendarDate(dto.effectiveFrom, 'effectiveFrom'),
      note: dto.note ?? null,
      actorUserId: actor.id,
    });
  }
}
