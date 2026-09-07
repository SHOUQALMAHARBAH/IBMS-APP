import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ServiceRequestService } from './service-request.service';
import { CreateServiceRequestDto } from './dto/create-service-request.dto';
import { AssignServiceRequestDto } from './dto/assign-service-request.dto';
import { CloseServiceRequestDto } from './dto/close-service-request.dto';
import { ListServiceRequestsQueryDto } from './dto/list-service-requests-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 41 (backlog Part C #41, Domain E) — Customer Requests. Log a customer
 * service request, assign it, start it, and close it (fulfil / cancel) — its
 * fulfilment is tracked against an SLA timer. Every route is
 * `service-request.manage` (`[SALES_RELATIONSHIP_OFFICER,
 * BRANCH_DEPARTMENT_MANAGER]`). No `AuthModule` import — the global
 * `PermissionsGuard` + `@CurrentUser` cover it.
 */
@ApiTags('customer-service')
@Controller('service-requests')
export class ServiceRequestController {
  constructor(private readonly serviceRequests: ServiceRequestService) {}

  @RequirePermissions('service-request.manage')
  @Post()
  create(
    @Body() dto: CreateServiceRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.serviceRequests.create(dto, user.id);
  }

  @RequirePermissions('service-request.manage')
  @Get()
  list(@Query() query: ListServiceRequestsQueryDto) {
    return this.serviceRequests.list(query);
  }

  @RequirePermissions('service-request.manage')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.serviceRequests.get(id);
  }

  @RequirePermissions('service-request.manage')
  @Post(':id/assign')
  assign(
    @Param('id') id: string,
    @Body() dto: AssignServiceRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.serviceRequests.assign(id, dto.assignedToUserId, user.id);
  }

  @RequirePermissions('service-request.manage')
  @Post(':id/start')
  start(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.serviceRequests.start(id, user.id);
  }

  @RequirePermissions('service-request.manage')
  @Post(':id/fulfil')
  fulfil(
    @Param('id') id: string,
    @Body() dto: CloseServiceRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.serviceRequests.fulfil(id, dto, user.id);
  }

  @RequirePermissions('service-request.manage')
  @Post(':id/cancel')
  cancel(
    @Param('id') id: string,
    @Body() dto: CloseServiceRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.serviceRequests.cancel(id, dto, user.id);
  }
}
