import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PolicyService } from './policy.service';
import { PolicyCheckingService } from './policy-checking.service';
import { PolicyDeliveryService } from './policy-delivery.service';
import { PlacePolicyDto } from './dto/place-policy.dto';
import { RecordPolicyIssuanceDto } from './dto/record-policy-issuance.dto';
import { AttachPolicyDocumentsDto } from './dto/attach-policy-documents.dto';
import { RecordPolicyCheckingDto } from './dto/record-policy-checking.dto';
import { RecordPolicyDeliveryDto } from './dto/record-policy-delivery.dto';
import { AcknowledgeReceiptDto } from './dto/acknowledge-receipt.dto';
import { ListPoliciesQueryDto } from './dto/list-policies-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Process 18-19 — Policy Placement & Issuance (backlog Part C #18-19, Domain
 * B). Create the `Policy` from an accepted Opportunity and set its inception
 * date, then record the insurer-issued policy / schedule / documents / premium
 * invoice and move it to `ISSUED`. See policy.service.ts for the rules.
 * Frontend: the "Policy" section on apps/web/app/(app)/opportunities/[id]/. */
@ApiTags('policies')
@Controller('policies')
export class PolicyController {
  constructor(
    private readonly policies: PolicyService,
    private readonly policyChecking: PolicyCheckingService,
    private readonly policyDelivery: PolicyDeliveryService,
  ) {}

  @RequirePermissions('policy.create')
  @Post()
  place(@Body() dto: PlacePolicyDto, @CurrentUser() user: AuthenticatedUser) {
    return this.policies.place(dto, user);
  }

  @RequirePermissions('policy.read')
  @Get()
  list(
    @Query() query: ListPoliciesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.policies.list(query, user);
  }

  @RequirePermissions('policy.read')
  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.policies.get(id, user);
  }

  /** Record the insurer-issued policy: number, issued premium, opening
   * coverage schedule, issued documents. Drives PLACEMENT_CONFIRMED ->
   * ISSUED through the workflow engine. */
  @RequirePermissions('policy.issue')
  @Post(':id/issuance')
  recordIssuance(
    @Param('id') id: string,
    @Body() dto: RecordPolicyIssuanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.policies.recordIssuance(id, dto, user);
  }

  /** Attach documents to the policy's electronic Insurance File (Part 4.2)
   * at any lifecycle stage — used when certificates / an endorsement
   * template / the wording PDF arrive separately. */
  @RequirePermissions('document.manage')
  @Post(':id/documents')
  attachDocuments(
    @Param('id') id: string,
    @Body() dto: AttachPolicyDocumentsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.policies.attachDocuments(id, dto, user);
  }

  /** Process 20 — the mandatory maker/checker quality-control check: a
   * line-by-line comparison of Requested Coverage vs the issued policy
   * schedule. The checker must not be the officer who placed the cover; a
   * discrepancy drives the policy to `DISCREPANCY` (blocking Delivery) and
   * auto-logs a Professional Indemnity risk event. */
  @RequirePermissions('policy.check')
  @Post(':id/checking')
  check(
    @Param('id') id: string,
    @Body() dto: RecordPolicyCheckingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.policyChecking.check(id, dto, user);
  }

  /** Process 21 — record that the issued policy document was delivered to the
   * client (`method` / `recipient` / `deliveredAt`). Drives `VERIFIED →
   * DELIVERED`. */
  @RequirePermissions('policy.deliver')
  @Post(':id/delivery')
  recordDelivery(
    @Param('id') id: string,
    @Body() dto: RecordPolicyDeliveryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.policyDelivery.recordDelivery(id, dto, user);
  }

  /** Process 21 — record the client's confirmation of receipt. Stamps
   * `DeliveryRecord.receiptAcknowledgedAt` and best-effort advances the
   * policy `DELIVERED → ACTIVE`. */
  @RequirePermissions('policy.deliver')
  @Post(':id/delivery/acknowledge-receipt')
  acknowledgeReceipt(
    @Param('id') id: string,
    @Body() dto: AcknowledgeReceiptDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.policyDelivery.acknowledgeReceipt(id, dto, user);
  }
}
