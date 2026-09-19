import { IsString, Length, Matches } from 'class-validator';

/**
 * Backlog A.2 — grant or revoke a single role, addressed by NAME.
 *
 * Validated as a bounded string, not against the legacy `RoleName` enum.
 * Office-scoped custom roles make a role name free text an office chooses, and
 * `@IsEnum(RoleName)` rejected every one of them with a 400 — so Phase 3 could
 * have created a role that no endpoint would assign. The real check is
 * `UserAdminService`'s own lookup, which resolves the name inside the caller's
 * office and answers 422 for anything it does not find; that is also what keeps
 * one office from probing another's role names, since the lookup is scoped.
 *
 * `Matches` bounds the shape rather than the vocabulary: printable characters,
 * no control characters or newlines, because this value is echoed into audit
 * rows and log lines.
 */
export class RoleAssignmentDto {
  @IsString()
  @Length(1, 100)
  @Matches(/^[^\p{C}]+$/u, {
    message: 'role must not contain control characters',
  })
  role!: string;
}
