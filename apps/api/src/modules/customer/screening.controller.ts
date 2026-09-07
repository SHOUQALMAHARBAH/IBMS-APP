import { Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ScreeningService } from './screening.service';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Process 49 — the on-demand trigger for the recurring sanctions/PEP
 * re-screen batch (it is otherwise every 4 hours,
 * `ScreeningBatchScheduler`). Book-wide, not scoped to one customer/KYC
 * record — a separate small controller from `KycController` for that
 * reason. `sanctions-pep.screen` (`[COMPLIANCE_OFFICER]`) — the seeded
 * permission's own description, "Run recurring sanctions/PEP screening
 * batches." */
@ApiTags('kyc-records')
@Controller('screening')
export class ScreeningController {
  constructor(private readonly screening: ScreeningService) {}

  @RequirePermissions('sanctions-pep.screen')
  @Post('recurring-batch')
  runRecurringBatch(@CurrentUser() user: AuthenticatedUser) {
    return this.screening.runRecurringBatch(user.id);
  }
}
