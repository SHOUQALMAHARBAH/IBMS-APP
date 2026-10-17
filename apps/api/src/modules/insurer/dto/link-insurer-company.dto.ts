import { IsUUID } from 'class-validator';

/**
 * MODULE 0-ب ITEM (e), DECISION 63 — the body of `POST /insurers/:id/company-link`.
 *
 * ONE FIELD. Everything else about the act is decided by the service: that the target is an
 * `INSURANCE_COMPANY` needs a read of another table, and that this record is not already linked needs
 * a read of this one. Neither is something a DTO can ask.
 *
 * There is deliberately no "force" or "relink" flag. Relinking in one step would change which source
 * answers for an insurer's details with nothing in the audit trail saying what it was linked to
 * before — so the service refuses, and unlinking is its own act with its own permission and its own
 * row recording what it undid.
 */
export class LinkInsurerCompanyDto {
  @IsUUID()
  insuranceCompanyId!: string;
}
