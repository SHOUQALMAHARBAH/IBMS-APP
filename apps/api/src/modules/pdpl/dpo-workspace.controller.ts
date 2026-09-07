import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DpoWorkspaceService } from './dpo-workspace.service';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Backlog Part D §5.1 item #9 — the DPO Workspace aggregate screen.
 * `dpo-workspace.view` (DPO-only) is a genuinely new permission — see
 * `dpo-workspace.config.ts`'s header comment. */
@ApiTags('pdpl')
@Controller('dpo-workspace')
export class DpoWorkspaceController {
  constructor(private readonly workspace: DpoWorkspaceService) {}

  @RequirePermissions('dpo-workspace.view')
  @Get('summary')
  getSummary(@CurrentUser() user: AuthenticatedUser) {
    return this.workspace.getSummary(user.id);
  }
}
