import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrivacyNoticeService } from './privacy-notice.service';
import { CreatePrivacyNoticeDto } from './dto/create-privacy-notice.dto';
import { ListPrivacyNoticesQueryDto } from './dto/list-privacy-notices-query.dto';
import { CurrentPrivacyNoticeQueryDto } from './dto/current-privacy-notice-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Notices (Part 6.2 — no M01-M12 module name applies). `privacy-notice.publish` (DPO + Compliance) gates
 * create/list-all/legal-review. `current` additionally accepts
 * `consent.manage` — see `privacy-notice.service.ts`'s header comment. */
@ApiTags('pdpl')
/**
 * Reads are gated by `privacy-notice.read`, writes by `privacy-notice.publish`
 * — two permissions, because they are two different acts by two different sets
 * of people. Every touchpoint role has to be able to SHOW a data subject the
 * notice that applies to them at the moment of collection; only the DPO and
 * Compliance decide what it says.
 *
 * `GET current` previously accepted `privacy-notice.publish` OR
 * `consent.manage`. That granted the right people access, but by way of a
 * WRITE permission on a different resource — the two were only ever aligned by
 * coincidence, and would have drifted apart the first time either changed for
 * its own reasons. No role loses access in this change.
 */
@Controller('privacy-notices')
export class PrivacyNoticeController {
  constructor(private readonly notices: PrivacyNoticeService) {}

  @RequirePermissions('privacy-notice.publish')
  @Post()
  create(
    @Body() dto: CreatePrivacyNoticeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notices.create(dto, user.id);
  }

  @RequirePermissions('privacy-notice.read')
  @Get()
  list(@Query() query: ListPrivacyNoticesQueryDto) {
    return this.notices.list(query);
  }

  @RequirePermissions('privacy-notice.read')
  @Get('current')
  current(@Query() query: CurrentPrivacyNoticeQueryDto) {
    return this.notices.current(query.touchpoint);
  }

  @RequirePermissions('privacy-notice.read')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.notices.get(id);
  }

  @RequirePermissions('privacy-notice.publish')
  @Post(':id/legal-review')
  recordLegalReview(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notices.recordLegalReview(id, user.id);
  }
}
