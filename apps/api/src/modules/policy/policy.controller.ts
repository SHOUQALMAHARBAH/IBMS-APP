import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PolicyService } from './policy.service';
import { PlacePolicyDto } from './dto/place-policy.dto';
import { RecordPolicyIssuanceDto } from './dto/record-policy-issuance.dto';
import { AttachPolicyDocumentsDto } from './dto/attach-policy-documents.dto';
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
  constructor(private readonly policies: PolicyService) {}

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
}
