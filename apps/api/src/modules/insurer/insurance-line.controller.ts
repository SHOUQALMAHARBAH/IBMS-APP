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
 * `insurance-line.create`, so an addition is an administrator's act. That is a
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

  /**
   * The standard list in market order, then this office's own additions.
   *
   * ## AN ANY-OF, AND THE WIDENING WAS PREDICTED IN WRITING BEFORE IT WAS NEEDED
   *
   * `reference-data.service.ts` wrote this down in advance: *"It WILL need widening... the gate
   * becomes an ANY-OF, which is a one-line decision then rather than a code invented now."* The
   * prediction was right and the widening never happened, so the owner opened
   * `/provider-register-office` as the platform operator and found EIGHT EMPTY DROPDOWNS — the page
   * returned 200, her permission to open it was correct, and the screen could not be used.
   *
   * `insurer.read` is an OFFICE permission. The platform operator does not hold it and **must not be
   * given it**: it would hand the provider every office's own insurer records, which is a disclosure
   * boundary and not a convenience. So the ROUTE's gate widens; the ROLE does not. That is the same
   * reasoning that refused the security administrator `insurer.create`.
   *
   * `PermissionsGuard` is `required.some`, so naming three codes means ANY of the three — which is
   * what is wanted here and is the reason this is one line rather than a new code.
   *
   * ## WHAT THE WIDENING DOES AND DOES NOT DISCLOSE
   *
   * The standard 32 lines are a GLOBAL catalogue — they describe the software, not any office — so a
   * provider reading them learns nothing about anybody. The office-added lines ARE office data, and
   * they stay office data: this route is tenant-scoped like every other, so a provider calling it
   * sees the standard list and no office's additions, because the provider organization has none.
   * The widening therefore adds no cross-office disclosure, which is why it is safe as an any-of
   * rather than needing a separate provider-facing route.
   */
  /*
   * ITEM 3, owner decision 2026-10-17 — three more roles, and the codes were chosen from the SET.
   *
   * Her decided set adds `FINANCE_COLLECTIONS_OFFICER` (reading a commission schedule, which is keyed
   * by line), `SYSTEM_SECURITY_ADMINISTRATOR` and `INSURANCE_COMPANY_ADMINISTRATOR` (both setting a
   * role's line SCOPE on `/settings/roles`). Measured which codes produce exactly those three and no
   * others:
   *
   *   role.read            -> OFFICE_ADMINISTRATOR, SYSTEM_SECURITY_ADMINISTRATOR, and the two
   *                           provider-side roles. Office-side it adds only the security
   *                           administrator, because OFFICE_ADMINISTRATOR already holds `insurer.read`.
   *   commission.calculate -> FINANCE_COLLECTIONS_OFFICER alone.
   *
   * So the union is exactly the eleven roles `route-role-reach.spec.ts` pins by name, and CLAIMS,
   * POLICY_CHECKING and the DPO stay out — none of them holds any of the five codes. The rejected
   * candidate is worth recording: `client-accounting.read` would also have reached Finance, and it
   * reaches MANAGER, EXEC and AUDITOR as well, who are already in through `insurer.read` — so it would
   * have produced the same set today and a different one the moment any of those grants moved.
   * `commission.calculate` names the capability that actually needs the vocabulary.
   */
  @RequirePermissions(
    'insurer.read',
    'provider.office.register',
    'provider.insurer.register',
    'role.read',
    'commission.calculate',
  )
  @Get()
  list() {
    return this.lines.list();
  }

  /** Adds a type the standard list does not have. Refused if a standard line already
   *  means the same thing, or if this office already added it. */
  @RequirePermissions('insurance-line.create')
  @Post()
  add(
    @Body() dto: AddInsuranceLineDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.lines.add(dto, user.id);
  }

  /** Corrects one of this office's own additions. A standard line's id reads as
   *  absent here, which is what it is: not an office addition. */
  @RequirePermissions('insurance-line.update')
  @Patch(':id')
  rename(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInsuranceLineDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.lines.rename(id, dto, user.id);
  }
}
