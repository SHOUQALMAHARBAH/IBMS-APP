import { Injectable } from '@nestjs/common';
import type { MfaCredential, MfaCredentialType } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MfaCredentialRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<MfaCredential | null> {
    return this.prisma.client.mfaCredential.findUnique({ where: { id } });
  }

  findActiveByUserAndType(
    userId: string,
    type: MfaCredentialType,
  ): Promise<MfaCredential | null> {
    return this.prisma.client.mfaCredential.findFirst({
      where: { userId, type, isActive: true },
    });
  }

  findActiveByUser(userId: string): Promise<MfaCredential[]> {
    return this.prisma.client.mfaCredential.findMany({
      where: { userId, isActive: true },
    });
  }

  create(data: {
    userId: string;
    type: MfaCredentialType;
    secretEnc?: string;
    label?: string;
    isActive?: boolean;
  }): Promise<MfaCredential> {
    return this.prisma.client.mfaCredential.create({ data });
  }

  activate(id: string): Promise<MfaCredential> {
    return this.prisma.client.mfaCredential.update({
      where: { id },
      data: { isActive: true, lastUsedAt: new Date() },
    });
  }

  touchLastUsed(id: string): Promise<MfaCredential> {
    return this.prisma.client.mfaCredential.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }

  deactivate(id: string): Promise<MfaCredential> {
    return this.prisma.client.mfaCredential.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
