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
import { InformationAssetService } from './information-asset.service';
import { CreateInformationAssetDto } from './dto/create-information-asset.dto';
import { UpdateInformationAssetDto } from './dto/update-information-asset.dto';
import { ListInformationAssetsQueryDto } from './dto/list-information-assets-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 69 (backlog Part C #69, Domain H) — Cybersecurity's own genuine
 * gap: the ISO 27001 Clause 8.1 asset inventory. `information-asset.manage`
 * (System Security Administrator / Compliance Officer) gates the whole
 * surface — a NEW permission (unlike #66/#67, this one had no pre-seeded
 * grant waiting).
 */
@ApiTags('supporting-operations')
@Controller('information-assets')
export class InformationAssetController {
  constructor(private readonly assets: InformationAssetService) {}

  @RequirePermissions('information-asset.manage')
  @Post()
  create(
    @Body() dto: CreateInformationAssetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assets.create(dto, user.id);
  }

  @RequirePermissions('information-asset.manage')
  @Get()
  list(@Query() query: ListInformationAssetsQueryDto) {
    return this.assets.list(query);
  }

  @RequirePermissions('information-asset.manage')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.assets.get(id);
  }

  @RequirePermissions('information-asset.manage')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateInformationAssetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assets.update(id, dto, user.id);
  }
}
