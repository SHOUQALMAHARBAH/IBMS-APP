import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  Prisma,
  type Customer,
  type Document,
  type UltimateBeneficialOwner,
} from '@ibms/db';
import {
  CustomerRepository,
  type CustomerFilter,
} from '../../repositories/customer.repository';
import { ProspectRepository } from '../../repositories/prospect.repository';

import { AuditService } from '../audit/audit.service';
import { EncryptionService } from '../security/encryption.service';
import { SensitiveFieldRevealService } from '../security/sensitive-field-reveal.service';
import {
  encryptEntityFields,
  decryptEntityFields,
} from '../security/encrypted-fields';
import {
  canReadAllCustomerOwners,
  isCustomerVisibleTo,
} from '../../common/rbac-visibility.util';
import { composeFullName } from '../../common/person-name.util';
import { pageWindow, type Paginated } from '../../common/pagination';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CreateCustomerDto } from './dto/create-customer.dto';
import type { ListCustomersQueryDto } from './dto/list-customers-query.dto';
import type { CreateUboDto } from './dto/create-ubo.dto';
import type { CreateCustomerDocumentDto } from './dto/create-customer-document.dto';
import type { RevealFieldDto } from './dto/reveal-field.dto';

/** Part 10.2 — revealing a national ID is a separate decision from being able to
 *  open the customer's file, and only this field is behind it. See
 *  `revealField` for why the customer split is per-field where the employee one
 *  is per-route. Exported for the unit-test fixture that derives an actor's
 *  permissions from their roles. */
export const CUSTOMER_NATIONAL_ID_REVEAL = 'customer.national-id.reveal';

/** Masked view of a Customer's own `-- ENCRYPT` fields for the profile
 * screen (Part 10.6 — masked-by-default, full reveal only via
 * SensitiveFieldRevealService.reveal()).
 *
 * `organizationId` is omitted alongside the encrypted columns, for a
 * different reason: it is multi-tenancy plumbing (spec §3.2), not customer
 * data. A user only ever reaches customers inside their own Organization, so
 * echoing the tenant id back tells the client nothing it does not already
 * know — and keeping it off the wire means this response shape is byte-for-
 * byte what it was before multi-tenancy, which is what Phase 1 requires. */
export interface MaskedCustomer extends Omit<
  Customer,
  'organizationId' | 'nationalIdEnc' | 'contactPhoneEnc' | 'contactEmailEnc'
> {
  nationalId: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
}

/** Process 3-4 (Customer Acquisition/Onboarding, Domain A). Every Customer
 * is owned by the Sales/Relationship Officer who created it, same ownership
 * shape as Lead/Prospect — `customer.360-view.read` additionally grants
 * Compliance/Auditor/Manager/Exec cross-owner visibility (they need to see
 * a customer to work its KYC file, not just their own pipeline). */
@Injectable()
export class CustomerService {
  constructor(
    private readonly customers: CustomerRepository,
    private readonly prospects: ProspectRepository,
    private readonly audit: AuditService,
    private readonly encryption: EncryptionService,
    private readonly reveal: SensitiveFieldRevealService,
  ) {}

