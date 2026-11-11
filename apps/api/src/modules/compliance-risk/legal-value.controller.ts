import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { DeclareLegalValueDto } from './dto/declare-legal-value.dto';
import { LegalValueService } from './legal-value.service';

/**
 * THE LEGAL-VALUES TABLE OVER HTTP — module 1, OWNER DECISION 123.
 *
 * NO SCREEN SHIPS IN THIS BATCH (message 35 §6): every string a person would read goes to the
 * owner as a table first. These routes exist because decision 123's criteria 1, 2, 6 and 7 are
 * about what an office account may and may not do, and a criterion with no path cannot be planted
 * against.
 *
 * ## THE TWO CODES ARE SEPARATE, AND SEPARATE FROM EVERY ACT THE VALUE GOVERNS
 *
 * The module paper's §٤.١ states the rule the other way round and it applies here: *whoever can
 * act is not thereby able to declare*. A placement officer who sends quote requests works under
 * art. 15/d's ceiling every day and must not be able to move it.
 *
 * Neither code is granted to any role by the seed (`roles: []`). Who holds them is the office's
 * edit to its own roles — the standing rule that no role is granted a new code so a screen works.
 */
@ApiTags('legal-values')
@Controller('legal-values')
export class LegalValueController {
  constructor(private readonly legalValues: LegalValueService) {}

  /**
   * Every value in force today — the provider's and this office's together, which is what the
   * tenant extension's declared read-widening is for.
   */
  @RequirePermissions('legal-value.read')
  @Get()
  list() {
    return this.legalValues.listInForce(new Date());
  }

  /**
   * The whole dated history for one code, newest window first.
   *
   * Not only the row in force: an old transaction was computed at the value in force on ITS day,
   * and an inspector asking *what did this office apply in March* needs the row that answered then.
   */
  @RequirePermissions('legal-value.read')
  @Get(':code/history')
  history(@Param('code') code: string) {
    return this.legalValues.history(code);
  }

  /**
   * DECLARE a value for this office — decision 123's three conditions, the first of which is this
   * route's own permission.
   *
   * APPEND, never edit: the current row is closed at the new row's effective date and a new row is
   * inserted, in one transaction.
   */
  @RequirePermissions('legal-value.declare')
  @Post()
  declare(
    @Body() dto: DeclareLegalValueDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.legalValues.declare(dto, user);
  }
}
