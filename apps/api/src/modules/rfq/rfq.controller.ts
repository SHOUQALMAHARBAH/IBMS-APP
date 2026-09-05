import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RfqService } from './rfq.service';
import { CreateRfqDto } from './dto/create-rfq.dto';
import { AddRfqInsurersDto } from './dto/add-rfq-insurers.dto';
import { LogRfqCommunicationDto } from './dto/log-rfq-communication.dto';
import { ListRfqsQueryDto } from './dto/list-rfqs-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Process 11 — RFQ / Market Submission (backlog Part C #11, Domain B). One
 * RFQ per insurance line under an Opportunity, sent to a shortlist of
 * insurers; per-insurer response tracking lives on the sibling
 * `rfq-insurers` controller. See rfq.service.ts for the rules. Frontend:
 * apps/web/app/(app)/rfqs/ + apps/web/app/(app)/opportunities/. */
@ApiTags('rfqs')
@Controller('rfqs')
export class RfqController {
  constructor(private readonly rfqs: RfqService) {}

  @RequirePermissions('rfq.create')
  @Post()
  create(@Body() dto: CreateRfqDto, @CurrentUser() user: AuthenticatedUser) {
    return this.rfqs.createRfq(dto, user);
  }

  /** The insurer master data the shortlist picker offers. Declared before
   * `:id` so "selectable-insurers" is never parsed as an RFQ id. Gated by
   * `rfq.create` — it is only needed on the create screen. */
  @RequirePermissions('rfq.create')
  @Get('selectable-insurers')
  selectableInsurers() {
    return this.rfqs.listSelectableInsurers();
  }

  @RequirePermissions('rfq.read')
  @Get()
  list(
    @Query() query: ListRfqsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rfqs.list(query, user);
  }

  @RequirePermissions('rfq.read')
  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.rfqs.get(id, user);
  }

  /** Broaden an existing RFQ's insurer shortlist. */
  @RequirePermissions('rfq.create')
  @Post(':id/insurers')
  addInsurers(
    @Param('id') id: string,
    @Body() dto: AddRfqInsurersDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rfqs.addInsurers(id, dto, user);
  }

  /** Process 12 — the broker<->insurer correspondence log for this RFQ.
   * Reading is covered by `rfq.read` (the same roles that see the RFQ);
   * logging needs `rfq.communication.log` (Placement). */
  @RequirePermissions('rfq.read')
  @Get(':id/communications')
  listCommunications(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rfqs.listCommunications(id, user);
  }

  @RequirePermissions('rfq.communication.log')
  @Post(':id/communications')
  logCommunication(
    @Param('id') id: string,
    @Body() dto: LogRfqCommunicationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rfqs.logCommunication(id, dto, user);
  }
}
