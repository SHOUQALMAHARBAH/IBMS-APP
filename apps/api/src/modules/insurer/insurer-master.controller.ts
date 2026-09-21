import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { InsurerMasterService } from './insurer-master.service';
import { MapInsurerFormDto } from './dto/map-insurer-form.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

class ListFormsQueryDto {
  /** A GLOBAL `InsuranceLine.id`. Omit it for every line this insurer has a mapping for. */
  @IsOptional()
  @IsUUID()
  insuranceLineId?: string;
}

class CurrentFormQueryDto {
  /** A GLOBAL `InsuranceLine.id` — required here, because "the version to submit against"
   *  is a question about one line. */
  @IsUUID()
  insuranceLineId!: string;
}

/**
 * Part I §5 — the GLOBAL insurer registry.
 *
 * Note what is absent: there is no Organization filter on any route here, and
 * that is the feature, not an oversight. A form mapped once by whoever first
 * dealt with this insurer is immediately available, unmodified, to every other
 * office — the Part V multi-tenancy checklist item this module exists to
 * satisfy.
 *
 * The commercially sensitive half of an insurer relationship is not served
 * here at all: the negotiated commission, the named contacts and the credit
 * terms live on the tenant-scoped `Insurer` row and are filtered like every
 * other table.
 */
@ApiTags('insurer')
@Controller('insurer-masters')
export class InsurerMasterController {
  constructor(private readonly masters: InsurerMasterService) {}

  @RequirePermissions('insurer.master.read')
  @Get()
  list() {
    return this.masters.list();
  }

  @RequirePermissions('insurer.master.read')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.masters.get(id);
  }

  @RequirePermissions('insurer.master.read')
  @Get(':id/form-templates')
  listForms(@Param('id') id: string, @Query() query: ListFormsQueryDto) {
    return this.masters.listForms(id, query.insuranceLineId);
  }

  /**
   * The version to submit against for one line, or `null` when nobody has
   * mapped this insurer+line yet — see `currentForm` for why null is a real
   * answer rather than a 404.
   *
   * Declared BEFORE `:id/form-templates/:templateId` would be, if one is ever
   * added: Nest matches routes in declaration order, so a later literal segment
   * behind a parameter route is unreachable.
   */
  @RequirePermissions('insurer.master.read')
  @Get(':id/form-templates/current')
  currentForm(@Param('id') id: string, @Query() query: CurrentFormQueryDto) {
    return this.masters.currentForm(id, query.insuranceLineId);
  }

  @RequirePermissions('insurer.form.map')
  @Post(':id/form-templates')
  mapForm(
    @Param('id') id: string,
    @Body() dto: MapInsurerFormDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.masters.mapForm(id, dto, user.id);
  }
}
