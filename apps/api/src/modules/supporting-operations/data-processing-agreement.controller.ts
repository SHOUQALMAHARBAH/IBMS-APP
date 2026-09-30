import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { CombinedDutyAct } from '@ibms/db';
import { combinedDutyActView } from '../../common/duty-segregation.view';
import { CombinedDutyDeclarationDto } from '../../common/dto/combined-duty-declaration.dto';
import { ApiTags } from '@nestjs/swagger';
import { DataProcessingAgreementService } from './data-processing-agreement.service';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 71 (backlog Part C #71, Domain H) — `DataProcessingAgreement`
 * routes. Creation and listing are nested under the owning vendor
 * (`vendor.update`, the maker side); DPO approval is its own flat route
 * gated by the pre-seeded, distinct `dpa.approve` permission (the checker
 * side) — two separate permission codes, the maker-checker default.
 */

/**
 * The wire shape of a DPA: the row, with its combined-duty act PROJECTED.
 *
 * Same situation as KYC (§ 1.80) and handled the same way: this module has no view layer — the service
 * returns the Prisma model — so the act relation would reach the wire RAW, carrying `actedAt` /
 * `grantingRoleNames` / `multipleGrantingRoles` where every projecting pair sends `at` / `roles` /
 * `hatAmbiguous`. The shared component reads the latter, so every field would render `undefined`, and
 * neither the typecheck nor a mocked Playwright test could see it — only the projection measurement.
 *
 * Promise-taking, so each handler stays a one-line delegation. `combinedDutyActView` stays the ONE
 * definition of this shape for all fifteen pairs.
 */
async function onWire<T extends { combinedDutyAct: CombinedDutyAct | null }>(
  pending: Promise<T>,
) {
  const row = await pending;
  return { ...row, combinedDutyAct: combinedDutyActView(row.combinedDutyAct) };
}

async function onWireMany<
  T extends { combinedDutyAct: CombinedDutyAct | null },
>(pending: Promise<T[]>) {
  return (await pending).map((row) => ({
    ...row,
    combinedDutyAct: combinedDutyActView(row.combinedDutyAct),
  }));
}

@ApiTags('supporting-operations')
@Controller()
export class DataProcessingAgreementController {
  constructor(private readonly dpas: DataProcessingAgreementService) {}

  @RequirePermissions('vendor.update')
  @Post('vendors/:vendorId/data-processing-agreements')
  create(
    @Param('vendorId') vendorId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return onWire(this.dpas.create(vendorId, user.id));
  }

  @RequirePermissions('vendor.read')
  @Get('vendors/:vendorId/data-processing-agreements')
  listByVendor(@Param('vendorId') vendorId: string) {
    return onWireMany(this.dpas.listByVendor(vendorId));
  }

  @RequirePermissions('vendor.update')
  @Post('data-processing-agreements/:id/sign')
  sign(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return onWire(this.dpas.sign(id, user.id));
  }

  @RequirePermissions('dpa.approve')
  @Post('data-processing-agreements/:id/dpo-approve')
  dpoApprove(
    @Param('id') id: string,
    @Body() dto: CombinedDutyDeclarationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return onWire(this.dpas.dpoApprove(id, user.id, dto.combinedDutyReason));
  }
}
