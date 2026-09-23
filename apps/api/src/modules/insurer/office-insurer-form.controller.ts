import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { OfficeInsurerFormService } from './office-insurer-form.service';
import { MapOfficeInsurerFormDto } from './dto/map-office-insurer-form.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

class ListOfficeFormsQueryDto {
  /** A line id from EITHER catalogue. Omit it for every line this office has mapped. */
  @IsOptional()
  @IsUUID()
  lineId?: string;
}

class ResolveFormQueryDto {
  /** Required here: "which form do I submit against" is a question about one line. */
  @IsUUID()
  lineId!: string;
}

/**
 * Q9 — this office's OWN insurer form mappings.
 *
 * Nested under `/insurers/:insurerId` rather than sitting beside `/insurer-masters`, and the path
 * is the statement: these forms belong to an office's RELATIONSHIP with a company, not to the
 * company. The same nesting is why no route here takes an office id — the tenant-scoped client
 * supplies it, and a route that accepted one would be a route that could be asked for another
 * office's forms.
 *
 * ## The permissions are deliberately not the global ones
 *
 * `insurer.form.map` gates the SHARED mapping, and the grid's own reason for withholding it from
 * the office administrator is that "the mapping becomes the form every other office submits
 * against". That reason does not apply to a row one office can read, so this endpoint has its own
 * code — `insurer.office-form.map` — which the office administrator may legitimately hold.
 * Folding them together would force a choice between denying an administrator their own office's
 * forms and granting them a platform-wide write.
 *
 * Reads are `insurer.read`: these are this office's own records about its own insurer, which is
 * exactly what that code already covers, and a second read code would gate nothing extra.
 */
@ApiTags('insurer')
@Controller('insurers/:insurerId/form-templates')
export class OfficeInsurerFormController {
  constructor(private readonly forms: OfficeInsurerFormService) {}

  @RequirePermissions('insurer.read')
  @Get()
  list(
    @Param('insurerId') insurerId: string,
    @Query() query: ListOfficeFormsQueryDto,
  ) {
    return this.forms.list(insurerId, query.lineId);
  }

  /**
   * The mapping to submit against for one line — this office's own if it has one, otherwise the
   * shared mapping off the insurer's catalogue entry, otherwise null. The response names its
   * `source`, because the two are not interchangeable to anything that offers an edit control.
   *
   * A LITERAL segment, so it is declared before any `:templateId` route would be if one is ever
   * added: Nest matches in declaration order, and a literal behind a parameter route is
   * unreachable. The global registry's controller carries the same note for the same reason.
   */
  @RequirePermissions('insurer.read')
  @Get('resolved')
  resolve(
    @Param('insurerId') insurerId: string,
    @Query() query: ResolveFormQueryDto,
  ) {
    return this.forms.resolve(insurerId, query.lineId);
  }

  @RequirePermissions('insurer.office-form.map')
  @Post()
  map(
    @Param('insurerId') insurerId: string,
    @Body() dto: MapOfficeInsurerFormDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.forms.map(insurerId, dto, user.id);
  }
}
