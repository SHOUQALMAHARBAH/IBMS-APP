import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CustomerService } from './customer.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerContactDto } from './dto/update-customer-contact.dto';
import { CorrectCustomerIdentifiersDto } from './dto/correct-customer-identifiers.dto';
import { ListCustomersQueryDto } from './dto/list-customers-query.dto';
import { SearchCustomersDto } from './dto/search-customers.dto';
import { CUSTOMER_SEARCH_CODES } from '../../common/picker-search.config';
import {
  CheckDuplicateNameDto,
  RecordAbandonedDuplicateDto,
} from './dto/duplicate-name.dto';
import { CreateUboDto } from './dto/create-ubo.dto';
import { CreateCustomerDocumentDto } from './dto/create-customer-document.dto';
import { RevealFieldDto } from './dto/reveal-field.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Process 3-4 — Customer Acquisition/Onboarding. Frontend:
 * apps/web/app/(app)/customers/ (KYC wizard + list/profile screens). KYC
 * lifecycle actions (submit/screen/approve/reject) live in
 * kyc.controller.ts, not here — this controller is the Customer/UBO/
 * customer-scoped-Document surface only. */
@ApiTags('customers')
@Controller('customers')
export class CustomerController {
  constructor(private readonly customers: CustomerService) {}

  @RequirePermissions('customer.create')
  @Post()
  create(
    @Body() dto: CreateCustomerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.customers.create(dto, user);
  }

  /**
   * FINDING a customer is not READING one — so the list has its own code.
   *
   * This was gated on `customer.360-view.read`, the same code as `@Get(':id')` below, because no narrower
   * customer read existed. Measured consequence: PLACEMENT/CLAIMS/FINANCE hold `interaction.log` and could
   * not list customers, and the two administrator roles hold `customer.bulk-import` and could not see a
   * customer after importing hundreds.
   *
   * Widening `customer.360-view.read` instead would have been one line and would have handed those roles the
   * history, programmes, risk profiles, UBO register and reveal endpoint. Every other route in this
   * controller keeps `customer.360-view.read`.
   */
  @RequirePermissions('customer.read')
  @Get()
  list(
    @Query() query: ListCustomersQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.customers.list(query, user);
  }

  /**
   * The ONE FIELD that finds a named customer — the owner's decision of 2026-10-01.
   *
   * Every screen needing a customer showed a search box AND a separate select below it: correct, and not
   * practical. One field now completes names as somebody types, and it carries the four anti-browsing
   * conditions the owner set for the employee search, applied to customers because a field that
   * completes names is closer to a directory by nature.
   *
   * ## Why a second route rather than `?search=` on the list
   *
   * `GET /customers` has an unfiltered mode and must keep it — it is a paged register somebody browses
   * on purpose. The conditions are the opposite of that, so they live on their own route, exactly as
   * `GET /employees/search` stands beside `GET /employees`. One route per intent.
   *
   * The RESULT is narrower than a list row — see `CustomerSearchResultView`.
   *
   * Declared BEFORE `@Get(':id')` so `search` is never parsed as a customer id — the same ordering
   * `GET /employees/search` needs and says so.
   *
   * ## The gate: WIDENED 2026-10-02, and the first version was wrong
   *
   * This shipped gated on `customer.read` alone, with a comment arguing that finding a customer is the
   * same act as listing one. Right for nine of the ten roles that need it and wrong for the one whose
   * screen it matters most to: **the DATA_PROTECTION_OFFICER holds `dsr.log` and NOT `customer.read`**,
   * and `/dsr` — logging a data-subject request against a named customer — is theirs. So the field
   * built to stop every screen showing a search box AND a select was unusable by the DPO the day after
   * it shipped.
   *
   * Found by `scripts/measurements/picker-route-reachability.mjs`, which is the measurement behind the
   * owner's rule that a picker's route is gated on ANY OF the permissions of the screens that use it.
   * See `common/picker-search.config.ts` for that rule and for the other instance of it.
   */
  @RequirePermissions(...CUSTOMER_SEARCH_CODES)
  @Get('search')
  search(
    @Query() query: SearchCustomersDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.customers.search(query, user);
  }

