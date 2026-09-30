// Process 66 — Human Resources (backlog Part C #66, Domain H). Calls
// apps/api's /employees routes. employee.read / training.record /
// deprovisioning.execute (all already pre-seeded).

import { apiGet, apiPatch, apiPost } from '../auth/api-client';

export interface EmployeeListRow {
  id: string;
  fullName: string;
  // Jordanian national-ID-convention name parts (Part F item #4) — null
  // for a historical record created before this item shipped.
  givenName: string | null;
  fatherName: string | null;
  grandfatherName: string | null;
  familyName: string | null;
  position: string | null;
  hireDate: string | null;
  terminationDate: string | null;
  licensedRole: string | null;
}

export interface SecurityAwarenessTraining {
  id: string;
  employeeId: string;
  trainingName: string;
  dueAt: string | null;
  completedAt: string | null;
}

export interface AccessDeprovisioningChecklist {
  id: string;
  employeeId: string;
  triggeredAt: string;
  systemAccessRevokedAt: string | null;
  physicalAccessRevokedAt: string | null;
  deviceReturnedAt: string | null;
  knowledgeTransferDoneAt: string | null;
  completedAt: string | null;
}

export interface EmployeeDetail {
  id: string;
  fullName: string;
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
  trainings: SecurityAwarenessTraining[];
  deprovisioningChecklist: AccessDeprovisioningChecklist | null;
  /** The login this person holds, when they hold one. Here so the screen never offers to create a
   *  second one and then be refused — User.employeeId is unique. */
  account: { id: string; email: string } | null;
}

/**
 * A PERSON, as the form collects one — shared with the account route.
 *
 * The same fields are accepted by `POST /employees` (a person with no login) and by the `employee`
 * block of `POST /admin/users` (a person and their login, in one transaction). One type, because the
 * unified form fills one set of fields and only the destination changes.
 */
export interface PersonInput {
  /** Jordanian national-ID-convention name parts (Part F item #4) — an
   * Employee is always a real individual. `fullName` is computed
   * server-side from these, not accepted directly. */
  givenName: string;
  fatherName?: string;
  grandfatherName?: string;
  familyName: string;
  /** The same four in English, optional as a SET. Left empty they are stored as NULL — nothing
   *  transliterates an Arabic name on a person's behalf. */
  givenNameEn?: string;
  fatherNameEn?: string;
  grandfatherNameEn?: string;
  familyNameEn?: string;
  nationalId: string;
  position?: string;
  hireDate: string;
  licensedRole?: string;
  confidentialityAgreementSignedAt?: string;
  backgroundCheckCompletedAt?: string;
}

export interface CreateEmployeeInput extends PersonInput {
  userId?: string;
  /** §4.1.2 / §4.2.2 — the org chart and the location. One pair of fields on the form feeds both the
   *  person and, when there is one, the account. */
  departmentId?: string;
  branchId?: string;
}

export function listEmployees(): Promise<EmployeeListRow[]> {
  return apiGet('/employees');
}

export function getEmployee(id: string): Promise<EmployeeDetail> {
  return apiGet(`/employees/${id}`);
}

export function createEmployee(
  input: CreateEmployeeInput,
): Promise<EmployeeDetail> {
  return apiPost('/employees', input);
}

/**
 * Correct an employee record — `PATCH /employees/:id`, which had no web caller, so a person's
 * record could be created and never corrected. Only the training and de-provisioning paths were
 * reachable.
 *
 * ## What is absent is the control
 *
 * The DTO carries no name, no national ID and no hire date. Those identify the person and the
 * employment; changing them is not a correction of a clerical field. `UpdateEmployeeDto` simply
 * does not declare them and `forbidNonWhitelisted` refuses each by name — the same construction
 * the customer contact correction uses for the screening identifiers.
 *
 * `departmentId` IS accepted by the route and is NOT sent from here: `EmployeeDetail` extends
 * `MaskedEmployee`, which does not carry it, so no screen can show which department a person is
 * in — and a field whose current value the reader cannot see is one they cannot tell they are
 * changing. Recorded as § 1.73 rather than papered over with a write-only picker.
 *
 * ## Both dates are HISTORICAL
 *
 * `parseHistoricalInstant` refuses a future value outright — "it is a record of something that
 * already happened" — so the inputs carry today as their maximum rather than letting the reader
 * discover it through a 422.
 */
export function updateEmployee(
  id: string,
  patch: {
    position?: string;
    licensedRole?: string;
    confidentialityAgreementSignedAt?: string;
    backgroundCheckCompletedAt?: string;
  },
): Promise<EmployeeDetail> {
  return apiPatch(`/employees/${encodeURIComponent(id)}`, patch);
}

/**
 * What the narrow search returns — IMPROVEMENTS § 1.83. Mirrors the api's `EmployeeSearchResultView`.
 *
 * FIVE fields, and deliberately not the employee record: this is what a Compliance Officer may learn about
 * staff WITHOUT holding `employee.read`, which that role does not. Enough to pick the right person out of
 * three of the same name; nothing more.
 */
export interface EmployeeSearchResult {
  id: string;
  fullName: string;
  fullNameEn: string | null;
  position: string | null;
  isCurrentEmployee: boolean;
}

/**
 * `GET /employees/search?q=` — gated on `employee.national-id.reveal`, NOT on `employee.read`.
 *
 * The term is MANDATORY server-side (two characters, trimmed first), so there is no "list everyone" call to
 * make. This function does not default it, and must not: a caller that sends `q=''` should see the 400
 * rather than have the client quietly widen the request.
 */
export function searchEmployees(q: string): Promise<EmployeeSearchResult[]> {
  return apiGet(`/employees/search?q=${encodeURIComponent(q)}`);
}

export function revealEmployeeField(
  id: string,
  reason: string,
): Promise<{ field: string; value: string }> {
  return apiPost(`/employees/${id}/reveal-field`, {
    field: 'nationalId',
    reason,
  });
}

export function recordTraining(
  employeeId: string,
  input: { trainingName: string; dueAt?: string; completedAt?: string },
): Promise<SecurityAwarenessTraining> {
  return apiPost(`/employees/${employeeId}/trainings`, input);
}

export function completeTraining(
  employeeId: string,
  trainingId: string,
): Promise<SecurityAwarenessTraining> {
  return apiPatch(`/employees/${employeeId}/trainings/${trainingId}/complete`);
}

export function terminateEmployee(
  employeeId: string,
): Promise<AccessDeprovisioningChecklist> {
  return apiPost(`/employees/${employeeId}/terminate`);
}

export function updateDeprovisioningChecklist(
  employeeId: string,
  update: {
    systemAccessRevoked?: boolean;
    physicalAccessRevoked?: boolean;
    deviceReturned?: boolean;
    knowledgeTransferDone?: boolean;
  },
): Promise<AccessDeprovisioningChecklist> {
  return apiPatch(`/employees/${employeeId}/deprovisioning-checklist`, update);
}

export function completeDeprovisioningChecklist(
  employeeId: string,
): Promise<AccessDeprovisioningChecklist> {
  return apiPost(`/employees/${employeeId}/deprovisioning-checklist/complete`);
}
