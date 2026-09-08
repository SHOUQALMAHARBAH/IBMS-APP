import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InvoiceService } from './invoice.service';
import { CollectionService } from './collection.service';
import { InvoiceDocumentService } from './invoice-document.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { ListInvoicesQueryDto } from './dto/list-invoices-query.dto';
import { RecordReceiptDto } from './dto/record-receipt.dto';
import { RecordRemittanceDto } from './dto/record-remittance.dto';
import { DocumentLanguageQueryDto } from '../document-generation/dto/document-language-query.dto';
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
    private readonly invoiceDocuments: InvoiceDocumentService,
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

  // Part F item #7 — bilingual invoice PDF. Generated on demand and
  // streamed back, not persisted (no object storage exists anywhere in
  // this app). Same `client-accounting.read` permission as get() above —
  // a flat, book-wide Finance permission with no per-customer visibility
  // scoping beyond it (unlike Policy/ComparisonMatrix/Recommendation's
  // own scoped document endpoints), confirmed by reading InvoiceService
  // before building this.
  @RequirePermissions('client-accounting.read')
  @Get(':id/document')
  @Header('Content-Type', 'application/pdf')
  async document(
    @Param('id') id: string,
    @Query() query: DocumentLanguageQueryDto,
  ): Promise<StreamableFile> {
    const { buffer, fileName } = await this.invoiceDocuments.generate(
      id,
      query.language,
    );
    return new StreamableFile(buffer, {
      disposition: `attachment; filename="${fileName}"`,
    });
  }
}