  /** Decrypts and masks the three `-- ENCRYPT` fields for API responses —
   * the ONE place that builds a `MaskedCustomer`, called by both create()
   * and get() so a raw ciphertext value can never round-trip out of either
   * response by omission (see the code-review finding this fixed: create()
   * originally returned the bare Prisma `Customer` row, leaking
   * `nationalIdEnc` etc. verbatim — caught by customer.e2e-spec.ts).
   * EncryptionService.decrypt() itself logs an isSensitiveDataAccess audit
   * row per field, per call (Part 10.3). */
  private async toMasked(
    customer: Customer,
    actorUserId: string,
  ): Promise<MaskedCustomer> {
    const decrypted = await decryptEntityFields(
      this.encryption,
      'Customer',
      {
        nationalIdEnc: customer.nationalIdEnc,
        contactPhoneEnc: customer.contactPhoneEnc,
        contactEmailEnc: customer.contactEmailEnc,
      },
      { userId: actorUserId, entityType: 'Customer', entityId: customer.id },
    );

    // An explicit field allow-list, not a destructure-and-strip: the raw
    // `-- ENCRYPT` columns must never round-trip into the response even
    // accidentally, so what IS returned is spelled out rather than
    // inferred from what was removed.
    return {
      id: customer.id,
      prospectId: customer.prospectId,
      customerType: customer.customerType,
      legalName: customer.legalName,
      givenName: customer.givenName,
      fatherName: customer.fatherName,
      grandfatherName: customer.grandfatherName,
      familyName: customer.familyName,
      // Part B §11 — screening discriminators. Returned in the clear
      // deliberately (unlike the `-- ENCRYPT` columns above): they exist to be
      // compared against a sanctions/PEP list entry, and a reviewer working a
      // match needs to see them.
      dateOfBirth: customer.dateOfBirth,
      nationality: customer.nationality,
      registrationNumber: customer.registrationNumber,
      taxRegistrationNumber: customer.taxRegistrationNumber,
      registeredAddress: customer.registeredAddress,
      natureOfBusiness: customer.natureOfBusiness,
      languagePreference: customer.languagePreference,
      preferredContactChannel: customer.preferredContactChannel,
      status: customer.status,
      // Part III §7 — provenance travels with the record. A reader has to be
      // able to tell a LEGACY_IMPORT row from one that came through intake.
      source: customer.source,
      classification: customer.classification,
      ownerUserId: customer.ownerUserId,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
      nationalId: decrypted.nationalIdEnc
        ? this.reveal.mask(decrypted.nationalIdEnc)
        : null,
      contactPhone: decrypted.contactPhoneEnc
        ? this.reveal.mask(decrypted.contactPhoneEnc)
        : null,
      contactEmail: decrypted.contactEmailEnc
        ? this.reveal.mask(decrypted.contactEmailEnc)
        : null,
    };
  }

