import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ENTRY 74's GAP, CLOSED AS AN ASSERTED PROPERTY RATHER THAN A NEW FIELD.
 *
 * ## WHAT THE GAP WAS
 *
 * `ProvisionUserDto` carries no office field, so `POST /admin/users` creates the account in the
 * office of whoever ran the creation. That is CORRECT — an office administrator provisioning their
 * own staff must not be able to aim at another office — but it was true only implicitly, by the
 * absence of a field and the tenancy extension's default. Nothing said so and nothing checked it.
 *
 * ## WHY THE CLOSURE IS NOT AN OFFICE FIELD
 *
 * Adding one would be a WIDENING: `user.manage` is held by OFFICE_ADMINISTRATOR and
 * SYSTEM_SECURITY_ADMINISTRATOR, and either could then write an account into another office. The
 * provider side already has the narrow route for that — `POST /provider/brokerage-offices/:officeId/
 * administrator`, gated on a PLATFORM-scoped code and taking the office in the PATH — and its whole
 * point is that the ordinary path cannot do it.
 *
 * So the fix is the shape this repository already uses for `UpdateCustomerContactDto`, where the
 * ABSENT fields are the control: state that the absence is deliberate, and make it fail loudly if
 * somebody adds one. With `forbidNonWhitelisted` on the global pipe, a request carrying such a field
 * is already a 400 naming it; this spec is what stops the FIELD being added in the first place.
 *
 * ## THE ROLE SET THIS TOUCHES: NONE
 *
 * No gate changes. `user.manage` reaches OFFICE_ADMINISTRATOR and SYSTEM_SECURITY_ADMINISTRATOR on
 * the office side, plus PLATFORM_OPERATOR and INSURANCE_COMPANY_ADMINISTRATOR on the provider side,
 * exactly as before — `route-role-reach.spec.ts` is where a change to that would have to be
 * declared.
 */

const RBAC = join(__dirname);
const DTO = join(RBAC, 'dto', 'provision-user.dto.ts');
// rbac -> modules -> src -> api -> apps -> repo root. FIVE, and the first version used four and
// landed in `apps/`, where the read failed — which the third test caught on its first run rather
// than passing against a file it could not find.
const SCHEMA = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'packages',
  'db',
  'prisma',
  'schema.prisma',
);

/** Any spelling by which a caller could try to name the office. */
const OFFICE_FIELD =
  /^\s*(readonly\s+)?(organizationId|officeId|organisationId|tenantId|brokerageOfficeId)\s*[?!]?\s*:/m;

describe('the ordinary provisioning path is bound to the caller office', () => {
  const dto = readFileSync(DTO, 'utf8');

  it('reads the DTO, so a renamed file cannot make this spec vacuous', () => {
    // The non-vacuity floor: every assertion below is an ABSENCE, and an empty file satisfies all
    // of them.
    expect(dto.length).toBeGreaterThan(500);
    expect(dto).toContain('export class ProvisionUserDto');
  });

  it('names no office field, in any spelling', () => {
    const hit = OFFICE_FIELD.exec(dto);
    expect(
      hit?.[0] ?? null,
      'A field naming the office would let a `user.manage` holder provision into another office. ' +
        'The provider-side invite route is the narrow way to do that, gated on a PLATFORM-scoped ' +
        'code and taking the office in the path. See this file header.',
    ).toBeNull();
  });

  it('and the office is supplied by the TENANCY EXTENSION, which is what makes the absence safe', () => {
    // `User.organizationId` carries `@default(dbgenerated())`, which `tenantScopeExtension` fills
    // from `app.current_org_id` — the caller's own organization. If this ever stopped being the
    // mechanism, "no office field" would stop meaning "the caller's office" and would start meaning
    // "no office at all".
    const schema = readFileSync(SCHEMA, 'utf8');
    const model = /model User \{[\s\S]*?\n\}/.exec(schema)?.[0] ?? '';
    expect(model.length).toBeGreaterThan(200);
    expect(model).toMatch(
      /organizationId\s+String\s+@default\(dbgenerated\(\)\)/,
    );
  });
});
