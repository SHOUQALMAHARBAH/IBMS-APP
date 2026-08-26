import { Module } from '@nestjs/common';
import { KeyRegistryService } from './key-registry.service';
import { EncryptionService } from './encryption.service';
import { EncryptionKeysController } from './controllers/encryption-keys.controller';

/** Part 10.2 — field-level encryption + centralized key management. No
 * import of AuditModule here: it's @Global() (see audit.module.ts) so
 * AuditService is already available for EncryptionService to inject. */
@Module({
  controllers: [EncryptionKeysController],
  providers: [KeyRegistryService, EncryptionService],
  exports: [EncryptionService, KeyRegistryService],
})
export class SecurityModule {}
