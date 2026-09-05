import { Injectable } from '@nestjs/common';
import type { BrokerLicense, Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';
import { BROKER_LICENSE_SINGLETON_ID } from '../modules/compliance-risk/broker-license.config';

export interface CreateBrokerLicenseInput {
  licenseNumber: string;
  scopeOfAuthorization: string | null;
  issuedAt: Date | null;
  expiresAt: Date;
}

export interface RenewBrokerLicenseInput {
  licenseNumber: string;
  scopeOfAuthorization: string | null;
  issuedAt: Date | null;
  expiresAt: Date;
}

/**
 * Process 51/Part 7.1 — owns the singleton `BrokerLicense` row (see
 * `broker-license.config.ts`'s `BROKER_LICENSE_SINGLETON_ID` for why this is
 * a fixed-id row, not a `findFirst` guess). Wraps `PrismaService` (services
 * depend on repositories in this codebase, never on Prisma directly).
 *
 * Provided directly by BOTH `ComplianceRiskModule` (owns create/renew/
 * mark-lapsed) and `PolicyModule` (`PolicyService.place()` reads it for the
 * new-business gate) — a stateless wrapper, safe to instantiate twice, the
 * `WatchlistEntryRepository` (#49) shape, avoiding a `ComplianceRiskModule`
 * <-> `PolicyModule` dependency in either direction for one narrow read.
 */
@Injectable()
export class BrokerLicenseRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The current license, or `null` if Compliance has not configured one
   * yet. `PolicyService.place()` treats `null` as "not blocked" — see that
   * method's own comment for why a not-yet-configured license must never be
   * indistinguishable from a lapsed one. */
  findCurrent(): Promise<BrokerLicense | null> {
    return this.prisma.client.brokerLicense.findUnique({
      where: { id: BROKER_LICENSE_SINGLETON_ID },
    });
  }

  create(input: CreateBrokerLicenseInput): Promise<BrokerLicense> {
    return this.prisma.client.brokerLicense.create({
      data: {
        id: BROKER_LICENSE_SINGLETON_ID,
        licenseNumber: input.licenseNumber,
        scopeOfAuthorization: input.scopeOfAuthorization,
        issuedAt: input.issuedAt,
        expiresAt: input.expiresAt,
        status: 'active',
      },
    });
  }

  /** A renewal always resets `status` to `'active'` — a fresh license period
   * supersedes any prior manual lapse/suspension. */
  renew(input: RenewBrokerLicenseInput): Promise<Prisma.BatchPayload> {
    return this.prisma.client.brokerLicense.updateMany({
      where: { id: BROKER_LICENSE_SINGLETON_ID },
      data: {
        licenseNumber: input.licenseNumber,
        scopeOfAuthorization: input.scopeOfAuthorization,
        issuedAt: input.issuedAt,
        expiresAt: input.expiresAt,
        status: 'active',
      },
    });
  }

  /** Manual override to `'lapsed'` ahead of the calendar expiry (e.g. a CBJ
   * suspension) — status-conditional so a concurrent call / an
   * already-lapsed license is a harmless 0-row match, not an error. */
  markLapsed(): Promise<Prisma.BatchPayload> {
    return this.prisma.client.brokerLicense.updateMany({
      where: { id: BROKER_LICENSE_SINGLETON_ID, status: 'active' },
      data: { status: 'lapsed' },
    });
  }
}
