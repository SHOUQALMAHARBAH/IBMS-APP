import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { NotificationService } from './notification.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * `GET /notifications` — what needs this reader's attention, right now.
 *
 * Deliberately NOT permission-gated at the route: a notification centre that
 * 403s for most roles is not a notification centre. The CONTENT is gated
 * instead, source by source, on the permission that guards each source's own
 * screen — see notification.service.ts. Every signed-in user gets an answer;
 * what is in it depends on what they may already open.
 */
@ApiTags('notifications')
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.list(user);
  }
}
