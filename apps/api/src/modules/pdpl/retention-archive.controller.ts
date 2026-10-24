import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RetentionArchiveService } from './retention-archive.service';
import { RetrieveBlockedRecordsDto } from './dto/retrieve-blocked-records.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * RETRIEVAL FROM THE BLOCKED PHASE — condition 3 of the archived state, batch 5 group 7c.
 *
 * ## EVERY ROUTE HERE NAMES ONE CODE, WHICH IS THE OPPOSITE OF THE NOTICE NEXT DOOR
 *
 * The notice's read is an ANY-OF over the three act codes, because holders of any of those acts must
 * all see the same list and `PermissionsGuard` ORs its codes. Here the OR would be exactly wrong:
 * `retention.archive.retrieve` is a capability a holder of `retention.dispose.nominate` does not
 * have, and admitting either would make the narrower code decorative.
 *
 * THE REGISTER READ IS GATED THE SAME WAY, and that is condition 2 rather than caution: the register
 * says which blocked records somebody looked at and why, so a reader who may not retrieve may not
 * read the list of retrievals either.
 *
 * ## THERE IS NO "WHAT IS BLOCKED" ROUTE HERE
 *
 * The blocked records are the elapsed records `GET /retention-notices` already lists. A second list
 * would be a second answer to "which records are past their period", free to disagree with the first
 * the moment a period changed — the same reason the state itself has no column.
 */
@ApiTags('pdpl')
@Controller('retention-archive')
export class RetentionArchiveController {
  constructor(private readonly archive: RetentionArchiveService) {}

  /** The two bases and what each means, so the screen renders them rather than restating them. */
  @RequirePermissions('retention.archive.retrieve')
  @Get('bases')
  bases() {
    return this.archive.bases();
  }

  @RequirePermissions('retention.archive.retrieve')
  @Get('retrievals')
  list(@Query('recordCategory') recordCategory?: string) {
    return this.archive.list(recordCategory);
  }

  @RequirePermissions('retention.archive.retrieve')
  @Post('retrievals')
  retrieve(
    @Body() dto: RetrieveBlockedRecordsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.archive.retrieve(
      {
        recordCategory: dto.recordCategory,
        recordIds: dto.recordIds,
        basis: dto.basis,
        note: dto.note,
      },
      user.id,
    );
  }
}
