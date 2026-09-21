import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { InsurerMasterRepository } from '../../repositories/insurer-master.repository';
import { InsuranceLineRepository } from '../../repositories/insurance-line.repository';
import {
  deriveMasterView,
  deriveTemplateView,
  duplicateFieldKeys,
  enumFieldsMissingOptions,
  type InsurerFormTemplateView,
  type InsurerMasterView,
} from './insurer-master.config';
import type { MapInsurerFormDto } from './dto/map-insurer-form.dto';

/**
 * Part I §5 (multi-tenancy Phase 3 step 10) — the global insurer registry.
 *
 * Everything here is deliberately NOT tenant-scoped. Two offices dealing with
 * the same real insurance company must see the same company and reuse the same
 * mapped submission form, rather than each re-mapping the same PDF and drifting
 * into two divergent copies of one objectively-identical document.
 *
 * The per-office half of the relationship — the negotiated commission, the
 * named contacts, the credit terms — lives on `Insurer` and is scoped like any
 * other table, so nothing commercially sensitive is shared by this module.
 */
@Injectable()
export class InsurerMasterService {
  constructor(
    private readonly masters: InsurerMasterRepository,
    private readonly audit: AuditService,
    private readonly lines: InsuranceLineRepository,
  ) {}

  async list(): Promise<InsurerMasterView[]> {
    const rows = await this.masters.listMasters();
    return rows.map(deriveMasterView);
  }

  async get(id: string): Promise<InsurerMasterView> {
    const master = await this.masters.findMaster(id);
    if (!master) throw new NotFoundException('Insurer master not found');
    return deriveMasterView(master);
  }

  /**
   * Every mapped form for an insurer, newest version of each line first.
   *
   * No Organization filter, by design: this is the read that makes §5's promise
   * real — an office that has never touched this insurer still gets the mapping
   * someone else made.
   */
  async listForms(
    insurerMasterId: string,
    insuranceLineId?: string,
  ): Promise<InsurerFormTemplateView[]> {
    await this.get(insurerMasterId);
    // Validated even on a READ. A filter on an id that does not exist returns an empty list,
    // which reads as "nobody has mapped this line" when the truth is "that is not a line" —
    // two different answers the caller cannot tell apart.
    if (insuranceLineId !== undefined) {
      await this.assertGlobalLine(insuranceLineId);
    }
    const templates = await this.masters.listTemplates(
      insurerMasterId,
      insuranceLineId,
    );
    return templates.map(deriveTemplateView);
  }

  /**
   * The version an office should actually submit against for a given line, or
   * null when nobody has mapped this insurer+line yet.
   *
   * Null is a meaningful answer, not an error: §5 is explicit that when no form
   * has been mapped the submission falls back to the generic structured fields
   * already collected during Needs Assessment/RFQ, so there is never a case
   * where data has nowhere to go.
   */
  async currentForm(
    insurerMasterId: string,
    insuranceLineId: string,
  ): Promise<InsurerFormTemplateView | null> {
    const forms = await this.listForms(insurerMasterId, insuranceLineId);
    return forms[0] ?? null;
  }

  /**
   * Maps an insurer's form for one line. A second mapping of the same
   * insurer+line is a NEW version — never an edit of the one other offices are
   * already submitting against.
   */
  async mapForm(
    insurerMasterId: string,
    dto: MapInsurerFormDto,
    actorUserId: string,
  ): Promise<InsurerFormTemplateView> {
    await this.get(insurerMasterId);
    await this.assertGlobalLine(dto.insuranceLineId);

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

    const template = await this.masters.createNextVersion({
      insurerMasterId,
      insuranceLineId: dto.insuranceLineId,
      sourceDocumentRef: dto.sourceDocumentRef ?? null,
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

    // Audited even though the row itself is global: a mapping every office on
    // the platform will submit against is exactly the kind of change that needs
    // an attributable author.
    await this.audit.record({
      userId: actorUserId,
      action: 'CREATE',
      entityType: 'InsurerFormTemplate',
      entityId: template.id,
      afterValue: {
        insurerMasterId,
        insuranceLine: template.insuranceLine,
        version: template.version,
        fieldCount: template.fields.length,
      },
    });

    return deriveTemplateView(template);
  }

  /**
   * The line must exist AND be one of the 32 global ones.
   *
   * An office's own addition is refused with its own message rather than a generic "unknown
   * id", because the two are different problems and the second one is not the caller's fault:
   * the id IS real, they can see it in their own picker, and the reason it cannot be used here
   * is a tenancy property of this model that nothing on their screen explains.
   *
   * `InsurerFormTemplate` carries no `organizationId` — it hangs off `InsurerMaster`, so one
   * mapping is read by EVERY office. A row pointing at an `OfficeInsuranceLine` would put one
   * office's private vocabulary on a row the others read. The FK already makes that impossible;
   * this turns "impossible" into a sentence.
   */
  private async assertGlobalLine(insuranceLineId: string): Promise<void> {
    const [standard] = await this.lines.findStandardByIds([insuranceLineId]);
    if (standard !== undefined) return;

    const office = await this.lines.findOfficeLineById(insuranceLineId);
    if (office !== null) {
      throw new UnprocessableEntityException(
        `Insurance line "${office.nameEn}" is your office's own addition, and an insurer form mapping is read by every office on the platform — so it can only be mapped to a line from the shared catalogue. Pick one from GET /insurance-lines, or ask for this type to be added to the standard list.`,
      );
    }
    throw new UnprocessableEntityException(
      `Insurance line id does not exist: ${insuranceLineId}. Pick one from GET /insurance-lines.`,
    );
  }
}
