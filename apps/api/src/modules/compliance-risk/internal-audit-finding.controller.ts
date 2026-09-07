import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InternalAuditFindingService } from './internal-audit-finding.service';
import { CreateInternalAuditFindingDto } from './dto/create-internal-audit-finding.dto';
import { UpdateInternalAuditFindingRemediationDto } from './dto/update-internal-audit-finding-remediation.dto';
import { ListInternalAuditFindingQueryDto } from './dto/list-internal-audit-finding-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 57 (backlog Part C #57's first checkbox) — the internal audit
 * findings and remediation tracker. `internal-audit.record`
 * (`[COMPLIANCE_OFFICER]`) gates recording/updating; `internal-audit.close`
 * (`[COMPLIANCE_OFFICER, BRANCH_DEPARTMENT_MANAGER]`) gates closure. Reads
 * accept EITHER (a Manager reviewing before closing needs to see the
 * finding too).
 */
@ApiTags('compliance-risk')
@Controller('internal-audit-findings')
export class InternalAuditFindingController {
  constructor(private readonly findings: InternalAuditFindingService) {}

  @RequirePermissions('internal-audit.record')
  @Post()
  create(
    @Body() dto: CreateInternalAuditFindingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.findings.create(dto, user.id);
  }

  @RequirePermissions('internal-audit.record', 'internal-audit.close')
  @Get()
  list(@Query() query: ListInternalAuditFindingQueryDto) {
    return this.findings.list(query);
  }

  @RequirePermissions('internal-audit.record', 'internal-audit.close')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.findings.get(id);
  }

  @RequirePermissions('internal-audit.record')
  @Post(':id/remediation')
  recordRemediation(
    @Param('id') id: string,
    @Body() dto: UpdateInternalAuditFindingRemediationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.findings.recordRemediation(id, dto, user.id);
  }

  @RequirePermissions('internal-audit.close')
  @Post(':id/close')
  close(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.findings.close(id, user.id);
  }
}
