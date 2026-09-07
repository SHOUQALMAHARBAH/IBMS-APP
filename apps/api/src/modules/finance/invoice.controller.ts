import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InvoiceService } from './invoice.service';
import { CollectionService } from './collection.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { ListInvoicesQueryDto } from './dto/list-invoices-query.dto';
import { RecordReceiptDto } from './dto/record-receipt.dto';
import { RecordRemittanceDto } from './dto/record-remittance.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 31–32 — Premium Billing + Collection (backlog Part C #31–32, Domain
 * D). Raise a premium invoice against an issued policy (#31), then drive it
 * through the collection cycle: record the client's receipt
 * (`INVOICED → COLLECTED`), reconcile the collected funds to the invoice
 * (`COLLECTED → RECONCILED`), and remit the net premium to the insurer
 * (`RECONCILED → REMITTED`) — #32.
 *
 * Reads are gated on `client-accounting.read` (the same Finance / cross-book
 * reporting permission Process 33's ageing report will use); raising the
 * invoice on `invoice.create`; the collection / reconciliation steps on
 * `receipt.record`; the remittance on `remittance.record` — all Finance.
 * Frontend: the "Billing" block in the "Policy" section on
 * apps/web/app/(app)/opportunities/[id]/.
 */
@ApiTags('finance')
@Controller('invoices')
export class InvoiceController {
  constructor(
    private readonly invoices: InvoiceService,
    private readonly collection: CollectionService,
  ) {}

  @RequirePermissions('invoice.create')
  @Post()
  create(
    @Body() dto: CreateInvoiceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoices.create(dto, user);
  }

  /** Process 32 — record the client's collection receipt for the full
   * invoiced total. Drives `Invoice INVOICED → COLLECTED` and books an `in`
   * client-funds ledger entry. */
  @RequirePermissions('receipt.record')
  @Post(':id/receipt')
  recordReceipt(
    @Param('id') id: string,
    @Body() dto: RecordReceiptDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.collection.recordReceipt(id, dto, user);
  }

  /** Process 32 — confirm the collected funds reconcile to the invoiced
   * total. Drives `Invoice COLLECTED → RECONCILED`. */
  @RequirePermissions('receipt.record')
  @Post(':id/reconcile')
  reconcile(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.collection.reconcile(id, user);
  }

  /** Process 32 — remit the net premium (`premium − commission`) to the
   * insurer. Drives `Invoice RECONCILED → REMITTED` and books an `out`
   * client-funds ledger entry. */
  @RequirePermissions('remittance.record')
  @Post(':id/remittance')
  recordRemittance(
    @Param('id') id: string,
    @Body() dto: RecordRemittanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.collection.recordRemittance(id, dto, user);
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
