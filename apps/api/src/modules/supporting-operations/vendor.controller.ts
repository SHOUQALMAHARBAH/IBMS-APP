import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { VendorService } from './vendor.service';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { UpdateVendorDto } from './dto/update-vendor.dto';
import { ListVendorsQueryDto } from './dto/list-vendors-query.dto';
import { SetVendorRiskTierDto } from './dto/set-vendor-risk-tier.dto';
import { TerminateVendorDto } from './dto/terminate-vendor.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 67 (Procurement) built the foundational CRUD; Process 71 (backlog
 * Part C #71, Domain H — Vendor Management) extends the SAME controller
 * with risk tiering, the annual-review action, termination + access
 * revocation, and the data-share readiness gate — all still under
 * `vendor.manage`.
 */
@ApiTags('supporting-operations')
@Controller('vendors')
export class VendorController {
  constructor(private readonly vendors: VendorService) {}

  @RequirePermissions('vendor.manage')
  @Post()
  create(@Body() dto: CreateVendorDto, @CurrentUser() user: AuthenticatedUser) {
    return this.vendors.create(dto, user.id);
  }

  @RequirePermissions('vendor.manage')
  @Get()
  list(@Query() query: ListVendorsQueryDto) {
    return this.vendors.list(query);
  }

  @RequirePermissions('vendor.manage')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.vendors.get(id);
  }

  @RequirePermissions('vendor.manage')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateVendorDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vendors.update(id, dto, user.id);
  }

  @RequirePermissions('vendor.manage')
  @Patch(':id/risk-tier')
  setRiskTier(
    @Param('id') id: string,
    @Body() dto: SetVendorRiskTierDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vendors.setRiskTier(id, dto, user.id);
  }

  @RequirePermissions('vendor.manage')
  @Post(':id/annual-review')
  recordAnnualReview(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vendors.recordAnnualReview(id, user.id);
  }

  @RequirePermissions('vendor.manage')
  @Post(':id/terminate')
  terminate(
    @Param('id') id: string,
    @Body() dto: TerminateVendorDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vendors.terminate(id, dto, user.id);
  }

  @RequirePermissions('vendor.manage')
  @Post(':id/revoke-access')
  revokeAccess(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vendors.revokeAccess(id, user.id);
  }

  @RequirePermissions('vendor.manage')
  @Get(':id/data-share-readiness')
  dataShareReadiness(@Param('id') id: string) {
    return this.vendors.dataShareReadiness(id);
  }
}
