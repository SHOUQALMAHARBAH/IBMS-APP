import { describe, expect, it } from 'vitest';
import {
  deriveRegistrationPackState,
  REGISTRATION_PACK_DOCUMENTS,
  REGISTRATION_PACK_FORBIDDEN_WORDS,
} from './registration-pack.config';

/**
 * MODULE 0-ب, DECISION 88 — the derived registration pack.
 *
 * A pure spec, because the four states are chosen inputs and db-test holds one office with neither
 * document: an e2e over it could reach exactly one of the four.
 */

describe('what we hold, derived', () => {
  it('names BOTH when we hold neither — and names them, never counts them', () => {
    /*
     * "missing: lease contract or title deed", never "2 documents missing". The count asserts the
     * wrong thing — standing verification rule 2 — and it also tells a reader nothing they can act
     * on, because the two documents come from different places and different people.
     */
    const state = deriveRegistrationPackState({
      premisesTenureDocumentId: null,
      associationMembershipDocumentId: null,
    });
    expect(state.missing).toEqual(['premisesTenure', 'associationMembership']);
    expect(state.complete).toBe(false);
  });

  it('names the REMAINING one alone once the first arrives', () => {
    const state = deriveRegistrationPackState({
      premisesTenureDocumentId: 'doc-1',
      associationMembershipDocumentId: null,
    });
    expect(state.missing).toEqual(['associationMembership']);
    expect(state.complete).toBe(false);
  });

  it('and the other way round — so the order is the ARTICLE’s, not insertion', () => {
    // Both single-document cases, because a derivation that simply returned the second key would
    // pass the test above.
    const state = deriveRegistrationPackState({
      premisesTenureDocumentId: null,
      associationMembershipDocumentId: 'doc-2',
    });
    expect(state.missing).toEqual(['premisesTenure']);
  });

  it('is COMPLETE, and names nothing, once we hold both', () => {
    const state = deriveRegistrationPackState({
      premisesTenureDocumentId: 'doc-1',
      associationMembershipDocumentId: 'doc-2',
    });
    expect(state.missing).toEqual([]);
    expect(state.complete).toBe(true);
  });

  it('derives `complete` FROM `missing`, so the two cannot disagree', () => {
    // Not a tautology: a second stored field beside the list is exactly how a summary drifts from the
    // thing it summarises, which is why there is no completeness column either.
    for (const premisesTenureDocumentId of [null, 'doc-1']) {
      for (const associationMembershipDocumentId of [null, 'doc-2']) {
        const state = deriveRegistrationPackState({
          premisesTenureDocumentId,
          associationMembershipDocumentId,
        });
        expect(state.complete).toBe(state.missing.length === 0);
      }
    }
  });
});

describe('the clause that matters most', () => {
  it('the forbidden-word list covers both languages and is not empty', () => {
    /*
     * The marker may never say or imply that the office fails art. 10/a. This list is that clause in
     * the only form that can fail a build, and an empty or English-only list would make the screen
     * assertions that use it vacuous — on an Arabic-first platform, the Arabic half is the half that
     * reaches the reader.
     */
    expect(REGISTRATION_PACK_FORBIDDEN_WORDS.length).toBeGreaterThan(8);
    const arabic = REGISTRATION_PACK_FORBIDDEN_WORDS.filter((w) =>
      /[؀-ۿ]/.test(w),
    );
    expect(arabic.length).toBeGreaterThan(3);
  });

  it('the two documents carry their ARTICLE, so a marker can cite rather than assert', () => {
    expect(REGISTRATION_PACK_DOCUMENTS.map((d) => d.article)).toEqual([
      'art. 10/a/2',
      'art. 10/a/3',
    ]);
  });
});
