import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PlanningExportService } from './planning-export.service';
import { GeneratePlanningExportDto } from './dto/generate-planning-export.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 65 — `planning-export.generate` (already pre-seeded, Executive
 * Management ONLY — the narrowest Domain G grant) gates the one export
 * here. A POST, not a GET — the permission's own verb ("generate") matches
 * the `internal-controls.audit` "Run audit now" shape, even though this is
 * a pure read with no persisted side effect of its own.
 */
@ApiTags('management-reporting')
@Controller('planning-export')
export class PlanningExportController {
  constructor(private readonly planningExport: PlanningExportService) {}

  @RequirePermissions('planning-export.generate')
  @Post()
  generate(
    @Body() dto: GeneratePlanningExportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.planningExport.generate(user.id, dto.periodLabel);
  }
}
