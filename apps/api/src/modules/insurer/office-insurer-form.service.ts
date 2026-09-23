import {
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { AuditService } from '../audit/audit.service';
import { InsurerService } from './insurer.service';
import { InsuranceLineRepository } from '../../repositories/insurance-line.repository';
import { InsurerMasterRepository } from '../../repositories/insurer-master.repository';
import {
  OfficeInsurerFormRepository,
  type OfficeFormLineRef,
  type OfficeFormTemplateWithFields,
} from '../../repositories/office-insurer-form.repository';
import {
  duplicateFieldKeys,
  enumFieldsMissingOptions,
  deriveTemplateView,
} from './insurer-master.config';
import {
  deriveOfficeTemplateView,
  type OfficeInsurerFormTemplateView,
  type ResolvedOfficeForm,
} from './office-insurer-form.config';
import type { MapOfficeInsurerFormDto } from './dto/map-office-insurer-form.dto';

/**
 * Q9 — this office's OWN mapped submission forms.
 *
 * ## Why this is a separate service and not two more methods on `InsurerMasterService`
 *
 * That service's entire docblock is "everything here is deliberately NOT tenant-scoped", and it
 * is right: a global mapping made once is readable by every office, which is Part I §5's promise.
 * These rows are the opposite — one office's private copy — so folding them in would leave a
 * module whose docblock has to say "some of this is shared and some is not", which is exactly the
 * confusion `InsurerModule` and `InsurerMasterModule` were split to avoid.
 *
 * ## The visibility read is INHERITED, never re-derived
 *
 * Every method starts from `InsurerService.get(insurerId)`, which 404s an insurer belonging to
 * another office — a 404 and not a 403, because "this insurer is not yours" and "this insurer does
 * not exist" must be indistinguishable to a caller probing ids. Reaching for
 * `InsurerRepository` directly here would work and would silently re-decide that, which is the
 * mistake this codebase has recorded before: a document endpoint must inherit the entity's own
 * access check through its service, never its repository.
 *
 * ## What resolution means, and why `source` is on the wire
 *
 * An office asking "which form do I submit against for this insurer and this line" can be
 * answered from either table, and the two have very different blast radii. So the answer names
 * its source, and the precedence is:
 *
 *  1. This office's OWN mapping, newest version, if it has one.
 *  2. Otherwise the SHARED mapping off the insurer's `InsurerMaster`.
 *  3. Otherwise null — which §5 is explicit is a real answer: the submission falls back to the
 *     generic structured fields already collected during Needs Assessment/RFQ.
 *
 * Step 2 is reachable in exactly one case, and it is worth stating because it looks like an
 * omission otherwise: the shared table can only hold CATALOGUE lines and only hangs off an
 * `InsurerMaster`. So a locally registered company, or an office's own added line, can never have
 * a shared mapping — for those, step 1 is the only source there is.
 *
 * An office's own mapping WINS on purpose. It is the more specific fact: that company sent THAT
 * OFFICE those forms. And overriding is safe in the direction that matters — it changes only what
 * this office submits, and nothing here writes, versions or supersedes the shared row.
 */
@Injectable()
export class OfficeInsurerFormService {
  constructor(
    private readonly templates: OfficeInsurerFormRepository,
    private readonly insurers: InsurerService,
    private readonly lines: InsuranceLineRepository,
    private readonly masters: InsurerMasterRepository,
    private readonly audit: AuditService,
  ) {}

  /** Every mapping THIS office holds for one insurer, newest version first. */
  async list(
    insurerId: string,
    lineId?: string,
  ): Promise<OfficeInsurerFormTemplateView[]> {
    await this.insurers.get(insurerId);
    // Validated even on a read, for the reason the global registry's list already gives: a
    // filter on an id that does not exist returns an empty list, which reads as "nothing is
    // mapped for this line" when the truth is "that is not a line".
    const line =
      lineId === undefined ? undefined : await this.resolveLine(lineId);
    const rows = await this.templates.listTemplates(insurerId, line);
    return rows.map(deriveOfficeTemplateView);
  }

  /**
   * The mapping to submit against, from whichever source has one.
   *
   * Returns the source alongside the template because a screen cannot render the right controls
   * without it — a shared mapping must not offer "edit" to one office.
   */
  async resolve(
    insurerId: string,
    lineId: string,
  ): Promise<ResolvedOfficeForm> {
    const insurer = await this.insurers.get(insurerId);
    const line = await this.resolveLine(lineId);

    const own = await this.templates.findCurrent(insurerId, line);
    if (own !== null) {
      return { source: 'OFFICE', template: deriveOfficeTemplateView(own) };
    }

    // The shared table hangs off InsurerMaster and holds catalogue lines only, so both of these
    // conditions are structural rather than defensive: without a master there is no shared row
    // to find, and an office's own line can never appear there at all.
    if (insurer.insurerMasterId === null || line.kind === 'OFFICE') return null;

    const shared = await this.masters.listTemplates(
      insurer.insurerMasterId,
      line.insuranceLineId,
    );
    const current = shared[0];
    return current === undefined
      ? null
      : { source: 'SHARED', template: deriveTemplateView(current) };
  }

  /**
   * Records this office's mapping of an insurer's form for one line. A second mapping of the
   * same insurer+line is a NEW version, never an edit of the one this office is already
   * submitting against.
   */
  async map(
    insurerId: string,
    dto: MapOfficeInsurerFormDto,
    actorUserId: string,
  ): Promise<OfficeInsurerFormTemplateView> {
    await this.insurers.get(insurerId);
    const line = await this.resolveLine(dto.lineId);

    const duplicates = duplicateFieldKeys(dto.fields);
    if (duplicates.length > 0) {
      throw new UnprocessableEntityException(
        `Duplicate field keys in this mapping: ${duplicates.join(', ')}`,
      );
    }
    const missingOptions = enumFieldsMissingOptions(dto.fields);
    if (missingOptions.length > 0) {
      throw new UnprocessableEntityException(
        `ENUM fields need at least one option: ${missingOptions.join(', ')}`,
      );
    }

    // Annotated, not inferred: a bare `let template;` is `any`, and every read of it downstream
    // then silently opts out of type checking — which lint catches, but only because the rule is
    // on. The type is the repository's own payload shape, so a change to the include is a
    // compile error here rather than a runtime surprise in the view.
    let template: OfficeFormTemplateWithFields;
    try {
      template = await this.templates.createNextVersion({
        insurerId,
        line,
        sourceDocumentRef: dto.sourceDocumentRef ?? null,
        createdByUserId: actorUserId,
        fields: dto.fields.map((f) => ({
          fieldKey: f.fieldKey,
          labelEn: f.labelEn,
          labelAr: f.labelAr ?? null,
          dataType: f.dataType,
          isRequired: f.isRequired ?? false,
          options: f.options ?? [],
          displayOrder: f.displayOrder,
        })),
      });
    } catch (err) {
      // Two administrators mapping the same insurer+line at once both compute the same next
      // version; the unique index refuses the second. A 409 rather than the 500 a raw P2002
      // would produce, and the message says what to do rather than naming an index.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'Another version of this mapping was recorded while yours was being saved. Reload the form list and map again — your fields were not stored.',
        );
      }
      throw err;
    }

    await this.audit.record({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'OfficeInsurerFormTemplate',
      entityId: template.id,
      afterValue: {
        insurerId,
        // The line as BOTH ids, so the entry says which catalogue it came from without the
        // reader having to look the id up in two tables to find out.
        insuranceLineId: template.insuranceLineId,
        officeInsuranceLineId: template.officeInsuranceLineId,
        version: template.version,
        fieldCount: template.fields.length,
      },
    });

    return deriveOfficeTemplateView(template);
  }

  /**
   * Which catalogue a line id belongs to, or a 422 naming it.
   *
   * BOTH are legitimate here, which is the whole difference from
   * `InsurerMasterService.assertGlobalLine`: that method refuses an office's own line because
   * the row it guards is readable by every office. This row is readable by one, so an office's
   * own addition is exactly the case Q9 serves.
   *
   * The office lookup goes through the tenant-scoped client, so ANOTHER office's addition is
   * invisible and reported as unknown rather than refused — which tells the caller nothing about
   * whether it exists elsewhere. The same reasoning `InsurerService.resolveLineIds` records for
   * the list case; this is the single-id form of it.
   */
  private async resolveLine(lineId: string): Promise<OfficeFormLineRef> {
    const [standard] = await this.lines.findStandardByIds([lineId]);
    if (standard !== undefined) {
      return { kind: 'STANDARD', insuranceLineId: standard.id };
    }
    const office = await this.lines.findOfficeLineById(lineId);
    if (office !== null) {
      return { kind: 'OFFICE', officeInsuranceLineId: office.id };
    }
    throw new UnprocessableEntityException(
      `Insurance line id does not exist: ${lineId}. Pick one from GET /insurance-lines — this office's own additions are listed there too and are valid for your own form mappings.`,
    );
  }
}
