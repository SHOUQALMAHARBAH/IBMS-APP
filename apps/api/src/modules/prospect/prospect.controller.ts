import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ProspectService } from './prospect.service';
import { CreateProspectDto } from './dto/create-prospect.dto';
import { ListProspectsQueryDto } from './dto/list-prospects-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Process 2 — Prospect Management. Frontend:
 * apps/web/app/(app)/prospects/ (conversion form + profile screen). */
@ApiTags('prospects')
@Controller('prospects')
export class ProspectController {
  constructor(private readonly prospects: ProspectService) {}

  @RequirePermissions('prospect.capture')
  @Post()
  convert(
    @Body() dto: CreateProspectDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.prospects.convert(dto, user.id);
  }

  @RequirePermissions('prospect.read')
  @Get()
  list(
    @Query() query: ListProspectsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.prospects.list(query, user);
  }

  @RequirePermissions('prospect.read')
  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.prospects.get(id, user);
  }
}
