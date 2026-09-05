import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DsrService } from './dsr.service';
import { CreateDsrDto } from './dto/create-dsr.dto';
import { AssignDsrDto } from './dto/assign-dsr.dto';
import { ApplyDsrExtensionDto } from './dto/apply-dsr-extension.dto';
import { FulfilDsrDto } from './dto/fulfil-dsr.dto';
import { PartiallyFulfilDsrDto } from './dto/partially-fulfil-dsr.dto';
import { RejectDsrDto } from './dto/reject-dsr.dto';
import { ListDsrQueryDto } from './dto/list-dsr-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * M04 (backlog Part D, Process #52) — Data Subject Request Management.
 * `dsr.log` (broad — any front-line role that might receive a request) gates
 * create + read; `dsr.handle` (DPO-only) gates every working action;
 * `dsr.close` (DPO-only) gates the mandatory-sign-off closure —
 * `dsr.service.ts`'s header comment.
 */
@ApiTags('pdpl')
@Controller('dsr')
export class DsrController {
  constructor(private readonly dsr: DsrService) {}

  @RequirePermissions('dsr.log')
  @Post()
  create(@Body() dto: CreateDsrDto, @CurrentUser() user: AuthenticatedUser) {
    return this.dsr.create(dto, user.id);
  }

  @RequirePermissions('dsr.log')
  @Get()
  list(
    @Query() query: ListDsrQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dsr.list(query, user.id);
  }

  @RequirePermissions('dsr.log')
  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.dsr.get(id, user.id);
  }

  @RequirePermissions('dsr.handle')
  @Post(':id/verify-identity')
  verifyIdentity(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dsr.verifyIdentity(id, user.id);
  }

  @RequirePermissions('dsr.handle')
  @Post(':id/start')
  start(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.dsr.start(id, user.id);
  }

  @RequirePermissions('dsr.handle')
  @Post(':id/assign')
  assign(
    @Param('id') id: string,
    @Body() dto: AssignDsrDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dsr.assign(id, dto, user.id);
  }

  @RequirePermissions('dsr.handle')
  @Post(':id/apply-extension')
  applyExtension(
    @Param('id') id: string,
    @Body() dto: ApplyDsrExtensionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dsr.applyExtension(id, dto, user.id);
  }

  @RequirePermissions('dsr.handle')
  @Post(':id/fulfil')
  fulfil(
    @Param('id') id: string,
    @Body() dto: FulfilDsrDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dsr.fulfil(id, dto, user.id);
  }

  @RequirePermissions('dsr.handle')
  @Post(':id/partially-fulfil')
  partiallyFulfil(
    @Param('id') id: string,
    @Body() dto: PartiallyFulfilDsrDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dsr.partiallyFulfil(id, dto, user.id);
  }

  @RequirePermissions('dsr.handle')
  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectDsrDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dsr.reject(id, dto, user.id);
  }

  @RequirePermissions('dsr.close')
  @Post(':id/close')
  close(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.dsr.close(id, user.id);
  }
}
