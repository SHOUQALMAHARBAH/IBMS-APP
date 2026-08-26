import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { KeyRegistryService } from '../key-registry.service';
import { RequireRoles } from '../../auth/decorators/require-roles.decorator';
import { RequirePermissions } from '../../rbac/decorators/require-permissions.decorator';

const keyMetadataListSchema = {
  type: 'array' as const,
  items: {
    type: 'object' as const,
    properties: {
      keyId: { type: 'string' as const },
      active: { type: 'boolean' as const },
    },
    required: ['keyId', 'active'],
  },
};

/** Part 10.2 — centralized key management, restricted key-custodian access.
 * SYSTEM_SECURITY_ADMINISTRATOR is the designated key-custodian role. Only
 * metadata is ever exposed here — key material never leaves process
 * memory/env config, so there is nothing to leak even to an authorized
 * custodian's browser. */
@ApiTags('security')
@Controller('security')
export class EncryptionKeysController {
  constructor(private readonly keys: KeyRegistryService) {}

  @RequireRoles('SYSTEM_SECURITY_ADMINISTRATOR')
  @RequirePermissions('encryption-key.read')
  @Get('encryption-keys')
  @ApiOkResponse({
    description:
      'PII field-encryption key metadata (id + active/retired status) — never key material.',
    schema: keyMetadataListSchema,
  })
  listKeys() {
    return this.keys.listKeyMetadata();
  }
}
