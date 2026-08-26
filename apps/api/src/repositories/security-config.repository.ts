import { Injectable } from '@nestjs/common';
import type { SecurityConfig } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

const SINGLETON_ID = 'default';

@Injectable()
export class SecurityConfigRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Fetches the single config row, creating it with defaults if absent. */
  async get(): Promise<SecurityConfig> {
    return this.prisma.client.securityConfig.upsert({
      where: { id: SINGLETON_ID },
      update: {},
      create: { id: SINGLETON_ID },
    });
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
    return this.prisma.client.securityConfig.upsert({
      where: { id: SINGLETON_ID },
      update: { ...patch, updatedByUserId },
      create: { id: SINGLETON_ID, ...patch, updatedByUserId },
    });
  }
}
