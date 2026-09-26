import { assertDifferentActors } from '../../common/maker-checker.util';
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
