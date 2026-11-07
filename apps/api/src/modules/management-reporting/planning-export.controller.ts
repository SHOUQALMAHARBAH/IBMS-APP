import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PlanningExportService } from './planning-export.service';
import { GeneratePlanningExportDto } from './dto/generate-planning-export.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { RequireStepUp } from '../auth/decorators/require-step-up.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 65 — `planning-export.generate` (already pre-seeded, Executive
 * Management ONLY — the narrowest Domain G grant) gates the one export
 * here. A POST, not a GET — the permission's own verb ("generate") matches
 * the `internal-controls.view` "Run audit now" shape, even though this is
 * a pure read with no persisted side effect of its own.
 */
@ApiTags('management-reporting')
@Controller('planning-export')
export class PlanningExportController {
  constructor(private readonly planningExport: PlanningExportService) {}

  /**
   * ROW 68 — STEP-UP. Added 2026-11-06 (module 0-c batch 6b). The decorator's third named case,
   * "data export" — and that case is TWO routes rather than one, measured rather than assumed.
   *
   * The export set was derived from the product's own definition of an export: the routes that
   * write `AuditAction.EXPORT`. There are exactly two — this one (`planning-export.service.ts:87`)
   * and `GET /ropa-entries/export` (`ropa-entry.service.ts:98`). Both are decorated.
   *
   * THE DOCUMENT ROUTES ARE DELIBERATELY NOT IN THAT SET, and the distinction is the point: an
   * invoice, a policy certificate, a comparison matrix and a recommendation report are per-record
   * business output the office hands to one client, not a bulk extract of personal data. Measured
   * 2026-11-06, there are 20 routes whose path names a document, certificate or download; none
   * writes an `EXPORT` audit row, and a re-authentication prompt in front of printing an invoice
   * would be answered reflexively within a week, which costs the prompt its meaning everywhere.
   */
  @RequirePermissions('planning-export.generate')
  @RequireStepUp()
  @Post()
  generate(
    @Body() dto: GeneratePlanningExportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.planningExport.generate(user.id, dto.periodLabel);
  }
}
