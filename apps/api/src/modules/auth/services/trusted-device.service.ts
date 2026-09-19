import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { TrustedDeviceRepository } from '../../../repositories/trusted-device.repository';
import { AuditService } from '../../audit/audit.service';
import type { RoleSecurityAttributes } from '../auth.types';

/** Part II §4.1.4 — "default: trustedAt + 30 days, configurable". */
export const TRUSTED_DEVICE_TTL_DAYS = Number(
  process.env.TRUSTED_DEVICE_TTL_DAYS ?? 30,
);

export interface DeviceContext {
  /** Client-supplied device fingerprint. Never stored raw. */
  fingerprint?: string;
  userAgent?: string;
  ipAddress?: string;
}

/**
 * Part II §4.4 — trusted devices, which let a standard role skip the MFA prompt
 * on a machine they use every day.
 *
 * ## What a fingerprint is and is not
 *
 * It is a client-supplied hint, not a credential. Anyone who can send a request
 * can send any fingerprint they like, so trust is only ever consulted AFTER the
 * password has been verified — it can shorten the second factor for someone who
 * already proved the first, and it can do nothing at all on its own. That is
 * also why the raw value never lands in the database: hashed, it answers "have
 * I seen this device for this user before" and nothing else.
 */
export interface TrustedDeviceView {
  id: string;
  /** What the user called this device when they trusted it, if anything. */
  label: string | null;
  trustedAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
}

@Injectable()
export class TrustedDeviceService {
  constructor(
    private readonly devices: TrustedDeviceRepository,
    private readonly audit: AuditService,
  ) {}

  /** Stable, non-reversible identifier for a device. */
  hashFingerprint(fingerprint: string): string {
    return createHash('sha256').update(fingerprint).digest('hex');
  }

  /**
   * Whether this login may skip the MFA prompt.
   *
   * Three conditions, all required: no role this caller holds carries §4.4's
   * always-MFA obligation, the request actually carried a fingerprint, and that
   * fingerprint matches a live trust for THIS user. Anything missing means
   * prompt.
   *
   * Takes the RESOLVED obligation rather than a list of role names. The name
   * list this replaced could not recognise a role an office invented, so a
   * custom role skipped the prompt it should never have been offered; a column
   * on `Role` that defaults to strict cannot.
   */
  async maySkipMfa(
    userId: string,
    security: RoleSecurityAttributes,
    device: DeviceContext,
  ): Promise<boolean> {
    if (security.requiresMfaAlways) return false;
    if (!device.fingerprint) return false;

    const trusted = await this.devices.findLiveForUser(
      userId,
      this.hashFingerprint(device.fingerprint),
    );
    if (!trusted) return false;

    await this.devices.touchLastUsed(trusted.id);
    return true;
  }

  /**
   * Grants a 30-day trust after a successful MFA verification.
   *
   * Refused outright for an always-MFA caller, even though the UI is told not
   * to render the option: a control that only exists in the client is not a
   * control. Returns `null` in that case rather than throwing, because a client
   * that asks is not misbehaving — it may simply be stale — and the login it
   * asked during has already succeeded.
   */
  async trust(
    userId: string,
    security: RoleSecurityAttributes,
    device: DeviceContext,
  ): Promise<{ id: string; expiresAt: Date } | null> {
    if (security.requiresMfaAlways) return null;
    if (!device.fingerprint) return null;

    const expiresAt = new Date(
      Date.now() + TRUSTED_DEVICE_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    const granted = await this.devices.grant({
      userId,
      deviceFingerprintHash: this.hashFingerprint(device.fingerprint),
      label: device.userAgent?.slice(0, 200) ?? null,
      firstSeenIp: device.ipAddress ?? null,
      expiresAt,
    });

    await this.audit.record({
      userId,
      action: 'CREATE',
      entityType: 'TrustedDevice',
      entityId: granted.id,
      afterValue: {
        expiresAt: expiresAt.toISOString(),
        label: granted.label,
        // Never the fingerprint, raw or hashed — an audit trail that records a
        // stable device identifier becomes a movement log for the employee.
      },
    });
    return { id: granted.id, expiresAt };
  }

  /**
   * The devices a user currently trusts, as a VIEW rather than the row.
   *
   * `deviceFingerprintHash` and `firstSeenIp` never leave the server. This
   * file already refuses to put a stable device identifier in the audit trail,
   * on the grounds that one "becomes a movement log for the employee" — and a
   * JSON response the browser can read is no better a place for it than an
   * audit row. The endpoint used to return the whole record; nothing consumed
   * it, so narrowing costs nothing.
   *
   * What is left is what a person needs in order to recognise a device and
   * decide whether to drop it: what they called it, when they trusted it, when
   * that trust lapses, and when it was last used.
   */
  async list(userId: string): Promise<TrustedDeviceView[]> {
    const devices = await this.devices.listLiveForUser(userId);
    return devices.map((d) => ({
      id: d.id,
      label: d.label,
      trustedAt: d.trustedAt.toISOString(),
      expiresAt: d.expiresAt.toISOString(),
      lastUsedAt: d.lastUsedAt?.toISOString() ?? null,
    }));
  }

  /**
   * Revokes one device. A user may only revoke their own.
   *
   * The ownership check is deliberately a 404, not a 403: confirming that some
   * other user's device id exists would be a small leak, and there is nothing
   * useful the caller can do with the distinction.
   */
  async revoke(
    userId: string,
    deviceId: string,
    actorUserId: string,
  ): Promise<void> {
    const device = await this.devices.findById(deviceId);
    if (!device || device.userId !== userId) {
      throw new NotFoundException('Trusted device not found');
    }

    const rows = await this.devices.revoke(deviceId, 'user_revoked');
    await this.audit.record({
      userId: actorUserId,
      action: 'DELETE',
      entityType: 'TrustedDevice',
      entityId: deviceId,
      afterValue: { revoked: rows > 0, ownerUserId: userId },
    });
  }

  /**
   * Drops every trust for a user, used when their password changes (§4.7).
   *
   * A password change is the moment to assume the old one may have been known
   * by someone else; leaving that person's device trusted would let them keep
   * skipping the second factor.
   */
  async revokeAllForUser(userId: string, reason: string): Promise<number> {
    return this.devices.revokeAllForUser(userId, reason);
  }
}
