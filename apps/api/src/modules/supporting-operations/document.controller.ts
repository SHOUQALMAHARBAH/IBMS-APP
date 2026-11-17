import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { DocumentService } from './document.service';
import { CreateDocumentVersionDto } from './dto/create-document-version.dto';
import { ListDocumentsQueryDto } from './dto/list-documents-query.dto';
import { PolicyFileClassificationQueryDto } from './dto/policy-file-classification-query.dto';
import { SearchDocumentsDto } from '../../common/picker-search.dto';
import { DOCUMENT_SEARCH_CODES } from '../../common/picker-search.config';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 70 (backlog Part C #70, Domain H) — `document.read` and `document.create` (view/upload/
 * version — the same permission `PolicyController`'s own document-attach
 * route already uses) gates the general surface; `document.delete-override`
 * (narrower, ADMIN/DPO only) gates the two deletion routes. See
 * `document.config.ts` for the full design.
 *
 * The static path `classification-summary` is declared before `:id` would
 * otherwise be reachable — Nest matches routes in declaration order, so it
 * is registered ahead of `GET /documents/:id` to avoid being swallowed by
 * it.
 */
@ApiTags('supporting-operations')
@Controller('documents')
export class DocumentController {
  constructor(private readonly documents: DocumentService) {}

  @RequirePermissions('document.read')
  @Get('classification-summary')
  policyFileClassification(
    @Query() query: PolicyFileClassificationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.policyFileClassification(query.policyId, user.id);
  }

  /**
   * THE DOCUMENT PICKER's source — owner decision 41.
   *
   * Gated on `DOCUMENT_SEARCH_CODES`, which is `document.read` ALONE and is a DELIBERATE departure from
   * the picker rule. The argument is in `common/picker-search.config.ts` and the short form is that the
   * alternative hands a read-only auditor a name search over every document in the office. Do not widen
   * it. What defends the narrowness is `picker-search-gates.e2e-spec.ts`, NOT a measurement:
   * `picker-route-reachability.mjs` is blind to this picker because its screen-side map has no entry
   * for the `documentId` field — measured, and the opposite of what this comment first claimed.
   *
   * Declared BEFORE `GET /documents/:id` — Nest matches in declaration order, so `search` would
   * otherwise be parsed as a document id and answer 404. The same reason `classification-summary` is
   * declared where it is, which this controller's own header already records.
   */
  @RequirePermissions(...DOCUMENT_SEARCH_CODES)
  @Get('search')
  searchForPicker(
    @Query() query: SearchDocumentsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.searchForPicker(query, user.id);
  }

  @RequirePermissions('document.read')
  @Get()
  list(@Query() query: ListDocumentsQueryDto) {
    return this.documents.list(query);
  }

  @RequirePermissions('document.read')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.documents.get(id);
  }

  /**
   * 🔴 OWNER DECISION 142 criterion 1 — the stored certificate, read back exactly as issued.
   *
   * `document.read`, the SAME code as the row beside it: the bytes are the document, and a
   * separate code would let an office be configured so somebody may see that a certificate
   * exists and not the certificate. ⛔ No new permission is minted for a read of something the
   * caller may already read.
   *
   * The sha256 is returned in a header rather than a body field because the body IS the file —
   * so a caller can verify what it received without parsing it.
   */
  @RequirePermissions('document.read')
  @Get(':id/content')
  async content(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const stored = await this.documents.content(id);
    response.set({
      'Content-Type': stored.contentType,
      'Content-Length': String(stored.byteSize),
      'Content-Disposition': `attachment; filename="${stored.fileName}"`,
      'X-Content-Sha256': stored.sha256,
    });
    return new StreamableFile(stored.bytes);
  }

  @RequirePermissions('document.create')
  @Post(':id/versions')
  createVersion(
    @Param('id') id: string,
    @Body() dto: CreateDocumentVersionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.createVersion(id, dto, user.id);
  }

  @RequirePermissions('document.delete-override')
  @Post(':id/deletion-override')
  overrideDeletionLock(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.overrideDeletionLock(id, user.id);
  }

  @RequirePermissions('document.delete-override')
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.documents.remove(id, user.id);
  }
}
