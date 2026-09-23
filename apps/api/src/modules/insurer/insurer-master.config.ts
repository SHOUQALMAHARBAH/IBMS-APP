import type { InsurerFormFieldType } from '@ibms/db';
import type { FormTemplateWithFields } from '../../repositories/insurer-master.repository';

/** Part I §5 — an insurer's identity, shared by every office. */
export interface InsurerMasterView {
  id: string;
  legalName: string;
  legalNameAr: string | null;
  linesOffered: string[];
}

export interface InsurerFormFieldView {
  fieldKey: string;
  labelEn: string;
  labelAr: string | null;
  dataType: InsurerFormFieldType;
  isRequired: boolean;
  options: string[];
  displayOrder: number;
}

/** The managed line a form is for, named rather than echoed as a uuid. */
export interface InsurerFormLineView {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
}

export interface InsurerFormTemplateView {
  id: string;
  insurerMasterId: string;
  /** The line as an OBJECT, not a string. The old `insuranceLine: string` was free text the
   *  caller typed; a uuid in its place would be a worse answer than either, so the view names
   *  the line — code for machines, both languages for people. */
  insuranceLine: InsurerFormLineView;
  version: number;
  sourceDocumentRef: string | null;
  fields: InsurerFormFieldView[];
}

export function deriveMasterView(master: {
  id: string;
  legalName: string;
  legalNameAr: string | null;
  linesOffered: string[];
}): InsurerMasterView {
  return {
    id: master.id,
    legalName: master.legalName,
    legalNameAr: master.legalNameAr,
    linesOffered: master.linesOffered,
  };
}

export function deriveTemplateView(
  template: FormTemplateWithFields,
): InsurerFormTemplateView {
  return {
    id: template.id,
    insurerMasterId: template.insurerMasterId,
    insuranceLine: {
      id: template.insuranceLine.id,
      code: template.insuranceLine.code,
      nameEn: template.insuranceLine.nameEn,
      nameAr: template.insuranceLine.nameAr,
    },
    version: template.version,
    sourceDocumentRef: template.sourceDocumentRef,
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

/**
 * Part I §5 — "the first time anyone on the platform deals with a given
 * insurer+line combination", the form is mapped once. Which means a duplicate
 * `fieldKey` inside one mapping is not a harmless typo: two fields claiming the
 * same key make the submission ambiguous for every office that later renders
 * the form. The database refuses it too
 * (`@@unique([templateId, fieldKey])`); this is the early, legible rejection.
 */
export function duplicateFieldKeys(fields: { fieldKey: string }[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const { fieldKey } of fields) {
    const key = fieldKey.trim().toLowerCase();
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return [...duplicates].sort();
}

/** An ENUM field with no options is unrenderable — there is nothing to pick. */
export function enumFieldsMissingOptions(
  fields: {
    fieldKey: string;
    dataType: InsurerFormFieldType;
    options?: string[];
  }[],
): string[] {
  return fields
    .filter((f) => f.dataType === 'ENUM' && (f.options ?? []).length === 0)
    .map((f) => f.fieldKey)
    .sort();
}
