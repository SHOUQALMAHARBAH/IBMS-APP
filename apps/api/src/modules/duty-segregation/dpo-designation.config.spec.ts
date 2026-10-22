import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UnprocessableEntityException } from '@nestjs/common';
import {
  combinedAssignmentPerson,
  combinedDeclarationRequired,
  resolveCombinedDeclaration,
} from './dpo-designation.config';

const MANAGER = 'أحمد محمد الحربي';
const SOMEBODY_ELSE = 'سارة خالد العبدالله';

describe('combinedAssignmentPerson', () => {
  it('names the person when both assignments are on one person', () => {
    expect(
      combinedAssignmentPerson({
        generalManagerName: MANAGER,
        dataProtectionOfficerName: MANAGER,
      }),
    ).not.toBeNull();
  });

  it('is null when the two assignments name different people', () => {
    expect(
      combinedAssignmentPerson({
        generalManagerName: MANAGER,
        dataProtectionOfficerName: SOMEBODY_ELSE,
      }),
    ).toBeNull();
  });

  /**
   * THE BRANCH A BARE `===` GETS WRONG, and the common case on every office that predates the
   * column: both unset. Two blanks are not one person — they are two facts nobody has recorded, and
   * a system that read them as a match would show the declaration to every office on the platform.
   */
  it('is null when the DPO designation is unset', () => {
    expect(
      combinedAssignmentPerson({
        generalManagerName: MANAGER,
        dataProtectionOfficerName: null,
      }),
    ).toBeNull();
  });

  it('is null when BOTH designations are unset', () => {
    expect(
      combinedAssignmentPerson({
        generalManagerName: null,
        dataProtectionOfficerName: null,
      }),
    ).toBeNull();
  });

  /**
   * A name made entirely of punctuation canonicalises to the EMPTY STRING — proven in
   * `company-name.util.spec.ts` — so without the empty-key guard two such entries would match each
   * other and an office could be shown a declaration about nobody.
   */
  it('is null when a designation canonicalises to nothing', () => {
    expect(
      combinedAssignmentPerson({
        generalManagerName: '--- ()',
        dataProtectionOfficerName: '--- ()',
      }),
    ).toBeNull();
  });

  /**
   * THE FOLD IS THE ESTABLISHED ONE, and this is what that buys: the same person typed with a
   * different alef and without the definite article is still the same person. Asserted so that
   * replacing `canonicalNameKey` with a plain comparison fails here rather than silently stopping
   * the declaration for every office that types a name twice.
   */
  it('folds Arabic orthography and the definite article, like every other name comparison here', () => {
    expect(
      combinedAssignmentPerson({
        generalManagerName: 'أحمد الحربي',
        dataProtectionOfficerName: 'احمد حربي',
      }),
    ).not.toBeNull();
  });
});

describe('combinedDeclarationRequired', () => {
  it('asks when the combination is new', () => {
    expect(
      combinedDeclarationRequired({
        generalManagerName: MANAGER,
        dataProtectionOfficerName: MANAGER,
        acknowledgedPerson: null,
      }),
    ).toBe(true);
  });

  it('does not ask again for the person already acknowledged', () => {
    const person = combinedAssignmentPerson({
      generalManagerName: MANAGER,
      dataProtectionOfficerName: MANAGER,
    });
    expect(
      combinedDeclarationRequired({
        generalManagerName: MANAGER,
        dataProtectionOfficerName: MANAGER,
        acknowledgedPerson: person,
      }),
    ).toBe(false);
  });

  /**
   * THE ASSERTION THAT MAKES "ASKED ONCE" HONEST RATHER THAN MERELY LIGHT.
   *
   * An office acknowledges the combination for person A, then assigns both functions to person B. If
   * the acknowledgement were a boolean, B's combination would be silent for ever and nobody at the
   * office would ever be told about it. The exposure is about a different person, so it asks again.
   */
  it('asks again when both assignments move to a DIFFERENT person', () => {
    const personA = combinedAssignmentPerson({
      generalManagerName: MANAGER,
      dataProtectionOfficerName: MANAGER,
    });
    expect(
      combinedDeclarationRequired({
        generalManagerName: SOMEBODY_ELSE,
        dataProtectionOfficerName: SOMEBODY_ELSE,
        acknowledgedPerson: personA,
      }),
    ).toBe(true);
  });

  it('does not ask when the two assignments are on different people', () => {
    expect(
      combinedDeclarationRequired({
        generalManagerName: MANAGER,
        dataProtectionOfficerName: SOMEBODY_ELSE,
        acknowledgedPerson: null,
      }),
    ).toBe(false);
  });

  /**
   * THE COMPLIANCE OFFICER MAY BE THE DPO AND IS NOT DECLARED ON — the adviser says no Jordanian
   * provision forbids it and that it is practised and accepted in small and medium offices.
   *
   * The behavioural half of that absence: the DPO is somebody other than the MANAGER, which is what
   * this function reads, so no declaration is owed however the compliance-officer designation reads.
   * The structural half is asserted below over the source.
   */
  it('does not ask when the DPO is somebody other than the manager, whoever else they also are', () => {
    expect(
      combinedDeclarationRequired({
        generalManagerName: MANAGER,
        dataProtectionOfficerName: SOMEBODY_ELSE,
        acknowledgedPerson: null,
      }),
    ).toBe(false);
  });
});

