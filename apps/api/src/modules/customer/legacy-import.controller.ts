import {
  Body,
  Controller,
  Post,
  UnprocessableEntityException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { LegacyImportService } from './legacy-import.service';
import { LegacyImportDto } from './dto/legacy-import.dto';
import { LEGACY_IMPORT_MAX_BYTES } from './legacy-import.config';

/**
 * Part III §7 — load an office's legacy customer file.
 *
 * The upload is held in MEMORY and never written to disk. This system has no
 * object storage and this endpoint does not introduce one: a customer list
 * spooled to a temp file is Confidential personal data sitting outside every
 * control the rest of the system has (no encryption at rest, no retention
 * schedule, no disposal record), and it would outlive the request.
 *
 * `limits.fileSize` is set here AND re-checked in the service. The interceptor
 * is the cheap guard that stops the bytes being buffered at all; the service
 * check is the one that still holds if this decorator is ever edited.
 */
@ApiTags('legacy-import')
@Controller('imports')
export class LegacyImportController {
  constructor(private readonly legacyImport: LegacyImportService) {}

  @RequirePermissions('customer.bulk-import')
  @Post('customers')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      // No `storage` option: multer's default is memory storage, which is what
      // is wanted. Naming it would be clearer, but passing `diskStorage` here
      // by habit is the mistake this comment exists to prevent.
      limits: { fileSize: LEGACY_IMPORT_MAX_BYTES, files: 1 },
    }),
  )
  @ApiOkResponse({
    description:
      'Row counts for the batch, plus every rejected line by number and reason.',
  })
  async importCustomers(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: LegacyImportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) {
      throw new UnprocessableEntityException(
        'Attach the legacy export as a multipart field named "file".',
      );
    }
    return this.legacyImport.import({
      file,
      mapping: dto.mapping,
      actorUserId: user.id,
    });
  }
}
