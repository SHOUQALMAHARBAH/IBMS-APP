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
import type { RegisterInsuranceCompanyDto } from './dto/register-insurance-company.dto';

/**
 * MODULE 0-ب ITEM (e) — REGISTERING AN INSURANCE COMPANY.
 *
 * ## IT IS THE SAME SHAPE AS THE BROKERAGE OFFICE AND A DIFFERENT ENTITY
 *
 * One transaction, every validation inside it, and the organization written before anything that
 * references it. What differs is what an insurance company IS: it holds no broker licence, no licence
 * TERM series, no `brokerKind`, and no office administrator — item (f) invites its first
 * administrator, and `INSURANCE_COMPANY_ADMINISTRATOR` is built there by SELECTING from the
 * catalogue rather than by copying the office role.
 *
 * ## DECISION 90 — NO DATABASE CONSTRAINT IS EVER THE ERROR MESSAGE
 *
 * Every constraint reachable from this screen has a form-level equivalent here, and the ones that are
 * satisfied BY CONSTRUCTION are named rather than left for a reader to wonder about:
 *
 *   * `Organization_nationalEstablishmentNo_key`, `_code_key`, `_subdomain_key` — read first, each
 *     turned into a sentence naming the field and what to do. The unique index stays the backstop for
 *     the race a read cannot close.
 *   * `Organization_insurer_certificate_only_on_a_company` — satisfied by construction: this route
 *     writes `type: 'INSURANCE_COMPANY'` and nothing else can reach it.
 *   * `Organization_broker_kind_matches_type` — likewise. `brokerKind` is never set here, which is
 *     exactly what that CHECK requires of an insurance company.
 *   * `InsurerLicensedLine_one_line_per_company` — the DTO's `@ArrayUnique()` refuses the duplicate
 *     before it reaches the index.
 *
 * ## WHAT THIS ROUTE DOES NOT TOUCH — the resolver's delivery evidence
 *
 * No existing row. Decision 63 is a RESOLVER and not a move: registering a company does not reach any
 * office's `Insurer` record, does not link anything, and does not rewrite a single company fact an
 * office has typed. An office links its own record when it chooses to, through its own permission,
 * and that act is logged.
 */
