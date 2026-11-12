import { BadRequestException, Injectable } from '@nestjs/common';
import type { DeclaredAct } from '@prisma/client';

import { DECLARATION_REASON_MIN_LENGTH } from '../../common/declaration-reason';
import {
  DeclaredActRepository,
  type CreateDeclaredActInput,
} from '../../repositories/declared-act.repository';

import { ARTICLE_15_D } from './declared-act.config';

/** What a CALLER supplies. Everything else — the article text, the acknowledgement, the
 *  responsibility sentence, the permission code — comes from the config for the site, because a
 *  caller that could pass its own article text could record a sentence the person never saw. */
export interface DeclareArticle15DInput {
  /** The person's written justification. Element 2. */
  reason: string;
  /** The record this declaration belongs to. Element 5. */
  entity: string;
  entityId: string;
  /** The adviser's «الرقمُ الرقميُّ الفرعيُّ للحركة». */
  transactionRef: string;
  actorUserId: string;
  /** The actor's approved name AS IT STANDS — the adviser's «الاسمُ المعتمَد». Resolved by the
   *  caller from the authenticated user, not looked up here, so the name recorded is the one the
   *  request was made under. */
  actorNameShown: string;
  /** Threaded from the request by `clientIpForRecord`. NULL when there is genuinely none. */
  networkAddress: string | null;
  /** Whether the person actually ticked the acknowledgement. Element 4: it is HAND-ticked. */
  acknowledged: boolean;
}

/**
 * THE DECLARED ACT — the office was warned, declared, and proceeded. OWNER DECISION 126.
 *
 * ## THE CALLER CANNOT SUPPLY THE TEXTS, AND THAT IS THE DESIGN
 *
 * Elements 1 and 4 say the article text and the acknowledgement are stored **as displayed**,
 * because the text may change and the record testifies to what the employee SAW. The obvious
 * implementation — let the caller pass what it rendered — satisfies the letter and destroys the
 * purpose: a caller could then record any sentence at all, including one nobody was shown. So the
 * texts come from `declared-act.config.ts`, which is byte-pinned to the adviser's own file by
 * `declared-act.config.spec.ts`, and the SCREEN renders from that same constant. One source for
 * what was shown and what was stored.
 *
 * The honest limit of that: it makes "as displayed" true by construction only while the screen
 * reads the same constant. A screen that hard-coded its own copy would break the guarantee
 * silently, which is why the config spec exists and why the screen is NOT in this batch — its
 * strings go to the owner in message 36 §6 first.
 *
 * ## WHAT THIS SERVICE DELIBERATELY DOES NOT DO
 *
 * It does not decide WHETHER a declaration is required. That is art. 15/d's own evaluation — how
 * many insurers a request reached, and whether an exemption applies — and it belongs to the caller
 * (message 36 §4). Putting it here would make the record's writer also its judge, and the seven
 * sites have seven different tests.
 *
 * It does not check the permission either. `@RequirePermissions` does that at the route, which is
 * where every other permission in this codebase is enforced; the code is RECORDED here (element 3)
 * so the row says which one was used, which is a different claim from having checked it.
 */
@Injectable()
export class DeclaredActService {
  constructor(private readonly acts: DeclaredActRepository) {}

  /**
   * Record a declared act for art. 15/d — a quote request reaching fewer than three insurers with
   * no exemption. The first of decision 126's seven sites to be wired.
   */
  async declareArticle15D(input: DeclareArticle15DInput): Promise<DeclaredAct> {
    // ELEMENT 4 — the acknowledgement is HAND-ticked. An unticked one is not a weaker declaration,
    // it is no declaration: the adviser's own design is that the continue button does not open
    // until the box is ticked, so a request arriving without it did not come from that window.
    if (!input.acknowledged) {
      throw new BadRequestException(
        'The declaration was not acknowledged. The acknowledgement is ticked by hand and the act cannot be recorded without it.',
      );
    }

    // ELEMENT 2 — the written reason, against THE ONE SHARED FLOOR. Checked here so the caller
    // gets a 400 that names the field, and enforced again by
    // `DeclaredAct_reason_meets_the_shared_floor` so a path that bypasses this service still
    // cannot write a bare one. Two defences, not one, and the same number in both because it has
    // one home.
    const reason = input.reason.trim();
    if (reason.length < DECLARATION_REASON_MIN_LENGTH) {
      throw new BadRequestException(
        `A written reason of at least ${DECLARATION_REASON_MIN_LENGTH} characters is required. The record has to say why, and «نعم» is not a reason — the legal adviser asked for the verbatim text of the reason, not a token.`,
      );
    }

    const payload: CreateDeclaredActInput = {
      site: ARTICLE_15_D.site,
      articleRef: ARTICLE_15_D.articleRef,
      // AS DISPLAYED, from the one constant the screen also renders.
      articleTextShown: ARTICLE_15_D.articleText,
      acknowledgementTextShown: ARTICLE_15_D.acknowledgementText,
      responsibilitySentence: ARTICLE_15_D.responsibilitySentence,
      reason,
      permissionCode: ARTICLE_15_D.permissionCode,
      entity: input.entity,
      entityId: input.entityId,
      transactionRef: input.transactionRef,
      actorUserId: input.actorUserId,
      actorNameShown: input.actorNameShown,
      networkAddress: input.networkAddress,
    };

    return this.acts.create(payload);
  }

  /** Element 5's related record — every declaration shown ON the record. */
  findForRecord(entity: string, entityId: string): Promise<DeclaredAct[]> {
    return this.acts.findForRecord(entity, entityId);
  }
}
