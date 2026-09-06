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
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 67 (backlog Part C #67, Domain H) — Procurement. `vendor.manage`
 * (already pre-seeded, Compliance Officer / Branch-Department Manager /
 * System Security Administrator) gates the whole surface — the same
 * permission #71 (Vendor Management, not built here) will reuse for its own
 * richer risk-tiering/DPA actions on this same model.
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
}
