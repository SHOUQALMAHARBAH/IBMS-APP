import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  Article15DExemption,
  CommunicationLog,
  InteractionChannel,
  RfqArticle15DExemption,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

import { Article15DRepository } from '../../repositories/article-15-d.repository';
import { UserRepository } from '../../repositories/user.repository';
import { DeclaredActService } from './declared-act.service';
import { LegalValueService } from './legal-value.service';
import {
  ARTICLE_15_D,
  DECLARED_ACT_REASON_MIN_LENGTH,
} from './declared-act.config';
import {
  UNCONDITIONAL_APPROVED_CHANNELS,
  isApprovedMeans,
} from './approved-means.config';
import {
  article15DFiguresFrom,
  availableExemptions,
  exemption4Applies,
  quotationBreachesCeiling,
  reachesEnoughInsurers,
  type Article15DFigures,
  type ExemptionOffer,
} from './article-15-d.config';

/**
 * ART. 15/d — «التواصل مع ثلاث شركات تأمين» — WIRED, WITH ITS SCREEN.
 *
 * OWNER DECISION 130 ruling 1: the office sends to three or more BECAUSE THAT IS WHAT THE LAW
 * SAYS, so fewer than three is the EXCEPTION. OWNER DECISION 126: the system warns and records
 * and does not refuse. OWNER DECISION 129: the exemption is tagged by the system where every
 * fact is already recorded, and chosen by the employee where one is missing.
 *
 * ## THE ONE THING THIS SERVICE REFUSES, AND IT IS NOT THE ACT
 *
 * A request below three with no exemption needs `declared-act.article-15-d.declare`, which under
 * OWNER DECISION 131 is granted to NOBODY until an office grants it. So that path refuses with
 * the standing permission vocabulary until the administrator acts.
 *
 * ⛔ THAT IS NOT DECISION 126 BEING BROKEN. 126 says the system does not refuse the ACT on the
 * ground that it is a breach — it warns, records, and lets the office proceed. This refusal is an
 * ORDINARY PERMISSION refusal: this person may not make this declaration. Every other route in
 * the product refuses the same way for the same reason, and the remedy is one grant away and is
 * named in the message.
 *
 * ⟶ AND AN EXEMPTED REQUEST IS NEVER AFFECTED, nor is one reaching three or more — 84.3% of
 *   them on the seeded distribution. The refusal reaches the minority of the minority, which is
 *   decision 123's own test: count the clicks added to the most frequent transaction.
 */

/** What the screen needs to ask the question. */
export interface Article15DOptions {
  /** TRUE when this shortlist is below the minimum, i.e. the question is asked at all. */
  required: boolean;
  minInsurers: number;
  /** The ceiling in force TODAY, as a string — `money-decimal-jod.md` forbids a JOD figure on
   *  the wire as a number. */
  premiumCeilingJod: string;
  /** Only the exemptions that CAN apply to this request's line. */
  exemptions: ExemptionOffer[];
  /** Does the caller hold the declaration permission? The screen needs to know BEFORE the
   *  employee writes a reason into a window that is going to refuse them. */
  mayDeclare: boolean;
  /**
   * EXEMPTION 5's CANDIDATE EVIDENCE — this customer's INBOUND communications that arrived by an
   * approved means. Empty when exemption 5 is not on offer, or when there are none.
   *
   * ## 🔴 WHY IT COMES FROM HERE AND NOT FROM `GET /communications`
   *
   * That route is gated on `communication.send`, which a placement officer making a quote
   * request need not hold — so the picker would be empty for exactly the person using it. Moving
   * the gate would be worse: it would hand every RFQ-creating role the whole correspondence book.
   *
   * ⟶ So the list is NARROW by construction: this customer, INBOUND only, approved means only,
   *   and it carries ONLY what a picker needs.
   *
   * ⛔ NO `subject` AND NO `body`. A communication's text is Confidential under
   * `sensitive-data-handling.md` — loss history and sums insured live there — and the employee
   * identifies the message by when it came and how. Widening this to make the picker prettier
   * would hand correspondence content to a permission that does not read correspondence.
   */
  evidence: { id: string; channel: InteractionChannel; sentAt: Date }[];
  /**
   * 🔴 THE ADVISER'S WINDOW, FROM THE SERVER — which is what makes element 1's «as displayed»
   * true BY CONSTRUCTION rather than by discipline.
   *
   * `declared-act.service.ts` stores `articleTextShown` and `acknowledgementTextShown` from
   * `declared-act.config.ts`, and its own header names the limit of that guarantee: it holds
   * «only while the screen reads the same constant. A screen that hard-coded its own copy would
   * break the guarantee silently.»
   *
   * ⟶ So the screen does not hold a copy at all. It renders these, the server stores the same
   *   constants, and `declared-act.config.spec.ts` re-slices every one of them from the
   *   adviser's own file byte for byte. There is no second place for his text to drift in.
   *
   * ⛔ AND THIS IS WHY THE TEXTS ARE NOT IN THE WEB DICTIONARIES. They are the only Arabic in
   * this product that is NOT translated and NOT ours: an English rendering of a regulatory
   * acknowledgement would be a sentence the adviser never drafted and the record never stored.
   */
  window: {
    title: string;
    text: string;
    reasonHint: string;
    acknowledgement: string;
    /** The floor the server actually enforces, so the screen cannot print a different one. */
    reasonMinLength: number;
  };
}

