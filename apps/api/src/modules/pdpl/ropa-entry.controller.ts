import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RopaEntryService } from './ropa-entry.service';
import { CreateRopaEntryDto } from './dto/create-ropa-entry.dto';
import { UpdateRopaEntryDto } from './dto/update-ropa-entry.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Records of Processing Activities (Part 9.3). `ropa.manage` (DPO-only)
 * gates the whole surface. `GET :export` is registered before `GET :id` so
 * "export" is never swallowed as an :id param. */
@ApiTags('pdpl')
@Controller('ropa-entries')
export class RopaEntryController {
  constructor(private readonly ropa: RopaEntryService) {}

  @RequirePermissions('ropa.manage')
  @Post()
  create(
    @Body() dto: CreateRopaEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ropa.create(dto, user.id);
  }

  @RequirePermissions('ropa.manage')
  @Get()
  list() {
    return this.ropa.list();
  }

  @RequirePermissions('ropa.manage')
  @Get('export')
  export(@CurrentUser() user: AuthenticatedUser) {
    return this.ropa.export(user.id);
  }

  @RequirePermissions('ropa.manage')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.ropa.get(id);
  }

  @RequirePermissions('ropa.manage')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRopaEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ropa.update(id, dto, user.id);
  }
}
