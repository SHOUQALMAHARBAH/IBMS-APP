import { randomUUID } from 'node:crypto';
import {
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
import { VIEW_ALL_OWNERS_ROLES } from '../../common/rbac-visibility.util';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CreateCustomerDto } from './dto/create-customer.dto';
import type { ListCustomersQueryDto } from './dto/list-customers-query.dto';
import type { CreateUboDto } from './dto/create-ubo.dto';
import type { CreateCustomerDocumentDto } from './dto/create-customer-document.dto';
import type { RevealFieldDto } from './dto/reveal-field.dto';

/** `customer.360-view.read` (packages/db/prisma/seed-data/permissions.ts)
 * grants SALES/MANAGER/EXEC/COMPLIANCE/AUDITOR — a superset of
 * VIEW_ALL_OWNERS_ROLES (Manager/Exec) because Compliance needs to open any
 * Sales Officer's customer to work its KYC file, and External Auditor is
 * read-only across the org by design (roles-and-segregation-of-duties.md). */
const CUSTOMER_CROSS_OWNER_ROLES = [
  ...VIEW_ALL_OWNERS_ROLES,
  'COMPLIANCE_OFFICER',
  'EXTERNAL_AUDITOR',
] as const;

/** Masked view of a Customer's own `-- ENCRYPT` fields for the profile
 * screen (Part 10.6 — masked-by-default, full reveal only via
 * SensitiveFieldRevealService.reveal()). */
export interface MaskedCustomer extends Omit<
  Customer,
  'nationalIdEnc' | 'contactPhoneEnc' | 'contactEmailEnc'
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
      registrationNumber: customer.registrationNumber,
      taxRegistrationNumber: customer.taxRegistrationNumber,
      registeredAddress: customer.registeredAddress,
      natureOfBusiness: customer.natureOfBusiness,
      languagePreference: customer.languagePreference,
      status: customer.status,
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

    const customer = await this.customers.create({
      id,
      prospectId: dto.prospectId,
      customerType: dto.customerType,
      legalName: dto.legalName,
      registrationNumber: isIndividual ? undefined : dto.registrationNumber,
      nationalIdEnc: encrypted.nationalIdEnc,
      taxRegistrationNumber: dto.taxRegistrationNumber,
      registeredAddress: isIndividual ? undefined : dto.registeredAddress,
      natureOfBusiness: isIndividual ? undefined : dto.natureOfBusiness,
      contactPhoneEnc: encrypted.contactPhoneEnc,
      contactEmailEnc: encrypted.contactEmailEnc,
      languagePreference: dto.languagePreference,
      ownerUserId: actorUserId,
    });

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
    Omit<Customer, 'nationalIdEnc' | 'contactPhoneEnc' | 'contactEmailEnc'>[]
  > {
    const canViewAllOwners = actor.roles.some((role) =>
      (CUSTOMER_CROSS_OWNER_ROLES as readonly string[]).includes(role),
    );
    const filter: CustomerFilter = {
      status: query.status,
      ownerUserId: canViewAllOwners ? query.ownerUserId : actor.id,
    };
    const customers = await this.customers.findMany(filter);
    // Explicit allow-list, not destructure-and-strip — same reasoning as
    // toMasked() above: what's returned is spelled out, not inferred from
    // what was removed.
    return customers.map((customer) => ({
      id: customer.id,
      prospectId: customer.prospectId,
      customerType: customer.customerType,
      legalName: customer.legalName,
      registrationNumber: customer.registrationNumber,
      taxRegistrationNumber: customer.taxRegistrationNumber,
      registeredAddress: customer.registeredAddress,
      natureOfBusiness: customer.natureOfBusiness,
      languagePreference: customer.languagePreference,
      status: customer.status,
      classification: customer.classification,
      ownerUserId: customer.ownerUserId,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    }));
  }

  private canView(customer: Customer, actor: AuthenticatedUser): boolean {
    if (customer.ownerUserId === actor.id) return true;
    return actor.roles.some((role) =>
      (CUSTOMER_CROSS_OWNER_ROLES as readonly string[]).includes(role),
    );
  }

  private async findOwnedOrVisible(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<Customer> {
    const customer = await this.customers.findById(id);
    if (!customer || !this.canView(customer, actor)) {
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

  /** Full, unmasked drill-down on one field — requires a written reason,
   * gated the same as get() for visibility, additionally logged by
   * SensitiveFieldRevealService.reveal() with that reason attached. */
  async revealField(
    id: string,
    dto: RevealFieldDto,
    actor: AuthenticatedUser,
  ): Promise<{ field: string; value: string }> {
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

    const ubo = await this.customers.createUbo({
      id,
      customerId,
      fullName: dto.fullName,
      nationalIdEnc: encrypted.nationalIdEnc,
      ownershipPercent:
        dto.ownershipPercent !== undefined
          ? new Prisma.Decimal(dto.ownershipPercent)
          : undefined,
      isAuthorizedSignatory: dto.isAuthorizedSignatory ?? false,
      isPep: dto.isPep,
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
