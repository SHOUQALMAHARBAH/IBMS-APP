import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FeedbackService } from './feedback.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { ListFeedbackQueryDto } from './dto/list-feedback-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 45 (backlog Part C #45, Domain E) — Customer Feedback. Log a
 * post-issuance / post-claim / post-renewal satisfaction survey response.
 * Every route is `feedback.log` (`[SALES_RELATIONSHIP_OFFICER]`) — the
 * global `PermissionsGuard` + `@CurrentUser` cover it, no `AuthModule`
 * import.
 */
@ApiTags('customer-service')
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @RequirePermissions('feedback.log')
  @Post()
  create(
    @Body() dto: CreateFeedbackDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.feedback.create(dto, user.id);
  }

  @RequirePermissions('feedback.log')
  @Get()
  list(@Query() query: ListFeedbackQueryDto) {
    return this.feedback.list(query);
  }

  @RequirePermissions('feedback.log')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.feedback.get(id);
  }
}
