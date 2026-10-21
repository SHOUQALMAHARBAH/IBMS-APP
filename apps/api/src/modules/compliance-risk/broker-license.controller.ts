import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BrokerLicenseService } from './broker-license.service';
import { CreateBrokerLicenseDto } from './dto/create-broker-license.dto';
import { RenewBrokerLicenseDto } from './dto/renew-broker-license.dto';
import { RecordRenewalRequestDto } from './dto/record-renewal-request.dto';
import { AddScopeBranchDto } from './dto/add-scope-branch.dto';
import { BrokerLicenseScopeService } from './broker-license-scope.service';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { RecordRegulatoryActionDto } from './dto/record-regulatory-action.dto';

/**
 * Process 51/Part 7.1, restructured by Module 0 item (c) — this OFFICE's CBJ licence, as a SERIES
 * OF TERMS. `license.manage` (`[COMPLIANCE_OFFICER]`) gates every route, unchanged.
 *
 * NOT a singleton any more, and the correction matters: the id it used to be keyed by was the
 * table's PRIMARY KEY, so there was one licence row for the whole platform rather than one per
 * office. The second office to POST here collided on `BrokerLicense_pkey` and could never hold a
 * licence, while its own gate then read the absence as "not blocked".
 */
@ApiTags('compliance-risk')
@Controller('broker-license')
export class BrokerLicenseController {
  constructor(
    private readonly licenses: BrokerLicenseService,
    private readonly scope: BrokerLicenseScopeService,
  ) {}

  /* ---- Module 0 item (e): WHAT the office is licensed for ----
   *
   * On this controller and under `license.manage`, not a surface of their own: the scope IS
   * part of the licence record, and a separate permission would let an office grant the right
   * to describe a licence to somebody who cannot see it.
   */

  /** The current term's types, branches, and the art. 4/a capital assessment. */
  @RequirePermissions('license.manage')
  @Get('scope')
  getScope() {
    return this.scope.get();
  }

  /** Adds one licensed branch. 422 when it would give a sole establishment a second
   *  insurance type (art. 3/a) — a SERVICE-level refusal, because deciding it spans three
   *  tables and a CHECK sees one row of one. */
  @RequirePermissions('license.manage')
  @Post('scope')
  addScopeBranch(
    @Body() dto: AddScopeBranchDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.scope.addBranch(dto, user.id);
  }

  @RequirePermissions('license.manage')
  @Delete('scope/:id')
  removeScopeBranch(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.scope.removeBranch(id, user.id);
  }

  @RequirePermissions('license.manage')
  @Post()
  create(
    @Body() dto: CreateBrokerLicenseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.licenses.create(dto, user.id);
  }

  @RequirePermissions('license.manage')
  @Post('renew')
  renew(
    @Body() dto: RenewBrokerLicenseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.licenses.renew(dto, user.id);
  }

  /** Records that the renewal application for the NEXT term has been filed, against the current
   * term — art. 11 measures its 45-day deadline from that term's expiry. Write-once: the filing
   * date is what lateness is judged by, so a second call is a 409 rather than an overwrite. */
  @RequirePermissions('license.manage')
  @Post('renewal-requested')
  recordRenewalRequest(
    @Body() dto: RecordRenewalRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.licenses.recordRenewalRequest(dto, user.id);
  }

  /**
   * THE OFFICE RECORDS A DECISION THE REGULATOR TOOK — and this REPLACES `POST mark-lapsed`.
   *
   * That route took no body and flipped a two-value column, so a CBJ suspension was recorded as a
   * flag with no basis, no date, no decision reference and no letter. It is gone: a bare marker is
   * precisely the state `RegulatoryAction` exists to end, and keeping both would be two homes for
   * "has the regulator stopped this office".
   *
   * SAME PERMISSION, deliberately — `license.manage`, held by COMPLIANCE_OFFICER. Recording a CBJ
   * letter about the licence is the same act the lapse marker was standing in for, so no code is
   * minted and the catalogue does not move.
   *
   * Returns the STANDING after the act, so the caller sees what it changed to.
   */
  @RequirePermissions('license.manage')
  @Post('regulatory-actions')
  recordRegulatoryAction(
    @Body() dto: RecordRegulatoryActionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.licenses.recordRegulatoryAction(dto, user);
  }

  /** The current term AND the series. Does not 404 on an office with no licence: that is a real
   * state the screen must be able to render, and it is also the state that blocks new business. */
  @RequirePermissions('license.manage')
  @Get()
  get() {
    return this.licenses.get();
  }
}
