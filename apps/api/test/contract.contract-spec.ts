import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';
import Ajv from 'ajv';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { prisma } from '@ibms/db';
import { createTestApp } from './utils/test-app';

interface MfaEnrollBody {
  credentialId: string;
  otpAuthUri: string;
}

function secretFromOtpAuthUri(uri: string): string {
  const match = /[?&]secret=([^&]+)/.exec(uri);
  if (!match) throw new Error('No secret in otpauth URI');
  return match[1];
}

// Validates that real HTTP responses conform to the OpenAPI document generated
// from the controllers' `@Api*Response` decorators — the contract is the
// decorators, this test is what keeps a handler from silently drifting from it.
// Requires a reachable DATABASE_URL, same as test/app.e2e-spec.ts: /health/db
// really calls the database.
describe('API contract (OpenAPI)', () => {
  let app: INestApplication<App>;
  let document: OpenAPIObject;
  const ajv = new Ajv();

  beforeAll(async () => {
    app = await createTestApp();
    document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('IBMS API').setVersion('0.0.1').build(),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  function responseSchema(path: string, status: number): object {
    const operation = document.paths[path]?.get;
    const response = operation?.responses[String(status)] as
      { content?: Record<string, { schema?: object }> } | undefined;
    const schema = response?.content?.['application/json']?.schema;
    if (!schema) {
      throw new Error(
        `No documented ${status} JSON response for GET ${path} in the OpenAPI spec`,
      );
    }
    return schema;
  }

  it.each([
    ['/health', 200],
    ['/health/db', 200],
  ])(
    'GET %s (%i) matches its documented OpenAPI schema',
    async (path, status) => {
      const res = await request(app.getHttpServer()).get(path).expect(status);
      const validate = ajv.compile(responseSchema(path, status));
      const valid = validate(res.body);
      expect(valid, ajv.errorsText(validate.errors)).toBe(true);
    },
  );

  it('GET /auth/me (200) matches its documented OpenAPI schema', async () => {
    const email = `contract-${Date.now()}-${Math.random().toString(36).slice(2)}@ibms.test`;
    const password = 'Correct-Horse-Battery-Staple-9';
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ fullName: 'Contract Test', email, password })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    const accessToken = (login.body as { accessToken: string }).accessToken;

    const res = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const validate = ajv.compile(responseSchema('/auth/me', 200));
    const valid = validate(res.body);
    expect(valid, ajv.errorsText(validate.errors)).toBe(true);
  });

  it('GET /rbac/roles (200) matches its documented OpenAPI schema', async () => {
    const email = `contract-rbac-${Date.now()}-${Math.random().toString(36).slice(2)}@ibms.test`;
    const password = 'Correct-Horse-Battery-Staple-9';
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ fullName: 'Contract RBAC Test', email, password })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    const accessToken = (
      login.body as { accessToken: string; user: { id: string } }
    ).accessToken;
    const userId = (login.body as { user: { id: string } }).user.id;

    // MfaRequiredGuard and RolesGuard/PermissionsGuard both run before this
    // route resolves — enroll MFA and grant the admin role first, same as
    // rbac.e2e-spec.ts.
    const enroll = await request(app.getHttpServer())
      .post('/auth/mfa/totp/enroll')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);
    const enrollBody = enroll.body as MfaEnrollBody;
    const secret = secretFromOtpAuthUri(enrollBody.otpAuthUri);
    await request(app.getHttpServer())
      .post('/auth/mfa/totp/enroll/verify')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        credentialId: enrollBody.credentialId,
        code: authenticator.generate(secret),
      })
      .expect(200);
    const role = await prisma.role.upsert({
      where: { name: 'SYSTEM_SECURITY_ADMINISTRATOR' },
      update: {},
      create: { name: 'SYSTEM_SECURITY_ADMINISTRATOR' },
    });
    await prisma.userRoleAssignment.upsert({
      where: { userId_roleId: { userId, roleId: role.id } },
      update: { revokedAt: null },
      create: { userId, roleId: role.id },
    });

    const res = await request(app.getHttpServer())
      .get('/rbac/roles')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const validate = ajv.compile(responseSchema('/rbac/roles', 200));
    const valid = validate(res.body);
    expect(valid, ajv.errorsText(validate.errors)).toBe(true);
  });
});
