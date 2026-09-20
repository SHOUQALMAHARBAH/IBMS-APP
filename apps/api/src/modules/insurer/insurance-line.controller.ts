import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InsuranceLineService } from './insurance-line.service';
import {
  AddInsuranceLineDto,
  UpdateInsuranceLineDto,
} from './dto/insurance-line.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * The insurance-line vocabulary staff pick from.
 *
 * ## Note what is missing: there is no route that writes a STANDARD line
 *
 * Not a route behind a strict permission — no route at all, and no repository method
 * behind one either. The standard 32 arrive by seed and change in a release. That
 * absence is what keeps the permission-grid invariant true (no code in the catalogue
 * may have an effect outside the granting office) while still letting every office
 * read one shared list: a table the application cannot write cannot be a route
 * between offices.
 *
 * ## The two permissions, and why adding is administrative
 *
 * Reading is `insurer.read` — the code already held by every role that picks an
 * insurer, which is the same population that picks a line. Adding and correcting are
 * `insurer.relationship.manage`, so an addition is an administrator's act. That is a
 * deliberate control rather than an oversight: an addition changes the vocabulary the
 * whole office then reports against, and a Placement Officer who needs a missing type
 * asks for it once instead of every officer minting near-duplicates under deadline.
 *
 * No new permission code was introduced. A vocabulary read that eventually serves
 * RFQ, quotation and policy screens will want a code of its own; today its only
 * consumer is insurer registration, and inventing a code with one caller is how a
 * catalogue fills with permissions nobody can explain.
 */
@ApiTags('insurer')
@Controller('insurance-lines')
export class InsuranceLineController {
  constructor(private readonly lines: InsuranceLineService) {}

  /** The standard list in market order, then this office's own additions. */
  @RequirePermissions('insurer.read')
  @Get()
  list() {
    return this.lines.list();
  }

  /** Adds a type the standard list does not have. Refused if a standard line already
   *  means the same thing, or if this office already added it. */
  @RequirePermissions('insurer.relationship.manage')
  @Post()
  add(
    @Body() dto: AddInsuranceLineDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.lines.add(dto, user.id);
  }

  /** Corrects one of this office's own additions. A standard line's id reads as
   *  absent here, which is what it is: not an office addition. */
  @RequirePermissions('insurer.relationship.manage')
  @Patch(':id')
  rename(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInsuranceLineDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.lines.rename(id, dto, user.id);
  }
}
