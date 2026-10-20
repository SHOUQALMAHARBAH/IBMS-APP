import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RetentionNoticeService } from './retention-notice.service';
import { ExtendRetentionDto } from './dto/extend-retention.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * THE RETENTION NOTICE — batch 5 group 7b.
 *
 * ## THE READ IS AN ANY-OF OVER THE ACTS, NEVER A ROLE NAME
 *
 * The owner's standing rule, carried from the licence notice unchanged: the notice goes to HOLDERS
 * OF ANY OF THE ACTS. `PermissionsGuard` ORs its codes (`required.some`), so a Branch/Department
 * Manager who may nominate a disposal sees the same list as the Compliance Officer who may extend.
 *
 * TWO DIFFERENT PEOPLE ACTING ON ONE LIST IS THE SEGREGATION WORKING, not a defect to smooth over by
 * routing the notice to one of them.
 *
 * ## THE WRITE NAMES EXACTLY ONE CODE
 *
 * On a write that same OR would be wrong — it would let a nominate permission authorise an
 * extension. So `extend` names `retention.extend` alone, which is the distinction `retention-
 * schedule.controller.ts` already records for its own reads and writes.
 *
 * ## AND THERE IS NO DESTRUCTION ROUTE HERE
 *
 * The notice filters; it destroys nothing. Nominating for destruction is `POST /disposal-batches`,
 * unchanged, behind `retention.dispose.nominate` and its own dual control. A convenience route here
 * that created a batch would be precisely the write path this notice must not have.
 */
@ApiTags('pdpl')
@Controller('retention-notices')
export class RetentionNoticeController {
  constructor(private readonly notices: RetentionNoticeService) {}

  @RequirePermissions(
    'retention.extend',
    'retention.dispose.nominate',
    'retention.dispose.approve',
  )
  @Get()
  list() {
    return this.notices.list();
  }

  @RequirePermissions(
    'retention.extend',
    'retention.dispose.nominate',
    'retention.dispose.approve',
  )
  @Get('register')
  register(@Query('recordCategory') recordCategory?: string) {
    return this.notices.register(recordCategory);
  }

  @RequirePermissions('retention.extend')
  @Post('extend')
  extend(
    @Body() dto: ExtendRetentionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notices.extend(
      {
        recordCategory: dto.recordCategory,
        recordIds: dto.recordIds,
        months: dto.months,
        basis: {
          basis: dto.basis,
          note: dto.note,
          instrument: dto.instrument,
          article: dto.article,
          legalHoldId: dto.legalHoldId,
          consentRecordId: dto.consentRecordId,
          consentDuration: dto.consentDuration,
          consentPurpose: dto.consentPurpose,
        },
      },
      user.id,
    );
  }
}