  /**
   * LAYER 1 of duplicate prevention: is there already a customer with this person's name?
   *
   * Gated on `customer.create`, NOT on `customer.read`. The two gates differ because the question
   * differs: this route exists only to be called from the create form, and a reader who cannot create a
   * customer has no use for it. Gating it on the read would hand the ordered-key lookup — which answers
   * "is this exact person on the book" — to every role that may browse the register, which is a narrower
   * version of the directory problem the search route was built to close.
   *
   * Declared BEFORE `@Get(':id')` for the same reason `search` is.
   */
  @RequirePermissions('customer.create')
  @Get('duplicate-name-check')
  checkDuplicateName(
    @Query() query: CheckDuplicateNameDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.customers.checkDuplicateName(query.legalName, user);
  }

  /**
   * THE OTHER HALF OF THE MEASUREMENT: the officer saw the warning and did not create the customer.
   *
   * A separate route because there is no create to hang it on — which is the whole point. The warning
   * working leaves no customer row, so a field on the create body could never record it, and without
   * this route the measurement would count only the times the warning was ignored. That number read
   * alone says the warning is useless when it may be the opposite.
   */
  @RequirePermissions('customer.create')
  @Post('duplicate-name-abandoned')
  recordAbandonedDuplicate(
    @Body() body: RecordAbandonedDuplicateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.customers.recordAbandonedDuplicate(body, user.id);
  }

  /**
   * IMPROVEMENTS § 3.14 — the first write to a customer record other than its creation.
   *
   * `customer.update` gates exactly the three fields that trigger no screening. The identifier fields are
   * refused by the DTO, because changing one is a screening event under the AMLU rules and ships with the
   * re-screening mechanism: https://amlu.gov.jo/EN/Pages/Frequently_Asked_Questions
   */
  /**
   * Correct a customer's DATE OF BIRTH or NATIONALITY — the owner's narrow strike of her own
   * 2026-09-28 deferral (2026-10-28). INDIVIDUAL customers only.
   *
   * ## THE SAME PERMISSION AS THE CONTACT CORRECTION, AND THAT IS A DECISION
   *
   * `customer.update` gates both. No code is minted, for the reason the org-unit reactivate route
   * records one batch earlier: correcting a customer's record is ONE capability, and a second code
   * would let an office grant the power to fix a phone number while withholding the power to fix a
   * date of birth — a split nobody asked for, on a path whose whole purpose is answering a statutory
   * correction request. What separates the two is not who may call them but what each one DOES: this
   * one demands a written reason, records the before and the after, and re-screens.
   *
   * ## WHY A SEPARATE ROUTE RATHER THAN TWO MORE FIELDS ON `PATCH :id`
   *
   * Because `UpdateCustomerContactDto` being a three-field class IS the first of the three layers
   * that keep the other six identifiers uneditable (the 2026-09-28 deferral's safety condition 1).
   * Widening it would retire that layer for `legalName`, the four name parts, `nationalId` and
   * `registrationNumber` as well — all of which the owner's strike deliberately leaves in place.
   *
   * Declared ABOVE `@Patch(':id')` so the more specific path is registered first.
   */
  @RequirePermissions('customer.update')
  @Patch(':id/identifiers')
  correctIdentifiers(
    @Param('id') id: string,
    @Body() dto: CorrectCustomerIdentifiersDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.customers.correctIdentifiers(id, dto, user);
  }

  @RequirePermissions('customer.update')
  @Patch(':id')
  updateContactDetails(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerContactDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.customers.updateContactDetails(id, dto, user);
  }

  @RequirePermissions('customer.360-view.read')
  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.customers.get(id, user);
  }

  @RequirePermissions('customer.360-view.read')
  @Post(':id/reveal-field')
  revealField(
    @Param('id') id: string,
    @Body() dto: RevealFieldDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.customers.revealField(id, dto, user);
  }

  @RequirePermissions('ubo.record')
  @Post(':id/ubos')
  addUbo(
    @Param('id') id: string,
    @Body() dto: CreateUboDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.customers.addUbo(id, dto, user);
  }

  @RequirePermissions('customer.360-view.read')
  @Get(':id/ubos')
  listUbos(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.customers.listUbos(id, user);
  }

  @RequirePermissions('kyc.capture')
  @Post(':id/documents')
  addDocument(
    @Param('id') id: string,
    @Body() dto: CreateCustomerDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.customers.addDocument(id, dto, user);
  }

  @RequirePermissions('customer.360-view.read')
  @Get(':id/documents')
  listDocuments(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.customers.listDocuments(id, user);
  }
}
