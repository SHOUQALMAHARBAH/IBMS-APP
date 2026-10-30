import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * MODULE 0-ب ITEM (e), DECISION 63 — LINKING AN OFFICE'S INSURER RECORD TO A REGISTERED COMPANY.
 *
 * ## WHAT THE ACT IS, AND WHY IT IS NOT AN EDIT
 *
 * It does not change a value. It changes WHICH SOURCE ANSWERS for the company's name and published
 * contact details — see `resolveInsurerCompanyFacts`, which owns that precedence — and it makes this
 * office's own copies of those fields read-only.
 *
 * So it has its own permission rather than riding on `insurer.update`. An officer who may correct a
 * phone number has not thereby been given the authority to decide that the record in front of them
 * IS a particular licensed company; getting that wrong points this office's quotations, policies and
 * remittances at the wrong entity's published details.
 *
 * ## WHAT IT WRITES, AND WHAT IT CANNOT
 *
 * One column on the OFFICE'S OWN `Insurer` row. Nothing on the company's record — tenant scoping
 * would not permit it, and nothing is built that needs it. An office's link is its own assertion
 * about its own record; another office linking the same company is a separate, equally valid act,
 * which is why there is no unique constraint on the column.
 *
 * ## THE TWO REFUSALS, AND WHY NEITHER IS A DATABASE CONSTRAINT
 *
 * The target must be an `INSURANCE_COMPANY`, and it must not already be linked to something else.
 * Neither is expressible as a CHECK: the first compares a column of THIS row against a column of
 * ANOTHER table, and a CHECK sees one row of one table. So both live here, and the migration that
 * added the column records that as service-grain rather than leaving a reader to assume a database
 * guarantee.
 */
@Injectable()
export class InsurerCompanyLinkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async link(
    actorUserId: string,
    insurerId: string,
    insuranceCompanyId: string,
  ) {
    const insurer = await this.prisma.client.insurer.findUnique({
      where: { id: insurerId },
      // The narrowest select that answers the question. `legalName` was in here and used by
      // nothing — a widened select is a boundary nobody reviewed.
      select: { id: true, insuranceCompanyId: true },
    });
    if (!insurer) {
      // 404 rather than 403: this office's scope has already filtered the read, so an id it cannot
      // see does not exist as far as it is concerned. Saying "forbidden" would confirm that another
      // office holds a record with that id.
      throw new NotFoundException(`No insurer record ${insurerId}.`);
    }
    if (insurer.insuranceCompanyId !== null) {
      throw new ConflictException(
        `This insurer record is already linked to a registered company. Unlink it first — relinking in one step would change which source answers for its details with nothing in the audit trail saying what it was linked to before.`,
      );
    }

    /*
     * THE TARGET IS AN ORGANIZATION, AND THIS READ CROSSES A TENANT BOUNDARY BY NATURE — which is
     * safe here and worth saying why. `Organization` carries no `organizationId` (it IS the tenant),
     * so it is not in the scoped set and this read needs no bypass. What is selected is the narrowest
     * thing that answers the question: the id and the type. No name, no contact details, nothing that
     * would let this route be used to read a company the office has not linked.
     */
    const company = await this.prisma.client.organization.findUnique({
      where: { id: insuranceCompanyId },
      select: { id: true, type: true },
    });
    if (!company || company.type !== 'INSURANCE_COMPANY') {
      throw new UnprocessableEntityException(
        `${insuranceCompanyId} is not an insurance company registered on this platform. Only a registered insurance company can answer for its own published details.`,
      );
    }

    await this.prisma.client.insurer.update({
      where: { id: insurerId },
      data: { insuranceCompanyId },
    });

    await this.audit.record({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'Insurer',
      entityId: insurerId,
      /*
       * WHAT CHANGED, NOT WHAT THE COMPANY'S DETAILS ARE. `AuditLogEntry` is append-only by database
       * trigger, so a value quoted here is one no erasure request can ever remove — and the company's
       * published phone and email are another organization's data. The row records the link and the
       * consequence; the consequence is the half somebody reading this later needs.
       */
      afterValue: {
        linkedToInsuranceCompanyId: insuranceCompanyId,
        companyFactsNowAnsweredBy: 'REGISTERED_COMPANY',
        officeLocalCompanyFieldsBecameReadOnly: true,
      },
    });

    return { insurerId, insuranceCompanyId };
  }

  async unlink(actorUserId: string, insurerId: string) {
    const insurer = await this.prisma.client.insurer.findUnique({
      where: { id: insurerId },
      select: { id: true, insuranceCompanyId: true },
    });
    if (!insurer) {
      throw new NotFoundException(`No insurer record ${insurerId}.`);
    }
    if (insurer.insuranceCompanyId === null) {
      // Not an error worth a 409 on its own terms, but saying so beats a silent 200: "unlinked" and
      // "was never linked" are different facts, and a caller that cannot tell them apart will not
      // notice it unlinked the wrong record.
      throw new ConflictException(
        'This insurer record is not linked to a registered company.',
      );
    }

    await this.prisma.client.insurer.update({
      where: { id: insurerId },
      data: { insuranceCompanyId: null },
    });

    await this.audit.record({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'Insurer',
      entityId: insurerId,
      /*
       * THE PREVIOUS LINK IS RECORDED, and it is the whole value of this row. After the write the
       * column is NULL, so without this the trail could say an unlink happened and not what it
       * undid — and unlinking is the direction that can quietly make a screen show a stale office
       * note where a published fact used to be.
       */
      beforeValue: { linkedToInsuranceCompanyId: insurer.insuranceCompanyId },
      afterValue: {
        linkedToInsuranceCompanyId: null,
        companyFactsNowAnsweredBy: 'OFFICE_LOCAL',
        officeLocalCompanyFieldsBecameEditable: true,
      },
    });

    return { insurerId, insuranceCompanyId: null };
  }
}
