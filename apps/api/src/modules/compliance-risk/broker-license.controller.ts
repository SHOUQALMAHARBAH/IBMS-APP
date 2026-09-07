import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BrokerLicenseService } from './broker-license.service';
import { CreateBrokerLicenseDto } from './dto/create-broker-license.dto';
import { RenewBrokerLicenseDto } from './dto/renew-broker-license.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 51/Part 7.1 (backlog Part C #51's first checkbox) — the broker's
 * own CBJ license record. `license.manage` (`[COMPLIANCE_OFFICER]`) gates
 * every route. A singleton resource — see `broker-license.config.ts`'s
 * `BROKER_LICENSE_SINGLETON_ID`.
 */
@ApiTags('compliance-risk')
@Controller('broker-license')
export class BrokerLicenseController {
  constructor(private readonly licenses: BrokerLicenseService) {}

  @RequirePermissions('license.manage')
  @Post()
  create(
    @Body() dto: CreateBrokerLicenseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.licenses.create(dto, user.id);
  }

  @RequirePermissions('license.manage')
  @Post('renew')
  renew(
    @Body() dto: RenewBrokerLicenseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.licenses.renew(dto, user.id);
  }

  /** Manual lapse ahead of the calendar `expiresAt` (e.g. a CBJ suspension).
   * No body — the model has no reason field to hold one. */
  @RequirePermissions('license.manage')
  @Post('mark-lapsed')
  markLapsed(@CurrentUser() user: AuthenticatedUser) {
    return this.licenses.markLapsed(user.id);
  }

  @RequirePermissions('license.manage')
  @Get()
  get() {
    return this.licenses.get();
  }
}
