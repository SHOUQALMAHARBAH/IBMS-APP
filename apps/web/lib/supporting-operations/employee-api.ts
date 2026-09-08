// Process 66 — Human Resources (backlog Part C #66, Domain H). Calls
// apps/api's /employees routes. employee.manage / training.record /
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
}

export interface CreateEmployeeInput {
  /** Jordanian national-ID-convention name parts (Part F item #4) — an
   * Employee is always a real individual. `fullName` is computed
   * server-side from these, not accepted directly. */
  givenName: string;
  fatherName?: string;
  grandfatherName?: string;
  familyName: string;
  nationalId: string;
  position?: string;
  hireDate: string;
  licensedRole?: string;
  confidentialityAgreementSignedAt?: string;
  backgroundCheckCompletedAt?: string;
  userId?: string;
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
