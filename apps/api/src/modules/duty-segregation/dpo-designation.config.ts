import { UnprocessableEntityException } from '@nestjs/common';
import { canonicalNameKey } from '../../common/company-name.util';

/**
 * ONE PERSON MAY HOLD BOTH ASSIGNMENTS. THE SYSTEM SAYS SO ONCE AND RECORDS THAT IT WAS KNOWN.
 *
 * ## THIS REVERSES A RECORDED DECISION, KNOWINGLY
 *
 * The repository previously recorded a HARD BLOCK: the holder of the data-protection-officer
 * assignment may not be the holder of the office-manager assignment. The owner has STRUCK that.
 * Neither the block nor the register line that described it is what this implements.
 *
 * Her decision: an office of one person does not contain two people, and the system will not demand
 * what the office does not have. Both routes stay open and neither is required — the office may
 * assign the DPO to a second person inside it, to somebody outside it, or to the manager himself.
 *
 * ## AND IT DEPARTS FROM THE LEGAL ADVISER'S OWN WRITTEN ANSWER
 *
 * His answer on this exact question says the combination is NOT PERMISSIBLE legally or
 * organisationally and calls it a glaring conflict: the manager sets the purposes of processing and
 * takes the operational decisions, while the DPO must be independent enough to monitor management
 * and report impartially — *a person cannot be the monitor and the monitored at once*.
 *
 * The owner has decided otherwise, and that is hers to decide. IT IS RECORDED AS A DEPARTURE, here
 * and in `docs/deferred-register.md`, so that nobody later reads this system as COMPLIANT on this
 * point. Recording it is what has protected the company on every other item of this kind; its
 * absence is what would make the decision a silent harm instead of an open one.
 *
 * ## IT DECLARES. IT DOES NOT REFUSE — AND THE TWO HALVES OF THAT ARE DIFFERENT CLAIMS
 *
 * The ARRANGEMENT is never refused. What is required, in the same request, is the acknowledgement —
 * because *records that it was known* is only a fact if the tick is a precondition. So the 422 below
 * is about the missing acknowledgement and says in its own words that the arrangement is permitted.
 * That is decision 28's shape (the no-floor retention declaration, where the period is accepted and
 * the declaration is required), minus the written reason.
 *
 * ## NO WRITTEN REASON, DELIBERATELY LIGHTER THAN DECISION 28
 *
 * The reason here is the same every time — *I am one person* — so a reason box would be answered
 * identically and become the wallpaper the owner's own rule exists to prevent. An acknowledgement,
 * and nothing else.
 *
 * ## WHAT IS NOT DECLARED ON, AND THE ABSENCE IS ASSERTED
 *
 * THE COMPLIANCE OFFICER MAY BE THE DPO. The adviser says so explicitly — no Jordanian provision
 * forbids it, and it is practised and accepted in small and medium offices. That pairing gets NO
 * declaration, and `dpo-designation.config.spec.ts` asserts the absence rather than leaving it to a
 * reader to notice. A notice shown where nothing is wrong is noise a reader learns to click past
 * within a week, and then clicks past the one that matters.
 *
 * ## RECORDED AND NOT BUILT — THREE THINGS
 *
 * 1. THE EXTERNAL ASSIGNMENT. With no block, the external route is an OPTION rather than a cure, so
 *    it is not in this batch. Its three conditions, from the adviser, so that whoever builds it
 *    builds it complete: a written services contract; a NOTIFICATION TO THE DATA PROTECTION UNIT at
 *    the Ministry of Digital Economy and Entrepreneurship carrying the officer's name, their contact
 *    details and a copy of the contract; and that ONE EXTERNAL OFFICER MAY SERVE SEVERAL OFFICES.
 *    Note also what it would oblige this product to answer — *was the notification sent, and when* —
 *    which is an external obligation nothing here tracks today.
 * 2. NO USER ACCOUNT FOR AN EXTERNAL OFFICER (decision 80). An office that wants to give one access
 *    creates a user and grants a role, which it can already do with nothing new.
 * 3. THE ADVISER'S DEFERRED DUAL APPROVAL — an end-of-day report of everything the one person
 *    entered as a broker, approved in one batch as compliance officer. He says *we advise*, not
 *    *must*. Its value is that it turns an ARRANGEMENT into an ACT AT A DIFFERENT TIME, which is the
 *    weakest point of any combined posture. It belongs to the daily-operations module as optional
 *    hardening and is recorded in the register.
 */

/**
 * THE SAMENESS TEST GOES THROUGH `canonicalNameKey`, AND THAT IS A DECISION RATHER THAN A HABIT.
 *
 * It is the fold the employee and insurer duplicate indexes already use — the database function
 * `canonical_name_key` backs a STORED generated column and a unique index, and `POST /employees`
 * pre-checks a person's name through it. So this system already has ONE answer to *are these two
 * names the same person*, and spelling a second comparison here would give it two.
 *
 * ## THE LIMIT, STATED RATHER THAN DISCOVERED
 *
 * A NAME is all the system holds for either assignment — both are free text, by the recorded
 * decision that an FK to `Employee` would make registration impossible, since at registration the
 * office has no employee records at all. So:
 *
 *   * TWO DIFFERENT PEOPLE WHO SHARE A NAME would be shown the declaration. The cost is one
 *     acknowledgement nobody needed.
 *   * ONE PERSON RECORDED UNDER TWO SPELLINGS that do not canonicalise together would not. The fold
 *     covers Arabic orthography, the definite article and word order, which is what varies in
 *     practice; it does not cover a nickname or an initial.
 *
 * Neither is closable by a better string function — the second needs the designation to carry a
 * REFERENCE as well as a name, which decision 80 describes and which NO designation in this system
 * carries today (measured: `generalManagerName`, `complianceOfficerName` and now
 * `dataProtectionOfficerName` are all bare names). That is the owner's to decide.
 */
