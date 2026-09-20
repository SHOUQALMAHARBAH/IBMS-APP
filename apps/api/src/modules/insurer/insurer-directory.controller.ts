import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InsurerDirectoryService } from './insurer-directory.service';
import { ListInsurerDirectoryQueryDto } from './dto/insurer-directory.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';

/**
 * The cross-office insurer directory.
 *
 * ONE route, and it is a GET. There is deliberately nothing else: no contract request, no
 * follow-up record, no "we approached them" note. Everything after the search happens
 * outside the system, and an endpoint that recorded an approach would be the first step
 * towards the system knowing which offices are talking to which companies — which is the
 * fact this whole boundary exists to keep private.
 *
 * `insurer.directory.read`, its own code rather than `insurer.read`. They answer opposite
 * questions: one is "who does my office deal with, on what terms", the other is "which
 * companies exist at all". Folding them together would mean an office could not be given
 * the market without also being given its own panel.
 */
@ApiTags('insurer')
@Controller('insurer-directory')
export class InsurerDirectoryController {
  constructor(private readonly directory: InsurerDirectoryService) {}

  /** Every company any office has registered, one entry per company, searchable by name
   *  in either script. Never says which offices deal with any of them. */
  @RequirePermissions('insurer.directory.read')
  @Get()
  list(@Query() query: ListInsurerDirectoryQueryDto) {
    return this.directory.list(query);
  }
}
