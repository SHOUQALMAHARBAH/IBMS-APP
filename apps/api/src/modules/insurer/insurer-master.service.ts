import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { InsurerMasterRepository } from '../../repositories/insurer-master.repository';
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
    insuranceLine?: string,
  ): Promise<InsurerFormTemplateView[]> {
    await this.get(insurerMasterId);
    const templates = await this.masters.listTemplates(
      insurerMasterId,
      insuranceLine,
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
    insuranceLine: string,
  ): Promise<InsurerFormTemplateView | null> {
    const forms = await this.listForms(insurerMasterId, insuranceLine);
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
      insuranceLine: dto.insuranceLine,
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
}
