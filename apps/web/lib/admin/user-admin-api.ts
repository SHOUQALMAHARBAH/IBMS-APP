import { apiGet, apiPost } from '../auth/api-client';

// Backlog A.2 — user provisioning and role assignment. `POST /auth/signup`
// creates an account with NO roles (and therefore no permissions); every real
// account is provisioned here, by an administrator, with the roles it needs.

export const ROLE_NAMES = [
  'SALES_RELATIONSHIP_OFFICER',
  'PLACEMENT_TECHNICAL_OFFICER',
  'POLICY_CHECKING_OFFICER',
  'CLAIMS_OFFICER',
  'FINANCE_COLLECTIONS_OFFICER',
  'COMPLIANCE_OFFICER',
  'BRANCH_DEPARTMENT_MANAGER',
  'DATA_PROTECTION_OFFICER',
  'SYSTEM_SECURITY_ADMINISTRATOR',
  'EXECUTIVE_MANAGEMENT',
  'EXTERNAL_AUDITOR',
] as const;

export type RoleName = (typeof ROLE_NAMES)[number];

export interface AdminUser {
  id: string;
  fullName: string;
  email: string;
  isActive: boolean;
  mfaEnabled: boolean;
  languagePreference: string;
  lastLoginAt: string | null;
  accessValidFrom: string | null;
  accessValidUntil: string | null;
  createdAt: string;
  roles: RoleName[];
}

export interface ProvisionUserInput {
  fullName: string;
  email: string;
  password: string;
  languagePreference?: 'AR' | 'EN';
  roles: RoleName[];
  /** Part 5.1 — the EXTERNAL_AUDITOR role's time-boxed access window. */
  accessValidFrom?: string;
  accessValidUntil?: string;
}

export function listUsers(
  page = 0,
): Promise<{ users: AdminUser[]; total: number }> {
  return apiGet(`/admin/users?page=${page}`);
}

export function provisionUser(input: ProvisionUserInput): Promise<AdminUser> {
  return apiPost('/admin/users', input);
}

export function grantRole(
  userId: string,
  role: RoleName,
): Promise<{ userId: string; roles: RoleName[] }> {
  return apiPost(`/admin/users/${encodeURIComponent(userId)}/roles`, { role });
}

/** A POST, not a DELETE — the grant row is never deleted, only stamped
 * `revokedAt`, so the audit record of when access was withdrawn survives. */
export function revokeRole(
  userId: string,
  role: RoleName,
): Promise<{ userId: string; roles: RoleName[] }> {
  return apiPost(`/admin/users/${encodeURIComponent(userId)}/roles/revoke`, {
    role,
  });
}

export function setUserActive(
  userId: string,
  isActive: boolean,
): Promise<{ userId: string; isActive: boolean }> {
  return apiPost(
    `/admin/users/${encodeURIComponent(userId)}/${isActive ? 'activate' : 'deactivate'}`,
  );
}
