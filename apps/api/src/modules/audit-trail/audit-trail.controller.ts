import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuditTrailService } from './audit-trail.service';
import { ListAuditTrailQueryDto } from './dto/list-audit-trail-query.dto';
import { WorkflowHistoryQueryDto } from './dto/workflow-history-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 57 (backlog Part C #57's second checkbox) — the External
 * Auditor's read-only lens: "logs, documents and workflow history" (Part
 * 5.1). Three routes, three pre-seeded permissions each getting their
 * first real consumer here:
 *
 *   - `GET /audit-trail` (`audit-log.read` — `[COMPLIANCE_OFFICER,
 *     SYSTEM_SECURITY_ADMINISTRATOR, EXTERNAL_AUDITOR]`) — the general
 *     browse, filterable by entityType/entityId/userId/action/date range.
 *   - `GET /audit-trail/documents/:id/history` (`document-history.read` —
 *     `[COMPLIANCE_OFFICER, EXTERNAL_AUDITOR]`) — a `Document`'s version
 *     chain plus its own audit trail.
 *   - `GET /audit-trail/workflow-history?entityType=&entityId=`
 *     (`workflow-history.read` — `[COMPLIANCE_OFFICER, EXTERNAL_AUDITOR]`)
 *     — the `TRANSITION` audit rows for one record, chronologically.
 *
 * No `AuthModule` import needed — the global `PermissionsGuard` /
 * `@CurrentUser` cover it (the `SlaDashboardController` pattern). The
 * static path `/documents/:id/history` is declared it as its own path
 * segment (not nested under a bare `:id`) precisely so it never collides
 * with `/audit-trail/workflow-history`'s own route.
 */
@ApiTags('audit-trail')
@Controller('audit-trail')
export class AuditTrailController {
  constructor(private readonly auditTrail: AuditTrailService) {}

  @RequirePermissions('audit-log.read')
  @Get()
  browse(
    @Query() query: ListAuditTrailQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.auditTrail.browseAuditLog(query, user.id);
  }

  @RequirePermissions('workflow-history.read')
  @Get('workflow-history')
  workflowHistory(
    @Query() query: WorkflowHistoryQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.auditTrail.workflowHistory(query, user.id);
  }

  @RequirePermissions('document-history.read')
  @Get('documents/:id/history')
  documentHistory(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.auditTrail.documentHistory(id, user.id);
  }
}
