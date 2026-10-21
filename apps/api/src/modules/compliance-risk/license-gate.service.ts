import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { BrokerLicenseRepository } from '../../repositories/broker-license.repository';
import { RegulatoryActionRepository } from '../../repositories/regulatory-action.repository';
import { pickCurrentTerm } from './broker-license.config';
import {
  deriveLicenseStanding,
  type DerivedLicenseStanding,
} from './license-standing.config';

/**
 * MAY THIS OFFICE PRACTISE — ONE ANSWER, AND THE GATE USES IT.
 *
 * ## WHAT WAS WRONG: THREE ANSWERS, AND ONLY THE NARROWEST ONE ENFORCED
 *
 * MEASURED before this existed:
 *
 *   (a) `deriveLicenseStanding` — decision 71's SIX states, with `mayPractise` beside them — had
 *       **zero non-spec consumers**. The considered answer was used nowhere that enforces.
 *   (b) `PolicyService.assertLicenseNotLapsed` computed its own, from `pickCurrentTerm` plus
 *       `isBrokerLicenseCurrentlyLapsed`, and was PRIVATE with exactly ONE caller — the
 *       policy-creation path at `policy.service.ts:553`. Every other art. 21/a/9 occurrence in the
 *       tree is a comment, a display string or the provider dashboard's wording.
 *   (c) `BrokerLicense.status`, a stored two-value column, against the derivation's six.
 *
 * Three answers to one question, and the copy is the one that drifts. The consequence was concrete
 * and is the reason this batch exists: **a CBJ SUSPENSION did not block anything.** The derivation
 * knew about it; the gate never asked.
 *
 * ## WHY A `@Global()` SERVICE, WHICH THIS PROJECT OTHERWISE AVOIDS
 *
 * Services are not shared here — repositories are. The two standing exceptions are both ENGINES
 * that every call site must pass through: `WorkflowTransitionService`, because every status change
 * must go through one implementation, and `DutySegregationService`, whose module says it plainly —
 * *"the alternative — each module injecting three repositories and calling a free function — puts
 * the mode read, the reason check and the act write in fourteen places, which is exactly what this
 * exists to prevent."*
 *
 * "Is this office licensed" is that shape. Six acts in five modules must refuse, and the brief's own
 * instruction is ONE GATE, NOT FIVE COPIES — five private copies would be five answers to one
 * question, which is the defect above reproduced on a larger surface. The pure derivation stays
 * where it is and is still unit-testable without a database; what lives here is the READ and the
 * REFUSAL, which are the two things that would otherwise be duplicated.
 *
 * ## TWO PROPERTIES OF THE OLD GATE SURVIVE, AND BOTH ARE DELIBERATE
 *
 *   1. **The LATEST term decides, not the one covering today.** Between filing a renewal (art. 11,
 *      45 days before expiry) and the old term running out, an office legitimately holds two, and
 *      the newer one says whether it may practise. `pickCurrentTerm` is that reading and is reused
 *      rather than re-derived.
 *   2. **It is a LIVE RECOMPUTE, never a stored-flag read.** The block is correct the INSTANT
 *      `expiresAt` passes, rather than after a sweep has run. Nothing is cached here and nothing
 *      should be: a cached answer is a fourth answer.
 *
 * `license-gate.inventory.spec.ts` asserts both, because a later edit that reached for a stored
 * column or for "the term covering today" would look tidier and be wrong.
 *
 * ## AND THE MECHANISM THAT LIFTS THE BLOCK WAS ALREADY THE MECHANISM
 *
 * `BrokerLicense.certificateDocumentId` is NOT NULL, so recording the new term WITH its certificate
 * is what makes the office practising again — there is no separate "unblock" act and there must not
 * be one. This batch widens that; it does not invent it.
 */

/**
 * THE ACTS THIS GATE REFUSES — a closed list, so the refusal can NAME the act and the set is
 * auditable from one place.
 *
 * ز.١, measured against the code: `PLACE_POLICY` was the only one enforced. The other five are what
 * this batch adds.
 */
export const LICENCE_GATED_ACTS = {
  PLACE_POLICY: 'placing new business',
  RENEW_POLICY: 'renewing a policy',
  REQUEST_QUOTES: 'sending a new quote request to insurers',
  ISSUE_RECOMMENDATION: 'issuing a recommendation to the customer',
  INCREASE_COVER: 'applying an endorsement that increases cover',
  ISSUE_CERTIFICATE: 'issuing an insurance certificate',
} as const;

export type LicenceGatedAct = keyof typeof LICENCE_GATED_ACTS;

