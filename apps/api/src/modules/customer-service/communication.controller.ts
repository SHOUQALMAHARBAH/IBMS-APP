import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CommunicationService } from './communication.service';
import { CreateCommunicationDto } from './dto/create-communication.dto';
import { ListCommunicationsQueryDto } from './dto/list-communications-query.dto';
import { ConsentStatusQueryDto } from './dto/consent-status-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 44 (backlog Part C #44, Domain E) — Customer Communication. Log an
 * outbound customer communication on `CommunicationLog`, respecting the
 * customer's recorded channel and language, and gating a marketing send on the
 * customer's MARKETING `ConsentRecord`. Every route is `communication.send`
 * (`[SALES_RELATIONSHIP_OFFICER, PLACEMENT_TECHNICAL_OFFICER, CLAIMS_OFFICER,
 * FINANCE_COLLECTIONS_OFFICER]`) — the global `PermissionsGuard` /
 * `@CurrentUser` cover it.
 */
@ApiTags('customer-service')
@Controller('communications')
export class CommunicationController {
  constructor(private readonly communications: CommunicationService) {}

  @RequirePermissions('communication.send')
  @Post()
  create(
    @Body() dto: CreateCommunicationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.communications.create(dto, user.id);
  }

  @RequirePermissions('communication.send')
  @Get()
  list(@Query() query: ListCommunicationsQueryDto) {
    return this.communications.list(query);
  }

  /** The customer's current marketing-consent status — a pre-compose check so
   * the UI can disable "marketing" before a send is attempted. */
  @RequirePermissions('communication.send')
  @Get('consent-status')
  consentStatus(@Query() query: ConsentStatusQueryDto) {
    return this.communications.marketingConsentStatus(query.customerId);
  }

  @RequirePermissions('communication.send')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.communications.get(id);
  }
}