  async create(
    dto: CreateCustomerDto,
    actorUserId: string,
  ): Promise<MaskedCustomer> {
    if (dto.prospectId) {
      const prospect = await this.prospects.findById(dto.prospectId);
      // Same ownership-hiding NotFoundException pattern as
      // ProspectService.convert() for a Lead — a response here can't be
      // used as an existence oracle for another officer's prospect id.
      if (!prospect || prospect.salesOwnerUserId !== actorUserId) {
        throw new NotFoundException('Prospect not found');
      }
    }

    // Belt-and-braces with CreateCustomerDto's CustomerTypeFieldCoherence
    // validator: never let a field from the *other* form reach the row (or,
    // for nationalId, the encryption pass) even if a future DTO change or a
    // caller bypassing validation slips one through. `nationalId` is the
    // one that matters most — a corporate record must never carry an
    // encrypted personal ID.
    const isIndividual = dto.customerType === 'INDIVIDUAL';
    // Part F item #4 — an individual's legalName is computed from the 4
    // national-ID-convention parts, never accepted directly (see
    // CustomerTypeFieldCoherence); a corporate customer keeps sending its
    // registered legal name as-is.
    const legalName = isIndividual
      ? composeFullName({
          givenName: dto.givenName!,
          fatherName: dto.fatherName,
          grandfatherName: dto.grandfatherName,
          familyName: dto.familyName!,
        })
      : dto.legalName!;

    const id = randomUUID();
    const encrypted = await encryptEntityFields(
      this.encryption,
      'Customer',
      {
        nationalIdEnc: isIndividual ? dto.nationalId : undefined,
        contactPhoneEnc: dto.contactPhone,
        contactEmailEnc: dto.contactEmail,
      },
      { userId: actorUserId, entityType: 'Customer', entityId: id },
    );

    let customer: Customer;
    try {
      customer = await this.customers.create({
        id,
        prospectId: dto.prospectId,
        customerType: dto.customerType,
        legalName,
        givenName: isIndividual ? dto.givenName : undefined,
        fatherName: isIndividual ? dto.fatherName : undefined,
        grandfatherName: isIndividual ? dto.grandfatherName : undefined,
        familyName: isIndividual ? dto.familyName : undefined,
        registrationNumber: isIndividual ? undefined : dto.registrationNumber,
        // Part B §11 — screening discriminators. INDIVIDUAL only: a company
        // has no date of birth or nationality of its own; those belong to the
        // natural persons behind it, which is what the UBO records carry.
        dateOfBirth: isIndividual ? parseDateOnly(dto.dateOfBirth) : undefined,
        nationality: isIndividual ? dto.nationality : undefined,
        nationalIdEnc: encrypted.nationalIdEnc,
        taxRegistrationNumber: dto.taxRegistrationNumber,
        registeredAddress: isIndividual ? undefined : dto.registeredAddress,
        natureOfBusiness: isIndividual ? undefined : dto.natureOfBusiness,
        contactPhoneEnc: encrypted.contactPhoneEnc,
        contactEmailEnc: encrypted.contactEmailEnc,
        languagePreference: dto.languagePreference,
        preferredContactChannel: dto.preferredContactChannel,
        ownerUserId: actorUserId,
      });
    } catch (err) {
      // `Customer.prospectId @unique` — a concurrent (or retried) second
      // conversion of the same Prospect. The DB constraint is the real
      // invariant (race-safe-invariants.md); this only turns the resulting
      // P2002 into the 409 every comparable create in this codebase returns,
      // instead of an unhandled 500. Mirrors ProspectService.convert().
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `Prospect ${dto.prospectId} has already been converted to a Customer.`,
        );
      }
      throw err;
    }

    // Logged, not thrown — same "already-committed work must not become a
    // reported failure" philosophy as ProspectService.convert(). Never
    // includes the encrypted values themselves (sensitive-data-handling.md
    // — log identifiers, not content).
    try {
      await this.audit.record({
        userId: actorUserId,
        action: 'CREATE',
        entityType: 'Customer',
        entityId: customer.id,
        afterValue: {
          customerType: customer.customerType,
          legalName: customer.legalName,
          status: customer.status,
          prospectId: customer.prospectId,
        },
      });
    } catch {
      // best-effort — see comment above
    }

    return this.toMasked(customer, actorUserId);
  }

  /** A Sales Officer sees only their own book of customers regardless of
   * what `ownerUserId` they pass; Compliance/Manager/Exec/Auditor (the
   * `customer.360-view.read` roles) get the org-wide view — same pattern as
   * lead.service.ts's list(). Sensitive fields are never DECRYPTED for a
   * list endpoint — decrypting a field means logging a sensitive-data-access
   * row per field per row, which for a list of many Customers is exactly
   * the "bulk export"/routine-bulk-decrypt pattern Part 10.3's anomaly
   * detection watches for — but the raw ciphertext columns are still
   * stripped from every row before it leaves this method: a value nobody
   * decrypted is not a value that gets to round-trip into the response
   * either. Only the single-record profile (get()) decrypts-then-masks, and
   * only for that one record. */
  async list(
    query: ListCustomersQueryDto,
    actor: AuthenticatedUser,
  ): Promise<
    Paginated<
      Omit<
        Customer,
        // `organizationId` omitted for the same reason as on MaskedCustomer —
        // tenancy plumbing, not customer data, and keeping it out preserves
        // the pre-multi-tenancy row shape exactly.
        | 'organizationId'
        | 'nationalIdEnc'
        | 'contactPhoneEnc'
        | 'contactEmailEnc'
      >
    >
  > {
    const canViewAllOwners = canReadAllCustomerOwners(actor);
    // Part F item #6 — resolve the search term to a set of ids first, then
    // filter the existing Prisma query by them, rather than duplicating
    // ownerUserId/status filtering logic in raw SQL.
    const filter: CustomerFilter = {
      status: query.status,
      ownerUserId: canViewAllOwners ? query.ownerUserId : actor.id,
      id: query.search
        ? await this.customers.searchIds(query.search)
        : undefined,
    };
    // One window, used by both queries below: a page read and a count that
    // disagreed about the filter would render "51 of 12".
    const window = pageWindow(query.page, query.pageSize);
    const [customers, total] = await Promise.all([
      this.customers.findMany(filter, window),
      this.customers.countMany(filter),
    ]);
    // Explicit allow-list, not destructure-and-strip — same reasoning as
    // toMasked() above: what's returned is spelled out, not inferred from
    // what was removed.
    const items = customers.map((customer) => ({
      id: customer.id,
      prospectId: customer.prospectId,
      customerType: customer.customerType,
      legalName: customer.legalName,
      givenName: customer.givenName,
      fatherName: customer.fatherName,
      grandfatherName: customer.grandfatherName,
      familyName: customer.familyName,
      // Part B §11 — screening discriminators. Returned in the clear
      // deliberately (unlike the `-- ENCRYPT` columns above): they exist to be
      // compared against a sanctions/PEP list entry, and a reviewer working a
      // match needs to see them.
      dateOfBirth: customer.dateOfBirth,
      nationality: customer.nationality,
      registrationNumber: customer.registrationNumber,
      taxRegistrationNumber: customer.taxRegistrationNumber,
      registeredAddress: customer.registeredAddress,
      natureOfBusiness: customer.natureOfBusiness,
      languagePreference: customer.languagePreference,
      preferredContactChannel: customer.preferredContactChannel,
      status: customer.status,
      // Part III §7 — provenance travels with the record. A reader has to be
      // able to tell a LEGACY_IMPORT row from one that came through intake.
      source: customer.source,
      classification: customer.classification,
      ownerUserId: customer.ownerUserId,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    }));
    return { items, total, page: window.page, pageSize: window.pageSize };
  }

  private async findOwnedOrVisible(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<Customer> {
    const customer = await this.customers.findById(id);
    if (!customer || !isCustomerVisibleTo(customer, actor)) {
      throw new NotFoundException('Customer not found');
    }
    return customer;
  }

  /** Profile view — decrypts and masks the three `-- ENCRYPT` fields
   * (EncryptionService.decrypt() itself logs an isSensitiveDataAccess audit
   * row per field, per call, satisfying Part 10.3's read-logging
   * requirement independent of this method's own bookkeeping). The full
   * unmasked value is available only through revealField() below, with a
   * written justification. */
  async get(id: string, actor: AuthenticatedUser): Promise<MaskedCustomer> {
    const customer = await this.findOwnedOrVisible(id, actor);
    return this.toMasked(customer, actor.id);
  }

  /**
   * Full, unmasked drill-down on one field — requires a written reason, gated the
   * same as get() for visibility, additionally logged by
   * SensitiveFieldRevealService.reveal() with that reason attached.
   *
   * ## The national ID needs its own permission, and only the national ID
   *
   * This endpoint was gated on `customer.360-view.read` alone — the same code that
   * gates reading the customer at all — so all five holders of that could reveal a
   * national identity number. Part 10.2 classifies that field Highly
   * Confidential, and "can open this customer's file" is not the same decision as
   * "may read their national ID".
   *
   * Enforced PER FIELD rather than at the route, which is where this differs from
   * the employee split. `RevealEmployeeFieldDto` accepts only `nationalId`, so
   * there the route gate is the field gate. Here the same endpoint also reveals
   * `contactPhone` and `contactEmail`, which a Sales/Relationship Officer needs
   * for ordinary work on a customer they own — moving the whole route to Compliance
   * would have stopped an officer phoning their own client. So visibility and the
   * contact fields stay under `customer.360-view.read`, and the national ID
   * additionally requires `customer.national-id.reveal`.
   */
  async revealField(
    id: string,
    dto: RevealFieldDto,
    actor: AuthenticatedUser,
  ): Promise<{ field: string; value: string }> {
    if (
      dto.field === 'nationalId' &&
      !actor.permissions.has(CUSTOMER_NATIONAL_ID_REVEAL)
    ) {
      throw new ForbiddenException(
        'Revealing a national ID requires the customer.national-id.reveal permission.',
      );
    }
    const customer = await this.findOwnedOrVisible(id, actor);
    const fieldMap: Record<typeof dto.field, string | null> = {
      nationalId: customer.nationalIdEnc,
      contactPhone: customer.contactPhoneEnc,
      contactEmail: customer.contactEmailEnc,
    };
    const encryptedValue = fieldMap[dto.field];
    if (!encryptedValue) {
      throw new NotFoundException(
        `Customer ${id} has no value set for ${dto.field}`,
      );
    }
    const value = await this.reveal.reveal({
      userId: actor.id,
      entityType: 'Customer',
      entityId: id,
      field: dto.field,
      encryptedValue,
      reason: dto.reason,
    });
    return { field: dto.field, value };
  }

  /** Decrypts-then-masks a single UBO's nationalIdEnc — the UBO counterpart
   * of toMasked() above, shared by addUbo() and listUbos() so a raw
   * ciphertext value can't round-trip out of either response by omission
   * (the same class of bug toMasked()'s own header comment documents being
   * fixed for Customer itself). Decrypting every UBO on a profile view is a
   * bounded, single-customer read (typically a handful of rows), not the
   * cross-customer bulk-decrypt list()'s own comment warns against — this
   * is the "single-record profile" case, just with a nested collection
   * instead of scalar fields. */
  private async toMaskedUbo(
    ubo: UltimateBeneficialOwner,
    actorUserId: string,
  ): Promise<
    Omit<UltimateBeneficialOwner, 'nationalIdEnc'> & {
      nationalId: string | null;
    }
  > {
    const { nationalIdEnc, ...rest } = ubo;
    return {
      ...rest,
      nationalId: nationalIdEnc
        ? this.reveal.mask(
            await this.encryption.decrypt('pii', nationalIdEnc, {
              userId: actorUserId,
              entityType: 'UltimateBeneficialOwner',
              entityId: ubo.id,
              field: 'nationalIdEnc',
            }),
          )
        : null,
    };
  }

  async addUbo(
    customerId: string,
    dto: CreateUboDto,
    actor: AuthenticatedUser,
  ): Promise<
    Omit<UltimateBeneficialOwner, 'nationalIdEnc'> & {
      nationalId: string | null;
    }
  > {
    const customer = await this.findOwnedOrVisible(customerId, actor);
    if (customer.customerType !== 'CORPORATE') {
      throw new UnprocessableEntityException(
        `Customer ${customerId}: UBOs only apply to a CORPORATE customer (this one is ${customer.customerType})`,
      );
    }

    const id = randomUUID();
    const encrypted = await encryptEntityFields(
      this.encryption,
      'UltimateBeneficialOwner',
      { nationalIdEnc: dto.nationalId },
      { userId: actor.id, entityType: 'Customer', entityId: customerId },
    );

    // Part F item #4 — a UBO is always a real individual, so the 4
    // national-ID-convention parts always apply (unlike Customer, which
    // branches on customerType).
    const fullName = composeFullName({
      givenName: dto.givenName,
      fatherName: dto.fatherName,
      grandfatherName: dto.grandfatherName,
      familyName: dto.familyName,
    });

    const ubo = await this.customers.createUbo({
      id,
      customerId,
      fullName,
      givenName: dto.givenName,
      fatherName: dto.fatherName,
      grandfatherName: dto.grandfatherName,
      familyName: dto.familyName,
      nationalIdEnc: encrypted.nationalIdEnc,
      ownershipPercent:
        dto.ownershipPercent !== undefined
          ? new Prisma.Decimal(dto.ownershipPercent)
          : undefined,
      isAuthorizedSignatory: dto.isAuthorizedSignatory ?? false,
      isPep: dto.isPep,
      // Part B §11 — screening discriminators.
      dateOfBirth: parseDateOnly(dto.dateOfBirth),
      nationality: dto.nationality,
    });

    try {
      await this.audit.record({
        userId: actor.id,
        action: 'CREATE',
        entityType: 'Customer',
        entityId: customerId,
        afterValue: {
          uboId: ubo.id,
          fullName: ubo.fullName,
          isPep: ubo.isPep,
        },
      });
    } catch {
      // best-effort, same as create() above
    }

    return this.toMaskedUbo(ubo, actor.id);
  }

  async listUbos(
    customerId: string,
    actor: AuthenticatedUser,
  ): Promise<
    Array<
      Omit<UltimateBeneficialOwner, 'nationalIdEnc'> & {
        nationalId: string | null;
      }
    >
  > {
    await this.findOwnedOrVisible(customerId, actor);
    const ubos = await this.customers.findUbosByCustomerId(customerId);
    return Promise.all(ubos.map((ubo) => this.toMaskedUbo(ubo, actor.id)));
  }

  async addDocument(
    customerId: string,
    dto: CreateCustomerDocumentDto,
    actor: AuthenticatedUser,
  ): Promise<Document> {
    await this.findOwnedOrVisible(customerId, actor);

    const document = await this.customers.createDocument({
      customerId,
      category: 'APPLICATION_PROPOSAL',
      classification: dto.classification,
      fileName: dto.fileName,
      storageRef: dto.storageRef,
      uploadedByUserId: actor.id,
    });

    try {
      await this.audit.record({
        userId: actor.id,
        action: 'CREATE',
        entityType: 'Document',
        entityId: document.id,
        afterValue: {
          customerId,
          category: document.category,
          classification: document.classification,
          fileName: document.fileName,
        },
      });
    } catch {
      // best-effort, same as create() above
    }

    return document;
  }

  async listDocuments(
    customerId: string,
    actor: AuthenticatedUser,
  ): Promise<Document[]> {
    await this.findOwnedOrVisible(customerId, actor);
    return this.customers.findDocumentsByCustomerId(customerId);
  }
}

/**
 * `YYYY-MM-DD` -> a `Date` at midnight UTC.
 *
 * `new Date('1990-05-14')` already parses as midnight UTC, and the column is a
 * Postgres DATE, so no timezone shift is possible. Written out rather than
 * inlined because getting this wrong silently moves a date of birth by a day
 * — and a screening discriminator that is one day out is worse than an absent
 * one: it makes a true match look contradicted.
 */
function parseDateOnly(value: string | undefined): Date | undefined {
  return value ? new Date(`${value}T00:00:00.000Z`) : undefined;
}
