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
import {
  describeRecordHandle,
  resolutionFor,
} from './retention-resolution.config';
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

  /**
   * THE REGISTER — which category, which records, which basis, who, when, until when.
   *
   * ## IT IS NOT THE NOTICE LIST, AND THAT IS WHY IT HAS TO EXIST SEPARATELY
   *
   * `list()` above returns records whose period has ELAPSED. An extended record LEAVES that list by
   * design — that is what an extension does. So this is the only place an extension is readable,
   * and without a reader the office could extend retention and nobody, a regulator included, could
   * ask what was extended and why. Group 7b's own rule is that an extension is a DECISION, NOT AN
   * EXIT, and *the register must name WHICH* records were extended.
   *
   * ## ONE ROW PER EXTENSION, NEVER ONE PER CATEGORY
   *
   * The write is per RECORD for a measured reason — the period is one number for a whole category,
   * so raising it would extend records nobody was asked about — and a register that aggregated by
   * category would throw away exactly the half that makes an extension answerable.
   *
   * ## BOTH THE ACTOR AND THE RECORD ARE NAMED NOW — owner decision 44
   *
   * `extendedByName` resolves the actor in the repository's include, the same way the sibling
   * retrieval register does, because a uuid identifies nobody to a reader.
   *
   * `recordHandle` answers *WHICH records* — the half of group 7b's rule that register entry 94
   * recorded as open. It is THREE STATES AS ONE FIELD, and the three are genuinely different
   * answers to a regulator:
   *
   *   `RECORDED`                     the reference the record carries, and what it IS.
   *   `NOT_RECORDED`                 this kind of record carries a reference and this one has none.
   *                                  A gap in the office's own bookkeeping — an outstanding
   *                                  commission entry has no payment reference by nature.
   *   `CATEGORY_HAS_NO_REFERENCE`    no record of this kind carries one, with the reason. A property
   *                                  of the system rather than of this row.
   *   `RECORD_NO_LONGER_PRESENT`     the extension row survives and the record it named does not.
   *
   * Collapsing any pair of those into "—" would make the register say less than it knows, and the
   * first two are the pair most easily confused: one is answerable by going and finding the
   * reference, the other never will be.
   *
   * THREE OF THE FIVE CATEGORIES RESOLVE AND TWO CANNOT, measured — see `RecordHandleSource` in
   * `retention-resolution.config.ts` for the figures and for why no reference is generated for the
   * other two. Nothing in this product assigns a human-readable reference to anything, so there was
   * no pattern to copy; what closed the gap for `Remittance` was that it is `@unique` on its own
   * receipt, so its handle was already there, one hop away.
   *
   * `recordId` IS STILL RETURNED AND STILL NOT RENDERED. The id is the accountability record and the
   * row's own test hook; the rendered-identifier budget does not move for this feature.
   */
  async register(recordCategory?: string) {
    const rows = await this.notices.listExtensions(recordCategory);

    /*
     * ONE HANDLE QUERY PER CATEGORY PRESENT IN THE RESULT, not one per row. Grouped first so a
     * register showing fifty extensions across three categories costs three reads, and so a
     * category the resolver does not recognise costs none at all.
     */
    const byCategory = new Map<string, string[]>();
    for (const r of rows) {
      const ids = byCategory.get(r.recordCategory);
      if (ids) ids.push(r.recordId);
      else byCategory.set(r.recordCategory, [r.recordId]);
    }
    const handles = new Map<string, Map<string, string | null>>();
    for (const [category, ids] of byCategory) {
      const resolution = resolutionFor(category);
      if (!resolution) continue;
      handles.set(category, await this.notices.recordHandles(resolution, ids));
    }

    return rows.map((r) => ({
      id: r.id,
      recordCategory: r.recordCategory,
      recordId: r.recordId,
      recordHandle: describeRecordHandle(
        r.recordCategory,
        r.recordId,
        handles.get(r.recordCategory),
      ),
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
      extendedByName: r.extendedBy.fullName,
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
