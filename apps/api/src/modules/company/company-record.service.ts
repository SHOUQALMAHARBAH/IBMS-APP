import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * MODULE 0-ب ITEM (f), COMPANY HALF — what an insurance company can see of itself.
 *
 * ## READ-ONLY, AND THE SCOPE IS A DECISION WITH FOUR DELIBERATE ABSENCES
 *
 * It shows the company its own registry record: identity, the lines it is licensed for, its licence
 * certificate, and what state that record is in. It shows NONE of the following, each for its own
 * reason rather than because it was not got to:
 *
 *   NO RATING. There is no company-level rating to show — measured: `Organization` carries no column
 *   matching `%rating%` at all. The only rating in this database is `Insurer.financialStrengthRating`,
 *   which is an OFFICE's own assessment of a counterparty on an office-owned row. Showing it would
 *   disclose one office's private judgement of this company to the company itself, and a company
 *   deals with many offices.
 *
 *   NO LINKED OFFICES. Same reason one level up: which offices chose to work with this company is
 *   each office's own commercial fact. `Insurer.insuranceCompanyId` is on an office-owned row.
 *
 *   NO CUSTOMER, MONEY OR POLICY DATA. None of it belongs to the company, and none of it is reachable
 *   from here: every one of those models carries `organizationId`, so `tenantScopeExtension` filters
 *   them to the caller's own organization — which for a company holds none of them.
 *
 *   NO OTHER ORGANIZATION'S RECORD. The id is never taken from the request. It is read from the
 *   authenticated caller, so "my own record" is the only question this route can be asked.
 *
 * ## GATED ON ORGANIZATION TYPE, NOT ON A PERMISSION, AND THAT IS DELIBERATE
 *
 * The question is "is the caller this company", which is identity rather than capability. A code
 * would be a checkbox an administrator could uncheck to blind their own company to its own registry
 * record, and nobody administers that separately — this module has refused to declare three codes on
 * exactly that ground. It is also not expressible as the grid stands: an OFFICE-scoped code must name
 * at least one role, `INSURANCE_COMPANY_ADMINISTRATOR` cannot enter that grid, and a PLATFORM code may
 * be held only by the provider. See `insurance-company-administrator-grants.ts`.
 *
 * ## THE TENANCY OF EVERY COLUMN IT TOUCHES, as standing rule 5 requires
 *
 *   `Organization`          GENERAL FACT — carries no `organizationId`. Read by the caller's own id.
 *   `InsurerLicensedLine`  GENERAL FACT — carries no `organizationId`; keyed by `insuranceCompanyId`,
 *                          deliberately, because what a company is licensed for is readable by every
 *                          office rather than filtered to the company.
 *   `InsuranceLine`        GENERAL FACT — the shared catalogue.
 *   `Document`             TENANT-OWNED — and the tenant is THIS COMPANY, because registration runs
 *                          under `runAs(organizationId)`, so the certificate was stamped with the
 *                          company's id and not the provider's. Measured, not assumed: without that
 *                          the company could not read its own certificate.
 */
@Injectable()
export class CompanyRecordService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async ownRecord(actor: { id: string; organizationId: string }) {
    /*
     * `Organization` carries no `organizationId`, so this read is NOT tenant-filtered and the id has
     * to come from the caller rather than from the request. That is also what makes the route safe:
     * there is no parameter to tamper with.
     */
    const company = await this.prisma.client.organization.findUnique({
      where: { id: actor.organizationId },
      select: {
        id: true,
        type: true,
        legalName: true,
        legalNameAr: true,
        shortName: true,
        code: true,
        nationalEstablishmentNo: true,
        commercialRegistrationNo: true,
        taxNumber: true,
        insurerLicenseNumber: true,
        address: true,
        phone: true,
        email: true,
        website: true,
        quotationEmail: true,
        claimsEmail: true,
        integrationMethod: true,
        insurerLicenseCertificateDocumentId: true,
        legalForm: { select: { code: true, nameEn: true, nameAr: true } },
        licensingAuthority: {
          select: { code: true, nameEn: true, nameAr: true },
        },
        businessModel: { select: { code: true, nameEn: true, nameAr: true } },
        country: { select: { code: true, nameEn: true, nameAr: true } },
        city: { select: { code: true, nameEn: true, nameAr: true } },
        createdAt: true,
      },
    });

