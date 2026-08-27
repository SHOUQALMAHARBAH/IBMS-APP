import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RiskProfileService } from './risk-profile.service';
import { CreateRiskProfileDto } from './dto/create-risk-profile.dto';
import { CreateAssetDto } from './dto/create-asset.dto';
import { ListRiskProfilesQueryDto } from './dto/list-risk-profiles-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Process 6 — Risk Assessment (backlog Part C #6). The detailed risk survey
 * (Asset lines), the Sum Insured / indemnity-period derivation, and the
 * multi-site consolidation — see risk-profile.service.ts. Frontend:
 * apps/web/app/(app)/risk-profiles/ (per-site survey + consolidated view),
 * reached from a customer's profile. */
@ApiTags('risk-profiles')
@Controller('risk-profiles')
export class RiskProfileController {
  constructor(private readonly riskProfiles: RiskProfileService) {}

  @RequirePermissions('risk-profile.create')
  @Post()
  create(
    @Body() dto: CreateRiskProfileDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.riskProfiles.create(dto, user);
  }

  @RequirePermissions('risk-profile.read')
  @Get()
  list(
    @Query() query: ListRiskProfilesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.riskProfiles.list(query.customerId, user);
  }

  /** Every site's survey for one customer + the consolidated Sum Insured
   * roll-up. Declared before `:id` so "consolidated" is never parsed as an id. */
  @RequirePermissions('risk-profile.read')
  @Get('consolidated')
  consolidated(
    @Query() query: ListRiskProfilesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.riskProfiles.getConsolidated(query.customerId, user);
  }

  @RequirePermissions('risk-profile.read')
  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.riskProfiles.get(id, user);
  }

  @RequirePermissions('risk-profile.create')
  @Post(':id/assets')
  addAsset(
    @Param('id') id: string,
    @Body() dto: CreateAssetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.riskProfiles.addAsset(id, dto, user);
  }

  /** Replaces the asset's survey fields wholesale — send the complete body
   * (see CreateAssetDto). */
  @RequirePermissions('risk-profile.create')
  @Patch(':id/assets/:assetId')
  updateAsset(
    @Param('id') id: string,
    @Param('assetId') assetId: string,
    @Body() dto: CreateAssetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.riskProfiles.updateAsset(id, assetId, dto, user);
  }

  @RequirePermissions('risk-profile.create')
  @Delete(':id/assets/:assetId')
  @HttpCode(204)
  async removeAsset(
    @Param('id') id: string,
    @Param('assetId') assetId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.riskProfiles.removeAsset(id, assetId, user);
  }
}
