import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ClaimService } from './claim.service';
import { NotifyClaimDto } from './dto/notify-claim.dto';
import { RegisterClaimDto } from './dto/register-claim.dto';
import { AttachClaimDocumentsDto } from './dto/attach-claim-documents.dto';
import { ListClaimsQueryDto } from './dto/list-claims-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Process 23-25 — Claim Notification + Registration + Documentation (backlog
 * Part C #23-25, Domain C). Record a reported loss against a Policy (with
 * coverage-at-loss-date validation), register it with the insurer and assign
 * the loss adjuster (`NOTIFIED → REGISTERED`), then file the mandatory
 * documentation — a per-claim-type checklist of claim form / police report /
 * medical report / photos / invoices / repair estimate / expert report — with
 * the first attach advancing `REGISTERED → DOCUMENTATION_IN_PROGRESS`. See
 * claim.service.ts for the rules. Frontend: the "Claims" block in the "Policy"
 * section on apps/web/app/(app)/opportunities/[id]/. */
@ApiTags('claims')
@Controller('claims')
export class ClaimController {
  constructor(private readonly claims: ClaimService) {}

  @RequirePermissions('claim.notify')
  @Post()
  notify(@Body() dto: NotifyClaimDto, @CurrentUser() user: AuthenticatedUser) {
    return this.claims.notify(dto, user);
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
