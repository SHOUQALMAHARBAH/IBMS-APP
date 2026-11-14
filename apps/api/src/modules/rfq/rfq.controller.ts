import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { clientIpForRecord } from '../../common/client-ip';
import { RfqService } from './rfq.service';
import { CreateRfqDto } from './dto/create-rfq.dto';
import { AddRfqInsurersDto } from './dto/add-rfq-insurers.dto';
import { LogRfqCommunicationDto } from './dto/log-rfq-communication.dto';
import { ListRfqsQueryDto } from './dto/list-rfqs-query.dto';
import { Article15DOptionsQueryDto } from './dto/article-15-d-options-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Process 11 — RFQ / Market Submission (backlog Part C #11, Domain B). One
 * RFQ per insurance line under an Opportunity, sent to a shortlist of
 * insurers; per-insurer response tracking lives on the sibling
 * `rfq-insurers` controller. See rfq.service.ts for the rules. Frontend:
 * apps/web/app/(app)/rfqs/ + apps/web/app/(app)/opportunities/. */
@ApiTags('rfqs')
@Controller('rfqs')
export class RfqController {
  constructor(private readonly rfqs: RfqService) {}

  @RequirePermissions('rfq.create')
  @Post()
  create(
    @Body() dto: CreateRfqDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    /*
     * THE NETWORK ADDRESS IS THREADED FROM THE REQUEST, never resolved deeper.
     *
     * An art. 15/d declaration records it (the adviser's «العنوان الشبكي»), and only a
     * controller holds the `Request` to read it from. `clientIpForRecord` is the ONE
     * implementation -- extracted from the rate-limit guard, which had earned the only correct
     * answer by surviving a real brute-force bypass -- and it returns NULL rather than the
     * string 'unknown', because a RECORD must not claim an address it does not have.
     */
    return this.rfqs.createRfq(dto, user, clientIpForRecord(request));
  }

  /**
   * ART. 15/d — WHAT THE SCREEN ASKS BEFORE THE REQUEST IS SENT.
   *
   * «أُرسِل الطلب لأقل من ثلاث شركات تأمين. ما سبب الإعفاء؟» (OWNER DECISION 133). The window
   * belongs on the EXCEPTION, not the routine — decision 123's own test is to count the clicks
   * added to the most frequent transaction — so the screen asks this only once the shortlist is
   * below the minimum, and this route tells it which exemptions can apply to THIS request's line.
   *
   * ## WHY A ROUTE RATHER THAN A CLIENT-SIDE RULE
   *
   * Three of the figures involved are the office's data, not the screen's: the minimum and the
   * ceiling are `LegalValue` rows read at the request's own date, the eligible lines are a
   * property of the 32-row standard catalogue, and whether the caller may DECLARE is a
   * permission. A screen that decided any of them would be a second answer to a legal question.
   *
   * GATED ON `rfq.create`, the same code as the request itself: asking what a request would need
   * is part of making one, and a separate code would be a checkbox that hides the question from
   * somebody who can still send the request.
   *
   * Declared BEFORE `:id` so "article-15-d" is never parsed as an RFQ id — the same reason
   * `selectable-insurers` is.
   */
  @RequirePermissions('rfq.create')
  @Get('article-15-d/options')
  article15DOptions(
    @Query() query: Article15DOptionsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rfqs.article15DOptions(query, user);
  }

  /**
   * The insurers this office can shortlist. Declared before `:id` so
   * "selectable-insurers" is never parsed as an RFQ id.
   *
   * Gated on `insurer.read`, not `rfq.create`. It reads the office's OWN insurer
   * rows — their names, and (once the insurer feature lands) only the active ones
   * — so the permission that governs reading those rows is the right gate.
   * `rfq.create` was a shortcut from when this was the list's only consumer, and
   * it meant a Manager or Compliance Officer who may read an insurer could not
   * ask which insurers exist.
   */
  @RequirePermissions('insurer.read')
  @Get('selectable-insurers')
  selectableInsurers() {
    return this.rfqs.listSelectableInsurers();
  }

