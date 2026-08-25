import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import Ajv from 'ajv';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

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
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

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
});
