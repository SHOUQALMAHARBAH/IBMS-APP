import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { rawPrisma } from '../tenant-prisma';

/**
 * A signed-in, MFA-enrolled user inside the PROVIDER organization.
 *
 * EXTRACTED rather than copied. This lived inside `provider-office-state.e2e-spec.ts`, and item
 * (b) needed it a second time — but three of its details are the kind that drift apart silently if
 * there are two copies, and every one of them cost a failing run to learn:
 *
 *   * `mustChangePassword` DEFAULTS TO TRUE, so a directly-created user's login answers
 *     `{"outcome":"MUST_CHANGE_PASSWORD"}` with no `accessToken` — and the next request then fails
 *     with `jwt malformed`, an error about the token's SHAPE for a problem about the account's
 *     state.
 *   * the bcrypt cost must match `seed.ts`'s 12, or the login path cannot verify the hash and the
 *     failure reads as a wrong password rather than a bad fixture.
 *   * MFA is FORCED on `PLATFORM_OPERATOR` (`requiresMfaAlways` defaults true), so a provider user
 *     that has not enrolled is refused every gated route with `MFA_ENROLLMENT_REQUIRED` — which
 *     looks like a permission problem and is not.
 *
 * The provider organization is found BY TYPE, never by id: `PROVIDER_ORGANIZATION_ID` lives in
 * `packages/db/prisma/seed.ts`, outside `@ibms/db`'s exported `src`, so importing it typechecks on
 * a laptop and fails inside the pruned Docker image — which this repository has paid for once.
 * `findFirstOrThrow` also fails loudly here if the seed created no provider, rather than failing
 * later as a confusing 403.
 */

export const PROVIDER_E2E_PASSWORD = 'Correct-Horse-Battery-Staple-9';

interface IssuedSessionBody {
  accessToken?: string;
}
interface MfaEnrollBody {
  credentialId: string;
  otpAuthUri: string;
}

function secretFromOtpAuthUri(uri: string): string {
  const match = /[?&]secret=([^&]+)/.exec(uri);
  if (!match) {
    throw new Error(`no secret in otpauth URI: ${uri}`);
  }
  return match[1];
}

export function bearerHeader(token: string): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}

export async function createProviderUser(
  app: INestApplication<App>,
  label: string,
): Promise<{ accessToken: string; userId: string; organizationId: string }> {
  const email = `${label}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}@ibms.test`;

  const org = await rawPrisma.organization.findFirstOrThrow({
    where: { type: 'PROVIDER' },
  });
  const role = await rawPrisma.role.findFirstOrThrow({
    where: { organizationId: org.id, name: 'PLATFORM_OPERATOR' },
  });

  const bcrypt = await import('bcryptjs');
  const created = await rawPrisma.user.create({
    data: {
      organizationId: org.id,
      email,
      fullName: 'Platform Operator E2E',
      passwordHash: await bcrypt.hash(PROVIDER_E2E_PASSWORD, 12),
      isActive: true,
      mustChangePassword: false,
    },
  });

  // AFTER the user exists and BEFORE the login: granting the role first is fine, but enrolling MFA
  // requires a session, and a session cannot be had until the password works.
  await rawPrisma.userRoleAssignment.create({
    data: { organizationId: org.id, userId: created.id, roleId: role.id },
  });

  const login = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password: PROVIDER_E2E_PASSWORD })
    .expect(200);
  const { accessToken } = login.body as IssuedSessionBody;
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new Error(
      `provider login returned no accessToken: ${JSON.stringify(login.body)}`,
    );
  }

  const enroll = await request(app.getHttpServer())
    .post('/auth/mfa/totp/enroll')
    .set(...bearerHeader(accessToken))
    .expect(201);
  const enrollBody = enroll.body as MfaEnrollBody;
  await request(app.getHttpServer())
    .post('/auth/mfa/totp/enroll/verify')
    .set(...bearerHeader(accessToken))
    .send({
      credentialId: enrollBody.credentialId,
      code: authenticator.generate(secretFromOtpAuthUri(enrollBody.otpAuthUri)),
    })
    .expect(200);

  return { accessToken, userId: created.id, organizationId: org.id };
}