    if (!company) {
      throw new NotFoundException(
        'Your organization no longer exists. Nothing can be shown for it.',
      );
    }

    /*
     * THE TYPE CHECK IS THE AUTHORIZATION, and it refuses with a sentence naming why rather than an
     * empty body — the same rule item (j)'s provider route follows, because an empty response reads
     * as "there is nothing here" when the truth is "this screen is not for you".
     */
    if (company.type !== 'INSURANCE_COMPANY') {
      throw new ForbiddenException(
        `This screen shows an insurance company its own registry record, and your organization is a ${company.type}. ` +
          'A brokerage office sees its own licence and scope at /regulatory-compliance; the platform provider sees every office at /provider/offices.',
      );
    }

    const licensedLines = await this.prisma.client.insurerLicensedLine.findMany(
      {
        where: { insuranceCompanyId: company.id },
        select: {
          insuranceLine: {
            select: { code: true, nameEn: true, nameAr: true, category: true },
          },
        },
      },
    );

    const certificate = company.insurerLicenseCertificateDocumentId
      ? await this.prisma.client.document.findUnique({
          where: { id: company.insurerLicenseCertificateDocumentId },
          select: { id: true, fileName: true, createdAt: true },
        })
      : null;

    /*
     * READING IS AUDITED, AND THE ROW CARRIES NO CONTENT. Who looked at the company's own record is
     * worth recording; copying the record into the log would duplicate the same facts into an
     * append-only table that can never be corrected. Counts only, the `ProviderOfficeState` rule.
     */
    await this.audit.record({
      userId: actor.id,
      action: 'READ',
      entityType: 'Organization',
      entityId: company.id,
      afterValue: {
        surface: 'company-own-registry-record',
        licensedLineCount: licensedLines.length,
        certificateOnRecord: certificate !== null,
      },
    });

    return {
      identity: {
        id: company.id,
        legalName: company.legalName,
        legalNameAr: company.legalNameAr,
        shortName: company.shortName,
        code: company.code,
        nationalEstablishmentNo: company.nationalEstablishmentNo,
        commercialRegistrationNo: company.commercialRegistrationNo,
        taxNumber: company.taxNumber,
        insurerLicenseNumber: company.insurerLicenseNumber,
        legalForm: company.legalForm,
        licensingAuthority: company.licensingAuthority,
        businessModel: company.businessModel,
        country: company.country,
        city: company.city,
        address: company.address,
        phone: company.phone,
        email: company.email,
        website: company.website,
        quotationEmail: company.quotationEmail,
        claimsEmail: company.claimsEmail,
        integrationMethod: company.integrationMethod,
        registeredAt: company.createdAt.toISOString(),
      },
      licensedLines: licensedLines
        .map((l) => l.insuranceLine)
        .sort((a, b) => a.code.localeCompare(b.code)),
      /** DERIVED from the lines' categories, never stored — decision 67, the same rule that governs
       *  a broker's licence types. */
      licensedCategories: [
        ...new Set(licensedLines.map((l) => l.insuranceLine.category)),
      ].sort(),
      certificate: certificate
        ? {
            id: certificate.id,
            fileName: certificate.fileName,
            recordedAt: certificate.createdAt.toISOString(),
          }
        : null,
      /*
       * RECORD STATE SAYS WHAT WE HOLD AND MAKES NO FINDING ABOUT THE COMPANY — decision 88's rule
       * four, which was written for the office registration pack and applies here unchanged. A
       * company licensed by the Central Bank already filed these with the regulator; our not holding
       * a copy is OUR gap, not its breach. And `certificateOnRecord` means the file is RECORDED —
       * name, location and who filed it — never that the bytes can be fetched, because this product
       * has no object storage anywhere.
       */
      recordState: {
        certificateOnRecord: certificate !== null,
        licensedLineCount: licensedLines.length,
      },
    };
  }
}