@Injectable()
export class InsuranceCompanyRegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgContext: OrgContextService,
    private readonly audit: AuditService,
    private readonly encryption: EncryptionService,
  ) {}

  async registerInsuranceCompany(
    actor: { id: string; organizationId: string },
    dto: RegisterInsuranceCompanyDto,
  ) {
    await this.assertCallerIsTheProvider(actor.organizationId);

    /*
     * DECISION 90 — THE CONDITIONAL FIELD, DECIDED WHERE IT ALWAYS RUNS.
     *
     * The sheet marks `api_endpoint` «إلزامي شرطي», conditional on the integration method. A DTO
     * cannot express it: `@IsOptional()` skips every validator on a property when the value is
     * ABSENT, which is precisely the case the rule exists for — item (e)'s own lesson, paid for once
     * already.
     *
     * Both directions, because an endpoint recorded against a PORTAL or EMAIL integration is a value
     * nothing reads, and a value nothing reads is a value somebody eventually reads.
     */
    if (dto.integrationMethod === 'API' && dto.apiEndpoint === undefined) {
      throw new UnprocessableEntityException(
        'An API integration needs its endpoint. Enter the endpoint, or choose a different integration method.',
      );
    }
    if (dto.integrationMethod !== 'API' && dto.apiEndpoint !== undefined) {
      throw new UnprocessableEntityException(
        `An API endpoint was given with a ${dto.integrationMethod} integration, which does not use one. Clear the endpoint, or choose API.`,
      );
    }

    const organizationId = randomUUID();

    // Outside the transaction, for the reason the brokerage registration records: `encrypt` writes a
    // key-use audit row of its own, and a refused registration must not roll back the record of a key
    // use that happened.
    const ibanEnc = await this.encryption.encrypt('pii', dto.iban, {
      userId: actor.id,
      entityType: 'Organization',
      entityId: organizationId,
      field: 'ibanEnc',
    });

    const result = await this.orgContext.runAs(organizationId, () =>
      this.prisma.client.$transaction(async (tx) => {
        await this.assertIdentifiersAreFree(tx, dto);

        const lines = await tx.insuranceLine.findMany({
          where: { id: { in: dto.licensedLineIds } },
          select: { id: true, category: true },
        });
        if (lines.length !== dto.licensedLineIds.length) {
          const found = new Set(lines.map((l) => l.id));
          const missing = dto.licensedLineIds.filter((id) => !found.has(id));
          throw new UnprocessableEntityException(
            `${missing.length} of the licensed lines do not exist in the standard catalogue: ${missing.join(', ')}. A company's licensed lines are chosen from the 32 standard lines.`,
          );
        }

        /*
         * THE ORGANIZATION FIRST, THEN THE CERTIFICATE, THEN THE POINTER — and the order is forced by
         * a CIRCLE the first version walked straight into.
         *
         * `Organization.insurerLicenseCertificateDocumentId` references `Document`, so the document
         * must exist first. But `Document.organizationId` references `Organization`, and `Document` is
         * tenant-scoped — so writing it under `runAs(organizationId)` before the organization exists
         * fails the foreign key. That was a 500 on every registration, caught by the e2e rather than
         * by reading.
         *
         * The brokerage registration does not meet this, because its certificate hangs off
         * `BrokerLicense` — a CHILD of the organization — so the natural order already works there.
         * Here the pointer is on the organization itself, and three statements inside one transaction
         * is the honest resolution. The intermediate state is valid:
         * `Organization_insurer_certificate_only_on_a_company` permits NULL, because a company may
         * genuinely have no certificate on record.
         */
        const organization = await tx.organization.create({
          data: {
            id: organizationId,
            type: 'INSURANCE_COMPANY',
            // `brokerKind` is DELIBERATELY ABSENT. `Organization_broker_kind_matches_type` requires it
            // to be NULL for an insurance company, and a broker kind on an insurer is a value nothing
            // reads — which item (b) established is a value somebody eventually reads.
            legalName: dto.legalName,
            legalNameAr: dto.legalNameAr,
            shortName: dto.shortName,
            code: dto.code,
            subdomain: dto.subdomain,
            nationalEstablishmentNo: dto.nationalEstablishmentNo,
            commercialRegistrationNo: dto.commercialRegistrationNo,
            taxNumber: dto.taxNumber,
            legalFormId: dto.legalFormId,
            insurerLicenseNumber: dto.insurerLicenseNumber,
            licensingAuthorityId: dto.licensingAuthorityId,
            businessModelId: dto.businessModelId,
            countryId: dto.countryId,
            cityId: dto.cityId,
            address: dto.address,
            phone: dto.phone,
            email: dto.email,
            website: dto.website ?? null,
            quotationEmail: dto.quotationEmail,
            claimsEmail: dto.claimsEmail,
            integrationMethod: dto.integrationMethod,
            apiEndpoint: dto.apiEndpoint ?? null,
            bankId: dto.bankId,
            ibanEnc,
            createdByUserId: actor.id,
            updatedByUserId: actor.id,
          },
          select: {
            id: true,
            legalName: true,
            legalNameAr: true,
            shortName: true,
            code: true,
          },
        });

        const certificate = await tx.document.create({
          data: {
            fileName: dto.certificateFileName,
            storageRef: dto.certificateStorageRef,
            category: 'INSURER_LICENSE_CERTIFICATE',
            classification: 'CONFIDENTIAL',
            uploadedByUserId: actor.id,
          },
          select: { id: true },
        });

        await tx.organization.update({
          where: { id: organizationId },
          data: { insurerLicenseCertificateDocumentId: certificate.id },
        });

        /*
         * THE LICENSED LINES ARE WRITTEN WITH AN EXPLICIT `insuranceCompanyId`, because that table is
         * NOT tenant-scoped: it carries no `organizationId`, so `tenantScopeExtension` stamps nothing
         * and the value has to be supplied. That is the whole point of the earlier correction — a
         * regulatory fact about a company is readable by every office, not filtered to the company
         * itself.
         */
        await tx.insurerLicensedLine.createMany({
          data: dto.licensedLineIds.map((insuranceLineId) => ({
            insuranceCompanyId: organizationId,
            insuranceLineId,
          })),
        });

        return {
          organization,
          certificateDocumentId: certificate.id,
          licensedLineCount: lines.length,
          /** DERIVED from the branch categories, never stored — decision 67, the same rule that
           *  governs a broker's licence types. */
          licensedCategories: [...new Set(lines.map((l) => l.category))].sort(),
        };
      }),
    );

    await this.audit.record({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'Organization',
      entityId: organizationId,
      afterValue: {
        organizationType: 'INSURANCE_COMPANY',
        code: dto.code,
        legalName: dto.legalName,
        businessModelId: dto.businessModelId,
        integrationMethod: dto.integrationMethod,
        licensedLineCount: result.licensedLineCount,
        licensedCategories: result.licensedCategories,
      },
    });

    return {
      id: result.organization.id,
      code: result.organization.code,
      legalName: result.organization.legalName,
      legalNameAr: result.organization.legalNameAr,
      shortName: result.organization.shortName,
      certificateDocumentId: result.certificateDocumentId,
      licensedLineCount: result.licensedLineCount,
      licensedCategories: result.licensedCategories,
    };
  }

  /**
   * DECISION 90 — the three platform-wide uniques, turned into sentences BEFORE the write.
   *
   * The indexes stay the backstop for the race a read cannot close; these exist so a person meets a
   * sentence naming the field rather than a 500 carrying a constraint name.
   */
  private async assertIdentifiersAreFree(
    tx: TenantTransactionClient,
    dto: RegisterInsuranceCompanyDto,
  ): Promise<void> {
    const establishment = await tx.organization.findUnique({
      where: { nationalEstablishmentNo: dto.nationalEstablishmentNo },
      select: { legalName: true },
    });
    if (establishment) {
      throw new ConflictException(
        `national establishment number ${dto.nationalEstablishmentNo} is already registered to "${establishment.legalName}". One establishment is one organization on this platform, whether it is a brokerage office or an insurance company — if this is the same business, correct that record rather than registering it again.`,
      );
    }

    const code = await tx.organization.findUnique({
      where: { code: dto.code },
      select: { id: true },
    });
    if (code) {
      throw new ConflictException(
        `code ${dto.code} is already in use. Office and insurer codes share one namespace on this platform, so a code is unique across both.`,
      );
    }

    const subdomain = await tx.organization.findUnique({
      where: { subdomain: dto.subdomain },
      select: { id: true },
    });
    if (subdomain) {
      throw new ConflictException(
        `subdomain ${dto.subdomain} is already in use.`,
      );
    }
  }

  /** Item (j)'s third layer, on the route that creates the other kind of tenant. */
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
