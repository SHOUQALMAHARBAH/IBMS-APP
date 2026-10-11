import { registerDecorator, type ValidationOptions } from 'class-validator';

/**
 * Text that looks like a CBJ broker approval, which `licensedRole` must no longer carry.
 *
 * ## Why a refusal rather than a one-off cleanup
 *
 * Before item (g) the CBJ approval WAS this free-text column, in two different spellings across two
 * databases ('CBJ Licensed Insurance Broker' on dev, 'CBJ-licensed Broker Representative' on
 * db-test). The migration moved all 54 rows into the structured marker. Without a refusal, the next
 * person to type it recreates the second home one record at a time — and item (f)'s staffing count
 * would then be reading a field that no longer holds every approval.
 *
 * Matched on 'cbj' case-insensitively, deliberately broad: the point is to send the writer to the
 * right field, and over-catching costs a clear message while under-catching costs the invariant.
 */
export function looksLikeCbjApproval(
  value: string | null | undefined,
): boolean {
  return value != null && /cbj/i.test(value);
}

/** What a writer is told. Names the field to use instead, never only the refusal. */
export const CBJ_IN_LICENSED_ROLE_REFUSAL =
  'A CBJ broker approval is no longer recorded as free text. Record it on this person’s CBJ ' +
  'approval (status, approval date and approved branches) instead; licensedRole is for other ' +
  'regulated certifications. Module 0 item (g).';

/**
 * MODULE 0 ITEM (g) — refuses a CBJ broker approval typed into `Employee.licensedRole`.
 *
 * ## Why this one CAN live on the DTO, where item (e)'s could not
 *
 * Item (e) found that a class-level `@Validate` beside `@IsOptional()` never runs in the case it was
 * written for, because `@IsOptional()` installs a condition that skips every validator on its
 * property when the value is ABSENT. That rule was about absence — "the caller sent neither field" —
 * so the DTO was the wrong layer and it moved into the service.
 *
 * This rule is the opposite shape: it is about a value that IS PRESENT. `@IsOptional()` skips
 * nothing when there is something to check, so the boundary is exactly the right place, and it
 * covers all three write paths from two declarations — `PersonRecordDto` (shared by
 * `POST /employees` and `POST /admin/users`) and `UpdateEmployeeDto`.
 *
 * `licensed-role-refusal.guard.spec.ts` asserts that every DTO declaring `licensedRole` carries
 * this, so a third declaration added later cannot quietly reopen the second home.
 */
export function IsNotCbjApproval(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isNotCbjApproval',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown): boolean {
          return !looksLikeCbjApproval(
            typeof value === 'string' ? value : null,
          );
        },
        defaultMessage(): string {
          return CBJ_IN_LICENSED_ROLE_REFUSAL;
        },
      },
    });
  };
}
