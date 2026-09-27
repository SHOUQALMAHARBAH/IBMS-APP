import { UnprocessableEntityException } from '@nestjs/common';
import { assertDifferentActors } from '../../common/maker-checker.util';
import { COMBINED_DUTY_REASON_MIN_LENGTH } from './duty-segregation.service';
import type {
  DutySegregationService,
  ResolveDutySegregationInput,
} from './duty-segregation.service';

/**
 * A `DutySegregationService` standing in for a SEGREGATED office — which every office is, and which is the
 * only mode the unit tests of the fifteen maker/checker pairs are about.
 *
 * ## Why this is shared rather than written per spec
 *
 * Fifteen service specs need this double. A hand-written `{ resolve: vi.fn().mockResolvedValue(null) }` in
 * each of them would be fifteen mocks that PERMIT a self-approval — and every one of those files contains a
 * test asserting that a self-approval is refused. Those tests would keep passing, on the mock rather than on
 * the code, and that is § 1.51(d) with the guard and the double swapped: the assertion could no longer observe
 * the thing it exists to check.
 *
 * So the double refuses exactly as the real service does in a segregated office — through the same
 * `assertDifferentActors`, which is still the refusal — and returns null otherwise. The combined path is
 * covered where it belongs: `duty-segregation.service.spec.ts` for the engine, and
 * `duty-segregation-combined.e2e-spec.ts` against a real office that has declared the mode.
 */
export function segregatedOfficeDutySegregation(): DutySegregationService {
  return {
    resolve: (input: ResolveDutySegregationInput) => {
      if (input.checkerId != null && input.checkerId === input.makerId) {
        assertDifferentActors(
          input.makerId,
          input.checkerId,
          input.context,
          input.constraint,
        );
      }
      // A resolved promise, not a bare value: the real engine is async, and a synchronous double would let a
      // missing `await` at a call site pass here and fail in production.
      return Promise.resolve(null);
    },
  } as unknown as DutySegregationService;
}

/**
 * A `DutySegregationService` standing in for an office that HAS declared COMBINED, returning a fixed act id.
 *
 * Added for `AccessRecertificationItem`, the one pair whose combined path a unit test can reach usefully:
 * its act is written during `startCycle`, so whether the item is created at all depends on the engine's
 * answer. For the other fourteen the combined path is a repository write and belongs in the e2e.
 *
 * It still refuses a reason below the floor, because a double that accepts anything would let a call site
 * forget to pass the reason and keep passing here.
 */
export function combinedOfficeDutySegregation(
  actId = 'combined-duty-act-1',
): DutySegregationService {
  return {
    resolve: (input: ResolveDutySegregationInput) => {
      if (input.checkerId == null || input.checkerId !== input.makerId) {
        return Promise.resolve(null);
      }
      const reason = (input.reason ?? '').trim();
      if (reason.length < COMBINED_DUTY_REASON_MIN_LENGTH) {
        return Promise.reject(
          new UnprocessableEntityException(
            `${input.context}: performing both halves yourself requires a reason of at least ${COMBINED_DUTY_REASON_MIN_LENGTH} characters.`,
          ),
        );
      }
      return Promise.resolve(actId);
    },
  } as unknown as DutySegregationService;
}
