import { describe, expect, it } from 'vitest';
import {
  deriveMasterView,
  deriveTemplateView,
  duplicateFieldKeys,
  enumFieldsMissingOptions,
} from './insurer-master.config';

describe('duplicateFieldKeys', () => {
  it('accepts a mapping whose keys are all distinct', () => {
    expect(
      duplicateFieldKeys([
        { fieldKey: 'insured_full_name' },
        { fieldKey: 'sum_insured' },
      ]),
    ).toEqual([]);
  });

  it('names every repeated key', () => {
    expect(
      duplicateFieldKeys([
        { fieldKey: 'a' },
        { fieldKey: 'b' },
        { fieldKey: 'a' },
        { fieldKey: 'b' },
      ]),
    ).toEqual(['a', 'b']);
  });

  it('treats keys differing only by case or padding as the same key', () => {
    // Two fields that render as one column are ambiguous for every office that
    // later submits against this form — the difference is invisible on screen.
    expect(
      duplicateFieldKeys([
        { fieldKey: 'Sum_Insured' },
        { fieldKey: '  sum_insured ' },
      ]),
    ).toEqual(['sum_insured']);
  });
});

describe('enumFieldsMissingOptions', () => {
  it('rejects an ENUM field with nothing to pick from', () => {
    expect(
      enumFieldsMissingOptions([
        { fieldKey: 'cover_type', dataType: 'ENUM', options: [] },
      ]),
    ).toEqual(['cover_type']);
  });

  it('rejects an ENUM field with no options key at all', () => {
    expect(
      enumFieldsMissingOptions([{ fieldKey: 'cover_type', dataType: 'ENUM' }]),
    ).toEqual(['cover_type']);
  });

  it('leaves non-ENUM fields alone even with no options', () => {
    expect(
      enumFieldsMissingOptions([
        { fieldKey: 'insured_full_name', dataType: 'TEXT', options: [] },
        { fieldKey: 'sum_insured', dataType: 'NUMBER' },
        { fieldKey: 'start_date', dataType: 'DATE' },
        { fieldKey: 'is_renewal', dataType: 'BOOLEAN' },
      ]),
    ).toEqual([]);
  });

  it('accepts an ENUM that does offer options', () => {
    expect(
      enumFieldsMissingOptions([
        {
          fieldKey: 'cover_type',
          dataType: 'ENUM',
          options: ['COMPREHENSIVE', 'THIRD_PARTY'],
        },
      ]),
    ).toEqual([]);
  });
});

describe('deriveMasterView', () => {
  it('carries the Arabic legal name through', () => {
    // The platform's primary language is Arabic, so dropping this field would
    // leave the main display name empty for the main audience.
    expect(
      deriveMasterView({
        id: 'm1',
        legalName: 'AIG Jordan',
        legalNameAr: 'الشركة الأردنية للتأمين',
        linesOffered: ['MOTOR'],
      }),
    ).toEqual({
      id: 'm1',
      legalName: 'AIG Jordan',
      legalNameAr: 'الشركة الأردنية للتأمين',
      linesOffered: ['MOTOR'],
    });
  });

  it('keeps a null Arabic name null rather than inventing one', () => {
    expect(
      deriveMasterView({
        id: 'm2',
        legalName: 'Some Insurer',
        legalNameAr: null,
        linesOffered: [],
      }).legalNameAr,
    ).toBeNull();
  });
});

describe('deriveTemplateView', () => {
  it('exposes every mapped field, including the Arabic label', () => {
    const view = deriveTemplateView({
      id: 't1',
      insurerMasterId: 'm1',
      insuranceLine: 'MOTOR',
      version: 2,
      sourceDocumentRef: 'aig-motor-2026.pdf',
      createdAt: new Date('2026-09-12T00:00:00.000Z'),
      fields: [
        {
          id: 'f1',
          templateId: 't1',
          fieldKey: 'insured_full_name',
          labelEn: 'Insured full name',
          labelAr: 'اسم المؤمن له',
          dataType: 'TEXT',
          isRequired: true,
          options: [],
          displayOrder: 0,
        },
      ],
    });

    expect(view).toEqual({
      id: 't1',
      insurerMasterId: 'm1',
      insuranceLine: 'MOTOR',
      version: 2,
      sourceDocumentRef: 'aig-motor-2026.pdf',
      fields: [
        {
          fieldKey: 'insured_full_name',
          labelEn: 'Insured full name',
          labelAr: 'اسم المؤمن له',
          dataType: 'TEXT',
          isRequired: true,
          options: [],
          displayOrder: 0,
        },
      ],
    });
  });

  it('does not leak the row ids of the mapped fields', () => {
    // `fieldKey` is the stable identifier a submission is written against; the
    // row id is an implementation detail that would invite callers to key on it.
    const view = deriveTemplateView({
      id: 't1',
      insurerMasterId: 'm1',
      insuranceLine: 'MOTOR',
      version: 1,
      sourceDocumentRef: null,
      createdAt: new Date(),
      fields: [
        {
          id: 'f1',
          templateId: 't1',
          fieldKey: 'k',
          labelEn: 'K',
          labelAr: null,
          dataType: 'TEXT',
          isRequired: false,
          options: [],
          displayOrder: 0,
        },
      ],
    });
    expect(view.fields[0]).not.toHaveProperty('id');
    expect(view.fields[0]).not.toHaveProperty('templateId');
  });
});