/**
 * WHAT IS DELIBERATELY NOT HERE — ز.٢, and the omission is as load-bearing as the list above.
 *
 * The owner's words: «في عندو حسابات مفتوحة ومصاري لسا مش مسدَّدة بده يكمّلها وهذا حقّه». An office
 * whose licence has ended keeps the right to finish what it already has, so NONE of these is gated:
 *
 *   - collection and remittance on existing policies;
 *   - claims in full — logging, following, settling;
 *   - an endorsement that REDUCES cover, and a cancellation;
 *   - statements and internal reports;
 *   - compliance and data-protection work.
 *
 * **An over-wide block is a worse defect than the missing one**, because it stops lawful work and
 * looks like compliance. Each of those is asserted as SUCCEEDING with a lapsed licence in
 * `license-gate.e2e-spec.ts` — a positive assertion, because an absence of refusal is not something
 * a negative test can show.
 */
export const LICENCE_UNGATED_ACTS = [
  'collection and remittance on existing policies',
  'claims — logging, following and settling',
  'an endorsement that reduces cover, and a cancellation',
  'statements and internal reports',
  'compliance and data-protection work',
] as const;

@Injectable()
export class LicenseGateService {
  constructor(
    private readonly licenses: BrokerLicenseRepository,
    private readonly acts: RegulatoryActionRepository,
  ) {}

  /**
   * The office's standing today — the ONE answer, live.
   *
   * `now` defaults rather than being required, so a caller who passes nothing still gets a correct
   * live answer and a test can still pin a boundary. The failure direction of forgetting is
   * correctness.
   */
  async standing(now: Date = new Date()): Promise<DerivedLicenseStanding> {
    const [terms, acts] = await Promise.all([
      this.licenses.findTerms(),
      this.acts.findAll(),
    ]);
    return deriveLicenseStanding(pickCurrentTerm(terms), acts, now);
  }

  /**
   * Refuse `act` unless the office may practise.
   *
   * The refusal NAMES THE ACT and NAMES THE STANDING, because "blocked" alone sends a reader to
   * guess which of six states they are in — and the six are not interchangeable: an office with no
   * term on record has a different thing to do from one whose licence the CBJ suspended.
   */
  async assertMayPractise(
    act: LicenceGatedAct,
    now: Date = new Date(),
  ): Promise<void> {
    const standing = await this.standing(now);
    if (standing.mayPractise) return;
    throw new UnprocessableEntityException(refusal(act, standing));
  }
}

/**
 * The refusal sentence — exported and PURE, so its wording is unit-testable without a database and
 * so the six states each get their own clause rather than one generic line.
 *
 * It cites art. 21/a/9 once, where the article is what makes the refusal a refusal, and it names
 * what lifts the block: recording the new term WITH its certificate. A refusal that does not say
 * the way out gets escalated as a system fault.
 */
export function refusal(
  act: LicenceGatedAct,
  standing: DerivedLicenseStanding,
): string {
  const what = LICENCE_GATED_ACTS[act];
  const because = (() => {
    switch (standing.status) {
      case 'NO_TERM_ON_RECORD':
        return 'this office holds no CBJ broker licence term on record';
      case 'EXPIRED':
        return "the office's CBJ broker licence has expired";
      case 'SUSPENDED':
        return standing.standingActDecisionRef === null
          ? "the office's licence is recorded as suspended, with no CBJ decision reference on record"
          : `the CBJ has suspended the office's licence (decision ${standing.standingActDecisionRef})`;
      case 'CANCELLED':
        return standing.deemedCancelledUnderArticle14C
          ? "the office's licence is deemed cancelled — a suspension at the broker's own request has stood for more than two years (art. 14/c)"
          : standing.standingActDecisionRef === null
            ? "the office's licence is recorded as cancelled"
            : `the CBJ has cancelled the office's licence (decision ${standing.standingActDecisionRef})`;
      default:
        // ACTIVE and RENEWAL_PENDING both carry `mayPractise: true`, so this is unreachable from
        // `assertMayPractise`. Kept total rather than defaulted to a sentence, because a seventh
        // state added later must fail the compiler here rather than produce a vague refusal.
        return 'the office may not currently practise';
    }
  })();

  return (
    `${capitalise(what)} is blocked — ${because}. Practising without a current licence is a ground ` +
    `for administrative sanction (CBJ Instructions No. 9 of 2026, art. 21/a/9). Recording the ` +
    `office's current licence term together with its certificate is what lifts this; work on ` +
    `existing business — collection, claims, cancellations, reporting and compliance — is not ` +
    `affected.`
  );
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