  /**
   * DOOR FOUR ON THE LIST — the SAME six-role gate as `:id`, and the same anchor behind it.
   *
   * The owner's answer to "is a customer-filtered list inside the chain you decided?" is yes, and
   * the shape is safe here because this route has NO unfiltered mode: it refuses unless exactly one
   * of `opportunityId` or `customerId` is given. So the thing an anchored reader could be handed is
   * one customer's chain and never the book — the unfiltered list would have been the blanket key
   * the design refused, and it is not expressible on this route.
   *
   * `opportunityId` stays owner-only, deliberately: an anchor is per CUSTOMER, and an Opportunity
   * is a placement-path object whose id a reader outside that path has no way to know. See
   * `RfqService.list`.
   */
  @RequirePermissions('rfq.read', 'dashboard.compliance.view')
  @Get()
  list(
    @Query() query: ListRfqsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rfqs.list(query, user);
  }

  /**
   * DOOR FOUR, FIRST LAYER. The second is `CustomerFileAnchorService`, and neither works alone:
   * this gate decides who may ASK, the anchor decides whose file they may see.
   *
   * THE EXACT ROLE SET, which is what this widening is specified by — not by the codes named:
   *
   *     SALES_RELATIONSHIP_OFFICER, PLACEMENT_TECHNICAL_OFFICER, BRANCH_DEPARTMENT_MANAGER,
   *     EXECUTIVE_MANAGEMENT   (`rfq.read`, the placement path, unchanged)
   *     COMPLIANCE_OFFICER, DATA_PROTECTION_OFFICER   (`dashboard.compliance.view`)
   *
   * and NOT SYSTEM_SECURITY_ADMINISTRATOR, NOT CLAIMS_OFFICER. Asserted by name in
   * `route-role-reach.spec.ts`, so a later grant of either code elsewhere fails the build rather
   * than silently widening this route.
   *
   * SIX ROLES, NOT THE SEVEN FIRST DECIDED, and the missing one is deliberate. The Claims
   * Officer's anchor was to be a claim ASSIGNED to him, and this product cannot express that —
   * `Claim` carries no staff user field at all. Admitting him here would replace an honest 403
   * ("you do not hold the permission") with a 404 from the anchor layer ("not found") about a
   * record that exists, for a role that can never satisfy the second layer. When claim assignment
   * is built, `claim.read` is added here in one line, with its own decision.
   *
   * WHY `dashboard.compliance.view` OF THE SEVEN CODES THAT HIT THE SET EXACTLY: measured, and the
   * criterion could not choose — one single code and 243 pairs reach the seven-role set, and seven
   * single codes reach this six-role one. The arithmetic is necessary and not sufficient. This one
   * is chosen on MEANING: whoever may see the office's compliance picture may read the
   * correspondence behind a placement on a customer they are actively working. The alternatives
   * (`retention-schedule.confirm`, `privacy-notice.publish`, `incident.notify-regulator`,
   * `sla.policy.regulatory`, `sla.timer.pause`) hit the same set and say nothing about oversight of
   * a placement, so a reader of this gate would learn nothing true from them.
   */
  @RequirePermissions('rfq.read', 'dashboard.compliance.view')
  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.rfqs.get(id, user);
  }

  /** Broaden an existing RFQ's insurer shortlist. */
  @RequirePermissions('rfq.create')
  @Post(':id/insurers')
  addInsurers(
    @Param('id') id: string,
    @Body() dto: AddRfqInsurersDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rfqs.addInsurers(id, dto, user);
  }

  /** Process 12 — the broker<->insurer correspondence log for this RFQ.
   * Reading carries THE SAME GATE as the RFQ above — the same six roles, for the same reason, and
   * the same anchor behind it. Deliberately identical: a reader who may see the RFQ and not its
   * correspondence, or the reverse, would be a second answer to one question.
   * Logging still needs `rfq.communication.log` (Placement), and that write is untouched. */
  @RequirePermissions('rfq.read', 'dashboard.compliance.view')
  @Get(':id/communications')
  listCommunications(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rfqs.listCommunications(id, user);
  }

  @RequirePermissions('rfq.communication.log')
  @Post(':id/communications')
  logCommunication(
    @Param('id') id: string,
    @Body() dto: LogRfqCommunicationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rfqs.logCommunication(id, dto, user);
  }
}
