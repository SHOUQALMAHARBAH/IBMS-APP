import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length } from 'class-validator';
import { emptyStringToUndefined } from '../../../common/dto.util';

/**
 * MODULE 0-ب ITEM (f) — INVITING AN OFFICE'S FIRST ADMINISTRATOR.
 *
 * ## Why this exists: item (d) was built and unusable without it
 *
 * `POST /provider/brokerage-offices` creates the organization, its licence term, its scope, its
 * banking details AND its `OFFICE_ADMINISTRATOR` role — and NO USER. So a registered office had a
 * role nobody held and no route to a first account. Measured, both alternatives fail:
 *
 *   - `POST /auth/signup` resolves the platform's SOLE brokerage office and refuses once a second
 *     exists — and it assigns NO ROLE, so even where it works the account reaches nothing.
 *   - `POST /admin/users` writes into the CALLER's own office: `ProvisionUserDto` carries no
 *     organization and the tenant context supplies it. The provider cannot reach the new office
 *     through it, and nobody inside the new office exists to call it.
 *
 * The office was registered and unreachable. This is the one route that closes that.
 *
 * ## THREE FIELDS, AND THE OMISSIONS ARE THE DESIGN
 *
 * NOT A PASSWORD. Nothing here chooses a password for somebody else and nothing emails one. The
 * invited administrator is created with an UNUSABLE password — `randomBytes(32)` hashed, which is
 * the seed's own pattern for the provider operator — and signs in by requesting a password reset for
 * their own address. That path exists and is tested; inventing a second way into an account is how
 * an account acquires two.
 *
 * NOT A ROLE. The office holds exactly one role at this moment — the `OFFICE_ADMINISTRATOR` the
 * registration created — and letting the provider name a role would let it name one it invented for
 * somebody else's office.
 *
 * NOT A PERSON RECORD. `fullName` alone, which is the shape `ProvisionUserDto` uses for an account
 * with no employee behind it (the external auditor is the existing instance). A person with four
 * name parts, a national ID and a department is recorded on the OFFICE's own `/employees` screen, by
 * the office, once somebody can sign in — which is what this route makes possible. Creating a person
 * record from outside the office would have the provider typing an employee's name into a tenant it
 * does not work in.
 */
export class InviteOfficeAdministratorDto {
  @ApiProperty({
    description:
      "The administrator's work email. Becomes their sign-in identity, and is unique within the office.",
    example: 'admin@example.com.jo',
  })
  @IsEmail()
  @Length(1, 320)
  email!: string;

  /**
   * The display name, stored on the account.
   *
   * `User.fullName` is a stored NOT NULL column deliberately: an audit row holds a `userId` and
   * nothing else, so the name has to be readable from the account itself years later. Once the office
   * records this person as an employee and links the account, `Employee.fullName` becomes the display
   * name and this becomes the fallback — exactly as it already does for every other account.
   */
  @ApiProperty({
    description:
      "The administrator's full name, as it should appear on the account.",
    example: 'أحمد محمد العبدالله',
  })
  @IsString()
  @Length(2, 200)
  fullName!: string;

  /**
   * WHY THIS OFFICE IS BEING GIVEN AN ADMINISTRATOR, and it is mandatory.
   *
   * This is the provider reaching ACROSS A TENANCY BOUNDARY to create an account inside somebody
   * else's office — the only route in the product that does. The audit row records who did it, when,
   * into which office and for whom; the reason is what makes it answerable rather than merely
   * recorded. Ten characters is the floor the combined-duty declaration already uses, for the same
   * reason: a one-word reason is a box ticked.
   */
  @ApiProperty({
    description:
      'Why this administrator is being invited. Recorded on the audit row; at least 10 characters.',
    example:
      'First administrator for the office registered under CBJ licence CBJ-L-2026-014.',
  })
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(10, 500)
  reason!: string;
}
