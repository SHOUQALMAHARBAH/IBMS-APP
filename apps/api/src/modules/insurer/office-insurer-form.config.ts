import type { OfficeFormTemplateWithFields } from '../../repositories/office-insurer-form.repository';
import type {
  InsurerFormFieldView,
  InsurerFormTemplateView,
} from './insurer-master.config';

/**
 * The line a form is for, in a shape that can name EITHER catalogue.
 *
 * `code` is `null` for an office's own addition — the same convention the insurer directory
 * uses for exactly the same reason: a code is platform-wide and an office cannot mint one, so
 * the absence of a code IS the fact that this line is local. A caller can therefore tell the
 * two apart without a second field saying which table it came from.
 */
export interface OfficeFormLineView {
  id: string;
  code: string | null;
  nameEn: string;
  nameAr: string;
}

export interface OfficeInsurerFormTemplateView {
  id: string;
  insurerId: string;
  insuranceLine: OfficeFormLineView;
  version: number;
  sourceDocumentRef: string | null;
  createdByUserId: string;
  fields: InsurerFormFieldView[];
}

/**
 * Which mapping a submission should be written against.
 *
 * `source` is not decoration. The two answers have different blast radii — editing the shared
 * one changes what every office on the platform submits, editing this office's own changes
 * nothing outside it — so a screen that renders a form has to be able to say which it is
 * showing. A caller that ignored the discriminator would show "edit" on a row it must not edit.
 */
export type ResolvedFormSource = 'OFFICE' | 'SHARED';

/**
 * The answer to "which mapping do I submit against".
 *
 * A DISCRIMINATED union: each arm pins `source` to its literal, so the template shape follows
 * from it — the two differ (`insurerId` vs `insurerMasterId`), and an arm typed with the shared
 * `ResolvedFormSource` would type-check while discriminating nothing, handing a caller that
 * narrowed on `source === 'OFFICE'` the union of both shapes anyway.
 *
 * Declared here beside the views rather than inline in the service, so the response shape has one
 * definition and the web client can import the same type the API returns.
 *
 * `null` is a real answer, not an error: §5 is explicit that an unmapped form falls back to the
 * generic structured fields already collected at Needs Assessment/RFQ.
 */
export type ResolvedOfficeForm =
  | { source: 'OFFICE'; template: OfficeInsurerFormTemplateView }
  | { source: 'SHARED'; template: InsurerFormTemplateView }
  | null;

export function deriveOfficeTemplateView(
  template: OfficeFormTemplateWithFields,
): OfficeInsurerFormTemplateView {
  // Exactly one is set — the database's `exactly_one_line` CHECK guarantees it. Branched on
  // WHICH relation rather than coalesced into one variable, because the two carry different
  // shapes: only the catalogue row has a `code`, and a `'code' in line` test would compile to
  // an `unknown` read. The branch is also the honest statement of what distinguishes them.
  const line =
    template.insuranceLine !== null
      ? {
          id: template.insuranceLine.id,
          code: template.insuranceLine.code,
          nameEn: template.insuranceLine.nameEn,
          nameAr: template.insuranceLine.nameAr,
        }
      : template.officeInsuranceLine !== null
        ? {
            id: template.officeInsuranceLine.id,
            // No code, and that absence IS the fact that this line is this office's own.
            code: null,
            nameEn: template.officeInsuranceLine.nameEn,
            nameAr: template.officeInsuranceLine.nameAr,
          }
        : null;
  if (line === null) {
    // Unreachable while the CHECK holds. Thrown rather than rendered as an empty line, because
    // a form whose line is unknown is a submission with no destination, and a view that
    // invented a placeholder would hide a constraint having been dropped.
    throw new Error(
      `OfficeInsurerFormTemplate ${template.id} names neither an insurance line nor an office line, which the exactly_one_line CHECK should make impossible.`,
    );
  }
  return {
    id: template.id,
    insurerId: template.insurerId,
    insuranceLine: line,
    version: template.version,
    sourceDocumentRef: template.sourceDocumentRef,
    createdByUserId: template.createdByUserId,
    fields: template.fields.map((f) => ({
      fieldKey: f.fieldKey,
      labelEn: f.labelEn,
      labelAr: f.labelAr,
      dataType: f.dataType,
      isRequired: f.isRequired,
      options: f.options,
      displayOrder: f.displayOrder,
    })),
  };
}
