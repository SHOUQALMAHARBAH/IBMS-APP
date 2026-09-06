import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DataProcessingAgreementService } from './data-processing-agreement.service';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 71 (backlog Part C #71, Domain H) — `DataProcessingAgreement`
 * routes. Creation and listing are nested under the owning vendor
 * (`vendor.manage`, the maker side); DPO approval is its own flat route
 * gated by the pre-seeded, distinct `dpa.approve` permission (the checker
 * side) — two separate permission codes, the maker-checker default.
 */
@ApiTags('supporting-operations')
@Controller()
export class DataProcessingAgreementController {
  constructor(private readonly dpas: DataProcessingAgreementService) {}

  @RequirePermissions('vendor.manage')
  @Post('vendors/:vendorId/data-processing-agreements')
  create(
    @Param('vendorId') vendorId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dpas.create(vendorId, user.id);
  }

  @RequirePermissions('vendor.manage')
  @Get('vendors/:vendorId/data-processing-agreements')
  listByVendor(@Param('vendorId') vendorId: string) {
    return this.dpas.listByVendor(vendorId);
  }

  @RequirePermissions('vendor.manage')
  @Post('data-processing-agreements/:id/sign')
  sign(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.dpas.sign(id, user.id);
  }

  @RequirePermissions('dpa.approve')
  @Post('data-processing-agreements/:id/dpo-approve')
  dpoApprove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.dpas.dpoApprove(id, user.id);
  }
}
