import { Injectable } from '@nestjs/common';
import type { RopaEntry } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateRopaEntryInput {
  processingActivity: string;
  categoriesOfData: string[];
  purpose: string;
  recipients: string[];
  retentionPeriodMonths: number | null;
}

export interface UpdateRopaEntryInput {
  processingActivity?: string;
  categoriesOfData?: string[];
  purpose?: string;
  recipients?: string[];
  retentionPeriodMonths?: number | null;
}

/** Records of Processing Activities (Part 9.3) — owns `RopaEntry`. Plain, fully-mutable CRUD — see
 * `ropa-entry.config.ts`'s header comment for why this differs from
 * `PrivacyNotice`'s immutable versioning. */
@Injectable()
export class RopaEntryRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateRopaEntryInput): Promise<RopaEntry> {
    return this.prisma.client.ropaEntry.create({ data: input });
  }

  findById(id: string): Promise<RopaEntry | null> {
    return this.prisma.client.ropaEntry.findUnique({ where: { id } });
  }

  findMany(take: number): Promise<RopaEntry[]> {
    return this.prisma.client.ropaEntry.findMany({
      orderBy: { processingActivity: 'asc' },
      take,
    });
  }

  update(id: string, input: UpdateRopaEntryInput): Promise<RopaEntry> {
    return this.prisma.client.ropaEntry.update({ where: { id }, data: input });
  }
}
