import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BrokerLicenseService } from './broker-license.service';
import { CreateBrokerLicenseDto } from './dto/create-broker-license.dto';
import { RenewBrokerLicenseDto } from './dto/renew-broker-license.dto';
import { RecordRenewalRequestDto } from './dto/record-renewal-request.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 51/Part 7.1, restructured by Module 0 item (c) — this OFFICE's CBJ licence, as a SERIES
 * OF TERMS. `license.manage` (`[COMPLIANCE_OFFICER]`) gates every route, unchanged.
 *
 * NOT a singleton any more, and the correction matters: the id it used to be keyed by was the
 * table's PRIMARY KEY, so there was one licence row for the whole platform rather than one per
 * office. The second office to POST here collided on `BrokerLicense_pkey` and could never hold a
 * licence, while its own gate then read the absence as "not blocked".
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

  /** Records that the renewal application for the NEXT term has been filed, against the current
   * term — art. 11 measures its 45-day deadline from that term's expiry. Write-once: the filing
   * date is what lateness is judged by, so a second call is a 409 rather than an overwrite. */
  @RequirePermissions('license.manage')
  @Post('renewal-requested')
  recordRenewalRequest(
    @Body() dto: RecordRenewalRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.licenses.recordRenewalRequest(dto, user.id);
  }

  /** Manual lapse ahead of the calendar `expiresAt` (e.g. a CBJ suspension).
   * No body — the model has no reason field to hold one. */
  @RequirePermissions('license.manage')
  @Post('mark-lapsed')
  markLapsed(@CurrentUser() user: AuthenticatedUser) {
    return this.licenses.markLapsed(user.id);
  }

  /** The current term AND the series. Does not 404 on an office with no licence: that is a real
   * state the screen must be able to render, and it is also the state that blocks new business. */
  @RequirePermissions('license.manage')
  @Get()
  get() {
    return this.licenses.get();
  }
}
