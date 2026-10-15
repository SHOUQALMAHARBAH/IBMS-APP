import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import type { TenantTransactionClient } from '../../prisma/tenant-scope.extension';
import { OrgContextService } from '../../common/org-context/org-context.service';
import { AuditService } from '../audit/audit.service';
import { EncryptionService } from '../security/encryption.service';
import { parseCalendarDate } from '../../common/calendar-date.util';
import { toMoney } from '../../common/money.util';
import {
  assessCapital,
  breachesNaturalPersonOneTypeRule,
  typesInScope,
  type ScopedBranch,
} from '../compliance-risk/broker-license-scope.config';
import {
  expiryIsEndOfCalendarYear,
  expiryMatchesThreeYearTerm,
} from '../compliance-risk/broker-license.config';
import {
  OFFICE_ADMINISTRATOR_GRANTS,
  OFFICE_ADMINISTRATOR_ROLE_NAME,
} from './office-administrator-grants';
import { deriveRegistrationPackState } from './registration-pack.config';
import type { RegisterBrokerageOfficeDto } from './dto/register-brokerage-office.dto';

/**
 * MODULE 0-ب ITEM (d) — REGISTERING A BROKERAGE OFFICE.
 *
 * ## THIS IS THE ONLY ROUTE IN THIS PRODUCT THAT CREATES A TENANT
 *
 * Measured BEFORE this item existed: `Organization` had exactly TWO writers in the whole repository
 * — `packages/db/prisma/seed.ts` and `apps/api/scripts/seed-demo.script.ts` — and neither was
 * reachable over HTTP.
 *
 * THAT IS NO LONGER TRUE, AND THIS FILE IS WHY. There are FOUR writers now and TWO of them are
 * reachable over HTTP: this service and `insurance-company-registration.service.ts`. An earlier
 * version of this comment also said `soleOrganizationIdOrThrow`'s refusal "says so in its own
 * message" — it no longer does, and the sentence was corrected there in the same pass that found
 * this one. Left standing, a comment is a promise: the next reader would have built on a count of
 * two in the file that made it four.
 *
 * That makes the care here disproportionate to the line count on purpose. A defect in a route that
 * edits a row damages a row; a defect here produces a tenant that is wrong from its first second,
 * and every record anyone puts in it afterwards inherits that.
 *
 * ## ONE TRANSACTION, AND EVERY VALIDATION INSIDE IT
 *
 * The owner's instruction, and the reason is the half-registered office. Validate-then-write leaves
 * a window in which the establishment number is free when checked and taken when written; worse, a
 * refusal that happens after three of seven writes leaves an `Organization` with a licence and no
 * administrator — an office nobody can get into and nothing can clean up, because a tenant is not
 * something a support script should be deleting.
 *
 * So the uniqueness reads, the article checks and all seven writes are inside one
 * `$transaction`, and the database's own unique indexes are the backstop for the race the reads
 * cannot close. Both are needed: the read turns a collision into a sentence naming the field, and
 * the index is what makes the guarantee true under concurrency.
 *
 * ## WHY `runAs(newOrganizationId)`
 *
 * Six of the seven models written here are tenant-scoped, so `tenantScopeExtension` stamps
 * `organizationId` from the ambient context and RLS refuses anything else. Writing a new office's
 * rows from the provider's own context is therefore impossible by construction — which is the
 * isolation working, not an obstacle to route around. `runAs` opens a context for the office being
 * created, and every write lands correctly with no call site passing an `organizationId` by hand.
 *
 * The AUDIT ROW IS DELIBERATELY OUTSIDE IT, in the provider's own trail. Two reasons:
 *
 *   * it is the PROVIDER'S act. Registering an office is something the platform operator did, and
 *     the provider's trail is where anyone auditing the operator would look.
 *   * `GET /audit-trail/actors` resolves actor names WITHIN an office. A provider user id written
 *     into a brokerage office's trail would render there as a raw uuid forever — the exact defect
 *     the actor-name work fixed, reintroduced in a place nobody would think to look.
 *
 * The cost is stated rather than hidden: the audit write is outside the transaction, so a failure
 * there leaves the office registered and unlogged. That is the safer direction — the alternative
 * rolls back a correctly registered tenant because a log line failed — and it is why the row records
 * only what the response already returns.
 */
