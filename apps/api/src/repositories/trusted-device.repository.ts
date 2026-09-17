import { Injectable } from '@nestjs/common';
import type { TrustedDevice } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Part II §4.1.4 — the devices a user has chosen to trust, so a standard role
 * is not re-prompted for a TOTP code on a machine they use every day.
 *
 * The model has existed since Phase 1 and had no consumer until now.
 *
 * A fingerprint is only ever stored HASHED (`deviceFingerprintHash`). The raw
 * value is a stable identifier for someone's personal machine, so keeping it
 * would turn this table into a device-tracking log of every employee; the hash
 * answers the only question the feature asks — "have I seen this exact device
 * before for this user" — and answers nothing else.
 */
@Injectable()
export class TrustedDeviceRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A live trust for this user and device, or null.
   *
   * "Live" means all three of: not revoked, not past its expiry, and belonging
   * to this user. Checking expiry in the query rather than after it means an
   * expired row can never be read as a match by a caller that forgets to look.
   */
  findLiveForUser(
    userId: string,
    deviceFingerprintHash: string,
  ): Promise<TrustedDevice | null> {
    return this.prisma.client.trustedDevice.findFirst({
      where: {
        userId,
        deviceFingerprintHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
  }

  findById(id: string): Promise<TrustedDevice | null> {
    return this.prisma.client.trustedDevice.findUnique({ where: { id } });
  }

  listLiveForUser(userId: string): Promise<TrustedDevice[]> {
    return this.prisma.client.trustedDevice.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { trustedAt: 'desc' },
    });
  }

  /**
   * Grants trust, or extends an existing live grant for the same device.
   *
   * Re-granting reuses the row rather than inserting a second one: a user who
   * ticks the box again on the same machine means "keep trusting this", not
   * "start a parallel trust I now have to revoke twice".
   */
  async grant(input: {
    userId: string;
    deviceFingerprintHash: string;
    label: string | null;
    firstSeenIp: string | null;
    expiresAt: Date;
  }): Promise<TrustedDevice> {
    const existing = await this.findLiveForUser(
      input.userId,
      input.deviceFingerprintHash,
    );
    if (existing) {
      return this.prisma.client.trustedDevice.update({
        where: { id: existing.id },
        data: {
          expiresAt: input.expiresAt,
          label: input.label ?? existing.label,
          lastUsedAt: new Date(),
        },
      });
    }
    return this.prisma.client.trustedDevice.create({
      data: {
        userId: input.userId,
        deviceFingerprintHash: input.deviceFingerprintHash,
        label: input.label,
        firstSeenIp: input.firstSeenIp,
        expiresAt: input.expiresAt,
        lastUsedAt: new Date(),
      },
    });
  }

  touchLastUsed(id: string): Promise<TrustedDevice> {
    return this.prisma.client.trustedDevice.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }

  /**
   * Revokes one device, returning how many rows that actually changed.
   *
   * The count is returned rather than swallowed (Part V item 6): revoking a
   * trusted device is a security control, and "it reported success but the row
   * was never visible to this session" is precisely the failure Phase 2 step 8
   * found on a different control.
   */
  async revoke(id: string, reason: string): Promise<number> {
    const { count } = await this.prisma.client.trustedDevice.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return count;
  }

  /** Revokes every live trust for a user — used when their password changes. */
  async revokeAllForUser(userId: string, reason: string): Promise<number> {
    const { count } = await this.prisma.client.trustedDevice.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return count;
  }
}