/** What a caller supplies when a request goes below the minimum. */
export interface Article15DChoice {
  exemption?: Article15DExemption;
  /** Exemption 4 only, as a string. */
  declaredAnnualPremiumJod?: string;
  /** Exemption 5 only. */
  evidenceCommunicationLogId?: string;
  /** Only when NO exemption applies. */
  declaration?: { reason: string; acknowledged: boolean };
}

/**
 * WHAT `evaluate` DECIDED, ready to be written once the request row exists.
 *
 * A discriminated union rather than an optional-fields bag: «nothing to record», «an exemption»
 * and «a declaration» are three different outcomes, and a shape that could carry two at once
 * would let `apply` write both.
 */
export type Article15DPlan =
  | { kind: 'nothing' }
  | {
      kind: 'exemption';
      row: {
        exemption: Article15DExemption;
        basis: 'CHOSEN_BY_PERSON' | 'TAGGED_BY_SYSTEM';
        insurerCount: number;
        declaredAnnualPremiumJod: Decimal | null;
        ceilingValueJod: Decimal | null;
        evidenceCommunicationLogId: string | null;
        chosenByUserId: string | null;
        chosenByNameShown: string | null;
      };
    }
  | {
      kind: 'declaration';
      declaration: {
        reason: string;
        actorUserId: string;
        actorNameShown: string;
        networkAddress: string | null;
        acknowledged: boolean;
      };
    };

@Injectable()
export class Article15DService {
  constructor(
    private readonly rows: Article15DRepository,
    private readonly legalValues: LegalValueService,
    private readonly declaredActs: DeclaredActService,
    private readonly users: UserRepository,
  ) {}

  /** The two figures, read AT THE GIVEN DATE. Never today's, for a historic read. */
  async figuresAt(at: Date): Promise<Article15DFigures> {
    return article15DFiguresFrom(await this.legalValues.listInForce(at));
  }

  /**
   * What the screen shows when the employee has picked a shortlist.
   *
   * `at` is the request's own moment. A screen asking about a request being made NOW passes now;
   * nothing here reads the clock itself, which is what makes decision 129's criterion 4 testable.
   */
  async optionsFor(input: {
    lineCode: string | null;
    insurerCount: number;
    customerId: string | null;
    grantedCodes: ReadonlySet<string>;
    at: Date;
  }): Promise<Article15DOptions> {
    const figures = await this.figuresAt(input.at);
    const required = !reachesEnoughInsurers(input.insurerCount, figures);
    const offers = required ? availableExemptions(input.lineCode) : [];
    const needsEvidence = offers.some(
      (o) => o.exemption === 'AT_CUSTOMER_REQUEST',
    );
    return {
      required,
      minInsurers: figures.minInsurers,
      premiumCeilingJod: figures.premiumCeilingJod.toString(),
      // Empty when the request already reaches enough: there is nothing to be exempt FROM, and
      // offering a list there would teach an employee to reach for one.
      exemptions: offers,
      mayDeclare: input.grantedCodes.has(ARTICLE_15_D.permissionCode),
      evidence:
        needsEvidence && input.customerId
          ? await this.rows.findApprovedInboundForCustomer(
              input.customerId,
              UNCONDITIONAL_APPROVED_CHANNELS,
            )
          : [],
      window: {
        title: ARTICLE_15_D.windowTitle,
        text: ARTICLE_15_D.articleText,
        reasonHint: ARTICLE_15_D.reasonHint,
        acknowledgement: ARTICLE_15_D.acknowledgementText,
        reasonMinLength: DECLARED_ACT_REASON_MIN_LENGTH,
      },
    };
  }

