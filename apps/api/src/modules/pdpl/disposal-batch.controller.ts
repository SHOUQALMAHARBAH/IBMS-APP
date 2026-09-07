import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DisposalBatchService } from './disposal-batch.service';
import { CreateDisposalBatchDto } from './dto/create-disposal-batch.dto';
import { RecordDisposalExecutionDto } from './dto/record-disposal-execution.dto';
import { ListDisposalBatchesQueryDto } from './dto/list-disposal-batches-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * M06 — the dual-control disposal workflow. `retention.dispose.nominate`
 * (Manager, the maker) gates nominate/manager-approve; `retention.dispose.
 * approve` (DPO, the checker) gates dpo-approve/execute/issue the
 * certificate/close. Reads accept either permission — a Manager checking
 * on a batch they nominated needs to see it too.
 */
@ApiTags('pdpl')
@Controller('disposal-batches')
export class DisposalBatchController {
  constructor(private readonly disposalBatches: DisposalBatchService) {}

  @RequirePermissions('retention.dispose.nominate')
  @Post()
  nominate(
    @Body() dto: CreateDisposalBatchDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.disposalBatches.nominate(dto, user.id);
  }

  @RequirePermissions('retention.dispose.nominate', 'retention.dispose.approve')
  @Get()
  list(@Query() query: ListDisposalBatchesQueryDto) {
    return this.disposalBatches.list(query);
  }

  @RequirePermissions('retention.dispose.nominate', 'retention.dispose.approve')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.disposalBatches.get(id);
  }

  @RequirePermissions('retention.dispose.nominate')
  @Post(':id/manager-approve')
  managerApprove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.disposalBatches.managerApprove(id, user.id);
  }

  @RequirePermissions('retention.dispose.approve')
  @Post(':id/dpo-approve')
  dpoApprove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.disposalBatches.dpoApprove(id, user.id);
  }

  @RequirePermissions('retention.dispose.approve')
  @Post(':id/execute')
  execute(
    @Param('id') id: string,
    @Body() dto: RecordDisposalExecutionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.disposalBatches.execute(id, dto, user.id);
  }

  @RequirePermissions('retention.dispose.approve')
  @Post(':id/certificate')
  issueCertificate(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.disposalBatches.issueCertificate(id, user.id);
  }

  @RequirePermissions('retention.dispose.approve')
  @Post(':id/close')
  close(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.disposalBatches.close(id, user.id);
  }
}
