import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * LAYER 1's record. One write, and nothing else.
 *
 * Created 2026-10-02 with migration `20261109100000`.
 *
 * THE MEASUREMENT IS NOT HERE, deliberately. A `summarise()` method was written on this class first and
 * removed before committing, because nothing in the application would have called it — and a repository
 * method with no caller is exactly the shape this repo's own enforcement inventory exists to refuse. The
 * measurement lives at `scripts/measurements/duplicate-name-warnings.mjs`, which is where every other
 * question of the form "what did this control actually do" is answered here.
 *
 * What the table is FOR is the deferred layer-2 decision: the owner's ruling was to build the warning,
 * measure its effect, and let the NUMBER decide whether a keyed fingerprint earns its key-management
 * burden. Re-run the script rather than quoting a figure from it.
 */
@Injectable()
export class DuplicateNameWarningRepository {
  constructor(private readonly prisma: PrismaService) {}

  record(input: {
    actorUserId: string;
    canonicalKey: string;
    matchCount: number;
    samePerson: boolean;
    createdCustomerId?: string;
  }): Promise<{ id: string }> {
    return this.prisma.client.duplicateNameWarning.create({
      data: input,
      select: { id: true },
    });
  }
}
