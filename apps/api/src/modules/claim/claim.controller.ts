import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ClaimService } from './claim.service';
import { NotifyClaimDto } from './dto/notify-claim.dto';
import { RegisterClaimDto } from './dto/register-claim.dto';
import { AttachClaimDocumentsDto } from './dto/attach-claim-documents.dto';
import { RecordAdjusterProgressDto } from './dto/record-adjuster-progress.dto';
import { DecideClaimAssessmentDto } from './dto/decide-claim-assessment.dto';
import { RecordSettlementDto } from './dto/record-settlement.dto';
import { CloseClaimDto } from './dto/close-claim.dto';
import { ListClaimsQueryDto } from './dto/list-claims-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Process 23-29 — Claim Notification + Registration + Documentation +
 * Assessment + Follow-up + Settlement + Closure (backlog Part C #23-29, Domain C). Record
 * a reported loss against a Policy (with coverage-at-loss-date validation),
 * register it with the insurer and assign the loss adjuster (`NOTIFIED →
 * REGISTERED`), file the mandatory documentation — a per-claim-type checklist —
 * with the first attach advancing `REGISTERED → DOCUMENTATION_IN_PROGRESS`,
 * track the adjuster's survey / investigation, submit the claim for insurer
 * assessment (`DOCUMENTATION_IN_PROGRESS → UNDER_ASSESSMENT`, gated on the
 * checklist), record the verdict (`UNDER_ASSESSMENT → APPROVED |
 * PARTIALLY_APPROVED | DECLINED`), raise a `ClaimFollowUpAlert` (nightly or on
 * demand) on any pre-verdict claim past its per-line insurer non-response
 * threshold, record the settlement's four distinct figures with a mandatory
 * second approver for large / broker-processed payments (`→ SETTLED`), and
 * formally close the claim once the client's payment receipt is confirmed
 * (`→ CLOSED`, triggering a Loss Ratio recompute). See claim.service.ts for the
 * rules. Frontend: the "Claims" block in the "Policy" section on
 * apps/web/app/(app)/opportunities/[id]/. */
@ApiTags('claims')
@Controller('claims')
export class ClaimController {
  constructor(private readonly claims: ClaimService) {}

  @RequirePermissions('claim.notify')
  @Post()
  notify(@Body() dto: NotifyClaimDto, @CurrentUser() user: AuthenticatedUser) {
    return this.claims.notify(dto, user);
  }

  /** Process 27 — run the insurer non-response follow-up sweep now (it is
   * otherwise nightly). Returns counts only, no claim content. Declared before
   * the `:id` routes so `follow-up-sweep` is never read as a claim id. */
  @RequirePermissions('claim.followup.manage')
  @Post('follow-up-sweep')
  runFollowUpSweep(@CurrentUser() user: AuthenticatedUser) {
    return this.claims.runFollowUpScan(user.id);
  }

  /** Process 24 — register a NOTIFIED claim with the insurer (recording its
   * reference) and assign the loss adjuster. Drives `Claim NOTIFIED →
   * REGISTERED` through the workflow engine. */
  @RequirePermissions('claim.register')
  @Post(':id/registration')
  register(
    @Param('id') id: string,
    @Body() dto: RegisterClaimDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.claims.register(id, dto, user);
  }

  /** Process 25 — attach one or more documentation files to a claim's
   * electronic file. Valid from `REGISTERED` onward; the first attach
   * best-effort advances `REGISTERED → DOCUMENTATION_IN_PROGRESS`. The
   * response carries the per-claim-type mandatory checklist +
   * `documentationComplete`. */
  @RequirePermissions('claim.document')
  @Post(':id/documents')
  attachDocuments(
    @Param('id') id: string,
    @Body() dto: AttachClaimDocumentsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.claims.attachDocuments(id, dto, user);
  }

  /** Process 26 — stamp the loss adjuster's survey / investigation completion
   * (write-once per field). Valid from `REGISTERED` until a verdict is
   * recorded. */
  @RequirePermissions('claim.assess')
  @Post(':id/assessment/adjuster-progress')
  recordAdjusterProgress(
    @Param('id') id: string,
    @Body() dto: RecordAdjusterProgressDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.claims.recordAdjusterProgress(id, dto, user);
  }

  /** Process 26 — submit the claim to the insurer for assessment
   * (`DOCUMENTATION_IN_PROGRESS → UNDER_ASSESSMENT`). Gated on the mandatory
   * documentation checklist being complete. */
  @RequirePermissions('claim.assess')
  @Post(':id/assessment/submit')
  submitForAssessment(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.claims.submitForAssessment(id, user);
  }

  /** Process 26 — record the insurer's assessment verdict
   * (`UNDER_ASSESSMENT → APPROVED | PARTIALLY_APPROVED | DECLINED`). */
  @RequirePermissions('claim.assess')
  @Post(':id/assessment/decision')
  decideAssessment(
    @Param('id') id: string,
    @Body() dto: DecideClaimAssessmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.claims.decideAssessment(id, dto, user);
  }

  /** Process 27 — a Claims Officer manually resolves an open follow-up alert
   * (they chased the insurer; the claim's status is not touched). */
  @RequirePermissions('claim.followup.manage')
  @Post(':id/follow-up-alerts/:alertId/resolve')
  resolveFollowUpAlert(
    @Param('id') id: string,
    @Param('alertId') alertId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.claims.resolveFollowUpAlert(id, alertId, user);
  }

  /** Process 28 — record the settlement's four distinct figures (first
   * approver). Drives `Claim → SETTLED` immediately unless a mandatory second
   * approver is required. */
  @RequirePermissions('claim.settle.approve')
  @Post(':id/settlement')
  recordSettlement(
    @Param('id') id: string,
    @Body() dto: RecordSettlementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.claims.recordSettlement(id, dto, user);
  }

  /** Process 28 — the mandatory second approval on a large / broker-processed
   * settlement (never the same user as the first approver). Drives `Claim →
   * SETTLED`. */
  @RequirePermissions('claim.settle.second-approve')
  @Post(':id/settlement/second-approve')
  secondApproveSettlement(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.claims.secondApproveSettlement(id, user);
  }

  /** Process 29 — formal closure. `SETTLED → CLOSED` once the client's receipt
   * of the settlement payment is confirmed (`clientPaymentConfirmedAt`,
   * write-once); `DECLINED → CLOSED` directly (no body). Best-effort triggers a
   * Loss Ratio recompute for the policy. */
  @RequirePermissions('claim.close')
  @Post(':id/closure')
  closeClaim(
    @Param('id') id: string,
    @Body() dto: CloseClaimDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.claims.closeClaim(id, dto, user);
  }

  @RequirePermissions('claim.read')
  @Get()
  list(
    @Query() query: ListClaimsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.claims.list(query, user);
  }

  @RequirePermissions('claim.read')
  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.claims.get(id, user);
  }
}