@Injectable()
export class OfficeRegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgContext: OrgContextService,
    private readonly audit: AuditService,
    private readonly encryption: EncryptionService,
  ) {}

  async registerBrokerageOffice(
    actor: { id: string; organizationId: string },
    dto: RegisterBrokerageOfficeDto,
  ) {
    await this.assertCallerIsTheProvider(actor.organizationId);

    const organizationId = randomUUID();

    /*
     * ENCRYPTED BEFORE THE TRANSACTION OPENS, and that is not an oversight. `EncryptionService.
     * encrypt` writes a key-use audit row of its own, so calling it inside would put a write into
     * the office's transaction that has nothing to do with whether the office is valid — and if the
     * registration is then refused, that key-use row is rolled back and the key use is unrecorded.
     * Recording a key use that happened is worth more than tidiness.
     */
    const ibanEnc = await this.encryption.encrypt('pii', dto.iban, {
      userId: actor.id,
      entityType: 'Organization',
      entityId: organizationId,
      field: 'ibanEnc',
    });

    const result = await this.orgContext.runAs(organizationId, () =>
      this.prisma.client.$transaction(async (tx) => {
        // ---------------------------------------------------------------- REFUSAL 1 of 4
        /*
         * THE DUPLICATE REGISTRATION. The national establishment number identifies the legal
         * entity, so the same establishment registered twice is two tenants holding one business's
         * records — and nothing downstream could ever tell which was real.
         *
         * Read ACROSS ORGANIZATION TYPES deliberately: an establishment registered once as a
         * brokerage office must not be registerable again as an insurance company. `Organization`
         * carries no `organizationId`, so this read is genuinely platform-wide and needs no bypass.
         *
         * The unique index is the backstop for the race this read cannot close; this is here so the
         * caller gets a sentence naming the field instead of a 500 from a constraint.
         */
        const existingEstablishment = await tx.organization.findUnique({
          where: { nationalEstablishmentNo: dto.nationalEstablishmentNo },
          select: { id: true, legalName: true, type: true },
        });
        if (existingEstablishment) {
          throw new ConflictException(
            `national establishment number ${dto.nationalEstablishmentNo} is already registered to "${existingEstablishment.legalName}". One establishment is one organization on this platform, whether it is a brokerage office or an insurance company — if this is the same business, correct that record rather than registering it again.`,
          );
        }

        const existingCode = await tx.organization.findUnique({
          where: { code: dto.code },
          select: { id: true },
        });
        if (existingCode) {
          throw new ConflictException(
            `code ${dto.code} is already in use. Office and insurer codes share one namespace on this platform, so a code is unique across both.`,
          );
        }

        const existingSubdomain = await tx.organization.findUnique({
          where: { subdomain: dto.subdomain },
          select: { id: true },
        });
        if (existingSubdomain) {
          throw new ConflictException(
            `subdomain ${dto.subdomain} is already in use.`,
          );
        }

        // ------------------------------------------------- the licence scope, resolved first
        /*
         * Resolved BEFORE the article checks because both of them are functions of it: art. 3/a
         * counts the TYPES these branches belong to, and art. 4/a's capital bands count the branches
         * within each type. Neither can be decided from the ids alone.
         *
         * The catalogue's `category` is what carries the type — never a column on the licence. That
         * is decision 67, restated by the dictionary's correction 4.
         */
        const lines = await tx.insuranceLine.findMany({
          where: { id: { in: dto.licensedLineIds } },
          select: { id: true, code: true, category: true },
        });
        if (lines.length !== dto.licensedLineIds.length) {
          const found = new Set(lines.map((l) => l.id));
          const missing = dto.licensedLineIds.filter((id) => !found.has(id));
          throw new UnprocessableEntityException(
            `${missing.length} of the licensed lines do not exist in the standard catalogue: ${missing.join(', ')}. A licence scope is chosen from the 32 standard lines; an office's own additional lines are recorded after registration.`,
          );
        }
        const branches: ScopedBranch[] = lines.map((l) => ({
          category: l.category,
        }));

        // ---------------------------------------------------------------- REFUSAL 2 of 4
        /*
         * ART. 3/a — a NATURAL PERSON broker (a sole establishment, art. 10/a/1/a) may be licensed
         * for ONE insurance type. A company may hold both.
         *
         * Item (b) named this rule and deliberately did not enforce it, because no column stored a
         * scope to check against. Item (e) built the check. This is the first place it can refuse a
         * registration rather than an edit — and refusing here is what stops a natural-person office
         * existing in a state art. 3/a does not permit, rather than being corrected into one later.
         */
        if (breachesNaturalPersonOneTypeRule(dto.brokerKind, branches)) {
          const types = typesInScope(branches);
          throw new UnprocessableEntityException(
            `a natural-person broker may be licensed for ONE insurance type (CBJ Instructions No. 9 of 2026, art. 3/a), and the branches chosen span ${types.length}: ${types.join(' and ')}. Register this office as CORPORATE, or choose branches within a single type.`,
          );
        }

        // ------------------------------------------------------ art. 4/a — INFORMATION, NOT A GATE
        /*
         * THE FOURTH "REFUSAL" IS NOT ONE, AND THAT IS THE POINT. Capital below the summed
         * requirement is REPORTED on the response and never blocks the registration.
         *
         * Art. 4/a sets the bands; what it does not do is make the CBJ's own licensing decision ours
         * to second-guess. An office arrives here holding a licence the regulator has already
         * granted — the certificate is attached — so refusing to record it because our arithmetic
         * disagrees would leave a licensed brokerage unable to exist on the platform at all, on the
         * strength of a reading ("per type" as SUMMED) that is flagged in `requiredCapitalForScope`
         * as one of two defensible ones.
         *
         * A reading that can only make a warning appear is a safe place to be approximately right
         * and say so. The same reading inside a refusal would not be.
         */
        const capital = assessCapital(
          dto.paidUpCapital === undefined ? null : toMoney(dto.paidUpCapital),
          branches,
        );

        // --------------------------------------------------------------------------- writes
        const licenseIssuedAt = parseCalendarDate(
          dto.licenseIssuedAt,
          'licenseIssuedAt',
        );
        const licenseExpiresAt = parseCalendarDate(
          dto.licenseExpiresAt,
          'licenseExpiresAt',
        );

        const organization = await tx.organization.create({
          data: {
            id: organizationId,
            type: 'BROKERAGE_OFFICE',
            brokerKind: dto.brokerKind,
            brokerageKind: dto.brokerageKind,
            legalName: dto.legalName,
            legalNameAr: dto.legalNameAr,
            tradeName: dto.tradeName ?? null,
            code: dto.code,
            subdomain: dto.subdomain,
            nationalEstablishmentNo: dto.nationalEstablishmentNo,
            commercialRegistrationNo: dto.commercialRegistrationNo,
            commercialRegistrationDate: dto.commercialRegistrationDate
              ? parseCalendarDate(
                  dto.commercialRegistrationDate,
                  'commercialRegistrationDate',
                )
              : null,
            taxNumber: dto.taxNumber,
            legalFormId: dto.legalFormId,
            licensingAuthorityId: dto.licensingAuthorityId,
            countryId: dto.countryId,
            cityId: dto.cityId,
            address: dto.address,
            phone: dto.phone,
            email: dto.email,
            website: dto.website ?? null,
            generalManagerName: dto.generalManagerName,
            complianceOfficerName: dto.complianceOfficerName,
            complianceOfficerEmail: dto.complianceOfficerEmail,
            complianceOfficerPhone: dto.complianceOfficerPhone ?? null,
            bankGuaranteeNo: dto.bankGuaranteeNo ?? null,
            bankGuaranteeBankId: dto.bankGuaranteeBankId ?? null,
            bankGuaranteeAmount: dto.bankGuaranteeAmount
              ? toMoney(dto.bankGuaranteeAmount)
              : null,
            bankGuaranteeExpiry: dto.bankGuaranteeExpiry
              ? parseCalendarDate(
                  dto.bankGuaranteeExpiry,
                  'bankGuaranteeExpiry',
                )
              : null,
            bankId: dto.bankId,
            ibanEnc,
            currencyId: dto.currencyId,
            paidUpCapital:
              dto.paidUpCapital === undefined
                ? null
                : toMoney(dto.paidUpCapital),
            createdByUserId: actor.id,
            updatedByUserId: actor.id,
          },
          select: { id: true, legalName: true, legalNameAr: true, code: true },
        });

        /*
         * THE CERTIFICATE IS A `Document`, and `BrokerLicense.certificateDocumentId` is NOT NULL —
         * so a term with no certificate is unrepresentable rather than merely disallowed. That is
         * refusal 3 of 4, and it is enforced at three depths: the DTO refuses a caller who omits the
         * fields, this write cannot complete without the row, and the column refuses any other
         * writer forever.
         */
        const certificate = await tx.document.create({
          data: {
            fileName: dto.certificateFileName,
            storageRef: dto.certificateStorageRef,
            category: 'BROKER_LICENSE_CERTIFICATE',
            classification: 'CONFIDENTIAL',
            uploadedByUserId: actor.id,
          },
          select: { id: true },
        });

        const license = await tx.brokerLicense.create({
          data: {
            licenseNumber: dto.licenseNumber,
            issuedAt: licenseIssuedAt,
            expiresAt: licenseExpiresAt,
            status: 'active',
            certificateDocumentId: certificate.id,
            renewalRequestedAt: dto.renewalRequestedAt
              ? parseCalendarDate(dto.renewalRequestedAt, 'renewalRequestedAt')
              : null,
          },
          select: { id: true },
        });

        await tx.brokerLicenseScopeLine.createMany({
          data: dto.licensedLineIds.map((insuranceLineId) => ({
            brokerLicenseId: license.id,
            insuranceLineId,
          })),
        });

        await tx.professionalIndemnityPolicy.create({
          data: {
            policyNumber: dto.piPolicyNumber,
            insurerName: dto.piInsurerName,
            coverageLimit: toMoney(dto.piCoverageLimit),
            expiresAt: parseCalendarDate(dto.piExpiresAt, 'piExpiresAt'),
          },
        });

        /*
         * DECISION 88 — THE TWO ART. 10/a DOCUMENTS, EACH WRITTEN ONLY IF GIVEN.
         *
         * Written AFTER the organization, because `Document.organizationId` references it — the same
         * ordering the insurer registration had to learn the hard way, where the pointer sits on the
         * parent and the first draft produced a 500 on every call.
         *
         * A pair that is half-supplied is treated as ABSENT rather than refused: the DTO already
         * refuses a malformed value, and refusing a half-filled optional upload would make an
         * optional document behave like a required one on the path where somebody started typing and
         * stopped. The marker then names it, which is what the marker is for.
         */
        const registrationPack = await this.fileRegistrationPackDocuments(
          tx,
          actor.id,
          dto,
        );
        if (
          registrationPack.premisesTenureDocumentId !== null ||
          registrationPack.associationMembershipDocumentId !== null
        ) {
          await tx.organization.update({
            where: { id: organizationId },
            data: registrationPack,
          });
        }

        const roleId = await this.createAdministratorRole(tx);

        return {
          organization,
          registrationPack: deriveRegistrationPackState(registrationPack),
          licenseId: license.id,
          administratorRoleId: roleId.id,
          administratorGrantCount: roleId.grantCount,
          capital,
          licensedTypes: typesInScope(branches),
          /*
           * ART. 10/b, SURFACED AND NEVER ENFORCED. A term ends 31 December, and the year of issue
           * counts as a whole year — so an entered expiry that disagrees is worth saying out loud
           * and is not worth refusing: the date is entered as printed on the certificate, and the
           * certificate is the authority.
           */
          expiryIsEndOfCalendarYear:
            expiryIsEndOfCalendarYear(licenseExpiresAt),
          expiryMatchesThreeYearTerm: expiryMatchesThreeYearTerm({
            issuedAt: licenseIssuedAt,
            expiresAt: licenseExpiresAt,
          }),
        };
      }),
    );

    await this.audit.record({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'Organization',
      entityId: organizationId,
      /*
       * WHAT THE ACT WAS, NOT WHAT WAS TYPED. `AuditLogEntry` is append-only by database trigger, so
       * a personal detail quoted here is one no erasure request can ever remove — and this payload
       * had four personal fields available to it (the general manager, the compliance officer's name,
       * email and phone). None is recorded. The legal name of a company is not personal data; the
       * name of its compliance officer is.
       */
      afterValue: {
        organizationType: 'BROKERAGE_OFFICE',
        code: dto.code,
        legalName: dto.legalName,
        brokerKind: dto.brokerKind,
        brokerageKind: dto.brokerageKind,
        licensedLineCount: dto.licensedLineIds.length,
        licensedTypes: result.licensedTypes,
        administratorGrantCount: result.administratorGrantCount,
        capitalMeetsRequirement: result.capital.meetsRequirement,
        capitalIsUnrecorded: result.capital.capitalIsUnrecorded,
      },
    });

    return {
      id: result.organization.id,
      code: result.organization.code,
      legalName: result.organization.legalName,
      legalNameAr: result.organization.legalNameAr,
      administratorRoleId: result.administratorRoleId,
      administratorGrantCount: result.administratorGrantCount,
      /** DECISION 88 — DERIVED, never stored, and it NAMES what is missing rather than counting it.
       *  The screen's wording states what this system holds and never a finding about the office. */
      registrationPack: result.registrationPack,
      licensedTypes: result.licensedTypes,
      /** Art. 4/a, as INFORMATION. `meetsRequirement: false` with `capitalIsUnrecorded: true` means
       *  nobody typed a figure — a different fact from a figure that is short, and the screen renders
       *  them differently. */
      capital: {
        requiredCapital: result.capital.requiredCapital.toFixed(3),
        paidUpCapital: result.capital.paidUpCapital?.toFixed(3) ?? null,
        shortfall: result.capital.shortfall?.toFixed(3) ?? null,
        meetsRequirement: result.capital.meetsRequirement,
        capitalIsUnrecorded: result.capital.capitalIsUnrecorded,
      },
      expiryIsEndOfCalendarYear: result.expiryIsEndOfCalendarYear,
      expiryMatchesThreeYearTerm: result.expiryMatchesThreeYearTerm,
    };
  }

  /**
   * DECISION 88 — files whichever of the two art. 10/a documents the caller supplied.
   *
   * Each is independent: one may be given and the other not, and that is the ordinary state of an
   * office whose paperwork arrives in two envelopes. A document is written only when BOTH of its
   * fields are present, because a file name with no location — or the reverse — is half a record,
   * and half a record would make the marker report a document we cannot actually produce.
   */
  private async fileRegistrationPackDocuments(
    tx: TenantTransactionClient,
    actorUserId: string,
    dto: RegisterBrokerageOfficeDto,
  ): Promise<{
    premisesTenureDocumentId: string | null;
    associationMembershipDocumentId: string | null;
  }> {
    const file = async (
      fileName: string | undefined,
      storageRef: string | undefined,
      /*
       * NO `which` ARGUMENT, and it was removed rather than silenced. The first version took one, to
       * label which art. 10/a document this is — and `Document` has no description column, so nothing
       * could read it. `no-unused-vars` refused it, correctly: a parameter passed at both call sites
       * and read at neither looks like it distinguishes two things, and the distinction is carried
       * elsewhere entirely. The POINTER on `Organization` is what identifies which document this is,
       * and it identifies it exactly; the call sites below name it in the clearest form there is.
       */
    ): Promise<string | null> => {
      if (fileName === undefined || storageRef === undefined) return null;
      const document = await tx.document.create({
        data: {
          fileName,
          storageRef,
          // OTHER, deliberately, and this is the one place in this module where it is right. A new
          // `DocumentCategory` value needs its own migration (`ALTER TYPE ... ADD VALUE` cannot be
          // used in the transaction that adds it) and would be a decision about how an inspection
          // query partitions documents — which decision 88 did not take. The POINTER on
          // `Organization` is what identifies these two, and it identifies them exactly, which a
          // category never could: a category says "this is a lease", the pointer says "this is THIS
          // OFFICE'S art. 10/a/2 document".
          category: 'OTHER',
          classification: 'CONFIDENTIAL',
          uploadedByUserId: actorUserId,
        },
        select: { id: true },
      });
      return document.id;
    };

    return {
      premisesTenureDocumentId: await file(
        dto.premisesTenureFileName,
        dto.premisesTenureStorageRef,
      ),
      associationMembershipDocumentId: await file(
        dto.associationMembershipFileName,
        dto.associationMembershipStorageRef,
      ),
    };
  }

  /**
   * THE FIRST ROLE, WITH A GRANT SET COMPUTED FROM THE CATALOGUE AND COPIED FROM NO OFFICE.
   *
   * The owner's instruction, and the defect it avoids is measured rather than theoretical: `seed.ts`
   * grants to the DEFAULT office's roles only, so every code added after an office was created never
   * reached that office — the demo office's administrator was four grants behind, across 25 missing
   * grants in eight roles. Replaying an existing office's `RolePermission` rows into a new one
   * inherits whatever that office drifted to, silently and forever.
   *
   * So the codes are DECLARED (`office-administrator-grants.ts`) and RESOLVED here against the
   * `Permission` table. A declared code the catalogue does not contain fails the registration by
   * name — the alternative being a short grant set nobody notices until an administrator needs the
   * missing capability, which is weeks later and in another conversation.
   */
  private async createAdministratorRole(tx: TenantTransactionClient) {
    const permissions = await tx.permission.findMany({
      where: { code: { in: [...OFFICE_ADMINISTRATOR_GRANTS] } },
      select: { id: true, code: true },
    });

    if (permissions.length !== OFFICE_ADMINISTRATOR_GRANTS.length) {
      const found = new Set(permissions.map((p) => p.code));
      const missing = OFFICE_ADMINISTRATOR_GRANTS.filter((c) => !found.has(c));
      throw new UnprocessableEntityException(
        `the office administrator's grant set names ${missing.length} permission(s) the catalogue does not contain: ${missing.join(', ')}. The office is NOT registered — an administrator short of a capability is a defect nobody finds until somebody needs it.`,
      );
    }

    const role = await tx.role.create({
      data: {
        name: OFFICE_ADMINISTRATOR_ROLE_NAME,
        nameEn: 'Office administrator',
        nameAr: 'مدير المكتب',
        description:
          "Administers this office: its users, roles, departments, branches, people, security configuration and the registers it maintains. Holds no capability to place business, settle a claim or move money. Created with the office; its grants come from the permission catalogue, not from another office's copy.",
        isSystem: true,
        // The strict values, which are the defaults — stated rather than inherited, because this is
        // the one role every office starts with and a future change to a default must not silently
        // relax the first administrator of every office registered afterwards.
        requiresMfaAlways: true,
        requiresHardwareToken: true,
      },
      select: { id: true },
    });

    await tx.rolePermission.createMany({
      data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
    });

    return { id: role.id, grantCount: permissions.length };
  }

  /**
   * ITEM (j)'s THIRD LAYER, applied to a route that creates a tenant.
   *
   * The permission is PLATFORM-scoped, so the office matrix never offers it and `setPermissions`
   * refuses it for a non-provider organization. This is the third: the route itself checks the
   * caller's organization TYPE, because a hidden control the API still honours is not a boundary.
   *
   * The refusal NAMES WHY. An empty response or a bare 403 would read as a permission problem and
   * send somebody asking for a grant that cannot help them.
   */
  private async assertCallerIsTheProvider(organizationId: string) {
    const org = await this.prisma.client.organization.findUnique({
      where: { id: organizationId },
      select: { type: true },
    });
    if (org?.type !== 'PROVIDER') {
      throw new ForbiddenException(
        'registering an organization on this platform is reserved to the platform operator. This capability is not something an office can be granted: it creates a separate tenant, which is an effect no brokerage office may have on another.',
      );
    }
  }
}
