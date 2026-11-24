import { Injectable } from '@nestjs/common';
import type { BrokerLicense, Prisma } from '@ibms/db';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 🔴 OWNER DECISION 128 — a term AS THE DERIVATION NEEDS IT: the row, plus whether anyone has
 * declared on it.
 *
 * The declaration is a RELATION and the derivation wants a boolean, so the shape is named here
 * rather than inferred at each call site. `null` means nobody has declared, which past the printed
 * expiry means the office may not issue yet — the non-widening direction, and the one decision
 * 136(ب)'s sentence exists for.
 */
export type BrokerLicenseTermRow = BrokerLicense & {
  renewalDeclaration: {
    id: string;
    actorNameShown: string;
    declaredAt: Date;
  } | null;
};

export interface CreateBrokerLicenseTermInput {
  licenseNumber: string;
  scopeOfAuthorization: string | null;
  issuedAt: Date | null;
  expiresAt: Date;
  /** The certificate, filed in the same transaction as the term it belongs to. */
  certificate: {
    fileName: string;
    storageRef: string;
    uploadedByUserId: string;
  };
}

/**
 * Module 0 item (c) — the office's licence TERMS. One row per term; renewal APPENDS.
 *
 * ## What this replaced, because the shape is worth not reinventing
 *
 * Every method here used to address a row by the constant `BROKER_LICENSE_SINGLETON_ID`, which was
 * the table's PRIMARY KEY. That made the licence one row PLATFORM-WIDE rather than one per office:
 * the second office to call `create` collided on `BrokerLicense_pkey`, and its `findCurrent`
 * returned NULL so the new-business gate passed silently. `renew` was an `updateMany` over that
 * same row, so the term being replaced was erased.
 *
 * Scoping is NOT done by hand here. `tenantScopeExtension` filters every query on this model by the
 * caller's Organization, because `BrokerLicense` carries `organizationId` — so `findTerms()` below
 * returns this office's terms and cannot return another's.
 *
 * Provided by `ComplianceRiskModule` (create/renew/record-a-regulatory-action/read) and by
 * `LicenseGateModule`, which is `@Global()` — the gate reads the terms for every office act that
 * needs a licence, so the six call sites inject the GATE rather than this repository. A stateless
 * wrapper, safe to instantiate twice, the `WatchlistEntryRepository` shape.
 *
 * `PolicyModule` no longer provides it: `PolicyService` used to read the terms itself and derive
 * its own answer, which was the second of three answers this batch collapsed into one.
 */
