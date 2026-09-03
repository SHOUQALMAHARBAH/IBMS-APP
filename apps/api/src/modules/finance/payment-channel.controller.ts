import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PaymentChannelService } from './payment-channel.service';
import { CreatePaymentChannelDto } from './dto/create-payment-channel.dto';
import { ListPaymentChannelsQueryDto } from './dto/list-payment-channels-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 38 (backlog Part C #38, Domain D) — Payment Processing: the approved
 * `PaymentChannel` list for customers and insurers. Finance maintains it
 * (`payment-channel.manage`); #32's collection cycle references a channel on a
 * `Receipt` / `Remittance`. No `AuthModule` import — the global
 * `PermissionsGuard` + `@CurrentUser` cover it (same as the rest of
 * `FinanceModule`).
 */
@ApiTags('finance')
@Controller('payment-channels')
export class PaymentChannelController {
  constructor(private readonly channels: PaymentChannelService) {}

  @RequirePermissions('payment-channel.manage')
  @Post()
  create(
    @Body() dto: CreatePaymentChannelDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.channels.create(dto, user.id);
  }

  @RequirePermissions('payment-channel.manage')
  @Get()
  list(@Query() query: ListPaymentChannelsQueryDto) {
    return this.channels.list(query);
  }

  @RequirePermissions('payment-channel.manage')
  @Post(':id/disable')
  disable(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.channels.disable(id, user.id);
  }
}
