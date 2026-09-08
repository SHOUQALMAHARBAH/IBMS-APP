import type {
  AccessDeprovisioningChecklist,
  Employee,
  SecurityAwarenessTraining,
} from '@ibms/db';

/**
 * Process 66 (backlog Part C #66, Domain H) — Human Resources. `Employee`,
 * `SecurityAwarenessTraining`, and `AccessDeprovisioningChecklist` all
 * pre-exist in the core schema (Part 8.2) with zero prior application code —
 * this is their first real consumer, the same "dormant model, first real
 * writer" shape #58-65 repeatedly found in Domain G. See
 * `ibms-brain/meta/context/employee-onboarding.md`.
 *
 * The two backlog checkboxes:
 *   - an employee record + licensing/certification tracking (`licensedRole`,
 *     `confidentialityAgreementSignedAt`, `backgroundCheckCompletedAt` — the
 *     schema's own flat fields, no separate license/certificate table exists
 *     so none is invented here) + training records
 *     (`SecurityAwarenessTraining`);
 *   - an automated access de-provisioning checklist on termination, whose
 *     SLA — "same business day," escalating to IT management after 24h if
 *     still open — is ALREADY a registered `SLA_REGISTRY` entry
 *     (`termination_access_revocation`, `sla-registry.config.ts`) with zero
 *     prior caller. `EmployeeService.terminate()` is that first caller.
 */

/** Masked view of an Employee's own `-- ENCRYPT` field for API responses
 * (Part 10.6 — masked-by-default, full reveal only via
 * `SensitiveFieldRevealService.reveal()`), the `MaskedCustomer` shape. */
export interface MaskedEmployee {
  id: string;
  fullName: string;
  /** Jordanian national-ID-convention name parts (Part F item #4) —
   * populated for records created after this item shipped; historical
   * records keep only `fullName`, null parts. */
  givenName: string | null;
  fatherName: string | null;
  grandfatherName: string | null;
  familyName: string | null;
  nationalId: string;
  position: string | null;
  hireDate: string | null;
  terminationDate: string | null;
  licensedRole: string | null;
  confidentialityAgreementSignedAt: string | null;
  backgroundCheckCompletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The lighter list-row shape — no `nationalId` at all (never decrypted),
 * the `CustomerService.list()` precedent (strip the encrypted field
 * entirely rather than decrypt-then-mask N times for a list view). */
export interface EmployeeListRow {
  id: string;
  fullName: string;
  givenName: string | null;
  fatherName: string | null;
  grandfatherName: string | null;
  familyName: string | null;
  position: string | null;
  hireDate: string | null;
  terminationDate: string | null;
  licensedRole: string | null;
}

export interface EmployeeDetail extends MaskedEmployee {
  trainings: SecurityAwarenessTraining[];
  deprovisioningChecklist: AccessDeprovisioningChecklist | null;
}

export function toEmployeeListRow(employee: Employee): EmployeeListRow {
  return {
    id: employee.id,
    fullName: employee.fullName,
    givenName: employee.givenName,
    fatherName: employee.fatherName,
    grandfatherName: employee.grandfatherName,
    familyName: employee.familyName,
    position: employee.position,
    hireDate: employee.hireDate?.toISOString() ?? null,
    terminationDate: employee.terminationDate?.toISOString() ?? null,
    licensedRole: employee.licensedRole,
  };
}

/** Pure: builds the masked view from an ALREADY-decrypted plaintext
 * national id — the decrypt itself (and its own Part 10.3 sensitive-access
 * audit row) is the caller's job, `EncryptionService.decrypt()`. */
export function toMaskedEmployee(
  employee: Employee,
  maskedNationalId: string,
): MaskedEmployee {
  return {
    id: employee.id,
    fullName: employee.fullName,
    givenName: employee.givenName,
    fatherName: employee.fatherName,
    grandfatherName: employee.grandfatherName,
    familyName: employee.familyName,
    nationalId: maskedNationalId,
    position: employee.position,
    hireDate: employee.hireDate?.toISOString() ?? null,
    terminationDate: employee.terminationDate?.toISOString() ?? null,
    licensedRole: employee.licensedRole,
    confidentialityAgreementSignedAt:
      employee.confidentialityAgreementSignedAt?.toISOString() ?? null,
    backgroundCheckCompletedAt:
      employee.backgroundCheckCompletedAt?.toISOString() ?? null,
    createdAt: employee.createdAt.toISOString(),
    updatedAt: employee.updatedAt.toISOString(),
  };
}

/** Pure: the checklist is only completable once EVERY sub-item is
 * recorded — a genuine business rule (Part 8.2), not just a convenience
 * default; `EmployeeService.completeChecklist()` enforces this before
 * calling the repository's own race-safe completion guard. */
export function isDeprovisioningChecklistFullyDone(
  checklist: AccessDeprovisioningChecklist,
): boolean {
  return (
    checklist.systemAccessRevokedAt != null &&
    checklist.physicalAccessRevokedAt != null &&
    checklist.deviceReturnedAt != null &&
    checklist.knowledgeTransferDoneAt != null
  );
}
