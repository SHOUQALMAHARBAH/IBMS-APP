import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InsurerService } from './insurer.service';
import {
  DeactivateInsurerDto,
  ListInsurersQueryDto,
  ReactivateInsurerDto,
  RegisterInsurerDto,
  UpdateInsurerDto,
} from './dto/insurer-crud.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Insurer management — this office's OWN insurer records.
 *
 * The counterpart to `InsurerMasterController`, and the opposite shape in every
 * respect that matters: every route here is tenant-scoped, so the same id means
 * different things in different offices and most of them mean nothing at all. The
 * master controller has no Organization filter by design; this one cannot escape
 * having one, because `tenantScopeExtension` applies it beneath every query.
 *
 * ## The permission split
 *
 * `insurer.read` renders the list and one record; `insurer.relationship.manage`
 * registers and edits. The office administrator holds BOTH — you cannot manage
 * records you cannot list — which is the same pairing the Role screen is built on
 * (`role.read` alongside `role.manage`).
 *
 * `isActive` is not writable through the edit route. Deactivating an insurer is its
 * own act — `POST :id/deactivate`, with a reason, answering with what was outstanding
 * at the moment it happened — rather than a field that rides along with a
 * phone-number correction.
 */
@ApiTags('insurer')
@Controller('insurers')
export class InsurerController {
  constructor(private readonly insurers: InsurerService) {}

  /** The office's insurers, ACTIVE and inactive. `?isActive=` narrows it; absent
   *  means both, because an office that cannot see what it deactivated cannot
   *  offer to reactivate it. */
  @RequirePermissions('insurer.read')
  @Get()
  list(@Query() query: ListInsurersQueryDto) {
    return this.insurers.list(query);
  }

  /** One record. Another office's id is a 404, not a 403 — see the service. The
   *  UUID pipe is what keeps a malformed id a 400 rather than a database round
   *  trip. */
  @RequirePermissions('insurer.read')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.insurers.get(id);
  }

  /** Registers an insurer by EITHER path — a link to the shared catalogue, or a
   *  company this office names itself. One endpoint, because it is one act. */
  @RequirePermissions('insurer.relationship.manage')
  @Post()
  register(
    @Body() dto: RegisterInsurerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.insurers.register(dto, user.id);
  }

  @RequirePermissions('insurer.relationship.manage')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInsurerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.insurers.update(id, dto, user.id);
  }

  /**
   * Stops the office dealing with this insurer. ALLOW AND RECORD: it never refuses on
   * account of an existing obligation, because refusing would not settle one.
   *
   * POST and not PATCH: this is an act with a reason and a recorded consequence, not a
   * field assignment. The response carries the impact counts as at the moment of the
   * change — in-force policies, open renewal cases, unanswered RFQ submissions and
   * unsettled invoices — which are also written to the audit trail.
   */
  @RequirePermissions('insurer.relationship.manage')
  @Post(':id/deactivate')
  @HttpCode(200)
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeactivateInsurerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.insurers.deactivate(id, dto.reason, user.id);
  }

  /** Puts them back in play. A reason is optional here — refusing to let an office undo
   *  a deactivation for want of a sentence would be worse than an unexplained
   *  reactivation. */
  @RequirePermissions('insurer.relationship.manage')
  @Post(':id/reactivate')
  @HttpCode(200)
  reactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReactivateInsurerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.insurers.reactivate(id, dto.reason, user.id);
  }
}
