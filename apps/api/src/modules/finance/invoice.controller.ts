import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InvoiceService } from './invoice.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { ListInvoicesQueryDto } from './dto/list-invoices-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 31 — Premium Billing (backlog Part C #31, Domain D). Raise a
 * premium invoice against an issued policy — premium + tax + fees, net of the
 * placed commission, with a due date — and read invoices back scoped to one
 * policy or customer.
 *
 * Reads are gated on `client-accounting.read` (the same Finance / cross-book
 * reporting permission Process 33's ageing report will use); the write on
 * `invoice.create` (Finance only). Frontend: the "Billing" block in the
 * "Policy" section on apps/web/app/(app)/opportunities/[id]/.
 */
@ApiTags('finance')
@Controller('invoices')
export class InvoiceController {
  constructor(private readonly invoices: InvoiceService) {}

  @RequirePermissions('invoice.create')
  @Post()
  create(
    @Body() dto: CreateInvoiceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoices.create(dto, user);
  }

  @RequirePermissions('client-accounting.read')
  @Get()
  list(@Query() query: ListInvoicesQueryDto) {
    return this.invoices.list(query);
  }

  @RequirePermissions('client-accounting.read')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.invoices.get(id);
  }
}
