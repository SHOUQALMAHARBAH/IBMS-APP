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
import { ComparisonService } from './comparison.service';
import { QuotationComparisonDocumentService } from './quotation-comparison-document.service';
import { BuildComparisonDto } from './dto/build-comparison.dto';
import { ListComparisonQueryDto } from './dto/list-comparison-query.dto';
import { DocumentLanguageQueryDto } from '../document-generation/dto/document-language-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Process 14 — Quote Comparison (backlog Part C #14, Domain B). Build the
 * structured comparison matrix for an RFQ from its current-version
 * quotations, and flag the shortlisted insurers with no quote to compare.
 * See comparison.service.ts for the rules. Frontend: the "Comparison"
 * section on apps/web/app/(app)/rfqs/[id]/. */
@ApiTags('comparison-matrices')
@Controller('comparison-matrices')
export class ComparisonController {
  constructor(
    private readonly comparisons: ComparisonService,
    private readonly documents: QuotationComparisonDocumentService,
  ) {}

  @RequirePermissions('comparison.build')
  @Post()
  build(
    @Body() dto: BuildComparisonDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.comparisons.build(dto, user);
  }

  @RequirePermissions('comparison.read')
  @Get()
  get(
    @Query() query: ListComparisonQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.comparisons.get(query.rfqId, user);
  }

  @RequirePermissions('comparison.read')
  @Get(':id')
  getById(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.comparisons.getById(id, user);
  }

  // Part F item #7 — bilingual quotation-comparison PDF. Generated on
  // demand and streamed back, not persisted (no object storage exists
  // anywhere in this app). Same `comparison.read` permission and the
  // SAME visibility rule as getById above — QuotationComparisonDocument
  // Service.generate() goes through ComparisonService.getByIdWithCustomer,
  // never the repository directly.
  @RequirePermissions('comparison.read')
  @Get(':id/document')
  @Header('Content-Type', 'application/pdf')
  async document(
    @Param('id') id: string,
    @Query() query: DocumentLanguageQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StreamableFile> {
    const { buffer, fileName } = await this.documents.generate(
      id,
      query.language,
      user,
    );
    return new StreamableFile(buffer, {
      disposition: `attachment; filename="${fileName}"`,
    });
  }
}
