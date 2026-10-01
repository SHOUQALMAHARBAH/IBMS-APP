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
import { ListCustomersQueryDto } from './dto/list-customers-query.dto';
import { SearchCustomersDto } from './dto/search-customers.dto';
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
    return this.customers.create(dto, user.id);
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
   * Gated on `customer.read`, the same code as the list: finding a customer here is the same act as
   * finding one there, and a narrower code would make the field unusable for the roles the list exists
   * for. The RESULT is narrower than a list row — see `CustomerSearchResultView`.
   *
   * Declared BEFORE `@Get(':id')` so `search` is never parsed as a customer id — the same ordering
   * `GET /employees/search` needs and says so.
   */
  @RequirePermissions('customer.read')
  @Get('search')
  search(
    @Query() query: SearchCustomersDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.customers.search(query, user);
  }

  /**
   * IMPROVEMENTS § 3.14 — the first write to a customer record other than its creation.
   *
   * `customer.update` gates exactly the three fields that trigger no screening. The identifier fields are
   * refused by the DTO, because changing one is a screening event under the AMLU rules and ships with the
   * re-screening mechanism: https://amlu.gov.jo/EN/Pages/Frequently_Asked_Questions
   */
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
