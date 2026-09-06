import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CrossBorderTransferService } from './cross-border-transfer.service';
import { CreateCrossBorderTransferDto } from './dto/create-cross-border-transfer.dto';
import { ListCrossBorderTransfersQueryDto } from './dto/list-cross-border-transfers-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Cross-Border Transfer (Part 6.2 — no single M01-M12 module name applies,
 * see `cross-border-transfer.config.ts`'s header comment). `cross-border-
 * transfer.approve` (DPO-only) gates the whole surface — logging a transfer
 * here IS approving it. */
@ApiTags('pdpl')
@Controller('cross-border-transfers')
export class CrossBorderTransferController {
  constructor(private readonly transfers: CrossBorderTransferService) {}

  @RequirePermissions('cross-border-transfer.approve')
  @Post()
  create(
    @Body() dto: CreateCrossBorderTransferDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.transfers.create(dto, user.id);
  }

  @RequirePermissions('cross-border-transfer.approve')
  @Get()
  list(@Query() query: ListCrossBorderTransfersQueryDto) {
    return this.transfers.list(query);
  }

  @RequirePermissions('cross-border-transfer.approve')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.transfers.get(id);
  }
}
