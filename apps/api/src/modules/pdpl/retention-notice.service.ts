import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { RecordAuditEntryInput } from '../audit/audit.service';
import { LegalHoldRepository } from '../../repositories/legal-hold.repository';
import { RetentionNoticeRepository } from '../../repositories/retention-notice.repository';
import { RetentionScheduleRepository } from '../../repositories/retention-schedule.repository';
import {
  deriveRetentionNotice,
  elapsedBefore,
  type RetentionNoticeView,
} from './retention-notice.config';
import { resolutionFor } from './retention-resolution.config';
import { periodIsActionable } from './retention-template.config';
import {
  assertExtensionBasis,
  type ExtensionBasisInput,
} from './retention-extension.config';

/**
 * THE RETENTION NOTICE AND THE EXTENSION — batch 5 group 7b.
 *
 * ## THE NOTICE IS A READ AND HAS NO WRITE PATH TO A DISPOSAL
 *
 * It filters; it destroys nothing. This service can list notices and record an extension, and that
 * is all — it injects no disposal repository and no anonymisation anything, which
 * `retention-notice.inventory.spec.ts` asserts as an ABSENCE because that is the only form that can
 * fail. The other two choices are separate acts behind their own permissions, taken by a person who
 * has read the notice.
 *
 * ## A LEGAL HOLD IS AT CATEGORY GRAIN, AND THAT IS THE DATA RATHER THAN A SIMPLIFICATION
 *
 * MEASURED: `LegalHold` carries `retentionScheduleItemId`, `customerId` and `insuredPersonId` — and
 * NO per-record reference. So a hold on a category's schedule item holds every record in it, which
 * is exactly what `LegalHoldRepository.hasActiveHold` already means and what the disposal chain
 * already enforces. The notice reports that as a held COUNT rather than quietly returning zero:
 * records vanishing from a count with no explanation is how an officer concludes the system lost
 * them, and a held record is precisely the one somebody comes looking for.
 *
 * ## WHO SEES IT: HOLDERS OF ANY OF THE ACTS, NEVER A ROLE NAME
 *
 * The route is an ANY-OF over the act codes, so a Branch/Department Manager who may nominate sees
 * the same list as the Compliance Officer who may extend. Two different people acting on one list is
 * the segregation working, not a defect to smooth over by routing the notice to one of them.
 */
@Injectable()
export class RetentionNoticeService {
  private readonly logger = new Logger(RetentionNoticeService.name);

