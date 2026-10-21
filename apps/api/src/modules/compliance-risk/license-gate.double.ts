import { UnprocessableEntityException } from '@nestjs/common';
import type { DerivedLicenseStanding } from './license-standing.config';
import {
  refusal,
  type LicenceGatedAct,
  type LicenseGateService,
} from './license-gate.service';

/**
 * A `LicenseGateService` standing in for an office that MAY practise — which is the state every
 * existing service spec is about.
 *
 * ## WHY THIS IS SHARED RATHER THAN WRITTEN PER SPEC
 *
 * Four service specs need it today (renewal, RFQ, recommendation, endorsement) and a fifth builds
 * the real gate over its own licence mock (`policy.service.spec.ts`, which has licence assertions of
 * its own and must keep exercising the real derivation).
 *
 * A hand-written `{ assertMayPractise: vi.fn() }` in each would be four mocks that PERMIT every act
 * — correct today, because none of those files asserts anything about the licence, and a trap the
 * moment one does. That is the `duty-segregation.double.ts` lesson with the names changed: fifteen
 * permissive mocks would have left fifteen self-approval assertions passing on the mock rather than
 * on the code.
 *
 * So the permitting double is named for what it stands in for, and its refusing sibling exists
 * beside it — through the REAL `refusal()`, so a spec that wants the refused path gets the actual
 * sentence rather than an approximation of it.
 */
export function licensedOffice(): LicenseGateService {
  const standing: DerivedLicenseStanding = {
    status: 'ACTIVE',
    mayPractise: true,
    standingActDecisionRef: null,
    deemedCancelledUnderArticle14C: false,
  };
  return {
    // Resolved promises, not bare values: the real engine is async, and a synchronous double would
    // let a missing `await` at a call site pass here and fail in production.
    standing: () => Promise.resolve(standing),
    assertMayPractise: () => Promise.resolve(),
  } as unknown as LicenseGateService;
}

/**
 * The refusing sibling — an office that may NOT practise, in one of the four blocking states.
 *
 * It throws through the real `refusal()`, so a spec asserting the message is asserting the shipped
 * wording. `standingActDecisionRef` defaults to null, which is the state a suspension recorded
 * without a CBJ reference is in and the one the derivation calls "the finding".
 */
export function unlicensedOffice(
  status: 'NO_TERM_ON_RECORD' | 'EXPIRED' | 'SUSPENDED' | 'CANCELLED',
  over: Partial<DerivedLicenseStanding> = {},
): LicenseGateService {
  const standing: DerivedLicenseStanding = {
    status,
    mayPractise: false,
    standingActDecisionRef: null,
    deemedCancelledUnderArticle14C: false,
    ...over,
  };
  return {
    standing: () => Promise.resolve(standing),
    assertMayPractise: (act: LicenceGatedAct) =>
      Promise.reject(new UnprocessableEntityException(refusal(act, standing))),
  } as unknown as LicenseGateService;
}