  /**
   * 🔴 EVALUATE — EVERY REFUSAL HAPPENS HERE, BEFORE THE REQUEST ROW EXISTS.
   *
   * ## WHY THIS IS SPLIT FROM THE WRITE, AND IT IS A DEFECT THE e2e FOUND
   *
   * The first version evaluated AFTER `insertRfqRow`, because the exemption and the declared act
   * both point AT the request and neither can be written before there is one. That is true of
   * the WRITES and not of the REFUSALS — and the consequence was real:
   *
   *   a refused request left the RFQ row BEHIND. The employee corrected their mistake, submitted
   *   again, and got **409 Conflict** from `@@unique([opportunityId, insuranceLine])` — told
   *   that a request they could not see already existed, with no way to proceed on that line.
   *
   * ⟶ Found by `article-15-d.e2e-spec.ts` on its second run, where a refused WhatsApp evidence
   *   was followed by a valid attempt on the same opportunity and line.
   *
   * So evaluation is pure of writes and runs BEFORE the row; `apply` runs after it with a plan
   * that cannot fail for a reason the caller could have fixed. ⛔ The alternative — deleting the
   * orphan on failure — is a compensating action for a row that should never have been written.
   */
  async evaluate(input: {
    lineCode: string | null;
    insurerCount: number;
    customerId: string | null;
    choice: Article15DChoice;
    grantedCodes: ReadonlySet<string>;
    actorUserId: string;
    networkAddress: string | null;
    at: Date;
  }): Promise<Article15DPlan> {
    const figures = await this.figuresAt(input.at);

    /*
     * THREE OR MORE ⟶ NOTHING AT ALL. Not an empty exemption, not a tagged one, not a row saying
     * "no exemption needed" — nothing. Decision 130 ruling 1: reaching three is the law being
     * complied with, and a record of compliance on every request would bury the minority that
     * actually needs one. The database agrees: `only_below_three_insurers` refuses such a row.
     */
    if (reachesEnoughInsurers(input.insurerCount, figures)) {
      if (input.choice.exemption || input.choice.declaration) {
        throw new UnprocessableEntityException(
          `This request reaches ${input.insurerCount} insurance companies, which is ${figures.minInsurers} or more, so art. 15/d is satisfied and no exemption or declaration applies to it. Remove it rather than recording one that could never be needed.`,
        );
      }
      return { kind: 'nothing' };
    }

    if (input.choice.exemption) {
      return this.planExemption({ ...input, figures });
    }
    return this.planDeclaration(input);
  }