  constructor(
    private readonly schedule: RetentionScheduleRepository,
    private readonly notices: RetentionNoticeRepository,
    private readonly legalHolds: LegalHoldRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * Every category the office has set a period for, with its elapsed count or the reason it can
   * never have one.
   *
   * `now` is a parameter so the boundary is provable without a clock — the same reason the licence
   * lapse rule takes it.
   */
  async list(now: Date = new Date()): Promise<RetentionNoticeView[]> {
    const items = await this.schedule.findMany();
    const out: RetentionNoticeView[] = [];

    for (const item of items) {
      // The three fields every branch below passes through unchanged. Collected once so a branch
      // cannot quietly omit `confirmedByLegalCounselAt` and make a draft period look confirmed.
      const identity = {
        recordCategory: item.recordCategory,
        retentionPeriodMonths: item.retentionPeriodMonths,
        confirmedByLegalCounselAt: item.confirmedByLegalCounselAt,
      };

      /*
       * INERT FIRST — no period, or a period no lawyer has confirmed. The row is RENDERED and
       * nothing is measured, which is the brief's own rule: never proposed for disposal and never
       * alerted on.
       *
       * The return is BEFORE the queries rather than a suppression after them, and that is not
       * tidiness: `elapsedBefore` takes a non-null period, so a null one here would produce a NaN
       * cutoff and a `lte` filter against it. Narrowing that signature is what makes forgetting
       * this guard a compile error.
       *
       * This is the state the SHIPPED TEMPLATE puts a floored category in deliberately — the office
       * sets its period above the floor on its own legal advice — so it is the common case on a
       * fresh office rather than an edge one.
       */
      if (!periodIsActionable(item)) {
        out.push(
          deriveRetentionNotice({
            ...identity,
            elapsedCount: 0,
            elapsedRecordIds: [],
            heldCount: 0,
            extendedCount: 0,
          }),
        );
        continue;
      }

      const resolution = resolutionFor(item.recordCategory);
      if (!resolution) {
        // UNRESOLVABLE CATEGORIES STILL GET A ROW. Decision 28's family: an office that set a period
        // for a category it named itself and is never alerted will believe the system is watching
        // it. The row carries the measured reason and the screen says it loudly.
        out.push(
          deriveRetentionNotice({
            ...identity,
            elapsedCount: 0,
            elapsedRecordIds: [],
            heldCount: 0,
            extendedCount: 0,
          }),
        );
        continue;
      }

      const cutoff = elapsedBefore(now, item.retentionPeriodMonths);
      const elapsedIds = await this.notices.idsElapsedBefore(
        resolution,
        cutoff,
      );
      const held = await this.legalHolds.hasActiveHold(item.id);
      const extendedIds = held
        ? []
        : await this.notices.extendedRecordIds(item.recordCategory, now);

      out.push(
        deriveRetentionNotice({
          ...identity,
          // A hold covers the WHOLE category, so everything elapsed is held and nothing is offered.
          elapsedCount: held
            ? 0
            : elapsedIds.filter((id) => !extendedIds.includes(id)).length,
          elapsedRecordIds: held
            ? []
            : elapsedIds.filter((id) => !extendedIds.includes(id)),
          heldCount: held ? elapsedIds.length : 0,
          extendedCount: held
            ? 0
            : elapsedIds.filter((id) => extendedIds.includes(id)).length,
        }),
      );
    }
    return out;
  }

  /**
   * EXTEND — per record, on one of exactly three bases, with the clock restarted and the register
   * written.
   *
   * Per RECORD rather than per category: the period on `RetentionScheduleItem` is one number for the
   * whole category, so raising it would extend records nobody was asked about — and the register has
   * to name WHICH records were extended.
   */
  async extend(
    input: {
      recordCategory: string;
      recordIds: string[];
      months: number;
      basis: ExtensionBasisInput;
    },
    actorUserId: string,
    now: Date = new Date(),
  ): Promise<{ extended: number; extendedUntil: string }> {
    const item = await this.schedule.findByRecordCategory(input.recordCategory);
    if (!item) {
      throw new NotFoundException(
        `No retention period is set for record category "${input.recordCategory}", so there is nothing to extend.`,
      );
    }
    const resolution = resolutionFor(input.recordCategory);
    if (!resolution) {
      throw new UnprocessableEntityException(
        `This system cannot resolve which records "${input.recordCategory}" means, so it raises no notice for it and there is nothing to extend. Extending a category the clock does not watch would record a decision about records nobody can enumerate.`,
      );
    }
    if (input.recordIds.length === 0) {
      throw new UnprocessableEntityException(
        'An extension names the records it covers. Extending nothing is not a decision.',
      );
    }

    /*
     * THE BASIS IS CHECKED BEFORE ANYTHING IS WRITTEN, and the refusals are about the BASIS rather
     * than the period's length — there is no maximum here to refuse against. Placed first so an
     * officer whose basis is not substantiable hears that rather than hearing about a record id.
     */
    assertExtensionBasis(input.basis);

    const extendedUntil = new Date(now.getTime());
    extendedUntil.setUTCMonth(extendedUntil.getUTCMonth() + input.months);

    let written = 0;
    for (const recordId of input.recordIds) {
      await this.notices.createExtension({
        recordCategory: input.recordCategory,
        recordId,
        extendedUntil,
        basis: input.basis.basis,
        note: input.basis.note.trim(),
        legislativeInstrument: input.basis.instrument?.trim() ?? null,
        legislativeArticle: input.basis.article?.trim() ?? null,
        legalHoldId: input.basis.legalHoldId ?? null,
        consentRecordId: input.basis.consentRecordId ?? null,
        consentDuration: input.basis.consentDuration?.trim() ?? null,
        consentPurpose: input.basis.consentPurpose?.trim() ?? null,
        extendedByUserId: actorUserId,
      });
      written += 1;
    }

    /*
     * THE AUDIT ROW CARRIES THE BASIS AND THE NOTE VERBATIM, and the COUNT of records rather than
     * their ids — the same shape the anchored customer read uses: a list read is not a read of one
     * record, and the register is where the per-record detail lives and can be queried.
     */
    await this.safeAudit({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'RetentionScheduleItem',
      entityId: item.id,
      afterValue: {
        retentionExtension: {
          recordCategory: input.recordCategory,
          records: written,
          months: input.months,
          extendedUntil: extendedUntil.toISOString(),
          basis: input.basis.basis,
          note: input.basis.note.trim(),
        },
      },
    });

    return { extended: written, extendedUntil: extendedUntil.toISOString() };
  }

  /** The register — which category, which records, which basis, who, when, until when. */
  async register(recordCategory?: string) {
    const rows = await this.notices.listExtensions(recordCategory);
    return rows.map((r) => ({
      id: r.id,
      recordCategory: r.recordCategory,
      recordId: r.recordId,
      extendedUntil: r.extendedUntil.toISOString(),
      basis: r.basis,
      note: r.note,
      legislativeInstrument: r.legislativeInstrument,
      legislativeArticle: r.legislativeArticle,
      legalHold: r.legalHold
        ? {
            id: r.legalHold.id,
            scope: r.legalHold.scope,
            reason: r.legalHold.reason,
          }
        : null,
      consentRecordId: r.consentRecordId,
      consentDuration: r.consentDuration,
      consentPurpose: r.consentPurpose,
      extendedByUserId: r.extendedByUserId,
      extendedAt: r.extendedAt.toISOString(),
    }));
  }

  private async safeAudit(input: RecordAuditEntryInput): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (err) {
      this.logger.error(
        `RetentionExtension audit (${input.entityId}) failed after the write committed: ${(err as Error).message}`,
      );
    }
  }
}
