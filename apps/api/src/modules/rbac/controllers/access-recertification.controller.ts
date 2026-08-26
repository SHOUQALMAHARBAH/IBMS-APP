import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AccessRecertificationService } from '../services/access-recertification.service';
import { RequirePermissions } from '../decorators/require-permissions.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { StartRecertificationCycleDto } from '../dto/start-recertification-cycle.dto';
import { RecertificationDecisionDto } from '../dto/recertification-decision.dto';
import { addBusinessDays } from '../../../common/business-days.util';

const CYCLE_SLA_BUSINESS_DAYS = 15; // Part A.8 — "quarterly access review (15 business days)"

const itemListSchema = {
  type: 'array' as const,
  items: {
    type: 'object' as const,
    properties: {
      id: { type: 'string' as const },
      cycleId: { type: 'string' as const },
      cycleLabel: { type: 'string' as const },
      subjectUserId: { type: 'string' as const },
      subjectFullName: { type: 'string' as const },
      subjectEmail: { type: 'string' as const },
      subjectRoles: {
        type: 'array' as const,
        items: { type: 'string' as const },
      },
      reviewerUserId: { type: 'string' as const },
      decision: { type: 'string' as const, nullable: true },
      reviewedAt: { type: 'string' as const, nullable: true },
      createdAt: { type: 'string' as const },
    },
    required: ['id', 'cycleId', 'subjectUserId', 'reviewerUserId'],
  },
};

const rawItemListSchema = {
  type: 'array' as const,
  items: {
    type: 'object' as const,
    properties: {
      id: { type: 'string' as const },
      cycleId: { type: 'string' as const },
      subjectUserId: { type: 'string' as const },
      reviewerUserId: { type: 'string' as const },
      decision: { type: 'string' as const, nullable: true },
      reviewedAt: { type: 'string' as const, nullable: true },
      createdAt: { type: 'string' as const },
    },
    required: ['id', 'cycleId', 'subjectUserId', 'reviewerUserId'],
  },
};

/** Part 10.1 / Process #40 — the recertification cycle admin surface.
 * Frontend: apps/web/app/(app)/access-recertification/page.tsx calls
 * listMyItems/decide; startCycle is exposed there too for reviewers who
 * also hold access-recertification.cycle.start. */
@ApiTags('access-recertification')
@Controller('access-recertification')
export class AccessRecertificationController {
  constructor(private readonly recertification: AccessRecertificationService) {}

  @RequirePermissions('access-recertification.cycle.start')
  @Post('cycles')
  startCycle(
    @Body() dto: StartRecertificationCycleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const dueAt = dto.dueAt
      ? new Date(dto.dueAt)
      : addBusinessDays(new Date(), CYCLE_SLA_BUSINESS_DAYS);
    return this.recertification.startCycle(dto.cycleLabel, dueAt, user.id);
  }

  @RequirePermissions('access-recertification.review')
  @Get('items')
  @ApiOkResponse({
    description:
      'Pending/decided recertification items assigned to the current reviewer.',
    schema: itemListSchema,
  })
  listMyItems(
    @CurrentUser() user: AuthenticatedUser,
    @Query('cycleId') cycleId?: string,
  ) {
    return this.recertification.listItemsForReviewer(user.id, cycleId);
  }

  @RequirePermissions('access-recertification.review')
  @Post('items/:id/decision')
  decide(
    @Param('id') id: string,
    @Body() dto: RecertificationDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.recertification.decide(id, user.id, dto.decision);
  }

  @RequirePermissions('access-recertification.cycle.start')
  @Get('cycles/:id/admin-items')
  @ApiOkResponse({
    description:
      'The dedicated review record for System/Security Administrator subjects in this cycle — Part 5.1 explicitly excludes that role from recertification exemption.',
    schema: rawItemListSchema,
  })
  getAdminItems(@Param('id') cycleId: string) {
    return this.recertification.getAdminAccessItems(cycleId);
  }
}
