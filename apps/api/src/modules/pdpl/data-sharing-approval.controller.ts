import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DataSharingApprovalService } from './data-sharing-approval.service';
import { CreateDataSharingApprovalDto } from './dto/create-data-sharing-approval.dto';
import { ListDataSharingApprovalsQueryDto } from './dto/list-data-sharing-approvals-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** M08 — Third Parties & Data Sharing. `data-sharing.request` (maker) gates
 * create; `data-sharing.approve` (DPO, checker) gates approve/decline.
 * Reads accept either permission — a requester checking on their own
 * pending request needs to see it too. */
@ApiTags('pdpl')
@Controller('data-sharing-approvals')
export class DataSharingApprovalController {
  constructor(private readonly dataSharing: DataSharingApprovalService) {}

  @RequirePermissions('data-sharing.request')
  @Post()
  create(
    @Body() dto: CreateDataSharingApprovalDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dataSharing.create(dto, user.id);
  }

  @RequirePermissions('data-sharing.request', 'data-sharing.approve')
  @Get()
  list(@Query() query: ListDataSharingApprovalsQueryDto) {
    return this.dataSharing.list(query);
  }

  @RequirePermissions('data-sharing.request', 'data-sharing.approve')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.dataSharing.get(id);
  }

  @RequirePermissions('data-sharing.approve')
  @Post(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.dataSharing.approve(id, user.id);
  }

  @RequirePermissions('data-sharing.approve')
  @Post(':id/decline')
  decline(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.dataSharing.decline(id, user.id);
  }
}