  /**
   * APPLY the plan to a request that now exists. Writes only; every refusal already happened.
   *
   * Returns the exemption row when one was written, or null when the request reached the minimum
   * or rested on a declaration instead.
   */
  async apply(
    plan: Article15DPlan,
    rfqId: string,
  ): Promise<RfqArticle15DExemption | null> {
    if (plan.kind === 'nothing') return null;
    if (plan.kind === 'exemption') {
      return this.rows.createExemption({ ...plan.row, rfqId });
    }
    await this.declaredActs.declareArticle15D({
      ...plan.declaration,
      entity: 'RFQ',
      entityId: rfqId,
      transactionRef: rfqId,
    });
    return null;
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // THE EXEMPTION
  // ───────────────────────────────────────────────────────────────────────────────────────────

  private async planExemption(input: {
    lineCode: string | null;
    insurerCount: number;
    customerId: string | null;
    choice: Article15DChoice;
    actorUserId: string;
    figures: Article15DFigures;
  }): Promise<Article15DPlan> {
    const chosen = input.choice.exemption!;

    /*
     * DECISION 129 CRITERION 2, SERVER-SIDE. «والنظام يعرض الإعفاءات المتاحة فقط» — only the
     * available ones are offered, and the server re-checks rather than trusting the screen. An
     * employee on a motor request must not be able to post an INDIVIDUAL_MEDICAL_RENEWAL by
     * editing the payload: that would record a reason which cannot be true.
     */
    const offered = availableExemptions(input.lineCode);
    if (!offered.some((o) => o.exemption === chosen)) {
      throw new UnprocessableEntityException(
        `Exemption ${chosen} does not apply to a request on this insurance line. The exemptions available here are: ${offered.map((o) => o.exemption).join(', ') || 'none'}.`,
      );
    }

    let declaredPremium: Decimal | null = null;
    let ceiling: Decimal | null = null;
    let evidence: CommunicationLog | null = null;

    if (chosen === 'LOW_PREMIUM_MOTOR_MEDICAL_OR_TRANSIT') {
      if (input.choice.declaredAnnualPremiumJod === undefined) {
        throw new BadRequestException(
          'This exemption rests on the expected annual premium being at or below the ceiling, so the expected premium is required.',
        );
      }
      declaredPremium = new Decimal(input.choice.declaredAnnualPremiumJod);
      ceiling = input.figures.premiumCeilingJod;

      /*
       * DECISION 129 CRITERION 3. «قسط ٢٠٠١ في المركبات ⟶ الإعفاء الرابع لا يُعرَض.» AT the
       * ceiling is inside it, because the article says «لا يزيد عن». Refused here with a message
       * naming both figures, and refused AGAIN by
       * `RfqArticle15DExemption_declared_premium_is_within_the_ceiling` for a path that does not
       * come through this service. Two defences, not one.
       */
      if (!exemption4Applies(input.lineCode, declaredPremium, input.figures)) {
        throw new UnprocessableEntityException(
          `An expected annual premium of ${declaredPremium.toString()} JOD is above art. 15/d/4's ceiling of ${ceiling.toString()} JOD, so that exemption does not apply to this request.`,
        );
      }
    } else if (input.choice.declaredAnnualPremiumJod !== undefined) {
      // The database CHECK says the same thing. Refused here so the message names the field.
      throw new BadRequestException(
        'An expected annual premium belongs only to art. 15/d/4. Recording one against another exemption would be a figure nobody can interpret.',
      );
    }

    if (chosen === 'AT_CUSTOMER_REQUEST') {
      evidence = await this.resolveEvidence(
        input.choice.evidenceCommunicationLogId,
        input.customerId,
      );
    } else if (input.choice.evidenceCommunicationLogId !== undefined) {
      throw new BadRequestException(
        "Evidence of the customer's request belongs only to art. 15/d/5.",
      );
    }

    /*
     * DECISION 129 CRITERION 7, FIRST HALF. «اختاره فلان» — who chose it, by the name as it
     * STANDS, through `displayNameForUserId` and never `findById().fullName` (OWNER DECISION
     * 48): `Employee.fullName` is the real identity and `User.fullName` is free text that, in
     * the demo data, holds an English ROLE LABEL for all sixteen linked accounts.
     *
     * `basis` is CHOSEN_BY_PERSON for every row this service writes, because MEASURED
     * 2026-11-12 none of the five can be tagged by the system — there is no individual/group
     * medical split, the consecutive-renewal count is recorded nowhere, and the defined-benefit
     * list has not been issued.
     */
    const shownName = await this.users.displayNameForUserId(input.actorUserId);

    return {
      kind: 'exemption',
      row: {
        exemption: chosen,
        basis: 'CHOSEN_BY_PERSON',
        insurerCount: input.insurerCount,
        declaredAnnualPremiumJod: declaredPremium,
        // COPIED onto the row, not joined — decision 129's criterion 4. A foreign key would
        // satisfy it only while somebody remembered to pass the request's own date, and
        // `sla-timer.service.ts:247` is this repository's own recorded example of a dated read
        // that quietly uses today.
        ceilingValueJod: ceiling,
        evidenceCommunicationLogId: evidence?.id ?? null,
        chosenByUserId: input.actorUserId,
        chosenByNameShown: shownName ?? 'unknown',
      },
    };
  }

  /**
   * DECISION 129 CRITERION 5 — «الإعفاء الخامس بلا ما يثبت طلب العميل ⟶ لا يُحفَظ».
   *
   * ## AND THE EVIDENCE CANNOT BE ON THE RFQ AT CREATION, WHICH IS A CORRECTION
   *
   * `RfqArticle15DExemption`'s own schema comment says the evidence is «an INBOUND
   * `CommunicationLog` on this RFQ». Measured while wiring it: the customer asks BEFORE the
   * request exists, so at creation there is no RFQ for the log to be on — the strict reading
   * makes exemption 5 unreachable on the only path that needs it.
   *
   * ⟶ So the evidence is an INBOUND log on the OPPORTUNITY'S OWN CUSTOMER, and nothing else.
   *   Widening it to any log in the office would let an unrelated message stand as proof that
   *   THIS customer asked for THIS request.
   *
   * ⚠️ AND THE CUSTOMER CHECK FIRES BEFORE THE CHANNEL CHECK, which the e2e found by getting it
   * wrong: whose message it is comes before how it arrived, and a message from the wrong
   * customer is not improved by having come by email.
   *
   * AND IT MUST HAVE ARRIVED BY AN APPROVED MEANS — art. 22/s, OWNER DECISION 132 ruling 2 and
   * 133 §3. `WHATSAPP` is refused BY NAME even though it is an electronic channel (decision 44),
   * and `OTHER` needs a written agreement, which nothing records today — so `OTHER` is refused
   * here rather than admitted on an assumption.
   */
  private async resolveEvidence(
    id: string | undefined,
    customerId: string | null,
  ): Promise<CommunicationLog> {
    if (!id) {
      throw new BadRequestException(
        'This exemption rests on the customer having asked, so the evidence of that request is required and the record is not saved without it.',
      );
    }
    const log = await this.rows.findCommunicationLog(id);
    if (!log) {
      throw new UnprocessableEntityException(
        `No communication with id ${id} is on file for this office.`,
      );
    }
    if (log.direction !== 'INBOUND') {
      throw new UnprocessableEntityException(
        'The evidence has to be something the customer SENT. An outbound message is the office speaking, not the customer asking.',
      );
    }
    if (customerId === null || log.customerId !== customerId) {
      throw new UnprocessableEntityException(
        "The evidence has to be a communication from this request's own customer.",
      );
    }
    /*
     * The written-agreement condition is answered FALSE, deliberately and not by omission:
     * nothing in this product records a written agreement with a customer about a notification
     * channel, so answering TRUE would be asserting a fact nobody holds. ⟶ `OTHER` is therefore
     * refused here. The day such an agreement is recorded, this reads it instead.
     */
    if (!isApprovedMeans(log.channel, false)) {
      throw new UnprocessableEntityException(
        `A request arriving by ${log.channel} is not one of art. 22/s's approved means of notification, so it cannot be the evidence for this exemption.`,
      );
    }
    return log;
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // THE DECLARATION
  // ───────────────────────────────────────────────────────────────────────────────────────────

  private async planDeclaration(input: {
    choice: Article15DChoice;
    grantedCodes: ReadonlySet<string>;
    actorUserId: string;
    networkAddress: string | null;
  }): Promise<Article15DPlan> {
    /*
     * DECISION 129 CRITERION 6 — «لا إعفاء وأقلّ من ثلاث ⟶ النافذة، ولا تمرّ بلا صلاحيتها
     * المنفصلة». The permission is checked HERE rather than by a route decorator, because the
     * route is `POST /rfqs` and its own code is `rfq.create`: a decorator would demand this
     * permission of every quote request, including the 84.3% that never meet art. 15/d.
     *
     * ⛔ Which is exactly why `declared-act.article-15-d.declare` is not on the controller. The
     * branch is the unit, and `new-permission-mark.config.ts` declares it as such so the
     * notification tells an administrator the truth about what it guards.
     */
    if (!input.grantedCodes.has(ARTICLE_15_D.permissionCode)) {
      throw new ForbiddenException(
        `You do not hold permission to declare that a quote request is going to fewer than three insurance companies — ask whoever manages permissions in your office. (${ARTICLE_15_D.permissionCode})`,
      );
    }

    const declaration = input.choice.declaration;
    if (!declaration) {
      throw new BadRequestException(
        'This request goes to fewer than three insurance companies and no exemption was chosen, so it needs a written declaration with its reason and the acknowledgement.',
      );
    }

    // The name as it STANDS — decision 48 again, and `DeclaredActService` requires it because the
    // record testifies to who made the declaration.
    const shownName = await this.users.displayNameForUserId(input.actorUserId);

    /*
     * ⚠️ THE ACKNOWLEDGEMENT AND THE REASON FLOOR ARE CHECKED BY `DeclaredActService`, which
     * runs in `apply` — AFTER the row exists. So they are checked HERE TOO, by calling nothing:
     * the two cheap conditions are re-stated as refusals before the write, for the same reason
     * the rest of this method is. Without that, an unticked box would still orphan an RFQ.
     *
     * ⛔ The FLOOR is not re-declared as a number. `DECLARATION_REASON_MIN_LENGTH` has one home
     * and `check:declaration-floor` refuses a second copy; it is imported.
     */
    if (!declaration.acknowledged) {
      throw new BadRequestException(
        'The declaration was not acknowledged. The acknowledgement is ticked by hand and the act cannot be recorded without it.',
      );
    }
    if (declaration.reason.trim().length < DECLARED_ACT_REASON_MIN_LENGTH) {
      throw new BadRequestException(
        `A written reason of at least ${DECLARED_ACT_REASON_MIN_LENGTH} characters is required. The record has to say why, and «نعم» is not a reason.`,
      );
    }

    return {
      kind: 'declaration',
      declaration: {
        reason: declaration.reason,
        actorUserId: input.actorUserId,
        actorNameShown: shownName ?? 'unknown',
        networkAddress: input.networkAddress,
        acknowledged: declaration.acknowledged,
      },
    };
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // THE ALERT, WHICH ARRIVES LATER
  // ───────────────────────────────────────────────────────────────────────────────────────────

  /**
   * A quotation came back. If this request rests on art. 15/d/4 and the premium exceeds the
   * ceiling it was recorded under, RAISE AN ALERT — and nothing else.
   *
   * Message 36 §4.5: «ولمّا ترجع العروض يقارن النظام، وإن زاد القسط عن الحدّ ينبّه ولا يرفض».
   * OWNER DECISION 126's whole shape: ⛔ the quotation is NOT refused and ⛔ the exemption is NOT
   * erased. Both would be the system rewriting what happened.
   *
   * Returns true when an alert was raised, so the caller can say so on the response. Swallows
   * nothing: a failure here is a failure of the capture, because an alert that silently did not
   * fire is worse than no alert at all.
   */
  async checkQuotationAgainstCeiling(input: {
    rfqId: string;
    quotationId: string;
    quotedPremiumJod: Decimal;
  }): Promise<boolean> {
    const exemption = await this.rows.findExemptionForRfq(input.rfqId);
    if (!exemption || exemption.ceilingValueJod === null) return false;
    if (
      !quotationBreachesCeiling(
        input.quotedPremiumJod,
        exemption.ceilingValueJod,
      )
    ) {
      return false;
    }
    await this.rows.raiseAlert({
      exemptionId: exemption.id,
      quotationId: input.quotationId,
      quotedPremiumJod: input.quotedPremiumJod,
      // The ceiling is copied AGAIN rather than joined, so the alert reads correctly even after
      // the exemption row moves — the same argument as the exemption copying it from the table.
      ceilingValueJod: exemption.ceilingValueJod,
    });
    return true;
  }

  /** Every alert on a request, for the record and the screen. */
  findAlertsForRfq(rfqId: string) {
    return this.rows.findAlertsForRfq(rfqId);
  }

  /** The exemption a request rests on, if any. */
  findExemptionForRfq(rfqId: string) {
    return this.rows.findExemptionForRfq(rfqId);
  }
}
