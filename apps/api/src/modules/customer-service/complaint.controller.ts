import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ComplaintService } from './complaint.service';
import { CreateComplaintDto } from './dto/create-complaint.dto';
import { AssignComplaintDto } from './dto/assign-complaint.dto';
import { ComplaintActionDto } from './dto/complaint-action.dto';
import { ResolveComplaintDto } from './dto/resolve-complaint.dto';
import { EscalateComplaintDto } from './dto/escalate-complaint.dto';
import { ListComplaintsQueryDto } from './dto/list-complaints-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 42 (backlog Part C #42, Domain E) — Complaints Management. Log a
 * complaint (optionally against a disputed claim), assign / work / resolve it,
 * escalate it to the Insurance Dispute Resolution Committee when it cannot be
 * resolved internally, and close it — closure needs a **mandatory supervisor
 * sign-off** (`complaint.close` / MANAGER, a different user than the resolver).
 *
 *   - `complaint.log`      — log / assign / start / add-action / resolve / read
 *     (`[SALES, CLAIMS, FINANCE, COMPLIANCE, MANAGER]`)
 *   - `complaint.escalate` — `[MANAGER, COMPLIANCE]`
 *   - `complaint.close`    — `[MANAGER]`
 *
 * The global `PermissionsGuard` + `@CurrentUser` cover it — no `AuthModule`
 * import.
 */
@ApiTags('customer-service')
@Controller('complaints')
export class ComplaintController {
  constructor(private readonly complaints: ComplaintService) {}

  @RequirePermissions('complaint.log')
  @Post()
  create(
    @Body() dto: CreateComplaintDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.complaints.create(dto, user.id);
  }

  @RequirePermissions('complaint.log')
  @Get()
  list(@Query() query: ListComplaintsQueryDto) {
    return this.complaints.list(query);
  }

  @RequirePermissions('complaint.log')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.complaints.get(id);
  }

  @RequirePermissions('complaint.log')
  @Post(':id/assign')
  assign(
    @Param('id') id: string,
    @Body() dto: AssignComplaintDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.complaints.assign(id, dto.responsibleEmployeeUserId, user.id);
  }

  @RequirePermissions('complaint.log')
  @Post(':id/start')
  start(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.complaints.start(id, user.id);
  }

  @RequirePermissions('complaint.log')
  @Post(':id/actions')
  addAction(
    @Param('id') id: string,
    @Body() dto: ComplaintActionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.complaints.addAction(id, dto, user.id);
  }

  @RequirePermissions('complaint.log')
  @Post(':id/resolve')
  resolve(
    @Param('id') id: string,
    @Body() dto: ResolveComplaintDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.complaints.resolve(id, dto, user.id);
  }

  @RequirePermissions('complaint.escalate')
  @Post(':id/escalate')
  escalate(
    @Param('id') id: string,
    @Body() dto: EscalateComplaintDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.complaints.escalate(id, dto, user.id);
  }

  @RequirePermissions('complaint.close')
  @Post(':id/close')
  close(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.complaints.close(id, user.id);
  }
}
