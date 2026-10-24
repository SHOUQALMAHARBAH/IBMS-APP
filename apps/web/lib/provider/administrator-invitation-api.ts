import { apiPost } from '../auth/api-client';

/**
 * ITEM (و)'s WAY IN — the client for the two invite routes that had no caller at all.
 *
 * ## The gap this closes, measured on both sides
 *
 * `POST /provider/brokerage-offices/:officeId/administrator` and
 * `POST /provider/insurance-companies/:companyId/administrator` are both correct, both gated, and
 * both proven over real HTTP (`office-administrator.e2e-spec.ts`,
 * `company-administrator-invitation.e2e-spec.ts`). Nothing in `apps/web` reached either: the web
 * client called the two REGISTRATION routes and stopped there. So the provider could create a tenant
 * by clicking and could never put the first person into it — measured on dev, THREE organizations
 * held zero users, and the only way to know that was to query the database.
 *
 * ## ONE function, because it is ONE act
 *
 * Two routes exist because the two codes exist, and the two codes exist deliberately: reusing
 * `provider.office.administrator.invite` for a company would make the name promise "office" while
 * the act reached a company — the defect class this module measured in `aml.monitor` and
 * `sanctions-pep.screen`. What differs is the path and the role the invitation lands on; the body is
 * the same DTO and the guarantees are identical. So the dispatch is here, once, rather than two
 * call sites in a screen that would each have to remember which path goes with which type.
 *
 * ## THE GUARANTEES, restated here because this is the file a future caller reads
 *
 *   * The account is created IN THE NAMED ORGANIZATION, not the caller's. That comes from
 *     `tenantScopeExtension` through `User.organizationId`'s `@default(dbgenerated())`, and
 *     `ProvisionUserDto` carrying NO office field is the control — `provisioning-is-tenant-bound.spec.ts`
 *     refuses five spellings of one. Do not add an office field to anything on this path.
 *   * NO PASSWORD is created, generated, recorded, returned or displayed, at any point, by anyone.
 *     The response says `howTheySignIn: 'PASSWORD_RESET'` and that is the whole mechanism. There is
 *     no field on this type that could carry one.
 *   * An office's first account is an `OFFICE_ADMINISTRATOR` (decision 18) — the only seeded role
 *     that holds both `user.manage` and `role.create`, which is what lets the office build its own
 *     roles at all. A company's is an `INSURANCE_COMPANY_ADMINISTRATOR`, whose grant set is
 *     self-administration only. The server chooses both; nothing here names a role.
 *   * Refused once the organization has any account. From then on it administers itself.
 */

export type InvitableOrganizationType = 'BROKERAGE_OFFICE' | 'INSURANCE_COMPANY';

export interface InviteAdministratorInput {
  email: string;
  fullName: string;
  /** At least 10 characters — the server's floor, the same one the combined-duty declaration uses. */
  reason: string;
}

export type InvitationOutcome =
  | 'SENT'
  | 'NOT_CONFIGURED'
  | 'CREDENTIAL_REJECTED'
  | 'SEND_FAILED';

export interface InvitedAdministrator {
  userId: string;
  email: string;
  /** `OFFICE_ADMINISTRATOR` or `INSURANCE_COMPANY_ADMINISTRATOR` — the server decides. */
  roleName: string;
  /** Always `PASSWORD_RESET`. Nothing here chooses or sends a password. */
  howTheySignIn: 'PASSWORD_RESET';
  /**
   * DECISION 25 — THE REAL OUTCOME, and the screen may not say "sent" unless it reads `SENT`.
   *
   * The account is created either way. `NOT_CONFIGURED` means the PROVIDER has connected no
   * mailbox, so nothing reached the person and the office cannot be entered until it does — which
   * is a state a provider has to be told plainly, because the alternative is an account that looks
   * delivered and is unreachable.
   *
   * `devInvitationToken` is present ONLY when the api was started with
   * `ENABLE_DEV_RESET_TOKEN=true` and `NODE_ENV !== 'production'` — the same double gate
   * `forgotPassword`'s `devResetToken` uses, with the production check as a hard override rather
   * than the primary gate. It is a TOKEN, never a password: the invited person still chooses their
   * own, and nobody ever holds one.
   */
  invitation: {
    outcome: InvitationOutcome;
    fromAddress: string | null;
    devInvitationToken?: string;
  };
}

/**
 * The route a given organization type's invitation goes to.
 *
 * Exported so a test can assert the mapping without driving a request, and so that adding a third
 * organization type is a compile error here rather than a silent fall-through to the office path.
 */
export function invitePathFor(
  organizationType: InvitableOrganizationType,
  organizationId: string,
): string {
  switch (organizationType) {
    case 'BROKERAGE_OFFICE':
      return `/provider/brokerage-offices/${organizationId}/administrator`;
    case 'INSURANCE_COMPANY':
      return `/provider/insurance-companies/${organizationId}/administrator`;
  }
}

export function inviteOrganizationAdministrator(
  organizationType: InvitableOrganizationType,
  organizationId: string,
  input: InviteAdministratorInput,
): Promise<InvitedAdministrator> {
  return apiPost<InvitedAdministrator>(
    invitePathFor(organizationType, organizationId),
    input,
  );
}

/**
 * The permission the invite route for this type requires.
 *
 * Both are `scope: PLATFORM`, so no office role can hold either — the matrix hides them,
 * `setPermissions` refuses them, and each route checks the caller's organization type. Measured on
 * dev: each is held by `PLATFORM_OPERATOR` in the `provider` organization and by no other role in
 * any organization, one holder. So the screen's control reaches exactly that role and no widening
 * was needed to build it.
 */
export function invitePermissionFor(
  organizationType: InvitableOrganizationType,
): string {
  switch (organizationType) {
    case 'BROKERAGE_OFFICE':
      return 'provider.office.administrator.invite';
    case 'INSURANCE_COMPANY':
      return 'provider.insurance-company.administrator.invite';
  }
}