@Injectable()
export class BrokerLicenseRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every term this office holds, newest expiry first.
   *
   * The gate needs the LATEST term, not "the term covering today" — between filing a renewal and
   * the old term expiring an office legitimately holds two. Returning the series rather than one
   * row keeps that decision in `pickCurrentTerm`, where it is tested, instead of in an `orderBy`
   * nobody reads.
   */
  findTerms(): Promise<BrokerLicenseTermRow[]> {
    return this.prisma.client.brokerLicense.findMany({
      orderBy: [{ expiresAt: 'desc' }, { id: 'asc' }],
      /*
       * 🔴 OWNER DECISION 128 — the standing declaration comes back WITH the term, as an id only.
       *
       * One `include` rather than a second query per term: `standing()` is on the hot path (the
       * gate asks it on every placement) and its own comment promises THREE READS, ONE ROUND TRIP.
       * A fourth read here would have broken that quietly.
       *
       * 🔴 OWNER DECISION 159 RULING 3 WIDENED THIS `select` BY EXACTLY TWO COLUMNS, and the
       * sentence below is still the rule for everything it does not name.
       *
       * The screen now prints «أقرّ به {الاسم} في {التاريخ}» under the standing, so the name as
       * it stood and the instant have to travel with the term — and `standing()` is the one read
       * that carries the term to both the gate and the screen.
       *
       * ⛔ `declarationTextShown` and `networkAddress` STAY OUT. Pulling the declaration's text
       * and the actor's address into every licence read would put them on a query that answers
       * «may this office place business», which is more personal data than that question needs;
       * `sensitive-data-handling.md` is the rule and an address is not something a standing
       * needs. The two columns taken are exactly the two the ruling names.
       */
      include: {
        renewalDeclaration: {
          select: { id: true, actorNameShown: true, declaredAt: true },
        },
      },
    });
  }

  findTermById(id: string): Promise<BrokerLicense | null> {
    return this.prisma.client.brokerLicense.findUnique({ where: { id } });
  }

  /**
   * One new term AND its certificate, in ONE transaction.
   *
   * Both or neither, deliberately. `certificateDocumentId` is NOT NULL, so a term cannot be written
   * without a document — but two sequential writes could still leave a `Document` with no term
   * pointing at it if the second failed, which is an orphaned certificate in the office's records.
   * The same reasoning as `POST /admin/users` writing a person and their login together.
   */
  createTerm(input: CreateBrokerLicenseTermInput): Promise<BrokerLicense> {
    return this.prisma.client.$transaction(async (tx) => {
      const certificate = await tx.document.create({
        data: {
          category: 'BROKER_LICENSE_CERTIFICATE',
          // The licence certificate is the broker's own regulatory record, not customer data.
          classification: 'INTERNAL',
          fileName: input.certificate.fileName,
          storageRef: input.certificate.storageRef,
          uploadedByUserId: input.certificate.uploadedByUserId,
        },
      });

      return tx.brokerLicense.create({
        data: {
          licenseNumber: input.licenseNumber,
          scopeOfAuthorization: input.scopeOfAuthorization,
          issuedAt: input.issuedAt,
          expiresAt: input.expiresAt,
          certificateDocumentId: certificate.id,
        },
      });
    });
  }

  /**
   * Records that the renewal application for the term AFTER this one has been filed.
   *
   * Status-conditional on it not already being set, so a second call is a harmless 0-row match
   * rather than one that moves the recorded filing date — which is the date art. 11's 45-day
   * requirement is measured against, so overwriting it would change whether the office was on time.
   */
  recordRenewalRequest(
    id: string,
    requestedAt: Date,
    /** 🔴 OWNER DECISION 128 — the PROOF, written in the same statement as the date it belongs to.
     *  Optional at this boundary only so the existing date-only path keeps compiling; the SERVICE
     *  is what refuses a date with no proof, because that is a rule about what the office may do
     *  rather than about what the table may hold. */
    proof?: { documentId: string; referenceNumber: string },
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.client.brokerLicense.updateMany({
      where: { id, renewalRequestedAt: null },
      data: {
        renewalRequestedAt: requestedAt,
        ...(proof
          ? {
              renewalProofDocumentId: proof.documentId,
              renewalReferenceNumber: proof.referenceNumber,
            }
          : {}),
      },
    });
  }

  /**
   * 🔴 OWNER DECISION 128 — THE STANDING DECLARATION, written once for a term.
   *
   * A plain `create`. The uniqueness is the database's («مرة واحدة»), so a second attempt raises
   * P2002 and the service turns it into a 409 — rather than this reading first and racing, which
   * is `race-safe-invariants.md`'s whole subject.
   *
   * ⛔ There is no update and no delete here, and there must never be: the table's triggers refuse
   * both under every permission, so a method offering one would be a lie that fails at runtime.
   */
  createRenewalDeclaration(input: {
    brokerLicenseId: string;
    declarationTextShown: string;
    permissionCode: string;
    actorUserId: string;
    actorNameShown: string;
    networkAddress: string | null;
  }) {
    return this.prisma.client.licenseRenewalDeclaration.create({
      data: input,
    });
  }

  /** The declaration on a term, or null. Used by the screen, never by the gate — the gate gets its
   *  boolean from `findTerms`'s `include` without a second round trip. */
  findRenewalDeclaration(brokerLicenseId: string) {
    return this.prisma.client.licenseRenewalDeclaration.findUnique({
      where: { brokerLicenseId },
    });
  }

  /*
   * `markLapsed` IS GONE. It flipped `BrokerLicense.status` to `'lapsed'` — a two-value marker with
   * no basis, no date, no decision reference and no letter — and that column is dropped. The office
   * records a regulator's decision through `RegulatoryActionRepository.create` now, which is the one
   * home for "has the regulator stopped this office".
   */
}