describe('resolveCombinedDeclaration', () => {
  const combined = {
    generalManagerName: MANAGER,
    dataProtectionOfficerName: MANAGER,
    acknowledgedPerson: null,
  };

  it('returns null — nothing to store — when no declaration is owed', () => {
    expect(
      resolveCombinedDeclaration(
        {
          generalManagerName: MANAGER,
          dataProtectionOfficerName: SOMEBODY_ELSE,
          acknowledgedPerson: null,
        },
        undefined,
      ),
    ).toBeNull();
  });

  it('refuses when the acknowledgement is missing', () => {
    expect(() => resolveCombinedDeclaration(combined, undefined)).toThrow(
      UnprocessableEntityException,
    );
  });

  it('refuses when the tick is absent even though a sentence was sent', () => {
    expect(() =>
      resolveCombinedDeclaration(combined, {
        noticeShown: 'a sentence',
        acknowledged: false,
      }),
    ).toThrow(UnprocessableEntityException);
  });

  /**
   * A tick with no sentence records that somebody acknowledged something, with no way to say what —
   * which is the "acknowledged means a box was ticked" failure the all-four-or-none CHECK and this
   * branch both exist to refuse.
   */
  it('refuses when the sentence shown is blank', () => {
    expect(() =>
      resolveCombinedDeclaration(combined, {
        noticeShown: '   ',
        acknowledged: true,
      }),
    ).toThrow(UnprocessableEntityException);
  });

  /**
   * THE REFUSAL IS ABOUT THE ACKNOWLEDGEMENT AND NEVER ABOUT THE ARRANGEMENT — both halves asserted
   * separately, because this is the clause a well-meaning reword deletes. A message that reads as
   * *you may not do this* would send an office of one person hunting for a second person who does
   * not exist, which is the thing the owner struck a hard block to prevent.
   */
  it('says the arrangement is permitted, and does not read as a refusal of it', () => {
    let thrown: unknown;
    try {
      resolveCombinedDeclaration(combined, undefined);
    } catch (err) {
      thrown = err;
    }
    const body = (thrown as UnprocessableEntityException).getResponse() as {
      code: string;
      message: string;
      person: string;
    };
    expect(body.code).toBe('DPO_MANAGER_COMBINED_DECLARATION_REQUIRED');
    expect(body.message).toContain('permitted');
    expect(body.message).toMatch(/nothing here refuses the arrangement/i);
    expect(body.message).not.toMatch(/not allowed|forbidden|may not hold/i);
    // AND IT DOES NOT ASK FOR A REASON. Deliberately lighter than decision 28: the reason is the
    // same every time, so a reason box becomes wallpaper. A reword that reintroduces one fails here.
    expect(body.message).not.toMatch(/reason of at least|write a reason/i);
    expect(body.person).not.toBe('');
  });

  it('returns the trimmed sentence and the person it was about', () => {
    const stored = resolveCombinedDeclaration(combined, {
      noticeShown: '  the sentence the office was shown  ',
      acknowledged: true,
    });
    expect(stored).not.toBeNull();
    expect(stored?.noticeShown).toBe('the sentence the office was shown');
    expect(stored?.person).toBe(
      combinedAssignmentPerson({
        generalManagerName: MANAGER,
        dataProtectionOfficerName: MANAGER,
      }),
    );
  });
});

/**
 * THE STRUCTURAL HALF OF THE COMPLIANCE-OFFICER ABSENCE.
 *
 * An absence is the only form of this that can fail. The behavioural test above passes against an
 * implementation that ALSO declared on the compliance-officer pairing, because that pairing is not
 * one of its inputs — so the assertion that matters is that the compliance-officer designation is
 * not read here at all.
 */
describe('the compliance-officer pairing is not declared on', () => {
  const HERE = join(__dirname, 'dpo-designation.config.ts');

  it('the config never reads the compliance-officer designation', () => {
    const source = readFileSync(HERE, 'utf8');
    // Comments stripped: this file EXPLAINS the exclusion at length, and the recorded lesson from
    // `check:seed-sweeps` is that a model named only in a comment must not read as used.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/complianceOfficer/);
    // Non-vacuity: the stripper must not have eaten the file. Without this the assertion above
    // passes on an empty string, which is the floor three of this repository's guards have needed.
    expect(code).toMatch(/combinedAssignmentPerson/);
    expect(code).toMatch(/canonicalNameKey/);
  });
});
