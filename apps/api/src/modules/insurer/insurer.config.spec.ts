import { describe, expect, it } from 'vitest';
import {
  auditDelta,
  collisionMessage,
  deriveInsurerView,
  resolveIdentityPath,
} from './insurer.config';
import type { InsurerRecord } from '../../repositories/insurer.repository';

/** The refusal text, or a failure if the body was accepted. Typed, so each
 *  assertion below reads the message rather than an `any`. */
function refusalFrom(result: ReturnType<typeof resolveIdentityPath>): string {
  if (!('error' in result)) {
    throw new Error(`expected a refusal, got the ${result.path} path`);
  }
  return result.error;
}

/**
 * Insurer management — the rules a registration body has to satisfy, tested
 * without a database.
 *
 * Two of these decide what a person is told when they get it wrong, which is the
 * reason they are pure functions rather than decorators: "invalid" is not an
 * actionable message for a body that can be wrong in three distinct ways.
 */

const LINKED: InsurerRecord = {
  id: 'ins-linked',
  insurerMasterId: 'master-1',
  insurerMaster: { legalName: 'AIG Jordan', legalNameAr: 'إي آي جي الأردن' },
  legalName: null,
  legalNameAr: null,
  isActive: true,
  linesOffered: ['Motor'],
  financialStrengthRating: 'A-',
  creditTermsDays: 30,
  rfqContactName: 'Dana Qasem',
  rfqContactEmail: 'dana@example.test',
  rfqContactPhone: '+962 6 500 1000',
  claimsContactName: null,
  claimsContactEmail: null,
  underwriterContact: null,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
};

const LOCAL: InsurerRecord = {
  ...LINKED,
  id: 'ins-local',
  insurerMasterId: null,
  insurerMaster: null,
  legalName: 'Wadi Rum Mutual',
  legalNameAr: 'وادي رم التعاونية',
};

describe('resolveIdentityPath — which registration path a body asked for', () => {
  it('takes a catalogue id alone as the MASTER path', () => {
    expect(resolveIdentityPath({ insurerMasterId: 'master-1' })).toEqual({
      path: 'MASTER',
      insurerMasterId: 'master-1',
    });
  });

  it('takes both names as the LOCAL path', () => {
    expect(
      resolveIdentityPath({
        legalName: 'Wadi Rum Mutual',
        legalNameAr: 'وادي رم التعاونية',
      }),
    ).toEqual({
      path: 'LOCAL',
      legalName: 'Wadi Rum Mutual',
      legalNameAr: 'وادي رم التعاونية',
    });
  });

  it('refuses a body carrying BOTH, and says which one wins if you pick', () => {
    // Not a pedantic refusal: a row may legally carry both columns, and
    // `insurerIdentity` resolves master-first — so accepting both would silently
    // discard the name the caller typed. Refusing is the only honest answer.
    const result = resolveIdentityPath({
      insurerMasterId: 'master-1',
      legalName: 'Something Else',
    });
    expect(refusalFrom(result)).toContain('not both');
  });

  it('refuses a body with neither, naming both paths', () => {
    const refusal = refusalFrom(resolveIdentityPath({}));
    expect(refusal).toContain('insurerMasterId');
    expect(refusal).toContain('legalNameAr');
  });

  it('refuses a Latin name with no Arabic one', () => {
    // Arabic is this system's primary language and an insurer's name reaches
    // documents a client reads. The same rule `Role.nameAr` enforces.
    expect(
      refusalFrom(resolveIdentityPath({ legalName: 'Wadi Rum Mutual' })),
    ).toContain('Both legalName and legalNameAr');
  });

  it('refuses an Arabic name with no Latin one', () => {
    // The mirror case, and it has to be checked separately: a body carrying only
    // `legalNameAr` has a local name present, so the "neither" branch does not
    // catch it.
    expect(
      refusalFrom(resolveIdentityPath({ legalNameAr: 'وادي رم التعاونية' })),
    ).toContain('Both legalName');
  });
});

