import { describe, expect, it } from 'vitest';
import {
  canonicalKeysFor,
  officeLineView,
  pickableLines,
  standardLineColliding,
  standardLineView,
} from './insurance-line.config';
import type {
  OfficeLineRow,
  StandardLineRow,
} from '../../repositories/insurance-line.repository';

/**
 * The insurance-line vocabulary — the rules that decide whether an addition is a new
 * type or a second name for one that already exists.
 *
 * The collision check is the one that matters. A managed list whose duplicate
 * detection can be walked around is a free-text field with extra steps.
 */

const MOTOR_TPL: StandardLineRow = {
  id: 'std-motor-tpl',
  code: 'MOTOR_TPL_COMPULSORY',
  nameEn: 'Motor Third-Party Liability (Compulsory)',
  nameAr: 'تأمين المركبات الإلزامي (ضد الغير)',
  category: 'GENERAL',
  displayOrder: 0,
};
const MOTOR_COMPREHENSIVE: StandardLineRow = {
  id: 'std-motor-comp',
  code: 'MOTOR_COMPREHENSIVE',
  nameEn: 'Motor Comprehensive',
  nameAr: 'تأمين المركبات الشامل',
  category: 'GENERAL',
  displayOrder: 1,
};
const INDIVIDUAL_LIFE: StandardLineRow = {
  id: 'std-life-individual',
  code: 'LIFE_INDIVIDUAL',
  nameEn: 'Individual Life',
  nameAr: 'تأمين الحياة الفردي',
  category: 'LIFE',
  displayOrder: 27,
};
const STANDARD = [MOTOR_TPL, MOTOR_COMPREHENSIVE, INDIVIDUAL_LIFE];

const OFFICE_PET: OfficeLineRow = {
  id: 'office-pet',
  nameEn: 'Pet',
  nameAr: 'تأمين الحيوانات الأليفة',
  category: 'GENERAL',
  canonicalEn: 'pet',
  canonicalAr: 'اليفه حيوانات تامين',
  createdAt: new Date('2026-09-20T00:00:00.000Z'),
};

describe('standardLineColliding — an addition that already exists', () => {
  it('catches an exact standard name in either script', () => {
    expect(
      standardLineColliding(
        STANDARD,
        canonicalKeysFor({
          nameEn: 'Motor Comprehensive',
          nameAr: 'something else entirely',
        }),
      ),
    ).toBe(MOTOR_COMPREHENSIVE);
    // EITHER script, because somebody adding a line usually types one name
    // carefully and the other casually. A collision in one language is still a
    // duplicate.
    expect(
      standardLineColliding(
        STANDARD,
        canonicalKeysFor({
          nameEn: 'Totally New Product',
          nameAr: 'تأمين المركبات الشامل',
        }),
      ),
    ).toBe(MOTOR_COMPREHENSIVE);
  });

  it('catches a spelling variant, which is the point of comparing canonical keys', () => {
    // Dropped article, no hamza, different word order — three ways to type the same
    // line, none of which should create a second entry.
    for (const nameAr of [
      'تأمين مركبات شامل',
      'تامين المركبات الشامل',
      'الشامل المركبات تأمين',
    ]) {
      expect(
        standardLineColliding(
          STANDARD,
          canonicalKeysFor({ nameEn: 'unrelated english', nameAr }),
        ),
        `"${nameAr}" should collide with Motor Comprehensive`,
      ).toBe(MOTOR_COMPREHENSIVE);
    }
  });

  it('lets a genuinely new type through', () => {
    expect(
      standardLineColliding(
        STANDARD,
        canonicalKeysFor({ nameEn: 'Pet', nameAr: 'تأمين الحيوانات الأليفة' }),
      ),
    ).toBeNull();
  });

  it('does NOT catch a synonym — the gap a similarity layer still has to close', () => {
    // "سيارات شامل" means comprehensive motor cover and shares no word with
    // "تأمين المركبات الشامل". This is the documented limit: the canonical key is the
    // exact guarantee that can be a unique index, and "did you mean …?" is a layer on
    // top of it. A test asserting otherwise would be asserting a thing that is false.
    expect(
      standardLineColliding(
        STANDARD,
        canonicalKeysFor({ nameEn: 'Cars Full', nameAr: 'سيارات شامل' }),
      ),
    ).toBeNull();
  });
});

describe('pickableLines — what an office picks from', () => {
  it('lists the standard lines first, then this office additions', () => {
    const lines = pickableLines(STANDARD, [OFFICE_PET]);
    expect(lines.map((l) => l.code)).toEqual([
      'MOTOR_TPL_COMPULSORY',
      'MOTOR_COMPREHENSIVE',
      'LIFE_INDIVIDUAL',
      null,
    ]);
    // Standard order is preserved as given — market order, which is neither
    // alphabetical nor by code. Sorting the merged list would destroy the grouping
    // `displayOrder` exists to carry.
    expect(lines.at(-1)).toMatchObject({ nameEn: 'Pet', isStandard: false });
  });

  it('works for an office that has added nothing', () => {
    expect(pickableLines(STANDARD, [])).toHaveLength(3);
  });
});

describe('the two views', () => {
  it('gives a standard line its code and marks it standard', () => {
    expect(standardLineView(MOTOR_TPL)).toEqual({
      id: 'std-motor-tpl',
      code: 'MOTOR_TPL_COMPULSORY',
      nameEn: 'Motor Third-Party Liability (Compulsory)',
      nameAr: 'تأمين المركبات الإلزامي (ضد الغير)',
      category: 'GENERAL',
      isStandard: true,
    });
  });

  it('gives an office addition a NULL code, and never exposes its canonical keys', () => {
    // A code is a platform-wide identifier: two offices inventing `PET` for
    // different things would make every report that groups by code wrong. The
    // canonical keys are an internal dedupe value a client cannot recompute, so
    // exposing them would invite a client to match on them.
    const view = officeLineView(OFFICE_PET);
    expect(view.code).toBeNull();
    expect(view.isStandard).toBe(false);
    expect(Object.keys(view).sort()).toEqual([
      'category',
      'code',
      'id',
      'isStandard',
      'nameAr',
      'nameEn',
    ]);
  });
});
