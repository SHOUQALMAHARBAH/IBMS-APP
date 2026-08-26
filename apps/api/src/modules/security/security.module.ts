import { Module } from '@nestjs/common';
import { KeyRegistryService } from './key-registry.service';
import { EncryptionService } from './encryption.service';
import { SensitiveFieldRevealService } from './sensitive-field-reveal.service';
import { EncryptionKeysController } from './controllers/encryption-keys.controller';

/** Part 10.2/10.6 — field-level encryption, centralized key management, and
 * masked/justified-drill-down display of Highly Confidential fields. No
 * import of AuditModule here: it's @Global() (see audit.module.ts) so
 * AuditService is already available for EncryptionService/
 * SensitiveFieldRevealService to inject. */
@Module({
  controllers: [EncryptionKeysController],
  providers: [
    KeyRegistryService,
    EncryptionService,
    SensitiveFieldRevealService,
  ],
  exports: [EncryptionService, KeyRegistryService, SensitiveFieldRevealService],
})
export class SecurityModule {}