describe('deriveInsurerView', () => {
  it('reads a catalogue-linked row from the catalogue, and marks it not local', () => {
    const view = deriveInsurerView(LINKED);
    expect(view.name).toBe('AIG Jordan');
    expect(view.nameAr).toBe('إي آي جي الأردن');
    expect(view.isOfficeLocal).toBe(false);
    expect(view.insurerMasterId).toBe('master-1');
  });

  it('reads an office-local row from its own columns', () => {
    const view = deriveInsurerView(LOCAL);
    expect(view.name).toBe('Wadi Rum Mutual');
    expect(view.isOfficeLocal).toBe(true);
    expect(view.insurerMasterId).toBeNull();
  });

  it('decides isOfficeLocal from the LINK, not from whether a local name exists', () => {
    // A row carrying both is not refused by the database, and `insurerIdentity`
    // resolves its name from the master. If `isOfficeLocal` were derived from the
    // presence of `legalName` instead, the screen would offer to edit a name the
    // API then refuses to change — the two answers have to come from one fact.
    const both = { ...LINKED, legalName: 'Stale Local Copy' };
    expect(deriveInsurerView(both).isOfficeLocal).toBe(false);
    expect(deriveInsurerView(both).name).toBe('AIG Jordan');
  });

  it('carries the relationship fields through', () => {
    const view = deriveInsurerView(LINKED);
    expect(view.creditTermsDays).toBe(30);
    expect(view.rfqContactEmail).toBe('dana@example.test');
    expect(view.financialStrengthRating).toBe('A-');
    expect(view.isActive).toBe(true);
  });
});

/**
 * There is deliberately no test here for classifying a collision FROM the Prisma
 * error, because that cannot be done: `meta.target` comes back `null` on this
 * codebase's write path for both of the constraints involved. The kind is decided
 * by the write path instead — see `InsurerService.asCollision`, and the unique-index
 * inventory in `insurer-schema-constraints.e2e-spec.ts` that keeps that exhaustive.
 */
describe('collisionMessage', () => {
  it('names the insurer and points at reactivation, because there is no delete', () => {
    const message = collisionMessage('LOCAL_NAME', 'Wadi Rum Mutual');
    expect(message).toContain('Wadi Rum Mutual');
    expect(message).toContain('reactivate');
  });

  it('says one set of terms per company for a catalogue collision', () => {
    expect(collisionMessage('MASTER_LINK', '')).toContain(
      'already has a relationship',
    );
  });
});

describe('auditDelta — what an UPDATE actually changed', () => {
  it('records only the fields whose value moved', () => {
    const delta = auditDelta(LINKED, {
      creditTermsDays: 45,
      // Resent unchanged. A trail claiming this was edited would be false.
      rfqContactEmail: 'dana@example.test',
    });
    expect(delta.changed).toEqual(['creditTermsDays']);
    expect(delta.before).toEqual({ creditTermsDays: 30 });
    expect(delta.after).toEqual({ creditTermsDays: 45 });
  });

  it('records a previously-null field as null rather than omitting it', () => {
    const delta = auditDelta(LINKED, { claimsContactName: 'Rami Odeh' });
    expect(delta.before).toEqual({ claimsContactName: null });
    expect(delta.after).toEqual({ claimsContactName: 'Rami Odeh' });
  });

  it('ignores undefined, so an absent PATCH key is not a change', () => {
    expect(auditDelta(LINKED, { creditTermsDays: undefined }).changed).toEqual(
      [],
    );
  });

  it('reports nothing for an empty patch', () => {
    expect(auditDelta(LINKED, {}).changed).toEqual([]);
  });

  it('records the full value rather than a redaction', () => {
    // Nothing on an insurer relationship is Highly Confidential under Part 10.2.
    // A trail recording that a credit term moved without recording what it moved
    // from answers none of the questions it exists for.
    const delta = auditDelta(LINKED, { creditTermsDays: 0 });
    expect(delta.after.creditTermsDays).toBe(0);
  });
});
