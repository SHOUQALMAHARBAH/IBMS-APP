import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InsuranceProgramService } from './insurance-program.service';
import { AssembleInsuranceProgramDto } from './dto/assemble-insurance-program.dto';
import { ListInsuranceProgramsQueryDto } from './dto/list-insurance-programs-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Process 7 — Product Recommendation / Program Design (backlog Part C #7).
 * Assembles a multi-line `InsuranceProgram` from an APPROVED Needs
 * Assessment's coverage list + the parent Risk Profile's asset survey — see
 * insurance-program.service.ts for the status chain and the assembly rules.
 * Frontend: apps/web/app/(app)/insurance-programs/ (assemble + list +
 * detail/finalize), reached from an approved needs assessment. */
@ApiTags('insurance-programs')
@Controller('insurance-programs')
export class InsuranceProgramController {
  constructor(private readonly programs: InsuranceProgramService) {}

  @RequirePermissions('program.assemble')
  @Post()
  assemble(
    @Body() dto: AssembleInsuranceProgramDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.programs.assemble(dto, user);
  }

  @RequirePermissions('program.read')
  @Get()
  list(
    @Query() query: ListInsuranceProgramsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.programs.list(query.customerId, user);
  }

  @RequirePermissions('program.read')
  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.programs.get(id, user);
  }

  /** Re-derive a DRAFT program's lines from the current survey / source
   * needs assessment (replaces them wholesale). */
  @RequirePermissions('program.assemble')
  @Post(':id/reassemble')
  reassemble(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.programs.reassemble(id, user);
  }

  @RequirePermissions('program.assemble')
  @Post(':id/finalize')
  finalize(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.programs.finalize(id, user);
  }

  @RequirePermissions('program.assemble')
  @Post(':id/reopen')
  reopen(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.programs.reopen(id, user);
  }
}
