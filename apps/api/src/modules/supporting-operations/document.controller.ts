import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DocumentService } from './document.service';
import { CreateDocumentVersionDto } from './dto/create-document-version.dto';
import { ListDocumentsQueryDto } from './dto/list-documents-query.dto';
import { PolicyFileClassificationQueryDto } from './dto/policy-file-classification-query.dto';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Process 70 (backlog Part C #70, Domain H) — `document.manage` (upload/
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

  @RequirePermissions('document.manage')
  @Get('classification-summary')
  policyFileClassification(
    @Query() query: PolicyFileClassificationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.policyFileClassification(query.policyId, user.id);
  }

  @RequirePermissions('document.manage')
  @Get()
  list(@Query() query: ListDocumentsQueryDto) {
    return this.documents.list(query);
  }

  @RequirePermissions('document.manage')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.documents.get(id);
  }

  @RequirePermissions('document.manage')
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