export interface DesignationPair {
  generalManagerName: string | null;
  dataProtectionOfficerName: string | null;
}

/**
 * The canonical key of the person holding BOTH assignments, or `null` when nobody does.
 *
 * Returning the KEY rather than a boolean is what makes "asked once, about this person" expressible:
 * the caller stores it, and a later assignment of both functions to somebody else does not match.
 */
export function combinedAssignmentPerson(pair: DesignationPair): string | null {
  const manager = canonicalNameKey(pair.generalManagerName ?? '');
  const dpo = canonicalNameKey(pair.dataProtectionOfficerName ?? '');

  // An EMPTY key is not a match. `canonicalNameKey` returns '' for a name made entirely of
  // punctuation, and two blanks are not one person — they are two facts nobody has recorded. This is
  // the branch a `===` alone would get wrong, and it is the common case while the DPO designation is
  // unset on every office that predates it.
  if (manager === '' || dpo === '') return null;

  return manager === dpo ? manager : null;
}

export interface CombinedDeclarationInput extends DesignationPair {
  /**
   * The canonical key already acknowledged, or null if nothing has been. NULL means NEVER ASKED —
   * never "acknowledged about nobody". The `noFloorAcknowledgedMonths` precedent: comparing against
   * an invented baseline is how a control silently stops applying.
   */
  acknowledgedPerson: string | null;
}

/** What the office hand-ticked, and the sentence it was shown. */
export interface CombinedDeclaration {
  /** THE SENTENCE SHOWN, carried from the client verbatim — decision 28's rule. */
  noticeShown: string;
  acknowledged: boolean;
}

/** What the caller must store, or null when no declaration is owed. */
export interface CombinedDeclarationToStore {
  noticeShown: string;
  person: string;
}

export const DPO_MANAGER_COMBINED_DECLARATION_REQUIRED =
  'DPO_MANAGER_COMBINED_DECLARATION_REQUIRED';

/**
 * Is the office being asked, for this pair of designations?
 *
 * A PURE function over the three facts rather than a row read, so all of the decided behaviours are
 * provable without a database — the same reason the retention floor's three states had to be pure.
 */
export function combinedDeclarationRequired(
  input: CombinedDeclarationInput,
): boolean {
  const person = combinedAssignmentPerson(input);

  // The two designations name different people, or one of them is unset. Nothing to declare, and
  // showing anything here is the noise case the compliance-officer pairing is excluded for.
  if (person === null) return false;

  // Already acknowledged, ABOUT THIS PERSON. A different person is a different exposure and is asked
  // again; without this comparison an acknowledgement for person A would silence the notice for
  // person B for ever, which is the failure that makes "asked once" dishonest rather than light.
  return input.acknowledgedPerson !== person;
}

/**
 * REFUSES until the acknowledgement arrives — and the refusal is about the ACKNOWLEDGEMENT, never
 * about the arrangement. The arrangement is permitted and the message says so in its own words.
 *
 * Returns what to store when a declaration is required and well-formed, and `null` when none is
 * required — so a caller can neither write a declaration it was not asked for nor forget one it was.
 * That is `resolveNoFloorDeclaration`'s shape and it is deliberate: the two call sites are the only
 * places either declaration can be written, and the return type is what makes forgetting impossible
 * rather than merely unlikely.
 */
export function resolveCombinedDeclaration(
  input: CombinedDeclarationInput,
  declaration: CombinedDeclaration | undefined,
): CombinedDeclarationToStore | null {
  if (!combinedDeclarationRequired(input)) return null;

  const person = combinedAssignmentPerson(input);
  // Unreachable while `combinedDeclarationRequired` is the gate above — it returns false on a null
  // person — and asserted rather than cast, because a cast is where the guard becomes optional.
  if (person === null) return null;

  const notice = declaration?.noticeShown?.trim() ?? '';

  if (!declaration || !declaration.acknowledged || notice === '') {
    throw new UnprocessableEntityException({
      code: DPO_MANAGER_COMBINED_DECLARATION_REQUIRED,
      message:
        'The office-manager assignment and the data-protection-officer assignment name the same ' +
        'person. That is permitted, and this office may keep it: an office with nobody else cannot ' +
        'be asked to find a second person, and nothing here refuses the arrangement or asks for a ' +
        'reason. What is required is that somebody read the notice shown on screen and acknowledge ' +
        'it, so that the record shows the arrangement was known rather than overlooked.',
      person,
    });
  }

  // TRIMMED, because the stored sentence IS the record and leading whitespace is not part of what
  // anybody read.
  return { noticeShown: notice, person };
}
