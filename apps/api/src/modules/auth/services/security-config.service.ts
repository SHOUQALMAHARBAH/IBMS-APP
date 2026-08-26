import { Injectable } from '@nestjs/common';
import type { SecurityConfig } from '@ibms/db';
import { SecurityConfigRepository } from '../../../repositories/security-config.repository';

@Injectable()
export class SecurityConfigService {
  constructor(private readonly repo: SecurityConfigRepository) {}

  get(): Promise<SecurityConfig> {
    return this.repo.get();
  }

  update(
    patch: Partial<
      Pick<
        SecurityConfig,
        | 'idleTimeoutMinutes'
        | 'hardLogoutAfterIdleMinutes'
        | 'accessTokenTtlMinutes'
        | 'refreshTokenTtlDays'
        | 'stepUpMaxAgeMinutes'
        | 'maxFailedLoginAttempts'
        | 'lockoutMinutes'
      >
    >,
    updatedByUserId: string,
  ): Promise<SecurityConfig> {
    return this.repo.update(patch, updatedByUserId);
  }
}
